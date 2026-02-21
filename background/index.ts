/**
 * ham-radio-recorder — Background Service Worker (Plasmo entry)
 *
 * Responsibilities:
 * 1. chrome.alarms management for scheduled recordings
 * 2. Orchestrate recording flow: WS connect → setFreq → setMode → offscreen record → download
 * 3. Offscreen document lifecycle management
 * 4. Listen for offscreen result messages
 * 5. chrome.downloads for saving recorded files
 */

import { addLog, buildFilename, buildWsUrl, computeDurationMin, getSchedules, getSettings } from "~lib/storage"
import type {
    ExtensionStatus,
    OffscreenResponse,
    RecordingParams,
    RecordingState,
    Schedule,
    SetFreqCommand,
    SetFreqResult,
    SetModeCommand,
    SetModeResult,
    Settings
} from "~lib/types"
import { WsClient } from "~lib/ws-client"

// ─── Global State (in-memory, lost on SW restart) ────────────────────

let currentState: RecordingState = "idle"
let currentFreq: number | null = null
let currentMode: string | null = null
let recordingElapsed: number | null = null
let recordingTotal: number | null = null
let errorMessage: string | null = null

const wsClient = new WsClient()

// ─── Alarm Name Prefix ───────────────────────────────────────────────

const ALARM_PREFIX = "ham-record-"
const STOP_ALARM = "ham-stop-recording"

// Background-side progress tracker
let progressInterval: ReturnType<typeof setInterval> | null = null

// ─── Offscreen Document Path ─────────────────────────────────────────
// Plasmo compiles tabs/offscreen.tsx → tabs/offscreen.html in the build output
const OFFSCREEN_URL = "tabs/offscreen.html"

// ─── Public: Get current status ──────────────────────────────────────

export function getStatus(): ExtensionStatus {
    return {
        state: currentState,
        nextAlarm: null, // will be filled asynchronously
        currentFreq,
        currentMode,
        recordingElapsed,
        recordingTotal,
        errorMessage
    }
}

export async function getStatusAsync(): Promise<ExtensionStatus> {
    const status = getStatus()
    // Find next alarm
    const alarms = await chrome.alarms.getAll()
    const startAlarms = alarms.filter((a) => a.name.startsWith(ALARM_PREFIX))
    if (startAlarms.length > 0) {
        const nextAlarm = startAlarms.reduce((min, a) =>
            a.scheduledTime < min.scheduledTime ? a : min
        )
        status.nextAlarm = nextAlarm.scheduledTime
    }
    return status
}

// ─── State Management ────────────────────────────────────────────────

function setState(state: RecordingState, error?: string) {
    currentState = state
    errorMessage = error ?? null
    if (state === "idle") {
        recordingElapsed = null
        recordingTotal = null
    }
}

/**
 * Reset error state back to idle so the next alarm can proceed.
 * Called automatically before alarm-triggered recordings and from popup.
 */
export function resetState() {
    if (currentState === "error") {
        console.log("[SW] Resetting error state to idle")
        setState("idle")
    }
}

// ─── Offscreen Document Management ──────────────────────────────────

async function ensureOffscreen(): Promise<void> {
    // @ts-ignore - chrome.offscreen types may not be fully available
    const existing = await chrome.offscreen.hasDocument?.()
    if (existing) return

    try {
        // @ts-ignore
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_URL,
            reasons: [chrome.offscreen.Reason.USER_MEDIA],
            justification: "Recording audio from radio USB input via getUserMedia"
        })
        console.log("[SW] Offscreen document created")
    } catch (err) {
        // If already exists, that's OK
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes("already exists")) {
            throw err
        }
    }
}

async function closeOffscreen(): Promise<void> {
    try {
        // @ts-ignore
        const exists = await chrome.offscreen.hasDocument?.()
        if (exists) {
            // @ts-ignore
            await chrome.offscreen.closeDocument()
            console.log("[SW] Offscreen document closed")
        }
    } catch (err) {
        console.warn("[SW] Error closing offscreen:", err)
    }
}

// ─── Send message to offscreen document ──────────────────────────────

