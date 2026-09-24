// Process-wide exclusive tab lease registry — ADR-015 §3
// Authoritative gate lives in Companion createToolExecutor.

import { ORCHESTRATOR_CAPS } from "./constants"
import { appendCapabilityAudit } from "../packs/audit-log"
import { DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS } from "../security-confirmation"

export type LeaseState =
  | "FREE"
  | "SOFT_RESERVED"
  | "HELD_PENDING_L2"
  | "HARD_HELD"
  | "FORCE_RELEASING"

export interface TabLease {
  tabId: number
  state: LeaseState
  holderThreadId: string
  confirmId?: string
  acquiredAt: number
  renewedAt: number
  hardMaxDeadline: number
  idleDeadline: number
  softDeadline?: number
  /** When state entered FORCE_RELEASING (for bounded GC). */
  forceReleasingAt?: number
  /** In-flight mutation calls for this holder. 0 on episode/outbound leases. */
  mutationHolds: number
  /** Worker/orchestrator create_tab hold deadline. null when none. */
  createdHoldUntil: number | null
}

export type LeaseErrorCode =
  | "TAB_LOCKED"
  | "TAB_BUSY_CONFIRMING"
  | "TAB_ID_REQUIRED"
  | "TAB_LEASE_CAP"
  | "TAB_FORCE_RELEASING"
  | "POST_CONFIRM_CANCELLED"

export type LeaseResult =
  | { ok: true; lease: TabLease }
  | { ok: false; error_code: LeaseErrorCode; tab_id?: number; holder_thread_id?: string; error: string }

const leases = new Map<number, TabLease>()

/**
 * Soft exclusivity covers confirm only (L2 admission is acquired *before* SOFT).
 * Base = Confirm Center timeout; +skew so SOFT cannot expire mid-dialog when the
 * soft clock starts slightly before securityConfirmations.request's timer.
 */
export const SOFT_LEASE_SKEW_MS = 2_000
export const SOFT_LEASE_MS = DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS + SOFT_LEASE_SKEW_MS

/** Max age of FORCE_RELEASING before forced free (bounded GC). */
export const FORCE_RELEASING_GC_MS = 30_000

type PendingHooks = {
  hasPendingForTab: (tabId: number, holderThreadId: string) => boolean
  /** Reject CDP pending for tab/holder; return count rejected. */
  rejectPendingForTab?: (tabId: number, holderThreadId: string, reason: string) => number
  /**
   * Optional: true if Confirm Center still has a live dialog for this soft hold.
   * Prefer confirmId match; fall back to holderThreadId worker stamp.
   */
  hasPendingConfirmation?: (confirmId: string | undefined, holderThreadId: string) => boolean
  /**
   * Delete timed_out_in_flight entries for this tab/holder without resolving
   * the caller (it already failed). Does not FREE the lease.
   */
  discardTimedOutForTab?: (tabId: number, holderThreadId: string) => number
}

/** Module-level pending hooks so *every* sweepExpired path respects in-flight CDP. */
let pendingHooks: PendingHooks | null = null

/**
 * Register pending-tool predicates once from server bootstrap.
 * Required: all internal sweepExpired calls must never FREE a tab while CDP is in flight.
 */
export function registerTabLeasePendingHooks(hooks: PendingHooks): void {
  pendingHooks = hooks
}

/** True when production hooks have been registered (tests re-register after reset). */
export function tabLeasePendingHooksRegistered(): boolean {
  return pendingHooks != null
}

function now(): number {
  return Date.now()
}

function audit(type: string, extra: Record<string, unknown>): void {
  try {
    appendCapabilityAudit({
      type,
      at: new Date().toISOString(),
      ...extra,
    })
  } catch {
    /* best-effort */
  }
}

function resolveHasPending(
  tabId: number,
  holderThreadId: string,
  opts?: { hasPendingForTab?: (tabId: number, holderThreadId: string) => boolean },
): boolean {
  const fn = opts?.hasPendingForTab ?? pendingHooks?.hasPendingForTab
  // Fail-closed when hooks unregistered: treat as pending so cold-start / test
  // reset without re-register never silent-FREEs under in-flight CDP.
  if (!fn) return true
  try {
    return !!fn(tabId, holderThreadId)
  } catch {
    // Fail closed: treat as pending so we never silent-FREE under uncertainty
    return true
  }
}

