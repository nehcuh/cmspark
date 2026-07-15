// Page link extractor (Phase C / v1.2).
//
// Self-contained runner injected into the active tab. Extracts all <a href> links,
// categorizes them, and returns the list. Used as the "Page Links" pathway in the
// importer UI — user can pick which links to bulk-import.
//
// Categories mirror Web Importer: internal (same domain) / external (different domain)
// / document (PDF/DOCX/XLSX) / media (audio/video).

export interface ExtractedLink {
  url: string
  text: string
  category: "internal" | "external" | "document" | "media"
}

/** Self-contained runner. args: [] */
export function extractPageLinksRunner(): Promise<{ ok: boolean; links?: ExtractedLink[]; error?: string }> {
  return (async () => {
    try {
      const pageHost = location.hostname
      const pageOrigin = location.origin
      const seen = new Set<string>()
      const links: ExtractedLink[] = []

      const anchorEls = document.querySelectorAll("a[href]")
      for (const a of Array.from(anchorEls)) {
        const rawHref = a.getAttribute("href") || ""
        // Skip empty / javascript: / fragment-only
        if (!rawHref || rawHref.startsWith("#") || rawHref.toLowerCase().startsWith("javascript:")) continue
        // Resolve relative URLs
        let url: string
        try {
          url = new URL(rawHref, pageOrigin).toString()
        } catch {
          continue
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) continue
        if (seen.has(url)) continue
        seen.add(url)

        const text = (a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || "").trim().slice(0, 200)
        let category: ExtractedLink["category"]
        try {
          const u = new URL(url)
          const pathLower = u.pathname.toLowerCase()
          const ext = pathLower.split(".").pop() || ""
          if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt"].includes(ext)) {
            category = "document"
          } else if (["mp3", "wav", "ogg", "m4a", "mp4", "webm", "mov", "avi", "mkv"].includes(ext)) {
            category = "media"
          } else if (u.hostname === pageHost) {
            category = "internal"
          } else {
            category = "external"
          }
        } catch {
          category = "external"
        }

        links.push({ url, text: text || url, category })
      }

      return { ok: true, links }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })()
}
