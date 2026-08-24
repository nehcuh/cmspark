# Pi re-review — PR #218 remainder + nits

You are Pi. Confirm or reject the independent adversary. READ the code, not just summaries.

Repo: /Users/huchen/Projects/cmspark
Branch: feat/agent-loop-durability-p0
Working tree vs HEAD `4fd671d` plus untracked overflow.ts / run-queues.ts.

**Machine** (this session, companion/):
- `npx tsc --noEmit` exit 0
- `npx tsc -p tsconfig.test.json` exit 0
- Targeted `node --test` related suite **216 pass / 0 fail**
  (run-queues, overflow, threads-history, summoner-acl, ws-tool-forward, single/files, ws-router-validator-lockstep, tool-batch-heal, context-budget, m10-abort-orphans, composer-lease)

**Adversary reports (read full files):**
- `docs/audit/reviews/pr218-remainder-nits-adversary-20260824.md` — VERDICT: APPROVE_WITH_NITS
- `docs/audit/reviews/pr218-remainder-nits-r2-adversary-20260824.md` — VERDICT: APPROVE_WITH_NITS

**Task:** Confirm or reject the adversary. If they missed a production BLOCK → REJECT. If leftover nits are real but non-blocking → APPROVE_WITH_NITS. If nits are gone / only documented residuals (N7 validate string, N9 length retry may not help, R2-N2 over-cap, R2-N3 finish_reason-only, R2-N4 no adapter-loop test) → APPROVE or APPROVE_WITH_NITS.

CMspark is a browser agent. Do not REJECT for missing pi lanes/op-log/Continue UI.

After r2, implementer also: `chatCreate` finally `dropSteer` only if `!signal?.aborted` so a superseded predecessor cannot wipe successor steers; `runContextBudgetPass("pre_loop")` is inside that try.

READ at least:
- companion/src/llm/adapter.ts (truncatedToolBatch, overflow return, dropSteer finally, steer echo)
- companion/src/message-router.ts (enqueue queue_full, nextRun generation CAS, chat.steer gates)
- companion/src/llm/run-queues.ts
- companion/src/threads/thread-manager.ts trimMessagesTurnSafe

End with exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
