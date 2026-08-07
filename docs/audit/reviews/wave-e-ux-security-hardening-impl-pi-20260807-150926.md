All spot-checks complete. Here is my independent review.

## Review: Wave E UX dual-truth + security hardening (e9562d9)

**Patch freshness**: `git diff 849639c..HEAD` matches the patch file exactly (12 files, +520/−5). HEAD == e9562d9.

**Verification method**: read real source at every spot-check, re-ran the claimed test subset independently (173 pass / 0 fail, tsc clean).

### Rejection gates — all closed

| Gate | Status | Evidence |
|------|--------|----------|
| R1 memo omits mode | **CLOSED** | `ChatView.tsx:725-726` comparator includes `showReasoningMode` + `exportIncludeReasoning`; `ReasoningBlock` (`ChatView.tsx:746-752`) resets `userToggled` via `prevModeRef` on mode change, so global setting wins over historical user toggles. `handleExport` is `useCallback([activeThreadId, exportIncludeReasoning])` (line 330), so the fresh-closure concern is covered by the same memo key. |
| R2 entrypoints omit flag | **CLOSED** | All 4 UI export entrypoints pass it: StatusRail thread (`StatusRail.tsx:323`), StatusRail summary (`:347`), ThreadList 🧠 (`ThreadList.tsx:445`), ChatView single (`ChatView.tsx:328`). All read `state.exportIncludeReasoning` from the agent store (source of truth, `agentStore.tsx:623`). |
| R3 summary can't include reasoning | **CLOSED** | `message-router.ts:1958` (`rest.include_reasoning === true`) → passed to `serializeSummaryToMarkdown` (`:1980`). Test proves `include_reasoning: true` emits 思考过程 + thinking; default strips it. |
| R4 workspace bodies in compact/recall | **CLOSED** | `context-budget.ts:37-45` adds `workspace_read_file/write_file/list_dir/glob` to `COMPACT_SENSITIVE_CODE_TOOLS`; `thread-recall.ts:232` routes through `redactMessagesForCompaction`. Test proves body secrets (`sk-live-…`, `hunter2`) don't survive. |
| R5 raw recall in history.db | **CLOSED** | `history/store.ts:98-130` special-cases `thread_recall`: params → `query_len` + sha256 hash, excerpts → `hit_count` only. Applied in `record()` (`:488`) before any write. Test asserts query text and excerpts absent from stored rows. |
| R6 fork re-applies Trust | **CLOSED** | Fork copies Composition surface only (`message-router.ts:1605-1632`); `mission_pack_trust_snapshot`/`auto_approve` deliberately excluded (`:1598`). Test asserts `!forked.thread.mission_pack_trust_snapshot`. Trust restore remains exclusively behind pack-engine gesture paths (`pack-engine.ts:414-435`). |
| R7 fork drops knowledge | **CLOSED** | `active_knowledge_ids` copied at `message-router.ts:1611-1613` alongside skills; integration test deep-equals `["pack-doc-a","site-note"]`. |
| R8 default export leaks reasoning | **CLOSED** | Every entrypoint and the router use strict `=== true`; default undefined → false. Both markdown-export tests confirm default-off. |

### ADR-020 capability checklist
- **Surface**: no new tools — only redaction-set membership + export/UI wiring; declaration present in prompt (Surface: n/a-new-tools; Compose: fork preserves knowledge/whitelist; Autonomy: n/a; Trust: no elevation).
- **Trust monotonicity**: respected — fork copies `tool_whitelist`/knowledge/MCP selection (Composition) but never Trust snapshot/auto_approve; no looser L0 semantics inherited.
- **originWs**: no new `securityConfirmations.request` in this diff.
- **Pack-first / no new chrome / no "中层 Agent" mislabeling**: n/a, no new scenario or primary UI added.

### Nits (non-blocking)
1. `ChatView.tsx:571` — `exportIncludeReasoning: _exportIncludeReasoning` underscore-destructure is correct (memo reads the props object) but opaque; the comment covers it, fine.
2. `context-budget.ts:213` comment "Align with history/store MCP policy" is slightly inaccurate — the compaction regex `(…|ssh|aws|download|contents)` is a **superset** of history/store's `(…|ssh|aws)`. Safe direction (compaction at least as strict), just a misleading comment.
3. `history/store.ts` — `workspace_read_file` results in history.db are capped at 200 chars (same policy as `host_read`), so the first 200 chars of a file could still persist; consistent with pre-existing host_read treatment and not a regression, but worth noting workspace file *content* is secret-shaped.
4. No UI-level test for the memo comparator / ReasoningBlock toggle-reset (multi-adv P2-2 residual); logic verified by inspection, companion tests cover the export matrix instead.
5. `thread_recall` query is stored as len + sha256 — low-entropy short/CJK queries are weakly protected by hash (correlate-able), but this matches the established cookie-hash tradeoff and the multi-adv's own fix sketch.

All 8 rejection gates are demonstrably closed in real code, the machine evidence re-ran clean (173/0), and no security regression or over-claim survives inspection.

VERDICT: APPROVE_WITH_NITS
