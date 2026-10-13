# #612 — independent adversarial review

Date: 2026-10-13 (Asia/Shanghai).
Base: `c570cb80c5799057e067ae0b55e6a3e4548288c3`.
Reviewed complete 10-file staged source/test/spec diff SHA-256: `42b299db052ae1091bd081bd4f647a2208777d9c9e51d32531847ef91e0351db`.
Supplied artifact: `/tmp/cmspark-612-full.diff`; the actual Git staged diff excluding audit reports independently hashes to the same value. Role: independent nonimplementer. Only this report was written; no product, dependency, Git or production configuration changes were made.

## Decision

APPROVE the source review stage for this exact frozen patch. The previously reproduced P2 is resolved, and no evidenced P0/P1/P2 blocker or useful nit remains in the complete reviewed batch. Fresh machine evidence and independent isolated checks pass. This is not merge authorization: fresh Pi/Kimi review and all required CI remain separate gates.

The earlier source `f51286d8…` was rejected despite its green existing tests. Its complete rejected review is preserved in `2026-10-13-cooperation-612-adversary-rejected.md`; that review and older source approvals do not release this new patch.

## Prior P2: reproduced and resolved

The rejected patch added latest-worker eligibility to historical positive-decision reuse at `companion/src/orchestrator/cooperation-plan.ts:148`. In a real-dispatch two-criterion task, attempt 1 established `coverage` but not `accuracy`. Its replacement correctly received only accuracy in its brief, yet spawning that replacement invalidated coverage; reviewing accuracy successfully still left the task unaccepted and its dependent blocked. This violated existing criterion reuse, not merely a preferred workflow.

The final correction removes only that latest-worker predicate from `validDecision`. Live ownership, worker run, owner's current run, source version/message/execution, settlement, activity and pause checks remain (`cooperation-plan.ts:140–149`). New review still uses the latest task attempt and `isCurrentPlannedWorker` (`:265–273`); collection/checkpoint latest-attempt protections remain. An unchanged earlier report can support its already accepted criterion without authorizing a new review of an obsolete attempt.

The permanent new real-dispatch regression checks the persisted replacement brief and checkpoint contain only accuracy, the second review accepts accuracy alone, coverage keeps its original source version, and the dependent actually spawns with fresh confirmation. I independently reran that regression and a separate production-dispatch probe in temporary data. Observed outcome:

```json
{"historicalSourceReuse":true,"replacementMissing":["accuracy"],"oldReviewRefused":true,"dependentSpawn":true,"ownerMigrationRefused":true,"runMigrationRefused":true,"unsettledRefused":true,"newSourceRefused":true}
```

The historical-source negative checks were isolated from each other: restoring owner/run/settlement restored acceptance before the next change. A newer uncollected assistant report also invalidated coverage. Worker kick was mocked; no real worker/browser was launched by these probes, and temporary data was removed. The prior P2 is closed, not waived or deferred.

## Outcome, trajectory and component review

**Outcome.** Three distinct failed terminal reports can receive recorded negative reviews without those legitimate review calls becoming parent same-tool failures. Both current runtime and collected result must be failed, and every submitted criterion must be negative (`cooperation-plan.ts:268`). Negative decisions cannot satisfy acceptance, so workers remain failed/unaccepted and dependencies remain blocked. Failed positive/mixed review, launch-error-with-ready-result, uncollected/stale/unsettled, running, paused, cancelled and security-blocked cases retain refusal. New review retains source/attempt/owner/run/reference checks before writing. Historical accepted criteria now remain reusable only while their own sources remain valid.

**Trajectory.** Issue #612 and its spec follow the merged Office prerequisite; no #613 UI or #618 work enters these ten files. Earlier foreign-owner and criterion-reuse counterexamples caused new source freezes and fresh checks. Archived historical worker scripts and raw completion metadata remain unavailable. A separately reproduced legal-null/undefined false-failure defect does not prove that every historical worker failure had that cause.

**Architecture and budget correctness.** `clampPlannedRecovery` is an observation/projection helper, with no spawning or permission effects. It takes the minimum of existing worker recovery budget and immutable plan creation remainder. Only an exhausted `retry_after_confirmation` suggestion becomes `revise_plan`. Idempotent cache recollection repairs legacy metadata; checkpoint comparison includes recovery and preserves unchanged decisions; nested plan results and unified snapshots clamp too. Reload regressions exercise the persisted cache/checkpoint repair. Existing failure-version accounting, ACP/unplanned behavior and paused/blocked/cancelled/recollect actions remain. No budget grows, no replacement occurs automatically, and the existing three-creation limit is not converted into a total execution limit on explicit user continuation of the same worker.

