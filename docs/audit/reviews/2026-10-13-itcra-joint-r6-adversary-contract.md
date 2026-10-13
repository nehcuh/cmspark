# Independent joint component contract review — r6

Date: 2026-10-13. Reviewer: independent non-implementer product/contract/state-machine lane.

**Component verdict: REQUEST_CHANGES.** Two reproducible source-path defects remain: P1 configuration invalidation does not fence a pending human decision, and P2 diagram-stage browser waits are swallowed instead of continuing the original job. CMspark's narrow native-null/review-metadata changes have no finding in this lane; the joint ITCra continuation component needs repair.

This is not overall merge/release approval. Real human SSO completion, authenticated readiness calibration, a second independent enterprise principal, all 23 P0 real receipts, and the T4 human/joint acceptance gate remain missing. The frozen machine card also records Linux ARM64 as in progress. These honest delivery limits are separate from the implementation defects below.

## Frozen inputs and method

Read the complete 3,649-line `/tmp/itcra-joint-review-r6/kimi-context.md`: both full patches, production Store/Worker/orchestrator/tools/LLM/extension/service/HTTP context, contract and machine card. Read adjacent actual ITCra model/capability invalidation and queue/decision paths and checked actual source line numbers. Earlier full handoff v1.1 and independent r1–r4 contract reviews supply requirement/state-machine context.

Verified patch SHA256 values match `machine.json`:

- CMspark, base `0b1be2e5d10e58cb90d972a4f7a989baa451e9f4`: `cafbf36ca52823c7c63939d5029bef119ebbabc6bb293b2293261ed023b8f42e`.
- ITCra full delivery patch: `1c891a99dff99feaa414ee811bdc4559206d8629c63c10a6dccd80ee8fe0df37`.

This lane performed read-only source-path review and hash checks. It did not execute browser/business actions, rerun runtime fixtures, access credentials/configuration secrets/Cookies/QR pixels/personal pages, or modify implementation. The reproductions below are deterministic test recipes derived from the actual production paths, not claimed fresh runtime observations. Host Companion 5,916 tests / 5,864 passes / 52 existing skips, extension 1,521 passes, ITCra 105 passes, builds and isolated native 16 checks are attributed to the supplied machine card. Its native evidence is accurately labelled actual renderer with a simulated Chrome API adapter, not real enterprise acceptance.

## Findings

### J6-C1 — P1: an old waiting human operation remains executable after job configuration changes

Primary location: `/Users/huchen/Projects/ITCra/app/enterprise_browser.py:506`–519. Related: `/Users/huchen/Projects/ITCra/app/main.py:282`, `/Users/huchen/Projects/ITCra/app/capabilities.py:172`, `/Users/huchen/Projects/ITCra/app/enterprise_resume.py:30`–37, `/Users/huchen/Projects/ITCra/app/worker.py:150`–153.

The new operation ledger retains `job_id`, but the human decision route only checks current human credentials, owner/change/profile ACL, operation state and challenge digest. It never reads the owning job or checks `job_inputs_current`. Both existing synchronous configuration invalidators still select only `queued` and `running`; the newly introduced `waiting_browser` state is omitted. Thus configuration mutation returns successfully while a job's `waiting_human` operation and approval UI remain live. Human cookies depend on enterprise configuration, not model/capability revision, so that human authority is still accepted. Only a later Worker/records wake poll detects the mismatch and cancels it; this is too late if approval was dispatched first. Companion correctly validates its own grant, but cannot know the changed ITCra job revision.

Reproduction using the existing isolated producer fixture:

1. Create an unchanged valid durable job with enterprise owner Alice and have its stage call a write rule (for example `delete`). Let Worker release the claim with `status=waiting_browser`, `browser_waits=[operation.id]`, and obtain that operation's current challenge digest through Alice's authenticated browser route.
2. Stop/defer `wake_browser_jobs` calls; do not change the enterprise ACL or grant. Save a different model revision through the real model configuration endpoint, or change capability configuration through its real endpoint.
3. Before any wake poll, submit Alice's previously displayed, still-unexpired decision to `/api/enterprise/operations/:id/decision`.
4. The old job is still `waiting_browser`; the decision path has no job fence and signs/submits `/execute`. With unchanged target/grant, Companion accepts the old operation and the fixture effect counter increments. A later poll can fail the old job but cannot undo the effect.

The same missing decision fence permits a pending diagram operation whose owning job is already completed (J6-C2). A stopped/changed original job must not gain new execution authority merely because its operation challenge remains cryptographically valid.

Repair: treat waiting-browser jobs as active during input/model/capability invalidation; synchronously fence them and cancel their pending operations. Before claiming/signing/submitting a job-associated human decision, require the original current job, unchanged inputs/model/capability scope, and a valid pending association. Preserve explicit unknown outcomes for cancellation after dispatch. Serialize the invalidation/decision admission boundary so a mutation that has already completed cannot be followed by dispatch from its old job. Do not solve this by waiting for the next periodic poll.

Missing regression: actual config endpoint → old challenge decision **without intervening wake** must reject and leave effects zero for model change, capability change and disabled configuration. The test named `test_waiting_job_cancel_and_input_change_cannot_wake_or_dispatch` only exercises explicit cancellation; it neither mutates inputs/configuration nor submits an old human decision.

