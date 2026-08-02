// Q5 (adversary): after host_cli output in a thread, force L2 on host_cli and
// state-changing host ops until the next *real user* message (not tool results).

const taintedThreads = new Set<string>()

export function markCliOutputSeen(threadId: string | undefined | null): void {
  if (!threadId || typeof threadId !== "string") return
  taintedThreads.add(threadId)
}

export function clearCliOutputTaint(threadId: string | undefined | null): void {
  if (!threadId || typeof threadId !== "string") return
  taintedThreads.delete(threadId)
}

export function isCliOutputTainted(threadId: string | undefined | null): boolean {
  if (!threadId || typeof threadId !== "string") return false
  return taintedThreads.has(threadId)
}

/** Test-only. */
export function _resetCliQ5ForTests(): void {
  taintedThreads.clear()
}
