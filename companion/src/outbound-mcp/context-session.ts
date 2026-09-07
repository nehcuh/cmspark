import { randomUUID } from "node:crypto"
import { requireLiveGrant, type GrantLookup } from "./context-permission"
import type { EvidenceScope } from "../business-evidence/content"

const SESSION_TTL_MS = 30 * 60_000
export interface ContextSession { handle: string; grant_id: string; session_id: string; caller_id: string; expires_at: number }
/** Separate stale handle recovery from a valid session denied for its origin. */
export class ContextSessionUnavailable extends Error {
  constructor() { super("SCOPE_DENIED") }
}

/** Opaque handles are issued by Companion and can only be resumed under the
 * same live grant. A client cannot provide a thread ID or choose a scope. */
export class ContextSessionRegistry {
  private readonly sessions = new Map<string, ContextSession>()
  constructor(private readonly lookup: GrantLookup, private readonly now: () => number = () => Date.now()) {}
  issue(grantId: string, callerId: string): ContextSession {
    requireLiveGrant(this.lookup, grantId, callerId, this.now())
    for (const [key, entry] of this.sessions) if (entry.expires_at <= this.now()) this.sessions.delete(key)
    if (this.sessions.size >= 256 || [...this.sessions.values()].filter(entry => entry.grant_id === grantId).length >= 16) throw new Error("CAPACITY")
    const entry = { handle: randomUUID(), grant_id: grantId, session_id: randomUUID(), caller_id: callerId, expires_at: this.now() + SESSION_TTL_MS }
    this.sessions.set(entry.handle, entry)
    return { ...entry }
  }
  resolve(handle: string, grantId: string, callerId: string): ContextSession {
    requireLiveGrant(this.lookup, grantId, callerId, this.now())
    const entry = this.sessions.get(handle)
    if (!entry || entry.expires_at <= this.now()) throw new ContextSessionUnavailable()
    if (entry.grant_id !== grantId || entry.caller_id !== callerId) throw new Error("SCOPE_DENIED")
    entry.expires_at = this.now() + SESSION_TTL_MS
    return { ...entry }
  }
  scope(handle: string, grantId: string, callerId: string): EvidenceScope {
    const session = this.resolve(handle, grantId, callerId)
    return { kind: "mcp", grantId: session.grant_id, sessionId: session.session_id }
  }
  clear(): void { this.sessions.clear() }
}
