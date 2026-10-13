# Independent joint component contract review — r8

Date: 2026-10-13. Independent non-implementer product/contract/state-machine lane.

**Component verdict: REQUEST_CHANGES.** Exact r6/r7 findings are closed. One P2 admission race remains for a running job's ordinary operation: cancellation/input mutation during remote preparation does not prevent the returning preparation from issuing a new execute request. This is an effect admitted after the job was stopped, rather than an already dispatched effect that cancellation cannot undo.

Overall merge/release remains **T4 BLOCKED**. Actual human SSO completion, qualified business URL/post-login readiness, a second independent enterprise principal and all 23 P0 real receipts remain absent. Source component review and machine tests cannot replace those gates.

## Reviewed inputs and evidence limits

Read complete r6/r7 lane reports. Reviewed complete frozen r8 source content by comparing its 4,121-line bundle with the previously fully read r7/r6 bundles and reading every changed line, including both full patch contents, new fixture/regressions and changed production context. Reread actual full enterprise browser BFF, complete human UI, input mutation/commit workflow, cancellation helper, ordinary prepare/execute admission, decision transactions and adjacent job/state handlers. CMspark patch and its production native/service/HTTP/contract context are unchanged from the reviewed package.

Frozen SHA256 values verified:

- CMspark `cafbf36ca52823c7c63939d5029bef119ebbabc6bb293b2293261ed023b8f42e`; base `0b1be2e5d10e58cb90d972a4f7a989baa451e9f4`.
- ITCra `508b14672c80a282ea6f9601a0f8e3941446d219a3768e7c36691d625643f616`.

Read-only source and hash review only: no runtime/browser/business action, secrets/Cookies/QR/private-page access or implementation edit. The counterexample below is a deterministic actual-producer fixture recipe, not a claimed fresh execution by this lane. Host r8 log ends with 122 tests passed and the existing TestClient deprecation warning. Supplied unchanged CMspark machine results remain Companion 5,916 tests / 5,864 passes / 52 existing skips, extension 1,521 passes and isolated native 16. Native evidence is accurately simulated API-adapter evidence. At initial review, r8 ARM card is in progress; r7 ARM 111 passes is prior-source evidence and must not be substituted for final r8 ARM PASS.

## J8-C1 — P2: a returning normal preparation can newly execute after its running job was cancelled

Primary location: `/Users/huchen/Projects/ITCra/app/enterprise_browser.py:278`–279. Related: same file :257–277; `/Users/huchen/Projects/ITCra/app/main.py:124`–131; `/Users/huchen/Projects/ITCra/app/enterprise_resume.py:9`–16; `/Users/huchen/Projects/ITCra/app/enterprise_tools.py:53`–57.

`prepare_operation` durably stores a job-associated `preparing` row, performs remote POST `/operations`, writes the returned handle/state and then automatically POSTs `/execute` for an ordinary operation. There is no owning-job/input/model/capability/claim check between the slow preparation and execute admission. `fence_change_jobs` now correctly stops running and waiting jobs, but `cancel_browser_waits` only scans `job.browser_waits`. A currently preparing operation is not in that list: Worker installs its pending ID only after the call returns and throws `BrowserWaiting`. Even scanning the ledger alone would not suffice while the remote handle has not returned. The returning path must recheck the original job before it requests any effect.

A deterministic interleaving permits the mutation/cancellation endpoint to return success while no operation has been dispatched, followed by a new `/execute` from the stopped task. The Worker later notices cancellation and cannot commit analysis, but the stale-task read/navigation has already happened. Dangerous ready writes still require the separately fenced human decision; severity is P2 for a correctly classified ordinary read/navigation, not a claim of automatic dangerous approval.

Reproduction using the existing real Companion service/REST producer plus simulated browser:

1. Create a valid claimed running job and ready session. Start `prepare_operation(..., tool='get_page_text', args={}, job_id=original_job.id)` in a thread. Wrap its POST `/operations`: call the real producer, retain the real prepared response and block its return with an event. Assert the actual browser effect counter is still zero and no execute request has occurred.
2. While preparation is paused, PATCH the owning change's scope, change its model/capability configuration, or explicitly cancel that running job through the real endpoint. These paths mark the job cancelled; its current preparation is absent from the old/empty browser wait list. Wait for endpoint success.
3. Release the real preparation response. `prepare_operation` stores its returned row and reaches :278–279 without reading the now-cancelled job.
4. Actual Companion accepts the new normal execute and the simulated effect/read counter increments. The old job remains cancelled. No SSO, private data, incorrect rule classification or resumed completed stage is required.

