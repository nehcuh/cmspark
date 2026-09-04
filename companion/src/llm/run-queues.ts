/**
 * Harness-v2-shaped queues, CMspark process-local.
 * steer dies on abort; nextRun survives abort only from non-user paths —
 * an explicit user stop (chat.abort) clears it via clearNextRun (#291).
 */

/** Steer queue entry: text + optional extension optimistic bubble id (F1 adopt). */
export type SteerItem = {
  text: string
  /** chat.steer frame's clientMessageId, echoed as chat.user client_message_id. */
  clientMessageId?: string
}

const steerByThread = new Map<string, SteerItem[]>()

/** nextRun entry: leftover steers keep the first clientMessageId (F1 adopt). */
export type NextRunItem = {
  text: string
  clientMessageId?: string
}

const nextRunByThread = new Map<string, NextRunItem[]>()

export const MAX_STEER = 8

export function enqueueSteer(threadId: string, text: string, clientMessageId?: string): boolean {
  const t = String(text || "").trim()
  if (!threadId || !t) return false
  const q = steerByThread.get(threadId) || []
  if (q.length >= MAX_STEER) return false
  q.push(clientMessageId ? { text: t, clientMessageId } : { text: t })
  steerByThread.set(threadId, q)
  return true
}

export function takeSteer(threadId: string): SteerItem[] {
  const q = steerByThread.get(threadId) || []
  steerByThread.delete(threadId)
  return q
}

export function dropSteer(threadId: string): void {
  steerByThread.delete(threadId)
}

export const MAX_NEXT_RUN = 8

export function enqueueNextRun(threadId: string, text: string, clientMessageId?: string): boolean {
  const t = String(text || "").trim()
  if (!threadId || !t) return false
  const q = nextRunByThread.get(threadId) || []
  if (q.length >= MAX_NEXT_RUN) return false
  const id = typeof clientMessageId === "string" && clientMessageId.trim() ? clientMessageId : undefined
  q.push(id ? { text: t, clientMessageId: id } : { text: t })
  nextRunByThread.set(threadId, q)
  return true
}

export function takeNextRun(threadId: string): NextRunItem | undefined {
  const q = nextRunByThread.get(threadId) || []
  const next = q.shift()
  if (!q.length) nextRunByThread.delete(threadId)
  else nextRunByThread.set(threadId, q)
  return next
}

/**
 * Adapter finally: leftover steers (acked but unconsumed on the last stream
 * round) become one nextRun. Queue-full drops only this leftover — never
 * dropSteer, which would wipe steers enqueued after the take.
 */
let afterLeftoverTakeForTests: ((threadId: string) => void) | undefined

/** Test-only: run after takeSteer inside convertLeftover, before enqueue/drop. */
export function _setAfterLeftoverTakeForTests(fn?: (threadId: string) => void): void {
  afterLeftoverTakeForTests = fn
}

export function convertLeftoverSteerToNextRun(threadId: string): { converted: number; dropped: number } {
  const leftover = takeSteer(threadId)
  if (!leftover.length) return { converted: 0, dropped: 0 }
  afterLeftoverTakeForTests?.(threadId)
  const text = leftover.map((s) => s.text).join("\n")
  const clientMessageId = leftover.find((s) => s.clientMessageId)?.clientMessageId
  if (enqueueNextRun(threadId, text, clientMessageId)) {
    return { converted: leftover.length, dropped: 0 }
  }
  return { converted: 0, dropped: leftover.length }
}

export function peekNextRunCount(threadId: string): number {
  return nextRunByThread.get(threadId)?.length || 0
}

/**
 * #291: user stop (chat.abort) clears the whole nextRun queue — a stopped
 * thread must never silently revive from queued messages. Returns the number
 * of dropped entries so the ACK/UI can disclose it.
 */
export function clearNextRun(threadId: string): number {
  const q = nextRunByThread.get(threadId)
  if (!q?.length) return 0
  nextRunByThread.delete(threadId)
  return q.length
}

export function _resetRunQueuesForTests(): void {
  steerByThread.clear()
  nextRunByThread.clear()
  afterLeftoverTakeForTests = undefined
}
