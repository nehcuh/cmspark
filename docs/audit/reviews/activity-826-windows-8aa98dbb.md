# #826 independent Windows acceptance — 8aa98dbb

Final result: **NOT ACCEPTED: both jobs failed only in the two identified source controls; the original native business9/9 passed in its directed lane**. No CI rerun/cancellation/dispatch, source edit or additional native probe by reviewer.

Exact PR head `8aa98dbb2b65041b92c9d847c95dd616efaa3d8d`; canonical CI41542987860 attempt1. Directed-native125611508524; census125611508516. Metadata polled45s; each terminal job log downloaded only after its own completion.

## Directed-native job — FAILURE, original business9/9 passed

Actual log `/tmp/cmspark-826-windows-native-8aa98dbb.log` and matching terminal metadata. Early gate176PASS/0FAIL/0SKIP; helper batch301=299PASS/0FAIL/2 unrelatedSKIP; standard test-fixture build and complete TS preparation succeeded.

Activity-first selected batch: **28 tests,26PASS,2FAIL,0CANCELLED,0SKIP**. Separate the groups correctly:

- Original business batch: **9PASS/0FAIL/0SKIP**, including its five CPU identity/parser controls and **four actual Windows native cases**.
- New actual-source controls: **17PASS/2FAIL/0SKIP**. They are not19 native business cases and did not all pass.

Four actual Windows cases, non-skip:

| Case | Result/duration |
| --- | --- |
| PowerShell Apps201/4096 preservation, foreign/protected exclusions,4097 refusal |PASS8834.7516ms |
| Apps GUI/minimized/hidden/no-window identity, foreground unchanged, process exit |PASS10274.4299ms |
| Original#758 owned passive capture/localOCR/minimize or occlusion refusal |PASS9097.5338ms |
| scope real two-column title/crop/image/main+independent-window/business |PASS25459.4861ms |

Actual Apps positive-history projection:

```
{"gui":{"schema":1,"status":"OBSERVED","points":{"MAIN_ENTER":true,"RUN_ENTER":true,"SOURCE_INITIALIZED":true,"LOADED":true,"CONTENT_RENDERED":true,"READY_WRITTEN":true}},"headless":{"schema":1,"status":"OBSERVED","points":{"MAIN_ENTER":true}}}
```

All current Apps launch/control/lifetime/foreground assertions passed. No timeout stage is emitted on success; headless's single main-entry point is its intended shared history, not a missing GUI phase.

Actual scope business summary:

```
{"capability":"scope825","windowsNative":true,"mainAndIndependent":true,"sidebarDecoyRefused":true,"localOcrAndCrop":true,"modelSidebarAbsent":true,"embeddedImagePreserved":true,"resizeRefused":true,"pendingCleaned":true}
```

This case actually exercised native preview pixels/local titleOCR, title-mismatch refusal before model, cropped saved/model-input seam pixels without sidebar, embedded image preservation, changed-layout refusal, independent popup profile, no pending artifacts and original child/lease cleanup. The model assertion is the established extractImage input seam, not a claim of a remote-cloud model call. Existing passive foreground and all original180s/receipt10s constraints stayed in force.

Scope fixed history is OBSERVED with RUN_ENTER/SOURCE_INITIALIZED/LOADED/CONTENT_RENDERED/READY_WRITTEN/INPUT_COMPLETE/NO_KEYBOARD_FOCUS/QUALIFIED true. These are compatible points from different actual checks: input completion is not readiness, and a later qualified check/ready publication occurred. No exact input failure reason is emitted because setup succeeded.

## Actual first and second failures: source-harness Windows paths

Case10 `826 actual receipt retains failure priority, parse/close/abort behavior and listener cleanup`:15.5445ms, ERR_ASSERTION Missing expected rejection, compiled activity-failure-observation-826.test.js92 (the fail.start assertion).

Case12 `826 actual Apps finally projects both fixed folders only after close and preserves primary errors through projection faults`:2.5049ms, deepEqual expected POSIX `project:/owned/gui`/headless versus actual Windows backslash folders.

