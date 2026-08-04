/**
 * Server-side L3+ disclosure sessions for outbound MCP (ADR-022 L3+ / P0c M3).
 *
 * Caller-supplied `disclosure_accepted` MUST NOT authorize exfil tools.
 * Only an in-process session marked via acceptOutboundDisclosure() counts.
 */

export type DisclosureSession = {
  caller_id: string
  accepted_at: number
  /** Optional wall-clock expiry; 0 = no TTL */
  expires_at: number
}

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000 // 8h — align with unattended-style session length

const sessions = new Map<string, DisclosureSession>()

function now(): number {
  return Date.now()
}

function isLive(s: DisclosureSession, t = now()): boolean {
  if (s.expires_at > 0 && t >= s.expires_at) return false
  return true
}

/** Mark disclosure accepted for this caller (stdio session / product UX). */
export function acceptOutboundDisclosure(
  caller_id: string,
  opts?: { ttl_ms?: number },
): DisclosureSession {
  const id = (caller_id || "").trim() || "unknown"
  const ttl = opts?.ttl_ms ?? DEFAULT_TTL_MS
  const accepted_at = now()
  const sess: DisclosureSession = {
    caller_id: id,
    accepted_at,
    expires_at: ttl > 0 ? accepted_at + ttl : 0,
  }
  sessions.set(id, sess)
  return sess
}

/** True only if server has a live disclosure session for caller. */
export function hasOutboundDisclosure(caller_id: string): boolean {
  const id = (caller_id || "").trim() || "unknown"
  const s = sessions.get(id)
  if (!s) return false
  if (!isLive(s)) {
    sessions.delete(id)
    return false
  }
  return true
}

export function revokeOutboundDisclosure(caller_id: string): boolean {
  return sessions.delete((caller_id || "").trim() || "unknown")
}

/** Test / process shutdown helper. */
export function clearAllOutboundDisclosureSessions(): void {
  sessions.clear()
}

export function outboundDisclosureSessionCount(): number {
  // prune expired
  const t = now()
  for (const [k, s] of sessions) {
    if (!isLive(s, t)) sessions.delete(k)
  }
  return sessions.size
}
