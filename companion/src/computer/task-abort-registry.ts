import { retireComputerReadonlyThread } from "./readonly-session"
/**
 * Running host_computer task abort flags (process memory).
 * Shared by server host_computer path and unattended disarm so "解除武装"
 * can stop in-flight desktop injection (S36 multi-adversarial F3).
 */

const computerTaskAbort = new Map<string, boolean>()
const abortListeners = new Set<(taskId: string) => void>()

/** Optional owned backends receive the same panic/target stop, even during initialization. */
export function onComputerTaskAbort(listener: (taskId: string) => void): () => void {
  abortListeners.add(listener)
  return () => { abortListeners.delete(listener) }
}

export function notifyComputerTaskAbort(taskId: string): void {
  for (const listener of abortListeners) { try { listener(taskId) } catch { /* stopping other tasks must continue */ } }
}

/** Full registry — tests seed fake in-flight tasks via this map. */
export function getComputerTaskAbortRegistry(): Map<string, boolean> {
  return computerTaskAbort
}

/**
 * Silently flip every running computer-task abort flag (no WS ack).
 * Used by chat.abort, unattended disarm, and computer.task.abort "*".
 */
export function flipAllComputerTaskAborts(): number {
  retireComputerReadonlyThread()
  let matched = 0
  for (const k of computerTaskAbort.keys()) {
    computerTaskAbort.set(k, true)
    matched++
  }
  notifyComputerTaskAbort("*")
  return matched
}
