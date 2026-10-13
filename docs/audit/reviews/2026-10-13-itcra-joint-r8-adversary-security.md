# Independent security/UI component review — r8

Component verdict: **APPROVE**. No unresolved reproducible P0/P1/P2 found in this component review. Earlier S1/S2/S3 findings are repaired with focused regressions. **This is not overall T4 acceptance or permission to merge #626.**

Reviewer: independent Codex subagent `/root/itcra_ui_diagnosis`, read-only, not implementer.
Frozen packet: `/tmp/itcra-joint-review-r8/kimi-context.md`
Packet SHA256: `9f5234c87df15c208db50e7694a1a83ff8287c220ae3cd1b377482430991bcf0`
ITCra FULL diff SHA256: `508b14672c80a282ea6f9601a0f8e3941446d219a3768e7c36691d625643f616`
CMspark FULL diff SHA256: `cafbf36ca52823c7c63939d5029bef119ebbabc6bb293b2293261ed023b8f42e`

Review covered the FULL frozen diffs and adjacent context across the previously read r6/r7 packets and every r8 change, including sibling input/config invalidators, human authentication/signing, Worker checkpoint/continuation and UI cancellation/late-response paths. Unchanged full CMspark diff/context was compared with prior packet. No source edit, live configuration, credentials, private pages, browser Cookie inspection or actual QR reading. Tests used temporary synthetic identities/sites and production CMspark/BFF producers with an explicitly simulated browser backend.

## Repaired findings

### S1: human API event-loop blocking — repaired

Opening/preparing/decision perform bounded async body parsing and delegate the complete synchronous workflow to run_in_threadpool. Auth is checked at admission and again within the helper. Slow Companion work does not block an unrelated human logout. Login scrypt is now also offloaded. Upload input-commit/fencing, newly involving synchronous cancellation, is offloaded as a complete workflow rather than running its network work on the event loop.

### S2: diagram BrowserWaiting swallowed — repaired

The diagram outer handler rethrows BrowserWaiting separately while retaining partial-result behavior for actual drawing errors. Worker persists exact pending IDs, releases the original claim and resumes only unchanged original inputs/model/capability/protocol. Successful prior stages and completed logical browser operations remain reused.

### S3: accepted execution response loss rolls back human audit — repaired

First Store transaction rechecks job/input/association/human authority and commits the exact one-use decision claim/actor/time before any remote effect. A second transaction fresh-loads, rechecks original job/pending association/human authority/state/claim and serializes dispatch admission against concurrent SQLite writers. External dispatch failures are caught inside this transaction; outcome_unknown and DECISION_DISPATCH_UNCONFIRMED plus original audit are committed before the exception is rethrown outside it. No new proof/key or automatic replay is minted.

The added accepted-response-lost test uses another SQLite connection at the actual execute boundary to prove the claim/actor are already durable; then executes via the real CMspark fixture, drops the response, checks one effect, retained audit/unknown status and denied replay. This directly addresses the r7 regression.

Execution admission uses a short two-second HTTP transport timeout while holding the dispatch fence. This is not a guaranteed overall wall-clock deadline; neither source comments nor this report claims otherwise. Already dispatched effects cannot be undone by abort/cancel.

## Security, UI and sibling checks

- Human Cookie authority remains API process-memory state, outside Worker-shared SQLite. Deployment/Worker Bearers and forged SQLite human_session records do not authenticate human signing routes. API restart requires reauthentication.
- Split deployment mounts human hashes/private signer only into API; Worker has execution grants and the same reread restricted ACL. Effective human config digest includes that ACL. Revocation/profile changes fail closed; role prerequisites prevent approve-only cancellation mismatch.
- Owner/change ACL/current profile digest and Companion grant/subject/instance/policy/peer remain bound. Signing verifies fresh exact challenge fields, pinned operation digest and expiry; client-supplied approval flags and model summaries cannot create authority. Model tool definitions expose neither signer, human proof nor login image.
- Central input fence covers scope changes, replacement files, evidence upload and successful collection-result evidence; model/capability invalidators, duplicate admission and explicit cancel account for waiting_browser. Stale original-job/input/association is rejected before signing/dispatch, without requiring a later wake poll. Existing cancellation merges fresh state while retaining audit/results.
- Consumed claims export only decision_submitted metadata, no review/challenge/proof. UI therefore does not re-present consumed approval; closing after confirmed 200 submission ends presentation without cancelling submitted work. Closing during unresolved submission still requests cancellation and preserves authoritative unknown/completed reality.
- UI captures epoch/person/change; close/logout/switch clears pixels/DOM before awaits and discards delayed old login/open/image/decision responses. Poll failures remove stale image. Dismissal is per pending request ID; later new requests reappear, and dismissed current requests remain discoverable through the pending indicator. No model/evidence/report path receives QR images/proofs.
- Native Chrome injection absent-rule null and actual site/target review fields remain correct; private query/node token are excluded from human review. Tests are explicitly simulated, not actual SSO acceptance.

## Independent verification performed

Ran `nvm use 22` (Node22.23.2) then uv frozen pytest over:

- accepted-decision response loss/durable claim/no replay;
- actual challenge expiry and pinned operation digest;
- concurrent same-human one-use decision;
- all native Chromium enterprise UI scenarios and public-payload negative assertions;
- diagram wait/resume/reuse;
- all four input mutation sibling fences;
- original bounded wait deadline.

Result: **17 passed, 0 failed**, 21.59 seconds, one disclosed existing Starlette TestClient/httpx deprecation warning. No production browser actions or personal profiles were used. Full host card reports ITCra122 passed, Companion5864 passed +52 existing skips, extension1521 passed and builds0; isolated native renderer16 checks remain simulated API adapter.

At report time `machine.json` still labelled fresh r8 Linux ARM64 in_progress; inspected `/tmp/itcra-joint-linux-r8-tests.log` independently and it already reports **122 passed, 2 existing warnings, 95.98 seconds**. Do not treat this log-tail observation as final approval of remaining Linux pipeline steps; final card/exit must be supplied by root. Prior r7 Linux111 PASS is not substituted for r8.

## Remaining release boundary

Real enterprise scan/completion, qualified business URL/post-login readiness, second actual enterprise principal and real case receipts remain absent. Source component approval, host/Linux fixture tests and synthetic UI checks do not satisfy those T4 requirements. Fresh final Linux card, Kimi/Pi/CI gates and true joint human acceptance remain separate; no overall merge approval is granted by this report.
