/**
 * ham-radio-recorder — Chrome Storage Helpers
 *
 * Typed wrappers around chrome.storage.local for settings, schedules, and logs.
 * All data is stored under well-known keys to avoid collisions.
 */

import {
    DEFAULT_SETTINGS,
    type LogEntry,
    type LogLevel,
    type RecordingParams,
    type Schedule,
    type Settings
} from "./types"

// ─── Storage Keys ────────────────────────────────────────────────────

const KEYS = {
    SETTINGS: "settings",
    SCHEDULES: "schedules",
    LOGS: "logs"
} as const

// ─── Settings ────────────────────────────────────────────────────────

/**
 * Load settings from storage, merging with defaults so that
 * newly-added fields always have a value.
 */
export async function getSettings(): Promise<Settings> {
    const result = await chrome.storage.local.get(KEYS.SETTINGS)
    const stored = (result[KEYS.SETTINGS] ?? {}) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...stored }
}

/**
 * Save a partial settings object (merges with existing).
 */
export async function saveSettings(
    partial: Partial<Settings>
): Promise<void> {
    const current = await getSettings()
    const merged = { ...current, ...partial }
    await chrome.storage.local.set({ [KEYS.SETTINGS]: merged })
}

// ─── Schedules ───────────────────────────────────────────────────────

/**
 * Load all saved schedules.
 */
export async function getSchedules(): Promise<Schedule[]> {
    const result = await chrome.storage.local.get(KEYS.SCHEDULES)
    return (result[KEYS.SCHEDULES] ?? []) as Schedule[]
}

/**
 * Replace all schedules at once.
 */
export async function saveSchedules(schedules: Schedule[]): Promise<void> {
    await chrome.storage.local.set({ [KEYS.SCHEDULES]: schedules })
}

/**
 * Add or update a single schedule.
 */
export async function upsertSchedule(schedule: Schedule): Promise<void> {
    const schedules = await getSchedules()
    const idx = schedules.findIndex((s) => s.id === schedule.id)
    if (idx >= 0) {
        schedules[idx] = schedule
    } else {
        schedules.push(schedule)
    }
    await saveSchedules(schedules)
}

/**
 * Remove a schedule by ID.
 */
export async function deleteSchedule(id: string): Promise<void> {
    const schedules = await getSchedules()
    await saveSchedules(schedules.filter((s) => s.id !== id))
}

// ─── Logs ────────────────────────────────────────────────────────────

/** Maximum number of log entries to keep */
const MAX_LOGS = 200

/**
 * Load all stored log entries (newest first).
 */
export async function getLogs(): Promise<LogEntry[]> {
    const result = await chrome.storage.local.get(KEYS.LOGS)
    return (result[KEYS.LOGS] ?? []) as LogEntry[]
}

/**
 * Add a log entry. Keeps a FIFO buffer capped at MAX_LOGS.
 * Also prints to console for debugging.
 */
export async function addLog(
    level: LogLevel,
    message: string,
    data?: unknown
): Promise<void> {
    const entry: LogEntry = {
        timestamp: Date.now(),
        level,
        message,
        data
    }

    // Console output for dev debugging
    const prefix = `[ham-radio-recorder] [${level}]`
    if (level === "ERROR") {
        console.error(prefix, message, data)
    } else if (level === "WARN") {
        console.warn(prefix, message, data)
    } else {
        console.log(prefix, message, data)
    }

    const logs = await getLogs()
    logs.unshift(entry) // newest first
    if (logs.length > MAX_LOGS) {
        logs.length = MAX_LOGS
    }
    await chrome.storage.local.set({ [KEYS.LOGS]: logs })
}

/**
 * Clear all logs.
 */
export async function clearLogs(): Promise<void> {
    await chrome.storage.local.set({ [KEYS.LOGS]: [] })
}

// ─── Utility: Re-export RecordingParams for convenience ──────────────

export type { RecordingParams }

// ─── Utility: Compute duration from start/end time ───────────────────

/**
 * Compute recording duration in minutes from start and end times.
 * Handles cross-midnight (e.g. start=23:30, end=00:15 → 45 min).
 *
 * @param startTime  "HH:MM" format
 * @param endTime    "HH:MM" format
 * @returns duration in minutes (always > 0)
 */
export function computeDurationMin(startTime: string, endTime: string): number {
    const [sh, sm] = startTime.split(":").map(Number)
    const [eh, em] = endTime.split(":").map(Number)
    const startMin = sh * 60 + sm
    const endMin = eh * 60 + em

    let diff = endMin - startMin
    if (diff <= 0) {
        diff += 24 * 60 // cross-midnight
    }
    return diff
}

// ─── Utility: Build WebSocket URL from settings ──────────────────────

/**
 * Construct the full WebSocket URL from host, port, and path.
 * Example: ws://127.0.0.1:17800/ws
 */
export function buildWsUrl(settings: Settings): string {
    const { wsHost, wsPort, wsPath } = settings
    const path = wsPath.startsWith("/") ? wsPath : `/${wsPath}`
    return `ws://${wsHost}:${wsPort}${path}`
}

// ─── Utility: Build filename from template ───────────────────────────

/**
 * Generate a filename from the template and current date/settings.
 *
 * Placeholders:
 *   {date}  → YYYYMMDD
 *   {time}  → HHMMSS
 *   {freq}  → frequency in Hz (e.g. "145500000")
 *   {mode}  → mode string (e.g. "FM")
 *
 * Example: "{date}_{time}_{freq}_{mode}" → "20260221_070000_145500000_FM"
 */
export function buildFilename(
    template: string,
    freq: number,
    mode: string,
    now?: Date
): string {
    const d = now ?? new Date()
    const pad = (n: number, len = 2) => String(n).padStart(len, "0")

    const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

    return template
        .replace("{date}", date)
        .replace("{time}", time)
        .replace("{freq}", String(freq))
        .replace("{mode}", mode)
}
