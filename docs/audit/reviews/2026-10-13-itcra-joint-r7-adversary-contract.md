# Independent joint component contract review — r7

Date: 2026-10-13. Independent non-implementer contract/state-machine lane.

**Component verdict: REQUEST_CHANGES.** The exact r6 approval/configuration and diagram-continuation counterexamples are closed. A sibling P2 remains: scope/input/evidence mutation does not synchronously cancel an original normal operation waiting for login, so Companion can resume it after its task inputs have changed. Immediate input-stop is explicitly intended for these original pending operations as well as dangerous approvals.

Overall merge/release remains BLOCKED: no completed actual human SSO/readiness qualification, no second independent enterprise identity, no full 23 P0 real receipts, and no completed T4 human/joint gate. Those missing delivery observations are separate from this source defect.

## Inputs, evidence and limits

Reviewed complete frozen r7 component content by comparison against the fully read r6 package, reading every changed line in the 3,828-line r7 `kimi-context.md`, including both patches, new regressions and revised production context. CMspark patch is unchanged. Also read actual adjacent scope/upload/collection mutation paths, all production `invalidate`/`stale_analysis` callers, fingerprint producer, decision boundary and source configuration/rule-analysis siblings.

Verified patch SHA256:

- CMspark `cafbf36ca52823c7c63939d5029bef119ebbabc6bb293b2293261ed023b8f42e`, base `0b1be2e5d10e58cb90d972a4f7a989baa451e9f4`.
- ITCra `a6160a001bd40ee3aeb0b4d19f950aad221cb571201e49a16f0c0a41bb43a6b8`.

This lane performed source-path and hash review only; no fresh runtime/browser/business operation was executed, no secrets/Cookies/QR pixels/private browser data were read, and no implementation was edited. Reproduction below is a deterministic isolated-fixture recipe, not a claimed fresh live observation. Supplied host log ends with ITCra 111 passed; supplied Linux ARM64 log ends with 111 passed and two warnings (including subprocess cleanup/event-loop warning). Card was updated during review to final ARM PASS, recording ITCra 111 passes and Companion 23 passes/build on linux/arm64; source hashes remain unchanged. Companion 5,916 / 5,864 pass / 52 existing skips, extension 1,521, host enterprise-targeted 24 and isolated native 16 are supplied machine evidence, not real enterprise acceptance.

## J7-C1 — P2: changed source inputs can still resume a pending normal browser operation

Primary location: `/Users/huchen/Projects/ITCra/app/main.py:438`. Same defect at :505, :507 and :650. Producer: `/Users/huchen/Projects/ITCra/app/store.py:106`–120; task fingerprint: `/Users/huchen/Projects/ITCra/app/workspace.py:15`–20. Deferred stop: `/Users/huchen/Projects/ITCra/app/enterprise_resume.py:30`–37 and :78–79. Companion continuation: `/Users/huchen/Projects/cmspark/companion/src/outbound-mcp/enterprise-service.ts:420`–421 and its `run` path.

Model/capability mutations now synchronously mark waiting-browser jobs stopped and cancel their waits. Direct change-input mutations still only update the change aggregate and invalidate its analysis. They neither mark its active AI jobs stopped nor call `cancel_browser_waits`. The owning Worker will detect invalid inputs at its next check/wake, and the new human decision fence correctly refuses old dangerous approval. But already requested normal operations resume independently through Companion's monitor, which sees an unchanged Companion policy and has no knowledge of the changed ITCra input fingerprint. A login-ready event between the input mutation and the next ITCra wake therefore dispatches old-task work after the input mutation returned.

This does not require an incorrectly labelled dangerous rule. Use `get_page_text` or a verified normal navigation/read-only rule. The read may be discarded later rather than committed to analysis, but the promised immediate original-operation stop is still violated. Severity is P2: the concrete counterexample is an extra stale-task read/navigation; the new decision fence prevents a newly approved write on that changed job.

Reproduction using the existing isolated actual-producer fixture:

1. Prepare a valid original job/session, set simulated browser to `login_required`, and have a stage prepare/execute `get_page_text`. The actual service returns `waiting_login` with `execute_requested=true`; Worker records that operation ID in a `waiting_browser` job.
2. Pause/defer `wake_browser_jobs`. PATCH the same change's scope (e.g. its target version) through the real `/api/changes/:id/scope` endpoint. The endpoint returns success and invalidates confirmation/analysis, but original job/operation still wait.
3. Set the original simulated browser ready and wait for Companion monitor (or explicitly tick that isolated service), **without** running ITCra wake first.
4. Actual Companion completes the old operation and its fixture effect/read counter increments. Only subsequent `wake_browser_jobs` marks the old job failed/cancels remaining waits. Cancellation cannot reverse the completed read/navigation.

