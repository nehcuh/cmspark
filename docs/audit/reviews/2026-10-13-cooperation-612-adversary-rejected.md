# #612 — independent adversarial review

Date: 2026-10-13 (Asia/Shanghai).
Base: `c570cb80c5799057e067ae0b55e6a3e4548288c3`.
Reviewed complete 10-file staged source/test/spec diff SHA-256: `f51286d8e91b8e1d79bf9652c322cb2f6c88cf546aa499423d41a98d6b429f73`.
Supplied artifact: `/tmp/cmspark-612-full.diff`; actual Git staged diff excluding audit reports independently hashes to the same value. Role: independent nonimplementer. Only this report was written; no product, dependency, Git or production configuration changes were made.

## Decision

REJECT this frozen patch for one independently reproduced P2 regression: replacement invalidates already accepted criteria from an unchanged, owned, settled earlier source. The existing recovery contract and replacement brief reuse those criteria. Full machine checks and the existing focused corpus pass, but do not cover this case. No other evidenced blocker was found in the inspected batch. A correction, regression and fresh full-patch machine/reviewer gates are required; this is not a conditional approval.

## Blocking finding

**P2 — Keep source freshness separate from latest-worker eligibility when reusing accepted criteria.** `companion/src/orchestrator/cooperation-plan.ts:148` adds `!isCurrentPlannedWorker(tm, worker.id)` to `validDecision`. That helper requires the worker to be the task's latest created attempt. An accepted criterion backed by a still-current earlier report therefore becomes invalid merely because a replacement was created, even though ownership, run, source version, settlement and report content remain unchanged.

This contradicts both the retained implementation and the existing contract: `reviewCooperationTask` preserves decisions for criteria not present in the new review (`cooperation-plan.ts:280`); planned dispatch gives the replacement only `remaining_criteria` (`companion/src/tool/companion-dispatch.ts:372`); `docs/audit/reviews/2026-10-11-cooperation-validation.md:9` explicitly describes preserving accepted criteria while providing missing criteria to the replacement.

Independent real-dispatch reproduction at this exact freeze, with a temporary data directory and a mock kick channel:

1. Create a task with `coverage` and `accuracy`, plus a dependent task. Spawn attempt 1 with a genuine confirmation token, produce a normal report, collect it through `collect_handback`, and review `coverage=true`, `accuracy=false` using the produced source reference. Its missing list is correctly `[accuracy]`.
2. Spawn attempt 2 with fresh confirmation. Its persisted brief correctly contains only `remaining_criteria:[accuracy]`, but its checkpoint and status now report `[coverage,accuracy]` as missing.
3. Produce and collect attempt 2's normal report, then review `accuracy=true`. The review tool succeeds, but the task remains `accepted=false`, `missing=[coverage]`, and the dependent remains `ready=false`.

Observed compact output:

```json
{"beforeMissing":["accuracy"],"replacementCheckpointMissing":["coverage","accuracy"],"duringMissing":["coverage","accuracy"],"afterReviewSuccess":true,"afterAccepted":false,"afterMissing":["coverage"],"dependentReady":false,"noRealWorkersStarted":true}
```

The new worker is asked to repair only the remaining condition and cannot satisfy the advertised recovery contract by doing so. This can waste the finite creation budget and leave valid work blocked. Remove latest-worker eligibility only from historical decision reuse; retain the new live owner/run checks, source version/message/execution freshness, settlement, active/paused checks, and the current-attempt guard for new reviews and collection. Add a real-dispatch two-criterion replacement regression that completes only the missing criterion, reuses the unchanged accepted criterion, and releases the dependent. Changed/migrated/unsettled earlier sources must still invalidate their criteria.

## Outcome, trajectory and component review

**Outcome.** The intended failed-negative path is narrow: both runtime and collected result must be `failed`, and every submitted judgment must be negative (`cooperation-plan.ts:268`). The existing validation still precedes writes. Negative decisions never satisfy `validDecision`, so failed workers remain failed/unaccepted and dependencies remain blocked. Positive/mixed failed review, running/unsettled, paused, cancelled, security-blocked, uncollected and launch-error-with-ready-result cases retain refusal. The confirmed failure-review contradiction is addressed; the historical accepted-criterion regression above prevents accepting the batch as a whole.

**Trajectory.** Issue #612 and its frozen spec follow the merged Office prerequisite. No #613 UI changes or #618 work enter this patch. Archived worker scripts and raw completion metadata are unavailable. The general legal-null/undefined false-failure defect has separate producer evidence; neither this review nor the spec treats it as a proven cause of every historical worker failure. The machine card records an earlier foreign-owner counterexample and superseded source identity; the current live-source guards are inspected rather than relying on that earlier approval.

