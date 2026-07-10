// Site matcher — wildcard hostname matching for knowledge docs

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
 */
export function matchSite(pattern: string, hostname: string): boolean {
  // Exact match
  if (pattern === hostname) return true

  // Wildcard match: *.github.com matches api.github.com (subdomain) and github.com (apex),
  // but NOT evilgithub.com (no dot boundary).
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2)
    return hostname === suffix || hostname.endsWith("." + suffix)
  }

  return false
}
