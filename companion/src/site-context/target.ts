import { createHmac, randomBytes } from "node:crypto"

const localNavigationKey = randomBytes(32)

/** Knowledge hints and observed browser targets are deliberately different.
 * Neither is an authorization token. Export boundaries must still validate the
 * exact origin against their own grant, after resolving the actual tab. */
export interface SiteTarget {
  kind: "browser"
  tab_id: number
  url: string
  origin: string
  hostname: string
  path: string
  observed_at: string
  /** Opaque change detector, not a raw route or authorization credential. */
  navigation_key: string
}

/** Call only at the browser-result boundary, never with model params.url.
 * Raw URL credentials, queries and fragments never escape this function. */
export function siteTargetFromBrowser(
  tabId: unknown,
  rawUrl: unknown,
  observedAt: number,
): SiteTarget | undefined {
  if (typeof tabId !== "number" || !Number.isSafeInteger(tabId) || tabId < 0) return undefined
  if (typeof rawUrl !== "string" || !Number.isFinite(observedAt)) return undefined
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    // URL.origin normalizes default ports, but keeps non-default ports and
    // www/subdomains distinct. Unlike knowledge matching this is an exact key.
    const origin = url.origin
    const safeUrl = origin + url.pathname
    url.username = ""
    url.password = ""
    const navigationKey = createHmac("sha256", localNavigationKey).update(url.href).digest("hex")
    return {
      kind: "browser",
      tab_id: tabId,
      url: safeUrl,
      origin,
      hostname: url.hostname,
      path: url.pathname,
      observed_at: new Date(observedAt).toISOString(),
      navigation_key: navigationKey,
    }
  } catch {
    return undefined
  }
}

/** A browser navigation/path change invalidates context, even on the same host.
 * Observation time is intentionally excluded, so harmless refreshes don't churn
 * identity. This key is internal and carries no permission to read the target. */
export function siteTargetKey(target: SiteTarget | undefined): string {
  return target ? JSON.stringify([target.tab_id, target.origin, target.navigation_key]) : "unavailable"
}

/** Validate the context-only bridge response. The route hash is computed in
 * the browser; its raw query/fragment must never cross this boundary. */
export function siteTargetFromBridge(value: unknown, observedAt = Date.now()): SiteTarget | undefined {
  if (!value || typeof value !== "object") return undefined
  const input = value as Record<string, unknown>
  if (input.kind !== "browser" || typeof input.navigation_key !== "string" || !/^[a-f0-9]{64}$/.test(input.navigation_key)) return undefined
  const target = siteTargetFromBrowser(input.tab_id, input.url, observedAt)
  if (!target || target.url !== input.url || target.origin !== input.origin || target.hostname !== input.hostname || target.path !== input.path) return undefined
  return { ...target, navigation_key: input.navigation_key }
}
