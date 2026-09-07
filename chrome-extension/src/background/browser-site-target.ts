// Non-exportable per-worker key. A plain digest would let recipients test
// guesses of low-entropy query secrets offline. A worker restart invalidates
// old navigation fingerprints conservatively; the key is never persisted.
let navigationKey: Promise<CryptoKey> | undefined

/** Browser-side context metadata. Fingerprint before discarding route/query; never
 * forward the original URL through this context-only response. */
export async function browserSiteTarget(tabId: number, rawUrl: string | undefined) {
  if (!Number.isSafeInteger(tabId) || tabId < 0 || !rawUrl) return undefined
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    const safeUrl = url.origin + url.pathname
    url.username = ""
    url.password = ""
    navigationKey ??= crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    const digest = await crypto.subtle.sign("HMAC", await navigationKey, new TextEncoder().encode(url.href))
    return {
      kind: "browser" as const, tab_id: tabId,
      url: safeUrl, origin: url.origin, hostname: url.hostname, path: url.pathname,
      navigation_key: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join(""),
    }
  } catch { return undefined }
}
