# #612 Pi second confirmation

Pi0.85.1 / deepseek/deepseek-v4-flash; exact source42b299db052ae1091bd081bd4f647a2208777d9c9e51d32531847ef91e0351db; complete fresh adversary report+machinecard+same full source/test/spec diff. Read-only, exit0.

Pi0.85.1 deepseek/deepseek-v4-flash; source42b299db
Second-confirmation review complete. Read-only; no source/test/git/config mutations. I re-derived the frozen identity and independently re-ran the canonical suites.

## Identity / frozen patch
- HEAD = `c570cb80c5799057e067ae0b55e6a3e4548288c3` (base matches).
- `git diff --cached --binary | shasum -a 256` = `42b299db052ae1091bd081bd4f647a2208777d9c9e51d32531847ef91e0351db`; staged diff is byte-identical to `/tmp/cmspark-612-full.diff` (`diff` exit 0); `git diff --cached --check` exit 0. Only the 10 named files are staged; hash unchanged after all my checks.

## Adversary finding (prior P2) is genuinely fixed
- `companion/src/orchestrator/cooperation-plan.ts:140-149`: `validDecision` now checks `worker.parent_thread_id === result.owner_thread_id`, `worker.orchestrator_run_id === result.run_id`, owner's `orchestrator_run_id === result.run_id`, then `!isActive && !paused && sourceIsCurrent`. The rejected `!isCurrentPlannedWorker(...)` latest-worker predicate is gone.
- New reviews still require the current attempt: `isCurrentPlannedWorker` and parent/run checks remain (`:264-274`); `failedRejection` requires `state==="failed" && result.status==="failed" && criteria.every(!passed)`.
- Regression test present and passing: `companion/tests/cooperation-plan.test.ts` "replacement completes only the missing criterion and reuses an unchanged owned earlier source" (compiled `ok 22`).

## Independent checks
- Canonical `node scripts/run-tests.mjs` over the 8 relevant compiled suites: **96 passed / 0 failed / 0 skipped** (matches the card and report). All new tests present: 3 browser-evaluate-completion, three-failed-negative, positive/mixed/stale/unsettled/halted/paused, launch-error-ready, cache/checkpoint/nested/status/reload clamp, exhausted-retry→`revise_plan`, owner/run invalidation, removed-source checkpoint.
- Extension `npm test`: **1513 passed / 0 failed**, independently re-run.
- Machine logs corroborate: companion `4333+1529+20 = 5882` total, `4285+1525+20 = 5830` pass, `48+4 = 52` skips; ARM64 log `96`; three real-Chrome logs show genuine null/undefined success with third-operation ban still firing on failures; dispatch log shows failed negative reviews recorded with `parentReviewFailures=0`.

## Budget / browser / security DoD
- `clampPlannedRecovery` (`cooperation-plan.ts:118-130`) is observation-only `min(result.recovery.budget_remaining, max(0, 3 - attempts))`, converts only exhausted `retry_after_confirmation`→`revise_plan`, and is applied at cache early-return (`cooperation-state.ts:18-25`), checkpoint idempotence with decision preservation (`:252-259`), and snapshot projections (`:301-305`, `cooperation-state.ts:68-71`); ACP/unplanned untouched (tested).
- `chrome-extension/src/background/browser-bridge.ts:1883-1906`: typed `nullCompletion`/`undefinedCompletion` derived only from host RemoteObject/scripting envelope; probe is literal `1+1===2` (original never re-run); malformed/exception/dead-world refused.
- `companion/src/tool/site-op-memory.ts:327-349`: marker/type pair required across JSON; nested page/request flags never promoted; failure accounting and existing bans unchanged.

## Report quality
The report states the harness limits (browser API stubs vs. separate real-Chrome trial logs) and that archived worker scripts/raw metadata are unavailable, and it explicitly does not count the earlier noncanonical invocation or orphan-record uncertainty as acceptance evidence. Its APPROVE is scoped to the review stage, not merge. No evidenced P0/P1/P2 and no useful code nit found in the frozen batch.

VERDICT: APPROVE
