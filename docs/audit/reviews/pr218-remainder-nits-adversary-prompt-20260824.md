# Independent adversary — PR #218 remainder + nits

You are an **independent adversarial reviewer**, not the implementer.
Repo: `/Users/huchen/Projects/cmspark`
Branch: `feat/agent-loop-durability-p0`
Diff: `docs/audit/reviews/pr218-remainder-nits-diff-20260824.patch`
Also READ live files (diff can lag). Do not edit production code.

## Blast / ADR-020

**Blast tier: T2** (chat.steer / enqueue nextRun / overflow retry / cap-trim).
Not T3 unless you find confirm/originWs/shell/god-mode/outbound live-bridge change.

Capability (claimed):
- Surface: `chat.steer`, `chat.create enqueue:true` → `chat.enqueued` / `queue_full` / `empty_enqueue`
- Compose: process-local steer + nextRun maps (lost on process death)
- Autonomy: overflow/length compact+retry-once then stop
- Trust: unchanged; pending_tools DTO names/ids only — never args/originWs/nonce
- Channel: WS companion; summoner ACL now includes `chat.steer`

CMspark is a **browser agent**, not a coding CLI. Do **not** REJECT for missing pi lanes/op-log/drive:manual/Continue UI/pending_confirms/CDP replay.

## Prior REJECT that must stay gone

1. `takeNextRun` only if `llmLoopGeneration.get(thread) === myGeneration` (supersede must not steal queue)
2. Truncated tool batch (`finish_reason` length + tool_calls): retry compact once, second time `chat.error` and **return** — must **not** save/execute truncated tools
3. Context overflow after retry: `chat.error` and **return** — must **not** inject fake `Error occurred:` user row
4. Empty enqueue rejected; nextRun capped (`MAX_NEXT_RUN=8`) with `queue_full` (not silent `chat.enqueued`)

## Nits claimed folded this pass

- steer trim / `empty_steer`; enqueueSteer ignores whitespace
- summoner ACL allows `chat.steer`
- `listPendingToolsForThread` DTO no originWs/tabId; static import (no `require("./ws/tool-forward")`)
- overflow classifiers: `input is too long`, `request_too_large`, `token count exceeds`
- `trimMessagesTurnSafe` skips orphan tool rows at the cut
- overflow/length retry does `round--` so retry does not burn a tool-round
- persistInterruptedRemainder DRY via persistHealedToolRows + onPersisted

## External DoD (observable)

- [ ] Overflow: compact+retry-once then stop with chat.error
- [ ] Length-stop incomplete tools: no execute
- [ ] Steer dies on abort (`dropSteer`); nextRun survives abort
- [ ] nextRun drain generation-CAS
- [ ] queue_full / empty_enqueue / empty_steer
- [ ] pending_tools names/ids only
- [ ] select does not heal (B2 still holds)
- [ ] INTERRUPTED splice after assistant (B1 still holds)

## Review layers

1. **Outcome** — DoD true at production call sites, not just helpers
2. **Trajectory** — scope = remainder + nits; no Continue UI / persist running=true
3. **Component** — file:line for every finding

READ at least:
- companion/src/llm/adapter.ts (steer inject, truncatedToolBatch, overflow catch, persistInterruptedRemainder)
- companion/src/message-router.ts (enqueue, drain CAS, chat.steer, pending_tools, abort dropSteer)
- companion/src/llm/run-queues.ts
- companion/src/llm/overflow.ts
- companion/src/threads/thread-manager.ts trimMessagesTurnSafe
- companion/src/ws/tool-forward.ts listPendingToolsForThread
- companion/src/ws/validate.ts
- companion/src/ws/summoner-acl.ts
- companion/src/llm/tool-batch-heal.ts persistHealedToolRows

You MAY run:
```
cd companion && npx tsc --noEmit
node --test .test-dist/tests/run-queues.test.js .test-dist/tests/overflow.test.js
```
Do not treat green tests as sufficient without call-site reads.

Write the report to:
`docs/audit/reviews/pr218-remainder-nits-adversary-20260824.md`

End with exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
