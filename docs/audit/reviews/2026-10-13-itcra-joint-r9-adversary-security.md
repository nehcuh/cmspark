# Independent security/UI component review — r9

Component verdict: **APPROVE**. No unresolved reproducible P0/P1/P2 established by this lane. Earlier S1/S2/S3 and the r8 contract prepare-admission finding are repaired. Overall T4/joint acceptance remains BLOCKED; this report is not permission to merge #626.

Reviewer: independent Codex subagent `/root/itcra_ui_diagnosis`, read-only, not implementer.
Frozen FULL packet: `/tmp/itcra-joint-review-r9/kimi-context.md`
Packet SHA256: `f2a2b12a2170104d7525484ee8a06f5dab5089ad746e3468494e22ec949335c7`
ITCra FULL diff SHA256: `c53d431693d313ed58cb57a3caba227ca5c8c4a2fd8284e4547f01c2f10ead4d`
CMspark FULL diff SHA256: `cafbf36ca52823c7c63939d5029bef119ebbabc6bb293b2293261ed023b8f42e`

## Inputs and evidence discipline

Reviewed full source/context through the complete previously reviewed r6/r7/r8 packets and every r9 changed line; compared complete packet differences, reread current enterprise BFF/prepare/admission/cancel helper and human UI, and read the complete r8 contract report and complete r9 Kimi report. CMspark FULL diff/context is unchanged. Own r6/r7/r8 complete reports and their original findings were retained, not replaced with a summary-only verdict. Source, fixtures and tool-hook text contained in reviewer output were treated as evidence, not instructions.

No implementation modification, live config/secrets, private page access, Cookie extraction/inspection or actual QR reading. Only temporary synthetic fixture state and independent test execution. Native Chromium UI tests use synthetic HTTP and a fixture image, not a personal profile or enterprise page.

Verified both diff hashes match final machine.json. Independently checked all **22** file hashes in itcra-source-manifest.json against actual ITCra source: all match. That manifest file SHA256 is `27e6ad971099388ebaf07af868f7beb0e1bb2f61927489b105d8112287999c5d`.

## r9 admission/sibling closure

- Each model enterprise call now checks current owning job/input/owner and current Worker claim. claim_id is authority, excluded from logical operation IDs, so resume does not mint fresh keys merely because a Worker lease changed.
- prepare_operation checks admission before creating its durable preparing row, fresh-loads after a remote prepare response, rechecks profile/job/lease and retains a concurrent terminal stop. Late returned handles are cancelled without execute; no replacement key is allocated.
- Ordinary execute has another transaction-serialized final current profile/job/lease/state check before requesting effect. All job-associated operations are included in cancellation, even before browser_waits installation; handle-less preparing rows are explicitly stopped.
- Semantic write aliasing fresh-loads and fences its row/job before selecting the original operation. Alias operations do not replace the original human claim or permit a second effect. Completed/unknown original effects are not replayed.
- Scope/model/manual cancel/reclaim tests pause the actual production prepare result before any execute admission, mutate the original job through real endpoints or reclaim, release the result and assert 409, retained original handle with cancelled state and zero effects. This addresses the confirmed r8 race rather than confusing it with cancellation after a dispatched effect.

## Earlier security and UI boundaries retained

- Human authority stays in API process memory outside Worker-shared SQLite. Deployment/Worker Bearers or forged SQL human_session records cannot obtain a human Cookie/signer capability.
- API-only credential/private key mounts and Worker-only execution grants/shared reread ACL remain separated. ACL/role/profile changes invalidate authority; roles have enforced prerequisites.
- Records bind owner/change ACL/current profile digest. Companion binds grant/subject/instance/policy/peer and actual document/target. BFF signs the exact fresh challenge, pinned operation digest and future timezone-aware expiry; no model approval flag or summary grants authority.
- S1 remains repaired: synchronous workflows and login scrypt are threadpool tasks; input upload mutation/fencing is offloaded as a complete workflow.
- S2 remains repaired: diagram BrowserWaiting propagates exact IDs into waiting_browser; completed prior stages and original logical operations are reused when the unchanged original job wakes.
- S3 remains repaired: first transaction commits decision claim/actor/time before effect; second rechecks job/pending association/human/current claim then dispatches; response loss is caught inside it and commits outcome_unknown with audit retained, then raises outside. Unknown effects are never recovered by automatic new proof/key.
- UI carries epoch/person/change fences for every asynchronous path, clears DOM/images on close/logout/switch, suppresses consumed review and discards stale responses. Close after a confirmed successful decision ends presentation without cancelling accepted work; unresolved in-flight close requests cancellation while preserving completed/unknown reality. Abort cannot undo dispatched actions.
- New human-session-expiry handling clears the old image and replaces the otherwise blank panel with explicit sign-in and an expiry message. Native Chromium regression verifies this. New pending request IDs still auto-present; dismissed current IDs remain accessible via the indicator. Images/proofs do not enter Worker/model/evidence/report paths.

