# Lane A — LLM loop (independent adversary)

- **Lane**: A (LLM loop) — independent of implementer / r2 APPROVE_WITH_NITS
- **HEAD**: `1d16b0ed8b7a8eb0fc75c529cd88e24089f9c2bb` (`1d16b0e` fix(agent): fold post-#219 kimi nits after four-lane adversary (#220))
- **Range**: `c5b4242..1d16b0e`
- **Date**: 2026-08-25
- **Method**: live-file inspect at HEAD; exclusive-range diff; frozen-patch SHA256; `tsc` + `tsx --test`; `/tmp` mutation-kill then delete
- **Exclusive files**: `companion/src/llm/adapter.ts`, `run-queues.ts`, `tool-batch-heal.ts`, `overflow.ts` (context); tests `adapter-steer-overflow.test.ts`, `tool-batch-heal.test.ts`, `run-queues.test.ts`
- **Frozen patch SHA256** `[executed]`: `b5e936cbf1dc66afc3fc7aef5898fb417692ed63325b9a4ed8bb11caf5c86021` — matches prompt
- **Default**: REFUTED until `file:line` + `[executed]` / `[inspected]`

---

## Machine results

cwd: `companion/` (worktree had no `node_modules`; used a temporary gitignored symlink to the parent checkout's `companion/node_modules`, then removed it).

```
./node_modules/.bin/tsc --noEmit -p tsconfig.json
TSC_EXIT:0
```

```
./node_modules/.bin/tsx --test tests/adapter-steer-overflow.test.ts tests/tool-batch-heal.test.ts tests/run-queues.test.ts
ℹ tests 32
ℹ pass 32
ℹ fail 0
TEST_EXIT:0
```

Breakdown `[executed]`:

| File | Tests | Result |
|------|------:|--------|
| `adapter-steer-overflow.test.ts` | 13 | 13 pass (r1 was 0/13 Connection error) |
| `tool-batch-heal.test.ts` | 12 | 12 pass |
| `run-queues.test.ts` | 7 | 7 pass |
| **total** | **32** | **32 pass / 0 fail** |

---

## Must-falsify

### 1. A-BLOCK — tests must hit `OpenAIProvider.prototype.streamChat`

**Claim**: `adapter-steer-overflow.test.ts` hits CanonicalStreamEvent via `createProvider` → `OpenAIProvider.prototype.streamChat`, not a dummy `Completions` class under `tsx`.

**Live**:

- `companion/src/llm/adapter.ts:576` `const provider = createProvider(config)` then `:927` `for await (const ev of provider.streamChat({...}))`
- `companion/src/llm/provider.ts:135-140` default protocol → `new OpenAIProvider(llmConfig)` `[inspected]` (factory file not in exclusive range; cited only to name the class)
- Test seam `companion/tests/adapter-steer-overflow.test.ts:10-12,114-121` patches `OpenAIProvider.prototype.streamChat`

**Mutation-kill** `[executed]` private `/tmp/cmspark-lane-a-mut` (deleted after):

1. Revert mock to `OpenAI.Chat.Completions.prototype.create` (do **not** patch `OpenAIProvider.prototype.streamChat`): **0/13 pass, exit 1**. Assertions see `streamParams.length === 0` / missing `chat.done`.
2. Seam probe: patch test-imported `Completions.prototype.create` (flag++), leave `streamChat` live: **`completionsHit=0`**, `chat.error= Connection error.` — exact r1 failure mode. Dual `openai` package instance; dummy Completions is not the live path.

**Status: HOLDS**

---

### 2. A-High leftover — after leftover `takeSteer`, queue-full must NOT `dropSteer`

**Claim**: leftover remainder converts to `nextRun`; queue-full warns and drops **only that leftover**; must not `dropSteer` (would wipe successor / concurrent steers).

**Live** `[inspected]`:

- `adapter.ts:43` imports `{ enqueueNextRun, takeSteer }` — **`dropSteer` is not imported**
- `adapter.ts:1748-1774` `finally`: if `!signal?.aborted`, `leftover = takeSteer(threadId)`; `enqueueNextRun(threadId, text)`; on false, `logger.warn("llm.steer_leftover_dropped", { reason: "next_run_queue_full" })` and **no `dropSteer`**
- Abort path skips leftover conversion (`adapter.ts:1749`)
- `tsc --noEmit` exit 0 would fail if `dropSteer` were called unbound `[executed]`

**Tests** `[executed]`:

- leftover → nextRun: `adapter-steer-overflow.test.ts:177-191` pass
- abort does not create nextRun, steer remains: `:193-214` pass
- queue-full warn + leftover gone + nextRun still full: `:216-235` pass

**Test-pin gap** (not a production regression): the queue-full test takes leftover then asserts `takeSteer() === []`. Re-adding `dropSteer(threadId)` **after** leftover `takeSteer` would still pass that test, because leftover is already off the steer queue; `dropSteer` only matters for steers enqueued **after** the take. Existing test does **not** mutation-kill the concurrent-steer wipe. Production code still has no `dropSteer` call.

**Status: HOLDS** (production). Residual test gap listed below (P2).

---

### 3. A-High filler — `replaceInterruptedFillerIfPresent` scoped to in-flight assistant

**Claim**: replace is scoped to the in-flight assistant's contiguous tool block via `savedAssistantId`. Global first-id match is REJECT.

**Live** `[inspected]`:

```217:251:companion/src/llm/tool-batch-heal.ts
export function replaceInterruptedFillerIfPresent(..., assistantId?: string): boolean {
  ...
  if (assistantId) {
    const asst = history.findIndex((m) => m.id === assistantId)
    if (asst < 0) return false
    from = asst + 1
    until = from
    while (until < history.length && history[until].role === "tool") until++
  }
  const filler = history.slice(from, until).find(...)
```

Adapter **passes** `savedAssistantId` on both success and exception paths:

- `adapter.ts:1415` success: `replaceInterruptedFillerIfPresent(..., savedAssistantId)`
- `adapter.ts:1608` exception: same
- `adapter.ts:1051-1052` `savedAssistantId = savedAssistant.id` before tool execution
- `adapter.ts:1396-1408` if assistant was cap-trimmed, do **not** append a late tool row

**Tests** `[executed]`:

- unit scope: `tool-batch-heal.test.ts:298-331` two assistants, same `call_A`, pass `"a-new"` → `f-old` stays INTERRUPTED, `f-new` replaced
- in-place keep id/position: `:256-296`
- integration during `executeTool`: `adapter-steer-overflow.test.ts:262-301` exactly one tool row, in-place after assistant

**Mutation-kill** `[executed]`: inlined global first-id `replaceInterruptedFillerIfPresent` (ignore `assistantId`). Same assertions as `:298-331`: **FAIL** (`f-old.error_code` became `undefined`, expected `'INTERRUPTED'`). Scope test is a real pin.

**Status: HOLDS**

---

### 4. Overflow / length retry compact `mid_loop` in auto mode only

**Claim**: byte-level retry compact uses `mid_loop` and only when `context_compaction === "auto"`.

**Live** `[inspected]`:

- `adapter.ts:624` `compactionSetting = params.config.context_compaction ?? "auto"`
- `adapter.ts:628-629` `runContextBudgetPass`: `"off"` returns immediately
- `adapter.ts:631-659` `"prompt"`: notify-only (`thread.context_compact_prompt`); **does not** assign `messages = compact.messages`
- Truncated tool batch `adapter.ts:990-1015`: retry iff `!lengthRecoveryUsed && compactionSetting === "auto"` then `await runContextBudgetPass("mid_loop")`; prompt still notify-only then `chat.error` 输出被截断; off skips retry
- Overflow catch `adapter.ts:1655-1677`: retry iff `!overflowRecoveryUsed && compactionSetting === "auto"` then `mid_loop`; prompt notify-only; error copy differs for non-auto
- Truncated retry runs **before** persisting this round's assistant (`adapter.ts:1032` save is after the truncated branch). `mid_loop` vs `pre_loop` matters for **prior** completed rounds; this round's incomplete tool_calls are discarded (correct)

**Tests** `[executed]`:

- overflow auto + live assistant/tool survive into retry request: `adapter-steer-overflow.test.ts:303-331` (`streamParams.length === 3`, retry messages contain `call_A` assistant + tool)
- overflow prompt / off: no retry (`:333-353`)
- length-truncated auto: one retry (`:355-366`, `streamParams.length === 2`)
- length-truncated prompt: no retry + `/输出被截断/` (`:368-377`)

Length-auto test does **not** pin `mid_loop` vs `pre_loop` (no prior tool round on the tape). Overflow-auto test **does** pin the live-suffix outcome. Live length path still calls `mid_loop` (`adapter.ts:1003`).

**Status: HOLDS** (live + overflow pin; length phase pin is live-only)

---

### 5. Attack the tests (mutation-kill)

`[executed]` `/tmp` copies, deleted:

| Mutation | Expected | Result |
|----------|----------|--------|
| Completions.prototype.create instead of `OpenAIProvider.prototype.streamChat` | fail | **0/13 pass, exit 1** |
| Completions flag probe, live `streamChat` | Completions not the seam | **`completionsHit=0`, `chat.error= Connection error.`** |
| Unscope `replaceInterruptedFillerIfPresent` (global first-id) | scope test fail | **FAIL** as predicted (`f-old` rewritten) |

Claimed pins for A-BLOCK and A-High filler **are killable**. A-High leftover concurrent-wipe is **not** killable by the existing queue-full test (see residuals).

---

## New findings

### P2 — `persistHealedToolRows` skip is global first-id, not tool-block scoped

**Live** `tool-batch-heal.ts:180-186`:

```ts
if (
  now.some(
    (row) => row.role === "tool" && (row.tool_calls || []).some((tc) => tc.id === m.id),
  )
) {
  continue
}
```

`replaceInterruptedFillerIfPresent` was scoped because global first-id is REJECT. Persist skip uses the same ID globally: if an **older** round already has `call_A`, healing the newest unpaired assistant with reused `call_A` writes **zero** fillers.

**Probe** `[executed]`: tape `[a-old + real call_A][a-new unpaired call_A]` → `persistHealedToolRows` `n=0`, no new filler. Newest round stays unpaired; `rebuildMessagesFromHistory` would strip it.

Not BLOCK: major providers emit unique `call_*` / `toolu_*`. Same collision the filler unit test constructs. Skip is conservative (won't rewrite an old success into INTERRUPTED) but is the inverse of the scoped-replace lesson. Inverse of A-High filler, same ID class.

### P2 — leftover→nextRun drops `clientMessageId` (r2 nit, still not BLOCK; slightly more than cosmetic)

**Live**:

- `run-queues.ts:14` `nextRunByThread = Map<string, string[]>`
- `run-queues.ts:40-47` `enqueueNextRun(threadId, text: string)` — no client id
- `adapter.ts:1757-1760` leftover maps **only** `.text` into `enqueueNextRun`

Mid-run `takeSteer` **does** echo first `client_message_id` (`adapter.ts:910-921`, test `:237-260`). Leftover is the **new** conversion path this PR added for final-round steers, and `SteerItem.clientMessageId` cannot survive `nextRun`. Text is not lost; F1 adopt of the original optimistic bubble cannot happen on this path. Still not data-loss / loop-corruption. **Not upgraded to High.**

### nit — leftover queue-full test does not pin “no dropSteer”

See must-falsify 2. Production HOLDS; test would still pass if `dropSteer` returned after leftover take.

### nit — length-truncated auto test does not pin `mid_loop` suffix

See must-falsify 4. Overflow test covers the pin that matters (live rows after a completed tool round).

### nit — `replaceInterruptedFillerIfPresent` optional `assistantId` still global

Without `assistantId`, `from=0, until=length` (`tool-batch-heal.ts:228-229`). Adapter always passes `savedAssistantId`. Unit test `:256` exercises the unscoped call. Footgun only.

No new BLOCK / High loop defects in exclusive production files.

---

## Residuals

| ID | Sev | Notes |
|----|-----|-------|
| leftover→nextRun drops `clientMessageId` | P2 | `nextRun` is `string[]`; F1 adopt incomplete on leftover path only. Mid-run HOLDS. |
| persist skip global same-id | P2 | Inverse of scoped replace; unique IDs make it rare. |
| leftover-full test vs concurrent `dropSteer` | nit | Production has no `dropSteer`; test wouldn't catch a regression. |
| length-auto `mid_loop` vs `pre_loop` | nit | Live calls `mid_loop`; overflow test pins the outcome. |
| length `off` mode untested | nit | Live skips retry (`!== "auto"`); overflow-off is tested. |
| prompt/off overflow error string not pinned | nit | Tests only `/上下文溢出/`. Distinct copy is at `adapter.ts:1673-1675`. |

r2 leftover-clientMessageId nit is **still a nit/P2**, not worse than bounded user-text loss. Queue-full leftover **does** drop text by design (`MAX_NEXT_RUN`); that is logged, tested, and not a silent `dropSteer` of successor steers.

---

## ADR-020

Implementer claim: Surface L0, no new L2, Trust unchanged, Autonomy = steer/nextRun queue.

Lane A exclusive slice:

| Check | Result |
|-------|--------|
| Axes fit | Autonomy queue plumbing + LLM-loop heal/overflow. Not a new runtime. |
| Surface | **L0**. No new tools, no Side Panel chrome, no CU/host/shell/netsec. |
| L2-classes | **none** in this slice. |
| Compose | **none**. |
| Trust monotonicity | Overlay/Allow/Deny not in slice. `createToolResultMessage` still redacts via `redactToolPayloadForPersistence`. Leftover queue-full drops user **text** (warned) — Autonomy bound, not a confirm skip. |
| originWs | N/A (no `securityConfirmations.request`). |
| Pack-first / confirm dialects | N/A. |
| Declaration | Present in shared adversary prompt. Not missing. |

**Challenge**: leftover `MAX_NEXT_RUN` drop is user-message loss without UI echo in this slice. Bounded + logged. Does **not** falsify L0 / Trust-unchanged.

Blast remains **T2**. No new confirm skip, overlay-as-Trust, or persistence secret leak in exclusive files.

---

## Score (outcome / trajectory / component)

- **Outcome**: r1 A-BLOCK (0/13 Connection error) closed on live HEAD — 13/13 adapter tests pass on `OpenAIProvider.prototype.streamChat`. Leftover no longer `dropSteer`. Filler replace scoped + adapter passes `savedAssistantId`. Overflow/length retry is auto+`mid_loop`.
- **Trajectory**: leftover F1 not plumbed through `nextRun`; persist skip still global. Incomplete cousins of the same PR's own pins, not reopen of r1 BLOCKs.
- **Component**: adapter run-loop + run-queues + tool-batch-heal. Machine-checkable.

---

VERDICT: APPROVE_WITH_NITS
