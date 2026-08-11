All spot-checks complete. Here is my independent review.

## Summary (design gate — docs only)

The design doc correctly identifies a real gap (side-panel text edge list, no full-page graph), aligns with IA B.3 ("全图可在新标签打开") and Wave C-3, uses a sound local snapshot data plane (`storage.session` + local `buildRelatedEdges`), and honors all user pins TG-1…TG-6 plus GAP-9/12 (no Knowledge dual-write, no L2, worker exclusion). All stated code facts verified true against the working tree. No REJECT-gate violations. Verdict: approve with nits.

## Factual spot-check (all claims verified against repo)

1. **Gap factual — YES.** `ThreadList.tsx:1503-1565` renders `graphOpen` portal with text rows `A ↔ score B`, `slice(0, 40)`, from `buildRelatedEdges(filtered, {minScore: 0.2, maxEdges: 80})` (line 380-383). Design's "现状" table is accurate, including entry path ☰→⋯→「🕸 关联图谱」.
2. **IA alignment — YES.** IA B.3 explicitly mandates "全图可在新标签打开"; Wave C-3 "力导向可简". Tab page `tabs/thread-graph.html` matches the established `tabs/cockpit.tsx`→`tabs/cockpit.html` Plasmo pattern (`cockpit-window.ts:11`).
3. **Data plane — SOUND.** `chrome.storage.session` already used (`cockpit-window.ts:50`); `thread.select` path exists (`background/index.ts:742`); companion `thread.related` exists (`message-router.ts:1379`); `scoreRelatedPair` = jaccard×3.0 + cosine TF×1.5 + time×0.5 (matches "共 tag + TF + 时间邻近"); Thread type has all slim fields (`sidepanel/types.ts:34-72`); permissions tabs/storage/sidePanel already in manifest.
4. **Pins TG-1…TG-6 — no REJECT-worthy issue.** TG-4 (remove side-panel list) is a user pin; R4 gate not triggered (entry opens full page; "相关 3 条" cluster retained per IA B.3).
5. **R-gates:** R1 pass, R2 pass (TG-6/§1.2.5/§9), R3 pass (§1.2.1 + G5), R4 pass, R5 pass — slim snapshot excludes 消息正文; only digest summaries in local `storage.session`.
6. **ADR-020:** declaration present and correct (Surface L0 · Compose none · Autonomy none · Trust no elevation). Axis fit correct, no middle-agent naming, no new confirmations (originWs N/A), no new runtime, no experimental layers. No violation.

## Nits (non-blocking)

- **§6 raw hex `#f0f2f7` violates the repo's hex SoT policy** (`7f98171`: sole hex SoT is `tokens.ts`; hex is absent there). Reference `bg`/`bgMuted` (or add a `graphCanvas` token) instead.
- **§5.2 ambiguity:** `thread_graph.bootstrap` "返回 threads 或指示从 storage 读" — two mechanisms; §4.2 v1 flow resolves to storage.session, so bootstrap's return-threads branch is redundant. Implementer could invent both; pin one.
- **Score inconsistency:** side-panel related-3 mirrors server `thread.related` scores while graph uses local-only edges; same pair may show different strengths. Design explicitly chose local v1 — fine, but note it in UI copy.
- **Stale snapshot vs "keep graph tab open" pin:** graph stays open but data is frozen until reopened; 5-min warning helps, a focus-refresh would be nicer (v1.1).
- **Attached patch is out-of-scope for this batch:** it contains icon regeneration + `host-integrity.ts` SHA pin bump (which matches the established legitimate rebuild pattern, e.g. `007130b`); the design doc itself is untracked so `git diff` doesn't contain the review object. Process note: capture untracked spec files in the diff artifact.

## Scope keep/cut

Keep: force-layout v1 (hand-rolled or d3-force, explicitly deferred), maxEdges 200 / 300-node cap, empty-state teaching, snapshot pipeline, G7 tests. Correctly cut: embedding, Louvain main UI, side-panel full graph, Obsidian vault sync, independent windows. Under-specification risk is low; implementer can start without inventing schema (all fields/messages/permissions exist).

VERDICT: APPROVE_WITH_NITS
