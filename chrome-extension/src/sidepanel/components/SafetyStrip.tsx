// Panel safety strip (UI Mode P1) — L2 TaskChip + mandatory abort + minimal confirm.
// Also hosts L0/L1 pending confirm (content-split: allow/deny here, heavy fields in Cockpit).

import { useState, useEffect } from "react"
import { useAgentStore } from "../store/agentStore"
import { MinimalConfirm } from "./MinimalConfirm"
import { tokens } from "../ui/tokens"
import { IconExternal, IconMonitor, IconStop } from "../ui/icons"
import { disarmAllFlags, trustStatusChip } from "./autopilot-tier"

const ABORT_ACK_TIMEOUT_MS = 3000

export function SafetyStrip({ compact = false }: { compact?: boolean } = {}) {
  const { state } = useAgentStore()
  const task = state.computerTask
  const hasConfirm = state.pendingSecurityConfirmations.length > 0
  const [abortSentAt, setAbortSentAt] = useState<number | null>(null)
  const [abortUnconfirmed, setAbortUnconfirmed] = useState(false)
  const [entTrust, setEntTrust] = useState<{
    families: string[]
    remaining_netsec_ms: number
    remaining_shell_ms: number
  } | null>(null)

  useEffect(() => {
    setAbortSentAt(null)
    setAbortUnconfirmed(false)
  }, [task?.taskId])

  useEffect(() => {
    if (abortSentAt === null || !task || task.abortAcked) return
    const t = setTimeout(() => setAbortUnconfirmed(true), ABORT_ACK_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [abortSentAt, task, task?.abortAcked])

  // Plan A G8: poll enterprise session trust status for active thread
  useEffect(() => {
    const tid = state.activeThreadId
    if (!tid) {
      setEntTrust(null)
      return
    }
    const pull = () => {
      chrome.runtime.sendMessage(
        { type: "enterprise.session_trust.status", thread_id: tid },
        (resp: any) => {
          if (chrome.runtime.lastError || !resp?.grant) {
            setEntTrust(null)
            return
          }
          setEntTrust({
            families: resp.grant.families || [],
            remaining_netsec_ms: resp.grant.remaining_netsec_ms || 0,
            remaining_shell_ms: resp.grant.remaining_shell_ms || 0,
          })
        },
      )
    }
    pull()
    const iv = setInterval(pull, 15_000)
    return () => clearInterval(iv)
  }, [state.activeThreadId, hasConfirm])

  const entActive =
    entTrust &&
    ((entTrust.remaining_netsec_ms > 0 && entTrust.families.includes("netsec")) ||
      (entTrust.remaining_shell_ms > 0 && entTrust.families.includes("shell")))

  const unattendedArmed = state.unattended?.armed === true
  const cruiseLabel = trustStatusChip(
    {
      auto_approve_dangerous: state.config.auto_approve_dangerous === true,
      auto_approve_enterprise_tools: state.config.auto_approve_enterprise_tools === true,
      allow_all_schemes: state.config.allow_all_schemes === true,
    },
    unattendedArmed,
  )
  const cruiseActive = cruiseLabel != null

  if (!task && !hasConfirm && !entActive && !cruiseActive) return null

  const disarmCruise = () => {
    // 急停 ≠ 解除：must clear process grant + restore cruise dual-write
    chrome.runtime.sendMessage({ type: "security.unattended.disarm", clear_cruise: true })
    chrome.runtime.sendMessage({ type: "config.set", config: disarmAllFlags() })
  }

  const finished = task?.status === "finished"
  const live = task && !finished
  const confirmOnly = !task && hasConfirm
  // C2: abort acked while 值守 still armed → prominent 「值守仍开」 (not bare「已急停…」)
  const abortWhileArmed =
    !!(task?.abortAcked && !finished && unattendedArmed)
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

  const abortAckLabel =
    abortWhileArmed ? (
      <span style={styles.estopArmed} title="急停只停任务；桌面值守 grant 与巡航旗仍在">
        任务已停 · 值守仍开 · 点解除
        <button type="button" style={styles.estopDisarmBtn} onClick={disarmCruise}>
          解除
        </button>
      </span>
    ) : (
      <span style={styles.meta}>已急停…</span>
    )

  // FocusBand compact: single TaskChip + 急停 row (confirm path owned by FocusBand P0).
  if (compact) {
    return (
      <div style={styles.wrapCompact}>
        <div style={styles.chipCompact}>
          <span style={styles.iconBubbleCompact}>
            <IconMonitor
              size={12}
              style={{
                color: live
                  ? tokens.darkLive
                  : confirmOnly
                    ? tokens.darkDanger
                    : tokens.darkMuted,
              }}
            />
          </span>
          <span style={styles.live}>
            {live && <span style={styles.liveDot} title="进行中" />}
            {task?.task
              ? ellipsize(task.task, 28)
              : hasConfirm
                ? "待确认操作"
                : "Computer Use"}
          </span>
          {progressText && <span style={styles.meta}>{progressText}</span>}
          {task && !finished && !task.abortAcked && (
            <button type="button" style={styles.abortBtnCompact} onClick={sendAbort} title="急停">
              <IconStop size={11} />
              急停
            </button>
          )}
          {task?.abortAcked && !finished && abortAckLabel}
          <button
            type="button"
            style={styles.openBtnCompact}
            onClick={() => chrome.runtime.sendMessage({ type: "cockpit.open" })}
            title="打开确认台：完整预览 / 白名单 / 确认码；关闭窗口不会停止任务"
          >
            确认台
            <IconExternal size={11} />
          </button>
        </div>
        {/* Defensive only: FocusBand priority (§4.3) should open compact
            SafetyStrip only for primary=l2_safety (no pending confirm). If
            hasConfirm is true here, render MiniConfirm so 急停 row still fits
            the 80px budget — not the normal Confirm path (that is FocusBand P0). */}
        {hasConfirm && <MinimalConfirm compact />}
      </div>
    )
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.chip}>
        <span style={styles.iconBubble}>
          <IconMonitor
            size={14}
            style={{ color: live ? tokens.darkLive : confirmOnly ? tokens.darkDanger : tokens.darkMuted }}
          />
        </span>
        <span style={styles.live}>
          {live && (
            <span style={styles.liveDot} title="进行中" />
          )}
          {task?.task
            ? ellipsize(task.task, 36)
            : hasConfirm
              ? "待确认操作"
              : "Computer Use"}
        </span>
        {progressText && <span style={styles.meta}>{progressText}</span>}
        {task && !finished && !task.abortAcked && (
          <button type="button" style={styles.abortBtn} onClick={sendAbort} title="急停">
            <IconStop size={12} />
            急停
          </button>
        )}
        {task?.abortAcked && !finished && abortAckLabel}
        <button
          type="button"
          style={styles.openBtn}
          onClick={() => chrome.runtime.sendMessage({ type: "cockpit.open" })}
          title="打开确认台：完整预览 / 白名单 / 确认码；关闭窗口不会停止任务"
        >
          确认台
          <IconExternal size={12} />
        </button>
      </div>
      {abortUnconfirmed && task && !task.abortAcked && !finished && (
        <div style={styles.warn}>急停未确认 — 可用 Ctrl+Alt+End</div>
      )}
      {abortWhileArmed && (
        <div style={styles.estopBanner} role="status">
          <span>任务已停 · 值守仍开 · 点解除</span>
          <button type="button" style={styles.entRevoke} onClick={disarmCruise} title="解除桌面值守并关闭巡航旗">
            解除
          </button>
        </div>
      )}
      {cruiseActive && cruiseLabel && !abortWhileArmed && (
        <div style={styles.entChip}>
          <span title={"运行自主度已武装；解除将关闭网页/企业/协议三类自动批准"}>
            {cruiseLabel}
          </span>
          <button type="button" style={styles.entRevoke} onClick={disarmCruise} title="关闭网页/企业/协议三类自动批准">
            解除
          </button>
        </div>
      )}
      {entActive && entTrust && (
        <div style={styles.entChip}>
          <span>
            企业信任中
            {entTrust.remaining_netsec_ms > 0 && entTrust.families.includes("netsec")
              ? ` · netsec ~${Math.ceil(entTrust.remaining_netsec_ms / 60000)}m`
              : ""}
            {entTrust.remaining_shell_ms > 0 && entTrust.families.includes("shell")
              ? ` · shell ~${Math.ceil(entTrust.remaining_shell_ms / 60000)}m`
              : ""}
          </span>
          <button
            type="button"
            style={styles.entRevoke}
            onClick={() => {
              const tid = state.activeThreadId
              if (!tid) return
              chrome.runtime.sendMessage(
                { type: "enterprise.session_trust.revoke", thread_id: tid },
                () => setEntTrust(null),
              )
            }}
          >
            撤销
          </button>
        </div>
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
  wrapCompact: {
    padding: "4px 10px",
    background: "linear-gradient(180deg, #141820 0%, #0f1115 100%)",
    color: tokens.darkText,
    fontSize: 11,
    fontFamily: tokens.font,
    maxHeight: 56,
    overflow: "hidden",
  },
  chipCompact: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "nowrap",
    minHeight: 28,
  },
  iconBubbleCompact: {
    width: 20,
    height: 20,
    borderRadius: tokens.radiusSm,
    background: tokens.darkElevated,
    border: `1px solid ${tokens.darkBorder}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  abortBtnCompact: {
    background: tokens.darkDangerBg,
    color: tokens.darkDanger,
    border: "1px solid #7f1d1d",
    borderRadius: tokens.radiusSm,
    padding: "2px 8px",
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    flexShrink: 0,
  },
  openBtnCompact: {
    background: "transparent",
    color: tokens.darkAccent,
    border: `1px solid ${tokens.darkBorder}`,
    borderRadius: tokens.radiusSm,
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 500,
    padding: "2px 6px",
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    flexShrink: 0,
  },
  entChip: {
    marginTop: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "5px 8px",
    borderRadius: tokens.radiusSm,
    background: tokens.darkWarningBg,
    color: tokens.darkWarning,
    fontSize: 10,
  },
  entRevoke: {
    border: `1px solid ${tokens.darkBorder}`,
    background: "transparent",
    color: tokens.darkText,
    borderRadius: tokens.radiusSm,
    padding: "2px 8px",
    fontSize: 10,
    cursor: "pointer",
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
  // C2: 急停 ack while 值守 still armed — non-dismiss-easy, action required
  estopArmed: {
    color: tokens.darkDanger,
    fontSize: 10,
    fontWeight: 700,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  estopDisarmBtn: {
    border: "1px solid #7f1d1d",
    background: tokens.darkDangerBg,
    color: tokens.darkDanger,
    borderRadius: tokens.radiusSm,
    padding: "1px 6px",
    fontSize: 10,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  estopBanner: {
    marginTop: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "6px 8px",
    borderRadius: tokens.radiusSm,
    background: tokens.darkDangerBg,
    color: tokens.darkDanger,
    fontSize: 11,
    fontWeight: 700,
    border: "1px solid #7f1d1d",
  },
}
