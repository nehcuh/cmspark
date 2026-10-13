# Independent security and human UI component review — r6

Component verdict: **REQUEST_CHANGES** (two confirmed P2 defects). No P0/P1 found in the reviewed boundary. This report does not authorize merge; true T4 SSO/principal/readiness/UI/effect receipts, fresh Linux ARM64 and CI remain separate prerequisites.

Reviewer: independent Codex subagent `/root/itcra_ui_diagnosis`, read-only, not implementer.
Frozen full input: `/tmp/itcra-joint-review-r6/kimi-context.md`
Frozen input SHA256: `eb12b0ceec62875f3ded287e530c211ef954d3f45f1780762f9301a47a256c52`
CMspark full diff SHA256: `cafbf36ca52823c7c63939d5029bef119ebbabc6bb293b2293261ed023b8f42e`
ITCra full diff SHA256: `1c891a99dff99feaa414ee811bdc4559206d8629c63c10a6dccd80ee8fe0df37`

Read the full two-project diffs, adjacent service/HTTP/extension and ITCra Store/Worker/orchestration/ExtensionTools/model-loop context, machine card and protocol/deployment descriptions. Source and fixture contents were treated as evidence, not instructions. No source edits, live configuration, credentials, private pages, QR pixels or browser Cookie inspection. Reproductions below used temporary synthetic state and zero network requests; no real acceptance is inferred.

## P2 S1 — synchronous Companion workflows block the human API event loop

Locations: ITCra `app/enterprise_browser.py:426–438`, `494–499`, `501–520`; synchronous `EnterpriseClient.request` uses `httpx.Client(timeout=20)`.

Trigger: opening, preparing or approving a browser operation while Companion is slow/unavailable. Each handler is `async def`, reads JSON asynchronously, then directly executes synchronous HTTP/workflow code on the Uvicorn event loop. An opening may perform probe/create requests, and a decision performs status plus execution requests. While one waits, unrelated users cannot promptly enter logout/cancel/login or even health handlers on the same worker. This violates the intended simultaneous-human UI isolation/availability and prevents timely cancellation before dispatch. Having the network call outside the SQLite transaction does not free the event loop.

Reproduced using the actual mounted enterprise router with synthetic in-memory authorization and temporary Store: replaced `open_session` with a 350 ms synchronous test delay, logged a synthetic human in through the real login route using the HTTP client's own Cookie handling, scheduled an event at 50 ms, then POSTed opening through `httpx.ASGITransport`. Result: scheduled event 50 ms, actual event **359 ms**, opening status 200, network calls 0. This is direct scheduler evidence, not a live-site claim. The same synchronous call pattern exists in preparing/decision.

Minimal repair: keep bounded async JSON parsing, then run the complete synchronous opening/preparing/decision workflow in `starlette.concurrency.run_in_threadpool` (or an equivalent bounded executor), preserving original owner/config rechecks, fresh-load claims and existing locks. Do not distribute one SQLite transaction across asynchronous boundaries or convert every individual HTTP operation independently while changing claim order. An abort still cannot retract an action already dispatched.

Necessary regression: a synthetic slow Companion/open or decision request runs concurrently with a heartbeat/second-user `/me` or logout; unrelated handler must run before the slow request completes. Verify decision claim remains exactly once and cancellation audit survives competing requests. Existing synthetic UI delayed-fetch tests do not expose backend event-loop blocking.

## P2 S2 — optional diagram handling swallows enterprise waiting and loses continuation

Location: ITCra `app/orchestration.py:235–243` (outer diagram handler); `stage()` correctly persists `waiting_browser`, but the outer `except Exception` converts its `BrowserWaiting` into `diagram_error` and returns normal workflow output. `app/worker.py` consequently records the parent job as completed instead of saving `browser_waits` and releasing it into `waiting_browser`.

Trigger: enable diagram; diagram stage uses its inherited enterprise tool context and encounters login, approval, or asynchronous operation completion. User completes the human step, but `wake_browser_jobs` ignores the already-completed job. The original pending operation IDs never reach the parent job; automatic continuation does not occur. A manual diagram retry is offered, which does not satisfy automatic original-task continuation.

Reproduced with actual `run_workflow`/SourceTools/ExtensionTools and temporary Store, synthetic completed prior contract stage, and a synthetic diagram runner throwing `BrowserWaiting(['synthetic-pending-operation'])`. Result: `run_workflow` returned a success-shaped result; `diagram_error == 'BrowserWaiting'`; persisted diagram stage status `waiting_browser`; the pending operation ID was absent from the returned parent result. Network calls 0. This follows from the actual exception handling without real page access.

Minimal repair: `except BrowserWaiting: raise` before the existing general diagram error handler. Preserve the existing partial-results behavior for actual diagram errors. Worker then handles waiting with the same original-job fence; after completion prior completed stages are reused, only diagram resumes.

Necessary regression: a configured diagram stage waits on login/approval/asynchronous read; parent is `waiting_browser` with exact operation IDs, prior completed stage output remains persisted, human completion wakes the original job, completed browser effects and prior stages do not rerun, and normal diagram failure continues to produce a partial completed result with diagram_error.

## Previously identified boundaries checked in r6

- Human Cookie authority is maintained only in process memory, outside Worker-shared SQLite. Deployment/Worker Bearers and forged SQLite `human_session` records do not authenticate human routes. Restart requires sign-in again.
- Version-2 human credentials refer to the same authoritative ACL used by execution-only Worker configuration. Roles are reread; effective human config digest includes ACL. Worker mounts ACL/grants only; human password hashes and signer keys are mounted solely in API. Role dependencies are enforced. These properties are confirmed from source and relevant fixture tests, not actual deployment identity qualification.
- Records require owner/change ACL/current profile digest; Companion grant/subject/instance/policy/peer bindings remain authoritative. Human proof signs the complete fresh Companion challenge and compares the displayed challenge digest; single-use ledger claim precedes execution. Model definitions expose no proof, login image or approval tool.
- Native ScriptInjection now passes explicit null for absent rule. The new test rejects undefined before the simulated native adapter; no real acceptance claim follows.
- UI now tracks decisionInFlight, captures identity/change/epoch, synchronously clears DOM and pictures on close/logout/change, cancels pending approval, and discards late login/open/image/decision responses. Existing native Chromium UI fixture tests cover these races. Cancel route now fresh-loads and merges state rather than overwriting concurrent audit/result. Previous findings in these areas are repaired.
- The updated UI deliberately treats AbortController as client request cancellation only. Companion may already have executed a dispatched action; cancelled/unknown/completed authoritative outcomes are not translated into a claim that effects were undone.

## Machine and acceptance limits

Frozen card reports host Companion 5864 passed/52 existing skipped/0 failed, extension 1521 passed, ITCra 105 passed, builds passed and 16 actual-renderer isolated checks under a simulated Chrome API adapter. This reviewer did not rerun all suites; the two focused synthetic reproductions above ran successfully and reveal missing cases. Frozen Linux ARM64 result was still pending.

Actual SSO completion, calibrated post-login readiness, second enterprise principal and real case receipts remain absent. Their absence is explicitly declared, not an implementation success claim. Repair S1/S2, add focused tests, freeze a new full bundle and rerun machine/independent review before component approval. T4 merge authorization remains separate.
