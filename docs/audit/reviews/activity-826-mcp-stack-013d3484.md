# #826 one manual stack experiment — independent actual result

**Disposition: experiment bootstrap FAILED; actual CDB qualification NOT_RUN; original MCP20 business NOT_RUN; no physical stack observation.** No fix, retirement or further dispatch is authorized by this receipt.

Run [41560307958](https://github.com/nehcuh/cmspark/actions/runs/41560307958), event `workflow_dispatch`, exact head `013d3484f862c14ddb5df2bb5a250ba8b987b2f2`. Created01:31:43Z on2026-11-03. Final overall result FAILURE. The gated experiment job actually started and package/publication skipped, positively confirming the reviewed explicit-true route was selected; the run metadata does not independently expose the raw dispatch request payload.

## Exact actual gates

| Job / step | Actual result |
|---|---|
| Normal preflight125669078085 | SUCCESS,01:31:46–01:38:05Z |
| Probe125671307929 | FAILURE,01:38:08–01:41:51Z |
| Locked companion install/current build | SUCCESS |
| Build original native test fixtures and compile actual tests | SUCCESS |
| Verify derived callback, collector and release controls | FAILURE:17 PASS,1 FAIL,0 CANCEL,0 SKIP |
| Qualify CDB and run one original20 post-timeout experiment | SKIPPED |
| Safe JSON upload step | SUCCESS with no matching files; artifacts API total_count0 |
| Package matrix job125671309806 | SKIPPED |
| Publish125671309876 | SKIPPED |

[Probe job](https://github.com/nehcuh/cmspark/actions/runs/41560307958/job/125671307929).

## Actual first failure

Test17, `manual probe workflow conserves complete original normal/tag release and never packages in probe mode`:

- `failureType: testCodeFailure`, `ERR_ASSERTION`.
- `assert.ok(begin > 0 && end > begin)` evaluated false.
- Actual stack location `companion/scripts/tests/mcp-stack-probe-826.test.mjs:115:10`.
- Source uses literal-LF `text.indexOf('  mcp-stack-probe-826:\n')` and `text.indexOf('  release:\n',begin)` to locate the raw workflow span. A CRLF checkout is a concrete source-supported candidate for this boundary failure; this observation task did not modify or reproduce it and does not label it a proven Windows OS/SDK cause.

The collector's12 controlled-leaf cases all actually passed on this Windows job, including the final3100ms held dummy-close control and live-PID/no-PID error cases. Those are explicitly CPU/source controls, not actual CDB qualification. The actual emitted-MCP derivation/inverse, drift refusal and exclusive sibling control also passed. Test16's real Node20000ms timeout-classification control passed20445.7316ms; **that inert classifier case is not execution of the native MCP business**.

The original source review missed Windows raw-workflow EOL coverage in this new unit. This is a test-harness regression in the experiment's own early gate; it is not evidence that the old MCP20 problem changed.

## What was not reached

- No call to the actual Windows `qualifyCdb826` stage: no installed-tool/signature qualification, vendor clean-stack record, real parser qualification, `qd` IPC pong or actual qualification dummy close receipt exists for this run.
- No actual derived MCP test execution, no new MCP20 PASS or timeout, no original MCP cleanup/business receipts, and no native/browser capture JSON.
- No artifact was available (`total_count:0`). No raw debugger output/private material was downloaded or inspected. The terminal job log contains only build/control/TAP/bootstrap information because the debugger stage never ran.

Consequently, this run contributes **zero native MCP business attempts and zero physical stack samples**. The pre-existing canonical failure and its release/main blockers remain in force. Native-pv/browser-pvr ordering and post-timeout interpretation are not instantiated by this run.

## Observation evidence and boundaries

45-second metadata watch verified exact identity and waited until terminal before downloading the single probe job log. No rerun/cancel/dispatch, additional probe, model call, source edit or native call was performed.

- Final metadata: `/tmp/cmspark-826-mcp-stack-013d3484-metadata.json`.
- Actual terminal job log: `/tmp/cmspark-826-mcp-stack-013d3484-job.log` (no CDB stage ran).
- Watcher: `/tmp/cmspark-826-stack-watch-013d.mjs`, now terminated after final result.

**Final: NOT_RUN for CDB and original MCP20. Await the parent's disposition of the concrete experiment control failure; do not infer a root cause or automatically rerun.**
