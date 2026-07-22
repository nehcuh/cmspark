// UX-spike 2026-07-23 — per-session re-L2 suppression for computer-use.
//
// PROBLEM: every re-L2 in a task (FOREGROUND-YIELD pause, budget-exhausted
// pause, uncross-verified-click pause, dialog-suspected pause) re-asks the
// user. After the initial task L2 already gated the WHOLE task (every type
// literal, the action budget, the target app), these mid-task re-asks are
// almost always the same human saying "yes, continue" repeatedly — pure UX
// friction.
//
// SCOPE / SAFETY (intentionally narrower than ThreadApprovals):
//   - This map ONLY suppresses re-L2 (mid-task pauses). The INITIAL task L2
//     (companion/src/server.ts handleSecurityConfirmationResponse path) is
//     untouched — every task still asks once, every time. god-mode /
//     auto-approve likewise do NOT skip it (tool-definitions.ts contract).
//   - It is NOT a ThreadApprovals kind. W7 Blocker 1
//     (host-use/thread-approvals.ts header) forbids new ThreadApprovals
//     kinds without an owner decision; this structure lives outside that
//     module and governs a different gate.
//   - Process lifetime only (companion restart clears all trust). No
//     persistent cross-session trust.
//   - Keyed by (sessionId, appToken): trust is per-conversation AND per-app.
//     A new conversation, or a different app in the same conversation, asks
//     again.
//
// The grant is recorded by the server once the initial task L2 is approved
// (server.ts). The executor consults it at the top of reL2().

/** Singleton store: sessionId -> Set of trusted app tokens. */
export class ComputerSessionTrust {
  private trusted = new Map<string, Set<string>>()

  /** Record that this session approved a task for the given app token. Idempotent. */
  grant(sessionId: string, appToken: string): void {
    if (!sessionId || !appToken) return
    let set = this.trusted.get(sessionId)
    if (!set) {
      set = new Set()
      this.trusted.set(sessionId, set)
    }
    set.add(appToken)
  }

  /** True when this session has already approved a task for the app token. */
  isTrusted(sessionId: string, appToken: string): boolean {
    const set = this.trusted.get(sessionId)
    return !!set && set.has(appToken)
  }

  /** Drop all trust for a session (companion calls this on thread delete). */
  clearSession(sessionId: string): void {
    this.trusted.delete(sessionId)
  }

  /** Drop every trust entry for an app token, across all sessions. */
  clearApp(appToken: string): number {
    let removed = 0
    for (const [, set] of Array.from(this.trusted)) {
      for (const key of Array.from(set)) {
        if (key === appToken) {
          set.delete(key)
          removed++
        }
      }
    }
    for (const [sid, set] of Array.from(this.trusted)) {
      if (set.size === 0) this.trusted.delete(sid)
    }
    return removed
  }

  /** For diagnostics / testing. */
  size(): number {
    let total = 0
    for (const set of this.trusted.values()) total += set.size
    return total
  }
}

// Singleton — process lifetime; dies on companion restart (intentional).
let _instance: ComputerSessionTrust | undefined
export function getComputerSessionTrust(): ComputerSessionTrust {
  if (!_instance) _instance = new ComputerSessionTrust()
  return _instance
}
