# Independent actual Windows CI acceptance —PR826 fc4a2546

VERDICT: FAIL at the new snapshot CPU test's compiler/setup gate. Actual native MCP/snapshot/activity acceptance and full census were NOT_EXECUTED. No Windows runtime root cause or successful snapshot is inferred.

## Exact identity and final jobs

PR826 source fc4a2546a09f96c5afb6de3192e3388659a65118; CI41513532283 attempt1. Windows-native job125511131327 and Windows census job125511131206 both completed FAILURE in Desktop build helper controls (#480). Both subsequently skipped Build native desktop fixtures, original #480/MCP execution and Actual passive activity capture and local OCR (#758). Full canonical Windows census was skipped. Census's later isolated diagnostic step also failed after these missing prerequisites; it does not supply a successful census baseline.

No rerun, cancellation, source/config mutation or incomplete-job log download was performed. Job metadata was observed at45-second intervals; only terminal logs were downloaded.

## Actual first evidence

The new case37, `825 actual native worker/file reader distinguishes same-wire schedules, coherent publication, nested dispatch and UNKNOWNs`, failed on both fresh Windows VMs.

Census VM preserves the earlier test-body error: `spawnSync cl.exe ETIMEDOUT` at scripts/tests/desktop-mcp-snapshot-825.test.mjs:141:91, where the actual compiler result's error was expected to be undefined. The actual MSVC call uses its original20000ms spawnSync bound; case duration28714.4652ms. No MSVC Cxxxx compilation diagnostic is present in this reported failure. The evidence identifies an unsuccessful bounded compiler invocation, not the compiler/linker's internal physical cause.

Native VM's reported error is EBUSY while removing the owned temporary root at the test's finally rmSync, same file:199:14, duration27841.6873ms. That cleanup failure can replace a preceding test-body failure, so this lane alone does not reveal its earlier body error. Post-job cleanup explicitly terminates surviving vctip and link processes. The counterpart VM proves the reachable compiler timeout; it does not establish the masked native-VM body error or which process held the directory.

## Snapshot CPU case results and counts

The generator-only new case36 (`825 MCP snapshot generator restores exact bytes and one original call/outer-dispatch consumer under all EOL pairs`) actually PASSes on both Windows VMs,101.652ms native and125.722ms census. The actual worker/file-reader case fails before obtaining a successful compiler result, so there is no actual schedule discrimination/file receipt result from Windows on this run.

The containing build-helper TAP batch on each VM is297 tests:294 PASS/1 FAIL/2 SKIP. Earlier independent TAP batches are147 PASS and58 PASS. These are prerequisite-step counts, not full canonical census totals. Canonical census has no actual count because it was skipped.

## Required native boundary

- Original MCP20-second business case: NOT_EXECUTED.
- New native snapshot: no actual emitted OBSERVED/UNKNOWN sample; worker execution was not reached by the successful-compile gate.
- Subsequent Activity9 cases: NOT_EXECUTED, step explicitly skipped.
- No source-level claim about HRESULT, callback delivery, UI sender blocking or historical main failure follows from this compiler/setup rejection.

Public terminal job transcripts: /tmp/cmspark-826-windows-native-fc4a2546.log and /tmp/cmspark-826-windows-census-fc4a2546.log. Current-run observation log: /tmp/cmspark-826-windows-fc4a-watch.log. All reported paths and error categories are sanitized; no sealed artifact or credentials were accessed.
