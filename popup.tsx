/**
 * ham-radio-recorder — Popup UI
 *
 * Shows current extension status, recent logs, and stop/reset controls.
 * Manual recording is triggered per-schedule from the Options page.
 * Uses @plasmohq/messaging to communicate with the background service worker.
 */
import { sendToBackground } from "@plasmohq/messaging"
import { useCallback, useEffect, useState } from "react"

import type { ExtensionStatus, LogEntry } from "~lib/types"

// ─── Styles ──────────────────────────────────────────────────────────

const styles = {
  container: {
    width: 380,
    padding: 16,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
    color: "#e0e0e0",
    background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
    minHeight: 400
  } as React.CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: "1px solid rgba(255,255,255,0.1)"
  } as React.CSSProperties,

  title: {
    fontSize: 15,
    fontWeight: 700,
    margin: 0,
    color: "#fff"
  } as React.CSSProperties,

  optionsLink: {
    fontSize: 12,
    color: "#64b5f6",
    cursor: "pointer",
    textDecoration: "none"
  } as React.CSSProperties,

  statusCard: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)"
  } as React.CSSProperties,

  statusRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6
  } as React.CSSProperties,

  statusLabel: {
    color: "#9e9e9e",
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px"
  } as React.CSSProperties,

  badge: (color: string) =>
    ({
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 600,
      color: "#fff",
      background: color
    }) as React.CSSProperties,

  buttonRow: {
    display: "flex",
    gap: 8,
    marginBottom: 12
  } as React.CSSProperties,

  button: (variant: "primary" | "danger" | "secondary") =>
    ({
      flex: 1,
      padding: "8px 12px",
      border: "none",
      borderRadius: 6,
      cursor: "pointer",
      fontWeight: 600,
      fontSize: 12,
      color: "#fff",
      background:
        variant === "primary"
          ? "linear-gradient(135deg, #4caf50, #45a049)"
          : variant === "danger"
            ? "linear-gradient(135deg, #f44336, #d32f2f)"
            : "rgba(255,255,255,0.1)",
      transition: "opacity 0.2s",
      opacity: 1
    }) as React.CSSProperties,

  logContainer: {
    maxHeight: 200,
    overflowY: "auto" as const,
    borderRadius: 6,
    background: "rgba(0,0,0,0.3)",
    padding: 8,
    fontSize: 11,
    fontFamily: "'SF Mono', 'Fira Code', monospace"
  } as React.CSSProperties,

  logEntry: (level: string) =>
    ({
      padding: "3px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      color:
        level === "ERROR"
          ? "#ef5350"
          : level === "WARN"
            ? "#ffb74d"
            : "#a5d6a7"
    }) as React.CSSProperties,

  logTime: {
    color: "#757575",
    marginRight: 6
  } as React.CSSProperties,

  logLevel: {
    fontWeight: 700,
    marginRight: 6
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: "#9e9e9e",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    marginBottom: 6
  } as React.CSSProperties,

  progressBar: {
    width: "100%",
    height: 4,
    borderRadius: 2,
    background: "rgba(255,255,255,0.1)",
    marginTop: 6,
    overflow: "hidden" as const
  } as React.CSSProperties,

  progressFill: (pct: number) =>
    ({
      width: `${pct}%`,
      height: "100%",
      background: "linear-gradient(90deg, #4caf50, #81c784)",
      borderRadius: 2,
      transition: "width 0.5s ease"
    }) as React.CSSProperties
}

// ─── Helpers ─────────────────────────────────────────────────────────

function stateColor(state: string): string {
  switch (state) {
    case "recording":
      return "#f44336"
    case "connecting":
    case "setting_freq":
    case "setting_mode":
    case "saving":
      return "#ff9800"
    case "error":
      return "#e91e63"
    default:
      return "#616161"
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString("ja-JP", { hour12: false })
}

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString("ja-JP", { hour12: false })
}

