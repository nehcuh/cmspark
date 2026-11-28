/**
 * Match a hostname against a list of patterns.
 * Supported patterns:
 *   - "*"            matches any hostname (global wildcard) — REJECTED at config
 *                    save time (validateWildcardPattern in saveConfig), so this
 *                    branch only fires for hand-edited configs that bypass validation.
 *   - "example.com"  exact match (apex or bare hostname)
 *   - "*.example.com" matches any subdomain of example.com, plus the bare apex
 *                    (so "*.company.com" matches "hr.company.com" AND "company.com")
 *
 * Apex-collapse is INTENTIONAL and documented in ADR-007: a user typing
 * `*.example.com` typically does want the apex covered too. The P0 finding
 * (S-P0-4, 2026-07-24) was that `*.com` would match every `.com` host AND
 * the bare `com` — but that's blocked at config-save time, not here. The
 * runtime matcher intentionally accepts legacy/hand-edited configs verbatim.
 *
 * Extracted from isTrustedDomain so auto_approved_domains and trusted_domains
 * share identical semantics.
 */
export function matchDomain(patterns: string[], domain: string): boolean {
  if (!patterns || patterns.length === 0) return false
  const host = String(domain || "").toLowerCase()
  if (!host) return false
  return patterns.some(pattern => {
    const p = String(pattern || "").toLowerCase()
    if (!p) return false
    if (p === "*") return true
    if (p === host) return true
    if (p.startsWith("*.")) {
      const suffix = p.slice(1) // ".example.com"
      return host.endsWith(suffix) || host === p.slice(2)
    }
    return false
  })
}

/**
 * S-P0-4 (2026-07-24): Reject dangerous wildcard patterns at config save.
 * Returns true if the pattern is safe to accept, false if it must be rejected.
 *
 * Rejected patterns:
 *   - `*` (global wildcard) — too broad; use explicit domains
 *   - `*.com`, `*.org`, `*.net`, `*.io`, `*.cn`, `*.jp`, etc. — bare TLD
 *     matches every host under that TLD
 *   - `*.co.jp`, `*.com.cn` — compound TLDs (Public Suffix List)
 *   - empty string, whitespace-only
 *
 * Accepted: exact domains, deep wildcards (`*.example.com`).
 *
 * The explicit suffix set includes shared hosting platforms and compound TLDs.
 */
const PUBLIC_SUFFIXES = new Set([
  // Generic TLDs (subset of the most-abusable)
  "com", "org", "net", "io", "co", "ai", "app", "dev", "xyz", "info", "biz",
  "me", "us", "uk", "eu", "de", "fr", "jp", "cn", "kr", "ru", "in", "br",
  "au", "ca", "ch", "nl", "se", "no", "it", "es", "pl",
  // Common two-label compound suffixes (not exhaustive — see Public Suffix List)
  "co.jp", "co.uk", "co.kr", "co.in", "co.nz", "co.za",
  "com.cn", "com.hk", "com.tw", "com.sg", "com.au", "com.br",
  "org.cn", "net.cn", "gov.cn", "edu.cn", "ac.cn",
  // A10 + P1 expansion: multi-tenant / shared-hosting eTLDs (not exhaustive PSL).
  "github.io", "appspot.com", "vercel.app", "pages.dev",
  "herokuapp.com", "netlify.app", "gitlab.io", "onrender.com",
  "s3.amazonaws.com", "s3-website.us-east-1.amazonaws.com",
  // P1 SEC-05: residual multi-tenant platforms previously still accepted
  "azurewebsites.net", "cloudfront.net", "firebaseapp.com", "web.app",
  "fly.dev", "run.app", "edgeapp.net", "on-aws.com", "lovable.app",
  "workers.dev", "pages.github.io", "azurestaticapps.net", "web.app",
  "ngrok.io", "ngrok-free.app", "trycloudflare.com", "r2.dev",
])

/**
 * True when `rest` (the part after `*.`) is a multi-tenant / public suffix that
 * must not be wildcarded (e.g. `*.azurewebsites.net`, `*.com`).
 */
export function isMultiTenantOrPublicSuffix(rest: string): boolean {
  const r = String(rest || "").trim().toLowerCase()
  if (!r) return true
  if (PUBLIC_SUFFIXES.has(r)) return true
  // Also reject when any right-hand public suffix is the full rest of a
  // multi-label eTLD already in the set (exact match only — `example.com` OK).
  return false
}

export function validateWildcardPattern(pattern: string): { ok: boolean; reason?: string } {
  const p = String(pattern || "").trim().toLowerCase()
  if (!p) return { ok: false, reason: "empty pattern" }
  if (p === "*") return { ok: false, reason: "global wildcard '*' is too broad; use explicit domains" }

  if (p.startsWith("*.")) {
    const rest = p.slice(2)
    // Reject `*.com`, `*.co.jp`, multi-tenant platforms, etc.
    if (isMultiTenantOrPublicSuffix(rest)) {
      return { ok: false, reason: `wildcard '*.${rest}' matches the entire .${rest} shared suffix — too broad` }
    }
    // Require at least one dot in the suffix (so `*.example` is also rejected;
    // it would match every host ending in `.example`).
    if (!rest.includes(".")) {
      return { ok: false, reason: `wildcard '*.${rest}' has no parent domain — too broad` }
    }
    return { ok: true }
  }

  // Exact domain — accept.
  return { ok: true }
}
