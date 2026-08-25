# Lane A — LLM loop / run-queues / heal (independent adversary, nits fold)

- **Lane**: A (LLM loop) — independent of the implementer session. Did not author the fold. Default: REFUTED.
- **HEAD**: `9deff00da9ee3e1d9d3014b5da1d509ce91116b6` (`9deff00` fix(agent): fold post-#220 residual nits)
- **Range**: `1d16b0e..9deff00`
- **Date**: 2026-08-25
- **Method**: live-file inspect at HEAD; exclusive-range diff; frozen-patch SHA256; `tsx --test`; `/tmp` mutation-kill then delete
- **Exclusive files**: `companion/src/llm/run-queues.ts`, `companion/src/llm/adapter.ts` (leftover `finally` / `convertLeftover` only), `companion/src/llm/tool-batch-heal.ts` (`persistHealedToolRows` skip only), tests `run-queues.test.ts`, `tool-batch-heal.test.ts`, `adapter-steer-overflow.test.ts`
- **Read-only out of exclusive write range**: `companion/src/message-router.ts` drain / occupied enqueue (S-A1 follow-up contract)
- **Frozen patch SHA256** `[executed]`: `2625238075ef8720b4dc8ca73124742b068b54c8b7d721b1dfd2d4c793274b51` — matches prompt **and** `git diff 1d16b0e..HEAD -- companion`
- **Production**: not edited. `/tmp/cmspark-lane-a-nits-mut` deleted after mutations. Worktree `companion/node_modules` symlink removed.

---

## Machine results

cwd: `companion/` (worktree had no `node_modules`; temporary symlink to parent checkout `/Users/huchen/Projects/cmspark/companion/node_modules`, then removed).

```
npx tsx --test tests/run-queues.test.ts tests/tool-batch-heal.test.ts tests/adapter-steer-overflow.test.ts
ℹ tests 37
ℹ pass 37
ℹ fail 0
TEST_EXIT:0
```

Breakdown `[executed]`:

| File | Tests | Result |
|------|------:|--------|
| `adapter-steer-overflow.test.ts` | 14 | 14 pass (was 13) |
| `tool-batch-heal.test.ts` | 13 | 13 pass (was 12) |
| `run-queues.test.ts` | 10 | 10 pass (was 7) |
| **total** | **37** | **37 pass / 0 fail** |

Extra supporting (not in the mandated exclusive command; same HEAD copy): `message-router-nextrun-drain.test.ts` **15/15**, including `enqueue nextRun preserves clientMessageId into drained chat.create (S-A1)`.

`tsc --noEmit` was **not** in this round's machine card; not claimed.

---

## Capability / ADR-020 (Lane A slice)

Implementer claim (prompt body — present, not missing):

```text
Surface:      L0
L2-classes:   none
Compose:      none
Autonomy:     steer / nextRun queue plumbing
Trust:        persistence redaction tighter (passwd, non-string secret keys)
Channel:      overlay bind/reclaim live-gate
```

Lane A exclusive diff is Autonomy plumbing (nextRun item shape, leftover conversion helper, persist skip scope). No new tools, no Pack chrome, no confirm family, no `securityConfirmations.request`, no L2-class, no CU/god-mode/auto_approve, no experimental locator. Trust/Channel axes belong to lanes D/C.

| Check | Lane A |
|-------|--------|
| Axes fit | Autonomy. Not a “middle agent”. |
| Pack-first | n/a — no new scenario chrome |
| Confirm dialects | none |
| Trust monotonicity | n/a — no deeper Surface |
| originWs | not touched |
| No new runtime | holds — queue item + helper only |
| Experimental layers | not touched |
| P1-1..4 watchlist | not touched |

**Blast**: T2 (UI bubble adopt + heal skip scope). Not T3: overlay is not Allow/Deny here; persist skip is not a secret-persist path.

---

## Must-falsify

### 1. S-A1 — `nextRun` is `{text, clientMessageId?}`; leftover join keeps first id

**Claim**: `NextRunItem = { text, clientMessageId? }`. Leftover join keeps the first `clientMessageId`. Occupied enqueue is message-router (read-only here). Adapter leftover → `convertLeftoverSteerToNextRun` must pass the first cmid. Drain follow-up `chat.create` echoes it.

**Live** `[inspected]`:

- `run-queues.ts:16-21` `export type NextRunItem = { text: string; clientMessageId?: string }`
- `run-queues.ts:47-55` `enqueueNextRun(threadId, text, clientMessageId?)` stores `{ text, clientMessageId }` only when `typeof id === "string" && id.trim()`; otherwise `{ text }` (key absent)
- `run-queues.ts:58-64` `takeNextRun(): NextRunItem | undefined`
- `run-queues.ts:71-79` `convertLeftoverSteerToNextRun`: `takeSteer` → join texts with `"\n"` → `leftover.find((s) => s.clientMessageId)?.clientMessageId` → `enqueueNextRun(threadId, text, clientMessageId)`
- `adapter.ts:43` imports `convertLeftoverSteerToNextRun, takeSteer` — **no** `enqueueNextRun` left in adapter
- `adapter.ts:1748-1768` non-abort `finally` calls `convertLeftoverSteerToNextRun(threadId)` only
- Mid-run steer join is the same “first present id” rule (`adapter.ts:910`)
- Occupied enqueue `[inspected, out of exclusive write]`: `message-router.ts:441-450` `enqueueNextRun(rest.thread_id, text, enqueueId)` with `typeof rest.clientMessageId === "string" && rest.clientMessageId`
- Drain `[inspected]`: `message-router.ts:335-338` `followUpCreateFromQueue(..., queued.text, session?.surface, queued.clientMessageId)` → `followUpCreateFromQueue` (`:261-278`) spreads `clientMessageId` onto the follow-up `chat.create`

**Tests** `[executed]`:

- `run-queues.test.ts:75-85` enqueue/take carries cmid; plain entry has no key
- `run-queues.test.ts:100-109` leftover join `"a\nb"` + `clientMessageId === "cm-a"`
- `adapter-steer-overflow.test.ts:177-193` leftover path: enqueueSteer with `"cm-leftover"` during final stream → `takeNextRun()?.clientMessageId === "cm-leftover"`
- Extra: drain test echoes `client_message_id === "cm-enq-1"`

**Mutation-kill** `[executed]` private `/tmp/cmspark-lane-a-nits-mut` (deleted after):

1. **Omit cmid in convertLeftover** (`enqueueNextRun(threadId, text)` with no third arg): **2 fail / 22 pass** of the 24-file pair.
   - `convertLeftoverSteerToNextRun keeps first clientMessageId (S-A1)` — `undefined !== 'cm-a'` (`run-queues.test.ts:108`)
   - `steer arriving during the final streaming round converts to nextRun` — `undefined !== 'cm-leftover'` (`adapter-steer-overflow.test.ts:189`)
   - Direct `enqueueNextRun(..., "cm-nr-1")` test still green (does not go through leftover). Pin is on the leftover helper + adapter finally path.

2. **Two-id live probe** (not a unit test): leftover `cm-a` then `cm-b` → `{ text: "a\nb", clientMessageId: "cm-a" }` (`PROBE_FIRST_WINS=ok`). Head without id then `cm-y` → `cm-y` (`PROBE_FIRST_PRESENT=ok`). Matches F1 “first present”.

3. **Last-present mutation** (`[...leftover].reverse().find(...)`): exclusive unit tests **24/24 still green**. Two-id probe then returns `cm-b` (probe exit 1). The S-A1 unit test only puts a cmid on the first leftover, so it does **not** distinguish first vs last present.

**Status: HOLDS** for production + leftover-omit mutation. Residual pin gap: first-vs-last (nit, below).

---

### 2. S-A2 — persist skip scoped to the in-flight assistant contiguous tool block

**Claim**: `persistHealedToolRows` skip is scoped to the in-flight assistant’s contiguous tool block. Probe `[a-old + real call_A][a-new unpaired call_A]` must persist a filler for `a-new`. Mutation: restore global `now.some(id)` skip → new test red.

**Live** `[inspected]`:

- `unpairedToolCallsFromAssistant` (`tool-batch-heal.ts:57-68`) already breaks on the first non-`tool` follower, so `a-new` still sees `call_A` as missing (old real row is *before* `a-new`).
- Skip (`tool-batch-heal.ts:177-190`): `blockUntil` walks `role === "tool"` after `asstNow`; `now.slice(asstNow + 1, blockUntil).some(id)` — **not** `now.some`.
- Race closer (real result landed after snapshot) still walks a contiguous tool tail, so EOF-pushed `role: tool` remains in-block. The pre-existing race test stayed green under the S-A2 mutation.

**Tests** `[executed]`: `tool-batch-heal.test.ts:219-257` — persist count `n === 1`, filler sits in `a-new`’s block with `INTERRUPTED`, `t-old` real result untouched.

**Mutation-kill** `[executed]` `/tmp` copy: restore global

```ts
now.some((row) => row.role === "tool" && (row.tool_calls || []).some((tc) => tc.id === m.id))
```

Result: **12 pass / 1 fail** of `tool-batch-heal.test.ts`.

```
✖ persistHealedToolRows: skip is scoped to the in-flight assistant block (S-A2)
  AssertionError: newest unpaired call_A must still get a filler
  0 !== 1
```

(`tool-batch-heal.test.ts:250`)

**Status: HOLDS**

---

### 3. S-A3 — leftover conversion on queue-full does not wipe later steers; adapter has no `\bdropSteer\b`

**Claim**: `convertLeftoverSteerToNextRun` on queue-full does not wipe later steers. Adapter source must not contain `\bdropSteer\b`. Mutation: add `dropSteer` inside `convertLeftover` on full → **S-A3 unit test red**.

**Live production** `[inspected]`:

- `adapter.ts:43` `import { convertLeftoverSteerToNextRun, takeSteer }` — **no** `dropSteer`
- Python `\bdropSteer\b` on `adapter.ts`: **False**. `\bconvertLeftoverSteerToNextRun\b`: **True**.
- `adapter.ts:1757-1767` on `leftover.dropped`: warn only. Comment forbids wiping the live steer queue.
- `run-queues.ts:71-79` `convertLeftoverSteerToNextRun`: `takeSteer` then `enqueueNextRun`; on full returns `{ converted: 0, dropped: leftover.length }` — **no** `dropSteer(` call. The identifier appears in this file only as the exported function (`:41`) and a comment (`:69`).
- Adapter `finally` does not call `dropSteer` after the helper either.

**Tests** `[executed]`:

- `run-queues.test.ts:87-98` `"convertLeftoverSteerToNextRun does not dropSteer on queue-full (S-A3)"` — fill nextRun, leftover steer, `dropped === 1`, **then** `enqueueSteer("concurrent after take")`, assert that item is still there.
- `adapter-steer-overflow.test.ts:418-427` source-scan: `adapter.ts` matches `convertLeftoverSteerToNextRun` and `doesNotMatch(/\bdropSteer\b/)`.

**Mutation-kill** `[executed]` `/tmp`:

1. **Specified mutation** — insert `dropSteer(threadId)` in `convertLeftoverSteerToNextRun` on the queue-full path, immediately before `return { converted: 0, dropped: leftover.length }`.
   - Exclusive pair **24/24 still green**, including both S-A3-named tests.
   - Why: `takeSteer` already emptied the steer map; `dropSteer` on that empty map is a no-op. The unit test enqueues “concurrent” **after** `convertLeftover` returns, so it never occupies the take→drop window. This is the **same pin gap** as merged-round S-A3, relocated into the helper.
   - **Claimed mutation-kill of the S-A3 unit test: REFUTED.**

2. **Adapter token mutation** (not the specified convertLeftover mut): insert a `dropSteer(threadId)` line in `adapter.ts` `finally` before `convertLeftoverSteerToNextRun`.
   - `adapter leftover path does not import dropSteer (S-A3)` goes red (`doesNotMatch /\bdropSteer\b/`).
   - Most other adapter tests `ReferenceError: dropSteer is not defined` (unbound identifier). Source-scan **does** pin adapter.ts; it does **not** pin `run-queues.ts` `convertLeftover`.

**Status: production HOLDS; specified unit-test mutation-kill FAILS.** Residual nit (below). Not a production regression — leftover conversion still does not call `dropSteer`.

---

## Scores

| Axis | Score | Note |
|------|-------|------|
| **Outcome** | pass + residual nits | S-A1 leftover-omit kill red; S-A2 global-skip kill red; S-A3 production clean but specified test-kill green |
| **Trajectory** | focused | Exclusive `+141/−26` across 6 files; helper extraction is the right shape; no drive-by in Lane A files |
| **Component** | right hotspots | `NextRunItem` + `convertLeftoverSteerToNextRun` (`run-queues.ts:16-79`); adapter `finally` (`adapter.ts:1748-1768`); persist slice skip (`tool-batch-heal.ts:177-190`) |

---

## Residual nits (non-blocking)

| ID | Sev | Evidence | Why not REJECT |
|----|-----|----------|----------------|
| S-A3 test pin still misses the take→drop window | nit | `/tmp` `dropSteer` inside `convertLeftover` on full → S-A3 unit test **still green** (24/24). Test enqueues concurrent *after* the helper returns. Adapter source-scan only covers `adapter.ts`. | Production has no `dropSteer` in leftover conversion. Same class as the original S-A3 nit; fold of the *pin* is incomplete, fold of *behavior* holds. |
| S-A1 first-vs-last unit pin is one-id | nit | Unit leftover test is `("a","cm-a")` + `("b")` only. Last-present mutation keeps unit tests green; two-id live probe shows production keeps `cm-a`. | Production uses `.find` (first present), matching mid-run steer (`adapter.ts:910`). Omit-cmid mutation already kills the leftover tests. |

No P0/P1 in exclusive range. Do not REJECT solely for M3 / N1 / N9 (out of slice).

---

## Eval gate card — `post220-nits` Lane A

**Blast tier**: T2  
**Date**: 2026-08-25  
**Base**: `1d16b0e` → HEAD `9deff00`

### Capability declaration (ADR-020)

```text
Surface:      L0
L2-classes:   none
Compose:      none
Autonomy:     steer / nextRun queue plumbing
Trust:        n/a this lane (redact is Lane D)
Channel:      n/a this lane (overlay is Lane C)
```

### Machine

- [x] `npx tsx --test tests/run-queues.test.ts tests/tool-batch-heal.test.ts tests/adapter-steer-overflow.test.ts` → **37/37** `TEST_EXIT:0` `[executed]`
- [x] Outcome DoD: leftover nextRun carries first cmid; persist scoped skip heals reused `call_*`; adapter leftover path has no `dropSteer`
- [x] No forbidden tools/paths / no default-on surprise

### Trajectory

- [x] Diff scope matches claimed nits (run-queues item + leftover helper, persist skip, tests)
- [x] No thrash / unrelated drive-by in exclusive files

### Component

- `companion/src/llm/run-queues.ts:16-79`
- `companion/src/llm/adapter.ts:43,1748-1768`
- `companion/src/llm/tool-batch-heal.ts:177-190`

### Blast

- [x] T2 allows this merge path given residual nits only
- Residual: S-A3 unit test still does not occupy the concurrent-steer window; S-A1 two-id pin is a probe not a unit test

### Verdict table (this lane only)

| Gate | Result |
|------|--------|
| MACHINE | **PASS** (37/37 exclusive + S-A1/S-A2 mutation-kill) |
| ADVERSARY | **APPROVE_WITH_NITS** (this report) |
| PI_REREVIEW | N/A this agent |
| MERGE | not this lane’s call — nits are non-blockers |

---

## What would change the verdict

- **REJECT**: leftover conversion actually calls `dropSteer` / adapter `\bdropSteer\b` in production; persist skip still global (S-A2 test missing or green under `now.some`); leftover nextRun drops cmid in production.
- **APPROVE**: S-A3 unit test occupies the take→drop window (e.g. inject a steer between `takeSteer` and the full-path return) so the specified `dropSteer`-on-full mutation actually reds; leftover unit test has two cmids so last-present mutation reds.

Neither production failure is present. The specified S-A3 test-kill is not present either — hence AWN, not APPROVE.

VERDICT: APPROVE_WITH_NITS
