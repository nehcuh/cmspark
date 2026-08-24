# Lane A (Independent Adversary) — post-#219 kimi nits WIP — LLM loop

**Role**: INDEPENDENT ADVERSARY (Lane A). Did **not** implement these changes. Do not rubber-stamp.  
**Date**: 2026-08-25  
**Repo**: `C:\Users\HuChen\Projects\cmspark`  
**Claimed HEAD**: `daf8bc9` (#219 merge). **Actual HEAD** `[executed]`: `c5b4242` (`docs(memory): S78 session-end — #219 overlay + C-thin on main`) — parent of memory commit is `daf8bc9`.  
**Frozen patch**: `docs/audit/reviews/post219-kimi-nits-wip-20260825.patch`  
**SHA256** `[executed]`: `AD4794DCEFA42671E95C1FFA95466110C790FA9C15E92795743E3A48678F0AE4` (matches brief)  
**Live WIP** `[executed]`: dirty on exclusive range + untracked `companion/tests/adapter-steer-overflow.test.ts`  
**Blast (claimed)**: T2 LLM loop correctness. ADR-020: Surface L0, no new L2, Autonomy steer/nextRun, Trust unchanged.  
**overflow.ts**: **not touched** in WIP (`git diff --stat` empty for that file).

This lane defaults every claim to **REFUTED** unless pinned with `file:line` and tags evidence `[executed]` / `[inspected]` / `[assumed]`.

---

## Capability declaration

| Axis | Declared | Lane A check |
|------|----------|--------------|
| Surface | L0 | `[inspected]` No new tool surfaces / L2 classes in exclusive range |
| L2-classes | none | `[inspected]` Confirmed — adapter/queues/heal/trim only |
| Compose | none | `[inspected]` |
| Autonomy | steer / nextRun | `[inspected]` `run-queues.ts` + adapter finally leftover→nextRun |
| Trust | unchanged | `[inspected]` No confirm-center / whitelist / cookie gate edits in range |
| Channel | n/a (harness) | — |

---

## Machine test results `[executed]`

Host: Windows, PowerShell, Node via `npx tsx --test`. CWD: `companion/`.

| Suite | Pass | Fail | Notes |
|-------|------|------|-------|
| `tests/adapter-steer-overflow.test.ts` | **0** | **13** | All fail — OpenAI prototype mock never hit; live path emits `Connection error.` |
| `tests/run-queues.test.ts` | **7** | 0 | Includes D6 `clientMessageId` enqueue/take |
| `tests/tool-batch-heal.test.ts` | **11** | 0 | Helper + duck-typed tape; supersede skip + cap-trim stop |
| `tests/threads-history.test.ts` | **58** | 0 | Includes orphan-tool / over-cap `trimMessagesTurnSafe` cases |
| **Combined (brief command)** | **76** | **13** | `ℹ tests 89` |

Command:

```text
npx tsx --test tests/adapter-steer-overflow.test.ts tests/run-queues.test.ts tests/tool-batch-heal.test.ts tests/threads-history.test.ts
```

### Why the “production-path” suite is FAKE `[executed]`

`chatCreate` uses `createProvider` → `OpenAIProvider` → `this.client.chat.completions.create` (`companion/src/llm/providers/openai.ts:55-57`).

Private probe (not committed):

1. Patch `Object.getPrototypeOf(new OpenAI(...).chat.completions).create` the same way the new test does.
2. `createProvider(...).streamChat(...)` → **`Connection error.`**, mock hit count **0**.
3. Provider client's Completions **prototype ≠** test dummy's Completions prototype (`same proto? false`).
4. Patching the *provider* client's prototype works; patching the test's `import('openai')` prototype does **not** affect `OpenAIProvider`.

Dual-package / dual-class hazard under `tsx`: the new suite mocks the wrong `create`. Failures are not flaky assertions of the folds — the folds are **never reached** (e.g. leftover hook never runs; `streamParams.length === 0`; abort generator never starts; `chat.done` absent).

**Must-falsify attack “Tests that mock the production path vs only helpers” → SUCCEEDS.**  
Helper suites (`run-queues`, `tool-batch-heal`, pure `trimMessagesTurnSafe`) are real. `adapter-steer-overflow.test.ts` is **not** evidence of loop correctness.

---

## Claims vs live call sites

| # | Claimed fold | Live call site | Folded? | Evidence |
|---|--------------|----------------|---------|----------|
| 1 | Leftover steers on normal finish → `nextRun`; abort must **not** convert; queue-full → warn + drop | `adapter.ts:1749-1771` (`finally`, `!signal?.aborted`, `takeSteer` → `enqueueNextRun` / warn `llm.steer_leftover_dropped` + `dropSteer`) | **PARTIAL** | `[inspected]` Logic present; replaces old silent `dropSteer` on normal finish. Abort skip matches comment + `abortThreadChat`→`dropSteer` (`message-router.ts:145-162`) `[inspected]`. Queue-full `dropSteer` after `takeSteer` is hazardous (BLOCK/High below). Integration tests **FAKE** (0/13). |
| 2 | Steer items optional `clientMessageId`; first echoed as `chat.user` `client_message_id` | `run-queues.ts:7-26`; `adapter.ts:903-923` | **FOLDED** (mid-run) / **GONE** on leftover→nextRun | `[inspected]` Mid-run first-id wins. `nextRun` is `string[]` only (`run-queues.ts:14,40-47`) — leftover conversion **drops** ids. Helper tests pass `[executed]`. Adapter echo test FAKE. |
| 3 | `replaceInterruptedFillerIfPresent`: successor INTERRUPTED filler replaced in place | `tool-batch-heal.ts:217-240`; call sites `adapter.ts:1415-1417`, `1608-1610` | **PARTIAL** | `[inspected]` Replace-not-append wired on success + exception paths. Matcher is **global first** `toolCallId`+`INTERRUPTED` (not scoped to `savedAssistantId`) — wrong-row attack open. Helper test passes; chatCreate supersede test FAKE. |
| 4 | `persistHealedToolRows` re-reads before **every** insert; skip ids on disk; stop if assistant cap-trimmed | `tool-batch-heal.ts:163-205` | **FOLDED** | `[inspected]` + `[executed]` helper tests for supersede race skip + cap-trim stop. |
| 5 | Overflow/length truncated-batch retry uses `mid_loop`, **only** `compaction=auto`; prompt/off skip byte retry | `adapter.ts:995-1015`, `1655-1677` | **FOLDED** (static) | `[inspected]` Both paths gated on `compactionSetting === "auto"` and call `runContextBudgetPass("mid_loop")`. prompt gets notify-only mid_loop; off skips via early return in budget pass. **No** `[executed]` production proof (suite FAKE). `overflow.ts` classifiers unchanged `[inspected]`. |
| 6 | Pure-text length stop → `chat.done` `truncated:true` | `adapter.ts:1121-1124` + `isLengthStop` | **FOLDED** (static) | `[inspected]` Spread only on no-tool completion path. Tests FAKE. |
| 7 | Tool-format-leak `chat.token` = accumulated + hint (full snapshot) | `adapter.ts:1095-1101` | **FOLDED** (static) | `[inspected]` Was hint-only `\n\n${hint}`; now `` `${assistantContent}\n\n${hint}` ``. Tests FAKE. |
| 8 | `trimMessagesTurnSafe`: orphan tool suffix keeps anchor (over-cap), not empty/tool-leading | `thread-manager.ts:228-252` | **FOLDED** | `[inspected]` + `[executed]` threads-history tests for all-tool suffix / system-anchored / never-empty. |

Legend: **FOLDED** = live code matches claim · **PARTIAL** = claim half-true / residual hole · **FAKE** = tests claim production coverage they do not have · **GONE** = claim absent on that path.

---

## Must-falsify attacks

### A1 — Supersede: predecessor finally leftover→nextRun vs successor drain/steer wipe

**Intent**: Predecessor converts leftover steers into nextRun (or dropSteer) and clobbers successor steers.

**Result**: **Mostly closed on abort/supersede; residual wipe on queue-full path.**

- Supersede goes through `abortThreadChat` → `controller.abort()` + `dropSteer` (`message-router.ts:145-162`) `[inspected]`.
- Predecessor `finally` only converts when `!signal?.aborted` (`adapter.ts:1749`) `[inspected]` — abort path does **not** convert (claim 1 abort half holds statically).
- **Open hole**: on normal finish with **full** `nextRun`, code does `takeSteer` then on failed `enqueueNextRun` calls `dropSteer` (`adapter.ts:1757-1767`). `takeSteer` already emptied the queue; any steer enqueued **after** take and **before** drop (concurrent `chat.steer` / successor) is wiped by that `dropSteer`. Comment at `1770-1771` claims supersede skip prevents wipe — it does **not** cover this queue-full branch.

### A2 — `takeSteer` then persist: empty steer after take, crash before persist = lost user text

**Result**: **ATTACK HOLDS** (inherent; newly widened by leftover path).

- Mid-run: `takeSteer` then `addMessage` (`adapter.ts:903-915`) — crash between ⇒ user steer text gone from both queue and disk `[inspected]`.
- Finally leftover: `takeSteer` then `enqueueNextRun` (`adapter.ts:1757-1760`) — crash between ⇒ text gone; `nextRun` itself is process-memory only (`run-queues.ts` header) `[inspected]`.
- No journal/rollback. Not unique to this WIP, but leftover conversion **adds** another take-then-side-effect window. No test covers crash injection `[executed]`.

### A3 — `replaceInterruptedFillerIfPresent` matching wrong row (same tool id on a different assistant)

**Result**: **ATTACK OPEN** (id-global match + global skip interact badly).

```227:234:companion/src/llm/tool-batch-heal.ts
  const filler = history.find(
    (m) =>
      m.role === "tool" &&
      typeof m.id === "string" &&
      (m.tool_calls || []).some(
        (tc) => tc.id === toolCallId && tc.result?.error_code === INTERRUPTED_ERROR_CODE,
      ),
  )
```

- Not scoped to the in-flight `savedAssistantId` / contiguous tool block `[inspected]`.
- `persistHealedToolRows` skip check is also **whole-tape** id presence (`tool-batch-heal.ts:180-186`) `[inspected]`.
- Scenario: older INTERRUPTED row for `call_A` still on tape; newer assistant also emits `call_A` (provider-collision / test-style ids). Entry heal **skips** writing a filler for the new assistant (id already present). Old run/new run `replaceInterruptedFillerIfPresent` updates the **old** filler. New assistant stays unpaired → rebuild strips tools; model may retry side effects.
- Helper tests only use a single assistant tape `[executed]`. Production chatCreate supersede test FAKE.

### A4 — `mid_loop` compact still drops live round

**Result**: **Not proven either way inside exclusive range.**

- Adapter correctly passes `"mid_loop"` on overflow/length retry (`adapter.ts:1003`, `1663`) `[inspected]`.
- Pin semantics live in `context-budget.ts` (out of exclusive edit range; pre-existing tests exist elsewhere) `[assumed]` from prior suite names.
- The WIP test that claims live assistant+tool survive retry is FAKE (`streamParams.length === 0`) `[executed]`.
- Default: **REFUTED as verified** — static phase argument looks right; no Lane A executed proof on production path.

### A5 — Tests mock production path vs only helpers

**Result**: **ATTACK SUCCEEDS — BLOCK.**

See machine results. Claims 1, 2 (echo), 3 (in-loop), 5, 6, 7 are **not** `[executed]` on `chatCreate`. Only helper-level folds (4, 8, queue D6 shape) have green executed proof.

---

## Findings

### BLOCK

1. **`adapter-steer-overflow.test.ts` does not exercise production LLM path (13/13 fail)**  
   - Dual OpenAI Completions prototype under `tsx`; mock never intercepts `OpenAIProvider`.  
   - Observed errors: `Connection error.` → continuous-failure stop; `takeNextRun` undefined; missing `chat.done`; abort path never rejects.  
   - **Falsifies** the WIP’s primary regression net for leftover→nextRun, mid_loop retry, truncated flag, leak snapshot, and in-loop filler replace.  
   - Fix direction (advisory only): patch the provider client’s prototype, inject a fake `LlmProvider`, or share one OpenAI module instance — Lane A does not implement.

### High

2. **Queue-full leftover path: `dropSteer` after `takeSteer` can wipe concurrent steers** — `adapter.ts:1757-1767`  
   - After leftovers are already drained, `dropSteer` is either a no-op **or** deletes steers that arrived in the race window.  
   - Conflicts with the finally comment’s supersede/wipe rationale (`adapter.ts:1770-1771`).  
   - Prefer: on `enqueueNextRun` failure, warn and discard the **already-taken** leftover only — **never** call `dropSteer` here.

3. **`replaceInterruptedFillerIfPresent` / heal skip are id-global, not round-scoped** — `tool-batch-heal.ts:180-186`, `227-234`  
   - Wrong-row / unpaired-new-assistant risk under tool_call_id collision (A3).  
   - Prefer: match filler only within the tool block after the target assistant id; heal skip should be contiguous-following, not whole history (or require assistant ownership).

### Nit

4. **Leftover→nextRun drops `clientMessageId`** — `adapter.ts:1759-1760` + `nextRunByThread: string[]`  
   - Claim 2 F1 adopt does not survive deferred conversion; optimistic bubble adopt may fail on drained nextRun user echo `[assumed]` router drain behavior outside exclusive write, but queue type is definitive `[inspected]`.

5. **`dropSteer` on queue-full is dead for the taken leftovers** — redundant even without the race; leftovers are already out of the steer map.

6. **Abort detection asymmetry** — `finally` keys off `signal?.aborted` only. An `AbortError` thrown without aborting the signal would still convert leftovers (`adapter.ts:1749` vs catch at `1639`). Narrow; supersede path does abort the signal `[inspected]`.

7. **Brief HEAD mismatch** — review target should cite `c5b4242` (or dirty WIP), not only `daf8bc9`.

---

## What is actually solid `[inspected]` / `[executed]`

- Steer queue carries optional `clientMessageId` (`run-queues.ts`) — helper tests green.
- Normal-finish leftover intent is coded (no longer silent `dropSteer` of leftovers).
- `persistHealedToolRows` re-read / skip-existing-id / stop-on-missing-assistant — helper tests green.
- `trimMessagesTurnSafe` orphan/over-cap behavior — threads-history green.
- Static wiring for mid_loop + auto-only byte retry, `truncated:true`, full leak `chat.token` snapshot looks correct in `adapter.ts` — **unproven by the new suite**.

---

## Verdict rationale

Lane A will not APPROVE:

1. The only suite meant to lock the run-loop folds is **entirely non-functional** against the real provider path (BLOCK).
2. Queue-full `dropSteer` re-introduces the successor/concurrent steer wipe the finally comment claims to avoid (High).
3. Filler replace wrong-row attack remains open (High).
4. Several claims are therefore **PARTIAL** or only statically FOLDED without executed production proof.

Not MERGE-READY. Adversary verdict:

VERDICT: REJECT
