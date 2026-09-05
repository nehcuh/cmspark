// FocusBand state machine (UIUX v2 §4.3) — pure priority resolution.
// Priority: Confirm > L2 Safety+急停 > Fleet > Thread tools (ST-4) > L1 Context > empty.
// #321 PR-2「一条 Now」: SceneStatusBar / RunBusyChip / WorkerScopeBar merged as new
// lowest primaries — Worker scope > Run busy > L1 Context > Scene. Scene never darkens
// the band and never beats an attention state (Confirm / L2 own the band unchanged).
// Hard cap: one primary (≤56px) + optional secondary (≤24px) = ≤80px total.

export const FOCUS_BAND_MAX_PX = 80
export const FOCUS_BAND_PRIMARY_MAX_PX = 56
export const FOCUS_BAND_SECONDARY_MAX_PX = 24

/** Primary slot content — only one wins. */
export type FocusBandPrimary =
  | "confirm"
  | "l2_safety"
  | "coding_session"
  | "fleet"
  | "thread_tools"
  | "worker_scope"
  | "run_busy"
  | "l1_context"
  | "scene"
  | "empty"

export interface FocusBandInput {
  /** Any pending security confirmation (MinimalConfirm owns chrome). */
  hasPendingConfirm: boolean
  /**
   * L2 computer task that should surface Safety chrome (task present).
   * 急停 is required when task is running/paused (see l2AbortRequired).
   */
  hasL2Task: boolean
  /** running | paused — 急停 must stay visible (hard rule 1). */
  l2AbortRequired: boolean
  /**
   * Multi-worker / locks / board intents only.
   * Pending confirms must NOT force fleet visibility (§4.3 rule 2).
   */
  hasFleetActivity: boolean
  /**
   * #au4dch ST-4: any tool_call with status===running in the active thread.
   * Surfaces long shell_exec / tool loops in FocusBand, not only chat footer.
   */
  hasThreadTools?: boolean
  /**
   * 编程接力 ACP live session (Composition). Below L2 CU (急停优先), above Fleet.
   */
  hasCodingSession?: boolean
  /** L1 browser surface — ContextStrip when nothing higher. */
  isBrowserContext: boolean
  /**
   * Thread has user/assistant messages. Empty L1 must not hang the webpage
   * strip (S1.1 / C″). Confirm / 急停 / L2 / fleet / tools ignore this.
   * Default true so callers that omit it keep the work-state L1 strip.
   */
  hasThreadMessages?: boolean
  /**
   * #321 PR-2: active thread IS a worker — breadcrumb row (返回编排 + role/status).
   * Below thread_tools (own-thread activity), above run_busy / L1 context.
   */
  hasWorkerScope?: boolean
  /**
   * #321 PR-2: scoped run-busy (children running / locks / board intents) with
   * nothing higher on the band. Always a light chip — dark is for Confirm/急停 only.
   */
  hasRunBusy?: boolean
  /**
   * #321 PR-2: mission pack / workspace / tool-surface attached (ambient context).
   * Never breaks idle visually (light chip) and never beats L1 context; surfaces
   * alone as the scene row when the band would otherwise be empty.
   */
  hasScene?: boolean
}

export interface FocusBandSlot {
  primary: FocusBandPrimary
  /**
   * When confirm is primary and L2 task needs abort: render secondary 急停 line
   * so Confirm never buries 急停 (D10′ / hard rule 1).
   */
  secondaryAbort: boolean
  /**
   * Optional one-line L1 context under confirm when browser + no L2 abort secondary
   * (wireframe §5.5). Mutually exclusive with secondaryAbort under height budget.
   */
  secondaryContext: boolean
  /**
   * Secondary line for running tools under confirm/fleet when height allows
   * (no abort secondary).
   */
  secondaryTools: boolean
}

/**
 * Resolve FocusBand single-slot priority.
 * Highest wins: Confirm → L2 Safety → Coding → Fleet → Thread tools →
 * Worker scope → Run busy → L1 Context → Scene → empty.
 */
