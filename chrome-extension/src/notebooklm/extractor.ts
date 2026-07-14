// Page-content extractor for NotebookLM import.
//
// The runner `extractPageContentRunner` is injected into the active tab via
// `chrome.scripting.executeScript`. It MUST be self-contained (no external imports,
// no closure over extension state) because Chrome serializes the function source.
//
// Key invariants (caught in Round 2 adversarial review):
//  - **Never mutate the live DOM**: clone the article root before stripping noise.
//    Mutating in-place would visibly break the user's tab.
//  - **Strip auth-bearing noise**: nav/footer/aside/iframe removed so the
//    exported text doesn't bleed logged-in account chips (Round 1 risk: cookie/auth bleed).
//    `header` is NOT stripped — many articles render the in-body H1/byline inside
//    `<article><header>…</header></article>`; we'd drop the title.
//  - **Bound the payload**: 200k char cap with a tail marker, surfaced to the UI as a banner.
//  - **Selector fallback chain**: most-specific (article/main) → class hints → body.
//    Known weak on SPA/Shadow-DOM/Substack paywall; v1.1 will adopt @mozilla/readability.

export const MAX_TEXT_LENGTH = 200_000

/**
 * Selectors tried in order. Tuned for blog / docs / news articles.
 * Add to this list rather than special-casing sites — keep it cheap.
 */
export const EXTRACTOR_SELECTORS = [
  "article",
  "main",
  '[role="main"]',
  "#content",
  "#main",
  ".post",
  ".article",
  ".entry-content",
  ".post-content",
  ".article-body",
  ".markdown-body",
] as const

export interface ExtractResult {
  title: string
  url: string
  text: string
  truncated: boolean
}

/**
 * Injected into the page. Self-contained — references only its args and browser globals.
 * The string `selectorsJSON` is produced by JSON.stringify(EXTRACTOR_SELECTORS) in the
 * handler, so the runner source stays generic.
 *
 * @param maxLen  hard cap on returned text length (chars)
 * @param selectorsJSON  JSON-stringified array of CSS selectors to try in order
 */
export function extractPageContentRunner(maxLen: number, selectorsJSON: string): ExtractResult {
  const title = document.title || ""
  const canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
  const url = (canonical && canonical.href) || location.href

  // Parse selector list defensively. If the caller (BG) sends malformed JSON, fall back to
  // a minimal safe list rather than throwing — keep the runner robust against future bugs.
  let selectors: string[] = ["article", "main"]
  try {
    const parsed = JSON.parse(selectorsJSON)
    if (Array.isArray(parsed) && parsed.every(s => typeof s === "string")) {
      selectors = parsed
    }
  } catch {
    // keep default
  }
  let root: Element | null = null
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel)
      if (el) {
        // Read textContent on the LIVE element only for the >200-char fitness check;
        // no mutation here. textContent is the right choice (no reflow on the live read;
        // innerText would force layout on every iteration).
        const txt = el.textContent || ""
        if (txt.trim().length > 200) {
          root = el
          break
        }
      }
    } catch {
      // Invalid selector on this page — skip silently.
    }
  }
  if (!root) root = document.body

  // **Clone before mutate** — never touch the live DOM.
  const clone = root.cloneNode(true) as Element
  clone
    .querySelectorAll(
      "script,style,noscript,nav,aside,footer,form,iframe,svg,canvas,[role='navigation'],[aria-hidden='true']",
    )
    .forEach(e => e.remove())

  // **textContent is the only path**. innerText is layout-aware but returns "" on detached
  // nodes — and `cloneNode(true)` is detached by definition, so innerText would always be
  // the dead branch. textContent works uniformly on live + detached, no reflow cost.
  const raw = clone.textContent || ""
  const cleaned = raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  const truncated = cleaned.length > maxLen
  const text = truncated
    ? cleaned.slice(0, maxLen) + "\n\n[... content truncated at " + maxLen + " chars]"
    : cleaned

  return { title, url, text, truncated }
}
