# Dual review — CMspark thread-loss diagnosis (3qb5ea / w2k8z9)

You are an independent senior reviewer. **Do not rubber-stamp.** Read the synthesis, then verify cited code and (if tools allow) the live json/log. You are reviewing a **diagnosis + fix plan**, not a git diff. There is no implementation patch yet.

## Synthesis (required)

Read in full:

`/Users/huchen/Projects/cmspark/docs/audit/reviews/thread-loss-3qb5ea-adversary-synthesis-20260901.md`

Repo HEAD: `3cd70cf8` on `main`. Live data under `/Users/huchen/.cmspark-agent/` (threads + logs). Do not modify any files.

## Incident

CMspark Chrome plugin: thread `3qb5ea` showed tool-output truncation; after clicking another conversation and coming back, messages looked gone; extra conversation `w2k8z9` appeared.

## What to verify (must inspect, not trust prose)

1. `companion/src/llm/adapter.ts` truncatedToolBatch path: does it really `return` before `addMessage` / `llm.usage`? Exact error string?
2. `companion/src/llm/providers/anthropic-convert.ts` `computeMaxTokens` — is 8192 the production cap for this user's anthropic-compat glm path?
3. `chrome-extension/src/sidepanel/store/agentStore.tsx` `SET_ACTIVE_THREAD` — does it wipe `messages`?
4. `companion/src/threads/thread-manager.ts` `update()` — does digest-only update bump `updated_at`?
5. `chrome-extension/src/sidepanel/utils/thread-timeline.ts` sort key.
6. `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` — is `chat.done.truncated` ignored? Are `chat.error` rows client-only?
7. Live: `~/.cmspark-agent/threads/3qb5ea.json` last rows; `w2k8z9` created_at vs updated_at; `companion-2026-09-01.log` around 05:35 / 05:42 / 06:25.

## Verdict rules

- **APPROVE** — diagnosis causal chain is correct; P0 pins are necessary and sufficient; no missing BLOCK.
- **APPROVE_WITH_NITS** — chain holds; nits are missing tests, wording, extra P1/P2, instrumentation. List nits BEFORE the verdict line.
- **REJECT** — a cited root cause is false, a P0 pin is wrong/dangerous, or a ruled-out item is actually causal. List blocking issues with file:line BEFORE the verdict line.

Do not demand implementation in this review. Do not expand into unrelated refactors (#265 remount, compaction-as-delete, deleting w2k8z9).

End your entire answer with exactly one of:

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
