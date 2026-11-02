# Independent actual macOS receipt — 8aa98dbb

Exact head `8aa98dbb2b65041b92c9d847c95dd616efaa3d8d`; [canonical CI41542987860](https://github.com/nehcuh/cmspark/actions/runs/41542987860), attempt1/pull_request. Job125611508628 `smoke (macos-latest)` is **COMPLETED / SUCCESS**,23:08:09Z–23:19:29Z.

Read-only approximately45-second metadata polls; one parent-requested current-status query. Only the terminal single Mac job was downloaded:

`gh api repos/nehcuh/cmspark/actions/jobs/125611508628/logs > /tmp/cmspark-826-macos-8aa98dbb.log`

No source changes, rerun/cancel/dispatch, new probe or packaging run. This actual receipt does not substitute the earlier f3/d94 Mac passes for current-head acceptance.

## Actual source/gate compatibility

The original early four-suite command actually ran **176 PASS,0 FAIL,0 SKIP** on Mac (log1289–1292), including strict Activity-first ingress and historical-form rejection. Desktop build helper controls322 PASS; runtime headers16 PASS; real native fixture build and full acceptance/shared TS compilation PASS.

The newly front-positioned Activity step is **actually SKIPPED** by Mac metadata, between compile and bootstrap. Its native-only condition remains false here. Therefore it introduced no Activity fixture/SendInput setup on this Mac lane before MCP. This is a concrete skipped-step fact, not a claim of globally unchanged OS warmness. The19 Activity source controls in that step **did not run on Mac CI**; their sources compiled here, and their separate local/reviewer evidence remains separate from the actual176 root contract result.

## Original MCP20 / Workspace45 / full interaction

Bootstrap/process group24 PASS,0 FAIL,14 platform SKIP. The original actual native MCP case completes in **10832.605917ms PASS**, within original20 seconds. Native receipt: windows3, approved2/denied1, persisted=true, rendererPrivatePayload=false, synthetic activation explicitly not human approval. Progress authenticated/windowRequested=true, postAuthRequestMask7, exited=true, approved/denied/done=true. Empty Windows-only phases/BOOT and UNKNOWN snapshot in the Mac projection provide no Windows diagnostic inference.

Interaction group **12 PASS,0 FAIL,0 SKIP**. Workspace original full45-second case **38219.080291ms PASS**. Actual picker/controller confirmation, canonical selected root persistence, reopen/list/read, second picker cancellation, and unrelated thread unchanged all pass.

Final Workspace native projection: failed=false, failureSite0/firstFailedAssertion0, receiptMask1023, picks2, pickerObserved2, pickerReturned1, cancelReturned1, selectedOutcome/selectedIdentity=true, native childExited=true/exitCode0. UI receiptMask31; begun=true/invalid=false; **observerClosed=true/code0 and xcodeClosed=true/code0**. These are actual close facts, not exit-only inference.

Workspace same-domain surface clock: CLEANUP_ENTER38149ms, ACTION_SETTLED38213ms, RELEASE_ENTER38213ms, RELEASED38214ms; all over_budget=false. Original cleanup and lease release finish inside45 seconds. No failure D826 query/timing output is used to infer anything about previous failure causes.

Subsequent original business/cleanup also all PASS:

- Local6626.985667ms: actual owned PTY/ACP/Unicode, resize/stop/handback/history reopen, permission denial, saved message and sibling unchanged. RELEASED6619ms/over_budget=false.
- Archive4035.722292ms: archive/restore/history/sibling invariants, busy refusal/lost ACK/offline unconfirmed. RELEASED4033ms/over_budget=false.
- Terminal6925.491833ms: actual PTY exit, denied/cancelled zero launch, Unicode/>16KiB output/ACK/resize/stop/partial return/reopen and foreign/null refusal. RELEASED6909ms/over_budget=false.

## Remaining eligible lane

All later eligible steps success: owned PTY tail2 PASS; Office/relocated groups32 PASS2 SKIP,20 PASS,52 PASS; pure smoke39 PASS; Swift/typecheck107 PASS; external Mac AX/background3 PASS; authorization/process58 PASS6 SKIP plus platform-only5 SKIP; MCP/process boundaries17 PASS; ownership startup25 PASS. No failing test or eligible step.

Windows-only census/Registry/UIA/launcher and related gates skip on Mac. Actual Activity/OCR step likewise skips; neither the19 CPU controls nor the9 selected Windows cases are claimed as Mac native acceptance. Same-head Windows native/census outcomes remain separate. The overall CI was still in progress on other lanes at the final check, so no whole-CI green claim is made.

Release is the separately restored original67 workflow with no probe entry. Normal67/d94 three-platform production-toolchain evidence is reused by the coordinator; this watcher did not dispatch another packaging or counterfactual measurement.

STATUS: CURRENT MACOS LANE PASS. ORIGINAL MCP20 / WORKSPACE45 / FULL12 INTERACTION / ALL ELIGIBLE STEPS SATISFIED. NO WINDOWS OR WHOLE-CI CLAIM.
