/**
 * ham-radio-recorder — Offscreen Document Script
 *
 * Runs inside Chrome's offscreen document (hidden page).
 * Handles all audio recording via getUserMedia and MediaRecorder.
 *
 * Communication: Listens for chrome.runtime.onMessage and sends results
 * back via chrome.runtime.sendMessage.
 *
 * This file is NOT a Plasmo component — it's loaded by offscreen.html.
 */

// ─── State ───────────────────────────────────────────────────────────

let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
let mediaStream: MediaStream | null = null
let recordingTimer: ReturnType<typeof setInterval> | null = null
let stopTimer: ReturnType<typeof setTimeout> | null = null
let startTime: number = 0
let totalDurationMs: number = 0

// ─── Message Listener ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Only handle messages targeted at offscreen
    if (!message || message.target !== "offscreen") return false

    console.log("[Offscreen] Received message:", message.action)

    switch (message.action) {
        case "enumerateDevices":
            handleEnumerateDevices().then(sendResponse)
            return true // async response

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
            console.warn("[Offscreen] Unknown action:", message.action)
            return false
    }
})

// ─── Enumerate Audio Devices ─────────────────────────────────────────

async function handleEnumerateDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = devices
            .filter((d) => d.kind === "audioinput")
            .map((d) => ({
                deviceId: d.deviceId,
                label: d.label || `Audio Input (${d.deviceId.slice(0, 8)}...)`
            }))

        console.log("[Offscreen] Found audio inputs:", audioInputs.length)

        // Also send result to SW
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

// ─── Start Recording ─────────────────────────────────────────────────

async function handleStartRecording(params: {
    deviceId: string
    durationMs: number
    mimeType: string
}) {
    const { deviceId, durationMs, mimeType } = params

    // Don't start if already recording
    if (mediaRecorder?.state === "recording") {
        return { success: false, error: "Already recording" }
    }

    try {
        // Get audio stream from specific device
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: deviceId },
                // Disable audio processing for raw radio audio
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        })

        console.log("[Offscreen] Got media stream from device:", deviceId)

        // Determine supported MIME type
        const useMimeType = MediaRecorder.isTypeSupported(mimeType)
            ? mimeType
            : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? "audio/webm;codecs=opus"
                : MediaRecorder.isTypeSupported("audio/webm")
                    ? "audio/webm"
                    : "" // Let browser decide

        // Create MediaRecorder
        recordedChunks = []
        const options: MediaRecorderOptions = {}
        if (useMimeType) {
            options.mimeType = useMimeType
        }

        mediaRecorder = new MediaRecorder(mediaStream, options)

        // Collect data chunks
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data)
            }
        }

        // Handle recording stop (both manual and timed)
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

        // Start recording (collect data every 1 second for progress tracking)
        mediaRecorder.start(1000)
        startTime = Date.now()
        totalDurationMs = durationMs

        console.log(
            `[Offscreen] Recording started: ${durationMs}ms, mimeType: ${useMimeType || "default"}`
        )

        // Set up progress reporting (every 5 seconds)
        recordingTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000)
            const total = Math.floor(totalDurationMs / 1000)

            chrome.runtime.sendMessage({
                source: "offscreen",
                action: "recordingProgress",
                elapsed,
                total
            })
        }, 5000)

        // Auto-stop after duration
        stopTimer = setTimeout(() => {
            console.log("[Offscreen] Duration reached, stopping recording")
            if (mediaRecorder?.state === "recording") {
                mediaRecorder.stop()
            }
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

// ─── Stop Recording ──────────────────────────────────────────────────

async function handleStopRecording() {
    if (!mediaRecorder || mediaRecorder.state !== "recording") {
        return { success: false, error: "Not currently recording" }
    }

    console.log("[Offscreen] Manual stop requested")
    cleanupTimers()
    mediaRecorder.stop()

    return { success: true }
}

// ─── Finalize Recording ──────────────────────────────────────────────

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

    // Create blob from recorded chunks
    const mimeType = mediaRecorder?.mimeType ?? "audio/webm"
    const blob = new Blob(recordedChunks, { type: mimeType })
    const blobUrl = URL.createObjectURL(blob)



    const durationMs = Date.now() - startTime

    console.log(
        `[Offscreen] Recording finalized: ${blob.size} bytes, ${durationMs}ms`
    )

    // Send result to SW
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

// ─── Cleanup Helpers ─────────────────────────────────────────────────

function cleanupTimers() {
    if (recordingTimer) {
        clearInterval(recordingTimer)
        recordingTimer = null
    }
    if (stopTimer) {
        clearTimeout(stopTimer)
        stopTimer = null
    }
}

function cleanupStream() {
    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop())
        mediaStream = null
    }
    mediaRecorder = null
}

console.log("[ham-radio-recorder] Offscreen document loaded")
