# v1.1 Design Brief — NotebookLM Full Import Capability

**Date**: 2026-07-15
**Supersedes / extends**: v1 (ADR-011, MD download only)
**Goal**: Match + differentiate vs `crazynomad/notebooklm-jetpack` and `eluchansky10/notebooklm-web-importer`

## What v1.1 must deliver

User explicit ask: "1 和 2 的能力我都想要" — that is:

**From option 1 (parity with Web Importer)**:
- Fetch interception (primary path)
- DOM automation (fallback path)
- Batch import (100+ URLs/tabs)
- Notebook creation (`batchexecute` RPC)
- Selector CI canary
- Resilience (progress persistence, crash recovery, retries)

**From option 2 (differentiation via CMspark's CDP moat)**:
- **CDP-based** fetch interception (no content-script injection — market unique)
- AI chat extraction (Claude / ChatGPT / Gemini → text source)
- Keep offline MD download as fallback (preserve v1 code)

**Stretch (P2)**:
- Multi-tab batch, page-link extractor, RSS/OPML, YouTube playlist

## Critical research findings (Phase 0 output — read before advising)

Reverse-engineered both extensions' actual code (not just README claims):

1. **Web Importer's fetch interception is dead code.** `services/notebooklm-fetch-interceptor.ts` defines `replayRequest` with **zero call sites**. The capture works (request shape stored), but `import-engine.ts:177` always routes through DOM automation. **In production, neither extension actually replays captured requests.**

2. **Both extensions do pure DOM automation in production.** jetpack ~1.5s/import via `chrome.scripting.executeScript`; Web Importer identical. This is the proven path.

3. **List notebooks works via `batchexecute` RPC `wXbhsf`** (jetpack's `services/notebook-api.ts`). CSRF token = `SNlM0e` regex extract from `notebooklm.google.com/` HTML. `credentials: 'include'` handles auth (no explicit cookie list).

4. **Neither extension creates notebooks via API.** Both require user to have an existing notebook open. `notebooklm-py` mentions an undocumented `boVbkv` RPC for create but neither Chrome extension verifies or uses it.

5. **Auth prerequisites**: only `host_permissions: notebooklm.google.com/*` + user being logged in. No OAuth, no API key (YouTube API key is separate for playlists).

6. **CDP `Fetch.enable` + `Fetch.continueRequest` is technically feasible** but: (a) yellow debugger banner UX cost; (b) body is `f.req=...&at=...` URL-encoded — decoding/encoding needed for clean URL substitution (regex is fragile); (c) CSRF rotates per session.

7. **Top 10 selectors** (jetpack verified):
   - `.add-source-button` (open Add Source dialog)
   - `mat-dialog-container` / `[role="dialog"]` (dialog open detect)
   - `.urls-input-container textarea` (URL field)
   - `.copied-text-input-textarea` (pasted-text field)
   - `.drop-zone-icon-button` filtered by inner icon text (`link` / `content_paste`)
   - `mat-dialog-container .submit-button` (Insert/Save/Confirm)
   - `.single-source-container` (source row detect for "newly added" diff)
   - `.source-title` / `.source-title-column`
   - `.source-item-more-button` (3-dot menu)
   - `.scroll-area-desktop` (source-list container)

## Revised architecture questions (post-research)

### Q1. Import mechanism
**Option A**: Pure DOM automation (jetpack/Web Importer proven path, ~1.5s/import)
**Option B**: CDP `Fetch` interception (market-unique, but unproven in practice — Web Importer wrote the code then disabled it)
**Option C**: Both — DOM automation primary, CDP interception as **opt-in** accelerator for power users

**My lean**: A for v1.1 ship. C as v1.2 research when we have time to validate the CDP path properly. Don't ship CDP interception unproven.

### Q2. Notebook management
**Option A**: List via `batchexecute` `wXbhsf` (proven). Skip create — user creates in UI, we add sources.
**Option B**: A + Create via reverse-engineering `boVbkv` ourselves (unverified)
**Option C**: A + Create via DOM automation (click "New notebook" button + type name) — slower but proven

**My lean**: A. List is well-understood. Create adds risk for unclear value — user creating a notebook manually is one click. C is a fallback if user really wants create.

### Q3. Selector drift
**Option A**: `MutationObserver` self-healing — runtime fallback
**Option B**: CI canary — early warning
**Option C**: Both

**My lean**: A first (cheap, runs in product). B as v1.2 dev-infra.

### Q4. AI chat extraction scope
**Option A**: Per-site scrapers for Claude / ChatGPT / Gemini (precise but brittle)
**Option B**: Generic article extractor (our v1 `extractPageContentRunner`) — loses Q&A structure
**Option C**: Per-site scrapers + Companion LLM post-processing (CMspark moat)

**My lean**: B for v1.1 ship (cheap, reuse v1 code). C as v1.2 differentiation.

### Q5. MD offline button integration
**Option A**: Two separate buttons (📓 online import, 💾 offline MD)
**Option B**: One button with mode dropdown
**Option C**: One button, online-first with offline fallback

**My lean**: A. Clear separation.

### Q6. Scope cut for overnight ship
The original 13-day estimate is unrealistic for one session. Honest scope:

**Ship tonight (P0)**: DOM automation, selector registry, batch state machine, UI, list notebooks RPC
**Ship tonight (P1, time-permitting)**: AI chat extraction (B path — generic), notebook picker dropdown
**Defer to next session (P2)**: CDP interception, create notebook, RSS/OPML, YouTube, page link extractor, CI canary

**My lean**: Above. Be honest about what ships vs what's deferred.

## What I want from each advisor

**Kimi**: Architect-level. Are my Q1-Q6 leans right given the research? What am I missing re: Google account flagging risk if we drive DOM aggressively (100+ imports in a row)?

**Pi-sub**: Engineer-level. Concrete failure modes of: (a) DOM automation in MV3 service worker lifecycle (chrome.scripting.executeScript from SW), (b) CSRF token caching invalidation, (c) React/Angular state desync when we drive UI faster than it can render.

Both: short, decisive, per-question format `<choice>: <reason>`.

## Reference architectures (verified from source)

### crazynomad/notebooklm-jetpack
- Pure DOM automation (`entrypoints/notebooklm.content.ts`, 1823 LOC)
- Three-tier selector fallback (class → icon → text)
- Uses `batchexecute` only for **listing** notebooks (read-only)
- No fetch interception; selector drift mitigated by `scripts/check-selectors.mjs` CI canary
- PDFs and podcasts still require manual drag

### eluchansky10/notebooklm-web-importer
- **Dual automation**: Tier 1 fetch interception (primary, ~500ms/import), Tier 2 DOM automation (fallback, ~1.5s/import)
- "Priming" UX: user manually adds one source → interceptor captures request shape → batch replays with substituted URL
- 5 pathways: Links, Tabs, Page Links, YouTube Playlists, RSS/Atom + OPML
- Progress persists in service worker; crash recovery via checkpoint
- Failed URLs retried up to 2× with exponential backoff
- Selector registry with CSS + text + ARIA + role strategies
- Does NOT do "Google login" — relies on user being already signed in
- WXT + React + Tailwind + shadcn/ui

### nlmtools / NotebookLM Tools (closed source)
- 90k+ users
- Adds: notebook create/rename/organize, source merge, dedup, folders, tags, custom prompts, backup/restore
- We can't read their code, but feature surface implies aggressive `batchexecute` use

## Key insight: where CMspark differentiates

All existing extensions are **pure MV3 extensions** with content scripts. CMspark has **CDP via `chrome.debugger`** already wired (`browser-bridge.ts:142` etc.). This unlocks:

| Capability | Pure MV3 (jetpack / Web Importer) | CMspark via CDP |
|---|---|---|
| Capture API request | Inject `window.fetch` wrapper | `Network.requestWillBeSent` event — captures BEFORE any SPA wrapper sees it |
| Block / modify request | Can wrap, but page's own code can re-unwrap | `Fetch.enable` + `Fetch.continueRequest` — Chrome-level interception |
| Set file input files | `DataTransfer` hack (fragile) | `DOM.setFileInputFiles` (already used at browser-bridge.ts:907) |
| Drive UI | `chrome.scripting.executeScript` (works) | Either scripting OR `Input.dispatchKey` / `Input.dispatchMouseEvent` for truer simulation |
| Persistence of debug session | N/A | Yellow "正在调试" banner is the only UX wart |

The **fetch interception via CDP `Fetch` domain** is the market-unique angle. Web Importer does fetch interception but via injected wrapper — easier to defeat, can be unwrapped by SPA code. CDP-level interception is bulletproof.

Trade-off: yellow debugger banner. Mitigation: only attach during active batch import; detach when idle.

## 6 architecture questions for 3-way decision

### Q1. Fetch interception method
**Option A**: Content-script-injected `window.fetch` / `XMLHttpRequest` wrapper (jetpack/Web Importer style)
**Option B**: CDP `Fetch.enable` + `Fetch.continueRequest` (Chrome-level, requires debugger attach — yellow banner)
**Option C**: CDP `Network.requestWillBeSent` (capture only, can't modify; use for priming then replay via fetch from extension BG)
**Option D**: Hybrid — CDP `Network` for capture (priming), `chrome.scripting` for replay (no continued debugger attach)

**My lean**: D. CDP `Network` captures the request cleanly (no SPA wrapper defeat), then we replay from background via standard fetch with the user's cookies attached (`credentials:'include'`). Avoids long debugger attach.

### Q2. Priming UX acceptability
Web Importer requires the user to **manually add one source** to "teach" the extension the request shape, then batch replays. This is clever but adds friction (first-time user has to do a manual step before bulk works).

**Option A**: Require priming, with in-product walkthrough
**Option B**: Skip priming — hardcode the API shape (URL + body template) based on jetpack/Web Importer reverse-engineering. Re-validate the shape periodically (selector-CI canary equivalent for API).
**Option C**: Skip priming — fall back to DOM automation if no API template cached

**My lean**: B. We already have Web Importer's source to lift the API shape from. Hardcoding avoids UX friction. Risk: API shape changes → silent breakage. Mitigation: API-shape CI canary (a script that does one add and asserts the response shape).

### Q3. `batchexecute` write operations (create notebook) — ToS red line?
Listing notebooks (read-only) is one thing. **Creating** notebooks via `batchexecute` is a write to a private RPC. Risks:
- Account flagging / throttling
- Google ToS violation (their `batchexecute` is internal)
- If Google changes the RPC, we silently break

**Option A**: Do it. Match Web Importer's feature surface. User explicitly asked.
**Option B**: Don't do create. Require user to create notebook in NotebookLM UI; we only list + add sources.
**Option C**: Do it, but with explicit user opt-in toggle + per-call rate limit

**My lean**: A. User explicitly asked for create. Web Importer / nlmtools already do it and aren't banned. Add throttle (≥1s between writes) and surface in UI as "experimental".

### Q4. Selector drift handling
**Option A**: `MutationObserver` self-healing — watch for selector misses and try fallbacks dynamically
**Option B**: CI canary (jetpack style) — `scripts/check-selectors.mjs` runs in CI, asserts selectors exist on `notebooklm.google.com`
**Option C**: Both — A for runtime resilience, B for early warning

**My lean**: C. Belt and suspenders.

### Q5. AI chat extraction scope
Jetpack extracts Q&A from Claude / ChatGPT / Gemini pages. Each has a different DOM.

**Option A**: Per-site scrapers (3 scrapers, brittle but precise)
**Option B**: Single generic "article extractor" (reuse our v1 `extractPageContentRunner`) — loses Q&A structure
**Option C**: Per-site scrapers + LLM post-processing (CMspark has Companion LLM) — extract DOM heuristically, then LLM reformats into clean Q&A

**My lean**: C. CMspark's Companion LLM is our moat — let it clean up the extraction.

### Q6. MD offline fallback integration
v1 has the 📓 MD download button. v1.1 adds online import.

**Option A**: Two separate buttons (📓 online import, 💾 offline MD)
**Option B**: One button with three modes (online / offline / both) in a dropdown
**Option C**: One button that tries online first, falls back to MD on failure

**My lean**: A. Clear separation. Users who want offline (privacy / NotebookLM down) get it without thinking.

## What I want from each advisor

**Kimi**: Architect-level critique. Are my Q1-Q6 leans right? What am I missing? Especially ToS / Google-account-flag risk for Q3.

**Pi-sub**: Engineer-level. Where will this fall over in implementation? CDP `Fetch` domain gotchas? chrome.debugger.attach lifecycle across batch imports? React-state-machine pitfalls for the batch UI?

Both: short, decisive, per-question format `<choice>: <reason>`.
