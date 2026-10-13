# Independent joint component contract review — r9

Date: 2026-10-13. Independent non-implementer product/contract/state-machine lane.

**Component verdict: APPROVE.** The exact r6/r7/r8 contract counterexamples are closed, and this final rereview found no additional reproducible P1/P2 in the reviewed component changes. This is source/component approval only.

**Overall merge/release remains T4 BLOCKED.** Actual human SSO completion, qualified business URL/post-login readiness, a second independent enterprise identity and all 23 P0 real receipts are still missing. Machine/component approval does not supply those observations or authorize overall merge.

## Frozen source and review method

Reviewed the full r9 component source content through the 4,240-line frozen `kimi-context.md`: both complete patches and production context, compared with the previously fully reviewed r6–r8 packages and reading every changed line. Read the preserved complete r6/r7/r8 lane reports and followed each prior counterexample through its final admission/cancellation/state path. Reread actual producer, ordinary prepare/execute, all-job cancellation, Worker lease/key propagation, two-step human decision, UI expiry and real public-payload fixtures.

Verified frozen patches:

- CMspark, base `0b1be2e5d10e58cb90d972a4f7a989baa451e9f4`: `cafbf36ca52823c7c63939d5029bef119ebbabc6bb293b2293261ed023b8f42e`.
- ITCra: `c53d431693d313ed58cb57a3caba227ca5c8c4a2fd8284e4547f01c2f10ead4d`.

All 22 actual ITCra files named by the frozen source manifest match their SHA256 entries. A fresh read-only Git diff of the five scoped CMspark files against the specified base hashes exactly to its frozen patch. No source drift found.

This lane performed read-only source/hash/log review, not fresh runtime tests. No browser/business operations, secrets/Cookies/QR/private-page reads or implementation edits. Host r9 log ends in 127 passes; Linux ARM64 r9 log ends in 127 passes. Final machine card records ARM Companion 23 passes/build, host Companion 5,916 tests / 5,864 pass / 52 existing skips, extension 1,521 passes and isolated native 16. Existing TestClient deprecation and Linux stdio-finalizer warnings remain explicitly recorded rather than suppressed. The tests and native adapter evidence are component evidence, not authenticated enterprise acceptance.

## Prior finding closure

| Finding | Final source behavior and evidence |
| --- | --- |
| J6-C1 P1: old human approval after configuration change | Configuration/new-job invalidators include waiting-browser jobs. Human decision checks original job/change/status/input/model/capability and pending association before claim and again before remote execute. Transactions serialize admission with job/config mutations; stopped jobs cannot mint new execution authority. Actual endpoint regressions reject old proofs without an intervening wake. |
| J6-C2 P2: diagram browser wait swallowed | Diagram explicitly rethrows BrowserWaiting; Worker retains original pending IDs/releases its claim. Fixture confirms original diagram resumes while completed review/synthesis stages are reused, with one shared open/read rather than stage replay. |
| J7-C1 P2: existing waiting-login operation survives input mutation | Scope PATCH, all file/evidence upload commits and successful external-page collection call the central synchronous job fence/cancel under the input transaction. Model/capability/connector/new-job/manual cancellation also cover waits. Normal waiting-login fixture asserts original handle cancelled before readiness resumes, without Worker wake. |
| J8-C1 P2: returning preparation executes after running-job cancellation | Every model browser tool call carries current Worker claim authority. Preparing rows are job-associated before remote response; cancellation scans all job operations, including preparing rows with no handle. Late reply merges fresh ledger state, checks current job/profile/claim and cancels the returned handle if stopped. Normal execute performs another fresh check under the writer transaction before its short transport call. Real-producer slow reply tests cover scope/model/manual-cancel/lease-reclaim and require zero effects. |

The r8 counterexample now reaches `/Users/huchen/Projects/ITCra/app/enterprise_browser.py:280`–297, reads the already-cancelled preparation or detects lost job/claim authority, retains the returned handle, cancels it and raises before :315–321 execute admission. `enterprise_resume.py:10`–20 no longer depends solely on installed browser_waits. The final execute transaction rechecks authority even if cancellation happens after the first returned-handle check. Semantic write aliasing reloads current ledger/job state too.

