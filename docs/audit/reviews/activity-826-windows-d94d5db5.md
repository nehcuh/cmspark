# #826 independent Windows acceptance — d94d5db5

Final status: **NOT ACCEPTED: directed native job failed; independent census job succeeded**. Each lane keeps its own result. No rerun, cancellation, dispatch, source edit or native UI action was performed by reviewer.

Exact head `d94d5db5ce30aee7d047baea53c0bc503f766461`; canonical CI41534699359 attempt1. Independent metadata polling interval45s; per-job logs downloaded only after that job completed.

## Directed native job125583455099 — FAILURE

Log `/tmp/cmspark-826-windows-native-d94d5db5.log`, terminal metadata `/tmp/cmspark-826-windows-native-d94d5db5-metadata.json`.

- Exact early NSIS/workflow/runtime contract command: **151 PASS, 0 FAIL, 0 SKIP**. The count3 Release inventory correction is actually exercised and passed here.
- Desktop build helper controls:301 tests,299 PASS,0 FAIL,2 unrelated platform SKIP.
- Standard native test-fixture build and compiled test preparation:SUCCESS.
- Explicit post-build real CPU worker/reader/artifact case: **PASS/non-skip,3043.7995ms**. Its full unchanged runtime includes same-wire schedules, real worker/reader publication and UNKNOWN, full-width identities and live-descendant file-fd whole-directory removal/late-write assertions. No early in-case Windows compilation or runtime fallback was used.
- Original MCP20000ms actual business case: **PASS,9469.267ms**, with actual native summary approved2/denied1/windows3/persistedtrue, all8phases, successful navigation, requestmask7, done/exitedtrue. snapshotUNKNOWN on this successful execution is not interpreted as failure or a historical cause.
- Bootstrap batch38:26PASS,0FAIL,0CANCELLED,12 platformSKIP. Native interaction acceptance12PASS,0FAIL,0SKIP.

Activity batch9: **7PASS,2FAIL,0SKIP**. Real PowerShell Apps201/4096 preservation and4097 rejection passed7328.5755ms. The actual original#758 passive capture/localOCR/minimize refusal passed14011.1649ms, including owned_pid/foreground_unchanged/local_ocr true.

**First failure** is Apps GUI case#7, `#825 Windows native process remains discoverable when minimized, hidden or without a window; Apps never changes foreground`,11715.153ms:

```
OWNED_APPS_FIXTURE_NOT_READY
Timeout.<anonymous> (.../activity-apps-825.test.js:157:20)
```

The actual helper's10000ms final check did not obtain ready.json. This log has no closed reason identifying which fixture prerequisite failed. Do not infer foreground, rendering, invisible window, OS scheduling or app-list behavior from this missing receipt. Later GUI state/discovery assertions were not completed.

**Second failure** is scope case#9,1123.3156ms:

```
OWNED_SCOPE825_FIXTURE_FAILED {"type":"OWNED_SCOPE825_INPUT_SETUP_FAILED"}
FSWatcher.check (.../helpers/activity-scope825-native.js:35:35)
```

Actual positive-history projection:

```
{"schema":1,"status":"OBSERVED","points":{"RUN_ENTER":true,"SOURCE_INITIALIZED":true,"LOADED":true,"CONTENT_RENDERED":true,"INPUT_REFUSED":true}}
```

This is an actual reported setup rejection, not the previous INITIAL wait timeout. The current C# catch intentionally folds the setup's fixed prerequisite exceptions and short SendInput return into this single input-setup type. These logs therefore cannot determine which guard rejected, whether SendInput was reached, or whether any event was inserted. Do not claim a particular input/ABI/occlusion cause. Scope failed before ready; titleOCR/crop/model/sidebar/image/resize/popup business success was not reached. Its original finally reached child-close-before-projection; primary setup failure remained the reported result, with no later cleanup error replacing it.

## Census job125583454978 — SUCCESS

Terminal log `/tmp/cmspark-826-windows-census-d94d5db5.log`. Standard fixture build and actual explicit post-build CPU case passed **1151.7029ms/non-skip**. Original canonical20s MCP business passed **12417.8066ms**, with all original business assertions; bootstrap/interaction steps succeeded. No60s diagnostic credit is involved.

Full canonical census completed PASS with tests_exit0, complete=true and execution_complete=true. Actual public artifact13185302247, downloaded to `/tmp/cmspark-826-census-d94d5db5-public.zip`; only public finite JSON was read, no encrypted/raw log decryption. The artifact checkout is GitHub PR merge46a4996e60a290d1367102724561b6b4d905b1b4; its tree5e648f930de5547e9b24075ffa520fb4601c21a5 is exactly the actual d94 PR head tree, independently checked with git rev-parse. Identity run41534699359/attempt1 matches this run.

Canonical leaf accounting: **9555PASS,67SKIP,0FAIL**. There are157 suite rows; inclusive rows have9712PASS and67SKIP. These counts are distinguished rather than mixing suites into leaf totals.

Actual current cases in canonical public accounting:

| File/group | Actual result |
| --- | --- |
| activity-scope825-readiness |12PASS,0SKIP |
| desktop-close-observation-826 |6PASS,0SKIP |
| desktop-mcp-snapshot-cpu-825 consumer |1PASS,1126.757ms,0SKIP |
| desktop-native-mcp-476 |1PASS,1627.317ms,0SKIP |
| desktop-thread-metadata-476 |29PASS,0SKIP |
| desktop-native-thread-metadata-476 |12PASS,0SKIP |
| desktop-workspace-xctest-705 |55PASS,0SKIP |
| activity-apps-825 |6PASS,1SKIP |
| activity-scope825-native |1SKIP |

The Apps GUI and scope native business cases are intentionally unavailable in this complete-census environment because the native-activity enablement condition is false. They did **not** run successfully in this VM; the scope/input/crop/model/resize/popup proof remains missing for the failed directed native lane. The scope12 source controls and CPU consumer above actually execute and are not skip substitutes.

Sanitized selected accounting and counts: `/tmp/cmspark-826-census-d94d5db5-sanitized.json`.

## Final decision

The inventory correction and standard-build/private CPU route passed both independent Windows VMs, and canonical MCP20 business passed on both. Complete census passed with its actual configured coverage. Full Windows acceptance nevertheless remains blocked by directed Apps GUI NOT_READY and scope INPUT_SETUP_FAILED. A successful independent VM or non-acceptance60s probe does not replace those failures. The newer f3ed head is observed separately; no result from it is silently backfilled into this immutable d94 report.
