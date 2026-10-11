# #590 Cooperation reliability — independent adversarial review

Date: 2026-10-11. Baseline: `9429ec61`. Reviewer: independent runtime/correctness lane; did not implement product code. The reviewer authored focused fault/race regressions after finding defects, then inspected the implementation fixes and machine results.

**VERDICT: APPROVE** for this independent code/adversarial gate. No unresolved blocking finding remains in the reviewed cooperation scope. This is not a claim that the separate full Companion test run, Kimi/Pi review, CI or merge gate has already completed.

## Scope and reviewed identity

Reviewed the actual working diff, new cooperation-plan implementation, catalog/security/dispatcher integration, Board collection, source/execution fences, supervision, regression fixtures, #590 spec and measurement scripts. Initial full-diff artifact: `/tmp/cmspark-590-review-final.patch`, SHA-256 `14310f13ef238387c0c0a56016417175c7ac402e22418c31aae431d41099317d`.

Two execution-fence consumer omissions were found during this final review and corrected after that initial artifact. Final reviewed critical-file SHA-256 values:

| File | SHA-256 |
|---|---|
| `companion/src/orchestrator/cooperation-plan.ts` | `864f18ecad27cf9cb6dcc54c77dc58c5ba41be05936e4f3fb80c8ffc02c58351` |
| `companion/src/orchestrator/cooperation-state.ts` | `0aa9e2d6749fea8f105096d423215ffd7afdff10c64143161cfaa8bd13acc57b` |
| `companion/src/orchestrator/fleet-supervision.ts` | `c6d78d5e600b53c234cf9bb619e33eeab92d051f5132b824cd0f49c95ba8a22b` |
| `companion/src/tool/companion-dispatch.ts` | `e2a17b05d93ebc9828e913cfa8257ab6164a4ff689c997f5e6dcb6499f8c9268` |
| `companion/tests/cooperation-races.test.ts` | `98873939f13db229efa47e1507c172adf06d71d36467a011774a37909ce71ab5` |

## Findings closed by evidence

| Finding | Concrete failure before repair | Repair and verification |
|---|---|---|
| P2: stale acceptance released dependencies | A previously accepted worker started a new run or produced a new report; without recollection the dependent task was still dispatchable | Valid decisions now require inactive settled execution and current terminal/message/execution identity. A same-terminal-timestamp new message blocks reuse and replacement until collection; real dispatcher regression passes |
| P2: split persistence left an unrecoverable checkpoint gap | Result cache persisted, then plan write failed; identical recollection returned early forever without the missing attempt result | Dedup path also repairs plan checkpoint. Regression injects failure into the actual second write, reloads ThreadManager from disk, recollects the identical production result and successfully reviews it |
| P2: failed concurrent spawn undid successful sibling promotion | A created/promoted first, waited for an Intent lock; B bound first; A lost binding and restored normal role/run=null over B | Rollback leaves promotion while another worker exists. Regression forces this exact Board-lock interleaving and verifies one surviving worker, parent/run consistency and successful result collection/review |
| P2: losing spawn retained a dangling Intent claim | In that same interleaving, A successfully claimed the Intent before losing bind, then was deleted while the claim remained | `releaseUnstartedClaim` releases only the matching still-claimed worker/Intent and returns it to open. The independently added assertion originally failed and now passes |
| P2: unified status missed crashed rerun | New unsettled execution preserved old terminal timestamp, so the plan said interrupted while `cooperation.tasks` still said completed | Unified snapshot now compares result execution ID and settled ID. Final regression verifies stale unified result after disk reload |
| P2: supervisor suppressed crashed rerun disclosure | Old completed worker epoch had already been delivered; rerun crash preserved its old terminal fields, so supervision skipped it | `fleetWorkerEpoch` includes execution/settled IDs, with stable in-flight comparison. Regression verifies interrupted is disclosed once and the unchanged interrupted execution does not trigger a supervision loop |

Initial stale-acceptance and cache-gap reproductions used real compiled modules under a temporary data root (`/tmp/cmspark-plan-preprobe.cjs`). The report is not treating those old failures as current failures: final assertions cover their corrected production paths.

Additional contract checks now pass: expected attempt participates in the approval fingerprint and final bind; tampering an old approval to the next attempt is rejected; unknown required tool names cannot populate a plan; replacement brief derives missing criteria using current acceptance validity rather than raw past passed flags. The real adapter crash test verifies execution identity is committed before provider await and a later process cannot reuse old completion after SIGKILL.

## T3 capability and trust assessment

