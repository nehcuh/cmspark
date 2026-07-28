// Site matcher — wildcard hostname matching for knowledge docs

/**
 * Normalize a hostname for DNS-style comparison (RFC 4343: case-insensitive).
 * Trim, lowercase, strip trailing dots. Empty → undefined.
 */
export function normalizeHostname(h?: string | null): string | undefined {
  if (h == null || typeof h !== "string") return undefined
  const n = h.trim().toLowerCase().replace(/\.+$/, "")
  return n || undefined
}

/**
 * Match a site pattern against a hostname.
 *
 * - Exact match: "github.com" matches "github.com"
 * - Wildcard match: "*.github.com" matches "api.github.com" (subdomains) AND "github.com" (apex)
 *
 * Returns false for non-matching patterns.
 *
 * Uses a domain-boundary check (`.suffix`), NOT a bare `endsWith(suffix)` — otherwise
 * `*.github.com` would wrongly match `evilgithub.com` (suffix collision, no dot boundary).
 * Apex match is consistent with the security matchDomain (ADR-007).
 *
 * Both pattern and hostname are normalized (case-insensitive) before compare.
 */
export function matchSite(pattern: string, hostname: string): boolean {
  const p = normalizeHostname(pattern)
  const h = normalizeHostname(hostname)
  if (!p || !h) return false

  // Exact match
  if (p === h) return true

  // Wildcard match: *.github.com matches api.github.com (subdomain) and github.com (apex),
  // but NOT evilgithub.com (no dot boundary).
  if (p.startsWith("*.")) {
    const suffix = p.slice(2)
    if (!suffix) return false
    return h === suffix || h.endsWith("." + suffix)
  }

  return false
}
