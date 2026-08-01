// FocusBand state machine (UIUX v2 §4.3) — pure priority resolution.
// Priority: Confirm > L2 Safety+急停 > Fleet > L1 Context > empty.
// Hard cap: one primary (≤56px) + optional secondary (≤24px) = ≤80px total.

export const FOCUS_BAND_MAX_PX = 80
export const FOCUS_BAND_PRIMARY_MAX_PX = 56
export const FOCUS_BAND_SECONDARY_MAX_PX = 24

/** Primary slot content — only one wins. */
export type FocusBandPrimary =
  | "confirm"
  | "l2_safety"
  | "fleet"
  | "l1_context"
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
  /** L1 browser surface — ContextStrip when nothing higher. */
  isBrowserContext: boolean
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
}

/**
 * Resolve FocusBand single-slot priority.
 * Highest wins: Confirm → L2 Safety → Fleet → L1 Context → empty.
 */
export function resolveFocusBandSlot(input: FocusBandInput): FocusBandSlot {
  if (input.hasPendingConfirm) {
    // Confirm owns primary. 急停 secondary when L2 task active (never bury abort).
    // Context secondary only when no abort secondary (height budget).
    return {
      primary: "confirm",
      secondaryAbort: input.l2AbortRequired,
      secondaryContext: input.isBrowserContext && !input.l2AbortRequired,
    }
  }
  if (input.hasL2Task) {
    return {
      primary: "l2_safety",
      secondaryAbort: false,
      secondaryContext: false,
    }
  }
  if (input.hasFleetActivity) {
    return {
      primary: "fleet",
      secondaryAbort: false,
      secondaryContext: false,
    }
  }
  if (input.isBrowserContext) {
    return {
      primary: "l1_context",
      secondaryAbort: false,
      secondaryContext: false,
    }
  }
  return {
    primary: "empty",
    secondaryAbort: false,
    secondaryContext: false,
  }
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