async function sendToOffscreen(message: Record<string, unknown>): Promise<void> {
    // We use chrome.runtime.sendMessage since offscreen documents listen
    // on the same runtime channel.
    // The offscreen.ts must filter by message.target === "offscreen"
    await chrome.runtime.sendMessage({ ...message, target: "offscreen" })
}

// ─── Recording Flow Orchestration ────────────────────────────────────

/**
 * Main recording flow, called from alarm or manual trigger.
 * Now accepts explicit recording parameters instead of using global settings.
 */
export async function executeRecordingFlow(
    params: RecordingParams
): Promise<void> {
    // Auto-reset from error state so alarms can retry
    if (currentState === "error") {
        resetState()
    }

    if (currentState !== "idle") {
        await addLog("WARN", "Recording flow skipped: already busy", { currentState })
        return
    }

    let settings: Settings
    try {
        settings = await getSettings()
    } catch (err) {
        await addLog("ERROR", "Failed to load settings", { error: String(err) })
        setState("error", "Failed to load settings")
        return
    }

    const wsUrl = buildWsUrl(settings)
    await addLog("INFO", `Starting recording flow: ${wsUrl}`, {
        freq: params.frequency,
        mode: params.mode
    })

    // Step 1: Connect to UDP-Bridge
    setState("connecting")
    try {
        await wsClient.connect(wsUrl, {
            timeoutMs: 5000,
            maxRetries: 3,
            retryDelayMs: 1000
        })
        await addLog("INFO", "WebSocket connected")
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await addLog("ERROR", `WebSocket connection failed: ${msg}`)
        setState("error", `WS connection failed: ${msg}`)
        return
    }

    // Step 2: Set Frequency
    setState("setting_freq")
    try {
        const freqCmd: SetFreqCommand = {
            type: "setFreq",
            port: settings.rigPort,
            freq: params.frequency
        }
        const freqResult = await wsClient.sendCommand<SetFreqCommand, SetFreqResult>(
            freqCmd,
            "setFreqResult",
            { timeoutMs: 5000 }
        )
        if (!freqResult.success) {
            throw new Error(freqResult.error ?? "setFreq returned success=false")
        }
        currentFreq = params.frequency
        await addLog("INFO", `Frequency set: ${params.frequency} Hz`)
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await addLog("ERROR", `setFreq failed: ${msg}`)
        setState("error", `setFreq failed: ${msg}`)
        wsClient.disconnect()
        return
    }

    // Small delay between commands — some rigs need time to process
    await new Promise((r) => setTimeout(r, 200))

    // Step 3: Set Mode
    setState("setting_mode")
    try {
        const modeCmd: SetModeCommand = {
            type: "setMode",
            port: settings.rigPort,
            mode: params.mode,
            data: params.dataMode
        }
        const modeResult = await wsClient.sendCommand<SetModeCommand, SetModeResult>(
            modeCmd,
            "setModeResult",
            { timeoutMs: 5000 }
        )
        if (!modeResult.success) {
            throw new Error(modeResult.error ?? "setMode returned success=false")
        }
        currentMode = params.mode
        await addLog("INFO", `Mode set: ${params.mode} (data=${params.dataMode})`)
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await addLog("ERROR", `setMode failed: ${msg}`)
        setState("error", `setMode failed: ${msg}`)
        wsClient.disconnect()
        return
    }

    // Disconnect WS — we don't need it during recording
    wsClient.disconnect()

    // Step 4: Start recording via offscreen
    setState("recording")
    const durationMs = params.durationMin * 60 * 1000
    recordingTotal = params.durationMin * 60
    recordingElapsed = 0

    try {
        await ensureOffscreen()

        if (!settings.deviceId) {
            throw new Error("No audio device selected. Please configure in Options.")
        }

        await sendToOffscreen({
            action: "startRecording",
            deviceId: settings.deviceId,
            durationMs,
            mimeType: "audio/webm;codecs=opus"
        })

        await addLog("INFO", `Recording started: ${params.durationMin} min`, {
            deviceId: settings.deviceId
        })

        // Set up a backup auto-stop alarm in the background service worker.
        // This ensures recording stops even if the offscreen document becomes
        // unresponsive (e.g. Plasmo HMR reload, crash).
        const stopDelayMin = Math.max(params.durationMin + 0.1, 1) // +6sec grace
        await chrome.alarms.create(STOP_ALARM, {
            delayInMinutes: stopDelayMin
        })
        console.log(`[SW] Backup stop alarm set for ${stopDelayMin} min`)

        // Track progress from the background side
        const recordStart = Date.now()
        progressInterval = setInterval(() => {
            recordingElapsed = Math.floor((Date.now() - recordStart) / 1000)
        }, 1000)

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await addLog("ERROR", `Recording start failed: ${msg}`)
        setState("error", `Recording start failed: ${msg}`)
        await closeOffscreen()
    }
}

