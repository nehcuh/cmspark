# Independent Cooperation component adversarial review r2

Date: 2026-10-14 Asia/Shanghai. Reviewer: Office implementation agent, **not** Cooperation implementer. Scope is exclusively Cooperation eight-file group (#576/#577/#619/#621), at base `6594c053e4485182fec100b178df40ff8bf16a95`. This review does not approve this reviewer's Office changes or the CI/availability groups. No source/test/SDK/config mutation, model call, worker dispatch, GitHub action or application deployment performed.

VERDICT: **APPROVE_WITH_NITS — Cooperation component only.** No confirmed blocking correctness/security regression in the reviewed diff. Linux ARM64, final external syntheses, per-head CI and merged-main CI are still separate gates; this is not merge authorization or a claim that all tickets are already closed.

## Scope and identity

Read the complete eight-file diff end-to-end, actual frozen eight files, actual model r1/r2/r3 JSON in full, original issue bodies from `/tmp/cmspark-open-issues-20261013.json`, and `/tmp/cmspark-576-577-acceptance.md`. Read unchanged production callers and contracts in fleet-supervision, cooperation-state/result, adapter preflight/finish interception, dispatcher suggestion/spawn/collect/review paths, actual TaskRelationshipNav/helper and StatusRail navigation callback. Structured correctness/security/tests/clarity checklist followed from builtin-code-review.

Complete diff `/tmp/cmspark-convergence-wave-20261014/review/cooperation.diff` SHA256 **11725378cee29dedf5c239ff015c327056df343f100ba5bdbc7c05c33372004f**, independently recalculated. All eight frozen source hashes independently verified against the manifest. Overall packet context-r2 names37 paths; this review approves only these eight. Whole-wave source-manifest hash supplied in machine card is `1c0c86b1cefdcdda8ee2b2ab668b1af96ee2455975e0b1b053290c0a2d029898`.

## Correctness and semantic evaluation

### #576 proposal eligibility repair is semantic, not keyword routing

`companion/src/orchestrator/fleet-assessment.ts:8` adds a general concept rule: an unnamed/ambiguous definite entity is absent input, entity-dependent goals must be omitted rather than guessed or scheduled to wait; independent industry goals remain eligible, fewer than two executable goals means solo. Open-ended comparisons may select subjects. There is no keyword classifier, new tool, threshold relaxation, token-budget increase or auto dispatch. The same FLEET_DISPATCH_HINT reaches actual assessor system request at `fleet-assessment.ts:68` and the parent's execution hint.

Reviewed every reason/goal in all three model reports rather than relying on reported counts:

- r1 original hint: numeric8/8 positive and0/8 false positive, but mixed-api proposes `该化肥公司的主要竞争对手` with no company identity. This is a real semantic failure retained in evidence, not accepted by the numeric pass.
- r2 long rule:5/8 positive,0 false positive,3 invalid (mixed-api/provided-analysis/cross-source), all1600 completion tokens spent as reasoning without valid JSON. The invalids are retained and counted as unevaluated, not credited as negative solo results.
- r3 final compressed rule:8/8 positive,0/8 false positive,0 unevaluated; two separate semantic cases pass. Mixed-api has only fertilizer industry supply/demand/price, industry regulation, and competition overview explicitly `不针对特定公司`. These use the supplied fertilizer industry without guessing the definite company. Parent remains responsible for missing company-specific work. Named-company case has explicit 芭田股份; supplied numbers and creative inputs are used directly; jurisdictions/categories/databases are explicit; the generic three-provider comparison is genuinely open-ended.
- All eight original negative cases are solo, including future unavailable data, forbidden-tool-only work, sequential work and user refusal. Additional missing-entity-only case is solo, whereas independent fertilizer/phosphate industry tasks qualify. This pair discriminates entity prerequisites from merely seeing company/industry words.

Independently compared the original16-case literal source against base6594c053: **unchanged**. All rounds use `deepseek-v4-flash-vision-exp` alias, OpenAI protocol, corpus SHA `00fd92c26939dcc0160c4180d9c91ee0d10808de064ae479347c82d0b4e6e1eb`, tools SHA `5374633e634b3579b4abe8e47323244e4b43e784f7914b64dd65e5a87c7d1014`,12s timeout, original ≥6/8 and ≤2/8 thresholds. Production code still max_tokens1600 at `fleet-assessment.ts:70`. The separate fixed semantic pair hashes identically between r2/r3. Final source matches8-file manifest SHA `9a03a54fc44699a75681cd675fc18ef8044eb76c45348c230bdae39bfc5a0512`; actual prompt hash is `00a49b20a6fdd8e01fa1be76bd162db36bb9dce05cb59abc873d30aca6774306`.

`companion/scripts/fleet-assessment-eval.cjs:60–78` computes predictions from actual results, requires zero invalid/failed assessments, checks both semantic cases separately, then unchanged16-case thresholds. It hashes the actual producer system request rather than a hand-built envelope. No new model request was performed for this review; the full supplied traces and source were independently examined. This is small fixed-corpus evidence at a recorded model alias/date, not a guarantee for arbitrary requests or actual web research quality.

### #621 checkpoint equality preserves authority and budgets

`companion/src/orchestrator/cooperation-plan.ts:246–260` still checks browser/current planned worker, locates the current attempt, clamps recovery against planned attempt count, and compares existing source.version and status before considering recovery equality. Only the old order-sensitive JSON.stringify comparison changes to the exact schema-v1 action/automatic/requires_confirmation/budget_remaining fields. These are the four fields in `cooperation-result.ts:5–10`; automatic is the literal false in real producer results.

Same report + same four field meanings now avoids writes independent of property insertion order. Changed recovery still persists; same-report decisions are preserved. Changed source/version/status still invalidates only the relevant attempt's judgments. No new state transition, recovery action, automatic retry or budget reset is introduced.

`companion/tests/cooperation-plan.test.ts:378–402` creates/collects/reviews actual producer reports for a task and accepted sibling, reverses real recovery entries, observes zero update writes, reloads exact disk state and retains acceptance. Lines405–432 create real exhausted planned attempts and actual browserTaskResult legacy recovery metadata, observe changed budget written once and exact judgments reloaded, then idempotence. They do not invent automatic:true as a valid producer. Existing current-owner/current-run/new-report/unsettled execution/crash/race tests remain intact. Security-sensitive callers still require current source references and confirmation for replacement.

## Trust, HITL and resource boundaries

Actual adapter preflight (`companion/src/llm/adapter.ts:1425–1448`) invokes only the advisory `fleet_suggest_propose` on a valid suggest; current-user panel/tray/tool gating and cancellation remain. Assessor request has no executable tools and wraps task as untrusted data. Failure/timeout leaves original task proceeding, except actual cancellation.

Actual dispatcher `companion/src/tool/companion-dispatch.ts:2422` only broadcasts the suggestion card with no spawn/thread mutation and explicit wait-for-human text; `spawn_worker:208` requires real security_token and validates its binding before worker creation. Parent capability intersection and WORKER_HARD_DENY remain in spawn.ts; this diff changes neither. Cooperation review still requires owning parent, source version and valid refs (`cooperation-plan.ts:264–287`), declares semantic_truth_verified:false, and never converts runtime completion into independently verified claims.

Existing ordinary finish supervision at adapter1713 onward waits/collects before final summary, releases/reacquires parent slots, preserves actual historyStore tool receipt, discloses incomplete states before capacity reacquisition and does not auto restart stopped work. `fleet-supervision.ts` retains10-minute finite wait, user pause/abort/run fencing and once-per-stable-epoch handling. No loop/retry cap, permission, ACL, outbound profile, live configuration or L2 class was enlarged. No secret, credential or private business payload appears in the scoped diff/model traces.

## #619 actual DOM coverage and deferred performance observation

Removed JSX children[0] handler calls from `chrome-extension/tests/task-relationship.test.ts:57–65` while retaining actual component escaped markup/accessibility and real reducer/relationship tests. New harness interaction is actual bundled React/helper/reducer/CSS rendered in Chromium, not a function-call replacement or source-string check.

`companion/scripts/test-task-navigation-ui.py:25–55` uses role/name queries to click and press Enter/Space at320/390/900px, checks bounds, exact resulting direct-parent action/caches/draft/busy/upload sequence, tests multilevel direct parent `middle`, and asserts missing/trash/cycle disabled produce no extra action even on DOM click. Actual production component supplies native button/disabled/onClick guard; StatusRail235–238 owns existing SET_ACTIVE_THREAD + thread.select action. Fixture's callbacks exercise the actual reducer sequence but do not connect to runtime Chrome APIs. Reviewed actual PASS log `/tmp/cmspark-cooperation-navigation-dom.log`; no whole installed-extension or MV3 reconnect acceptance inferred.

StatusRail O(n) Map performance item has no measured bottleneck and was explicitly an observation in the issue. No need to introduce memoization to claim a defect repair. It may be dispositioned as no current action/deferred pending measured hot-path evidence; do not say performance improved. Document the observation/reopen trigger when closing the actionable test-maintenance portion.

## #577 already-main DoD and honest closure boundary

Original #577 asks for unified browser/ACP state/summary/source/artifact/missing/recovery, persistent collected versions and stale-run recognition, explicit dependency checks, finite classified recovery, fixed-corpus/real-path regressions and unchanged permissions. It does **not** require replay of one specific inaccessible vw2ob1 trace or a universal DAG scheduler.

Read actual unchanged production contracts: cooperation-result retains extractive1200 summaries, truncation marker and raw source refs; state64-record cap, ownership/run and disk reload; accepted criteria/source/conflict dependency gate; source/execution version checks and crash fencing; ACP live-session projection distinguishes partial/stopped/unknown external completion. Adapter collects through actual dispatcher and only passes bounded result projection to model, preserves raw history and explicit excerpt access.

Fresh evidence `/tmp/cmspark-576-577-acceptance.md` maps each original DoD to actual source/producer tests/main commits and discloses limits. Reviewed105-pass targeted log and1-pass real SIGKILL/reload log and representative actual tests:
- fleet-chat-path202–230: long raw report remains in source history, one bounded model projection, actual history receipt, source message ID and tail excerpt retrievable;
- fleet-chat-path232–281: real ACP state/result producer/owner paths without process startup;
- cooperation-state74–116: read-in-flight owner/run/activity changes cannot record completion;
- run-execution-fence46 onward: actual chatCreate child dies while provider await, disk reload invalidates accepted old source/dependent, stable interruption disclosed once, fresh execution settles its own ID;
- complete cooperation-plan/races tests preserve accepted siblings, dependency refusals, bounded attempts and fresh confirmation.

These tests use production producers with controlled providers/state, not real business pages/models/coding terminals. Prior acceptance was105+1=106 distinct tests, not106+extra crashdoublecount. Today's whole-host inventory includes changed component regressions. Old missing temporary raw artifacts and historical five-parent probe limits remain disclosed; source commits and current producer evidence are sufficient for the scoped #577 delivered-runtime DoD after final wave gates. No need to implement a second scheduler to close it.

#576 similarly has already-main runtime plus this reviewed semantic eligibility repair and today's current-model evidence; it can close after final grouped gates/landing with an accurate evidence summary. Neither closure may claim all original vw2ob1 causes resolved by end-to-end replay. Original trace remains absent. No fresh5-parent simultaneous durable scenario or installed application deployment was newly performed. Those boundaries do not invalidate the bounded current requirements, but must be retained if tracked separately.

## Mixed-ticket dispositions and nonblocking nits

No confirmed P0/P1/P2 production defect from this scoped diff.

1. **Evidence/maintenance nit, not blocker:** DOM interaction harness is separate from the Node assertion file. Root must preserve its actual recorded run in final component evidence; npm test1527 alone is not proof of click/keyboard behavior. Do not imply actual extension reconnect/native browser acceptance.
2. **Long-term coverage observation, not blocker:** existing fleet_handback_epochs pruning and durable5-parent simultaneous slot regression remain bounded follow-ups; current source/capacity/owner/race coverage passed. No present failure reproduced here, no claim these were implemented.
3. **#621 remainder is genuinely unimplemented:** NaN/Infinity/-0 versioned CDP value encoding remains deferred. Verified current browser-bridge1886–1912 rejects unserializableValue-only non-JSON numeric completions as EVALUATE_NULL_RESULT, instead of fake undefined success. This diff implements only semantic recovery comparison. Keep #621 open with explicit remainder or split/move it to a visible follow-up before closing the fulfilled maintenance portion; do not silently erase the enhancement or claim its implementation.
4. **#619 performance item:** explicit no-action until measurements is a valid observation disposition. If retained as scheduled deferred work, preserve a visible follow-up; closing test-maintenance work must not claim memoization/performance improvement.

No extra behavior changes requested to satisfy speculative nits, and no requirement for one entire expensive review per individual ticket. A combined exact-source gate legitimately covers this module batch, while per-ticket DoD/dispositions remain explicit.

## Machine evidence and merge limits

Supplied final host card: Companion5901 total/5849 pass/52existing skips/0fail/cancel, build0; Extension1527/1527 pass/no skips/fail, build0. Complete inventory was run canonically with unchanged native Office file serially; initial native-context240s failure remains preserved, not relabeled success. This review does not self-approve Office. Component focused58/58, navigation6/6 and isolated DOM PASS logs are retained. No redundant full suite or new credential-bearing model call launched by reviewer.

Linux ARM64 is **pending in the supplied r2 machine card** and not assumed green. Final Kimi/Pi synthesis, actual per-head CI, landing and merged-main job-level CI remain root-owned requirements. #618/#626 T4 real enterprise acceptance and #615 real large workbook inputs are outside this component and remain blocked; nothing here authorizes their false closure or merge bypass.

## Exact eight-file hashes

```json
{
  "chrome-extension/tests/task-relationship.test.ts": "36659c42b332009f0daeebd1ca8fbfdc864b434fd096bd7154412babdb20bd84",
  "companion/scripts/fleet-assessment-eval.cjs": "bcced0fdabe35f4d15a8e4ba480ebdd49663981c72e756b63ec126236f2623e8",
  "companion/scripts/render-task-navigation-fixture.cjs": "982bc039c8533331447d059a6893a79aaea8b0a1ac5a83d3e278b6a2b0df6b17",
  "companion/scripts/test-task-navigation-ui.py": "361c3d89450fee95c558f12ad10fc458d816b18badc09bef34ff4c6647c8d27a",
  "companion/src/orchestrator/cooperation-plan.ts": "9e6223763ceec9c7d5e0325750e0c55a14f6adb4863f2d71a9dd59fc80999046",
  "companion/src/orchestrator/fleet-assessment.ts": "9a03a54fc44699a75681cd675fc18ef8044eb76c45348c230bdae39bfc5a0512",
  "companion/tests/cooperation-plan.test.ts": "118e64881be0c2d3cf5b6e89f3c68f50eda8e3617821f8543cde687796c04355",
  "companion/tests/fleet-assessment.test.ts": "0e61947f7337eb76ea3379678f94b9da93c8956d4345d597bd2357ea12dec214"
}
```

## Model trace hashes independently recalculated

- r1 JSON SHA256 `67d104ba21ac2c20eb58d13b3d5750f486663b46967c2fc354dfd05290426d13` — semantic FAIL retained.
- r2 JSON SHA256 `cbf405a12d0a725bb32a5a81fae42710364e90d0bd3cadd23c04bae42a005648` — machine FAIL retained.
- r3 JSON SHA256 `2fcfb29c5c93b621ca24fd038a3dc5e97789d222f688065747188e92af252bbd` — final same-envelope16+2 passes, full goals independently read.

Final verdict: **APPROVE_WITH_NITS, Cooperation component scoped push-review ready; not whole-wave or merge-ready.**
