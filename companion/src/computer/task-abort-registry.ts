import { retireComputerReadonlyThread } from "./readonly-session"
/**
 * Running host_computer task abort flags (process memory).
 * Shared by server host_computer path and unattended disarm so "解除武装"
 * can stop in-flight desktop injection (S36 multi-adversarial F3).
 */

const computerTaskAbort = new Map<string, boolean>()
const abortListeners = new Set<(taskId: string) => void>()
const inputStops = new Map<string, () => Promise<void> | undefined>()

/** Optional owned backends receive the same panic/target stop, even during initialization. */
export function onComputerTaskAbort(listener: (taskId: string) => void): () => void {
  abortListeners.add(listener)
  return () => { abortListeners.delete(listener) }
}

export function notifyComputerTaskAbort(taskId: string): void {
  for (const listener of abortListeners) { try { listener(taskId) } catch { /* stopping other tasks must continue */ } }
}

/** Stop the native producer and return its drain, if it has an input in flight. */
export function registerComputerInputStop(taskId: string, stop: () => Promise<void> | undefined): () => void {
  inputStops.set(taskId, stop)
  return () => { inputStops.delete(taskId) }
}

/** Full registry — tests seed fake in-flight tasks via this map. */
export function getComputerTaskAbortRegistry(): Map<string, boolean> {
  return computerTaskAbort
}

/** Request a stop and collect any active native input that must drain. */
export function requestComputerTaskAbort(taskId: string): { matched: number; drains: Promise<void>[] } {
  if (taskId === "*") retireComputerReadonlyThread()
  const ids = taskId === "*" ? [...computerTaskAbort.keys()] : taskId && computerTaskAbort.has(taskId) ? [taskId] : []
  const drains: Promise<void>[] = []
  for (const id of ids) {
    computerTaskAbort.set(id, true)
    const drain = inputStops.get(id)?.()
    if (drain) drains.push(drain)
  }
  if (taskId === "*" || ids.length > 0) notifyComputerTaskAbort(taskId)
  return { matched: ids.length, drains }
}

/** Stop all tasks without sending a panel ack (chat.abort and unattended disarm). */
export function flipAllComputerTaskAborts(): number {
  return requestComputerTaskAbort("*").matched
}
