# Dual review: Wave E UX dual-truth + security hardening — **implementation**

**Batch:** `wave-e-ux-security-hardening-impl`  
**Commit:** `e9562d9` on main (base `849639c`)  
**Plan:** `docs/superpowers/plans/2026-08-07-wave-e-ux-security-hardening.md`  
**Prior multi-adv:** `docs/audit/reviews/multi-adversarial-review-20260807-context-memory-abcd.md` (REQUEST_CHANGES → Wave E)

## What this batch claims to fix

| ID | Claim |
|----|--------|
| P0-1 | MessageRow custom memo compares `showReasoningMode` + `exportIncludeReasoning`; mode change resets ReasoningBlock user toggle |
| P0-2 | StatusRail / ThreadList / summary router pass `include_reasoning` |
| P0-3 | `workspace_*` in F-S5 `COMPACT_SENSITIVE_CODE_TOOLS`; MCP RE expanded |
| P0-4 | `history.db` special-case `thread_recall` (hash query, no raw excerpts) |
| P1-1 | Budget notices frame `MACHINE_WORKING_MEMORY (NOT user intent)` (role still `user`) |
| P1-2 | Fork copies knowledge/modes/whitelist/MCP/workspace_root/reasoning; never Trust snapshot |

## Spot-check (must Read real files)

1. `chrome-extension/.../ChatView.tsx` — memo comparator + ReasoningBlock prevMode reset
2. `StatusRail.tsx` / `ThreadList.tsx` — `include_reasoning` on export messages
3. `message-router.ts` — summary branch `include_reasoning`; fork field matrix
4. `context-budget.ts` — workspace sensitive set + notice framing
5. `history/store.ts` — `thread_recall` redactForStorage
6. Tests: context-budget, history, markdown-export summary, files fork Wave E

## Rejection gates (REJECT if any true)

| # | Gate |
|---|------|
| R1 | Settings change to showReasoningMode still leaves historical MessageRows stuck (memo omits mode) |
| R2 | Any primary export entrypoint (StatusRail thread/summary, ThreadList 🧠) still omits `include_reasoning` while Settings claims global opt-in |
| R3 | Summary scope still cannot include reasoning when client sends `include_reasoning: true` |
| R4 | `workspace_read_file` (or other workspace_*) tool bodies still pass through F-S5 unredacted into compact/recall path |
| R5 | `thread_recall` query string or hit excerpts still stored raw in history.db |
| R6 | Fork copies `mission_pack_trust_snapshot` / re-applies Trust without user gesture |
| R7 | Fork still drops `active_knowledge_ids` while copying skills (Wave A dual-truth regression) |
| R8 | Default export includes reasoning without opt-in (Wave D privacy regression) |

## Non-blocking expected residual

- Notice `role:user` with framing only (not system role) — intentional for turn-safety
- Pack/orchestrator still omit `thread_recall` by design
- `rolling_summary` dual-duty, D2 skill-path knowledge union

## Machine evidence claimed by implementer

```
cd companion && npx tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/context-budget.test.js \
  .test-dist/tests/context-handoff.test.js \
  .test-dist/tests/thread-recall.test.js \
  .test-dist/tests/markdown-export.test.js \
  .test-dist/tests/history.test.js \
  .test-dist/tests/single/files.test.js
# 173 pass / 0 fail
```

Re-run a subset if tools allow; do not rubber-stamp.

## ADR-020

- Surface: no new tools; export/UI wiring + storage redaction
- Composition: fork preserves knowledge/whitelist without Trust lift
- Autonomy: n/a
- Trust: must not elevate via fork or knowledge

## Final line (mandatory)

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
