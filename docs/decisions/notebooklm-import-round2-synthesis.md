# Round 2 — Adversarial Review Synthesis

**Status**: ✅ Both advisors returned `approve-with-changes`. Plan locked with the changes below.

## Adversary verdicts

### Kimi
- 1.X→Z: **中** — A1 alone insufficient for v1
- 2. detach try/finally: **中** — required
- 3. Selectors fragile: **中** — body fallback already in plan
- 4. innerText display:none: **低** — real tab OK
- 5. 200k configurable: **中**
- 6. Single commit: **低** — OK
- 7. Manual e2e + vitest failures: **中**
- 8. chrome:// CSP + filename injection + ToS: **高**

### Pi-sub
- 1. X→Z: **中** — A1 doesn't cover trivial string formatting; Z ships tonight, refactor to X in v1.1 with LLM
- 2. try/finally + onDetach + tabs.onRemoved: **中**
- 3. **Readability strongly recommended** (~70KB, MV3 OK); selector list fails on site #5
- 4. innerText / Shadow DOM / iframe: **低** — document, don't change impl
- 5. Truncation should be visible (banner), not silent
- 6. Single commit OK
- 7. Vitest with real article HTML snapshot — not synthetic DOM
- 8. **DOM mutation bug** (Pi-sub's catch): `root.querySelectorAll(...).forEach(e=>e.remove())` mutates the live page → must `cloneNode(true)` first

## Resolved plan changes

| # | Original | Final |
|---|---|---|
| Architecture | X (extension extracts → companion formats) | **Z (extension-only)**. Both advisors agree A1 doesn't bind for trivial formatting. |
| Extraction API | CDP `Runtime.evaluate` | **`chrome.scripting.executeScript`** — already used in browser-bridge; no debugger attach → no yellow banner; no detach lifecycle |
| DOM mutation | IIFE removes noise in-place on `root` | **`root.cloneNode(true)` first**, then strip noise on the clone |
| Readability | not used | **Defer to v1.1** — would need content-script bundling. Selector list + body fallback for v1; revisit if extraction quality fails on real sites. (Pi-sub "强烈建议" but also accepted "fallback 才用 selector" — for tonight, the simpler path wins.) |
| detach | (CDP-specific) | N/A — no CDP attach |
| Truncation | silent 200k cap | **Surface a banner in side panel** when truncated |
| Filename | derived from title | **Sanitize**: strip `#`/`/`/`:`/control chars; cap length; yaml-injection guard |
| Tests | "manual e2e" | Manual e2e + **vitest unit for extractor IIFE** with one real article HTML snapshot |

## Final v1 plan (locked)

**Files**:
1. `chrome-extension/src/notebooklm/extractor.ts` — pure `extractPageContent(doc: Document): {title, url, text, truncated}` (jsdom-testable)
2. `chrome-extension/src/notebooklm/markdown-builder.ts` — pure `buildMarkdown({title, url, text, extractedAt}): {content, filename}`
3. `chrome-extension/src/background/notebooklm-handler.ts` — orchestrator: get active tab → inject + run extractor via `chrome.scripting.executeScript` → format → return `{content, filename, truncated}`
4. `chrome-extension/src/background/index.ts` — add case `"page.import_notebooklm"` → call handler → `sendResponse({ok, content, filename, truncated})`
5. `chrome-extension/src/sidepanel/App.tsx` — 📓 button next to 🧠; on click send runtime message; on response trigger Blob download + truncated banner
6. `chrome-extension/src/notebooklm/extractor.test.ts` — vitest with jsdom + 1 real article HTML snapshot

**Flow** (no companion involved in v1):
```
[Side panel 📓] → chrome.runtime.sendMessage({type:"page.import_notebooklm"})
                ↓
[Background] → get active tab → chrome.scripting.executeScript({func: extractRunner})
                ↓ returns {title, url, text, truncated}
[Background] → buildMarkdown({title, url, text, extractedAt: now})
                ↓
[Background] → sendResponse({ok:true, content, filename, truncated})
                ↓
[Side panel] → Blob download + if truncated, show banner "内容过长已截断"
```

**extractor.ts** (the runner injected via scripting):
```ts
export interface ExtractResult { title: string; url: string; text: string; truncated: boolean }

// This function is stringified and injected via chrome.scripting.executeScript.
// It MUST be self-contained (no external imports, no closure over extension state).
export function extractPageContentRunner(maxLen: number): ExtractResult {
  const title = document.title || ""
  const url = (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || location.href
  const candidates = ['article','main','[role="main"]','#content','#main','.post','.article','.entry-content','.post-content','.article-body']
  let root: Element | null = null
  for (const sel of candidates) {
    const el = document.querySelector(sel)
    if (el && (el.innerText || "").trim().length > 200) { root = el; break }
  }
  if (!root) root = document.body
  // Clone before mutate — NEVER touch live DOM
  const clone = root.cloneNode(true) as Element
  clone.querySelectorAll('script,style,noscript,nav,aside,footer,header,form,iframe,[role="navigation"],[aria-hidden="true"]').forEach(e => e.remove())
  const fullText = (clone.textContent || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  const truncated = fullText.length > maxLen
  const text = truncated ? fullText.slice(0, maxLen) + "\n\n[... content truncated at " + maxLen + " chars]" : fullText
  return { title, url, text, truncated }
}
```

**markdown-builder.ts**:
```ts
const MAX_TITLE_SLUG = 40

function slugify(s: string): string {
  // Keep CJK + alphanumeric + dash; everything else → '-'
  const cleaned = s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
  return cleaned.toLowerCase().slice(0, MAX_TITLE_SLUG) || "untitled"
}

function escapeYaml(s: string): string {
  // Always quote; escape backslash and double-quote; collapse newlines
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ").slice(0, 500) + '"'
}

export function buildMarkdown(args: {title: string; url: string; text: string; extractedAt: Date}):
  { content: string; filename: string } {
  const iso = args.extractedAt.toISOString()
  const yyyymmdd_hhmmss = iso.slice(0,10).replace(/-/g,"") + "-" + iso.slice(11,19).replace(/:/g,"")
  const content = `---
title: ${escapeYaml(args.title)}
source_url: ${escapeYaml(args.url)}
extracted_at: ${iso}
extracted_via: CMspark Browser Agent
---

# ${args.title.replace(/[\r\n]+/g, " ").slice(0, 200)}

> Source: ${args.url}
> Extracted: ${iso}

---

${args.text}

---

*Exported by CMspark Browser Agent → drag this file into [NotebookLM](https://notebooklm.google.com) as a source.*
`
  const filename = `notebooklm-${yyyymmdd_hhmmss}-${slugify(args.title)}.md`
  return { content, filename }
}
```

**Default truncation**: 200_000 chars (NotebookLM accepts up to ~500KB; we leave headroom for the frontmatter and footer). Kimi suggested making it configurable — for v1, hardcoded; surface banner when hit; v1.2 add a settings field.

Proceed.
