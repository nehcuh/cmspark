I've independently verified both adversary reports against the live code and re-run the checks.

## Verification results

**Machine checks (re-ran):** `npx tsc --noEmit` exit 0; targeted `node --test` suite **216 pass / 0 fail** (run-queues, overflow, threads-history, summoner-acl, ws-tool-forward, single/files, ws-router-validator-lockstep, tool-batch-heal, context-budget, m10-abort-orphans, composer-lease).

**Prior REJECTs stay gone (call-site read):**
1. **takeNextRun CAS** — `message-router.ts:526-537`: drain is gated on `llmLoopGeneration.get(thread) === myGeneration`, after the CAS'd finally. Supersede bumps generation before aborting the predecessor (`:370-378`), so a dead predecessor can't steal the queue.
2. **Truncated batch no-execute** — `adapter.ts:984-1000`: `isTruncatedToolBatch(finishReason, hasToolCalls)` runs **before** `addMessage`/execute loop; retry-once with `round--` + `pre_loop` compact, second hit `chat.error`+`return`.
3. **Overflow no fake user row** — `adapter.ts:1621-1633`: `return` inside the overflow branch. `Error occurred:` row (`:1690-1694`) reachable only for recoverable non-overflow errors.
4. **queue_full/empty_enqueue/chat.enqueued** — `message-router.ts:348-365`, before `nextLlmGeneration` (no slot steal); `MAX_NEXT_RUN=8` in `run-queues.ts`.

**r1 B1/B2:** heal-before-user (`adapter.ts:337`); `thread.select` is getMessages-only (`message-router.ts:1800-1810`), heal call sites only adapter:337/858.

**Folded nits confirmed at call sites:** N1 → finally dropSteer; N2 → lease+conductor gates on `chat.steer`; N3 → `chat.user` echo after persist; N4 → `MAX_STEER=8` + `steer_queue_full`; N5 → `trimMessagesTurnSafe` never returns empty for non-empty tape; N6 → `isTruncatedToolBatch` test, abort-keeps-nextRun test, steer lease test; N8 → overflow regex includes `context window`.

**Post-r2:** `chatCreate` finally `if (!signal?.aborted) dropSteer(threadId)` so superseded predecessor cannot wipe successor steers; `runContextBudgetPass("pre_loop")` is inside that try.

**Residuals (real, documented, non-blocking):** N7 (validate vs handler empty_steer string — folded after this Pi pass in validate.ts), N9 (length retry compact may not enlarge output budget), R2-N2 (over-cap vs empty tape), R2-N3 (`isLengthStop` finish_reason-only), R2-N4 (no adapter-loop test).

No fake fold, no new BLOCK, no Trust/Channel escalation.

VERDICT: APPROVE_WITH_NITS
