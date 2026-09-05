// L-4 (#390) loop status line + suggestion card — in-transcript form (no new
// panel, no new confirm dialect). Renders companion task_loop.status frames
// VERBATIM: derivation (phase/label/detail/tier) is companion SoT; the only
// local composition is the awaiting_confirm elevation from
// pendingSecurityConfirmations and the loop_state backfill on panel reopen.
//
// #397 MAJOR-2: `done` shows companion copy「计划完成，待你确认」— never
// 「任务已完成」(machine-tier completion needs the user's eye, not a trophy).

import type { CSSProperties } from "react"
import type { LoopStatusView, Thread } from "../types"
import { tokens } from "../ui/tokens"

/**
 * Panel-reopen backfill: minimal label from thread.loop_state.status alone.
 * Mirrors companion loop-status.ts STOP_LABEL — status frames are the live SoT.
 */
const BACKFILL_LABEL: Record<string, string> = {
  completed: "计划完成，待你确认",
  stopped_budget: "续跑预算已尽",
  stopped_user: "已停止续跑",
  halt_security: "安全熔断，未自动续跑",
  stopped_no_checklist: "受阻：无机器可核验清单",
}

export function backfillLoopView(thread: Thread | undefined): LoopStatusView | null {
  const ls = thread?.loop_state
  if (!ls || typeof ls.status !== "string" || !ls.status) return null
  if (ls.status === "active") {
    return {
      phase: "advancing",
      label: "续跑推进中",
      detail: "",
      done: 0,
      total: 0,
      tier: "",
      status: "active",
    }
  }
  const phase =
    ls.status === "completed"
      ? "done"
      : ls.status === "halt_security"
        ? "halt"
        : ls.status === "stopped_no_checklist"
          ? "blocked"
          : "stopped"
  return {
    phase,
    label: BACKFILL_LABEL[ls.status] ?? "循环已结束",
    detail: "",
    done: 0,
    total: 0,
    tier: "",
    status: ls.status,
  }
}

type Tone = {
  background: string
  border: string
  color: string
}

/** Per-phase tone — same soft-surface ladder as fakeEnd / compact banners. */
function phaseTone(phase: LoopStatusView["phase"]): Tone {
  if (phase === "awaiting_confirm" || phase === "blocked") {
    return {
      background: tokens.warningSoft,
      border: tokens.warningBorder,
      color: tokens.warningText,
    }
  }
  if (phase === "impossible" || phase === "halt") {
    return {
      background: tokens.dangerSoft,
      border: tokens.dangerBorder,
      color: tokens.danger,
    }
  }
  if (phase === "stopped") {
    return {
      background: tokens.bgMuted,
      border: tokens.border,
      color: tokens.textSecondary,
    }
  }
  // advancing / rerouting / done — accent family
  return {
    background: tokens.accentSoft,
    border: tokens.accentBorderSoft,
    color: tokens.accentText,
  }
}

const ELEVATED_AWAITING: LoopStatusView = {
  phase: "awaiting_confirm",
  label: "等待确认",
  detail: "工具调用待你确认，续跑暂停中",
  done: 0,
  total: 0,
  tier: "",
  status: "active",
}

/**
 * 停止续跑 payload — ≠ 急停桌面（computer.task.abort 走另一条总线）。
 * Falls stopped_user (paused semantics); re-arm is an explicit gesture only.
 */
export function loopStopMessage(threadId: string) {
  return {
    type: "task_loop.stop" as const,
    thread_id: threadId,
    user_gesture: true,
  }
}

/** Suggestion-card arm payload — the click IS the explicit activation gesture. */
export function loopArmMessage(threadId: string, budgetStopped: boolean) {
  return {
    type: "task_loop.arm" as const,
    thread_id: threadId,
    source: "suggestion_card" as const,
    user_gesture: true,
    ...(budgetStopped ? { resume: true } : {}),
  }
}

/**
 * Loop status line. `pendingConfirms > 0` locally elevates an in-flight
 * advancing/rerouting phase to awaiting_confirm (display-level only — the
 * companion's confirm algebra is untouched).
 */
