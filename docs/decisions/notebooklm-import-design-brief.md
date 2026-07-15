# NotebookLM Import — Design Brief (for 3-way advisor review)

**Date**: 2026-07-14
**Owner**: Claude (main session)
**Reviewers**: Kimi (via `kimi` CLI), Pi-substitute (via `claude` CLI — system has no `pi`)
**Goal**: Add the ability to import the current web page (and eventually broader content) into Google NotebookLM, integrated with the existing CMspark side panel.

## 1. Why this is interesting / non-trivial

NotebookLM (notebooklm.google.com) does NOT publish an API. Sources must be added through the web UI by:
- Pasting a URL (Google fetches; fails on many SPA / paywalled / anti-scraping sites)
- Uploading a file (PDF, txt, md, docx, …) up to 50 per notebook
- Pasting text
- Linking YouTube / Google Docs

Reference project **crazynomad/notebooklm-jetpack** (MIT, WXT+React) does:
1. Extract clean content from page (site-specific rules + Readability-like)
2. Generate a PDF client-side
3. **User manually drag-drops the PDF into NotebookLM** (no real automation)
4. Side features: read-later list (merge N→1 PDF to dodge 50-source cap), doc-site batch (sitemap), AI-chat extraction, podcast RSS download, history

So jetpack is essentially "fancy PDF extractor + drag-drop UX". It does NOT actually drive NotebookLM.

## 2. CMspark's unique leverage

CMspark already has capabilities jetpack lacks:

| Capability | File | Why it matters |
|---|---|---|
| CDP control of Chrome (`chrome.debugger.attach` + `sendCommand`) | `chrome-extension/src/background/browser-bridge.ts:142,155` | Can drive NotebookLM UI itself, not just hand off a file |
| **`DOM.setFileInputFiles` already used** | `browser-bridge.ts:907` | This is EXACTLY the CDP method needed to programmatically upload a file to a `<input type="file">` |
| Companion LLM + content processing | `companion/src/llm/`, `companion/src/obsidian/` | Can summarize / extract / clean content server-side |
| Existing side panel export pattern | `App.tsx:323` (📥 Obsidian), `message-router.ts:945` (`thread.export_obsidian`) | UI button → BG → WS → Companion → blob download — we can mirror this verbatim |
| Page sanitizer (anti prompt-injection) | `chrome-extension/src/background/page-sanitizer.ts` | Reusable to clean extracted content |
| Token-budgeted transcript builder | `companion/src/threads/summary-export.ts` | Reusable for "merge many tabs → single PDF" later |
| `Page.printToPDF` CDP method | (not yet used, but available once debugger attached) | Generate clean PDF **without adding puppeteer/PDFKit deps** |

The architecture basically gifts us this feature.

## 3. Open questions for the three of us to decide

### Q1. v1 scope — how ambitious?

| Option | What it does | Pros | Cons |
|---|---|---|---|
| **A. Minimal** | Side panel "📥 to NotebookLM" button. Extracts current tab's main content → generates PDF (CDP print-to-pdf or text→pdf) → Blob download. User manually drags into NotebookLM. | Mirrors existing Obsidian export pattern. Zero Google ToS risk. Ships tonight. | Not "1-click import" — user still drags. Less wow. |
| **B. Minimal + 1-click auto-upload** | A + Companion commands Chrome via CDP to open NotebookLM "add source" and inject the PDF via `DOM.setFileInputFiles`. | True 1-click. Showcases our CDP moat. | NotebookLM UI selectors change → breakage. Google ToS gray area (automated upload). Higher test burden. |
| **C. Minimal + open-target** | A + companion opens `notebooklm.google.com/<notebook-id>/sources` in new tab and copies PDF to clipboard, leaves drop to user. | Compromise: less brittle than B, smoother than A. | Still requires user to drop. Notebook URL needs config. |

**My current lean**: A first (lands the plumbing, ships tonight), B as an *opt-in toggle* in v1.1 once selectors are stable. C is the worst-of-both.

### Q2. Where to extract content — extension or companion?