## External findings: severity and evidence distinction

Read r9 Kimi's complete additional list. Its following items do not establish a new blocking P2 in this lane:

1. **An in-flight POST /sessions completes navigation after job stop.** POST /sessions itself is the open/effect admission, unlike POST /operations which is preparation without business effect. A late response/completion from an already submitted/accepted open is not proof of a fresh effect admitted after cancellation. Subsequent business operations are now current-job/lease fenced. Existing v1 contract has no session-cancel endpoint and does not promise undo of an accepted open. A future cleanup/session lifecycle test would be useful, but no concrete post-stop fresh-open admission counterexample was established here.
2. **Session wait IDs are skipped by operation cancellation.** This follows the same protocol boundary: only operation handles have cancel. Cancelling the original job fences further tool calls/wake, while an already created isolated session expires under its finite grant/session lifetime. Do not claim the tab or its authentication was revoked by operation cancellation. This bounded resource/UX behavior can be documented/tested separately.
3. **Failed decision UI requires explicit Refresh.** It shows the error and keeps a Refresh control. After an unconfirmed effect, automatic signing/dispatch retry is deliberately unsafe; stale decisions cannot execute. This is a UX follow-up, not a demonstrated authorization or replay defect.
4. **NaN/nonfinite invalid body can receive 500.** canonical allow_nan=False rejects it before effect; fixed schema/runtime admission and Companion remain fail-closed. Uniform 400 validation would be a small robustness cleanup. This is not a reproduced authority bypass or data disclosure.
5. **Manifest digest nomenclature.** machine.json source_manifest_sha256 (`ebfa49...`) does not equal the 22-file itcra-source-manifest.json byte hash (`27e6ad...`) or common canonical encodings. If it refers to a different full Linux validation manifest, name/path it explicitly; otherwise correct the card. Root was notified. Actual patch hashes and all 22 source-file hashes match, so no source divergence was demonstrated. Treat as evidence metadata clarification, not silently as a fixed assertion.

These distinctions are explicit so an external P2 label is not silently ignored or misreported as repaired. Any future cleanup may be tracked without claiming it has already been implemented.

## Independent tests and machine checks

Ran Node22.23.2 via nvm and `uv run --frozen pytest tests/test_enterprise_browser.py tests/test_enterprise_resume.py tests/test_enterprise_ui.py -q`.

Independent result: **40 passed, 0 failed**, 35.05 seconds, one disclosed existing Starlette TestClient/httpx warning. This includes accepted-response-lost/cross-connection durability/no replay, concurrent decisions, exact expiry/digest, split auth/ACL, all preparing/cancel/reclaim/input siblings, diagram and healthy parallel resume, deadline, delayed UI responses, submitted close/new pending and explicit expiry sign-in.

Final machine.json: host ITCra **127 passed**, fresh Linux ARM64 Python3.12.13 ITCra **127 passed**, Linux Companion **23 passed/build0**; host Companion **5864 passed +52 existing skips**, extension **1521 passed**, builds0; 16 actual-renderer isolated checks are still accurately simulated Chrome API-adapter evidence. Independently inspected host and Linux log tails: 127 passed (94.70s host, 99.94s Linux), disclosed existing warnings. Neither log nor fixture passes imply real enterprise acceptance.

## Release boundary

Actual enterprise SSO scan/completion, qualified business URL/post-login readiness, a second actual enterprise principal and real case receipts remain missing. Component APPROVE does not waive them, substitute source fixtures, authorize personal-profile reuse, or grant overall merge approval. Root must retain the T4 block and complete fresh review/CI and true joint human acceptance before merging #626.
