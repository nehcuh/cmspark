# #826 independent Windows acceptance — f3edcae6

Final result: **NOT ACCEPTED**. Both Windows jobs failed first at the original unchanged MCP20000ms native case. New activity failure reasons/Apps stages were not reached. No unchanged rerun, cancellation, dispatch, source edit, extra observation or probe was performed.

PR head `f3edcae61c88acfe7e58e6449b24c1fe8792f626`, canonical CI41538438219 attempt1. Metadata observed at45-second intervals; each job log downloaded only after its individual terminal status.

| Lane | Job | Result | First failure |
| --- | --- | --- | --- |
| Directed native |125596139419 |FAILURE |MCP20000ms timeout |
| Independent census VM |125596139269 |FAILURE |MCP20000ms timeout |

Actual logs `/tmp/cmspark-826-windows-native-f3edcae6.log`, `/tmp/cmspark-826-windows-census-f3edcae6.log`; same stems with `-metadata.json` retain final job metadata.

## Both VMs: early and CPU paths passed

Both actually passed the full early151-test NSIS/workflow/Node-security command with0FAIL/0SKIP. Desktop helper batch301:299PASS,0FAIL,2 unrelatedSKIP. Standard test-fixture build and test TypeScript preparation succeeded on each VM. The failures are not compiler Cxxxx, private artifact rejection or Release inventory errors.

Explicit post-build actual CPU worker/file-reader consumer:

- Native: **PASS/non-skip1143.5241ms**.
- Census VM: **PASS/non-skip1221.2925ms**.

The unchanged full runtime executes source/input/target/binary artifact verification, all same-wire/native worker/reader schedules, publication/UNKNOWN, full-width identity and real live-descendant file-fd whole-directory removal/late-write checks. These are actual Windows results after standard compilation, not the early controlled compiler leaf and not a replacement for later native business.

## Common first failure: original MCP20

`#476 actual native MCP form + OS-only confirmation approves update/add and denies update` (case24):

- Native **20004.0878ms**.
- Census **20004.6301ms**.

Both report `testTimeoutFailure`, `ERR_TEST_FAILURE`, `test timed out after20000ms` at compiled `desktop-native-mcp-476.test.js:56:25`. Node records this kind of failure under cancelled, so a batch fail0 counter is not a passing batch.

Both actual progress projections have authenticated/windowRequested true, requestmask0, only ready_accepted/env_callback phases, navigation null, windows0, approved/denied/done false and native child not exited at progress projection. There are six bootstrap rows. Native records environment callback around bucket9 and API/wrapper return around11; census around14 and18 respectively. These are native-first-hook250ms buckets, not Node case start or shared cross-process time.

Each independent snapshot is **OBSERVED**, with the same closed values:

```
{"status":"OBSERVED","sampleOffsetMs":2,"version":108,"flags":751,"envHr":0,"controllerHr":0,"callbackHr":0,"callbackPresent":0,"sendKind":2,"sendSite":5,"sendEdge":1,"sendStage":6,"sendResult":0,"sendResultKnown":true}
```

Actual flags751 includes EnvApi, EnvLeave, ControllerApi, WrapperLeave, OuterDispatch, Armed, EnvEntry and SendReturned. Therefore at that single coherent sample the relevant API-return and environment-wrapper/outer DispatchMessage-return markers occurred; the last bootstrap diagnostic send returned. ControllerEntry/ControllerLeave flags are not set in the sample. Do not extend that fact into the20s deadline state, SDK-internal cause, permanent absence of a future callback or an input/focus failure. No new sample or causal inference is added.

## Per-lane subsequent outcomes

Native bootstrap batch38: **25PASS,0FAIL,1CANCELLED,12 platformSKIP**. Its later real Windows binding/WebView metadata case passed, as did the remainder of that batch; this does not repair the earlier MCP failure. The bootstrap step exits1 and subsequent interaction/Activity/canonical stages are skipped.

Census bootstrap batch38: **23PASS,0FAIL,3CANCELLED,12 platformSKIP**. After the MCP first failure, two more cases in the same batch timed out:

- Case26 `real Windows binding noninherited bootstrap and minimal parent handle authenticate native WebView2 and metadata`: **20005.7558ms**. Its deadline projection is waiting-metadata, ready/env phases only, navigation null, no read families and child not exited.
- Case32 `actual Windows acceptance visual: real owned window/engine/lifecycle`: **20083.3082ms**. This is another observed timeout, not a separately established physical cause.

Later hostile acceptance in the same census batch passed11604.561ms. Mixed outcomes do not justify declaring a particular OS/SDK problem or treating prior failures as noise. The later always-run module-scope diagnostic is consequent baseline-incomplete evidence, not the first failure.

## Not reached

Neither VM executed the changed Apps/scope activity native step. Thus there is no actual new Apps timeout stage/six-point projection, no new scope exact reason, no scope full9-case/title/crop/model/embedded-image/resize/popup success, and no native activity fixture compilation/input result for this head. A combination reason such as PRECONDITION/WINDOW cannot be guessed; there is no reason receipt at all here.

The complete canonical census did not start. No complete leaf total, canonical19 new source-control result or old metadata/helper canonical case result exists for this run. TypeScript preparation is not execution of those controls. Earlier d94 canonical results are archived in their own immutable report and are not silently substituted for f3ed acceptance.

The one previously dispatched60s MCP diagnostic is separate NON_ACCEPTANCE measurement, not part of this report and not credited toward the unchanged20s gate.

## Decision

The exact changed head remains blocked on canonical MCP20 native completion before activity acceptance. Preserve both failures and their finite sample facts. This run supplies no evidence supporting an Apps/scope business modification or another observation layer. Any next experiment or contract reconsideration requires its own concrete supported decision; no automatic budget extension or unchanged CI rerun is approved by this review.