/**
 * Stop an in-progress recording, or force-reset from error state.
 */
export async function stopRecording(): Promise<void> {
    // Clear backup stop alarm
    await chrome.alarms.clear(STOP_ALARM)
    clearProgressInterval()

    // If in error state, just reset
    if (currentState === "error") {
        await addLog("INFO", "Force reset from error state")
        wsClient.disconnect()
        await closeOffscreen()
        setState("idle")
        return
    }

    if (currentState !== "recording") {
        await addLog("WARN", "stopRecording called but not recording")
        return
    }

    try {
        await sendToOffscreen({ action: "stopRecording" })
        await addLog("INFO", "Stop signal sent to offscreen")
        // Wait a moment for the offscreen to finalize and send recordingResult
        await new Promise((r) => setTimeout(r, 2000))
    } catch (err) {
        await addLog("WARN", `Offscreen unreachable, force-closing: ${String(err)}`)
    }

    // If still recording after trying to stop, force-close
    if (currentState === "recording") {
        await addLog("INFO", "Force-closing offscreen and resetting state")
        await closeOffscreen()
        setState("idle")
    }
}

function clearProgressInterval() {
    if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
    }
}

/**
 * Test WebSocket connection only (no recording).
 */
export async function testWsConnection(): Promise<{
    success: boolean
    error?: string
}> {
    try {
        const settings = await getSettings()
        const url = buildWsUrl(settings)
        await wsClient.connect(url, { timeoutMs: 5000, maxRetries: 1 })
        wsClient.disconnect()
        await addLog("INFO", `Connection test successful: ${url}`)
        return { success: true }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await addLog("ERROR", `Connection test failed: ${msg}`)
        return { success: false, error: msg }
    }
}

// ─── Handle messages from offscreen document ─────────────────────────

chrome.runtime.onMessage.addListener(
    (message: OffscreenResponse, _sender, sendResponse) => {
        // Only handle messages from offscreen
        if (!message || (message as any).source !== "offscreen") return false

        handleOffscreenMessage(message)
        sendResponse({ ok: true })
        return false
    }
)

async function handleOffscreenMessage(msg: OffscreenResponse) {
    switch (msg.action) {
        case "recordingResult":
            await handleRecordingResult(msg)
            break

        case "recordingProgress":
            recordingElapsed = msg.elapsed
            recordingTotal = msg.total
            break

        case "enumerateDevicesResult":
            // Handled by the message handler that initiated the request
            break

        default:
            console.log("[SW] Unknown offscreen message:", msg)
    }
}

async function handleRecordingResult(
    msg: Extract<OffscreenResponse, { action: "recordingResult" }>
) {
    // Clean up backup timer & progress tracker
    await chrome.alarms.clear(STOP_ALARM)
    clearProgressInterval()

    if (!msg.success) {
        await addLog("ERROR", `Recording failed: ${msg.error}`)
        setState("error", `Recording failed: ${msg.error}`)
        await closeOffscreen()
        return
    }

    // Step 5: Download the recorded file
    setState("saving")

    try {
        const settings = await getSettings()
        const filename = buildFilename(
            settings.filenameTemplate,
            currentFreq ?? 0,
            currentMode ?? "UNKNOWN"
        )

        await chrome.downloads.download({
            url: msg.blobUrl!,
            filename: `${filename}.webm`,
            saveAs: false
        })

        await addLog("INFO", `Recording saved: ${filename}.webm`, {
            durationMs: msg.durationMs
        })
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        await addLog("ERROR", `Download failed: ${errMsg}`)
        setState("error", `Download failed: ${errMsg}`)
        return
    } finally {
        await closeOffscreen()
    }

    setState("idle")
    await addLog("INFO", "Recording flow complete")
}

