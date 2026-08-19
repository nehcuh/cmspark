// Resolve active-tab hostname for site-knowledge auto-load (ADR knowledge + skill-engine getBySite).
// Only used for knowledge/skill *selection* — never for cookie/trust security gates.

/**
 * Pure extract: http(s) only → hostname. Used by getActiveTabHostname and unit tests.
 * SW has no "current window"; callers should prefer lastFocusedWindow (see getActiveTabHostname).
 */
export function hostnameFromTabUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== "string") return undefined
  if (!/^https?:\/\//i.test(url)) return undefined
  try {
    const hostname = new URL(url).hostname.trim().toLowerCase().replace(/\.+$/, "")
    return hostname || undefined
  } catch {
    return undefined
  }
}

/**
 * Active focused browser tab hostname for chat.create / regenerate / file.upload.
 * - lastFocusedWindow: service worker has no currentWindow context (Pi/Claude review F2).
 * - No pinned-tab fallback: wrong site knowledge is worse than none (dual-review Q2).
 */
export async function getActiveTabHostname(): Promise<string | undefined> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return hostnameFromTabUrl(tabs[0]?.url)
  } catch {
    return undefined
  }
}

/**
 * Site-knowledge hostname is best-effort. Never stall chat.create / chat.user
 * echo on a hung tabs.query — 40ms is enough for the normal path.
 */
export function withHostnameBudget<T>(
  getter: () => Promise<T | undefined>,
  timeoutMs = 40,
): Promise<T | undefined> {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 40
  return new Promise((resolve) => {
    let done = false
    const finish = (value?: T) => {
      if (done) return
      done = true
      resolve(value)
    }
    const timer = setTimeout(() => finish(undefined), ms)
    getter()
      .then((value) => {
        clearTimeout(timer)
        finish(value)
      })
      .catch(() => {
        clearTimeout(timer)
        finish(undefined)
      })
  })
}