| Layer | Pros | Cons |
|---|---|---|
| **Extension background** (content script + Readability-style) | Already has the tab; reuses `page-sanitizer`; no round-trip | Adds bundle weight; need to ship a readability lib (or write minimal extractor) |
| **Companion** (extension sends raw HTML; companion cleans) | Centralizes cleaning logic; can reuse for many features | Big payload over WS; redundant since extension already has the tab |
| **CDP-only** (no content script) — use `Runtime.evaluate` to grab `document.body.innerText` + `DOM.getOuterHTML` for the main article | No new deps; uses existing `browser-bridge.execute` plumbing | Loses Readability-grade boilerplate stripping |

**My current lean**: hybrid — extension uses CDP `Runtime.evaluate` to run a small extraction script (title + main-article text + canonical URL), sends *cleaned* text to companion. Companion formats as Markdown/HTML, generates PDF.

### Q3. PDF generation — where and how?

| Option | Pros | Cons |
|---|---|---|
| **CDP `Page.printToPDF`** on the original tab (after CSS cleanup) | Zero deps; pixel-perfect; uses existing Chrome | Print CSS may be poor; need to inject a "reader mode" stylesheet first; tab needs to stay attached during print |
| **Companion: html→pdf via `pdfjs-dist` (already dep, but it's a parser not writer)** | — | pdfjs-dist is **reader only** — can't generate |
| **Companion: add `pdfkit` or `puppeteer-core`** | Flexible layout | New dep; puppeteer-core needs a Chromium binary (already have via the user's Chrome but coupling is ugly); pdfkit needs manual layout |
| **Companion: markdown → HTML → CDP print via a hidden tab** | Best of both: clean MD content + Chrome rendering | Needs a hidden tab; more moving parts |
| **Skip PDF; paste text** | NotebookLM accepts pasted text; trivial | Loses formatting; size-limited |

**My current lean**: CDP `Page.printToPDF` on the original tab *after* injecting a reader-mode stylesheet + scrubbing nav/script/ads. Zero deps, leverages our CDP plumbing. Falls back to "Markdown text → Blob" if print fails.

### Q4. Tool vs side-panel button vs both?

Should this also be LLM-callable (a tool the agent can choose)?

- **Pro tool**: user can say "send this page to my NotebookLM" in chat
- **Con tool**: scope creep for v1; security confirmation overhead

**My current lean**: side-panel button + right-click context menu for v1. Tool wrapper in v1.1.

### Q5. Source targeting — current tab only, or also selection / link?

- Current tab only is simplest.
- Right-click on a link → import that link (matches jetpack).
- Right-click on a text selection → import selection.

**My current lean**: current tab + right-click "Send to NotebookLM" on page / link.

### Q6. Privacy & security considerations

- Extraction must honor the existing `page-sanitizer` pattern (anti-prompt-injection for content going to an LLM; here content goes into a PDF, so risk is lower, but still)
- Auto-upload via CDP requires the same kind of `SecurityConfirmationManager` gate as `evaluate` (cross-origin automation; high-risk)
- Right-click menu: must check host permissions for the active tab
- PDF can leak cookies/auth tokens if we print while the user is logged into a sensitive site — print should happen on a "cleaned" DOM

**My current lean**: Mirror obsidian-export security posture (no extra prompts for download path; require confirmation for any auto-upload path).

### Q7. Naming

- File: `companion/src/notebooklm/` (new top-level module, parallel to `obsidian/`)
- Message types: `page.import_notebooklm` / `page.imported_notebooklm` (parallel to `thread.export_obsidian` / `thread.exported_obsidian`)
- UI button: 📓 (notebook emoji) in header next to 📥
- Right-click menu: "Send to NotebookLM"

OK with that?

## 4. What I want from each of you

**Kimi** — you're the senior architect. Tell me:
1. Which scope option (A / B / C) and why
2. Where content extraction should live
3. PDF strategy
4. Anything I've missed (security, perf, MV3 service-worker lifecycle, etc.)

**Pi-substitute (claude CLI)** — you're the pragmatic engineer. Tell me:
1. Same scope question
2. Where you'd cut scope to ship tonight without regret
3. Concrete risks with the CDP `setFileInputFiles` auto-upload approach
4. Whether the existing obsidian-export code is the right template, or if it'd lead us astray

**Both** — if we agree on A/B/C and the extraction+PDF strategy, I'll proceed. If we disagree, I'll surface the disagreement to the user (in the morning) and pick the conservative branch overnight.

Reply format: short — `<choice>: <reason>` for each numbered question. No essays.
