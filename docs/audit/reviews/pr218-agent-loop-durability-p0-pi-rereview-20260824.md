I've now verified all three blocks against the actual code and diff. Summary of findings:

**B1 — heal-after-user ordering (adapter.ts:418 → 555)** ✅ CONFIRMED
- `chatCreate` writes the user message at `adapter.ts:418`, then calls `persistHealedToolRows` at `adapter.ts:555` — heal `addMessage`s land at EOF (`tool-batch-heal.ts:116-118`), i.e. *after* the new user row.
- `unpairedToolCallsFromAssistant` breaks its walk at the first non-tool row (`tool-batch-heal.ts:35-37`), and `rebuildMessagesFromHistory` clears `openToolCallIds` at each user (`adapter.ts:241-242`), so heal rows after the user are skipped, and the round's assistant is stripped to `"(tool call failed)"` (`adapter.ts:274-283`) — losing t1's valid result.
- The leftover rows persist on disk and are re-healed on every subsequent chatCreate (the old assistant stays "newest with tool_calls" until superseded) → unbounded accumulation. This defeats the crash-recovery path the PR exists for (the in-session abort path via `persistInterruptedRemainder` works, but the crash path does not).

**B2 — thread.select heals while run_status=llm (message-router.ts:1722)** ✅ CONFIRMED
- `persistHealedToolRows` runs unconditionally in `thread.select`; `run_status` (`abortControllers.has(...)`) is computed *after* the heal at 1725-1727.
- A concurrent select during an in-flight batch writes `INTERRUPTED` rows for executing ids; the later real successes are appended after them; rebuild pairs the *first* matching block (`adapter.ts:249-259`) and discards the real rows (empty `openToolCallIds`), so the model retries already-executed side-effectful tools. GET mutates history, and no gate exists despite `abortControllers` being right there.

**B3 — shrink-only mid_loop drops the sticky omit notice (context-budget.ts:415-436)** ✅ CONFIRMED
- `compactMessagesTurnSafe` always splices out omit notices (415-417), reinserts only when `dropped > 0` (419-424), but now sets `compacted: dropped > 0 || shrunk` (436). A pin + shrink pass with `dropped===0` → `compacted=true` → adapter replaces `messages` (`adapter.ts:689`) → the `[context_omitted]` notice emitted by pre_loop vanishes from subsequent requests in the turn. `retainMidLoopRollingSummary` re-attaches only m2/h1 notices, not m1. Notably, the new mid_loop pin test feeds in `buildOmitNotice(4)` and never asserts it survives — the test encodes the bug.

**Tests** — confirmed the adversary's claim: `tool-batch-heal.test.ts` exercises the *unused* pure helper `healNewestUnpairedAssistant` (never called from src) and `buildInterruptedDiskRow` (fallback only); `persistHealedToolRows` itself, the chatCreate ordering, the select path, and omit-retain are all uncovered. 136 green tests don't contradict any block.

**Nits** — confirmed: "Summoner/tray" comment vs summoner-only code (message-router.ts:1724-1726); lazy `require("./adapter")` cycle; untested `assistantStillOnDisk`/summoner-omit paths.

All three BLOCKs are accurate, code-grounded regressions in the PR's core durability claims, with obvious gates/fixes available. REJECT stands.

VERDICT: REJECT
