// Site matcher — wildcard hostname matching for knowledge docs

/**
 * Match a site pattern against a hostname.
 *
 * - Exact match: "github.com" matches "github.com"
 * - Wildcard match: "*.github.com" matches "api.github.com"
 *
 * Returns false for non-matching patterns.
 */
export function matchSite(pattern: string, hostname: string): boolean {
  // Exact match
  if (pattern === hostname) return true

  // Wildcard match: *.github.com matches api.github.com
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2)
    return hostname.endsWith(suffix)
  }

  return false
}
