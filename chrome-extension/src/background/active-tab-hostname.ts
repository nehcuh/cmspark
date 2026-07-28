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
