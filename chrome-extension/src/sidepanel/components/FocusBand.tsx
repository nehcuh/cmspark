// FocusBand — Zone B (UIUX v2 PR3 / §4.3) — #321 PR-2「一条 Now」.
// Single-slot priority: Confirm > L2 Safety+急停 > Coding > Fleet > Thread tools >
// Worker scope > Run busy > L1 Context > Scene. The former standalone bands
// (SceneStatusBar / RunBusyChip / WorkerScopeBar) live here as light rows; dark
// chrome stays exclusive to Confirm/急停. Hard cap ≤80px; 急停 never buried when
// L2 task active.

import { useState, useEffect, type CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import type { CapabilityLevel } from "../types"
import { tokens } from "../ui/tokens"
import { IconStop } from "../ui/icons"
import { MinimalConfirm } from "./MinimalConfirm"
import { SafetyStrip } from "./SafetyStrip"
import { CodingSessionChip } from "./CodingSessionChip"
import { ContextStrip } from "./ContextStrip"
import { FleetStrip } from "./FleetStrip"
import { SceneStatusRow, readSceneStatus } from "./SceneStatusRow"
import {
  FOCUS_BAND_MAX_PX,
  FOCUS_BAND_PRIMARY_MAX_PX,
  FOCUS_BAND_SECONDARY_MAX_PX,
  classifyFleetActivity,
  resolveFocusBandSlot,
  sceneChipsSecondary,
  type FocusBandSlot,
} from "./focus-band-priority"
import {
  collectRunningTools,
  formatRunningToolsLabel,
} from "../utils/running-tools"
import { resolveParentThreadId } from "../utils/thread-busy"
import { useScopedRunBusy } from "../hooks/use-scoped-run-busy"

export {
  FOCUS_BAND_MAX_PX,
  FOCUS_BAND_PRIMARY_MAX_PX,
  FOCUS_BAND_SECONDARY_MAX_PX,
  resolveFocusBandSlot,
  sceneChipsSecondary,
  fleetStripShouldShow,
  classifyFleetActivity,
  fleetProcessingLabel,
} from "./focus-band-priority"

export function FocusBand({
  capabilityLevel,
}: {
  capabilityLevel: CapabilityLevel
}) {
  const { state, dispatch } = useAgentStore()
  const scoped = useScopedRunBusy()
  const task = state.computerTask
  const hasPendingConfirm = state.pendingSecurityConfirmations.length > 0
  const hasL2Task = !!task
  const l2AbortRequired =
    !!task &&
    !task.abortAcked &&
    (task.status === "running" || task.status === "paused")
  // Paused-only zombie workers must not steal FocusBand as「舰队运行中」.
  // Also: foreign residual workers of other sessions must not steal FocusBand.
  const hasFleetActivity =
    classifyFleetActivity({
      workerCount: scoped.workerCount,
      lockCount: scoped.lockCount,
      openIntents: scoped.openIntents,
      worstStatus: scoped.worstStatus,
    }) === "active"
  const isBrowserContext = capabilityLevel === "browser"
  // #au4dch ST-4: long tools must surface in FocusBand (not only chat footer).
  const runningTools = collectRunningTools(state.messages)
  const hasThreadTools = runningTools.length > 0
  const toolsLabel = formatRunningToolsLabel(runningTools)

  const coding = state.codingSession
  // Keep chip after close so 追问 / 应用 diff CTAs remain reachable (manager emits state=closed, not handback)
  const hasCodingSession =
    !!coding &&
    (coding.state === "running" ||
      coding.state === "offered" ||
      coding.state === "handback" ||
      coding.state === "closed")

  // #321 PR-2「一条 Now」inputs — former standalone bands.
  const scene = readSceneStatus(state)
  const hasScene =
    !!scene.packId || !!scene.workspaceRoot || scene.surfaceLabel != null
  const activeThread = state.threads.find((t) => t.id === state.activeThreadId)
  const hasWorkerScope = activeThread?.agent_role === "worker"
  const hasRunBusy = scoped.runBusy

  const slot: FocusBandSlot = resolveFocusBandSlot({
    hasPendingConfirm,
    hasL2Task,
    l2AbortRequired,
    hasFleetActivity,
    hasThreadTools,
    hasCodingSession,
    isBrowserContext,
    hasThreadMessages: state.messages.length > 0,
    hasWorkerScope,
    hasRunBusy,
    hasScene,
  })

  const sceneAsSecondary = sceneChipsSecondary(slot, hasScene)

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
            {slot.secondaryTools && coding && (
              <div style={{ marginTop: 4 }} data-coding-session-secondary>
                <CodingSessionChip session={coding} compact />
              </div>
            )}
          </div>
        )}
        {slot.primary === "coding_session" && coding && (
          <div style={styles.primary} data-coding-session-chip>
            <CodingSessionChip session={coding} />
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
        {slot.primary === "worker_scope" && activeThread && (
          <div style={styles.primary}>
            <WorkerScopeLine
              activeThread={activeThread}
              workerRoleLabel={activeThread.worker_role_label}
              alias={activeThread.alias}
            />
          </div>
        )}
        {slot.primary === "run_busy" && scoped.runBusyLabel && (
          <div style={styles.primary}>
            <RunBusyLine
              label={scoped.runBusyLabel}
              onOpen={() => dispatch({ type: "SET_FLEET_LIST_OPEN", open: true })}
            />
          </div>
        )}
        {slot.primary === "l1_context" && (
          <div style={styles.primary}>
            <ContextStrip compact />
          </div>
        )}
        {slot.primary === "scene" && <SceneStatusRow />}
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
        {sceneAsSecondary && <SceneStatusRow secondary />}
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

/**
 * #321 PR-2: worker breadcrumb row (former WorkerScopeBar) — 返回编排 + role/status.
 * Light tone; legacy data-worker-scope-bar attribute preserved.
 */
function WorkerScopeLine({
  activeThread,
  workerRoleLabel,
  alias,
}: {
  activeThread: {
    id: string
    parent_thread_id?: string | null
    orchestrator_run_id?: string | null
  }
  workerRoleLabel?: string | null
  alias?: string | null
}) {
  const { state, dispatch } = useAgentStore()
  const fleetRow = state.fleet?.workers?.find((w) => w.id === activeThread.id)
  const orchestratorForRun =
    state.fleet?.workers?.find(
      (w) =>
        w.agent_role === "orchestrator" &&
        w.orchestrator_run_id &&
        w.orchestrator_run_id === activeThread.orchestrator_run_id,
    )?.id ||
    state.threads.find(
      (t) =>
        t.agent_role === "orchestrator" &&
        t.orchestrator_run_id === activeThread.orchestrator_run_id,
    )?.id ||
    null

  const parentId = resolveParentThreadId({
    activeParentId: activeThread.parent_thread_id,
    fleetParentId: fleetRow?.parent_thread_id,
    orchestratorIdForRun: orchestratorForRun,
  })

  const role = workerRoleLabel || alias || activeThread.id.slice(0, 8)
  const status = fleetRow?.status
  const statusLabel =
    status === "holding_tabs"
      ? "持锁中"
      : status === "paused"
        ? "已暂停"
        : fleetRow?.llm_active || state.threadBusyById[activeThread.id]
          ? "处理中"
          : "空闲"
  const tabHint = fleetRow?.tab_locks?.length
    ? ` · tab ${fleetRow.tab_locks.map((t) => t.tab_id).join(",")}`
    : ""

  const goBack = () => {
    if (parentId) {
      dispatch({ type: "SET_ACTIVE_THREAD", threadId: parentId })
      chrome.runtime.sendMessage({ type: "thread.select", threadId: parentId })
    }
  }

  return (
    <div style={styles.workerRow} data-worker-scope-bar>
      <button
        type="button"
        style={styles.workerBack}
        onClick={goBack}
        disabled={!parentId}
        title={parentId ? "返回编排" : "无父线程"}
      >
        ← 返回编排
      </button>
      <span style={styles.workerMeta}>
        ⚙️ {role} · {statusLabel}
        {tabHint}
      </span>
    </div>
  )
}

/**
 * #321 PR-2: run-busy row (former RunBusyChip) — light chip, opens fleet list.
 */
function RunBusyLine({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      style={styles.runBusyRow}
      onClick={onOpen}
      title="查看子任务"
    >
      <span style={styles.runBusyDot} aria-hidden />
      <span style={styles.runBusyText}>{label}</span>
      <span style={styles.runBusyCta}>查看</span>
    </button>
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

/** Shared floating card shell (G3 inset ≤80px) — instrument hairline, not pill. */
const cardShell: CSSProperties = {
  maxHeight: FOCUS_BAND_MAX_PX,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  borderRadius: tokens.radiusLg,
  boxShadow: tokens.shadowSm,
}

const styles: Record<string, CSSProperties> = {
  /**
   * Horizontal float only (G3). Keep vertical pad minimal so outer+card
   * footprint stays near FOCUS_BAND_MAX_PX (dual-review footprint nit).
   * Phase 1: shared horizontal padding 12 with shell.
   */
  outer: {
    flexShrink: 0,
    padding: "2px 12px 0",
  },
  cardConfirm: {
    ...cardShell,
    background: tokens.dangerSurface,
    border: `1px solid ${tokens.dangerBorder}`,
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
    border: `1px solid ${tokens.dangerDeep}`,
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
    color: tokens.textMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  /** #321 PR-2 worker breadcrumb — light row inside the light card. */
  workerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 10px",
    minHeight: 24,
    maxHeight: 28,
    fontFamily: tokens.font,
    fontSize: 11,
    overflow: "hidden",
  },
  workerBack: {
    border: "none",
    background: "transparent",
    color: tokens.accent,
    cursor: "pointer",
    fontSize: 11,
    padding: "0 2px",
    flexShrink: 0,
    fontWeight: 600,
    fontFamily: tokens.font,
  },
  workerMeta: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.textMuted,
  },
  /** #321 PR-2 run-busy — light chip row (full-width button inside the card). */
  runBusyRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    border: "none",
    background: "transparent",
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: tokens.font,
    fontSize: 11,
    color: tokens.text,
    minHeight: 24,
    maxHeight: 28,
    boxSizing: "border-box",
  },
  runBusyDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    background: tokens.warning,
    flexShrink: 0,
  },
  runBusyText: {
    flex: 1,
    textAlign: "left",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.textMuted,
  },
  runBusyCta: {
    color: tokens.accent,
    fontWeight: 600,
    flexShrink: 0,
  },
}