function drainPendingAndFree(
  tabId: number,
  lease: TabLease,
  reason: string,
): void {
  const rejector = pendingHooks?.rejectPendingForTab
  let rejected = 0
  if (rejector) {
    try {
      rejected = rejector(tabId, lease.holderThreadId, reason) || 0
    } catch {
      /* best-effort */
    }
  }
  leases.delete(tabId)
  audit("tab.lease.force_released", {
    tab_id: tabId,
    holder_thread_id: lease.holderThreadId,
    reason,
    rejected_pending: rejected,
  })
}

type SweepOpts = {
  hasPendingForTab?: (tabId: number, holderThreadId: string) => boolean
}

/** Outbound episode leases keep today's idle-drain and hard_max behavior. */
function sweepOutboundLease(tabId: number, lease: TabLease, t: number, opts?: SweepOpts): void {
  if (lease.state === "FORCE_RELEASING") {
    const since = lease.forceReleasingAt ?? lease.renewedAt
    if (t > since + FORCE_RELEASING_GC_MS) {
      drainPendingAndFree(tabId, lease, "force_releasing_gc")
    }
    return
  }
  if (lease.state === "SOFT_RESERVED" && lease.softDeadline && t > lease.softDeadline) {
    if (keepSoftForLiveConfirm(tabId, lease, t)) return
    leases.delete(tabId)
    audit("tab.lease.soft_expired", { tab_id: tabId, holder_thread_id: lease.holderThreadId })
    return
  }
  if (lease.state !== "HARD_HELD" && lease.state !== "HELD_PENDING_L2") return
  if (lease.state === "HELD_PENDING_L2") {
    const coverUntil = t + DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS + SOFT_LEASE_SKEW_MS
    if (lease.idleDeadline < coverUntil) {
      lease.idleDeadline = coverUntil
      leases.set(tabId, lease)
    }
    if (t <= lease.hardMaxDeadline) return
  }
  const idleOrHard = t > lease.idleDeadline || t > lease.hardMaxDeadline
  if (!idleOrHard) return
  if (resolveHasPending(tabId, lease.holderThreadId, opts)) {
    if (pendingHooks?.rejectPendingForTab) {
      drainPendingAndFree(
        tabId,
        lease,
        t > lease.hardMaxDeadline ? "hard_max_pending_drain" : "idle_ttl_pending_drain",
      )
    } else {
      lease.state = "FORCE_RELEASING"
      lease.forceReleasingAt = t
      leases.set(tabId, lease)
      audit("tab.lease.expire_blocked_pending", {
        tab_id: tabId,
        holder_thread_id: lease.holderThreadId,
      })
    }
    return
  }
  leases.delete(tabId)
  audit("tab.lease.expired", {
    tab_id: tabId,
    holder_thread_id: lease.holderThreadId,
    reason: t > lease.hardMaxDeadline ? "hard_max" : "idle_ttl",
  })
}

function keepSoftForLiveConfirm(tabId: number, lease: TabLease, t: number): boolean {
  if (!pendingHooks?.hasPendingConfirmation) return false
  try {
    if (pendingHooks.hasPendingConfirmation(lease.confirmId, lease.holderThreadId)) {
      lease.softDeadline = t + SOFT_LEASE_SKEW_MS
      leases.set(tabId, lease)
      return true
    }
  } catch {
    lease.softDeadline = t + SOFT_LEASE_SKEW_MS
    leases.set(tabId, lease)
    return true
  }
  return false
}

/**
 * Absolute cap: drop tombstones without resolving, reject live pending, then FREE.
 * createdHoldUntil and mutationHolds do not survive hard_max.
 */
