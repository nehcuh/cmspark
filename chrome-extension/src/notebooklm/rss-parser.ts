// RSS / Atom / OPML parser (Phase D / v1.2).
//
// Fetches a feed URL, parses entries, returns a normalized list. Supports:
//   - RSS 2.0 (<rss><channel><item>…)
//   - RSS 1.0 / RDF (<rdf:RDF>)
//   - Atom (<feed><entry>)
//
// Also supports feed discovery: if the URL is a regular HTML page, look for
// <link rel="alternate" type="application/rss+xml"> or check /feed /rss /atom.xml.
//
// OPML: parses <opml><body><outline xmlURL="…"> for batch subscription.
//
// **SSRF hardening (Phase 5 review)**: every URL is validated against a denylist
// (loopback / link-local / RFC1918 private / non-http scheme), and response bodies
// are size-capped (2 MB) to prevent OOM.

export interface FeedEntry {
  title: string
  url: string
  author?: string
  publishedAt?: string
  summary?: string
}

export interface FeedResult {
  title: string
  entries: FeedEntry[]
}

const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB cap

/** Phase 5 review fix: SSRF blocklist — refuse loopback / link-local / private IPs
 *  and any non-http(s) scheme. Mirror skill.import SSRF guard from companion. */
function isInternalOrInvalidUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return true
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true
  const host = parsed.hostname
  // Block obvious loopback / link-local / metadata endpoints
  if (host === "localhost" || host === "ip6-localhost") return true
  if (host.endsWith(".localhost")) return true
  if (host === "169.254.169.254" || host === "metadata.google.internal") return true // cloud metadata
  // IPv4 literal ranges
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [parseInt(m[1]), parseInt(m[2])]
    if (a === 10) return true // RFC1918
    if (a === 127) return true // loopback
    if (a === 0) return true // current network
    if (a === 169 && b === 254) return true // link-local
    if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
    if (a === 192 && b === 168) return true // RFC1918
    if (a >= 224) return true // multicast / reserved
  }
  // IPv6 — block ::1, fc00::/7, fe80::/10 by prefix
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) {
    return true
  }
  return false
}

/** Fetch with timeout + redirect SSRF guard + size cap.
 *
 * Kimi gate v1.2 catch: `redirect: "follow"` only validates the INITIAL url —
 * a malicious external server can 302 to http://169.254.169.254/ or http://localhost/.
 * Switched to `redirect: "manual"` + validate each hop's Location header. */
async function safeFetch(url: string, timeoutMs = 15000): Promise<Response> {
  if (isInternalOrInvalidUrl(url)) {
    throw new Error(`URL blocked by SSRF guard: ${url}`)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let currentUrl = url
    let resp: Response = await fetch(currentUrl, {
      credentials: "omit",
      redirect: "manual",
      signal: controller.signal,
    })
    // Walk redirects manually — cap at 5 hops
    let hops = 0
    while ([301, 302, 303, 307, 308].includes(resp.status) && hops < 5) {
      const location = resp.headers.get("location")
      if (!location) break
      let nextUrl: string
      try {
        nextUrl = new URL(location, currentUrl).toString()
      } catch {
        break
      }
      // Phase 5 / Kimi gate: validate EACH redirect target against the denylist
      if (isInternalOrInvalidUrl(nextUrl)) {
        throw new Error(`Redirect blocked by SSRF guard: ${currentUrl} → ${nextUrl}`)
      }
      currentUrl = nextUrl
      resp = await fetch(currentUrl, {
        credentials: "omit",
        redirect: "manual",
        signal: controller.signal,
      })
      hops++
    }
    return resp
  } finally {
    clearTimeout(timer)
  }
}

/** Read body with size cap. Throws if response exceeds MAX_BODY_BYTES. */
async function safeReadText(resp: Response): Promise<string> {
  const reader = resp.body?.getReader()
  if (!reader) {
    // Fallback: resp.text() with no cap (best-effort)
    return resp.text()
  }
  let received = 0
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      received += value.byteLength
      if (received > MAX_BODY_BYTES) {
        try { reader.cancel() } catch {}
        throw new Error(`Response exceeded ${MAX_BODY_BYTES} bytes (likely a malicious feed)`)
      }
      chunks.push(value)
    }
  }
  const merged = new Uint8Array(received)
  let pos = 0
  for (const c of chunks) {
    merged.set(c, pos)
    pos += c.byteLength
  }
  return new TextDecoder("utf-8").decode(merged)
}

