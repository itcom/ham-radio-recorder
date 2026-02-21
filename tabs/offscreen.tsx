/**
 * ham-radio-recorder — Offscreen Recording Page
 *
 * This is implemented as a Plasmo tab page so that Plasmo automatically
 * compiles and includes it in the build output.
 *
 * Used as the offscreen document URL: "tabs/offscreen.html"
 *
 * This page handles:
 * - Audio device enumeration
 * - getUserMedia → MediaRecorder recording
 * - Blob creation and URL generation for download
 */

// ─── Recording State (module-level, outside React) ───────────────────

let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
let mediaStream: MediaStream | null = null
let recordingTimer: ReturnType<typeof setInterval> | null = null
let stopTimer: ReturnType<typeof setTimeout> | null = null
let startTime = 0
let totalDurationMs = 0

// ─── Message Handlers ────────────────────────────────────────────────

async function handleEnumerateDevices(): Promise<{
    success: boolean
    devices?: Array<{ deviceId: string; label: string }>
    error?: string
}> {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = devices
            .filter((d) => d.kind === "audioinput")
            .map((d) => ({
                deviceId: d.deviceId,
                label: d.label || `Audio Input (${d.deviceId.slice(0, 8)}…)`
            }))

        console.log("[Offscreen] Found audio inputs:", audioInputs.length)

        chrome.runtime.sendMessage({
            source: "offscreen",
            action: "enumerateDevicesResult",
            devices: audioInputs
        })

        return { success: true, devices: audioInputs }
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error("[Offscreen] enumerateDevices failed:", errorMsg)
        return { success: false, error: errorMsg }
    }
}

async function handleStartRecording(params: {
    deviceId: string
    durationMs: number
    mimeType: string
}): Promise<{ success: boolean; error?: string }> {
    const { deviceId, durationMs, mimeType } = params

    if (mediaRecorder?.state === "recording") {
        return { success: false, error: "Already recording" }
    }

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: deviceId },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        })

        console.log("[Offscreen] Got media stream from device:", deviceId)

        // Determine supported MIME type
        let useMimeType = ""
        if (mimeType && MediaRecorder.isTypeSupported(mimeType)) {
            useMimeType = mimeType
        } else if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
            useMimeType = "audio/webm;codecs=opus"
        } else if (MediaRecorder.isTypeSupported("audio/webm")) {
            useMimeType = "audio/webm"
        }

        recordedChunks = []
        const options: MediaRecorderOptions = {}
        if (useMimeType) options.mimeType = useMimeType

        mediaRecorder = new MediaRecorder(mediaStream, options)

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordedChunks.push(event.data)
        }

        mediaRecorder.onstop = () => {
            console.log("[Offscreen] MediaRecorder stopped, chunks:", recordedChunks.length)
            finalizeRecording()
        }

        mediaRecorder.onerror = (event: Event) => {
            const error = (event as any).error?.message ?? "Unknown MediaRecorder error"
            console.error("[Offscreen] MediaRecorder error:", error)
            cleanupTimers()
            cleanupStream()
            chrome.runtime.sendMessage({
                source: "offscreen",
                action: "recordingResult",
                success: false,
                error
            })
        }

        mediaRecorder.start(1000)
        startTime = Date.now()
        totalDurationMs = durationMs

        console.log(`[Offscreen] Recording started: ${durationMs}ms, mimeType: ${useMimeType || "default"}`)

        // Progress reporting every 5 seconds
        recordingTimer = setInterval(() => {
            chrome.runtime.sendMessage({
                source: "offscreen",
                action: "recordingProgress",
                elapsed: Math.floor((Date.now() - startTime) / 1000),
                total: Math.floor(totalDurationMs / 1000)
            })
        }, 5000)

        // Auto-stop after duration
        stopTimer = setTimeout(() => {
            console.log("[Offscreen] Duration reached, stopping recording")
            if (mediaRecorder?.state === "recording") mediaRecorder.stop()
        }, durationMs)

        return { success: true }
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error("[Offscreen] startRecording failed:", errorMsg)
        cleanupTimers()
        cleanupStream()
        return { success: false, error: errorMsg }
    }
}