function freeAtHardMax(tabId: number, lease: TabLease, opts?: SweepOpts): void {
  const discard = pendingHooks?.discardTimedOutForTab
  if (discard) {
    try {
      discard(tabId, lease.holderThreadId)
    } catch {
      /* best-effort */
    }
  }
  if (resolveHasPending(tabId, lease.holderThreadId, opts)) {
    if (pendingHooks?.rejectPendingForTab) {
      drainPendingAndFree(tabId, lease, "hard_max_pending_drain")
    } else {
      lease.state = "FORCE_RELEASING"
      lease.forceReleasingAt = now()
      leases.set(tabId, lease)
      audit("tab.lease.expire_blocked_pending", {
        tab_id: tabId,
        holder_thread_id: lease.holderThreadId,
      })
    }
    return
  }
  leases.delete(tabId)
  audit("tab.lease.expired", {
    tab_id: tabId,
    holder_thread_id: lease.holderThreadId,
    reason: "hard_max",
  })
}

/** Per-call leases: idle does not drain in-flight work. hard_max still does. */
function sweepPerCallLease(tabId: number, lease: TabLease, t: number, opts?: SweepOpts): void {
  if (lease.state === "FORCE_RELEASING") {
    const since = lease.forceReleasingAt ?? lease.renewedAt
    if (t > since + FORCE_RELEASING_GC_MS) {
      drainPendingAndFree(tabId, lease, "force_releasing_gc")
    }
    return
  }
  if (lease.state === "SOFT_RESERVED" && lease.softDeadline && t > lease.softDeadline) {
    if (keepSoftForLiveConfirm(tabId, lease, t)) return
    leases.delete(tabId)
    audit("tab.lease.soft_expired", { tab_id: tabId, holder_thread_id: lease.holderThreadId })
    return
  }
  if (lease.state !== "HARD_HELD" && lease.state !== "HELD_PENDING_L2") return
  if (lease.state === "HELD_PENDING_L2") {
    const coverUntil = t + DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS + SOFT_LEASE_SKEW_MS
    if (lease.idleDeadline < coverUntil) {
      lease.idleDeadline = coverUntil
      leases.set(tabId, lease)
    }
    if (lease.createdHoldUntil != null && t >= lease.createdHoldUntil) {
      lease.createdHoldUntil = null
      leases.set(tabId, lease)
    }
    if (t <= lease.hardMaxDeadline) return
  }
  let createExpired = false
  if (lease.createdHoldUntil != null && t >= lease.createdHoldUntil) {
    lease.createdHoldUntil = null
    createExpired = true
    leases.set(tabId, lease)
  }
  if (t > lease.hardMaxDeadline) {
    freeAtHardMax(tabId, lease, opts)
    return
  }
  const pending = resolveHasPending(tabId, lease.holderThreadId, opts)
  const holds = lease.mutationHolds ?? 0
  if (holds > 0 || pending) return
  if (lease.createdHoldUntil != null && lease.createdHoldUntil > t) return
  if (!createExpired && t <= lease.idleDeadline) return
  leases.delete(tabId)
  audit("tab.lease.expired", {
    tab_id: tabId,
    holder_thread_id: lease.holderThreadId,
    reason: createExpired ? "created_hold" : "idle_ttl",
  })
}

/**
 * Drop expired HARD/SOFT leases when no pending tools.
 * Outbound episode leases keep idle-drain. Other holders do not idle-drain
 * while a mutation is in flight or a create_tab hold is still live.
 */
export function sweepExpired(opts?: SweepOpts): void {
  const t = now()
  for (const [tabId, lease] of [...leases.entries()]) {
    if (isOutboundLeaseHolder(lease.holderThreadId)) {
      sweepOutboundLease(tabId, lease, t, opts)
    } else {
      sweepPerCallLease(tabId, lease, t, opts)
    }
  }
}

function countLeasesForHolder(holderThreadId: string): number {
  let n = 0
  for (const l of leases.values()) {
    if (l.holderThreadId === holderThreadId && l.state !== "FREE") n++
  }
  return n
}

function heldTabIdsForHolder(holderThreadId: string): number[] {
  const ids: number[] = []
  for (const l of leases.values()) {
    if (l.holderThreadId === holderThreadId && l.state !== "FREE") ids.push(l.tabId)
  }
  return ids.sort((a, b) => a - b)
}

