// Q5-style taint after ACP handback — force L2 on high-blast tools until next user message.

const taintedThreads = new Set<string>()

export function markAcpHandbackSeen(threadId: string | undefined | null): void {
  if (!threadId || typeof threadId !== "string") return
  taintedThreads.add(threadId)
}

export function clearAcpHandbackTaint(threadId: string | undefined | null): void {
  if (!threadId || typeof threadId !== "string") return
  taintedThreads.delete(threadId)
}

export function isAcpHandbackTainted(threadId: string | undefined | null): boolean {
  if (!threadId || typeof threadId !== "string") return false
  return taintedThreads.has(threadId)
}

export function _resetAcpTaintForTests(): void {
  taintedThreads.clear()
}
