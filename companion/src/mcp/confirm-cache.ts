// Per-session "first-use" confirmation cache for MCP tools.
//
// Trust level "first-use" means: the first call to a given (server, tool) pair within a
// session must be user-approved; subsequent calls within the same session skip the prompt.
//
// This cache is keyed by sessionId to avoid cross-session bleed — the existing
// SecurityConfirmationManager is a process-global singleton keyed by random confirmationId
// (correct for in-flight prompts), but a global "already approved" Set would share approvals
// across browser sessions, which we must not do.

export interface ConfirmCacheKey {
  sessionId: string
  serverName: string
  toolName: string
}

function keyToString(k: ConfirmCacheKey): string {
  return `${k.sessionId}::${k.serverName}::${k.toolName}`
}

export class McpConfirmCache {
  private approved = new Map<string, Set<string>>()
  // Sessions that have explicitly chosen "approve all from this server" — optional convenience
  // for power users who want to bulk-trust a server mid-session without re-confirming each tool.
  private trustedServers = new Map<string, Set<string>>()

  isApproved(key: ConfirmCacheKey): boolean {
    const perServer = this.trustedServers.get(key.sessionId)
    if (perServer && perServer.has(key.serverName)) return true
    const perSession = this.approved.get(key.sessionId)
    return !!perSession && perSession.has(key.serverName + "/" + key.toolName)
  }

  approve(key: ConfirmCacheKey): void {
    let perSession = this.approved.get(key.sessionId)
    if (!perSession) {
      perSession = new Set()
      this.approved.set(key.sessionId, perSession)
    }
    perSession.add(key.serverName + "/" + key.toolName)
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
    for (const set of this.approved.values()) {
      for (const entry of Array.from(set)) {
        if (entry.startsWith(serverName + "/")) set.delete(entry)
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