function activeLeaseCount(): number {
  return leases.size
}

function isOutboundLeaseHolder(holderThreadId: string): boolean {
  return holderThreadId.startsWith("outbound_mcp:")
}

function makeHard(tabId: number, holderThreadId: string, base?: Partial<TabLease>): TabLease {
  const t = now()
  return {
    tabId,
    state: "HARD_HELD",
    holderThreadId,
    acquiredAt: base?.acquiredAt ?? t,
    renewedAt: t,
    hardMaxDeadline: base?.hardMaxDeadline ?? t + ORCHESTRATOR_CAPS.hard_max_lease_ms,
    idleDeadline: t + ORCHESTRATOR_CAPS.idle_ttl_ms,
    confirmId: undefined,
    softDeadline: undefined,
    forceReleasingAt: undefined,
    mutationHolds: base?.mutationHolds ?? 0,
    createdHoldUntil: base?.createdHoldUntil ?? null,
  }
}

/**
 * Acquire or renew exclusive lease for a tab-targeted tool.
 * @param needsL2 when true and free: SOFT_RESERVED (exclusive). When already HARD same holder: HELD_PENDING_L2.
 */
export function acquireOrRenewTabLease(opts: {
  tabId: number
  holderThreadId: string
  needsL2: boolean
  confirmId?: string
  /** Override soft TTL (ms from now). Default SOFT_LEASE_MS (= confirm timeout). */
  softTtlMs?: number
}): LeaseResult {
  sweepExpired()
  const { tabId, holderThreadId, needsL2, confirmId } = opts
  if (!Number.isFinite(tabId)) {
    return { ok: false, error_code: "TAB_ID_REQUIRED", error: "tabId is required and must be a number" }
  }

  const existing = leases.get(tabId)

  if (!existing) {
    if (countLeasesForHolder(holderThreadId) >= ORCHESTRATOR_CAPS.max_tabs_leased_per_worker) {
      const held = heldTabIdsForHolder(holderThreadId)
      return {
        ok: false,
        error_code: "TAB_LEASE_CAP",
        tab_id: tabId,
        holder_thread_id: holderThreadId,
        error:
          `TAB_LEASE_CAP: worker already holds ${ORCHESTRATOR_CAPS.max_tabs_leased_per_worker} tab leases ` +
          `(tabs [${held.join(", ")}]). close_tab one of those tabs (or list_tab_locks) before leasing tab ${tabId}`,
      }
    }
    if (activeLeaseCount() >= ORCHESTRATOR_CAPS.max_tabs_leased_process) {
      return {
        ok: false,
        error_code: "TAB_LEASE_CAP",
        tab_id: tabId,
        error:
          `TAB_LEASE_CAP: process tab lease cap ${ORCHESTRATOR_CAPS.max_tabs_leased_process} reached — ` +
          `close unused tabs or force-release a lease before leasing tab ${tabId}`,
      }
    }
    if (needsL2) {
      const t = now()
      const softMs = opts.softTtlMs ?? SOFT_LEASE_MS
      const lease: TabLease = {
        tabId,
        state: "SOFT_RESERVED",
        holderThreadId,
        confirmId,
        acquiredAt: t,
        renewedAt: t,
        hardMaxDeadline: t + ORCHESTRATOR_CAPS.hard_max_lease_ms,
        idleDeadline: t + ORCHESTRATOR_CAPS.idle_ttl_ms,
        softDeadline: t + softMs,
        mutationHolds: 0,
        createdHoldUntil: null,
      }
      leases.set(tabId, lease)
      audit("tab.lease.soft_reserved", { tab_id: tabId, holder_thread_id: holderThreadId, confirm_id: confirmId })
      return { ok: true, lease }
    }
    const lease = makeHard(tabId, holderThreadId)
    leases.set(tabId, lease)
    audit("tab.lease.hard_acquired", { tab_id: tabId, holder_thread_id: holderThreadId })
    return { ok: true, lease }
  }

  if (existing.state === "FORCE_RELEASING") {
    return {
      ok: false,
      error_code: "TAB_FORCE_RELEASING",
      tab_id: tabId,
      holder_thread_id: existing.holderThreadId,
      error: `tab ${tabId} is force-releasing; wait`,
    }
  }

  if (existing.holderThreadId !== holderThreadId) {
    const code: LeaseErrorCode =
      existing.state === "SOFT_RESERVED" ? "TAB_BUSY_CONFIRMING" : "TAB_LOCKED"
    return {
      ok: false,
      error_code: code,
      tab_id: tabId,
      holder_thread_id: existing.holderThreadId,
      error: `tab ${tabId} held by ${existing.holderThreadId} (${existing.state})`,
    }
  }

  // Same holder
  if (existing.state === "SOFT_RESERVED") {
    if (needsL2) {
      // still waiting confirm — renew soft deadline lightly
      const softMs = opts.softTtlMs ?? SOFT_LEASE_MS
      existing.renewedAt = now()
      existing.softDeadline = now() + softMs
      if (confirmId) existing.confirmId = confirmId
      leases.set(tabId, existing)
      return { ok: true, lease: existing }
    }
    // promote without L2 path shouldn't happen mid-soft; treat as hard re-acquire
    const hard = makeHard(tabId, holderThreadId, existing)
    leases.set(tabId, hard)
    return { ok: true, lease: hard }
  }

  if (existing.state === "HARD_HELD" || existing.state === "HELD_PENDING_L2") {
    if (needsL2) {
      const t = now()
      existing.state = "HELD_PENDING_L2"
      existing.confirmId = confirmId
      existing.renewedAt = t
      // Time cover for confirm duration: freeze idle so mid-dialog TTL cannot FREE
      const cover = t + DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS + SOFT_LEASE_SKEW_MS
      if (existing.idleDeadline < cover) existing.idleDeadline = cover
      leases.set(tabId, existing)
      audit("tab.lease.held_pending_l2", { tab_id: tabId, holder_thread_id: holderThreadId })
      return { ok: true, lease: existing }
    }
    // renew hard
    existing.state = "HARD_HELD"
    existing.renewedAt = now()
    existing.idleDeadline = now() + ORCHESTRATOR_CAPS.idle_ttl_ms
    existing.confirmId = undefined
    leases.set(tabId, existing)
    return { ok: true, lease: existing }
  }

  return {
    ok: false,
    error_code: "TAB_LOCKED",
    tab_id: tabId,
    holder_thread_id: existing.holderThreadId,
    error: `unexpected lease state ${existing.state}`,
  }
}