/** Parse RSS 2.0 / RSS 1.0 / Atom from text. */
function parseFeedXml(xml: string): FeedResult | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml")
    // Check for parser errors
    if (doc.querySelector("parsererror")) return null

    // RSS 2.0
    const rssChannel = doc.querySelector("rss > channel")
    if (rssChannel) {
      const title = rssChannel.querySelector(":scope > title")?.textContent?.trim() || "RSS Feed"
      const items = Array.from(rssChannel.querySelectorAll(":scope > item"))
      const entries: FeedEntry[] = items
        .map(item => {
          const link = item.querySelector(":scope > link")?.textContent?.trim() || ""
          const eTitle = item.querySelector(":scope > title")?.textContent?.trim() || link
          const author = item.querySelector(":scope > dc\\:creator, :scope > author")?.textContent?.trim() || undefined
          const pub = item.querySelector(":scope > pubDate, :scope > dc\\:date")?.textContent?.trim() || undefined
          const summary = item.querySelector(":scope > description, :scope > content\\:encoded")?.textContent?.trim() || undefined
          return { title: eTitle, url: link, author, publishedAt: pub, summary }
        })
        .filter(e => e.url)
      return { title, entries }
    }

    // Atom
    const atomFeed = doc.querySelector("feed")
    if (atomFeed) {
      const title = atomFeed.querySelector(":scope > title")?.textContent?.trim() || "Atom Feed"
      const entries: FeedEntry[] = Array.from(atomFeed.querySelectorAll(":scope > entry"))
        .map(entry => {
          // Prefer <link rel="alternate">; fall back to first <link>
          const linkAlt = entry.querySelector(':scope > link[rel="alternate"]')
          const linkAny = entry.querySelector(":scope > link")
          const href = linkAlt?.getAttribute("href") || linkAny?.getAttribute("href") || ""
          const eTitle = entry.querySelector(":scope > title")?.textContent?.trim() || href
          const author = entry.querySelector(":scope > author > name")?.textContent?.trim() || undefined
          const pub = entry.querySelector(":scope > published, :scope > updated")?.textContent?.trim() || undefined
          const summary = entry.querySelector(":scope > summary, :scope > content")?.textContent?.trim() || undefined
          return { title: eTitle, url: href, author, publishedAt: pub, summary }
        })
        .filter(e => e.url)
      return { title, entries }
    }

    // RSS 1.0 / RDF — Phase 5 review fix: getElementsByTagNameNS handles namespaced tags
    const rdf = doc.getElementsByTagNameNS("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "RDF")[0]
                  || doc.getElementsByTagName("rdf:RDF")[0]
                  || doc.getElementsByTagName("RDF")[0]
    if (rdf) {
      const title = rdf.querySelector("channel > title")?.textContent?.trim() || "RDF Feed"
      const entries: FeedEntry[] = Array.from(rdf.querySelectorAll("item"))
        .map(item => {
          const link = item.querySelector(":scope > link")?.textContent?.trim() || item.getAttribute("rdf:about") || ""
          const eTitle = item.querySelector(":scope > title")?.textContent?.trim() || link
          return { title: eTitle, url: link }
        })
        .filter(e => e.url)
      return { title, entries }
    }

    return null
  } catch {
    return null
  }
}

/** Fetch + parse a feed URL. Returns null on parse failure (caller may try feed discovery). */
export async function fetchFeed(url: string): Promise<FeedResult | null> {
  try {
    const resp = await safeFetch(url)
    if (!resp.ok) return null
    const text = await safeReadText(resp)
    return parseFeedXml(text)
  } catch {
    return null
  }
}

/** Discover feed URL from a regular HTML page. Returns the feed URL or null. */
export async function discoverFeed(pageUrl: string): Promise<string | null> {
  // Try common paths first
  const common = ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml", "/index.xml", "/feeds/posts/default"]
  const origin = (() => {
    try {
      return new URL(pageUrl).origin
    } catch {
      return null
    }
  })()
  if (origin) {
    for (const path of common) {
      const candidate = origin + path
      const feed = await fetchFeed(candidate)
      if (feed && feed.entries.length > 0) return candidate
    }
  }
  // Try <link rel="alternate" type="application/rss+xml">
  try {
    const resp = await safeFetch(pageUrl)
    if (!resp.ok) return null
    const html = await safeReadText(resp)
    const m = html.match(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]+href="([^"]+)"/i)
    if (m) {
      try {
        return new URL(m[1], pageUrl).toString()
      } catch {
        return m[1]
      }
    }
  } catch {
    // ignore
  }
  return null
}

/** Parse OPML file content into a list of feed URLs. */
export function parseOpml(opmlText: string): Array<{ title: string; xmlUrl: string; htmlUrl?: string }> {
  try {
    const doc = new DOMParser().parseFromString(opmlText, "application/xml")
    if (doc.querySelector("parsererror")) return []
    const outlines = Array.from(doc.querySelectorAll("outline"))
    return outlines
      .map(o => ({
        title: o.getAttribute("title") || o.getAttribute("text") || "",
        xmlUrl: o.getAttribute("xmlUrl") || "",
        htmlUrl: o.getAttribute("htmlUrl") || undefined,
      }))
      .filter(o => o.xmlUrl)
  } catch {
    return []
  }
}

/** Fetch + merge multiple feeds (used for OPML import). */
export async function fetchMultipleFeeds(
  xmlUrls: string[],
  onProgress?: (idx: number, total: number, ok: boolean) => void,
): Promise<{ title: string; entries: FeedEntry[] }[]> {
  const results: { title: string; entries: FeedEntry[] }[] = []
  for (let i = 0; i < xmlUrls.length; i++) {
    const feed = await fetchFeed(xmlUrls[i])
    if (feed) results.push(feed)
    onProgress?.(i + 1, xmlUrls.length, !!feed)
  }
  return results
}