**Browser producer and trust boundary.** The extension derives completion from the host RemoteObject or successful scripting result, not request flags or nested page return values. Null requires an object/null RemoteObject with an actual null value and no contradictory remote-object fields, then receives host `null_completion`. Undefined requires its typed shape plus a healthy typed-boolean probe. The probe evaluates `1+1===2`; it does not replay the original expression. Missing/malformed originals fail before probing; page exceptions retain `EVAL_THROWN` and dead/malformed probes retain `EVAL_DEAD_WORLD`. Companion recognition requires the matching host type/marker after JSON, including omission of undefined values. Older unconfirmed null replies remain failures, as documented; updating the extension is required for new null behavior. Execution completion remains distinct from goal fulfillment. Non-JSON numeric representation is not claimed repaired by this batch.

**Security and correctness.** Live source migration invalidates prior acceptance through explicit owner/run checks. Source message/execution/version freshness and settlement remain authoritative, while obsolete attempts cannot submit new reviews. Removed-source bounded-checkpoint behavior is explicit and tested without promising raw history. Existing authenticated result correlation, token-bound evaluate code, worker tool restrictions, tab queues/leases, spawn confirmation and generic/site failure thresholds remain unchanged. Request/page markers cannot promote a malformed original response into completion.

**Tests and operations.** Permanent tests use genuine dispatch/result/token/version producers and the actual BrowserBridge bundle across JSON transport. Browser APIs in that corpus are stubs, not real Chrome execution. The machine card separately records isolated actual Chrome/CDP trials and fresh dispatch trials. Its earlier noncanonical test invocation and inability to rule out orphan default-store records are disclosed, not counted as clean acceptance evidence. My runs use the canonical isolation runner or explicitly temporary data before importing production modules. No business page, user PDF, private archive or default user store was read by this reviewer.

**UX.** No new UI or parent-navigation behavior appears here. Failed-review tool success means a negative judgment was recorded, not that the worker succeeded. Recovery metadata no longer overstates planned creation budget. After the correction, replacement instructions, remaining-condition status and eventual acceptance agree. #613 remains separate.

## ADR-020 capability axes

| Axis | Assessment |
|---|---|
| Surface | Existing cooperation tools and browser evaluate result handling only. |
| L2 classes | No new tools, approval bypass or token changes; spawn confirmation remains. |
| Compose | Existing producer → JSON/result/cache/plan → review or recovery advice. |
| Autonomy | Negative judgment recording only; no automatic replacement or broader retry policy. |
| Trust | Host completion metadata and live source identity remain checked; failed results cannot become accepted. Valid historical criteria are reused without permitting old-attempt new review. |
| Channel | Existing authenticated Companion/extension bridge and result envelope; no new channel. |

T3 blast declaration is appropriate for changing execution evidence and cooperative acceptance semantics. No grant, live configuration, threshold or total-execution-cap expansion appears in the complete diff.

## Independent checks and machine evidence

- Node 22.23.2, canonical `node scripts/run-tests.mjs` over `cooperation-plan`, `cooperation-races`, `cooperation-mcp`, `cooperation-state`, `cooperation-result`, `site-op-memory`, `same-tool-guard` and `browser-evaluate-completion`: **96 passed, zero failed/skipped**, exit 0. The runner preloads isolated data-directory handling and cleans its temporary root.
- Additional production-dispatch partial-criteria and historical-source probes: valid reuse/dependent spawn passed; old-attempt new review, owner migration, run migration, unsettled execution and newer uncollected source were refused/invalidated as described above. Temporary data only; launch mocked; cleanup completed.
- Read fresh final machine card: Companion **5882 total / 5830 passed / zero failed / 52 existing skips**, extension **1513 passed**, Linux ARM64 **96 passed**, builds and three fresh dispatch trials passing. Unchanged browser source retains its isolated actual-Chrome checks. These are separate worker evidence, not tests claimed repeated here.
- The complete supplied diff was reread; the actual staged hash and `git diff --cached --check` were rechecked before this verdict. Hash is exactly `42b299db…`, check exit 0. Earlier `f51286d8…` green checks do not substitute for the corrected patch's fresh checks.

All ten source/test/spec files were inspected: both extension source/test files; cooperation plan/state and site memory source; tool catalog description; all three companion changed/new test files, including the new real-dispatch replacement regression; and the issue-linked spec. Relevant unchanged dispatch, result producers, failure guard, current-attempt/source rules, isolation runner and prior recovery contract were inspected. Only this report was mutated by the reviewer.

VERDICT: APPROVE
