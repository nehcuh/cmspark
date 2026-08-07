Code review complete. Tests pass (26/26), tsc clean, no circular imports, all five rejection gates hold.

**Rejection gates verified**
- R1 (handoff into Digest/Export/global knowledge): `companion/src/llm/adapter.ts:660-673` writes only to `runtime_context_budget.handoff` on the thread index; `companion/src/threads/thread-manager.ts:550-558` routes through `sanitizeRuntimeContextBudget` → `sanitizeThreadHandoff`. No Digest/Export/knowledge-tree writes. ✓
- R2 (raw reasoning_content as notice body): `formatHandoffForNotice` (`context-handoff.ts:112-133`) emits only structured labeled bullets. Reasoning is hint-only inside the LLM extract prompt (`generateThreadHandoff` user content) and is never the notice body. ✓
- R3 (M1 floor removed): `compactMessagesTurnSafe` (`context-budget.ts:263-336`) unchanged. ✓
- R4 (mid_loop runs new H1 extract): `shouldRunH1` returns false for `phase === "mid_loop"` (`context-handoff.ts:303-304`). Mid_loop only re-attaches via `retainMidLoopRollingSummary`. ✓
- R5 (circular import / red tests): `context-handoff → context-budget` is one-way; `runtime-context-budget → context-handoff` is one-way; `context-budget` does not import back. `npx tsc -p tsconfig.test.json` clean; `node --test` 26/26 pass. ✓

**ADR-020 capability checks**
- Surface L0 / Compose none / Trust F-S5 redact matches the change (request-path notice + chip; no new tools, gates, primary UI entry points, or composition surfaces). ✓
- No new runtime — `generateThreadHandoff` is a single `llmExtract` call, not an agent loop. ✓
- Trust monotonicity preserved (inherits L0; no god-mode bypass; no `auto_approve_*` touched). ✓
- F-S5 redaction reuses `buildRedactedTranscript` (cookies → name only, shell/host/netsec → length only, sk-/Bearer/PEM scrubbed) plus `SECRET_LINE_RE` on reasoning slices. ✓
- Audit log writes only `summary_bytes` / `summary_sha256` / short `h1_error` slice (H-D9 honored). ✓
- H1→M2 fallback correctly skips M2 on slow-fail (timeout/abort) per the Pi nit. ✓

**Nits (non-blocking)**

1. **Scope creep vs batch label.** The diff bundles Wave A scene-knowledge work (`knowledge_refs`, `active_knowledge_ids`, PacksPanel knowledge checklist, validator/pack-engine plumbing, `knowledge-active-ids.test.ts`) with Wave B H1 ThreadHandoff. Batch is `wave-b-h1-thread-handoff-impl`. Both look fine independently, but the merge complicates attribution and rollback granularity. Consider splitting or noting in the PR description.

2. `companion/src/llm/context-handoff.ts:250-253` calls `sanitizeThreadHandoff(priorHandoff)` twice in the ternary; reuse a local. Cosmetic.

3. `companion/src/llm/context-budget.ts:447-449` `keepHandoff` includes a redundant `&& !handoffIn` guard that can never be reached because `handoffIn ||` short-circuits first. Cosmetic.

4. `companion/src/llm/context-budget.ts:101-128` `buildHandoffNotice` / `attachHandoffNoticeToMessages` and the M2 `buildOmitNotice` / `attachRollingSummaryToMessages` pairs are near-duplicates; a single helper parameterized by prefix+body would remove ~30 lines. Not required.

5. Edge case (not exercised in tests): if `prevMeta.handoff` is present but `prevMeta.rolling_summary` is empty (e.g., legacy meta), `priorHandoffFmt` is undefined and mid_loop falls through to the M2 re-attach branch instead of handoff. The defensive outcome is correct (request still gets a notice) but the chip would show prose instead of structured sections on the very next pre_loop H1 success — self-healing within one turn. Worth a one-line guard test in a follow-up, not a blocker.

6. `companion/src/skills/skill-engine.ts:505` `getActiveKnowledgeForThread` constructs `new ThreadManager()` per call (reads `threads/index.json` from disk). Pre-existing pattern (`getActiveForThread` does the same at line 336) so not a regression, but it is per-turn disk I/O on the request path; consider memoizing in a later cleanup.

VERDICT: APPROVE_WITH_NITS