/**
 * After L2 approve: promote SOFT/HELD_PENDING_L2 → HARD_HELD for holder.
 * GATE2: never re-HARD a FREE tab after cancel (no free-path steal).
 * Missing lease → POST_CONFIRM_CANCELLED (zombie approve / cancel race).
 */
export function hardReacquireAfterConfirm(opts: {
  tabId: number
  holderThreadId: string
  confirmId?: string
}): LeaseResult {
  sweepExpired()
  const existing = leases.get(opts.tabId)
  if (!existing) {
    // Cancel / soft expire / force-release already freed the tab — refuse promote.
    return {
      ok: false,
      error_code: "POST_CONFIRM_CANCELLED",
      tab_id: opts.tabId,
      error:
        "POST_CONFIRM_CANCELLED: tab lease gone after confirm (cancel/stop/expire); refusing free-path hard promote",
    }
  }
  if (existing.holderThreadId !== opts.holderThreadId) {
    return {
      ok: false,
      error_code: "TAB_LOCKED",
      tab_id: opts.tabId,
      holder_thread_id: existing.holderThreadId,
      error: `post-confirm TAB_LOCKED: held by ${existing.holderThreadId}`,
    }
  }
  if (existing.state === "SOFT_RESERVED" || existing.state === "HELD_PENDING_L2" || existing.state === "HARD_HELD") {
    const hard = makeHard(opts.tabId, opts.holderThreadId, {
      acquiredAt: existing.acquiredAt,
      hardMaxDeadline: existing.hardMaxDeadline,
      mutationHolds: existing.mutationHolds,
      createdHoldUntil: existing.createdHoldUntil,
    })
    leases.set(opts.tabId, hard)
    audit("tab.lease.hard_after_confirm", {
      tab_id: opts.tabId,
      holder_thread_id: opts.holderThreadId,
      confirm_id: opts.confirmId,
    })
    return { ok: true, lease: hard }
  }
  return {
    ok: false,
    error_code: "TAB_FORCE_RELEASING",
    tab_id: opts.tabId,
    error: `cannot hard re-acquire from state ${existing.state}`,
  }
}

