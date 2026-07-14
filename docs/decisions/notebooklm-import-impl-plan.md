# Phase 2 — Implementation Plan (v1, MD-only)

## Goal (locked)

Side panel button 📓 → extract current tab's main content → wrap as frontmatter Markdown → Blob download `.md`. The user then drags the file into NotebookLM (manual step, intentionally).

## Architecture (locked at Round 1)

```
[Side panel 📓 button]
    │ chrome.runtime.sendMessage({type:"page.import_notebooklm", tab_id?})
    ▼
[Background index.ts onMessage]
    │ passthrough → wsClient.send(message)
    ▼
[Companion message-router.ts case "page.import_notebooklm"]
    │ looks up the tab via tab-resolver (or uses rest.tab_id)
    │ calls bridge.extraction (via existing browser bridge round-trip)
    ▼
[Tab-side extraction]
    │ CDP Runtime.evaluate runs a small IIFE in the page:
    │   - grab document.title, canonical URL, <article> | <main> | fallback to body
    │   - innerText (no HTML, no scripts, no event handlers)
    │   - return { title, url, text, extracted_at }
    ▼
[Companion notebooklm/markdown-builder.ts]
    │ wraps in frontmatter + H1 title + source link + fenced quoted text
    ▼
[Companion returns {type:"page.imported_notebooklm", content, filename}]
    ▼
[Extension BG → useWebSocket.ts case "page.imported_notebooklm"]
    │ Blob download
    ▼
[user drags .md into NotebookLM]
```

## Files to add / change

### NEW

1. **`companion/src/notebooklm/markdown-builder.ts`** — pure function `buildNotebookMarkdown({title, url, text, extractedAt}): {filename, content, format}`. Mirrors `obsidian/markdown-export.ts` shape. No IO, no LLM.

### MODIFIED

2. **`chrome-extension/src/background/browser-bridge.ts`** — add private method `extractMainContent(params)`:
   - attach debugger (existing `ensureAttached`)
   - `Runtime.evaluate` with an IIFE string that returns `{title, url, text}` via `JSON.stringify`
   - detach (or rely on existing auto-detach on tab close — need to verify)
   - Return `{success:true, data:{title,url,text}}`

3. **`chrome-extension/src/background/index.ts`** — add new case in `onMessage`:
   - `case "page.import_notebooklm"` — passthrough to `wsClient.send(message)` (alongside `thread.export_obsidian`)

4. **`companion/src/message-router.ts`** — add `case "page.import_notebooklm"`:
   - read `rest.tab_id` (optional; if absent, companion asks for active tab via existing `tabs` mechanism)
   - Actually — **simpler**: extension extracts *before* sending to companion. Companion just formats. This avoids a Companion→Extension round-trip for content.
   - **Revised**: side panel button → BG handler → `browserBridge.execute("extract_main_content", {tabId})` → companion-side... wait.

   **Architecture decision needed**: where does extraction actually happen?

   Option X: Extension extracts via CDP, sends text to companion for formatting. Companion is dumb formatter.
   Option Y: Extension just sends `tab_id` to companion; companion asks extension back via WS to extract; extension extracts via CDP; returns to companion; companion formats.
   Option Z: Extension does the WHOLE thing (extract + format) in the BG; companion not involved.

   - X is cleanest: extension already has the tab and CDP; formatting is trivially in-extension too. Companion is only needed if we want server-side processing (LLM summary, etc.).
   - Z is simplest: ship the whole thing in extension. Skip companion entirely for v1.
   - Y is most symmetric with obsidian flow but adds a round-trip.

   **Pi-sub earlier said**: "Extension via CDP `Runtime.evaluate` (your hybrid): tab is already attached, no raw-HTML WS payload, reuses `browser-bridge.execute`; companion only formats."

   So Pi-sub's stance is X. But Z is even simpler. Let me think:
   - Pro Z: fewer moving parts, no WS round-trip, ships fastest, easier MV3 SW lifecycle
   - Pro X: matches existing obsidian-export pattern (companion owns formatting, easier to extend in v1.1 with LLM summary etc.)
   - Pro Y: doesn't really exist; Pi-sub didn't actually endorse it

   **My call**: **Z for v1** — extension-side end-to-end. We can refactor to X in v1.1 when we want server-side enrichment. The obsidian-export pattern is a *template*, not a requirement. Pi-sub's earlier "companion only formats" was under the assumption of mirroring obsidian — but for a simpler v1 with no LLM step, doing it all in the extension is cleaner.

   I'll surface this in adversarial review.

5. **`chrome-extension/src/sidepanel/App.tsx`** — add 📓 button in header between 🧠 and 📋:
   ```tsx
   <button onClick={() => {
     chrome.runtime.sendMessage({ type: "page.import_notebooklm" })
   }} title="导出当前页到 NotebookLM">📓</button>
   ```

6. **`chrome-extension/src/sidepanel/hooks/useWebSocket.ts`** — add case `page.imported_notebooklm` (Blob download, mirror `thread.exported_obsidian`).

### Per choice Z (extension-only):

Drop modifications to `companion/message-router.ts` and skip new `companion/notebooklm/*` files entirely. All logic in extension BG.

Actually — given the project's existing architecture is "extension is thin, companion does the heavy lifting" (per CLAUDE.md A1: "Extension 只做浏览器操作，LLM 推理和状态管理在 Companion"), Z violates the architectural intent. Let me reconsider.

