/**
 * Harness-v2-shaped queues, CMspark process-local.
 * steer dies on abort; nextRun survives abort (lost only on process death).
 */

const steerByThread = new Map<string, string[]>()
const nextRunByThread = new Map<string, string[]>()

export const MAX_STEER = 8

export function enqueueSteer(threadId: string, text: string): boolean {
  const t = String(text || "").trim()
  if (!threadId || !t) return false
  const q = steerByThread.get(threadId) || []
  if (q.length >= MAX_STEER) return false
  q.push(t)
  steerByThread.set(threadId, q)
  return true
}

export function takeSteer(threadId: string): string[] {
  const q = steerByThread.get(threadId) || []
  steerByThread.delete(threadId)
  return q
}

export function dropSteer(threadId: string): void {
  steerByThread.delete(threadId)
}

export const MAX_NEXT_RUN = 8

export function enqueueNextRun(threadId: string, text: string): boolean {
  const t = String(text || "").trim()
  if (!threadId || !t) return false
  const q = nextRunByThread.get(threadId) || []
  if (q.length >= MAX_NEXT_RUN) return false
  q.push(t)
  nextRunByThread.set(threadId, q)
  return true
}

export function takeNextRun(threadId: string): string | undefined {
  const q = nextRunByThread.get(threadId) || []
  const next = q.shift()
  if (!q.length) nextRunByThread.delete(threadId)
  else nextRunByThread.set(threadId, q)
  return next
}

export function peekNextRunCount(threadId: string): number {
  return nextRunByThread.get(threadId)?.length || 0
}

export function _resetRunQueuesForTests(): void {
  steerByThread.clear()
  nextRunByThread.clear()
}
