// FocusBand — Zone B (UIUX v2 PR3 / §4.3)
// Single-slot priority: Confirm > L2 Safety+急停 > Fleet > L1 Context.
// Hard cap ≤80px; 急停 never buried when L2 task active.

import { useState, useEffect, type CSSProperties } from "react"
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
  FOCUS_BAND_PRIMARY_MAX_PX,
  FOCUS_BAND_SECONDARY_MAX_PX,
  classifyFleetActivity,
  resolveFocusBandSlot,
  type FocusBandSlot,
} from "./focus-band-priority"
import {
  collectRunningTools,
  formatRunningToolsLabel,
} from "../utils/running-tools"
import { buildScopedRunBusyInput } from "../utils/thread-busy"

export {
  FOCUS_BAND_MAX_PX,
  FOCUS_BAND_PRIMARY_MAX_PX,
  FOCUS_BAND_SECONDARY_MAX_PX,
  resolveFocusBandSlot,
  fleetStripShouldShow,
  classifyFleetActivity,
  fleetProcessingLabel,
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
  const activeId = state.activeThreadId
  const activeThread = state.threads.find((t) => t.id === activeId)
  const scopedFleet = buildScopedRunBusyInput({
    active: activeThread
      ? {
          id: activeThread.id,
          agent_role: activeThread.agent_role,
          parent_thread_id: activeThread.parent_thread_id,
          orchestrator_run_id: activeThread.orchestrator_run_id,
        }
      : activeId
        ? { id: activeId }
        : null,
    workers: fleet?.workers || [],
    locks: fleet?.locks,
    openIntentCount: fleet?.open_intent_count,
    openIntentsByRun: fleet?.open_intents_by_run,
    llmActiveThreadIds: fleet?.llm_active_thread_ids,
  })
  const scopedWorst = scopedFleet.scopedWorkers.some((w) => w.status === "holding_tabs")
    ? "holding_tabs"
    : scopedFleet.scopedWorkers.some((w) => w.status === "paused")
      ? "paused"
      : scopedFleet.scopedWorkers.length > 0
        ? "idle"
        : "none"
  // Paused-only zombie workers must not steal FocusBand as「舰队运行中」.
  // Also: foreign residual workers of other sessions must not steal FocusBand.
  const hasFleetActivity =
    classifyFleetActivity({
      workerCount: scopedFleet.workerCount,
      lockCount: scopedFleet.runBusyInput.lockCount,
      openIntents: scopedFleet.runBusyInput.openIntents,
      worstStatus: scopedWorst,
    }) === "active"
  const isBrowserContext = capabilityLevel === "browser"
  // #au4dch ST-4: long tools must surface in FocusBand (not only chat footer).
  const runningTools = collectRunningTools(state.messages)
  const hasThreadTools = runningTools.length > 0
  const toolsLabel = formatRunningToolsLabel(runningTools)

  const slot: FocusBandSlot = resolveFocusBandSlot({
    hasPendingConfirm,
    hasL2Task,
    l2AbortRequired,
    hasFleetActivity,
    hasThreadTools,
    isBrowserContext,
  })

  if (slot.primary === "empty") return null

  // G3: floating card chrome — soft confirm surface vs elevated L2/fleet/context
  const cardTone: "confirm" | "dark" | "light" =
    slot.primary === "confirm"
      ? "confirm"
      : slot.primary === "l2_safety" || slot.secondaryAbort
        ? "dark"
        : "light"

  const cardStyle =
    cardTone === "confirm"
      ? styles.cardConfirm
      : cardTone === "dark"
        ? styles.cardDark
        : styles.cardLight

  return (
    <div style={styles.outer} data-focus-band data-primary={slot.primary}>
      <div
        style={cardStyle}
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
        {slot.primary === "thread_tools" && toolsLabel && (
          <div style={styles.primary} data-focus-band-tools>
            <ThreadToolsLine label={toolsLabel} />
          </div>
        )}
        {slot.primary === "l1_context" && (
          <div style={styles.primary}>
            <ContextStrip compact />
          </div>
        )}
        {slot.secondaryTools && toolsLabel && (
          <div style={styles.secondaryTools} data-focus-band-tools-secondary>
            {toolsLabel}
          </div>
        )}
        {slot.secondaryContext && slot.primary === "confirm" && (
          <div style={styles.secondaryContext}>
            <ContextStrip compact secondary />
          </div>
        )}
      </div>
    </div>
  )
}

/** Primary or secondary one-line active tools (ST-4). */
function ThreadToolsLine({ label }: { label: string }) {
  return (
    <div style={styles.toolsLine} title={label}>
      <span style={styles.toolsDot} aria-hidden />
      <span style={styles.toolsText}>{label}</span>
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

/** Shared floating card shell (G3 inset ≤80px). */
const cardShell: CSSProperties = {
  maxHeight: FOCUS_BAND_MAX_PX,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  borderRadius: 16,
  boxShadow: tokens.shadowMd,
}

const styles: Record<string, CSSProperties> = {
  /**
   * Horizontal float only (G3). Keep vertical pad minimal so outer+card
   * footprint stays near FOCUS_BAND_MAX_PX (dual-review footprint nit).
   */
  outer: {
    flexShrink: 0,
    padding: "2px 10px 0",
  },
  cardConfirm: {
    ...cardShell,
    background: tokens.dangerSurface,
    border: "1px solid rgba(220, 38, 38, 0.28)",
  },
  cardDark: {
    ...cardShell,
    background: tokens.darkElevated,
    border: `1px solid ${tokens.darkBorder}`,
  },
  cardLight: {
    ...cardShell,
    background: tokens.bgElevated,
    border: `1px solid ${tokens.borderStrong}`,
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
    background: tokens.darkBg,
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
  toolsLine: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    minHeight: 28,
    maxHeight: FOCUS_BAND_PRIMARY_MAX_PX,
  },
  toolsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    background: tokens.warning,
    flexShrink: 0,
  },
  toolsText: {
    fontSize: 12,
    fontWeight: 500,
    color: tokens.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  secondaryTools: {
    flexShrink: 0,
    maxHeight: FOCUS_BAND_SECONDARY_MAX_PX,
    padding: "2px 10px 6px",
    fontSize: 11,
    color: tokens.textMuted || "#888",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
}
