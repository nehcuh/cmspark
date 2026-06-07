// Privilege mode manager — tracks per-thread privilege levels and confirmation state.

import type { RiskScore, PrivilegeMode } from "./risk-engine"

/** A privilege session bound to a specific thread. */
export interface PrivilegeSession {
  /** Current privilege mode. */
  mode: PrivilegeMode
  /** Thread identifier. */
  threadId: string
  /** Unix timestamp when the session was issued. */
  issuedAt: number
  /** Set of confirmed code hashes for this session. */
  confirmedHashes: Set<string>
}

/** Manages privilege sessions per thread. */
export class PrivilegeManager {
  private sessions = new Map<string, PrivilegeSession>()

  /**
   * Get the current privilege mode for a thread.
   *
   * @param threadId - Thread identifier.
   * @returns The privilege mode, defaulting to "standard".
   */
  getMode(threadId: string): PrivilegeMode {
    const session = this.sessions.get(threadId)
    return session?.mode ?? "standard"
  }

  /**
   * Set the privilege mode for a thread.
   *
   * @param threadId - Thread identifier.
   * @param mode - Privilege mode to set.
   * @param fromUI - Whether the change originated from the UI. Only UI-initiated changes are allowed.
   * @returns True if the mode was changed, false otherwise.
   */
  setMode(threadId: string, mode: PrivilegeMode, fromUI: boolean): boolean {
    if (!fromUI) {
      console.warn("[PrivilegeManager] Rejected privilege change not from UI")
      return false
    }
    const session: PrivilegeSession = {
      mode,
      threadId,
      issuedAt: Date.now(),
      confirmedHashes: new Set(),
    }
    this.sessions.set(threadId, session)
    return true
  }

  /**
   * Check whether a given code hash can be auto-executed in the current session.
   *
   * @param score - The calculated risk score.
   * @param threadId - Thread identifier.
   * @param codeHash - Hash of the code being executed.
   * @returns True if auto-execution is permitted.
   */
  canAutoExecute(score: RiskScore, threadId: string, codeHash: string): boolean {
    const mode = this.getMode(threadId)

    if (mode === "readonly") {
      return score.total === 0
    }

    if (mode === "advanced") {
      const session = this.sessions.get(threadId)
      if (session?.confirmedHashes.has(codeHash)) {
        return score.total < 9
      }
      return score.total <= 3
    }

    // standard mode
    if (score.total <= 2) {
      return true
    }
    const session = this.sessions.get(threadId)
    return session?.confirmedHashes.has(codeHash) ?? false
  }

  /**
   * Record a user confirmation for a specific code hash.
   *
   * @param threadId - Thread identifier.
   * @param codeHash - Hash of the confirmed code.
   */
  recordConfirmation(threadId: string, codeHash: string): void {
    const session = this.sessions.get(threadId)
    if (session) {
      session.confirmedHashes.add(codeHash)
    } else {
      this.sessions.set(threadId, {
        mode: "standard",
        threadId,
        issuedAt: Date.now(),
        confirmedHashes: new Set([codeHash]),
      })
    }
  }

  /**
   * Auto-downgrade privilege mode after consecutive high-risk executions.
   *
   * @param threadId - Thread identifier.
   * @param consecutiveHighRisk - Number of consecutive high-risk executions.
   */
  autoDowngrade(threadId: string, consecutiveHighRisk: number): void {
    const session = this.sessions.get(threadId)
    if (!session) return

    if (consecutiveHighRisk >= 3 && session.mode === "advanced") {
      console.warn(`[PrivilegeManager] Auto-downgrading thread ${threadId} from advanced to standard due to ${consecutiveHighRisk} consecutive high-risk executions`)
      session.mode = "standard"
      session.confirmedHashes.clear()
    } else if (consecutiveHighRisk >= 5 && session.mode === "standard") {
      console.warn(`[PrivilegeManager] Auto-downgrading thread ${threadId} from standard to readonly due to ${consecutiveHighRisk} consecutive high-risk executions`)
      session.mode = "readonly"
      session.confirmedHashes.clear()
    }
  }

  /** Clear all sessions (useful for testing). */
  clear(): void {
    this.sessions.clear()
  }
}

/** Singleton instance. */
export const privilegeManager = new PrivilegeManager()
