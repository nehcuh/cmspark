# Wave E — UX dual-truth + security hardening (post multi-adv A–D)

**Date**: 2026-08-07  
**Trigger**: Multi-adversarial review `5a401f1..849639c` → REQUEST_CHANGES  
**Spec**: `docs/audit/reviews/multi-adversarial-review-20260807-context-memory-abcd.md`

## Scope (shipped this batch)

| ID | Sev | Fix |
|----|-----|-----|
| **P0-1** | H | MessageRow custom memo compares `showReasoningMode` + `exportIncludeReasoning`; mode change resets ReasoningBlock user toggle |
| **P0-2** | H | StatusRail / ThreadList / summary router pass `include_reasoning` |
| **P0-3** | H | `workspace_*` in F-S5 compact sensitive set; MCP RE expanded |
| **P0-4** | H | `history.db` special-case `thread_recall` (hash query, no excerpts) |
| **P1-1** | H | Budget notices frame `MACHINE_WORKING_MEMORY (NOT user intent)` |
| **P1-2** | H | Fork copies knowledge/modes/whitelist/MCP/workspace_root/reasoning; never Trust snapshot |

## Explicit non-goals (still HOLD / later)

- Force-inject `thread_recall` into every pack / orchestrator allowlist (document only)
- Split `rolling_summary` dual-duty field
- Remove D2 skill-path knowledge union
- Change handoff notice `role` from user → system (framing first; role change is follow-up if needed)

## Tests

- `markdown-export.test.ts` — summary include_reasoning
- `context-budget.test.ts` — workspace F-S5 + notice framing
- `history.test.ts` — thread_recall storage redaction
- `single/files.test.ts` — fork composition matrix

## Verification

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/context-budget.test.js \
  .test-dist/tests/context-handoff.test.js \
  .test-dist/tests/thread-recall.test.js \
  .test-dist/tests/markdown-export.test.js \
  .test-dist/tests/history.test.js \
  .test-dist/tests/single/files.test.js
```