export function resolveFocusBandSlot(input: FocusBandInput): FocusBandSlot {
  const hasTools = input.hasThreadTools === true
  const showL1Context = input.isBrowserContext && input.hasThreadMessages !== false
  if (input.hasPendingConfirm) {
    // Confirm owns primary. 急停 secondary when L2 task active (never bury abort).
    // Tools secondary only when no abort secondary (height budget).
    // Webpage strip stays off on empty L1 (S1.1) even under confirm.
    return {
      primary: "confirm",
      secondaryAbort: input.l2AbortRequired,
      secondaryContext: showL1Context && !input.l2AbortRequired && !hasTools,
      secondaryTools: hasTools && !input.l2AbortRequired,
    }
  }
  if (input.hasL2Task) {
    // CU owns primary (急停); surface coding stop as secondaryTools line when ACP also live
    return {
      primary: "l2_safety",
      secondaryAbort: false,
      secondaryContext: false,
      secondaryTools: input.hasCodingSession === true,
    }
  }
  // Confirm > CU L2 > coding session > fleet (急停 never buried under coding)
  if (input.hasCodingSession) {
    return {
      primary: "coding_session",
      secondaryAbort: false,
      secondaryContext: false,
      secondaryTools: false,
    }
  }
  if (input.hasFleetActivity) {
    return {
      primary: "fleet",
      secondaryAbort: false,
      secondaryContext: false,
      secondaryTools: hasTools,
    }
  }
  if (hasTools) {
    return {
      primary: "thread_tools",
      secondaryAbort: false,
      secondaryContext: false,
      secondaryTools: false,
    }
  }
  // #321 PR-2「一条 Now」tier — ambient activity/nav, all light tone.
  if (input.hasWorkerScope) {
    return {
      primary: "worker_scope",
      secondaryAbort: false,
      secondaryContext: false,
      secondaryTools: false,
    }
  }
  if (input.hasRunBusy) {
    return {
      primary: "run_busy",
      secondaryAbort: false,
      secondaryContext: false,
      secondaryTools: false,
    }
  }
  if (showL1Context) {
    return {
      primary: "l1_context",
      secondaryAbort: false,
      secondaryContext: false,
      secondaryTools: false,
    }
  }
  if (input.hasScene) {
    // Scene alone keeps the band alive as a quiet light chip (绝不隐藏场景名).
    return {
      primary: "scene",
      secondaryAbort: false,
      secondaryContext: false,
      secondaryTools: false,
    }
  }
  return {
    primary: "empty",
    secondaryAbort: false,
    secondaryContext: false,
    secondaryTools: false,
  }
}

/**
 * #321 PR-2: whether the scene chips render as the ≤24px secondary row under a
 * light primary. Decision table: attention 态场景让位（Confirm / L2 + 急停 own the
 * whole 80px — 「绝不隐藏场景名」按 §1.1 指挂场景 idle 与轻 primary 档：scene 为主行、
 * fleet/L1/worker/run_busy 下搭次行）；已占用的次行（abort / tools）同样优先。
 * Scene never displaces them, it rides along or waits.
 */
export function sceneChipsSecondary(
  slot: FocusBandSlot,
  hasScene: boolean,
): boolean {
  if (!hasScene) return false
  if (slot.primary === "scene") return false
  if (slot.primary === "confirm" || slot.primary === "l2_safety") return false
  if (slot.secondaryAbort || slot.secondaryTools) return false
  return true
}

/**
 * Fleet liveness for chrome (FocusBand / ChatView processingLabel).
 * - active: locks, open intents, holding_tabs, or non-paused workers (idle)
 * - paused_only: workers exist but all paused and no locks/intents (zombie)
 * - none: empty fleet
 *
 * Zombie paused workers must NOT show as「舰队运行中」or steal FocusBand.
 */
export type FleetActivityKind = "none" | "active" | "paused_only"

export function classifyFleetActivity(input: {
  workerCount: number
  lockCount: number
  openIntents: number
  /** From fleet.worst_status when available */
  worstStatus?: string | null
}): FleetActivityKind {
  if (input.lockCount > 0 || input.openIntents > 0) return "active"
  if (input.worstStatus === "holding_tabs" || input.worstStatus === "idle") return "active"
  if (input.workerCount > 0 && input.worstStatus === "paused") return "paused_only"
  // Missing worstStatus but workers present → treat as active (fail open for visibility)
  if (input.workerCount > 0) return "active"
  return "none"
}

/**
 * Side-panel processingLabel for fleet (null = hide).
 * Paused-only zombies: no nag label (user cleans via 确认台 / 全停 when strip shown).
 */
export function fleetProcessingLabel(input: {
  workerCount: number
  lockCount: number
  openIntents: number
  worstStatus?: string | null
}): string | null {
  const kind = classifyFleetActivity(input)
  if (kind === "none") return null
  if (kind === "paused_only") {
    // Soft hint only if caller wants it; default ChatView passes showPausedHint=false via null.
    return null
  }
  if (input.workerCount > 0) return `舰队运行中 · ${input.workerCount} worker`
  if (input.lockCount > 0) return `舰队持锁 · ${input.lockCount} 锁`
  if (input.openIntents > 0) return `舰队 · ${input.openIntents} intent 未关闭`
  return "舰队运行中"
}

/** Optional muted label when only paused workers remain (settings / expanded strip). */
export function fleetPausedOnlyLabel(workerCount: number): string {
  return `舰队已暂停 · ${workerCount} worker`
}

/** Fleet strip visibility — multi-agent only; pending confirms excluded. */
export function fleetStripShouldShow(input: {
  workerCount: number
  lockCount: number
  openIntents: number
  worstStatus?: string | null
  expanded?: boolean
  /**
   * When true, show strip even for paused_only zombies so operator can 全停.
   * Default false: hide auto-chrome for paused-only (confirm center still lists fleet).
   */
  showPausedOnly?: boolean
}): boolean {
  if (input.expanded) return true
  const kind = classifyFleetActivity(input)
  if (kind === "active") return true
  if (kind === "paused_only" && input.showPausedOnly) return true
  return false
}
