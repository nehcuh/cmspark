# Independent review — CMspark #490

**Base:** `aada096a`  
**Claim:** blank graph → real canvas lifecycle + searchable explorer; ≥20 drops unlocked LLM groups; lock overlay stays; additive `organizing`; no new trust/actions.  
**Evidence class:** companion/extension unit+handler tests `[executed by implementer]`; Playwright on **synthetic** Chrome + production `KnowledgeGraphApp` / `knowledgeGraphFrame` `[executed, not Windows/user corpus]`; this review is **static** on the provided sources `[inspected]`.

Do **not** treat 1331 / 5055 passing tests or DESIGN/CHANGELOG length as proof.

---

## Outcomes vs DoD

| DoD | Result | Evidence |
|---|---|---|
| Async snapshot actually paints | **Met** | Baseline `before.json`: CSS 1280, bitmap **300×150**, **0** arcs, **0** opaque pixels. After: 1/4/20/200 paint with `backgroundAlpha=255` and colored pixels; remount after error uses a **new** canvas. Root cause was `useEffect(..., [])` while `canvasRef` was null; new effect is `[showCanvas]`. |
| Search/group never drop graph data | **Met** | `filterKnowledgeNodes` only feeds `visibleNodes` (list). Layout/draw still use full `payloadNodes` / `edgesRef`. |
| Select locally; explicit preview | **Met** | Click → `locateNode` (no `open_doc`). `在知识面板打开` → `knowledge_graph.open_doc`. UI test asserts both. |
| 1/4/20/200 + titles + full list | **Mostly met** | List count = N. Canvas titles wait for `'SQLite'`. **200-node probe: 191/200 centers in-bounds** (`after.json`). List still has 200. |
| Fit/zoom/keyboard, 320–1440 | **Met for the scripted path** | Resize cases assert bitmap = CSS×dpr, no sidebar overlap, no horizontal overflow. Keyboard handlers exist on the canvas. |
| Empty / offline / failed + recovery | **Met in synthetic UI** | `too_few` copy, connection error keeps snapshot, error→refresh→paint. |
| `organizing` true until settle | **Met on companion** | Handler test: ACK/refresh/rebuilding `true`; `finally` clears controller **before** push; success/failure `false`. Failure keeps `status:"ok"` + cache. |
| Legacy servers without `organizing` | **As declared** | Parse omits non-boolean; `setOrganizing(parsed.organizing === true)` ⇒ missing field looks idle. Local 35s timer is the only busy fallback. |
| Search/refresh do not auto-organize; naming pref preserved | **Met in mock transport** | Default refresh `llm_labels === false`; `?labels` keeps `true` and no `organize`. |
| #491 cache write | **Not claimed** | Honest. |

Capabilities (color, AI naming/regenerate, organize, lock/unlock, dashed vs solid, reasons) are still in the tree; several moved under `<details>`. Click-to-open becoming explicit preview is **spec**, not a silent removal.

---

## Trajectory / scope

Plan `docs/superpowers/plans/2026-09-09-knowledge-graph-usability.md` already bundled canvas lifecycle, layout (notices/list not overlaying), search, fit/zoom, honest empty/zero-edge, and keep-all-AI-verbs. Backend 19→20 unlabeled `l:` groups is a real related correctness bug (group_key applied in TF lane, labels only in LLM lane). Additive `organizing` is justified: old `applySnap` did `setOrganizing(false)` on the **first ACK**, which is exactly “initial graph response is not completion.”

T2 / panel-only / no new verbs: **holds** on this diff. `organizing` is optional on the existing frame. No user data path.

This is a large UI rewrite for a visibility bug. That is allowed by the plan, but it is also where the new defects are.

---

## Findings

### P0
None. The reported blank canvas is fixed with pixel evidence; trust surface is unchanged.

### P1
None that break the #490 contract on the provided evidence.

The 200-node 191-in-view probe is **not** a P1 by itself: the test only required `arcs.length >= 200` and `colored > 0`, and the full list is present. Treat as P2 camera/layout, below.

### P2 — new in this change

**P2-1. `<details open={payloadNodes.length <= 19}>` is fully controlled with no `onToggle`.**  
`KnowledgeGraphApp.tsx` groups block: `open={payloadNodes.length <= 19}`. React will reset native open/close on every parent render (`setHoverCaptionText` on canvas hover, color mode, snapshot, query, …).

- n≤19: user cannot keep groups collapsed.  
- n≥20: expand will not **stay** open while the mouse crosses the canvas (hover `setState`). Unlock for a lock overlay that **this ticket keeps across 20** lives in that block (`onUnlock` is intentionally not gated on `llmLane`). Transport is still tested at 4 nodes (details already open). **≥20 group management UX is untested and structurally flaky.**

**P2-2. `ResizeObserver` always `fitView()`, ignoring `userCameraRef`.**  
New resize path:

```ts
fitViewRef.current()
```

