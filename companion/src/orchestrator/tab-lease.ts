// Process-wide exclusive tab lease registry — ADR-015 §3
// Authoritative gate lives in Companion createToolExecutor.

import { ORCHESTRATOR_CAPS } from "./constants"
import { appendCapabilityAudit } from "../packs/audit-log"

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
}

export type LeaseErrorCode =
  | "TAB_LOCKED"
  | "TAB_BUSY_CONFIRMING"
  | "TAB_ID_REQUIRED"
  | "TAB_LEASE_CAP"
  | "TAB_FORCE_RELEASING"

export type LeaseResult =
  | { ok: true; lease: TabLease }
  | { ok: false; error_code: LeaseErrorCode; tab_id?: number; holder_thread_id?: string; error: string }

const leases = new Map<number, TabLease>()

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

/** Drop expired HARD/SOFT leases when no pending tools (caller enforces pending). */
export function sweepExpired(opts?: {
  hasPendingForTab?: (tabId: number, holderThreadId: string) => boolean
}): void {
  const t = now()
  for (const [tabId, lease] of [...leases.entries()]) {
    if (lease.state === "FORCE_RELEASING") continue
    if (lease.state === "SOFT_RESERVED" && lease.softDeadline && t > lease.softDeadline) {
      leases.delete(tabId)
      audit("tab.lease.soft_expired", { tab_id: tabId, holder_thread_id: lease.holderThreadId })
      continue
    }
    if (lease.state === "HARD_HELD" || lease.state === "HELD_PENDING_L2") {
      const idleOrHard = t > lease.idleDeadline || t > lease.hardMaxDeadline
      if (!idleOrHard) continue
      if (opts?.hasPendingForTab?.(tabId, lease.holderThreadId)) {
        // ADR: do not free while in-flight — mark FORCE_RELEASING
        lease.state = "FORCE_RELEASING"
        leases.set(tabId, lease)
        audit("tab.lease.expire_blocked_pending", {
          tab_id: tabId,
          holder_thread_id: lease.holderThreadId,
        })
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
}): LeaseResult {
  sweepExpired()
  const { tabId, holderThreadId, needsL2, confirmId } = opts
  if (!Number.isFinite(tabId)) {
    return { ok: false, error_code: "TAB_ID_REQUIRED", error: "tabId is required and must be a number" }
  }

  const existing = leases.get(tabId)

  if (!existing) {
    if (countLeasesForHolder(holderThreadId) >= ORCHESTRATOR_CAPS.max_tabs_leased_per_worker) {
      return {
        ok: false,
        error_code: "TAB_LEASE_CAP",
        tab_id: tabId,
        error: `worker already holds ${ORCHESTRATOR_CAPS.max_tabs_leased_per_worker} tab leases`,
      }
    }
    if (activeLeaseCount() >= ORCHESTRATOR_CAPS.max_tabs_leased_process) {
      return {
        ok: false,
        error_code: "TAB_LEASE_CAP",
        tab_id: tabId,
        error: `process tab lease cap ${ORCHESTRATOR_CAPS.max_tabs_leased_process} reached`,
      }
    }
    if (needsL2) {
      const t = now()
      const lease: TabLease = {
        tabId,
        state: "SOFT_RESERVED",
        holderThreadId,
        confirmId,
        acquiredAt: t,
        renewedAt: t,
        hardMaxDeadline: t + ORCHESTRATOR_CAPS.hard_max_lease_ms,
        idleDeadline: t + ORCHESTRATOR_CAPS.idle_ttl_ms,
        softDeadline: t + 45_000,
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
      existing.renewedAt = now()
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
      existing.state = "HELD_PENDING_L2"
      existing.confirmId = confirmId
      existing.renewedAt = now()
      // do not advance idle while pending L2
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

/** After L2 approve: promote SOFT/HELD_PENDING_L2 → HARD_HELD for holder. */
export function hardReacquireAfterConfirm(opts: {
  tabId: number
  holderThreadId: string
  confirmId?: string
}): LeaseResult {
  sweepExpired()
  const existing = leases.get(opts.tabId)
  if (!existing) {
    return acquireOrRenewTabLease({
      tabId: opts.tabId,
      holderThreadId: opts.holderThreadId,
      needsL2: false,
    })
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