/** Drop soft reservation (deny/timeout). If HELD_PENDING_L2, return to HARD without releasing. */
export function releaseSoftOrPendingL2(opts: {
  tabId: number
  holderThreadId: string
  confirmId?: string
}): void {
  const existing = leases.get(opts.tabId)
  if (!existing || existing.holderThreadId !== opts.holderThreadId) return
  if (existing.state === "SOFT_RESERVED") {
    leases.delete(opts.tabId)
    audit("tab.lease.soft_released", {
      tab_id: opts.tabId,
      holder_thread_id: opts.holderThreadId,
      confirm_id: opts.confirmId,
    })
    return
  }
  if (existing.state === "HELD_PENDING_L2") {
    existing.state = "HARD_HELD"
    existing.confirmId = undefined
    existing.renewedAt = now()
    leases.set(opts.tabId, existing)
    audit("tab.lease.pending_l2_denied", {
      tab_id: opts.tabId,
      holder_thread_id: opts.holderThreadId,
    })
  }
}

function dropTimedOutPending(tabId: number, holderThreadId: string): void {
  const discard = pendingHooks?.discardTimedOutForTab
  if (!discard) return
  try {
    discard(tabId, holderThreadId)
  } catch {
    /* best-effort */
  }
}

export function releaseTabLease(tabId: number, reason: string, holderThreadId?: string): boolean {
  const existing = leases.get(tabId)
  if (!existing) return false
  if (holderThreadId && existing.holderThreadId !== holderThreadId) return false
  dropTimedOutPending(tabId, existing.holderThreadId)
  leases.delete(tabId)
  audit("tab.lease.released", {
    tab_id: tabId,
    holder_thread_id: existing.holderThreadId,
    reason,
  })
  return true
}

/** +1 at the pregate acquire call site. Not used by renew / L2 reacquire. */
export function noteMutationHold(tabId: number, holderThreadId: string): void {
  const existing = leases.get(tabId)
  if (!existing || existing.holderThreadId !== holderThreadId) return
  existing.mutationHolds = (existing.mutationHolds ?? 0) + 1
  leases.set(tabId, existing)
}

/**
 * −1 for the call that noteMutationHold incremented.
 * FREE only when holds hit 0, no create hold remains, and nothing is pending
 * (including timed_out_in_flight). Outbound holders are ignored.
 */
export function releaseMutationHold(tabId: number, holderThreadId: string): void {
  if (isOutboundLeaseHolder(holderThreadId)) return
  const existing = leases.get(tabId)
  if (!existing || existing.holderThreadId !== holderThreadId) return
  existing.mutationHolds = Math.max(0, (existing.mutationHolds ?? 0) - 1)
  if (existing.createdHoldUntil != null && existing.createdHoldUntil <= now()) {
    existing.createdHoldUntil = null
  }
  leases.set(tabId, existing)
  if (existing.mutationHolds !== 0) return
  if (existing.createdHoldUntil != null) return
  if (resolveHasPending(tabId, holderThreadId)) return
  leases.delete(tabId)
  audit("tab.lease.released", {
    tab_id: tabId,
    holder_thread_id: holderThreadId,
    reason: "mutation_hold_released",
  })
}

/** First successful navigate/set_tab_url by this holder. Does not FREE. */
export function clearCreatedHold(tabId: number, holderThreadId: string): void {
  const existing = leases.get(tabId)
  if (!existing || existing.holderThreadId !== holderThreadId) return
  if (existing.createdHoldUntil == null) return
  existing.createdHoldUntil = null
  leases.set(tabId, existing)
}

