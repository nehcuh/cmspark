# PR #218 remainder nits r2 — independent adversary (incremental)

**Date**: 2026-08-24  
**Reviewer**: same independent adversary as `pr218-remainder-nits-adversary-20260824.md` (APPROVE_WITH_NITS, N1–N9)  
**Prompt**: `docs/audit/reviews/pr218-remainder-nits-r2-adversary-prompt-20260824.md`  
**Branch**: `feat/agent-loop-durability-p0`  
**Blast**: T2 (unchanged). Not T3.

Do **not** REJECT for missing Continue UI / lanes / op-log / pending_confirms.

Evidence: `[inspected]` live production files. This sandbox has no shell; tsc/node --test not executed. Verdict is from call sites.

## Capability (ADR-020) — unchanged

```text
Surface:      L0
L2-classes:   (none)
Compose:      none
Autonomy:     single
Trust:        unchanged
Channel:      community (summoner ACL still includes chat.steer)
```

---

## Claimed folds vs live call sites

| Nit | Claimed | Live | Folded? |
|-----|---------|------|---------|
| **N1** leftover steer after `chat.done` | `dropSteer` in `chatCreate` try/finally | `adapter.ts:878-1707` `try { while … } finally { dropSteer(threadId) }`. Text-only `chat.done` returns inside the while (`:1097-1101` region) → finally runs. Overflow/`truncatedToolBatch` `return` also hit finally. | **GONE** |
| **N2** steer not lease/conductor gated | both gates in `chat.steer` | `message-router.ts:554-558` after `no_active_run`. Same helpers as `chat.create` (`:317-320`). Test `chat.steer is lease-gated like chat.create` asserts `OVERLAY_STANDBY`. | **GONE** |
| **N3** no live `chat.user` | send after persist | `adapter.ts:906-917` `addMessage` then `sendToExtension({ type:"chat.user", thread_id, message_id, content })` — same shape as the real user echo at `:410-417` (no `client_message_id`, none exists). | **GONE** |
| **N4** uncapped steer | `MAX_STEER=8`, `steer_queue_full` | `run-queues.ts:9-18` `enqueueSteer` returns `false` when full. Router `:560-566` maps that to `steer_queue_full` + `max`. Helper test caps. | **GONE** |
| **N5** trim can keep `[]` | keep assistant+tools (over-cap) rather than empty | `thread-manager.ts:238-249`: if the tool-block runs to EOF, `start = a` (assistant), not `k===length`. Fallback `kept.length > 0 ? kept : slice(-max)`. Test `never returns empty for a non-empty tape`. | **GONE** |
| **N6** missing tests | `isTruncatedToolBatch`; abort does not drain nextRun; lease gate | `overflow.ts:15-20` + `overflow.test.ts`; `files.test.ts:390-392` `abortThreadChat` then `peekNextRunCount === MAX_NEXT_RUN`; `files.test.ts:399-421` lease on steer. Adapter **loop** still untested (see residuals). Claimed items exist. | **GONE** (as claimed) |
| **N7** validate vs `empty_steer` | **not folded** | `validate.ts:48-50` still `"chat.steer requires message string"`. Router `:548-549` still `empty_steer`. | residual, as claimed |
| **N8** overflow “context window” miss | regex includes `context window` / `exceeds the (model's )?context` | `overflow.ts:5` + test `"exceeds the model's context window"`. | **GONE** (classifier part) |
| **N9** length retry may not enlarge output budget | **not folded** | still `runContextBudgetPass("pre_loop")` on length retry (`adapter.ts:989-993`). Retry-once then `chat.error`+`return`. | residual, as claimed |

No claimed fold is fake.

---

## Prior REJECT still gone (spot-check)

- `takeNextRun` still CAS’d (`message-router.ts:530-538`).
- Truncated batch still uses `isTruncatedToolBatch` **before** save/execute (`adapter.ts:984-1000`).
- Overflow after retry still `chat.error`+`return` (`adapter.ts:1621-1633`), fake `Error occurred:` only later (`:1692-1696`).
- Empty enqueue / `queue_full` unchanged.
- B1 heal-before-user / B2 select-no-heal unchanged.

Abort still `dropSteer` and does **not** `takeNextRun` (`message-router.ts:157-160`; generation bump `:154` makes predecessor skip drain).

---

## New / leftover nits (non-blocking)

**R2-N1 — `dropSteer` finally vs supersede race**  
`chatCreate` finally always clears steer. Supersede aborts the predecessor **without** `abortThreadChat` (`message-router.ts` existing.abort + drain), then predecessor’s `finally` `dropSteer`s. If a `chat.steer` is accepted against the successor controller during `drainThreadOnSupersede`’s await, the predecessor finally can wipe it. Narrow, single-threaded, not trust. Not a BLOCK.

**R2-N2 — N5 over-cap can disable the 1000-cap for one giant tool-block**  
If assistant+contiguous tools are the whole tape, trim keeps **all** of them (`start = a`). Next inserts grow unbounded. Same pathological 1000-parallel-tools case as original N5. Empty tape is gone; unbounded growth is the trade they claimed. Do not REJECT.

**R2-N3 — N8 remainder: `isLengthStop` is still `finish_reason`-only**  
They folded the overflow **string** miss, not omitted terminal SSE. Incomplete tools with no `done.finish_reason` can still execute; JSON.parse is the safety net. Same as before, not a fake fold.

**R2-N4 — Adapter-loop still has no test**  
`isTruncatedToolBatch` is a helper unit test, not `chatCreate` refusing execute. Production path holds by inspection.

**R2-N5 — `dropSteer` finally does not wrap pre-loop compact**  
`await runContextBudgetPass("pre_loop")` is **before** the `try` (`adapter.ts:858` vs `:878`). A throw there leaves queued steers. Rare.

N7 / N9 remain as the implementer said.

---

## Outcome / trajectory

Folds are at the production call sites, not test-only. Scope still remainder+nits (steer cap/gates/echo, trim empty-guard, overflow regex, small tests). No Continue UI. No persist `running=true`. Trust/originWs untouched.

---

## Summary

N1–N6 and N8 (classifier) are actually gone at call sites. N7/N9 remain on purpose. Leftovers are similar non-blocking edges (supersede/dropSteer race, over-cap growth, finish_reason-only, no adapter-loop test). No new BLOCK. No fake fold.

VERDICT: APPROVE_WITH_NITS