Worker claim IDs are explicitly excluded from logical operation keys (`enterprise_tools.py:19`), while remaining admission authority (`:24`, `:55`, `worker.py:72`). Therefore a new valid Worker claim after normal login resume does not allocate a new logical operation or replay already completed work. The existing parallel trajectory still measures one shared open and two reads, each once. A reclaimed stale Worker cannot dispatch under its old claim; an explicitly stopped/unknown operation does not become an automatic fresh retry.

## Outcome, trajectory and component assessment

| Area | Assessment |
| --- | --- |
| Actual producer/API shape | Python BFF uses actual Companion grant/REST/proof producers in isolated fixtures. UI fixture records actual BFF/public_record shape, including decision_submitted, instead of inventing private challenge/handle fields. Unknown or malformed responses fail closed. |
| Normal grant operations | Worker execution tools have no approval boolean, signer or login-image endpoint. Existing Companion grant/permit/target/readiness/scope gates remain authoritative. Normal execute admission now checks current original job authority; desktop confirmation is not used as fallback. Actual prompt counters still require real receipts. |
| Healthy parallel and completed-stage reuse | Healthy futures finish/checkpoint, pending waits are unioned, original scoped/protocol/dependency checkpoints are reused. Original opaque handles and logical request keys are retained across resume. Exact payload mismatch fails instead of substituting another operation. |
| Original stopped-operation recovery | Preparing/no-handle rows are terminally fenced before pending wait installation; late handles are retained/cancelled. Fresh ordinary dispatch checks current job, owner, profile and Worker claim. Unknown/transport loss/restart never cause a replacement-key automatic retry. Cancellation after actual dispatch remains unknown where appropriate. |
| Dangerous human decision | Real producer digest/expiry is checked before signing. Durable actor/time/claim commits before effect; second transaction rechecks job/auth/claim and dispatches once. Lost-response handling commits unknown with audit and raises outside the transaction. Cross-SQLite observer, concurrent-decision and replay negatives support this boundary. |
| Human-only UI and RBAC | Human process-memory sessions are separate from Worker SQLite and execution bearer authority. Owner/change/profile, role hierarchy, origin/CSRF and ACL digest remain checked. Proofs/images do not enter model tools or evidence. Grant topology does not prove the actual site's principal. |
| Submission, close and expiry | Server hides consumed review and emits submitted metadata; UI excludes it from approval selection. Closing after confirmed submission preserves submitted work; in-flight close/cancel remains explicit. Later distinct pending IDs still appear after dismissal. A 401 now clears pixels and restores explicit sign-in instead of a blank panel; actual UI source regression first displays synthetic pixels then proves removal/sign-in. |
| Native #627 | Unchanged explicit JSON null for rule-free ScriptInjection; native adapter rejects undefined instead of relying on JSON stringify coercion. Added review exposes allowed origin/path/target attributes, excluding private query and node token. No new native serialization or review-data issue found. |
| Concurrency and deadlines | Synchronous REST workflows/login hashing/upload commit run off the event loop. Writer-fenced execution uses explicit short HTTP transport timeout. Proof/dispatch/session deadlines and bounded wait remain distinct. A transport timeout does not pretend to undo site effects. |
| Readiness and coverage honesty | Main-frame/same-origin markers must be qualified on the actual site. No generic origin-only ready assertion; iframe/popup SSO and complete original workbook export remain unsupported. Visible DOM provenance remains incomplete. Source and fixture passes do not satisfy missing enterprise readiness/identity/effect/UI receipts. |
| Deployment/version/offline claims | Dedicated profile/instance/subject plus split API/Worker grant/ACL/authority mounts remain explicit. Version/health alone is not contract discovery. Matching offline packages/artifacts and real installation still need delivery evidence. No unsupported P1 workbook pass is inferred. |

No additional confirmed source finding is promoted from speculation or an unexecuted hypothetical timing window. This approval is bounded to the frozen component implementation and reviewed counterexamples; arbitrary nondeterministic LLM trajectories, actual enterprise marker semantics, principal topology and deployment behavior remain subject to the named real joint gate.

End-of-review patch hashes remain unchanged; only this report was created by this lane.

**VERDICT: APPROVE (component/source). Overall merge/release: T4 BLOCKED; no overall merge authorization.**
