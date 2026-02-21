/**
 * ham-radio-recorder — Options Page
 *
 * Full settings form for:
 * - WebSocket connection (host, port, path, rig port)
 * - Audio device selection
 * - Filename template
 * - Schedule management: start/end time, frequency, mode, data mode, daily/one-shot
 */
import { sendToBackground } from "@plasmohq/messaging"
import { useCallback, useEffect, useState } from "react"

import {
    computeDurationMin,
    getSchedules,
    getSettings,
    saveSchedules,
    saveSettings
} from "~lib/storage"
import type { AudioDeviceInfo, Schedule, Settings } from "~lib/types"

// ─── Styles ──────────────────────────────────────────────────────────

const s = {
    page: {
        maxWidth: 720,
        margin: "0 auto",
        padding: "24px 20px",
        fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: "#e0e0e0",
        background: "#1a1a2e",
        minHeight: "100vh"
    } as React.CSSProperties,

    h1: {
        fontSize: 22,
        fontWeight: 700,
        color: "#fff",
        marginBottom: 24,
        paddingBottom: 12,
        borderBottom: "1px solid rgba(255,255,255,0.1)"
    } as React.CSSProperties,

    section: {
        marginBottom: 24,
        padding: 16,
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)"
    } as React.CSSProperties,

    sectionTitle: {
        fontSize: 14,
        fontWeight: 600,
        color: "#64b5f6",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 6
    } as React.CSSProperties,

    row: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 12
    } as React.CSSProperties,

    label: {
        width: 130,
        fontSize: 13,
        color: "#bdbdbd",
        flexShrink: 0
    } as React.CSSProperties,

    labelNarrow: {
        width: 80,
        fontSize: 12,
        color: "#bdbdbd",
        flexShrink: 0
    } as React.CSSProperties,

    input: {
        flex: 1,
        padding: "7px 10px",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 6,
        background: "rgba(255,255,255,0.06)",
        color: "#fff",
        fontSize: 13,
        outline: "none"
    } as React.CSSProperties,

    inputNarrow: {
        width: 100,
        padding: "7px 10px",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 6,
        background: "rgba(255,255,255,0.06)",
        color: "#fff",
        fontSize: 13,
        outline: "none",
        flexShrink: 0
    } as React.CSSProperties,

    select: {
        flex: 1,
        padding: "7px 10px",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 6,
        background: "rgba(255,255,255,0.06)",
        color: "#fff",
        fontSize: 13,
        outline: "none"
    } as React.CSSProperties,

    selectNarrow: {
        width: 80,
        padding: "7px 10px",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 6,
        background: "rgba(255,255,255,0.06)",
        color: "#fff",
        fontSize: 13,
        outline: "none",
        flexShrink: 0
    } as React.CSSProperties,

    checkbox: {
        width: 16,
        height: 16,
        accentColor: "#4caf50"
    } as React.CSSProperties,

    btn: (variant: "primary" | "secondary" | "danger" | "small") =>
        ({
            padding: variant === "small" ? "5px 10px" : "8px 16px",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: variant === "small" ? 11 : 13,
            color: "#fff",
            background:
                variant === "primary"
                    ? "linear-gradient(135deg, #4caf50, #45a049)"
                    : variant === "danger"
                        ? "linear-gradient(135deg, #f44336, #d32f2f)"
                        : "rgba(255,255,255,0.1)",
            transition: "opacity 0.2s"
        }) as React.CSSProperties,

    msg: (type: "success" | "error") =>
        ({
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 12,
            marginTop: 8,
            background:
                type === "success"
                    ? "rgba(76,175,80,0.15)"
                    : "rgba(244,67,54,0.15)",
            color: type === "success" ? "#81c784" : "#ef5350",
            border: `1px solid ${type === "success" ? "rgba(76,175,80,0.3)" : "rgba(244,67,54,0.3)"}`
        }) as React.CSSProperties,

    scheduleCard: {
        padding: "12px 14px",
        marginBottom: 10,
        borderRadius: 8,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)"
    } as React.CSSProperties,

    scheduleHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8
    } as React.CSSProperties,

    scheduleDetails: {
        display: "flex",
        flexWrap: "wrap" as const,
        gap: 12,
        fontSize: 12,
        color: "#bdbdbd"
    } as React.CSSProperties,

    scheduleTag: (color: string) =>
        ({
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 600,
            color: "#fff",
            background: color
        }) as React.CSSProperties,

    hint: {
        fontSize: 11,
        color: "#757575",
        marginTop: 4,
        marginBottom: 0
    } as React.CSSProperties
}

