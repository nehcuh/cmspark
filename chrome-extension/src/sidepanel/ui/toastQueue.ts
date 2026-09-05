// #321 PR-3: single toast queue with types (info / warning / error).
// Pure logic only — no React, no DOM, no rail-height coupling. The host
// component owns rendering + timers; this module owns queue shape so the
// "burst of 3 never overlaps / never depends on rail height" acceptance is
// unit-testable in isolation.
export type ToastKind = "info" | "warning" | "error"

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

export const TOAST_KINDS: readonly ToastKind[] = ["info", "warning", "error"]

export function isToastKind(v: unknown): v is ToastKind {
  return typeof v === "string" && (TOAST_KINDS as readonly string[]).includes(v)
}

let seq = 0

export function nextToastId(): number {
  seq += 1
  return seq
}

export function makeToast(message: string, kind: ToastKind = "info"): ToastItem {
  return { id: nextToastId(), kind, message }
}

/**
 * Append a toast and keep the queue bounded at `max` (oldest dropped).
 * A single queue means rapid-fire pushes collapse into one ordered list —
 * the host renders them stacked in place, never one on top of another.
 */
export function pushToast(list: readonly ToastItem[], t: ToastItem, max = 3): ToastItem[] {
  return [...list, t].slice(-max)
}

export function dismissToast(list: readonly ToastItem[], id: number): ToastItem[] {
  return list.filter((t) => t.id !== id)
}

export function headToast(list: readonly ToastItem[]): ToastItem | undefined {
  return list[0]
}