**Final call**: X (companion formats). Keeps architecture consistent. The cost is one WS round-trip with text payload — bounded by PER_MESSAGE_CAP (already 2000 in summary-export; we'll do similar truncation here for very long pages, or warn user).

Actually wait, the side panel doesn't have CDP access — the background does. And the side panel calls `chrome.runtime.sendMessage` to the background. So the natural flow is:

1. Side panel 📓 → `chrome.runtime.sendMessage({type:"page.import_notebooklm"})`
2. BG receives → extracts via CDP `Runtime.evaluate` → has `{title, url, text}`
3. BG forwards to companion: `wsClient.send({type:"page.import_notebooklm", title, url, text})`
4. Companion formats as MD, returns `{type:"page.imported_notebooklm", content, filename}`
5. BG / side panel receives → Blob download

Yes — X is the right pattern. BG owns CDP extraction; companion owns MD formatting (consistent with A1).

## Extraction IIFE (the actual JS injected via Runtime.evaluate)

```js
(() => {
  const title = document.title || "";
  const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
  // Pick the densest "article-ish" element
  const candidates = [
    'article',
    'main',
    '[role="main"]',
    '#content', '#main', '.post', '.article', '.entry-content'
  ];
  let root = null;
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 200) { root = el; break; }
  }
  if (!root) root = document.body;
  // Strip obvious noise
  root.querySelectorAll('script,style,noscript,nav,aside,footer,header,form,iframe,[role="navigation"]').forEach(e => e.remove());
  const text = (root.innerText || "").trim();
  return JSON.stringify({ title, url: canonical, text });
})()
```

Note: `innerText` is live (computed-style aware); better than `textContent` for readability. We return JSON-stringified result; `Runtime.evaluate` wraps in `{result:{value:"<json>"}}`.

**Cap text length**: `text.slice(0, 200_000)` — NotebookLM accepts up to ~500KB text sources; 200k chars gives headroom. If truncated, append `\n\n[... content truncated at 200k chars]`.

## Markdown template

```markdown
---
title: "{title}"
source_url: "{url}"
extracted_at: "{ISO date}"
extracted_via: CMspark Browser Agent
---

# {title}

> Source: {url}
> Extracted: {ISO date}

---

{text}

---

*Exported by CMspark Browser Agent → drag this file into [NotebookLM](https://notebooklm.google.com) as a source.*
```

Filename: `notebooklm-{YYYYMMDD-HHmmss}-{slug-of-title}.md`. Slug = first 40 chars of title, lowercased, non-alphanumeric → `-`, trimmed.

## Test plan

### Unit (where applicable)
- `markdown-builder.ts`: snapshot tests for typical inputs (short page, long page, missing title, special chars in title)
- Extraction IIFE: extract to a `.ts` file with the IIFE as an exported string, write a vitest using jsdom for a couple of synthetic DOMs (article present, only body, no canonical link)

### Integration
- Load extension → navigate to https://example.com → click 📓 → verify .md downloads with reasonable content
- Load extension → navigate to a real article (e.g. a Substack post) → click 📓 → verify .md is readable and >500 chars

### E2E (manual, since no e2e harness)
1. Load extension dev build
2. Open a tab to a known article
3. Click 📓
4. Verify `.md` file downloads
5. Open NotebookLM, create notebook, drag .md in
6. Verify NotebookLM ingests without error
7. Ask NotebookLM a question about the content; verify it can answer

## Commit plan

Single commit on the worktree branch:

```
feat(notebooklm): import current page as Markdown for NotebookLM

Adds 📓 side-panel button that extracts the current tab's main content via CDP
Runtime.evaluate, formats it as frontmatter Markdown in companion, and triggers
a Blob download. The user then drags the .md into NotebookLM as a source.

v1 is intentionally minimal (download path only). Auto-upload via CDP
setFileInputFiles and PDF generation are deferred to v1.1 pending real user
demand and cookie/auth-bleed mitigation.

Design: docs/decisions/notebooklm-import-design-brief.md
3-way advisor synthesis: docs/decisions/notebooklm-import-round1-synthesis.md
```

## What's deferred to v1.1+

- Right-click context menu
- PDF generation (with auth-element stripping)
- CDP auto-upload to NotebookLM
- LLM tool wrapper
- "Merge multiple tabs → single source" (jetpack's 50-source-dodge)
- Doc-site batch (sitemap-aware)
- AI-chat extraction (Claude/ChatGPT/Gemini conversation pages)

## Open questions for adversarial review

1. Architecture choice: X (extension extracts, companion formats) vs Z (extension-only). I picked X for A1 consistency. Is the WS round-trip worth it?
2. Should extraction live as a **tool** (callable from LLM) — we said no, but verify the BG-side browser bridge isn't tool-only
3. Service-worker lifecycle: the extraction is one CDP round-trip — short enough to not need keep-alive. Confirm.
4. CDP detach: do we need to explicitly `chrome.debugger.detach` after `Runtime.evaluate`, or does it auto-clean? (We're not attaching for uploadFile — just one-shot evaluate. We should detach.)
5. Is there a `tab_id` resolution issue? The side panel sends no tab_id; BG should default to `chrome.tabs.query({active:true, currentWindow:true})`.
6. MV3 permission needed for `chrome.tabs.query({active,currentWindow})`: already in manifest (`tabs`, `activeTab`). ✅