Sibling mutation inventory requiring the same central synchronous fence:

| Entry point | Actual mutation | Location |
| --- | --- | --- |
| PATCH `/api/changes/:id/scope` | baseline/target/module/root scope; invalidates confirmation and analysis | `main.py:432`–440 |
| POST `/api/changes/:id/uploads`, manual/modifications/baseline/target | supersedes prior input, appends active file/hash; `invalidate(change)` | `main.py:497`–513, especially :505 |
| Same upload endpoint, evidence | appends external evidence and active input upload/hash; `stale_analysis(change)` | `main.py:507`–513 |
| POST `/api/agent/jobs/:id/result`, successful collection | appends external page snapshot; `stale_analysis(change)` | `main.py:647`–657, especially :650 |

These are all production calls to the change invalidation helpers in the reviewed app. Source configuration save (`main.py:580`–596) changes future collection configuration, not existing evidence/fingerprint; do not unnecessarily invalidate immutable previous snapshots solely because that configuration changes. Rule analysis rerun (`main.py:516`–528) replaces generated evidence excluded from the fingerprint and can preserve unchanged effective inputs; cancellation should follow actual invalidation/input changes rather than every aggregate write. Model/capability/connector invalidation and new-job replacement already have the r7 waiting-browser cancellation path.

Repair: centralize task invalidation for a changed change aggregate under its existing Store transaction, selecting matching queued/running/waiting-browser jobs, fencing them and cancelling their original pending browser operations before the mutating request reports success. Reuse the existing authoritative cancellation/unknown semantics; an operation already dispatched before cancellation must not be represented as undone. Preserve the transaction ordering with decision admission added in r7. Do not rely on the next Worker poll.

Missing regression: parameterize the normal `waiting_login` counterexample across scope mutation, code/manual/modification upload, external-evidence upload and successful page collection. After mutation returns, drive **Companion** readiness/monitor before any ITCra wake and assert no new effect/read, original handle cancelled/stopped, no fresh operation key. The new r7 input test submits only an old write proof, so it proves the decision fence but cannot detect this independent normal monitor path.

## r6 repair closure and component assessment

- **J6-C1 closed for its exact dangerous-approval/configuration trajectory.** Model and capability invalidators include waiting-browser and cancel waits. `decision_sync` reads original job/status/change/pending-ID association and `job_inputs_current` inside Store transaction before signing/claim/dispatch. Config writes and cancellation paths use the same transaction serialization. New real endpoint tests mutate model/capability/input/cancel, submit old proof without wake, and require 409/no claim/effects zero. The remaining sibling normal-input path is J7-C1, not a claim that this old dangerous counterexample still works.
- **J6-C2 closed.** Diagram handling rethrows typed `BrowserWaiting`; Worker retains handles/releases claim. New diagram fixture finishes review/synthesis checkpoints, waits, resumes original diagram, confirms prior stages reused and only one open/read effect.
- **Async workflow blocking closed by inspection and supplied regression.** Async opening/preparing/decision routes parse bounded request body and offload the complete synchronous workflow via `run_in_threadpool`. Each worker-side helper rechecks human authentication. Slow preparation test submits a concurrent actual logout and verifies it completes before delayed browser work; long sync REST calls no longer occupy the event-loop thread.
- **UI polling failure clears stale pixels.** Catch path now calls `clearImage` for the current epoch/owner/change before displaying error. Existing late-response epoch/cancellation protections remain. This change does not make mock UI evidence real SSO acceptance.
- **Native #627 and actual review metadata remain sound in this lane.** CMspark's explicit `null` rule injection and allowed review target/origin/path metadata are unchanged from r6. No new undefined native injection argument or private URL-query/node-token leak found.
- **Original trajectory/state handling retained.** Parallel waits union pending records, completed stage reuse binds protocol/dependency/scope, exact logical call keys reject mismatches, write semantic aliasing prevents sibling approval duplicates, and unknown results stop rather than allocate new retry identities. Source configuration/tool changes do not broaden grant authority. Human session/RBAC/signer remains distinct from execution authority.
- **Coverage and compatibility remain honest.** The fixture uses actual producer/REST/proof with an explicitly simulated browser. Worker has no human signer/presentation tool. Dedicated identity/ACL/private-mount requirements remain documented. Source success does not establish authenticated business readiness, principal isolation, original workbook export, unsupported iframe/popup SSO, matching offline delivery or real receipts.

The one finding is an implementation gap in the newly introduced automatic browser continuation through existing input mutation siblings, independently of the acknowledged missing live acceptance evidence. No hypothetical personal-data or live-browser test is required.

End-of-review frozen patch hashes remain the values above. Only this report was created by this lane.

**VERDICT: REQUEST_CHANGES (component). Overall merge/release remains BLOCKED pending the real T4/joint gate.**