// ─── Mode Options ────────────────────────────────────────────────────

const MODES = ["USB", "LSB", "FM", "WFM", "AM", "CW", "RTTY", "FT8", "FT4", "DV"]

// ─── Helpers ─────────────────────────────────────────────────────────

function formatFreqMhz(hz: number): string {
    return (hz / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")
}

// ─── Component ───────────────────────────────────────────────────────

function Options() {
    // Settings state
    const [settings, setSettings] = useState<Settings | null>(null)
    const [schedules, setSchedules] = useState<Schedule[]>([])
    const [devices, setDevices] = useState<AudioDeviceInfo[]>([])
    const [message, setMessage] = useState<{
        type: "success" | "error"
        text: string
    } | null>(null)

    // New schedule form state
    const [newStartTime, setNewStartTime] = useState("07:00")
    const [newEndTime, setNewEndTime] = useState("07:30")
    const [newFreqMhz, setNewFreqMhz] = useState("145.500")
    const [newMode, setNewMode] = useState("FM")
    const [newDataMode, setNewDataMode] = useState(false)
    const [newType, setNewType] = useState<"once" | "daily">("daily")

    // Editing state: which schedule is being edited
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editForm, setEditForm] = useState<Schedule | null>(null)
    const [editFreqMhz, setEditFreqMhz] = useState("")

    // Loading devices
    const [loadingDevices, setLoadingDevices] = useState(false)

    // ─── Load Settings ───────────────────────────────────────────────

    const loadAll = useCallback(async () => {
        try {
            const [s, sched] = await Promise.all([getSettings(), getSchedules()])
            setSettings(s)
            setSchedules(sched)
        } catch (err) {
            console.error("Failed to load settings:", err)
        }
    }, [])

    useEffect(() => {
        loadAll()
    }, [loadAll])

    // ─── Save Settings ──────────────────────────────────────────────

    const handleSave = async () => {
        if (!settings) return
        try {
            await saveSettings(settings)
            showMessage("success", "Settings saved successfully")
        } catch (err) {
            showMessage("error", `Save failed: ${String(err)}`)
        }
    }

    // ─── Test Connection ─────────────────────────────────────────────

    const handleTestConnection = async () => {
        showMessage("success", "Testing connection…")
        try {
            const result = (await sendToBackground({
                name: "testConnection"
            })) as { success: boolean; error?: string }

            if (result.success) {
                showMessage("success", "Connection successful! ✓")
            } else {
                showMessage("error", `Connection failed: ${result.error}`)
            }
        } catch (err) {
            showMessage("error", `Test failed: ${String(err)}`)
        }
    }

    // ─── Enumerate Devices ───────────────────────────────────────────

    const handleEnumerateDevices = async () => {
        setLoadingDevices(true)
        try {
            const deviceList = await navigator.mediaDevices.enumerateDevices()
            const audioInputs = deviceList
                .filter((d) => d.kind === "audioinput")
                .map((d) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Audio Input (${d.deviceId.slice(0, 8)}…)`
                }))

            setDevices(audioInputs)
            if (audioInputs.length === 0) {
                showMessage(
                    "error",
                    "No audio devices found. Grant microphone permission first."
                )
            } else {
                showMessage(
                    "success",
                    `Found ${audioInputs.length} audio input(s)`
                )
            }
        } catch (err) {
            showMessage("error", `Failed: ${String(err)}`)
        } finally {
            setLoadingDevices(false)
        }
    }

    // ─── Request Mic Permission ──────────────────────────────────────

    const handleRequestMic = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            stream.getTracks().forEach((t) => t.stop())
            showMessage("success", "Microphone permission granted! Now click 'Refresh Devices'.")
            await handleEnumerateDevices()
        } catch (err) {
            showMessage("error", `Permission denied: ${String(err)}`)
        }
    }

    // ─── Schedule Management ─────────────────────────────────────────

    const handleAddSchedule = async () => {
        const freqHz = Math.round(parseFloat(newFreqMhz || "0") * 1_000_000)
        if (isNaN(freqHz) || freqHz <= 0) {
            showMessage("error", "Invalid frequency")
            return
        }

        const schedule: Schedule = {
            id: Date.now().toString(),
            startTime: newStartTime,
            endTime: newEndTime,
            frequency: freqHz,
            mode: newMode,
            dataMode: newDataMode,
            type: newType,
            enabled: true
        }

        try {
            await sendToBackground({
                name: "createSchedule",
                body: schedule
            })

            const updated = [...schedules, schedule]
            setSchedules(updated)
            const dur = computeDurationMin(newStartTime, newEndTime)
            showMessage(
                "success",
                `Schedule added: ${newStartTime}–${newEndTime} (${dur} min, ${formatFreqMhz(freqHz)} MHz ${newMode})`
            )
        } catch (err) {
            showMessage("error", `Failed to add schedule: ${String(err)}`)
        }
    }

    const handleDeleteSchedule = async (id: string) => {
        try {
            await sendToBackground({
                name: "deleteSchedule",
                body: { id }
            })
            setSchedules(schedules.filter((sc) => sc.id !== id))
            showMessage("success", "Schedule deleted")
        } catch (err) {
            showMessage("error", `Failed to delete: ${String(err)}`)
        }
    }

    const handleToggleSchedule = async (id: string) => {
        const updated = schedules.map((sc) =>
            sc.id === id ? { ...sc, enabled: !sc.enabled } : sc
        )
        setSchedules(updated)
        const schedule = updated.find((sc) => sc.id === id)!
        try {
            await sendToBackground({
                name: "createSchedule",
                body: schedule
            })
        } catch (err) {
            showMessage("error", `Failed to update: ${String(err)}`)
        }
    }

    const handleRunNow = async (schedule: Schedule) => {
        const durationMin = computeDurationMin(schedule.startTime, schedule.endTime)
        try {
            await sendToBackground({
                name: "manualRecord",
                body: {
                    frequency: schedule.frequency,
                    mode: schedule.mode,
                    dataMode: schedule.dataMode,
                    durationMin
                }
            })
            showMessage(
                "success",
                `Recording started: ${formatFreqMhz(schedule.frequency)} MHz ${schedule.mode} (${durationMin} min)`
            )
        } catch (err) {
            showMessage("error", `Failed to start: ${String(err)}`)
        }
    }

    // ─── Schedule Editing ─────────────────────────────────────────────

    const handleEditSchedule = (schedule: Schedule) => {
        setEditingId(schedule.id)
        setEditForm({ ...schedule })
        setEditFreqMhz(formatFreqMhz(schedule.frequency))
    }

    const handleCancelEdit = () => {
        setEditingId(null)
        setEditForm(null)
        setEditFreqMhz("")
    }

    const handleSaveEdit = async () => {
        if (!editForm) return
        const freqHz = Math.round(parseFloat(editFreqMhz || "0") * 1_000_000)
        if (isNaN(freqHz) || freqHz <= 0) {
            showMessage("error", "Invalid frequency")
            return
        }
        const updated: Schedule = { ...editForm, frequency: freqHz }
        try {
            await sendToBackground({
                name: "createSchedule",
                body: updated
            })
            setSchedules(schedules.map((sc) => sc.id === updated.id ? updated : sc))
            setEditingId(null)
            setEditForm(null)
            setEditFreqMhz("")
            showMessage("success", "Schedule updated")
        } catch (err) {
            showMessage("error", `Failed to update: ${String(err)}`)
        }
    }

    const updateEditField = <K extends keyof Schedule>(key: K, value: Schedule[K]) => {
        if (!editForm) return
        setEditForm({ ...editForm, [key]: value })
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    const showMessage = (type: "success" | "error", text: string) => {
        setMessage({ type, text })
        setTimeout(() => setMessage(null), 5000)
    }

    const updateSetting = <K extends keyof Settings>(
        key: K,
        value: Settings[K]
    ) => {
        if (!settings) return
        setSettings({ ...settings, [key]: value })
    }

    if (!settings) {
        return (
            <div style={s.page}>
                <p>Loading settings…</p>
            </div>
        )
    }

    return (
        <div style={s.page}>
            <h1 style={s.h1}>🎙 Ham Radio Recorder — Settings</h1>

            {/* ─── Schedule ─────────────────────────────────────────────── */}
            <div style={s.section}>
                <div style={s.sectionTitle}>⏰ Recording Schedules</div>

                {/* Existing schedules */}
                {schedules.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        {schedules.map((sc) => {
                            const isEditing = editingId === sc.id && editForm
                            const dur = computeDurationMin(sc.startTime, sc.endTime)

                            if (isEditing && editForm) {
                                const editDur = computeDurationMin(editForm.startTime, editForm.endTime)
                                return (
                                    <div key={sc.id} style={{ ...s.scheduleCard, border: "1px solid rgba(100,181,246,0.3)" }}>
                                        <div style={s.row}>
                                            <label style={s.labelNarrow}>Start</label>
                                            <input type="time" style={s.inputNarrow}
                                                value={editForm.startTime}
                                                onChange={(e) => updateEditField("startTime", e.target.value)} />
                                            <label style={{ ...s.labelNarrow, width: 40, textAlign: "center" as const }}>→</label>
                                            <label style={{ ...s.labelNarrow, width: 40 }}>End</label>
                                            <input type="time" style={s.inputNarrow}
                                                value={editForm.endTime}
                                                onChange={(e) => updateEditField("endTime", e.target.value)} />
                                            <span style={{ fontSize: 11, color: "#9e9e9e" }}>({editDur} min)</span>
                                        </div>
                                        <div style={s.row}>
                                            <label style={s.labelNarrow}>Freq</label>
                                            <input style={{ ...s.inputNarrow, width: 120 }} type="text"
                                                value={editFreqMhz}
                                                onChange={(e) => {
                                                    const val = e.target.value
                                                    if (/^[0-9]*\.?[0-9]*$/.test(val)) setEditFreqMhz(val)
                                                }}
                                                placeholder="145.500" />
                                            <span style={{ fontSize: 12, color: "#9e9e9e" }}>MHz</span>
                                            <label style={{ ...s.labelNarrow, width: 50 }}>Mode</label>
                                            <select style={s.selectNarrow}
                                                value={editForm.mode}
                                                onChange={(e) => updateEditField("mode", e.target.value)}>
                                                {MODES.map((m) => (
                                                    <option key={m} value={m}>{m}</option>
                                                ))}
                                            </select>
                                            <label style={{ fontSize: 12, color: "#bdbdbd" }}>Data</label>
                                            <input type="checkbox" style={s.checkbox}
                                                checked={editForm.dataMode}
                                                onChange={(e) => updateEditField("dataMode", e.target.checked)} />
                                        </div>
                                        <div style={s.row}>
                                            <label style={s.labelNarrow}>Type</label>
                                            <select style={s.selectNarrow}
                                                value={editForm.type}
                                                onChange={(e) => updateEditField("type", e.target.value as "once" | "daily")}>
                                                <option value="daily">Daily</option>
                                                <option value="once">One-shot</option>
                                            </select>
                                            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                                                <button style={s.btn("primary")} onClick={handleSaveEdit}>✓ Save</button>
                                                <button style={s.btn("secondary")} onClick={handleCancelEdit}>Cancel</button>
                                            </div>
                                        </div>
                                    </div>
                                )
                            }

                            return (
                                <div key={sc.id} style={s.scheduleCard}>
                                    <div style={s.scheduleHeader}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <input
                                                type="checkbox"
                                                style={s.checkbox}
                                                checked={sc.enabled}
                                                onChange={() => handleToggleSchedule(sc.id)}
                                            />
                                            <span style={{ fontWeight: 600, fontSize: 14, color: "#fff" }}>
                                                {sc.startTime} → {sc.endTime}
                                            </span>
                                            <span style={s.scheduleTag(
                                                sc.type === "daily" ? "#1976d2" : "#e65100"
                                            )}>
                                                {sc.type === "daily" ? "Daily" : "One-shot"}
                                            </span>
                                            {!sc.enabled && (
                                                <span style={s.scheduleTag("#616161")}>
                                                    Disabled
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ display: "flex", gap: 6 }}>
                                            <button
                                                style={s.btn("small")}
                                                onClick={() => handleRunNow(sc)}
                                                title="Start recording now with this schedule's settings">
                                                ▶ Run
                                            </button>
                                            <button
                                                style={s.btn("small")}
                                                onClick={() => handleEditSchedule(sc)}
                                                title="Edit this schedule">
                                                ✏
                                            </button>
                                            <button
                                                style={{ ...s.btn("small"), background: "rgba(244,67,54,0.3)" }}
                                                onClick={() => handleDeleteSchedule(sc.id)}>
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                    <div style={s.scheduleDetails}>
                                        <span>📻 {formatFreqMhz(sc.frequency)} MHz</span>
                                        <span>📡 {sc.mode}{sc.dataMode ? " (DATA)" : ""}</span>
                                        <span>⏱ {dur} min</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}

                {schedules.length === 0 && (
                    <p style={{ ...s.hint, marginBottom: 12, textAlign: "center" }}>
                        No schedules yet. Add one below.
                    </p>
                )}

                {/* Add new schedule form */}
                <div style={{
                    padding: 14,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px dashed rgba(255,255,255,0.12)"
                }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#9e9e9e", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        Add New Schedule
                    </div>

                    <div style={s.row}>
                        <label style={s.labelNarrow}>Start</label>
                        <input
                            type="time"
                            style={s.inputNarrow}
                            value={newStartTime}
                            onChange={(e) => setNewStartTime(e.target.value)}
                        />
                        <label style={{ ...s.labelNarrow, width: 40, textAlign: "center" as const }}>→</label>
                        <label style={{ ...s.labelNarrow, width: 40 }}>End</label>
                        <input
                            type="time"
                            style={s.inputNarrow}
                            value={newEndTime}
                            onChange={(e) => setNewEndTime(e.target.value)}
                        />
                        <span style={{ fontSize: 11, color: "#9e9e9e" }}>
                            ({computeDurationMin(newStartTime, newEndTime)} min)
                        </span>
                    </div>

                    <div style={s.row}>
                        <label style={s.labelNarrow}>Freq</label>
                        <input
                            style={{ ...s.inputNarrow, width: 120 }}
                            type="text"
                            value={newFreqMhz}
                            onChange={(e) => {
                                const val = e.target.value
                                if (/^[0-9]*\.?[0-9]*$/.test(val)) {
                                    setNewFreqMhz(val)
                                }
                            }}
                            placeholder="145.500"
                        />
                        <span style={{ fontSize: 12, color: "#9e9e9e" }}>MHz</span>

                        <label style={{ ...s.labelNarrow, width: 50 }}>Mode</label>
                        <select
                            style={s.selectNarrow}
                            value={newMode}
                            onChange={(e) => setNewMode(e.target.value)}>
                            {MODES.map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>

                        <label style={{ fontSize: 12, color: "#bdbdbd" }}>Data</label>
                        <input
                            type="checkbox"
                            style={s.checkbox}
                            checked={newDataMode}
                            onChange={(e) => setNewDataMode(e.target.checked)}
                        />
                    </div>

                    <div style={s.row}>
                        <label style={s.labelNarrow}>Type</label>
                        <select
                            style={s.selectNarrow}
                            value={newType}
                            onChange={(e) => setNewType(e.target.value as "once" | "daily")}>
                            <option value="daily">Daily</option>
                            <option value="once">One-shot</option>
                        </select>

                        <button style={s.btn("primary")} onClick={handleAddSchedule}>
                            + Add Schedule
                        </button>
                    </div>
                </div>
            </div>

            {/* ─── WebSocket Connection ─────────────────────────────────── */}
            <div style={s.section}>
                <div style={s.sectionTitle}>📡 WebSocket Connection</div>

                <div style={s.row}>
                    <label style={s.label}>Host</label>
                    <input
                        style={s.input}
                        value={settings.wsHost}
                        onChange={(e) => updateSetting("wsHost", e.target.value)}
                        placeholder="127.0.0.1"
                    />
                </div>

                <div style={s.row}>
                    <label style={s.label}>Port</label>
                    <input
                        style={s.input}
                        type="number"
                        value={settings.wsPort}
                        onChange={(e) => updateSetting("wsPort", Number(e.target.value))}
                        placeholder="17800"
                    />
                </div>

                <div style={s.row}>
                    <label style={s.label}>Path</label>
                    <input
                        style={s.input}
                        value={settings.wsPath}
                        onChange={(e) => updateSetting("wsPath", e.target.value)}
                        placeholder="/ws"
                    />
                </div>

                <div style={s.row}>
                    <label style={s.label}>Rig Port</label>
                    <input
                        style={s.input}
                        type="number"
                        value={settings.rigPort}
                        onChange={(e) => updateSetting("rigPort", Number(e.target.value))}
                        placeholder="0"
                    />
                </div>

                <p style={s.hint}>
                    URL: ws://{settings.wsHost}:{settings.wsPort}
                    {settings.wsPath}
                </p>

                <div style={{ ...s.row, marginTop: 8 }}>
                    <button style={s.btn("secondary")} onClick={handleTestConnection}>
                        🔌 Test Connection
                    </button>
                </div>
            </div>

            {/* ─── Audio Device ────────────────────────────────────────── */}
            <div style={s.section}>
                <div style={s.sectionTitle}>🎤 Audio Device</div>

                <div style={s.row}>
                    <label style={s.label}>Audio Device</label>
                    <select
                        style={s.select}
                        value={settings.deviceId}
                        onChange={(e) => {
                            const selectedId = e.target.value
                            const dev = devices.find((d) => d.deviceId === selectedId)
                            setSettings((prev) =>
                                prev
                                    ? {
                                        ...prev,
                                        deviceId: selectedId,
                                        deviceLabel: dev?.label ?? prev.deviceLabel
                                    }
                                    : prev
                            )
                        }}>
                        <option value="">
                            {settings.deviceLabel || "(Select a device)"}
                        </option>
                        {devices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                                {d.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div style={{ ...s.row, gap: 6 }}>
                    <button style={s.btn("secondary")} onClick={handleRequestMic}>
                        🔓 Grant Mic
                    </button>
                    <button
                        style={s.btn("secondary")}
                        onClick={handleEnumerateDevices}
                        disabled={loadingDevices}>
                        {loadingDevices ? "⏳…" : "🔄 Refresh Devices"}
                    </button>
                </div>

                <p style={s.hint}>
                    Selected: {settings.deviceLabel || "(none)"}
                </p>
            </div>

            {/* ─── Filename Template ────────────────────────────────────── */}
            <div style={s.section}>
                <div style={s.sectionTitle}>📁 Filename</div>

                <div style={s.row}>
                    <label style={s.label}>Template</label>
                    <input
                        style={s.input}
                        value={settings.filenameTemplate}
                        onChange={(e) =>
                            updateSetting("filenameTemplate", e.target.value)
                        }
                        placeholder="{date}_{time}_{freq}_{mode}"
                    />
                </div>

                <p style={s.hint}>
                    Placeholders: {"{date}"} → YYYYMMDD, {"{time}"} → HHMMSS,{" "}
                    {"{freq}"} → Hz, {"{mode}"} → mode name
                    <br />
                    Example: 20260221_070000_145500000_FM.webm
                </p>
            </div>

            {/* ─── Save Button ──────────────────────────────────────────── */}
            <div style={{ textAlign: "center", marginTop: 16 }}>
                <button
                    style={{ ...s.btn("primary"), padding: "10px 40px", fontSize: 14 }}
                    onClick={handleSave}>
                    💾 Save Settings
                </button>
            </div>

            {/* Status Message */}
            {message && (
                <div style={s.msg(message.type)}>{message.text}</div>
            )}
        </div>
    )
}

export default Options
