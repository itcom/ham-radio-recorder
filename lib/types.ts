/**
 * ham-radio-recorder — Shared TypeScript Types
 *
 * All interfaces used across background, offscreen, popup, and options.
 */

// ─── Settings ────────────────────────────────────────────────────────

/** User-configurable settings stored in chrome.storage.local */
export interface Settings {
    /** WebSocket host (default: "127.0.0.1") */
    wsHost: string
    /** WebSocket port (default: 17800) */
    wsPort: number
    /** WebSocket path (default: "/ws") */
    wsPath: string
    /** Rig port number for setFreq/setMode commands (default: 0) */
    rigPort: number
    /** Saved audio input device ID */
    deviceId: string
    /** Human-readable device label */
    deviceLabel: string
    /** Filename template with placeholders: {date}, {time}, {freq}, {mode} */
    filenameTemplate: string
}

/** Default settings */
export const DEFAULT_SETTINGS: Settings = {
    wsHost: "127.0.0.1",
    wsPort: 17800,
    wsPath: "/ws",
    rigPort: 0,
    deviceId: "",
    deviceLabel: "",
    filenameTemplate: "{date}_{time}_{freq}_{mode}"
}

// ─── Schedule ────────────────────────────────────────────────────────

/** A scheduled recording entry */
export interface Schedule {
    /** Unique identifier (ISO timestamp of creation) */
    id: string
    /** Start time of day in "HH:MM" format */
    startTime: string
    /** End time of day in "HH:MM" format (may cross midnight) */
    endTime: string
    /** Frequency in Hz (e.g. 145500000) */
    frequency: number
    /** Mode: USB, LSB, FM, AM, CW, etc. */
    mode: string
    /** Data mode flag */
    dataMode: boolean
    /** "once" = one-shot, "daily" = repeating every day */
    type: "once" | "daily"
    /** Whether this schedule is enabled */
    enabled: boolean
}

/** Parameters passed to the recording flow */
export interface RecordingParams {
    frequency: number
    mode: string
    dataMode: boolean
    durationMin: number
}

// ─── Logging ─────────────────────────────────────────────────────────

export type LogLevel = "INFO" | "WARN" | "ERROR"

export interface LogEntry {
    /** Unix timestamp in ms */
    timestamp: number
    level: LogLevel
    message: string
    data?: unknown
}

// ─── Recording State ─────────────────────────────────────────────────

/** Current state of the extension's recording pipeline */
export type RecordingState =
    | "idle"
    | "connecting"
    | "setting_freq"
    | "setting_mode"
    | "recording"
    | "saving"
    | "error"

/** Status snapshot returned to popup */
export interface ExtensionStatus {
    state: RecordingState
    /** Next alarm fire time (ms since epoch), null if none */
    nextAlarm: number | null
    /** Current/last frequency (Hz) */
    currentFreq: number | null
    /** Current/last mode */
    currentMode: string | null
    /** Recording progress: elapsed seconds */
    recordingElapsed: number | null
    /** Recording progress: total seconds */
    recordingTotal: number | null
    /** Error message if state === "error" */
    errorMessage: string | null
}

// ─── WebSocket Command Types ─────────────────────────────────────────

/** setFreq command sent to UDP-Bridge */
export interface SetFreqCommand {
    type: "setFreq"
    port: number
    freq: number
}

/** setFreq response from UDP-Bridge */
export interface SetFreqResult {
    type: "setFreqResult"
    success: boolean
    error?: string
}

/** setMode command sent to UDP-Bridge */
export interface SetModeCommand {
    type: "setMode"
    port: number
    mode: string
    data: boolean
}

/** setMode response from UDP-Bridge */
export interface SetModeResult {
    type: "setModeResult"
    success: boolean
    error?: string
}

// ─── Offscreen Messages ──────────────────────────────────────────────

/** Messages sent from SW to offscreen */
export type OffscreenRequest =
    | {
        action: "enumerateDevices"
        target: "offscreen"
    }
    | {
        action: "startRecording"
        target: "offscreen"
        deviceId: string
        durationMs: number
        mimeType: string
    }
    | {
        action: "stopRecording"
        target: "offscreen"
    }
    | {
        action: "getRecordingStatus"
        target: "offscreen"
    }

/** Messages sent from offscreen back to SW */
export type OffscreenResponse =
    | {
        source: "offscreen"
        action: "enumerateDevicesResult"
        devices: Array<{ deviceId: string; label: string }>
    }
    | {
        source: "offscreen"
        action: "recordingResult"
        success: boolean
        blobUrl?: string
        durationMs?: number
        error?: string
    }
    | {
        source: "offscreen"
        action: "recordingProgress"
        elapsed: number
        total: number
    }
    | {
        source: "offscreen"
        action: "recordingStatusResult"
        recording: boolean
        elapsed: number
    }

// ─── Audio Device Info ───────────────────────────────────────────────

export interface AudioDeviceInfo {
    deviceId: string
    label: string
}