### J6-C2 — P2: diagram-stage login/approval wait becomes a completed job and never automatically resumes

Primary location: `/Users/huchen/Projects/ITCra/app/orchestration.py:241`–243. Related: same file :91–95 and :175–177; `/Users/huchen/Projects/ITCra/app/enterprise_tools.py:53`–57; `/Users/huchen/Projects/ITCra/app/worker.py:140`–153; `/Users/huchen/Projects/ITCra/app/enterprise_resume.py:30`.

Enterprise tools/context are propagated to every stage, including `diagram`. Its tool call legitimately raises `BrowserWaiting`; the stage records `waiting_browser` and saves the checkpoint. However, the outer optional-diagram handler catches every exception and converts this typed continuation signal into `diagram_error='BrowserWaiting'`, then returns the workflow result. Worker consequently commits `ai_job.status=completed` instead of releasing it as `waiting_browser` with the pending record IDs. The wake loop only processes waiting-browser jobs, so completing SSO/approval does not wake the original diagram stage. An executing normal operation may finish without attachment to that task; a dangerous waiting operation remains independently approvable even though the job has completed.

Reproduction using the existing durable workflow fixture:

1. Enable diagrams and enterprise context. Allow the ordinary review/synthesis stages to finish and checkpoint.
2. Make the diagram-role gateway call `enterprise_open` while the simulated session is `login_required`, or call `enterprise_operation` with a delayed read/write rule on an existing session.
3. Inspect the resulting records: diagram checkpoint status is `waiting_browser`, but owning job is `completed`, `diagram_error` is `BrowserWaiting`, and new pending record IDs were not installed as the job's browser waits.
4. Set the original session ready / complete the original operation and call `wake_browser_jobs`. The completed job is skipped; there is no automatic original-stage continuation.

Repair: rethrow `BrowserWaiting` from the optional-diagram handler before ordinary diagram-error handling. This allows Worker's existing typed wait path to retain pending handles, release its claim, and reuse already successful review stages on resume. Alternatively remove enterprise tools from diagram stages as an explicitly documented product restriction; the current exposed capability must not silently discard its continuation signal.

Missing regression: a browser wait first encountered in the diagram role must put the original job in waiting-browser state; after readiness/completion, the same job must resume only the diagram stage, reuse completed review stages, and keep original open/operation/effect counts unchanged. Current continuation gateway fixtures only make contract and lifecycle roles use enterprise tools.

## Outcome, trajectory and component assessment

| Area | Assessment |
| --- | --- |
| Actual CMspark → Python payload/signature contract | Fixture uses real grant, service, HTTP and proof producers, with an explicitly simulated browser. Python binds session fields and canonical string-only Ed25519 challenge correctly. Wrong purpose/owner/digest/replay are checked. |
| Normal operations without local prompts | Execution tools call enterprise grant REST and contain no signing, presentation or approval boolean. Source route preserves Companion authority. Real end-to-end prompt counters remain unverified. |
| Parallel waiting and healthy completed-stage reuse | Parallel waits are unioned after healthy futures checkpoint. Completed checkpoints are keyed by job scope/protocol/dependency; original operation claims prevent exact-call replay. Main contract/lifecycle fixture measures one shared open and two reads. Diagram continuation has J6-C2. |
| Original logical operation identity | Stage/context/ordinal keys reject changed payloads; write semantic aliasing preserves one original operation and cancels sibling preparations. Unknown outcomes stop instead of using a fresh key. Fresh model transcript continuation can fail closed on differing ordinal payloads; tests demonstrate the deterministic fixture trajectory, not arbitrary LLM sequence stability. |
| Configuration/stop boundary | Worker admission, progress and wake check original fingerprints/revisions. Model/capability invalidators and human decision admission omit the new wait-state boundary: J6-C1. |
| Human-only UI and RBAC | Human sessions live outside shared Worker SQLite, separate from bearer credentials. Same-origin/CSRF, owner/profile/roles and effective ACL digest are enforced. UI epochs abort/discard late image/open/login/decision responses; closing/logout request cancellation. These protections do not replace owning-job admission. |
| Dangerous review | Added site origin/path and whitelisted target attributes exclude private URL query and node token. Immutable challenge/digest remains authoritative; display metadata does not widen execution rights. Actual UI human acceptance still pending. |
| Native #627 | `snapshot` passes `guard.rule ?? null`; self-contained inspector accepts null. New unit and isolated-adapter assertions reject raw undefined rather than relying on JSON's silent conversion. No remaining undefined argument found in the reviewed native injection call sites. |
| Compatibility/deployment/coverage honesty | Split API/Worker mounts, explicit ACL, fixed instance/subject/profile topology and private files are documented. Version-1 compatibility is scoped to isolated legacy deployment. Source fixture success is not described as real SSO; workbook export and iframe/popup support remain explicit limitations. Matching offline delivery and complete real receipts are still acceptance work. |

Both findings concern newly exposed ITCra browser continuation paths through existing adjacent handlers; they are not objections to the acknowledged missing real delivery evidence. Neither requires personal data or a live enterprise session to reproduce.

End-of-review patch hashes still match the frozen inputs above. Only this report was created by this lane.

**VERDICT: REQUEST_CHANGES (component). Overall merge/release: BLOCKED pending T4 human and real joint acceptance, independently of these repairs.**