async function handleStopRecording(): Promise<{
    success: boolean
    error?: string
}> {
    if (!mediaRecorder || mediaRecorder.state !== "recording") {
        return { success: false, error: "Not currently recording" }
    }
    console.log("[Offscreen] Manual stop requested")
    cleanupTimers()
    mediaRecorder.stop()
    return { success: true }
}

function finalizeRecording() {
    cleanupTimers()

    if (recordedChunks.length === 0) {
        cleanupStream()
        chrome.runtime.sendMessage({
            source: "offscreen",
            action: "recordingResult",
            success: false,
            error: "No audio data recorded"
        })
        return
    }

    const mimeType = mediaRecorder?.mimeType ?? "audio/webm"
    const blob = new Blob(recordedChunks, { type: mimeType })
    const blobUrl = URL.createObjectURL(blob)
    const durationMs = Date.now() - startTime

    console.log(`[Offscreen] Recording finalized: ${blob.size} bytes, ${durationMs}ms`)

    chrome.runtime.sendMessage({
        source: "offscreen",
        action: "recordingResult",
        success: true,
        blobUrl,
        durationMs
    })

    cleanupStream()
    recordedChunks = []
}

function cleanupTimers() {
    if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null }
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
}

function cleanupStream() {
    if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop())
        mediaStream = null
    }
    mediaRecorder = null
}

// ─── HMR Protection ──────────────────────────────────────────────────
// ─── HMR Protection ──────────────────────────────────────────────────
// Prevent Plasmo/Parcel HMR from reloading this page during recording.
// Wrapped in try-catch because `module` may not exist in all contexts.
try {
    if (typeof module !== "undefined" && (module as any).hot) {
        ; (module as any).hot.dispose(() => {
            console.log("[Offscreen] HMR dispose — finalizing recording if active")
            if (mediaRecorder?.state === "recording") {
                mediaRecorder.stop()
            }
        })
            ; (module as any).hot.decline()
    }
} catch { /* module not available in this context */ }

// ─── Page Unload Protection ──────────────────────────────────────────
// If the page is being unloaded (HMR, crash, etc), try to save what we have
window.addEventListener("beforeunload", () => {
    if (mediaRecorder?.state === "recording") {
        console.log("[Offscreen] Page unloading during recording — emergency finalize")
        cleanupTimers()
        try { mediaRecorder.stop() } catch { /* ignore */ }
        // Synchronous finalization attempt
        if (recordedChunks.length > 0) {
            const mimeType = mediaRecorder.mimeType ?? "audio/webm"
            const blob = new Blob(recordedChunks, { type: mimeType })
            const blobUrl = URL.createObjectURL(blob)
            chrome.runtime.sendMessage({
                source: "offscreen",
                action: "recordingResult",
                success: true,
                blobUrl,
                durationMs: Date.now() - startTime
            })
        }
    }
})

// ─── Message Listener (registered immediately, not in React useEffect) ──
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.target !== "offscreen") return false

    console.log("[Offscreen] Received:", message.action)

    switch (message.action) {
        case "enumerateDevices":
            handleEnumerateDevices().then(sendResponse)
            return true
        case "startRecording":
            handleStartRecording(message).then(sendResponse)
            return true
        case "stopRecording":
            handleStopRecording().then(sendResponse)
            return true
        case "getRecordingStatus":
            sendResponse({
                recording: mediaRecorder?.state === "recording",
                elapsed: mediaRecorder?.state === "recording"
                    ? Math.floor((Date.now() - startTime) / 1000)
                    : 0
            })
            return false
        default:
            return false
    }
})

console.log("[ham-radio-recorder] Offscreen tab page loaded")

// ─── React Component (minimal, no logic) ─────────────────────────────

function OffscreenPage() {
    return null
}

export default OffscreenPage
