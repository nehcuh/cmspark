/**
 * Running host_computer task abort flags (process memory).
 * Shared by server host_computer path and unattended disarm so "解除武装"
 * can stop in-flight desktop injection (S36 multi-adversarial F3).
 */

const computerTaskAbort = new Map<string, boolean>()

/** Full registry — tests seed fake in-flight tasks via this map. */
export function getComputerTaskAbortRegistry(): Map<string, boolean> {
  return computerTaskAbort
}

/**
 * Silently flip every running computer-task abort flag (no WS ack).
 * Used by chat.abort, unattended disarm, and computer.task.abort "*".
 */
export function flipAllComputerTaskAborts(): number {
  let matched = 0
  for (const k of computerTaskAbort.keys()) {
    computerTaskAbort.set(k, true)
    matched++
  }
  return matched
}
