/** Known channel-health is not durable evidence about a locator. Runtime
 * UNKNOWN/default health and all budgets remain in site-op-memory. */
export const NON_DURABLE_SITE_OP_CODES: ReadonlySet<string> = new Set([
  "WAIT_PROBE_FAILED", "CDP_ATTACH_FAILED", "WRONG_ORIGIN",
])

export function isDurableSiteOpFailureCode(code: string | undefined): boolean {
  return !NON_DURABLE_SITE_OP_CODES.has(code || "UNKNOWN")
}

const PERSISTED_LINE_RE =
  /^\[auto\] DO NOT retry ([a-z_]+) (.+?) on (https?:\/\/[^\s]+): last ([A-Z0-9_]+)$/

/**
 * Strict inverse of autoSiteOpExperienceLine. Only exact-template [auto] lines
 * parse — free-form text, manual experience lines, or anything a user/hand-edit
 * mangled returns null and can never hydrate into a machine ban or a prompt.
 */
export function parsePersistedSiteOpLine(content: string): {
  origin: string
  tool: string
  locator: string
  code: string
} | null {
  const m = PERSISTED_LINE_RE.exec(String(content || "").trim())
  if (!m) return null
  return { tool: m[1], locator: m[2], origin: m[3], code: m[4] }
}