function formatFreq(hz: number | null): string {
  if (hz === null) return "—"
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(3)} MHz`
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(1)} kHz`
  return `${hz} Hz`
}

// ─── Component ───────────────────────────────────────────────────────

function Popup() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch status and logs
  const refresh = useCallback(async () => {
    try {
      const [statusResp, logsResp] = await Promise.all([
        sendToBackground({ name: "getStatus" }),
        sendToBackground({ name: "getLogs" })
      ])
      setStatus(statusResp as ExtensionStatus)
      setLogs((logsResp as { logs: LogEntry[] }).logs?.slice(0, 30) ?? [])
    } catch (err) {
      console.error("Failed to fetch status:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + auto-refresh every 3 seconds
  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [refresh])

  // Stop recording
  const handleStop = async () => {
    await sendToBackground({ name: "stopRecording" })
    setTimeout(refresh, 500)
  }

  // Open options page
  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={{ textAlign: "center", color: "#9e9e9e" }}>Loading…</p>
      </div>
    )
  }

  const isRecording = status?.state === "recording"
  const isError = status?.state === "error"
  const canStop = isRecording || isError
  const progressPct =
    status?.recordingElapsed && status?.recordingTotal
      ? Math.min(
        100,
        (status.recordingElapsed / status.recordingTotal) * 100
      )
      : 0

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>🎙 Ham Radio Recorder</h1>
        <a style={styles.optionsLink} onClick={handleOpenOptions}>
          ⚙ Settings
        </a>
      </div>

      {/* Status Card */}
      <div style={styles.statusCard}>
        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Status</span>
          <span style={styles.badge(stateColor(status?.state ?? "idle"))}>
            {status?.state?.toUpperCase() ?? "IDLE"}
          </span>
        </div>

        {status?.currentFreq && (
          <div style={styles.statusRow}>
            <span style={styles.statusLabel}>Frequency</span>
            <span>{formatFreq(status.currentFreq)}</span>
          </div>
        )}

        {status?.currentMode && (
          <div style={styles.statusRow}>
            <span style={styles.statusLabel}>Mode</span>
            <span>{status.currentMode}</span>
          </div>
        )}

        {status?.nextAlarm && (
          <div style={styles.statusRow}>
            <span style={styles.statusLabel}>Next Schedule</span>
            <span>{formatDateTime(status.nextAlarm)}</span>
          </div>
        )}

        {status?.errorMessage && (
          <div
            style={{
              marginTop: 6,
              padding: 6,
              background: "rgba(244,67,54,0.15)",
              borderRadius: 4,
              color: "#ef5350",
              fontSize: 11
            }}>
            ⚠ {status.errorMessage}
          </div>
        )}

        {isRecording && (
          <div style={styles.progressBar}>
            <div style={styles.progressFill(progressPct)} />
          </div>
        )}

        {isRecording && status?.recordingElapsed != null && (
          <div
            style={{
              textAlign: "center",
              fontSize: 11,
              marginTop: 4,
              color: "#9e9e9e"
            }}>
            {status.recordingElapsed}s / {status.recordingTotal}s
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={styles.buttonRow}>
        {canStop && (
          <button
            style={styles.button("danger")}
            onClick={handleStop}>
            {isError ? "↺ Reset" : "◼ Stop"}
          </button>
        )}
        <button
          style={styles.button("secondary")}
          onClick={handleOpenOptions}>
          ⚙ Open Settings
        </button>
      </div>

      {/* Logs */}
      <div style={styles.sectionTitle}>Recent Activity</div>
      <div style={styles.logContainer}>
        {logs.length === 0 ? (
          <div style={{ color: "#616161", textAlign: "center", padding: 12 }}>
            No activity yet
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={styles.logEntry(log.level)}>
              <span style={styles.logTime}>{formatTime(log.timestamp)}</span>
              <span style={styles.logLevel}>
                {log.level === "ERROR" ? "✗" : log.level === "WARN" ? "⚠" : "✓"}
              </span>
              <span>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default Popup