- **Surface:** three parent cooperation tools plus existing spawn, collect, Board read and wait status. No new worker control surface; cooperation tools are in WORKER_HARD_DENY.
- **L2:** plan metadata does not authorize execution. Initial dispatch and replacement keep existing confirmed spawn. Planned confirmation binds owner, immutable plan/task, expected attempt and complete goal/role prompt; confirmation preview includes plan/task/attempt. A fresh token alone cannot bypass the synchronous current-attempt/dependency/capability check.
- **Compose:** dependency acceptance → confirmed spawn → persisted attempt → existing worker kick → guarded result collection → explicit criterion review. Board checks obsolete attempts before merge and again inside its mutation path.
- **Autonomy:** ready order is advisory, bounded by current capacity and existing creation limits. No automatic worker launch, generic side-effect replay or distributed coordinator recovery is claimed.
- **Trust:** acceptance explicitly identifies orchestrator review and `semantic_truth_verified:false`. Existing-source references establish provenance/coverage contracts, not semantic truth. Metadata mutation tools remain prohibited in plan_readonly; ACP ownership checks preserve separate conversation boundaries.
- **Channel:** browser tasks execute the persistent plan. ACP retains its own lifecycle and confirmation and shares the result/status view; this is not a general browser/ACP interchangeable executor scheduler.

Refuted escalation: the earlier default-thread token reproduction was not proof of arbitrary L2 bypass, because production strips caller tokens and obtains real confirmation. That claim was not promoted into this verdict. The reachable ACP cross-owner read/cancel issue has an actual owner guard and independent dispatcher regression evidence.

## Outcome / trajectory / component

**Outcome.** The scoped #590 behaviors are externally observable through real dispatch results: immutable plans, criteria-based dependency release, monotonic finite attempts, accepted-sibling retention, stale-result rejection, crash disclosure and explicit confirmed recovery. Runtime completed remains distinct from acceptance. Source availability is separately exposed, so durable metadata is not advertised as durable ACP process handles or all original tool bodies.

**Trajectory.** The implementation extends the existing runtime rather than introducing a second execution channel. No default outbound-profile expansion, P2P/WoT, worker recursive dispatch or automatic write retry appears in this scope. Defects found in pre-review were repaired and converted into production-boundary regressions; repeated test executions are not added into an inflated unique-test count. Broader salvaged ACP/UX fixes remain separate from claims about new collaboration quality.

**Component.** The most fragile boundaries—result-cache versus plan commit, speculative spawn versus parent promotion, Intent claims versus deletion, source version versus execution identity, and supervision dedup versus crash recovery—now have concrete tests. TypeScript compilation and narrow deterministic tests supplement the source review; they do not prove semantic reasoning quality or all native platform behaviors.

## Machine evidence inspected

| Evidence | Observed result and scope |
|---|---|
| `cmspark-cleanup-backup-20261011/container/tests-final.log` | Latest Linux arm64 run, fresh dependency image, 118/118 pass. Includes all five independent race regressions, final snapshot/supervision consumer corrections and the real adapter crash fence |
| `/tmp/cmspark-execution-fence.log` | 69 pass, 1 skip, 0 fail. Includes real chatCreate/provider-await subprocess kill/reload fence test |
| `/tmp/cmspark-final-fence-targeted.log` | Final targeted host run, 29 pass, 0 fail |
| `/tmp/cmspark-cooperation-races-final.log` | Reviewer ran after final consumer corrections: test compilation passed, 5/5 independent race regressions passed, including one-time interrupted supervision disclosure |
| `/tmp/cmspark-full-extension.log` | Full extension suite 1509/1509 pass |
| `/tmp/cmspark-extension-build.log` | TypeScript and Plasmo production extension build passed |
| Full Companion suite | First run exposed an old 4000-character catalog regex limit after new fields extended the schema. The actual required goal contract remained present; structural JSON assertion is the appropriate repair. The later run exposed the explicit error-code expectation table missing the four newly registered codes; that test repair and final full gate are tracked separately. This report does not call full Companion green |

The latest 118-test container result supersedes the earlier 100-test result and covers the final snapshot/supervision corrections. Kimi/Pi, the completed full Companion gate and CI remain independent gates outside this review's verdict.

## Measurement claims and retained limits

Inspected both synthetic fault-eval and actual configured-model comparison scripts/results. The real model smoke uses eight public synthetic facts, deterministic assignment/union and fixture approvals, with one sample per width. It observes 1/2/4-worker coverage/precision all 100%, with 919/965/1069 ms and 372/502/791 provider-reported tokens respectively. The simple task shows overhead rather than a demonstrated parallel benefit. It is not a benchmark of complex research, browser tool use, model-led decomposition or extra model synthesis; width 1 remains the same harness with one worker, not a separate production solo-chat trajectory.

The synthetic evaluator reports scheduling waves and payload bytes honestly as such, with zero model calls. It cannot establish factual quality, token cost or real latency. Real Windows ConPTY, MV3 reconnect and macOS dialog behavior remain native acceptance boundaries; no Linux or unit-test result here is evidence those interactions were exercised.

**Final independent code verdict: APPROVE.** No unresolved P1/P2 in this reviewed cooperation implementation; merge remains subject to the separately required aggregate tests and external review gates.
