All three blocks verified against production call sites and tests. Summary:

**B1 — heal after a later user → rebuild stripped round: GONE**
- `chatCreate` now heals at `adapter.ts:357` — *before* the user row is appended at `adapter.ts:423` (r1 had heal at :555 *after* user write at :418).
- `persistHealedToolRows` uses `insertMessageAt` at `toolBlockInsertIndex` (splice after the assistant's contiguous tool block), not `addMessage`/EOF. The re-read loop after each insert handles cap-trim index shifts (`tool-batch-heal.ts:140-150`).
- In-session abort (`persistInterruptedRemainder`, `adapter.ts:875-910`) splices at the same insert index with re-read; the `assistantStillOnDisk` guard (`adapter.ts:1373-1382`) prevents a late tool row when the round was regenerated/truncated.
- `anthropic-convert.ts` merges the resulting `tool_result` user with the following user turn so the abort-keep tape doesn't produce consecutive users (Anthropic 400) — closes the end-to-end hole r1's ordering bug would have caused.
- Tests: `healNewestUnpairedAssistant: splices INTERRUPTED before a following user (not EOF)` and `persistHealedToolRows: inserts after the unpaired assistant, not after a later user` both pass, and m10 integration asserts assistant+fillers stay.

**B2 — thread.select persisted heal during live loop: GONE**
- `message-router.ts` thread.select case has no heal call at all — returns in-memory `getMessages` + `run_status` derived from `abortControllers` (undefined for summoner). grep confirms `persistHealedToolRows` has exactly one production call site: `adapter.ts:357` (chatCreate).
- Test `thread.select does not persist INTERRUPTED heal rows` passes.

**B3 — shrink-only mid_loop dropped omit notice: GONE**
- `compactMessagesTurnSafe` collects `priorNotices` before stripping, and reinserts `priorNotices[0]` when `dropped === 0` but notices existed (`context-budget.ts:415-434`); `compacted` remains true for shrink-only so the adapter still swaps messages, but the sticky "Earlier 4" notice survives.
- Test asserts `/Earlier 4/` survives the exact pin+shrink scenario r1 flagged (previously "the test encoded the bug").

**Verification:** compiled clean; ran the claimed related suites — tool-batch-heal+context-budget+m10 (35 pass), anthropic+files (88 pass), adapter (16 pass), adapter-recovery (14 pass). All exit 0.

**Residual nits (non-blocking, as the r2 lanes noted):** shrink-only compaction reports `dropped_count: 0` in adapter meta while `compacted=true`; lazy `require("./adapter")` in tool-batch-heal.ts is a circular dependency (works at runtime — the persistHealedToolRows test exercises the real path — but is ugly).

All three REJECT blocks are genuinely resolved at their production call sites, with tests exercising the production shapes rather than just the unused pure helper. Only the two known nits remain.

VERDICT: APPROVE_WITH_NITS