The actual test harness passes host node:path while storing `/owned/failure.json` and `/owned/ready.json` literal Map keys. On Windows the real receipt builds a backslash failure path; it fails to find that Map key, then resolves the existing literal ready key, correctly tripping the original priority assertion. The second failure is the same path-representation assumption in expected trace strings. This does not establish a failure in the actual receipt/finally or in the native business that passed above.

Independent immutable8aa actual-callback reproduction confirms both RED under path.win32 and GREEN under path.posix; changing only derived test keys/expectations to the same root's path.join gives GREEN under both. All original predicates and source consumers stay unchanged. Detailed evidence `/tmp/cmspark-826-path-harness-independent-repro.md`, `.mjs`, `.log`.

The step exits1. Native bootstrap/MCP20, post-build CPU runtime, interaction and later gates are skipped. Standard privateCPU compilation passed as part of build, but no native-lane actual CPU runtime or MCP success is claimed for this head. The earlier native input history is intentionally changed by Activity-first; no physical MCP-cause claim is made.

## Census125611508516 — terminal FAILURE, two actual source-control failures

Terminal log `/tmp/cmspark-826-windows-census-8aa98dbb.log`. Explicit post-build actual CPU runtime passed **1119.7245ms** and original MCP20 business passed **7630.6912ms**. Bootstrap and interaction succeeded; the full census then actually executed.

Public artifact13188393393 was downloaded to `/tmp/cmspark-826-census-8aa98dbb-public.zip`. Only finite publicJSON was inspected, no sealed/raw-log decryption. Identityrun41542987860/attempt1 matches. GitHub checkout merge890126405996dce5e4e1e272c79e0eddbf2fef29 has tree4b7371043d4d1a940467d419d00f46a00073c3e3, independently equal to actual8aa head tree.

Actual canonical leaf accounting: **9538PASS,67SKIP,2FAIL**,155 suite rows. Inclusive rows9693PASS/67SKIP/2FAIL. execution_complete=true, tests_exit1, outcomeFAIL; complete=false because the settings file did not run after main failed. File states:750 emitted_completed,1 failed,1 not_run_because_main_failed. These partial-after-main counts are not represented as complete passing coverage.

The **only** two failed public case hashes were independently matched to exact immutable8aa source titles:

- `826 actual receipt retains failure priority, parse/close/abort behavior and listener cleanup`:15.8796ms, namehashb444301bf9fbaefa066e1280f1af23ffb41e8ff8c6b25035b51ec90e8d31d8f8, compiled line88.
- `826 actual Apps finally projects both fixed folders only after close and preserves primary errors through projection faults`:2.8136ms, namehash94b6439c77668c1cbd19670288af9550464bd9767a0b1e40f04a190a6ff8ca1e, compiled line163.

Both are OBSERVED testCodeFailure/ERR_TEST_FAILURE in public accounting. They are the same two source-harness cases as the native-lane failure and independent win32/posix reproduction; no additional failure is invented from expectation. Raw error text is not publicly exposed or decrypted here.

Current scope13 source controls allPASS; focused source group4PASS/2FAIL. Canonical CPU consumer and MCP case bothPASS/non-skip. Apps file6PASS/1 nativeGUI SKIP and scope native1SKIP reflect original complete-census native-activity enablement, so the real native scope proof comes from the directed9/9 result above, not a census skip.

Sanitized actual accounting: `/tmp/cmspark-826-census-8aa98dbb-sanitized.json`.

## Final interpretation

8aa supplies full successful native Apps/scope/capture/producer business and positive history with original budgets/cleanup; it is nevertheless red because the two real source controls fail. The subsequent single-test-file path correction is independently reproduced/reviewed elsewhere and does not rewrite this historical outcome. The newer273 head has its own independent gates; no old lane or source model substitutes for them. No rerun, timeout change or probe is authorized by this receipt.
