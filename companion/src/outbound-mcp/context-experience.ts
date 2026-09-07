import { evidenceScopeHash, type EvidenceScope } from "../business-evidence/content"

const TTL = 30 * 60_000
type Experience = { origin: string; failures: number; expires_at: number; stale: boolean }
const scopes = new Map<string, Map<string, Experience>>()

/** Only live failures from this authenticated grant/session. Never hydrates
 * Chat knowledge, persisted site-op memory, locators, or Observation content. */
export function recordContextFailure(scope: EvidenceScope, origin: string, now = Date.now()): boolean {
  if (scope.kind !== "mcp") return false
  let url: URL
  try { url = new URL(origin) } catch { return false }
  if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return false
  for (const [key, rows] of scopes) {
    for (const [name, row] of rows) if (row.expires_at <= now) rows.delete(name)
    if (!rows.size) scopes.delete(key)
  }
  const key = evidenceScopeHash(scope)
  if (!scopes.has(key) && scopes.size >= 256) return false
  const rows = scopes.get(key) || new Map<string, Experience>()
  if (!rows.has(origin) && rows.size >= 64) return false
  rows.set(origin, { origin, failures: (rows.get(origin)?.failures || 0) + 1, expires_at: now + TTL, stale: false })
  scopes.set(key, rows)
  return true
}
export function contextExperience(scope: EvidenceScope, origin: string, now = Date.now()) {
  const row = scopes.get(evidenceScopeHash(scope))?.get(origin)
  return row ? [{ ...row, expires_at: new Date(row.expires_at).toISOString(), stale: row.expires_at <= now }] : []
}
export function clearContextExperiences(): void { scopes.clear() }