export function LoopStatusRow({
  view,
  threadId,
  pendingConfirms,
}: {
  view: LoopStatusView
  threadId: string
  pendingConfirms: number
}) {
  const elevated =
    pendingConfirms > 0 && (view.phase === "advancing" || view.phase === "rerouting")
  const shown = elevated
    ? { ...ELEVATED_AWAITING, tier: view.tier, done: view.done, total: view.total }
    : view
  const tone = phaseTone(shown.phase)
  const showStop = shown.status === "active"

  const onStop = () => {
    // 停止续跑 ≠ 急停桌面（computer.task.abort）：落 stopped_user（paused 语义），
    // re-arm 只能显式手势。用户手动停，companion 不再自动续。
    chrome.runtime.sendMessage(loopStopMessage(threadId))
  }

  return (
    <div
      data-testid="loop-status-row"
      data-loop-phase={shown.phase}
      style={{ ...styles.row, background: tone.background, borderColor: tone.border, color: tone.color }}
    >
      <div style={styles.rowMain}>
        <span style={styles.label}>{shown.label}</span>
        {shown.tier ? <span style={styles.tierChip}>{shown.tier}</span> : null}
      </div>
      {shown.detail ? <div style={styles.detail}>{shown.detail}</div> : null}
      {showStop ? (
        <button type="button" style={styles.stopBtn} onClick={onStop}>
          停止续跑
        </button>
      ) : null}
    </div>
  )
}

/**
 * Non-blocking suggestion card「要继续做完吗？」(companion task_loop.suggest).
 * The card itself does nothing — the CLICK is the explicit arm gesture
 * (task_loop.arm, source=suggestion_card), so activation is always user-sent.
 */
export function LoopSuggestCard({
  threadId,
  unticked,
  budgetStopped,
  onDismiss,
}: {
  threadId: string
  unticked: Array<{ id: string; text: string }>
  budgetStopped: boolean
  onDismiss: () => void
}) {
  const onArm = () => {
    chrome.runtime.sendMessage(loopArmMessage(threadId, budgetStopped))
  }

  return (
    <div data-testid="loop-suggest-card" style={styles.card}>
      <div style={styles.cardHead}>
        <span style={styles.cardTitle}>
          {budgetStopped ? "续跑预算已尽——要继续做完吗？" : "要继续做完吗？"}
        </span>
        <button
          type="button"
          aria-label="不再提示"
          style={styles.dismissBtn}
          onClick={onDismiss}
        >
          ✕
        </button>
      </div>
      <div style={styles.cardList}>
        {unticked.map((it) => (
          <div key={it.id} style={styles.cardItem}>
            · {it.text}
          </div>
        ))}
      </div>
      <div style={styles.cardFoot}>
        <span style={styles.cardHint}>点按即激活续跑 · 沿用当前巡航档与确认规则</span>
        <button type="button" style={styles.armBtn} onClick={onArm}>
          继续做完
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    width: "100%",
    border: `1px solid`,
    borderRadius: tokens.radiusMd,
    padding: "8px 10px",
    fontSize: 12,
    lineHeight: 1.45,
    boxSizing: "border-box",
  },
  rowMain: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: "1 1 auto",
    minWidth: 0,
  },
  label: { fontWeight: 600 },
  tierChip: {
    fontSize: 10,
    opacity: 0.85,
    border: "1px solid currentColor",
    borderRadius: tokens.radiusPill,
    padding: "0 6px",
    whiteSpace: "nowrap",
  },
  detail: { width: "100%", fontSize: 11, opacity: 0.85, wordBreak: "break-word" },
  stopBtn: {
    flex: "0 0 auto",
    border: `1px solid ${tokens.border}`,
    background: tokens.bg,
    color: tokens.textSecondary,
    borderRadius: tokens.radiusSm,
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  card: {
    width: "100%",
    border: `1px solid ${tokens.warningBorder}`,
    background: tokens.warningSoft,
    borderRadius: tokens.radiusMd,
    padding: "8px 10px",
    fontSize: 12,
    boxSizing: "border-box",
  },
  cardHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  cardTitle: { fontWeight: 600, color: tokens.warningText },
  dismissBtn: {
    border: "none",
    background: "transparent",
    color: tokens.textMuted,
    fontSize: 11,
    cursor: "pointer",
    padding: "0 2px",
    fontFamily: "inherit",
    lineHeight: 1,
  },
  cardList: { margin: "6px 0", display: "flex", flexDirection: "column", gap: 2 },
  cardItem: {
    fontSize: 11,
    color: tokens.warningText,
    opacity: 0.9,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardFoot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  cardHint: { fontSize: 10, color: tokens.textSecondary },
  armBtn: {
    flex: "0 0 auto",
    border: "none",
    background: tokens.accent,
    color: "#ffffff",
    borderRadius: tokens.radiusSm,
    padding: "4px 10px",
    fontSize: 11,
    cursor: "pointer",
    fontFamily: "inherit",
  },
}
