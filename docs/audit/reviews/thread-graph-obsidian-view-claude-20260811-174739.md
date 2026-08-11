## Summary

Design gate for Thread Graph Obsidian-style full-page tab view. Spec is `docs/superpowers/specs/2026-08-11-thread-graph-obsidian-view-design.md` (untracked; the attached `.patch` is just icon/SHA256 noise — see spot-check §2). Capability declaration is accurate: Surface L0 · Compose none · Autonomy none · Trust no elevation · Channel unchanged. Pins TG-1…TG-6 are coherent, IA-aligned, and ADR-020-clean. No rejection gate fires. Implementer can start without inventing schema. Recommendation: **APPROVE_WITH_NITS**.

## 1. Factual spot-check (all `[inspected]`)

| Claim in spec | Verification |
|---|---|
| Current graph = side-panel text edge list in `ThreadList` portal | ✅ `ThreadList.tsx:1503–1569` renders `createPortal(... graphOverlay ...)` with `graphEdges.slice(0,40).map(...)` as `titleA ↔ score titleB` text rows. **Confirmed text edge list, not force-directed.** |
| `buildRelatedEdges` lives at `sidepanel/utils/thread-related.ts` | ✅ Lines 171–193. Returns `{a,b,score,shared_tags}[]` — note: **no `kind` field** (see nits). |
| Cockpit pattern `chrome-extension/src/tabs/cockpit.tsx` | ✅ Exists; 5-line Plasmo tab wrapper importing `CockpitRoot`. Pattern is real and minimal. |
| IA §B.3 explicitly allows "新标签打开" for full graph | ✅ `2026-08-06-thread-history-ia-product-design.md:95–100`: "侧栏内用简化列表+相关簇；**全图可「在新标签打开」或弹出层**". The spec picks the new-tab branch. |
| Wave C-3 said "Graph 弹出层" | ✅ `2026-08-11-thread-history-ia-gap-optimization-adversarial.md:186`. TG-4 (user pin 2026-08-11) overrides — replaces popup with full-page tab. User pin is authoritative and aligns with parent IA §B.3. |
| IA C.6 "不新增图数据库" | ✅ Honored by TG-6. |
| Patch file represents the change under review | ❌ `thread-graph-obsidian-view-diff-20260811-174739.patch` contains **only icon PNGs, `generate-icons.mjs`, and `host-integrity.ts` SHA256 bump**. The design doc is **untracked**, not staged. Review must read the spec file directly.

## 2. Rejection gates (R1–R5)

| # | Gate | Result |
|---|---|---|
| R1 | False code facts | **Pass** — all citations verified. |
| R2 | Requires L2/Knowledge/cloud/embedding v1 | **Pass** — TG-6 explicitly bans; ADR-020 §C.6 honored. |
| R3 | Graph becomes default navigation | **Pass** — §1.2 principle 1 keeps timeline as default; graph is exploration axis. |
| R4 | Side-panel-only while claiming Obsidian UX | **Pass** — TG-4 removes side-panel edge-list UI; full-page tab is the sole path. |
| R5 | Snapshot/privacy leak of message bodies | **Pass** — §5.2 slim fields explicitly exclude bodies (`id, alias, updated_at, created_at, agent_role, digest{tldr,tags,bullets,stale}`); `chrome.storage.session` is in-memory, extension-scoped. |

## 3. ADR-020 capability checklist

- Declaration present in prompt: **yes** (Surface L0 / Compose none / Autonomy none / Trust none / Channel unchanged). Matches diff scope (docs-only design gate).
- Axes fit: L0 metadata visualization — correctly **not** framed as middle-tier agent / new runtime.
- Pack-first: N/A (no new scenario runtime).
- Confirm dialects: **no new confirmation gate** introduced.
- Trust monotonicity: no elevation.
- originWs (P1-2): no `securityConfirmations.request` touched.
- No new runtime: tab page is UI surface, not second agent framework.

## 4. Blocking issues

None.

## 5. Non-blocking nits

1. **Patch file is noise.** `docs/audit/reviews/thread-graph-obsidian-view-diff-20260811-174739.patch` shows only icons + `companion/src/host-use/darwin/host-integrity.ts:54` SHA256 bump. The actual review artifact is the untracked spec. Suggest the dual-review script capture untracked spec files explicitly so reviewers aren't misled.
2. **`kind` field not in current `buildRelatedEdges` return type** (spec §4.2 vs `thread-related.ts:174`). Implementer must extend the return type or wrap it in `ThreadGraphApp`. Trivial but worth flagging so it doesn't get fudged.
3. **`thread_graph.bootstrap` ambiguity** (§5.2): spec says it returns `{threads}` *or* "indicates from storage read". v1 will use `storage.session` per the decision table — implementer should pick one contract before coding.
4. **`thread_graph.extract_untagged` semantics loose** (§5.2): "(或仅 toast 指引)" — acceptable for v1 but the implementer should declare which before QA.
5. **Snapshot staleness vs live extract** (§5.2): 5-min TTL is fine for initial render, but if the user runs batch extract with the graph tab open, the graph won't refresh until manual reload. v1.1 polish.
6. **Force-layout algorithm choice** (§4.3): hand-rolled vs `d3-force` left open — explicitly listed as nit in the review task. Bundle-size budget should decide.
7. **maxEdges 200 vs current 80** (§4.2 vs `ThreadList.tsx:382`): different caps are fine (full-page canvas), but worth a one-line rationale.

## 6. Scope keep/cut

Keep v1 as specified. Force-layout + `maxEdges=200` + node cap 300 + hard/soft edge kinds + slim snapshot pipeline is the right minimum to deliver "Obsidian-like". `?focus=` highlight, tag coloring, PNG export correctly deferred to v1.1/v2.

VERDICT: APPROVE_WITH_NITS
