# Pi re-review — post-#219 kimi nits fold (r2)

You are Pi. Confirm or reject the independent 4-lane adversary. READ live code and the adversary reports, not just this summary. Do not rubber-stamp.

Repo: C:\Users\HuChen\Projects\cmspark
Branch: main @ `c5b4242` plus **uncommitted** companion WIP (kimi nits + r1 folds).

**Blast**: T2. ADR-020: Surface L0, no new L2, Autonomy steer/nextRun, Trust unchanged, Channel composer lease (overlay never Allow/Deny).

**Machine** (implementer session, companion/):
- `npx tsc --noEmit -p tsconfig.json` exit 0
- `adapter-steer-overflow.test.ts` 13/13
- `message-router-nextrun-drain.test.ts` 11/11
- r2 lanes re-ran their suites green

**Adversary (read FULL files):**
- r1 synthesis: `docs/audit/reviews/post219-kimi-nits-adversary-synthesis-20260825.md` (A/C/D REJECT, B AWN)
- r2 synthesis: `docs/audit/reviews/post219-kimi-nits-r2-synthesis-20260825.md` (all APPROVE*)
- r2 lanes: `docs/audit/reviews/post219-kimi-nits-lane-a-r2-20260825.md` AWN
- `docs/audit/reviews/post219-kimi-nits-lane-b-r2-20260825.md` APPROVE
- `docs/audit/reviews/post219-kimi-nits-lane-c-r2-20260825.md` AWN
- `docs/audit/reviews/post219-kimi-nits-lane-d-r2-20260825.md` AWN

**Claimed folds you must spot-check at call sites:**
1. adapter leftover finally: takeSteer → enqueueNextRun; queue-full WARN, no dropSteer (`companion/src/llm/adapter.ts`)
2. replaceInterruptedFillerIfPresent scoped to assistant tool block (`companion/src/llm/tool-batch-heal.ts`); adapter passes savedAssistantId
3. adapter-steer-overflow mocks OpenAIProvider.prototype.streamChat
4. isDrainGateError: upload still returns file.uploaded; create returns null (`companion/src/message-router.ts`)
5. shouldReclaimLiveOverlayThread + bindSummonerThread (`companion/src/summoner/overlay-session.ts`, `menu-bar-agent.ts`)
6. plainErrorResult reconstruct; code-tool data always collapsed; Authorization/Bearer/apiKey (`companion/src/security/tool-persistence-redact.ts`)

**Task:** If adversary missed a production BLOCK → REJECT. If leftover nits are real but non-blocking (clientMessageId drop on leftover→nextRun, passwd key, M3 pack.apply tests out of slice, N1/N9) → APPROVE_WITH_NITS. If folds hold and nits are only documented residuals → APPROVE or APPROVE_WITH_NITS.

Do not REJECT for missing Continue UI / lanes / op-log / pack.apply router tests (explicitly out of slice).

You MAY re-run: `npx tsx --test tests/adapter-steer-overflow.test.ts tests/message-router-nextrun-drain.test.ts` from companion/.

End with exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