**Components and architecture.** The shared recovery clamp is an observation/projection function, with no spawning or permission effects. It takes the minimum of existing worker budget and immutable plan creation remainder, and changes only an exhausted retry suggestion to `revise_plan`. Cache idempotence repairs old metadata; checkpoint idempotence now compares recovery and preserves unchanged judgments; nested attempt results and unified snapshots also clamp. ACP/unplanned paths are left alone. Pause/resume, blocked, cancelled and recollect actions retain their meaning. Existing worker creation caps, fresh-confirmation binding and explicit user continuation of the same worker are unchanged. The intended cache/checkpoint projection gap is covered without increasing budget.

**Browser boundary.** The extension derives typed completion from the host RemoteObject or successful scripting result, never request fields or nested page return values. Null requires `type=object`, `subtype=null`, an actual null value and no contradictory remote-object fields; it receives the new host `null_completion` marker. Undefined requires its typed shape and a healthy typed-boolean probe; the probe runs `1+1===2`, not the original expression. Malformed originals fail before probing. Exceptions retain `EVAL_THROWN`; an unsuccessful/malformed probe retains `EVAL_DEAD_WORLD`. Companion recognition requires the host marker/type pair after JSON, including omission of undefined values. Older unconfirmed null replies fail conservatively, as documented. This is execution completion, not acceptance of the user's goal. Non-JSON numeric representation is not claimed fixed by this batch.

**Security and correctness.** New live owner/run checks protect failed review and invalidate already accepted decisions when a still-present source migrates. New reviews retain exact source, latest-attempt, settlement and reference checks. Removed-source bounded-checkpoint behavior remains explicit and tested. Existing authenticated result correlation, token-bound evaluate code, tab queues/leases, worker restrictions and generic/site failure thresholds are unchanged. The blocker comes from imposing latest-attempt eligibility on historical criterion reuse, not from the required owner/run checks.

**Tests and operations.** Tests exercise real dispatch/result/token/version producers and the actual BrowserBridge bundle after JSON transport; the browser APIs in the permanent cross-boundary corpus are stubs, not real Chrome execution. The machine card separately supplies three isolated real-Chrome trials and three fresh dispatch trials. No business page, user PDF, private archive or default user store was read by this reviewer. The implementer's earlier noncanonical test invocation and inability to rule out orphan default-store records are disclosed in the card; they are not represented as clean acceptance evidence or as a product defect. Independent checks below use the repository isolation runner or an explicitly temporary data directory.

**UX.** There is no new UI or parent-navigation behavior here. Recovery advice becomes bounded and failed-review success means the negative judgment was recorded, not that the worker succeeded. The criterion regression creates an observable contradiction between replacement instructions and the remaining-condition status; it must be corrected before #613 presentation work relies on this state.

## ADR-020 capability axes

| Axis | Assessment |
|---|---|
| Surface | Existing cooperation tools and browser evaluate result handling only. |
| L2 classes | No new tools, approval bypass or token changes; spawn confirmation remains. |
| Compose | Existing producer → JSON/result/cache/plan → review or recovery advice. |
| Autonomy | Negative judgment recording only; no automatic replacement or broader retry policy. |
| Trust | Host completion metadata and live source identity are checked; failed results cannot become accepted. Historical accepted-criterion reuse has the P2 regression above. |
| Channel | Existing authenticated Companion/extension bridge and tool-result envelope; no new channel. |

T3 blast declaration is appropriate for changing execution evidence and cooperative acceptance semantics. No grant, live configuration, threshold or total-execution-cap expansion appears in the complete diff.

## Independent checks and evidence limits

- Node 22.23.2: canonical `node scripts/run-tests.mjs` over `cooperation-plan`, `cooperation-races`, `cooperation-mcp`, `cooperation-state`, `cooperation-result`, `site-op-memory`, `same-tool-guard` and `browser-evaluate-completion`: **95 passed, zero failed/skipped**, exit 0. The runner preloads isolated data-directory handling and removes its temporary root.
- Additional production-dispatch partial-criteria probe above: reproduced the regression, exit 0. Genuine plan/spawn/token/collect/review producers were used; worker launch was mocked and all temporary data was removed. No default user data was used.
- Actual staged diff hash and `git diff --cached --check` were rechecked before writing this report; hash remains `f51286d8…`, check exit 0.
- Read prior machine evidence: Companion 5881 total / 5829 passed / zero failed / 52 existing skips; extension 1513 passed; ARM64 Linux 95 passed; builds and isolated actual-Chrome/dispatch trials passed. These are separate worker evidence, not checks claimed repeated here. They do not override the new reproducible missing case.

All ten files were read: both changed extension source/test files; cooperation plan/state and site memory source; tool catalog description; all three companion changed/new test files; and the issue-linked spec. Relevant unchanged dispatch, result producers, source/attempt rules, failure guard, isolation runner and earlier recovery contract were inspected. No additional blocker or useful nit is asserted without evidence.

VERDICT: REJECT