/** Worker/orchestrator create_tab: 60s hold and matching idle deadline. */
export function armCreatedTabHold(tabId: number, holderThreadId: string, holdMs: number): void {
  if (isOutboundLeaseHolder(holderThreadId)) return
  const existing = leases.get(tabId)
  if (!existing || existing.holderThreadId !== holderThreadId) return
  const until = now() + holdMs
  existing.createdHoldUntil = until
  existing.idleDeadline = until
  leases.set(tabId, existing)
}

/** Cover a confirm window or phase2 without shortening an already-later idle. */
export function extendLeaseIdle(tabId: number, holderThreadId: string, until: number): void {
  const existing = leases.get(tabId)
  if (!existing || existing.holderThreadId !== holderThreadId) return
  if (existing.idleDeadline >= until) return
  existing.idleDeadline = until
  leases.set(tabId, existing)
}

/**
 * After a timed_out_in_flight entry is deleted and the caller was already failed.
 * Does not FREE outbound episode leases. hard_max does not use this path.
 */
export function settleTimedOutLease(tabId: number, holderThreadId: string | undefined): void {
  if (!holderThreadId || isOutboundLeaseHolder(holderThreadId)) return
  const existing = leases.get(tabId)
  if (!existing || existing.holderThreadId !== holderThreadId) return
  if (resolveHasPending(tabId, holderThreadId)) return
  if (existing.state === "FORCE_RELEASING") {
    completeForceRelease(tabId, "timed_out_settled")
    return
  }
  if ((existing.mutationHolds ?? 0) !== 0) return
  if (existing.createdHoldUntil != null && existing.createdHoldUntil > now()) return
  leases.delete(tabId)
  audit("tab.lease.released", {
    tab_id: tabId,
    holder_thread_id: holderThreadId,
    reason: "timed_out_settled",
  })
}

/**
 * Drop tab leases held by workers that are not inside an LLM run and not
 * paused. Pause does not bulk-free: a create_tab hold or an in-flight mutation
 * stays until its own deadline or that call's finally (ADR-015).
 */
export function releaseIdleWorkerLeases(
  threads: Array<{ id?: string; agent_role?: string; paused?: boolean }>,
  llmActive: ReadonlySet<string>,
): number {
  let n = 0
  for (const t of threads) {
    if (t.agent_role !== "worker" || t.paused) continue
    const id = typeof t.id === "string" ? t.id : ""
    if (!id || llmActive.has(id)) continue
    n += releaseAllLeasesForThread(id, "worker_run_ended")
  }
  return n
}

/**
 * Release all leases for a holder. Prefer `releaseLeasesForThreadPendingAware`
 * on cancel paths when CDP may still be in flight.
 */
export function releaseAllLeasesForThread(holderThreadId: string, reason: string): number {
  let n = 0
  for (const [tabId, lease] of [...leases.entries()]) {
    if (lease.holderThreadId === holderThreadId) {
      dropTimedOutPending(tabId, holderThreadId)
      leases.delete(tabId)
      n++
      audit("tab.lease.released", { tab_id: tabId, holder_thread_id: holderThreadId, reason })
    }
  }
  return n
}

/**
 * Cancel-path lease release: for each held tab with in-flight CDP,
 * FORCE_RELEASING → reject pending → completeForceRelease; otherwise instant free.
 * Call after rejectForWorker so L2 confirm is already denied.
 */
