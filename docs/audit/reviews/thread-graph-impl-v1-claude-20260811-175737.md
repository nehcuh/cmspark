## Dual external review — Thread Graph v1 implementation

**Batch:** `thread-graph-impl-v1` · **Stage:** Implementation gate · **Date:** 2026-08-11
**Reviewer verdict scope:** ADR-020 checklist + R1–R5 + product pins TG-1…TG-6

### Capability declaration

Present in the prompt (`Surface L0 / Compose none / Autonomy none / Trust no elevation / Channel unchanged`) and **matches the diff scope**: new full-page UI tab + slim SW snapshot + force-layout pure function. No L2 tool, no new gate, no new originWs confirm. Declaration is accurate. `[inspected]`

### Patch freshness

Patch file (`thread-graph-impl-v1-diff-20260811-175737.patch`) matches `git status` (icons + `generate-icons.mjs` + `ThreadList.tsx` + `thread-related.ts` + `background/index.ts` + `tsconfig.test.json` + `host-integrity.ts` SHA256 bump; new `tabs/thread-graph.tsx`, `thread-graph/`, `background/thread-graph.ts`, three test files). Not stale. `[executed: git status, diff]`

### Product pins (all hold)

| Pin | Verification |
|---|---|
| **TG-1** full-page tab | `chrome-extension/src/tabs/thread-graph.tsx:1-8` (Plasmo page), `background/thread-graph.ts:5` `THREAD_GRAPH_PATH = "tabs/thread-graph.html"`, `openOrFocusThreadGraph` calls `chrome.tabs.create({url, active:true})` (line 103). Pattern matches `tabs/cockpit.tsx`. `[inspected]` |
| **TG-2** force-directed canvas, hard/soft edges | `force-layout.ts` implements repulsion + spring + center gravity + damping + collisions + walls (lines 77-182). `ThreadGraphApp.tsx:230-244` renders to `<canvas>`, hard=`strokeStyle rgba(79,70,229,.45)` solid, soft dashed. Not text rows. `[inspected]` |
| **TG-3** open thread keeps graph tab open | `open_thread` handler at `background/index.ts:1257-1280` only sends WS `thread.select`, broadcasts `thread_graph.thread_selected`, and calls `chrome.sidePanel.open`. **No `chrome.tabs.remove` on the graph tab.** Grep confirms only `notebook-api.ts:277` and `browser-bridge.ts:323` call `tabs.remove` — neither reachable from `thread_graph.*`. `[executed: grep]` |
| **TG-4** side-panel edge list removed | `ThreadList.tsx` diff deletes `graphOpen` state, `graphEdges` memo, `graphOverlay` portal, `graphCard`/`graphList`/`graphEdgeRow` styles, and the `buildRelatedEdges` import. `[inspected]` |
| **TG-5** slim snapshot, local edges | `ThreadGraphSlim` type (`background/thread-graph.ts:10-23`) carries only id/alias/agent_role/trashed_at/digest{tldr,tags,bullets,stale}. `prepareThreadGraphSnapshot` filters trash + worker, caps to 300, writes `chrome.storage.session`. `ThreadGraphApp.tsx:97-107` calls `buildRelatedEdges` locally. `[inspected]` |
| **TG-6** no embedding/Knowledge/L2 | No imports of `knowledge/`, no new tool registered, no new gate. `[inspected]` |

### Privacy (R2)

Slim mapping at `ThreadList.tsx:391-420` copies only `digest.tldr/tags/bullets/stale` — does **not** include `extracted_at`, `content_fingerprint`, `source`, `model`, or any message body. Verified `Thread.digest` shape at `sidepanel/types.ts:63-73`. Snapshot storage is `chrome.storage.session` (in-memory, extension-scoped, not persisted). `[inspected]`

### Tests (R4) — `[executed: node --test]`

`12/12 pass` across the three new/extended files. Coverage maps to spec G7:

- `force-layout.test.ts:9-16` ring finite & distinct; `:18-32` run energy finite + in-bounds + finite velocities; `:34-47` pinned no-move.
- `thread-graph-bg.test.ts:10-12` `THREAD_GRAPH_PATH` constant; `:14-19` URL matcher; `:21-27` TTL freshness.
- `thread-related.test.ts:44-64` kind=hard on shared tags, kind=soft on TF-only.

`tsc -p tsconfig.test.json --noEmit` clean; `tsc --noEmit` clean.

### Rejection gates

| # | Gate | Result |
|---|---|---|
| R1 | UI still only side-panel text list | **Pass** — canvas force-directed, side-panel portal deleted |
| R2 | Message bodies in snapshot | **Pass** — slim schema + verified mapping |
| R3 | L2/Knowledge elevation | **Pass** — none added |
| R4 | Missing tests for energy / kind / path | **Pass** — three test files, all green |
| R5 | open_thread closes graph tab | **Pass** — no `tabs.remove` in code path |

### ADR-020 capability checklist

- Axes fit: L0 metadata visualization, not framed as middle-tier agent runtime. ✅
- Pack-first: N/A (no scenario runtime). ✅
- Confirm dialects: no new gate; `thread.select` reuses existing protocol. ✅
- Trust monotonicity: no elevation; no god-mode/auto-approve touched. ✅
- originWs (P1-2): no `securityConfirmations.request` touched. ✅
- No new runtime: tab page is UI surface, not second agent framework. ✅
- P1 watchlist (god-mode/originWs/evaluate/shell): none touched. ✅

### Non-blocking nits

1. **Dead endpoints**: `thread_graph.prepare` (`background/index.ts:1229-1236`) and `thread_graph.bootstrap` (`:1250-1256`) are wired but **never invoked** by either the side panel or the graph page (which calls `thread_graph.open` and reads `storage.session` directly). The bootstrap comment even self-references "Dual-review nit: single contract". Either wire them or prune in a follow-up.
2. **Hex literals in `ThreadGraphApp.tsx`**: canvas bg `#eef0f5` (line 220, 594), hard edge `rgba(79,70,229,0.45)` (238), soft edge `rgba(148,163,184,0.55)` (238). Project is mid-cleanup on hex (`7f98171 docs(design): sole hex SoT is tokens.ts (W3)`, `bf2caf1 fix(ui): residual accent hex → tokens`). Tokenize in a follow-up — design §6 leans on tokens.
3. **Mixed-concern diff**: patch bundles an unrelated `host-integrity.ts` SHA256 bump and icon regeneration (`generate-icons.mjs` + binary PNGs). Not a thread-graph defect, but mixing makes review harder. Stage separately next time.
4. **Unnecessary casts** in `ThreadList.tsx:419-420`: `(t as { agent_role?: string }).agent_role` / `(t as { trashed_at?: string | null }).trashed_at`. `Thread` type already has these — the cast bypasses type safety rather than fixing a real gap.
5. **`onWheel` preventDefault** (`ThreadGraphApp.tsx:350`): React `onWheel` is passive-by-default in some Chrome builds; `ev.preventDefault()` may be a no-op for page-scroll suppression. Functional impact is minor (canvas zoom still works on the wheel handler), but worth verifying on a real Retina trackpad before v1.1.
6. **Simulation restart on focus change** (`ThreadGraphApp.tsx:307`): clicking a node resets `simTicksRef.current = 0`, so a click for "view details" will re-trigger layout animation for the whole graph. Mild UX surprise on large graphs. v1.1 polish.
7. **`runForceLayout` exported but unused in prod** (`force-layout.ts:185-198`): only consumed by tests. Acceptable as a sync utility, but a comment or `@internal` would prevent accidental dependency.
8. **`isThreadGraphTabUrl` fallback** (`background/thread-graph.ts:46`): bare `tabUrl.includes("tabs/thread-graph.html")` in the catch branch could theoretically match a hostile non-extension URL. The `try` branch strictly checks origin; the fallback only fires on `new URL()` throw, which is rare for `chrome.tabs.query` results. Defense-in-depth: also gate on `tabUrl.startsWith("chrome-extension://")`.

None of the above block merge — they're all follow-up polish.

### Final

VERDICT: APPROVE_WITH_NITS