// ─── Alarm Management ────────────────────────────────────────────────

/**
 * Create or update chrome alarms from a schedule.
 * Creates a start alarm based on schedule.startTime.
 */
export async function createAlarmFromSchedule(
    schedule: Schedule
): Promise<void> {
    const alarmName = `${ALARM_PREFIX}${schedule.id}`

    if (!schedule.enabled) {
        await chrome.alarms.clear(alarmName)
        return
    }

    // Parse "HH:MM" into the next occurrence
    const [hours, minutes] = schedule.startTime.split(":").map(Number)
    const now = new Date()
    const target = new Date(now)
    target.setHours(hours, minutes, 0, 0)

    // If the time has already passed today, schedule for tomorrow
    if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1)
    }

    const alarmInfo: chrome.alarms.AlarmCreateInfo = {
        when: target.getTime()
    }

    // For daily schedules, add a period of 24 hours (in minutes)
    if (schedule.type === "daily") {
        alarmInfo.periodInMinutes = 24 * 60
    }

    await chrome.alarms.create(alarmName, alarmInfo)
    await addLog("INFO", `Alarm created: ${schedule.startTime}–${schedule.endTime} (${schedule.type})`, {
        alarmName,
        when: target.toISOString(),
        frequency: schedule.frequency,
        mode: schedule.mode
    })
}

/**
 * Restore all alarms from stored schedules (on install / startup).
 */
async function restoreAlarms(): Promise<void> {
    const schedules = await getSchedules()
    for (const schedule of schedules) {
        if (schedule.enabled) {
            await createAlarmFromSchedule(schedule)
        }
    }
    await addLog("INFO", `Restored ${schedules.length} schedule(s)`)
}

// ─── Alarm Listener ──────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
    // Handle backup stop alarm
    if (alarm.name === STOP_ALARM) {
        await addLog("INFO", "Backup stop alarm fired — force-stopping recording")
        clearProgressInterval()
        if (currentState === "recording") {
            try {
                await sendToOffscreen({ action: "stopRecording" })
                await new Promise((r) => setTimeout(r, 2000))
            } catch {
                // offscreen may be gone
            }
            if (currentState === "recording") {
                await closeOffscreen()
                setState("idle")
                await addLog("INFO", "Recording force-stopped by backup alarm")
            }
        }
        return
    }

    if (!alarm.name.startsWith(ALARM_PREFIX)) return

    const scheduleId = alarm.name.replace(ALARM_PREFIX, "")
    await addLog("INFO", `Alarm fired: ${scheduleId}`)

    // Check if the alarm fired within a reasonable window (±5 min)
    const now = Date.now()
    const drift = Math.abs(now - alarm.scheduledTime)
    const MAX_DRIFT_MS = 5 * 60 * 1000

    if (drift > MAX_DRIFT_MS) {
        await addLog(
            "WARN",
            `Alarm drift too large (${Math.round(drift / 1000)}s), skipping`,
            { scheduleId }
        )
        return
    }

    // Load schedule to get recording parameters
    const schedules = await getSchedules()
    const schedule = schedules.find((s) => s.id === scheduleId)

    if (!schedule) {
        await addLog("WARN", `Schedule not found: ${scheduleId}`)
        return
    }

    // For one-shot schedules, remove after firing
    if (schedule.type === "once") {
        const { saveSchedules } = await import("~lib/storage")
        const updatedSchedules = schedules.filter((s) => s.id !== scheduleId)
        await saveSchedules(updatedSchedules)
        await chrome.alarms.clear(alarm.name)
        await addLog("INFO", `One-shot schedule removed: ${scheduleId}`)
    }

    // Compute duration from start/end time
    const durationMin = computeDurationMin(schedule.startTime, schedule.endTime)

    await executeRecordingFlow({
        frequency: schedule.frequency,
        mode: schedule.mode,
        dataMode: schedule.dataMode,
        durationMin
    })
})

// ─── Lifecycle Events ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
    await addLog("INFO", "Extension installed / updated")
    await restoreAlarms()
})

chrome.runtime.onStartup.addListener(async () => {
    await addLog("INFO", "Browser started, restoring alarms")
    await restoreAlarms()
})

// Log that the service worker has started
console.log("[ham-radio-recorder] Service worker started")
