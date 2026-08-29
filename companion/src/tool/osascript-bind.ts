/** Resolve / canonicalize osascript_eval tab URL (Batch C C1 / #247). */

export const OSASCRIPT_TARGET_ERROR =
  "osascript_eval requires expression. Pass tabId from list_tabs, or the exact url list_tabs returned. Fragments like zhihu.com are rejected."

/**
 * Keep query, drop hash. Do not re-serialize via `new URL().href`.
 * Hostname fragments (zhihu.com) return null.
 */
export function canonicalizeOsascriptUrl(raw: string): string | null {
  const s = (raw || "").trim()
  if (!/^https?:\/\//i.test(s)) return null
  const hash = s.indexOf("#")
  return hash >= 0 ? s.slice(0, hash) : s
}

export function resolveOsascriptPageUrl(
  params: Record<string, any>,
  getCached?: (tabId: number | null | undefined) => string | undefined,
): { url: string } | { error: string } {
  const explicit = typeof params?.url === "string" ? params.url.trim() : ""
  if (explicit) {
    const c = canonicalizeOsascriptUrl(explicit)
    if (!c) return { error: OSASCRIPT_TARGET_ERROR }
    return { url: c }
  }
  if (typeof params?.tabId === "number") {
    const cached = getCached ? getCached(params.tabId) : undefined
    if (typeof cached === "string" && cached) {
      const c = canonicalizeOsascriptUrl(cached)
      if (c) return { url: c }
    }
  }
  return { error: OSASCRIPT_TARGET_ERROR }
}
