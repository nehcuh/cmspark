// L2 Panel safety strip (UI Mode P1) — TaskChip + mandatory abort + minimal confirm.

import { useState, useEffect } from "react"
import { useAgentStore } from "../store/agentStore"
import { MinimalConfirm } from "./MinimalConfirm"
import { tokens } from "../ui/tokens"
import { IconExternal, IconMonitor, IconStop } from "../ui/icons"

const ABORT_ACK_TIMEOUT_MS = 3000

export function SafetyStrip() {
  const { state } = useAgentStore()
  const task = state.computerTask
  const hasConfirm = state.pendingSecurityConfirmations.length > 0
  const [abortSentAt, setAbortSentAt] = useState<number | null>(null)
  const [abortUnconfirmed, setAbortUnconfirmed] = useState(false)

  useEffect(() => {
    setAbortSentAt(null)
    setAbortUnconfirmed(false)
  }, [task?.taskId])

  useEffect(() => {
    if (abortSentAt === null || !task || task.abortAcked) return
    const t = setTimeout(() => setAbortUnconfirmed(true), ABORT_ACK_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [abortSentAt, task, task?.abortAcked])

  if (!task && !hasConfirm) return null

  const finished = task?.status === "finished"
  const live = task && !finished
  const progressText =
    task && typeof task.total === "number"
      ? `${task.steps.length}/${task.total}`
      : task
        ? `${task.steps.length} 步`
        : null

  const sendAbort = () => {
    if (!task) return
    chrome.runtime.sendMessage({ type: "computer.task.abort", task_id: task.taskId })
    setAbortSentAt(Date.now())
    setAbortUnconfirmed(false)
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.chip}>
        <span style={styles.iconBubble}>
          <IconMonitor size={14} style={{ color: live ? tokens.darkLive : tokens.darkMuted }} />
        </span>
        <span style={styles.live}>
          {live && (
            <span style={styles.liveDot} title="进行中" />
          )}
          {task?.task ? ellipsize(task.task, 36) : hasConfirm ? "待确认" : "Computer Use"}
        </span>
        {progressText && <span style={styles.meta}>{progressText}</span>}
        {task && !finished && !task.abortAcked && (
          <button type="button" style={styles.abortBtn} onClick={sendAbort} title="急停">
            <IconStop size={12} />
            急停
          </button>
        )}
        {task?.abortAcked && !finished && (
          <span style={styles.meta}>已急停…</span>
        )}
        <button
          type="button"
          style={styles.openBtn}
          onClick={() => chrome.runtime.sendMessage({ type: "cockpit.open" })}
          title="打开确认台（操控台）：完整预览与 Computer Use；关闭窗口不会停止任务"
        >
          确认台
          <IconExternal size={12} />
        </button>
      </div>
      {abortUnconfirmed && task && !task.abortAcked && !finished && (
        <div style={styles.warn}>急停未确认 — 可用 Ctrl+Alt+End</div>
      )}
      {hasConfirm && <MinimalConfirm />}
    </div>
  )
}

function ellipsize(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    padding: "8px 10px",
    background: "linear-gradient(180deg, #141820 0%, #0f1115 100%)",
    borderBottom: `1px solid ${tokens.darkBorder}`,
    color: tokens.darkText,
    fontSize: 11,
    fontFamily: tokens.font,
  },
  chip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  iconBubble: {
    width: 24,
    height: 24,
    borderRadius: 6,
    background: tokens.darkElevated,
    border: `1px solid ${tokens.darkBorder}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  live: {
    color: tokens.darkText,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: tokens.darkLive,
    boxShadow: "0 0 0 3px rgba(74, 222, 128, 0.18)",
    flexShrink: 0,
  },
  meta: { color: tokens.darkMuted, fontSize: 10, flexShrink: 0, fontVariantNumeric: "tabular-nums" },
  abortBtn: {
    background: tokens.darkDangerBg,
    color: tokens.darkDanger,
    border: "1px solid #7f1d1d",
    borderRadius: tokens.radiusSm,
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  openBtn: {
    background: "transparent",
    color: tokens.darkAccent,
    border: `1px solid ${tokens.darkBorder}`,
    borderRadius: tokens.radiusSm,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 500,
    padding: "4px 8px",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  warn: {
    marginTop: 6,
    color: "#fbbf24",
    fontSize: 10,
  },
}
