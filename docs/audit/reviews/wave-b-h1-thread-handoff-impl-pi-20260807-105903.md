# Dual review — Wave B H1 ThreadHandoff (implementation)

## Verification performed (not rubber-stamp)

- **Patch freshness:** `git diff --stat` matches the patch file exactly (14 files, +494/−80); working tree carries the same modifications; `context-handoff.ts` + both test files are **untracked** so absent from the patch — I read them directly from the repo.
- **Machine evidence reproduced:** `npx tsc -p tsconfig.test.json` → clean (tsconfig includes `src/**/*`, adapter.ts compiled). `node --test` on context-handoff + context-budget + knowledge-active-ids → **26/26 pass**; runtime-context-budget.test.js → 2/2 pass.

## Rejection gates

| Gate | Result | Evidence |
|---|---|---|
| R1 handoff → Digest/Export/global knowledge | ✅ PASS | grep across `src/threads/digest*`, `summary-export*`, `src/knowledge/*` — zero handoff refs. Handoff confined to `runtime_context_budget` meta + `thread.context_compacted` ws event. H-D9 honored: audit log carries sha256/bytes/h1_error(≤120) only. |
| R2 raw reasoning_content as notice body | ✅ PASS | Notice body is `h1.formatted` from the sanitized struct (`context-handoff.ts:158-192`); `collectReasoningSlices` feeds only the extract prompt (`context-handoff.ts:112-132`), never the notice. |
| R3 M1 floor removed | ✅ PASS | `shouldRunH1` requires `compact.compacted && m2Enabled` (`context-handoff.ts:236-244`); H1 fail→M2 fail→M1 omit chain intact in `adapter.ts:556-638`; head-drop from `applyContextBudget` unchanged. |
| R4 mid_loop runs H1 extract | ✅ PASS | `shouldRunH1` hard-returns false on `mid_loop`; mid_loop re-attach is pure retain (`context-budget.ts:466-481`), verified by test "retainMidLoop re-attaches h1". |
| R5 circular import / red tests | ✅ PASS | No cycle: context-budget deliberately does not import context-handoff (`context-budget.ts:8`); chain thread-manager → runtime-context-budget → context-handoff → context-budget → summary-export → llm-extract has no back-edge. tsc + 26/26 green (independently run). |

## ADR-020 checklist

Capability declaration present in prompt + plan (Surface L0 request-path / Compose none / Trust no elevation, F-S5 redact). Correct axis (no "中层 Agent"); no new scenario, no new primary chrome (chip extends existing modal); no new confirm family; trust monotonicity holds (redaction parity with M2, `scrubLine` → `[redacted]`); no `securityConfirmations.request` → originWs N/A; no new runtime. The implementer re-uses the m2 config gate per H-D10.

## Nits (non-blocking)

1. **Missing tests for the H1 generate/parse path** — plan Task 2 explicitly required "unit test with mocked llmExtract or pure parse path"; `parseHandoffJson` is unexported and `generateThreadHandoff`/`shouldRunH1` have no test. `tests/context-handoff.test.ts` covers sanitize/format/notice/retain only.
2. **`collectReasoningSlices` redacts only first secret per slice** — `SECRET_LINE_RE` used without `/g` (`context-handoff.ts:110`), so multiple secret-shaped tokens in one 800-char slice pass into the extract prompt. Mitigated by output-side `scrubLine`, and reasoning never reaches the notice; add `/g` for defense-in-depth.
3. **External abort doesn't cancel in-flight H1** — `llmExtract` drops the caller's signal and uses `AbortSignal.timeout()` internally (`llm-extract.ts:56-61`); an aborted request waits up to 45 s for H1 (then `slow` → skips M2). Pre-existing pattern shared with M2 — not a regression, but the 45 s default is on the request path.
4. **`threadManager.get()` doesn't sanitize `runtime_context_budget` on read** (`thread-manager.ts:508`) — `prevMeta.handoff` is trusted for mid_loop re-attach and the ws `context_compacted` payload. Low risk since all writes go through `sanitizeRuntimeContextBudget`, but read-side sanitize would close hand-edited-index edge.
5. **Batch hygiene:** the patch bundles Wave A scene-knowledge changes (PacksPanel `knowledge_ids`, pack-engine `knowledge_refs`, `getActiveKnowledgeForThread` with per-call `new ThreadManager()`) with Wave B — out of scope for these gates and already reviewed separately; also H-D10's "document as structured handoff" isn't reflected in the SettingsSlideout M2 label (`SettingsSlideout.tsx:1016` still says "LLM 滚动摘要（M2）").

None of the above block merge; all five rejection gates pass and the implementation matches H-D1–H-D10.

VERDICT: APPROVE_WITH_NITS