Old resize only updated the bitmap; fit ran when the simulation **finished**. New layout reflows the canvas often (list toggle, AI `<details>` `flex-basis:100%`, notices). Any of those wipes pan/zoom. Fit/zoom are “explicit” in DESIGN; this makes fit implicit and aggressive. UI tests click 适应画布 after resizes and never assert camera survival across 收起列表.

**P2-3. Camera is fitted before layout has settled; 200-node snapshot left 9 nodes off-canvas.**  
Draw loop fits as soon as `!fittedRef && !userCameraRef` (and resize fits on mount). Layout then ticks (6/frame, up to 320). Completion does re-fit if `!userCameraRef`, but `after.json` recorded `visible: 191` at assertion time. Combined with P2-2, “isolated documents stay visible” is true for the **list**, not reliably for the canvas frustum.

**P2-4. Client busy timeout vs server field (legacy / missed push).**  
35s `setOrganizing(false)` + “尚未收到整理结果” is local fiction. Server organize timeout is 30s; new frames are honest. Old companions never send `organizing: true`, so `applySnap` clears busy on the first snapshot — **same lie as pre-#490**, now documented. Acceptable residual; do not describe it as “job state always matches server.”

**P2-5. `onActionResponse` failure clears `organizing` for lock/LLM toggle too.**  
A failed lock/refresh while an organize is in flight will drop the spinner even if `knowledgeGraphOrganizeRun` is still set. Narrow race.

### Nits

- `知道了` on the lock-dissolved notice has no `type="button"` (every other control does).
- `knowledgeGraphBarMeta` still comments 「N 点 · M 边」; copy is now 「N 篇知识 · M 条相似关联」, including **0 条相似关联** when the honest state is “暂无明确关联”.
- `DESIGN.md` header still cites #481/#488 only; #490 body was added.
- `graphStyles` is a new `<style>` string every render; `matchMedia` is queried every rAF.
- 200-row document list is unvirtualized (cap is 200; OK, not elegant).
- `fitKnowledgeCamera` pads for radii, not for the title line under the node; draw already **drops** labels that would clip (`sy + 17 < h`) — another reason the list, not the canvas, is the a11y SoT.

---

## Existing / out of scope (not regressions)

- **#491** cache write permission — explicitly not fixed.
- **`ack_tf_switch` / organize `user_gesture`:** App still sends `knowledge_graph.refresh`; SW mapping is not in this diff. Same pattern as #427. UI tests mock `sendMessage` and only assert `organize: true`, not `user_gesture`. Backend tests call `handleMessage` with `user_gesture: true` directly. **Not re-proven end-to-end in this packet.**
- Panel-only / summoner deny — unchanged.
- ≥20 never ships `relations` — #427 contract; this change only stops unlocked **groups** leaking into TF `group_key`.
- Playwright is **headless Chrome + fake `chrome.storage` / `runtime`**, fixture vecs orthogonal (0 TF edges is real production, not a user’s library). Packet already says: not Windows UI, not real corpus.

---

## Component correctness

**Canvas lifecycle — correct.** `[showCanvas]` + rAF cleanup on unmount is the actual fix. Stale session `get` vs later `onChanged` (`receivedSnapshot`) is tested. Error unmount stops frames.

**Explorer — correct and small.** Filter is list-only; `shortKnowledgeTitle` is code-point safe; `fitKnowledgeCamera` removes the old **0.45 min zoom** that could leave sparse graphs off-screen (unit-tested).

**Click vs preview — correct per DESIGN.** Regression only if someone still expects click → knowledge panel; the ticket inverted that on purpose.

**Backend `llmLane` gate — correct.** Unlocked `opts.llm.groups` no longer rewrite TF membership; lock overlay still runs after. Tests compare `grown` to `tf` / `tfWithLock` using **production** `normalizeGraphOrganize`, not hand-built frames.

**`organizing` wire — correct on new servers.** Always a boolean on `knowledgeGraphFrame` and the rebuilding object; `finally` nulls the controller before `sendToExtension`. Parse is fail-closed (`typeof === "boolean"`).

**Copy `too_few` — correct, not a #427 regression.** After MIN_DOCS=1, `too_few` is **n=0**. “知识不足 20 篇，暂无图谱” was already a lie; empty-library copy matches the status. 20-doc messaging remains `KNOWLEDGE_GRAPH_TF_SWITCH_BANNER`.

**AI verbs — present, more hidden.** Organize CTA for 2–19 uncached stays in `kg-notices` (good). Reorganize / LLM switch / stale sit in **uncontrolled** `kg-ai-options` (OK). Lock/unlock sit in the **controlled** groups `<details>` (P2-1).

**Trust — OK.** No new message types, no auto `organize`, refresh default `llm_labels` from existing pref, search is local.

---

## What would make me reject

- Shipping with the canvas effect still `[]` / no remount path. **Not the case.**
- Dropping lock overlay at ≥20 or auto-firing organize/search→LLM. **Not the case.**
- Claiming #491 or real Windows/user-corpus UX. **Not claimed.**
- Controlled groups `<details>` if lock/unlock at ≥20 were the primary AC and unusable. They are secondary; still P2.

---

VERDICT: APPROVE_WITH_NITS