This differs from the r7 reproduction, which already had a `waiting_login` handle in `browser_waits`; that exact case is fixed. It also differs from dispatch-before-cancellation: the reproduction deliberately holds the preparation response before the first execute request.

Repair: for every job-associated ordinary execution, recheck the original current job/status/claim or scope and current input/model/capability authority under the Store transaction immediately before execute admission, serialized with mutation/cancellation. If the original job stopped while remote prepare was pending, retain its original key/handle, cancel the returned handle before effect where possible and mark an explicit stopped/unknown outcome; do not execute or allocate a replacement key. Merge latest ledger state instead of blindly overwriting a concurrent stopped record with the old local row. Audit the same admission boundary for `enterprise_open`/session opening: its Worker path also lacks a job fence inside `open_session`; direct human operations without a job remain a separate explicitly authorized flow.

Required regression: actual slow **prepare** producer response → successful scope/config/manual-cancel endpoint → release response, with original job `running` and no installed browser wait. Require no `/execute`, effects zero, original handle stopped, no fresh operation key. Cover cross-Store API/Worker connections as well as one connection. Existing r8 input regressions construct `waiting_browser` plus `browser_waits=[op.id]` before mutation, so they cannot detect this uncovered admission window. The slow-preparation regression checks concurrent logout/event-loop responsiveness, not original-job stop.

## Closure and component assessment

| Requirement/path | r8 assessment |
| --- | --- |
| J6-C1 old dangerous decision after configuration change | Closed. Model/capability/new-job invalidation includes waits. Decision checks original job/change/status/pending association and original inputs/model/capability revision. Both claim and second dispatch admission recheck under Store transactions. |
| J6-C2 diagram waiting swallowed as optional error | Closed. Typed BrowserWaiting rethrows; supplied diagram regression reuses completed review stages and original open/read while continuing only diagram. |
| J7-C1 existing waiting-login normal operation after source mutation | Closed for all inventoried siblings. Central fence is called inside scope mutation, all file/evidence upload commit and successful collector-result transaction. Cancelled original handle cannot be resumed by Companion. Running preparation is J8-C1. |
| Human audit before effect / lost response | Improved correctly. First transaction commits claim/decision actor/time before remote effect. Separate dispatch transaction rechecks authority; transport failure is caught inside it, commits outcome_unknown with retained audit, then raises outside. Cross-SQLite observer/lost-response/concurrent-decision fixtures exercise actual producer authority. No fresh proof/key retry. |
| Native and event-loop boundary | Explicit native rule null remains correct. Whole sync opening/preparing/decision workflows are threadpool tasks; login scrypt is now offloaded; upload's mutation/cancel commit is threadpool work. Two-second execute transport timeout bounds ordinary HTTP waits while the writer fence is held; it is an HTTP transport timeout, not a claim that remote effect cancellation succeeded. |
| Fresh human target binding/expiry | BFF pins real producer operation digest, compares it in proof, validates timezone-aware future expiry, and signs actual canonical challenge. Companion remains final target/document/deadline/proof authority. Changed binding fails closed. |
| UI confirmed submission and next pending request | Server exports decision_submitted metadata and suppresses consumed review; UI excludes it from pending approval selection. Closing after accepted submission no longer cancels submitted work. In-flight close/cancel remains explicit. Dismissal tracks current IDs, later IDs auto-present and same dismissed IDs stay accessible via indicator. invalidate already clears approval synchronously; no false stale-approval assertion is used here. |
| Real payload and private data boundary | UI fixture records actual BFF/public_record exit shape over real Companion producer with simulated browser. Negative assertions exclude proof/challenge/browser handles and private authority fields. Runtime images/proofs remain human-only outside Worker/model/evidence. |
| Healthy parallel and completed-stage reuse | Union of parallel wait records and scoped dependency/protocol checkpoints retained. Exact logical call digests, semantic write aliasing, immutable original handles and terminal unknown outcomes preserve no-replay behavior. Tests establish their deterministic fixture trajectories; differing LLM call order may fail closed rather than establish arbitrary transcript continuity. |
| Coverage/version/offline honesty | Health/version is not enterprise support discovery. Dedicated instance/profile/subject and split API/Worker credentials are required. 503 during open/prepare is conservatively unknown and has no unsafe automatic retry. Unsupported workbook/iframe/popup and missing actual principal/readiness/receipts remain explicit. Matching offline artifacts are not established by source tests. |

No new CMspark-only source finding in this lane. The remaining finding is the ITCra ordinary execution admission sibling, independently of the known real T4 delivery limits.

End-of-review patch hashes remain the frozen values above. Only this report was created by this lane.

**VERDICT: REQUEST_CHANGES (component). Overall merge/release: T4 BLOCKED independently of component repairs.**
