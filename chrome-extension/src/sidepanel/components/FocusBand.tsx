// FocusBand — Zone B (UIUX v2 PR3 / §4.3)
// Single-slot priority: Confirm > L2 Safety+急停 > Fleet > L1 Context.
// Hard cap ≤80px; 急停 never buried when L2 task active.

import { useState, useEffect } from "react"
import { useAgentStore } from "../store/agentStore"
import type { CapabilityLevel } from "../types"
import { tokens } from "../ui/tokens"
import { IconStop } from "../ui/icons"
import { MinimalConfirm } from "./MinimalConfirm"
import { SafetyStrip } from "./SafetyStrip"
import { ContextStrip } from "./ContextStrip"
import { FleetStrip } from "./FleetStrip"
import {
  FOCUS_BAND_MAX_PX,
  FOCUS_BAND_SECONDARY_MAX_PX,
  resolveFocusBandSlot,
  type FocusBandSlot,
} from "./focus-band-priority"

export {
  FOCUS_BAND_MAX_PX,
  FOCUS_BAND_PRIMARY_MAX_PX,
  FOCUS_BAND_SECONDARY_MAX_PX,
  resolveFocusBandSlot,
  fleetStripShouldShow,
} from "./focus-band-priority"

export function FocusBand({
  capabilityLevel,
}: {
  capabilityLevel: CapabilityLevel
}) {
  const { state } = useAgentStore()
  const task = state.computerTask
  const hasPendingConfirm = state.pendingSecurityConfirmations.length > 0
  const hasL2Task = !!task
  const l2AbortRequired =
    !!task &&
    !task.abortAcked &&
    (task.status === "running" || task.status === "paused")
  const fleet = state.fleet
  const hasFleetActivity =
    (fleet?.worker_count ?? 0) > 0 ||
    (fleet?.lock_count ?? 0) > 0 ||
    (fleet?.open_intent_count ?? 0) > 0
  const isBrowserContext = capabilityLevel === "browser"

  const slot: FocusBandSlot = resolveFocusBandSlot({
    hasPendingConfirm,
    hasL2Task,
    l2AbortRequired,
    hasFleetActivity,
    isBrowserContext,
  })

  if (slot.primary === "empty") return null

  const darkChrome =
    slot.primary === "confirm" ||
    slot.primary === "l2_safety" ||
    slot.secondaryAbort

  return (
    <div
      style={{
        ...styles.wrap,
        background: darkChrome ? tokens.darkBg : "transparent",
        borderBottom: darkChrome
          ? `1px solid ${tokens.darkBorder}`
          : `1px solid ${tokens.border}`,
      }}
      data-focus-band
      data-primary={slot.primary}
      role="region"
      aria-label="焦点条"
    >
      {slot.secondaryAbort && (
        <AbortSecondaryLine taskId={task!.taskId} taskLabel={task?.task} />
      )}
      {slot.primary === "confirm" && (
        <div style={styles.primary}>
          {/* Confirm owns allow/deny; secondaryAbort keeps 急停 visible under L2. */}
          <MinimalConfirm compact />
        </div>
      )}
      {slot.primary === "l2_safety" && (
        <div style={styles.primary}>
          <SafetyStrip compact />
        </div>
      )}
      {slot.primary === "fleet" && (
        <div style={styles.primary}>
          <FleetStrip focusBand />
        </div>
      )}
      {slot.primary === "l1_context" && (
        <div style={styles.primary}>
          <ContextStrip compact />
        </div>
      )}
      {slot.secondaryContext && slot.primary === "confirm" && (
        <div style={styles.secondaryContext}>
          <ContextStrip compact secondary />
        </div>
      )}
    </div>
  )
}

/** Secondary ≤24px 急停 row — Confirm does not bury abort (hard rule 1). */
function AbortSecondaryLine({
  taskId,
  taskLabel,
}: {
  taskId: string
  taskLabel?: string
}) {
  const [sent, setSent] = useState(false)

  useEffect(() => {
    setSent(false)
  }, [taskId])

  const sendAbort = () => {
    chrome.runtime.sendMessage({ type: "computer.task.abort", task_id: taskId })
    setSent(true)
  }

  return (
    <div style={styles.abortLine} data-focus-band-abort>
      <span style={styles.abortLabel} title={taskLabel || "Computer Use"}>
        {taskLabel ? ellipsize(taskLabel, 28) : "Computer Use"}
      </span>
      {!sent ? (
        <button
          type="button"
          style={styles.abortBtn}
          onClick={sendAbort}
          title="急停"
        >
          <IconStop size={11} />
          急停
        </button>
      ) : (
        <span style={styles.abortMeta}>已急停…</span>
      )}
    </div>
  )
}

function ellipsize(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    maxHeight: FOCUS_BAND_MAX_PX,
    overflow: "hidden",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
  },
  primary: {
    flexShrink: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  abortLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: FOCUS_BAND_SECONDARY_MAX_PX,
    maxHeight: FOCUS_BAND_SECONDARY_MAX_PX,
    padding: "0 10px",
    background: tokens.darkElevated,
    borderBottom: `1px solid ${tokens.darkBorder}`,
    fontFamily: tokens.font,
    fontSize: 11,
    color: tokens.darkText,
    flexShrink: 0,
  },
  abortLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 600,
    fontSize: 10,
    color: tokens.darkMuted,
  },
  abortBtn: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    background: tokens.darkDangerBg,
    color: tokens.darkDanger,
    border: "1px solid #7f1d1d",
    borderRadius: tokens.radiusSm,
    padding: "1px 8px",
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: tokens.font,
    height: 20,
  },
  abortMeta: {
    flexShrink: 0,
    fontSize: 10,
    color: tokens.darkMuted,
  },
  secondaryContext: {
    maxHeight: FOCUS_BAND_SECONDARY_MAX_PX,
    overflow: "hidden",
    flexShrink: 0,
  },
}
