All checks complete. Summary of verification:

**Nit 1 — shrink-only `dropped_count: 0` rewrote "Earlier N" → 0: GONE**
- `effectiveDroppedCount(thisPass, prior)` in `context-budget.ts` returns prior N when this pass dropped 0 (and vice versa).
- `retainMidLoopRollingSummary` computes `noticeDropped` and passes it to both `attachHandoffNoticeToMessages` and `attachRollingSummaryToMessages` — re-attached notices keep "Earlier 4".
- `adapter.ts:765-767` computes `droppedForMeta` from `compact.droppedCount` + `prevMeta.dropped_count` and uses it for **all three** meta sinks: `runtime_context_budget.dropped_count` (:806), logger (:829), and `thread.context_compacted` (:846). The persisted meta is no longer clobbered either.
- Fresh-gen paths can't emit "Earlier 0": `shouldRunM2`/`shouldRunH1` are both mid_loop-false, and pre_loop `compacted=true` implies `dropped>0` (shrink is mid_loop-only).
- Edge case safe: if `prevMeta` is absent the re-attach branches don't fire, so `compactMessagesTurnSafe`'s verbatim `priorNotices[0]` reinsert (B3) survives untouched.

**Nit 2 — `require("./adapter")` cycle: GONE**
- `createToolResultMessage` now lives in `tool-batch-heal.ts`, importing only `redactToolPayloadForPersistence` from `security/tool-persistence-redact` (which imports only `crypto` — no cycle).
- `adapter.ts` imports it from `./tool-batch-heal` and re-exports for compat; `persistHealedToolRows` uses the local import directly with no `require`, no try/catch fallback. `buildInterruptedDiskRow` still used by `healNewestUnpairedAssistant` (not dead).
- `grep require("./adapter")` across `companion/src` → zero hits.

**Summoner claim: confirmed**
- `message-router.ts:1725-1736`: `thread.select` sets `run_status = undefined` for `stampedSurface === "summoner"` and spreads it conditionally — key omitted.

**B1–B3 no regression**
- B1: heal at `adapter.ts:338` still before user-row append (~:345); splice tests pass.
- B2: `thread.select` has no heal call; `persistHealedToolRows` has exactly one production call site (chatCreate).
- B3: `compactMessagesTurnSafe` verbatim `priorNotices[0]` reinsert on `dropped===0` intact.

**Tests**: tsc test build clean; ran context-budget + tool-batch-heal + m10 + anthropic (65 pass) and single/files (60 pass) — 125 pass, 0 fail, including the new `S52: shrink-only droppedCount 0 keeps Earlier N and does not write Earlier 0` and `thread.select omits run_status for summoner surface` tests.

Both r2 leftover nits are genuinely fixed at their production call sites, B1–B3 hold, and no new issues surfaced.

VERDICT: APPROVE
