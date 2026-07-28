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

/**
 * Drop expired HARD/SOFT leases when no pending tools.
 * Always consults module-level hasPendingForTab (or opts override).
 * Never silent-FREE while CDP pending — reject pending + free, or FORCE_RELEASING + GC.
 */
export function sweepExpired(opts?: {
  hasPendingForTab?: (tabId: number, holderThreadId: string) => boolean
}): void {
  const t = now()
  for (const [tabId, lease] of [...leases.entries()]) {
    if (lease.state === "FORCE_RELEASING") {
      const since = lease.forceReleasingAt ?? lease.renewedAt
      if (t > since + FORCE_RELEASING_GC_MS) {
        // Bounded GC: reject any residual pending and free so peers are not stuck forever
        drainPendingAndFree(tabId, lease, "force_releasing_gc")
      }
      continue
    }
    if (lease.state === "SOFT_RESERVED" && lease.softDeadline && t > lease.softDeadline) {
      // Bind soft expire to live Confirm Center (confirmId and/or worker stamp).
      // Do not FREE mid-dialog if a matching confirmation is still pending.
      if (pendingHooks?.hasPendingConfirmation) {
        try {
          if (pendingHooks.hasPendingConfirmation(lease.confirmId, lease.holderThreadId)) {
            lease.softDeadline = t + SOFT_LEASE_SKEW_MS
            leases.set(tabId, lease)
            continue
          }
        } catch {
          // Fail closed: keep soft while confirmation probe is uncertain
          lease.softDeadline = t + SOFT_LEASE_SKEW_MS
          leases.set(tabId, lease)
          continue
        }
      }
      leases.delete(tabId)
      audit("tab.lease.soft_expired", { tab_id: tabId, holder_thread_id: lease.holderThreadId })
      continue
    }
    if (lease.state === "HARD_HELD" || lease.state === "HELD_PENDING_L2") {
      // HELD_PENDING_L2: freeze idle expiry for confirm duration (soft-style cover)
      if (lease.state === "HELD_PENDING_L2") {
        const coverUntil = t + DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS + SOFT_LEASE_SKEW_MS
        if (lease.idleDeadline < coverUntil) {
          lease.idleDeadline = coverUntil
          leases.set(tabId, lease)
        }
        // Only hard_max can expire HELD_PENDING_L2 while confirm is open
        if (t <= lease.hardMaxDeadline) continue
      }
      const idleOrHard = t > lease.idleDeadline || t > lease.hardMaxDeadline
      if (!idleOrHard) continue
      if (resolveHasPending(tabId, lease.holderThreadId, opts)) {
        // TTL path with in-flight CDP: reject pending + free (or short FORCE_RELEASING if rejector absent)
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
        continue
      }
      leases.delete(tabId)
      audit("tab.lease.expired", {
        tab_id: tabId,
        holder_thread_id: lease.holderThreadId,
        reason: t > lease.hardMaxDeadline ? "hard_max" : "idle_ttl",
      })
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

export function releaseTabLease(tabId: number, reason: string, holderThreadId?: string): boolean {
  const existing = leases.get(tabId)
  if (!existing) return false
  if (holderThreadId && existing.holderThreadId !== holderThreadId) return false
  leases.delete(tabId)
  audit("tab.lease.released", {
    tab_id: tabId,
    holder_thread_id: existing.holderThreadId,
    reason,
  })
  return true
}

/**
 * Release all leases for a holder. Prefer `releaseLeasesForThreadPendingAware`
 * on cancel paths when CDP may still be in flight.
 */
export function releaseAllLeasesForThread(holderThreadId: string, reason: string): number {
  let n = 0
  for (const [tabId, lease] of [...leases.entries()]) {
    if (lease.holderThreadId === holderThreadId) {
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
