All verification complete. Here is my independent review.

---

## Dual external review — thread-graph-impl-v1 (implementation gate)

### Verification performed
- Read the full patch + all new files: `background/thread-graph.ts`, `tabs/thread-graph.tsx`, `thread-graph/ThreadGraphApp.tsx`, `thread-graph/force-layout.ts`, both new test files, ThreadList/thread-related diffs.
- Ran `npm test` (622/622 pass, incl. the 3 new force-layout tests, 3 bg tests, kind test), and `npx tsc --noEmit` (exit 0).
- Confirmed `git status` matches the patch base `f6ed181`; the patch is not stale.
- Independently verified the `host-integrity.ts` SHA bump: `bb1216a0…` == `shasum -a 256 companion/dist/cmspark-host` (rebuilt dev binary, Aug 11 17:32) — legitimate rebuild tracking, not a pin weakening.

### Product pins (TG-1…TG-6) — all hold
| Pin | Check |
|---|---|
| TG-1 full-page tab | ☰→…→关联图谱 → `openThreadGraph` sends `thread_graph.open` → `openOrFocusThreadGraph` → `tabs.create(tabs/thread-graph.html?focus=…)`. Plasmo `src/tabs/thread-graph.tsx` follows the cockpit pattern. ✅ |
| TG-2 force-directed canvas | `<canvas>` + hand-rolled force layout (repulsion/spring/center-gravity, pin on drag), edges drawn as lines, not text rows. ✅ |
| TG-3 graph stays open | `thread_graph.open_thread` → `wsClient thread.select` + panel notify + `sidePanel.open`; **no `tabs.remove`/close path**. ✅ |
| TG-4 side-panel edge list removed | Overlay portal + `graphOverlay/graphCard/graphList/graphEdgeRow` styles deleted; no leftover refs (`grep` clean). ✅ |
| R5 slim snapshot | `ThreadGraphSlim` = id/alias/timestamps/agent_role/trashed_at/digest{tldr,tags,bullets,stale}; no `messages`, no `first_user_preview`. ✅ |
| Local edges only | `buildRelatedEdges` (jaccard×3 + TF×1.5 + time×0.5), 300-node cap, worker excluded, no embedding/cloud. ✅ |

### Must-answer questions
1. **prepare+snapshot pipeline** — yes: `thread_graph.open` prepares `storage.session` snapshot before/while opening; graph page reads it, TTL 5 min warning shown. ✅
2. **Force-directed canvas** — yes, not text rows. ✅
3. **open_thread without closing graph** — yes (TG-3 verified above). ✅
4. **Privacy slim only** — yes; no message bodies anywhere in the pipeline. ✅
5. **Tests** — `force-layout.test.ts` (finite ring seed, `runForceLayout` finite energy + in-bounds, pinned immobile), `thread-graph-bg.test.ts` (`THREAD_GRAPH_PATH`, `isThreadGraphTabUrl`, `isSnapshotFresh` TTL), kind hard/soft in `thread-related.test.ts`. All pass. ✅
6. **ADR-020** — declaration present and accurate (Surface L0 · L2-classes none · Compose none · Autonomy none · Trust no elevation · Channel unchanged). No new tools/gates, no new permissions or host permissions, no new confirmations (originWs N/A), no middle-agent naming, no new runtime, no side-panel chrome added (removed). Trust monotonicity N/A. ✅

### Rejection gates — none fire
- R1 ❌ not triggered (full-page canvas UI)
- R2 ❌ not triggered (no message bodies)
- R3 ❌ not triggered (no L2/Knowledge)
- R4 ❌ not triggered (layout energy / kind / path tests present)
- R5 ❌ not triggered (open_thread keeps graph open)

### Non-blocking nits
1. **Unreachable empty-edge guidance** (`ThreadGraphApp.tsx:119-124`): with default `showIsolated=false` and zero edges, nodes are filtered to ∅ → `hasNodes=false` → the "还没有关联边…提取要点" banner (renders only when `hasNodes && !hasEdges`) can never appear; user instead sees "没有可显示的节点。试试开启「显示孤立点」…" which doesn't teach the batch-extract action (design G4). Point the no-nodes message at 提取要点 too, or treat "all isolated" as the empty-edge state.
2. **Dead `thread_graph.bootstrap` handler** (`background/index.ts:1250-1256`): ThreadGraphApp reads `storage.session` directly; the handler (and its "single contract" comment) is never exercised by UI. Minor contract drift — either use it or drop it.
3. **Hex SoT violation**: hardcoded `#eef0f5` (`ThreadGraphApp.tsx:216`, `styles.main`) and `#fff` (`primaryBtn`) bypass the repo's sole-hex-SoT `tokens.ts` policy (design review flagged the same); use `tokens.bg`/a graphCanvas token.
4. **Vacuous-safe test assertion** (`thread-related.test.ts:56-62`): `if (soft) assert.equal(soft.kind, "soft")` passes silently if the soft edge is absent — I verified the edge does exist for the given inputs (TF cosine 0.894 → score 1.34), so it asserts today, but `assert.ok(soft)` first would make it robust.
5. **`sidePanel.open` gesture loss** (`background/index.ts:1272-1277`): invoked inside the async `tabs.query` callback — may lose the user-gesture context on some Chrome builds and silently no-op (`.catch(()=>{})`). Thread still switches and graph stays open, so acceptable, but a real-gesture path would be more reliable.
6. **Dead ternary** (`ThreadGraphApp.tsx:236`): `const label = q && !title.toLowerCase().includes(q) ? title : title` always evaluates to `title`.
7. **Out-of-scope working-tree noise** in the batch: icon regeneration + `host-integrity.ts` SHA bump (verified legitimate, but unrelated to thread-graph — same process issue flagged at design gate).

No blocking issues. Implementation satisfies all five rejection gates, all TG pins, G7 test requirements, and is ADR-020 clean.

VERDICT: APPROVE_WITH_NITS
