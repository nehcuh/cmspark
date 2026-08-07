All 173 tests pass. The redactForStorage gate at history/store.ts:488 sits at the INSERT path so every record() is covered. Let me now render the verdict based on the rejection gates.

**Verification summary:**

| Gate | Status | Evidence |
|------|--------|----------|
| R1 memo+mode reset | ✅ FIXED | `ChatView.tsx:712-728` (memo includes `showReasoningMode`+`exportIncludeReasoning`); `ChatView.tsx:746-751` (prevModeRef resets userToggled) |
| R2 export entrypoints | ✅ FIXED | `StatusRail.tsx:323,347`, `ThreadList.tsx:445` all pass `include_reasoning: state.exportIncludeReasoning === true` |
| R3 summary scope | ✅ FIXED | `message-router.ts:1980` passes `include_reasoning: includeReasoning` into `serializeSummaryToMarkdown` |
| R4 workspace F-S5 | ✅ FIXED | `context-budget.ts:36-40` adds all four `workspace_*` to `COMPACT_SENSITIVE_CODE_TOOLS`; unit test asserts `.env`/password bodies don't survive compact |
| R5 thread_recall history | ✅ FIXED | `history/store.ts:97-130` special-cases before all other branches; gate at line 488 covers every INSERT; test asserts query/excerpts absent |
| R6 fork trust lift | ✅ SAFE | `message-router.ts:1601-1629` updates Composition fields only; `mission_pack_trust_snapshot` not in patch; test asserts `!forked.thread.mission_pack_trust_snapshot` |
| R7 fork knowledge | ✅ FIXED | `message-router.ts:1604-1625` copies `active_knowledge_ids`, modes, whitelist, MCP, workspace_root |
| R8 export default-off | ✅ HOLDS | `message-router.ts:1958` `includeReasoning = rest.include_reasoning === true`; default false |

**Capability axes (ADR-020):** Surface: n/a (no new tools/gates; UI wiring + storage redaction). Composition: fork preserves knowledge/whitelist without Trust lift. Autonomy: n/a. Trust: monotonic — fork cannot reapply Trust snapshot. Channel: n/a. Declared in prompt body.

**Tests re-run** `[executed]`: `cd companion && npx tsc -p tsconfig.test.json && node --test …` → 173 pass / 0 fail. Matches implementer's claim.

**Non-blocking nits:**

1. `context-budget.ts:211-215` MCP RE now matches `download|contents` as substrings. Benign tool names like `mcp__foo__table_of_contents_query` will be over-redacted on compaction. Direction is conservative (false-positive ⇒ more redaction, not less), so non-blocking — but consider word-boundary matching later.
2. `history/store.ts:107-111` thread_recall redactor rebuilds params from scratch (`{query_len, max_hits?, query}`), silently dropping any other field (e.g. `__thread_id`). Not a security issue (it's strictly less data), but intent is "redact secrets" not "drop unknowns" — a comment or field-passthrough would clarify.
3. Plan file `2026-08-07-wave-e-ux-security-hardening.md` lacks the explicit `Surface/Compose/Autonomy/Trust/Channel` block from the checklist template; the prompt body carries it instead. For a no-new-tools batch this is a template nit, not a blocker.
4. `Wave E P0-2` summary test in `markdown-export.test.ts:109-149` only asserts presence/absence of the thinking marker — could also assert the `<details>` fold shape to lock the appendix contract.

All eight rejection gates verified false; capability declaration present; tests pass; no security regressions found.

VERDICT: APPROVE_WITH_NITS