export function releaseLeasesForThreadPendingAware(
  holderThreadId: string,
  reason: string,
  hooks?: {
    hasPendingForTab?: (tabId: number, holderThreadId: string) => boolean
    rejectPendingForTab?: (tabId: number, holderThreadId: string, reason: string) => number
  },
): { released: number; drained: number } {
  let released = 0
  let drained = 0
  for (const [tabId, lease] of [...leases.entries()]) {
    if (lease.holderThreadId !== holderThreadId) continue
    const hasPending = resolveHasPending(tabId, holderThreadId, {
      hasPendingForTab: hooks?.hasPendingForTab,
    })
    if (hasPending) {
      lease.state = "FORCE_RELEASING"
      lease.forceReleasingAt = now()
      leases.set(tabId, lease)
      const rejector = hooks?.rejectPendingForTab ?? pendingHooks?.rejectPendingForTab
      if (rejector) {
        try {
          rejector(tabId, holderThreadId, reason)
        } catch {
          /* best-effort */
        }
      }
      completeForceRelease(tabId, reason)
      drained++
      released++
    } else {
      leases.delete(tabId)
      released++
      audit("tab.lease.released", {
        tab_id: tabId,
        holder_thread_id: holderThreadId,
        reason,
      })
    }
  }
  return { released, drained }
}

/**
 * Force-release a tab lease.
 * When `hasPending` is true (CDP / extension tool still in flight), enter
 * FORCE_RELEASING without FREE — caller must reject pending tools, then call
 * `completeForceRelease` (or forceRelease again with hasPending=false).
 */
export function forceReleaseTab(
  tabId: number,
  by: string,
  opts?: { hasPending?: boolean },
): LeaseResult & { draining?: boolean } {
  const existing = leases.get(tabId)
  if (!existing) {
    return { ok: true, lease: makeHard(tabId, by) } // no-op free
  }
  if (opts?.hasPending) {
    existing.state = "FORCE_RELEASING"
    existing.forceReleasingAt = now()
    leases.set(tabId, existing)
    audit("tab.lease.force_releasing_pending", {
      tab_id: tabId,
      holder_thread_id: existing.holderThreadId,
      by,
    })
    return { ok: true, lease: existing, draining: true }
  }
  // Instant free path (pending already drained by caller)
  leases.delete(tabId)
  audit("tab.lease.force_released", {
    tab_id: tabId,
    holder_thread_id: existing.holderThreadId,
    by,
  })
  return { ok: true, lease: existing }
}

/** Complete a FORCE_RELEASING lease after pending tools are rejected/drained. */
export function completeForceRelease(tabId: number, reason = "drain_complete"): boolean {
  const existing = leases.get(tabId)
  if (!existing) return false
  if (existing.state !== "FORCE_RELEASING") return false
  leases.delete(tabId)
  audit("tab.lease.force_released", {
    tab_id: tabId,
    holder_thread_id: existing.holderThreadId,
    reason,
  })
  return true
}

export function getTabLease(tabId: number): TabLease | null {
  sweepExpired()
  return leases.get(tabId) || null
}

export function listTabLocks(): Array<{
  tab_id: number
  state: LeaseState
  holder_thread_id: string
  renewed_at: number
  idle_deadline: number
  hard_max_deadline: number
  lease_expires_at: number
}> {
  sweepExpired()
  const out = []
  for (const l of leases.values()) {
    out.push({
      tab_id: l.tabId,
      state: l.state,
      holder_thread_id: l.holderThreadId,
      renewed_at: l.renewedAt,
      idle_deadline: l.idleDeadline,
      hard_max_deadline: l.hardMaxDeadline,
      lease_expires_at: Math.min(l.idleDeadline, l.hardMaxDeadline),
    })
  }
  return out
}

export function anyTabLeaseHeld(): boolean {
  sweepExpired()
  return leases.size > 0
}

/** Auto-hold after create_tab for the creating worker. */
export function autoHoldCreatedTab(tabId: number, holderThreadId: string): LeaseResult {
  return acquireOrRenewTabLease({ tabId, holderThreadId, needsL2: false })
}

/** Test-only / process reset. */
export function _resetTabLeasesForTests(): void {
  leases.clear()
  pendingHooks = null
}

export function lockMetaForTab(tabId: number): {
  locked_by_thread_id: string | null
  lease_state: LeaseState | null
  lease_expires_at: number | null
} {
  const l = getTabLease(tabId)
  if (!l) return { locked_by_thread_id: null, lease_state: null, lease_expires_at: null }
  return {
    locked_by_thread_id: l.holderThreadId,
    lease_state: l.state,
    lease_expires_at: Math.min(l.idleDeadline, l.hardMaxDeadline),
  }
}
