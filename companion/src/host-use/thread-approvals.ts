// Phase 1 W7 — Thread-scoped trust map for host_read/host_write.
//
// When user approves a confirmation with `add_to_thread_whitelist: true`, the
// (threadId, bundleId, kind) tuple is recorded here. Subsequent calls in the
// same thread with matching tuple skip the L2 confirmation dialog (audit logged).
//
// Scope (per W7 final decision doc):
//   - READ operations only. Writes (host_write create/move) always go through
//     biometric gate; this map is consulted only for host_read.
//   - Thread lifetime only. Map entry dies when companion process restarts
//     OR when thread is deleted. No persistent cross-thread trust.
//   - Q1 biometric bypass NOT allowed — Touch ID per call for writes is
//     non-negotiable (Round 2 §4.2 + Kimi+Pi ship blocker).

interface ThreadApprovalKey {
  threadId: string
  bundleId: string
  kind: string
}

function makeKey(threadId: string, bundleId: string, kind: string): string {
  return `${threadId}|${bundleId}|${kind}`
}

export class ThreadApprovals {
  private approvals = new Map<string, Set<string>>()

  /** Add (threadId, bundleId, kind) tuple to trust set. Idempotent. */
  add(threadId: string, bundleId: string, kind: string): void {
    const key = makeKey(threadId, bundleId, kind)
    let set = this.approvals.get(threadId)
    if (!set) {
      set = new Set()
      this.approvals.set(threadId, set)
    }
    set.add(key)
  }

  /** Check if (threadId, bundleId, kind) tuple is trusted. */
  has(threadId: string, bundleId: string, kind: string): boolean {
    const set = this.approvals.get(threadId)
    if (!set) return false
    return set.has(makeKey(threadId, bundleId, kind))
  }

  /** Drop all approvals for a thread (called on thread delete). */
  clearThread(threadId: string): void {
    this.approvals.delete(threadId)
  }

  /** For diagnostics / testing. */
  size(): number {
    let total = 0
    for (const set of this.approvals.values()) total += set.size
    return total
  }
}

// Singleton — survives companion process lifetime, dies on restart (intentional).
let _instance: ThreadApprovals | undefined
export function getThreadApprovals(): ThreadApprovals {
  if (!_instance) _instance = new ThreadApprovals()
  return _instance
}
