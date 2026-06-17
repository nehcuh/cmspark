// Per-session "first-use" confirmation cache for MCP tools.
//
// Trust level "first-use" means: the first call to a given (server, tool) pair within a
// session must be user-approved; subsequent calls within the same session skip the prompt.
//
// This cache is keyed by sessionId to avoid cross-session bleed — the existing
// SecurityConfirmationManager is a process-global singleton keyed by random confirmationId
// (correct for in-flight prompts), but a global "already approved" Set would share approvals
// across browser sessions, which we must not do.
//
// Audit item 8: per-tool approvals now expire (TTL) and are capped (MAX_CALLS). A
// long-running session that approved a filesystem-write tool 4 hours ago shouldn't
// keep auto-approving destructive calls — the user might have walked away, the threat
// model might have changed, or the LLM might be mid-prompt-injection. Re-prompting
// after N calls or M minutes is defense-in-depth without making first-use useless.

import { logger } from "../logger.js"

/** Default TTL for a per-tool first-use approval (1 hour). */
export const DEFAULT_APPROVAL_TTL_MS = 60 * 60 * 1000
/** Default max tool calls before a per-tool first-use approval must be re-confirmed. */
export const DEFAULT_APPROVAL_MAX_CALLS = 10

interface ApprovalMeta {
  approvedAt: number
  callCount: number
}

export interface McpConfirmCacheOptions {
  ttlMs?: number
  maxCalls?: number
}

export interface ConfirmCacheKey {
  sessionId: string
  serverName: string
  toolName: string
}

function keyToString(k: ConfirmCacheKey): string {
  return `${k.sessionId}::${k.serverName}::${k.toolName}`
}

export class McpConfirmCache {
  private approved = new Map<string, Map<string, ApprovalMeta>>()
  // Sessions that have explicitly chosen "approve all from this server" — optional convenience
  // for power users who want to bulk-trust a server mid-session without re-confirming each tool.
  // Bulk trust has NO TTL/cap — it's an explicit "trust this whole server" choice.
  private trustedServers = new Map<string, Set<string>>()
  private readonly ttlMs: number
  private readonly maxCalls: number

  constructor(opts: McpConfirmCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_APPROVAL_TTL_MS
    this.maxCalls = opts.maxCalls ?? DEFAULT_APPROVAL_MAX_CALLS
  }

  isApproved(key: ConfirmCacheKey): boolean {
    // Bulk-trust path: still permanent within session (explicit user choice).
    const perServer = this.trustedServers.get(key.sessionId)
    if (perServer && perServer.has(key.serverName)) return true

    // Per-tool path: TTL + call-count gated.
    const perSession = this.approved.get(key.sessionId)
    if (!perSession) return false
    const meta = perSession.get(key.serverName + "/" + key.toolName)
    if (!meta) return false

    const now = Date.now()
    if (now - meta.approvedAt > this.ttlMs) {
      // TTL expired — drop the entry so the next call re-prompts.
      perSession.delete(key.serverName + "/" + key.toolName)
      logger.debug("mcp.confirm_cache.expired_ttl", {
        session: key.sessionId, server: key.serverName, tool: key.toolName,
        age_ms: now - meta.approvedAt, ttl_ms: this.ttlMs,
      })
      return false
    }
    if (meta.callCount >= this.maxCalls) {
      // Call cap hit — drop and force re-prompt.
      perSession.delete(key.serverName + "/" + key.toolName)
      logger.debug("mcp.confirm_cache.expired_calls", {
        session: key.sessionId, server: key.serverName, tool: key.toolName,
        calls: meta.callCount, max: this.maxCalls,
      })
      return false
    }
    return true
  }

  approve(key: ConfirmCacheKey): void {
    let perSession = this.approved.get(key.sessionId)
    if (!perSession) {
      perSession = new Map()
      this.approved.set(key.sessionId, perSession)
    }
    // (Re)approve resets the clock + counter — e.g. after a re-prompt following TTL expiry.
    perSession.set(key.serverName + "/" + key.toolName, {
      approvedAt: Date.now(),
      callCount: 0,
    })
  }

  /**
   * Record that a tool was actually invoked under an existing approval. Increments
   * the call counter; when it exceeds maxCalls, the next isApproved() returns false
   * and the user is re-prompted. Idempotent if no approval exists (no-op).
   */
  recordCall(key: ConfirmCacheKey): void {
    const perSession = this.approved.get(key.sessionId)
    if (!perSession) return
    const meta = perSession.get(key.serverName + "/" + key.toolName)
    if (!meta) return
    meta.callCount += 1
  }

  approveServer(sessionId: string, serverName: string): void {
    let perServer = this.trustedServers.get(sessionId)
    if (!perServer) {
      perServer = new Set()
      this.trustedServers.set(sessionId, perServer)
    }
    perServer.add(serverName)
  }

  revoke(key: ConfirmCacheKey): void {
    const perSession = this.approved.get(key.sessionId)
    if (perSession) perSession.delete(key.serverName + "/" + key.toolName)
    const perServer = this.trustedServers.get(key.sessionId)
    if (perServer) perServer.delete(key.serverName)
  }

  clearSession(sessionId: string): void {
    this.approved.delete(sessionId)
    this.trustedServers.delete(sessionId)
  }

  /** Drop approvals for a server across all sessions (e.g. when trust_level changes back to manual). */
  clearServer(serverName: string): void {
    for (const perSession of this.approved.values()) {
      for (const entry of Array.from(perSession.keys())) {
        if (entry.startsWith(serverName + "/")) perSession.delete(entry)
      }
    }
    for (const set of this.trustedServers.values()) {
      set.delete(serverName)
    }
  }

  /** Periodic cleanup of stale sessions — called by manager on config changes / shutdown. */
  pruneStaleSessions(activeSessionIds: Set<string>): void {
    for (const id of Array.from(this.approved.keys())) {
      if (!activeSessionIds.has(id)) this.approved.delete(id)
    }
    for (const id of Array.from(this.trustedServers.keys())) {
      if (!activeSessionIds.has(id)) this.trustedServers.delete(id)
    }
  }
}

// Module-level singleton — manager and router share the same cache.
let _instance: McpConfirmCache | null = null
export function getMcpConfirmCache(): McpConfirmCache {
  if (!_instance) _instance = new McpConfirmCache()
  return _instance
}

