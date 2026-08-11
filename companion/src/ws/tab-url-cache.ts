// TabId → URL cache for evaluate auto-approve domain resolution (ADR evaluate gate).
// C10 dual-review nit: colocated module — no longer server-local only.
// Populated from list_tabs results and extension tab.navigated (applyTabNavigated).
// Unknown/missing → gate confirms (safe default). Residual: microsecond TOCTOU between
// cache read and forwarded evaluate; push lost while WS disconnected (next list_tabs).

import { logger } from "../logger"

const tabUrlCache = new Map<number, string>()

function hostnameFromUrl(urlString: string): string {
  try {
    return new URL(urlString).hostname
  } catch {
    return ""
  }
}

/** Live map (tool-forward / companion-dispatch post-process). */
export function getTabUrlCache(): Map<number, string> {
  return tabUrlCache
}

export function getCachedTabUrl(tabId: number | undefined | null): string | undefined {
  if (typeof tabId !== "number") return undefined
  return tabUrlCache.get(tabId)
}

export function refreshTabUrlCache(tabs: any[]): void {
  if (!Array.isArray(tabs)) return
  for (const t of tabs) {
    if (t && typeof t.id === "number" && typeof t.url === "string") {
      tabUrlCache.set(t.id, t.url)
    }
  }
}

/**
 * Apply a tab-navigation push from the extension (M1 / audit P2-1). Updates the
 * cached URL so the evaluate auto-approve gate sees the CURRENT origin, not a
 * stale one. Exported so tests can drive it directly.
 */
export function applyTabNavigated(tabId: number, url: string): void {
  const previous = getCachedTabUrl(tabId)
  tabUrlCache.set(tabId, url)
  const prevDomain = previous ? hostnameFromUrl(previous) : ""
  const nextDomain = hostnameFromUrl(url)
  if (prevDomain && prevDomain !== nextDomain) {
    logger.info("ws.tab.navigated_domain_changed", {
      tab_id: tabId,
      from: prevDomain,
      to: nextDomain,
    })
  }
}

/** Test hook — wipe cache between cases. */
export function clearTabUrlCacheForTests(): void {
  tabUrlCache.clear()
}
