# Independent actual macOS receipt — 273c1aff

Exact head `273c1aff4775a94a7ad30f6e60cb755efd85311d`; [canonical CI41544992491](https://github.com/nehcuh/cmspark/actions/runs/41544992491), attempt1/pull_request. Actual Mac job125618296770 `smoke (macos-latest)` **COMPLETED / SUCCESS**,23:23:09Z–23:30:29Z.

Read-only45-second metadata polling. Only this single job was downloaded after terminal status:

`gh api repos/nehcuh/cmspark/actions/jobs/125618296770/logs > /tmp/cmspark-826-macos-273c1aff.log`

No source edit, added test/probe, rerun/cancel/dispatch or package run. Prior head passes were not used as current native acceptance.

## Actual original gates

- Early strict contracts **176 PASS0 FAIL0 SKIP**; desktop helper controls322 PASS; Mac runtime headers16 PASS; actual fixture build and both test compilations PASS.
- Front-positioned Activity step **SKIPPED** on Mac, by its retained native-Windows condition. Therefore new19 source controls/Windows9 selected cases are not counted as Mac executions. There was no new Activity setup input on this Mac lane.
- Bootstrap/process group24 PASS0 FAIL14 platform SKIP.
- Original native MCP20 case **4521.289125ms PASS**. Actual native receipt windows3/approved2/denied1/persisted=true; no human approval claim. Original full assertions and exit/cleanup succeeded.
- Original interaction group **12 PASS0 FAIL0 SKIP**.
- Original Workspace45 case **26855.603625ms PASS**: actual canonical picker/controller/persistence/reopen/list/read/second cancellation/unrelated-thread invariants all pass.

Workspace final native phase: failed=false, receiptMask1023, picks2/pickerObserved2, pickerReturned1/cancelReturned1, selectedOutcome/selectedIdentity=true, childExited=true/exitCode0, failureSite0/firstFailedAssertion0. UI receiptMask31, begun=true/invalid=false, **observerClosed=true/code0 and xcodeClosed=true/code0**.

Workspace surface: CLEANUP_ENTER26748ms; ACTION_SETTLED26853ms; RELEASE_ENTER26853ms; RELEASED26854ms; all over_budget=false. Real close and full cleanup/release stay inside45 seconds. No previous failure cause is inferred.

Remaining original native business and cleanup pass: Local4288.703209ms (RELEASED4287ms), Archive2888.032125ms (RELEASED2887ms), Terminal3783.724459ms (RELEASED3782ms), all over_budget=false. Full PTY/ACP/Unicode/stop/handback/reopen, archive/lost-ACK and denied/cancelled/partial-return business receipts are present.

## Remaining eligible lane

All eligible later steps SUCCESS: owned PTY-tail2 PASS; Office/relocated groups32 PASS2 SKIP,20 PASS,52 PASS; pure smoke39 PASS; Swift/typecheck107 PASS; external Mac AX3 PASS; authorization/process58 PASS6 SKIP plus platform-only5 SKIP; MCP/process boundaries17 PASS; ownership startup25 PASS. No failing test/eligible step.

Windows census, Registry, UIA, launcher and Activity native gates remain platform-skipped on Mac. Windows actual/current-head outcomes are separately owned and required. At final inspection the whole CI workflow was still in progress on other lanes; this receipt does not claim overall CI or release readiness.

STATUS: CURRENT MACOS LANE PASS; ORIGINAL MCP20 / WORKSPACE45 / FULL12 INTERACTION / ALL ELIGIBLE STEPS SATISFIED.
