// #513 fleet trigger surface — advisory suggestion state (process memory only).
//
// The propose tool is pure advice: it never spawns, never arms, never mutates a
// thread. This module holds the ONLY state that flow needs — a per-thread
// dismissal silence window (user said no) and a propose throttle (model called
// twice) — both in memory by design (spec §7): a companion restart re-runs the
// prompt criteria on the next run, which is the honest reset.

export const FLEET_SUGGEST_SILENCE_MS = 10 * 60_000
export const FLEET_SUGGEST_THROTTLE_MS = 60_000

const dismissedAt = new Map<string, number>()
const lastProposeAt = new Map<string, number>()

/** Panel sent fleet.suggest.dismiss (user clicked 不用 or accepted — both silence). */
export function recordFleetSuggestDismiss(threadId: string, now: number = Date.now()): void {
  if (!threadId) return
  dismissedAt.set(threadId, now)
}

export type FleetSuggestGate =
  | { ok: true }
  | { ok: false; reason: "suppressed" | "throttled" }

/**
 * Decide whether a propose may surface. Sets the throttle stamp only when
 * allowed — a suppressed/throttled call never extends either window.
 */
export function fleetSuggestGate(threadId: string, now: number = Date.now()): FleetSuggestGate {
  if (!threadId) return { ok: false, reason: "suppressed" }
  const dismissed = dismissedAt.get(threadId)
  if (dismissed !== undefined && now - dismissed < FLEET_SUGGEST_SILENCE_MS) {
    return { ok: false, reason: "suppressed" }
  }
  const last = lastProposeAt.get(threadId)
  if (last !== undefined && now - last < FLEET_SUGGEST_THROTTLE_MS) {
    return { ok: false, reason: "throttled" }
  }
  lastProposeAt.set(threadId, now)
  return { ok: true }
}

/** Test isolation only — production never clears per-thread state. */
export function clearFleetSuggestState(threadId?: string): void {
  if (threadId === undefined) {
    dismissedAt.clear()
    lastProposeAt.clear()
    return
  }
  dismissedAt.delete(threadId)
  lastProposeAt.delete(threadId)
}
