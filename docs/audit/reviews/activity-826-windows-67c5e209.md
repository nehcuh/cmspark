# #826 independent Windows CI acceptance — 67c5e209

Result: **NOT ACCEPTED**. Both new Windows CPU build/runtime paths passed, but the two independent Windows jobs failed at different original native gates. Neither VM's success is substituted for the other's failure. No rerun, cancellation, source/configuration modification or expanded audit was performed.

Head: `67c5e209d239995b930fe1dfcc54f444005e44f8`; CI run `41529697607`, attempt 1; PR826. Observed metadata at 45-second intervals; each individual job's log was downloaded only after that job completed.

| Lane | Job | Final result | First actual failure |
| --- | --- | --- | --- |
| Windows directed native | 125566390561 | FAILURE | scope initial ready receipt timeout |
| Windows census VM | 125566390442 | FAILURE | original MCP 20000 ms native case timeout |

Logs: `/tmp/cmspark-826-windows-native-67c5e209.log` and `/tmp/cmspark-826-windows-census-67c5e209.log`. Final job metadata: same stems with `-metadata.json`.

## CPU separation: actual Windows result on each VM

Both VMs passed early Desktop build helper controls: **301 tests, 299 PASS, 0 FAIL, 2 unrelated SKIP**. Windows early helper no longer registers the actual CPU runtime case. Both then passed standard test-fixture build and compiled tests, followed by the explicit post-build consumer in the original bootstrap command.

Actual case `825 actual native worker/file reader distinguishes same-wire schedules, coherent publication, nested dispatch and UNKNOWNs`:

- Directed native: **PASS, non-skip, 4816.3724 ms**.
- Census VM: **PASS, non-skip, 1234.1112 ms**.

These executions consume the actual standard-build private artifact; the frozen current consumer requires exact source/input/target/manifest/binary identity and has no runtime compilation fallback. Passing this full case means its actual nine C++ schedules, same-wire comparisons, publication/UNKNOWN controls, full-width receipt identity assertions, real live-descendant whole-directory removal plus late-write assertions, asset checks and cleanup all executed. This is actual Windows evidence for the structural split, not the earlier controlled compiler leaf used by the early handoff controls.

The declared boundary remains compilation under existing 120000 ms build contract and 30000 ms runtime-only case, with each executable capped at 6000 ms. This does not restore the previous end-to-end compilation boundary or establish the internal cause of the old compiler timeout.

## Directed native: MCP passed, scope INITIAL failed

Bootstrap batch: **38 tests, 26 PASS, 0 FAIL, 0 CANCELLED, 12 platform SKIP**. The original MCP case passed in **11229.9708 ms** at its unchanged 20000 ms budget. Its actual receipt reports all eight phases, successful navigation, request mask 7, three windows, approval/denial/done true and native child exited. Business summary records approved 2, denied 1, persisted true. The snapshot was UNKNOWN in this successful case and is not interpreted further.

Interaction acceptance also passed: **12 PASS, 0 FAIL, 0 SKIP**.

Activity batch: **9 tests, 8 PASS, 1 FAIL, 0 SKIP**. Actual successes include:

- Real PowerShell producer 201/4096 preservation, foreign/protected exclusions and 4097 refusal: **10237.7407 ms**.
- Actual process identity stable across visible/minimized/hidden/no-window, foreground unchanged and exited process removed: **11945.3795 ms**.
- Original #758 passive capture/local OCR/minimized-or-occluded refusal: **10303.6398 ms**.

First failure is `scope825 real Windows two-column chat gates local title, crops sidebar, keeps embedded image, and supports owned independent windows`, **10193.6509 ms**:

```
OWNED_SCOPE825_RECEIPT_TIMEOUT_INITIAL
Timeout.<anonymous> (.../helpers/activity-scope825-native.js:45:20)
```

Actual fixed positive-history projection:

```
{"schema":1,"status":"OBSERVED","points":{"RUN_ENTER":true,"SOURCE_INITIALIZED":true,"LOADED":true,"CONTENT_RENDERED":true,"ACTIVATE_FALSE":true,"FOCUS_TRUE":true,"NOT_RENDERED":true,"NOT_FOREGROUND":true}}
```

This locates the current wait as INITIAL, not resize or popup. It proves the observed initial calls/events occurred, Activate returned false, Focus returned true, and an actual readiness check observed a non-foreground condition. NOT_RENDERED and CONTENT_RENDERED are compatible historical observations from different checks. It does not identify the foreground competitor, prove continuous non-foreground state throughout ten seconds, or establish an SDK/OS physical cause.

The scope business path had not reached ready, so actual OCR/title/crop/model/sidebar/embedded-image/resize/popup and pending-clean success cannot be claimed for this run. The failure's finally reached the child-close-before-projection point; the original initial timeout remained the reported error, with no later cleanup error replacing it. Normal post-projection removal and lease settlement completed without a separately reported failure. This is cleanup evidence, not business acceptance.

## Census VM: MCP timeout after the new CPU consumer passed

The first failure is original `#476 actual native MCP form + OS-only confirmation approves update/add and denies update`, **20022.6847 ms**, `testTimeoutFailure` / `ERR_TEST_FAILURE`, `test timed out after 20000ms` at compiled test registration line 56. It is a native case timeout, not a compiler Cxxxx error or a failing CPU-artifact check.

Bootstrap batch is **38 tests: 25 PASS, 0 FAIL, 1 CANCELLED, 12 platform SKIP**. Node reports this timeout as a cancelled test, hence the zero fail counter does not mean this batch passed. Process exits 1.

Current actual MCP progress: authenticated/windowRequested true, request mask 0, ready/env phases only, no navigation, no windows, approvals/denial/done false. Six closed bootstrap rows were received:

```
[[5,1,0,0,0,2],[6,1,0,6,0,2],[6,1,2,6,0,1],[7,1,0,6,0,2],[7,1,1,8,0,2],[5,1,1,8,0,2]]
```

Actual independent snapshot is now **OBSERVED**:

```
{"status":"OBSERVED","sampleOffsetMs":1,"version":108,"flags":751,"envHr":0,"controllerHr":0,"callbackHr":0,"callbackPresent":0,"sendKind":2,"sendSite":5,"sendEdge":1,"sendStage":6,"sendResult":0,"sendResultKnown":true}
```

Against the actual C++ flag definitions, flags751 contains EnvApi, EnvLeave, ControllerApi, WrapperLeave, OuterDispatch, Armed, EnvEntry and SendReturned. ControllerEntry/ControllerLeave are not set in this coherent sample. Thus at this single sampled moment, the API-return markers, environment-wrapper leave and original outer DispatchMessage return marker had occurred; the last diagnostic send had returned (stage6/result0). The sample is not a deadline snapshot and cannot prove controller callback absence after sampling, SDK internals or a unique historical root cause.

All subsequent interaction/Activity/canonical census gates were skipped because the bootstrap step failed. The later always-run module-scope diagnostic reports `BASELINE_INCOMPLETE` / `NOT_OBSERVED`; it is consequent, not the first failure. No complete canonical leaf total, new Mac6, scope readiness8, or canonical new CPU consumer result exists on this VM. Only its explicitly directed post-build CPU result above is accepted.

## Decision

The compiler/build separation achieved its actual Windows objective on both independent VMs. Full Windows acceptance remains blocked by two real original native failures: census MCP and directed-native scope INITIAL. Preserve original gates and inspect a supported causal path before proposing a fix; do not rerun unchanged CI, extend deadlines or infer causes from absent/late observations.
