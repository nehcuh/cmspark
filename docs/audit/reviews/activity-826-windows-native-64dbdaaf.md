# Independent actual Windows result —PR826 64dbdaaf

VERDICT: FAIL. Native VM passes all3 new CPU controls and actual MCP, then fails scope's INITIAL receipt deadline. Census VM fails the new CPU compiler gate. Neither lane is fully accepted; no rerun/cancellation/source change performed.

## Identity

Source64dbdaafda240f06cac21955e2a4a8ee163c8740; CI41516873187 attempt1. Windows-native job125522559940 and census job125522559629 both completed FAILURE. Terminal logs alone were downloaded with actions/jobs/ID/logs; no run-level log-failed or incomplete-job download.

## Native VM actual execution

All3 new CPU controls are actual PASS/non-skip:

- Snapshot generator/EOL control98.2412ms.
- Real C++ worker/file reader schedule/publication/UNKNOWN/BigInt control15771.1175ms.
- Actual callback compiler-error/cleanup-error priority control24.4096ms.

Their containing helper TAP batch is298 tests:296 PASS/0 FAIL/2 SKIP. Actual Windows fixture build then completes and the old native MCP20-second case passes8121.141ms. All eight phases, successful matching navigation, requestMask7, three windows, approve/deny/done/exited are present. Actual snapshot825 output is exactly `{status:"UNKNOWN"}`: no valid independent sample is available from this successful short-lived case. It must not support any diagnosis about the earlier MCP failure. The successful old MCP assertions and normal cleanup remain authoritative.

Activity step actually executes9 cases,8 PASS/1 FAIL/0 SKIP. Real Apps producer201/4096/4097 passes9927.1709ms; real visible/minimized/hidden/no-window Apps passes11100.5101ms; original screenshot/local OCR/refusal/notification #758 passes10028.3051ms.

The unique native-lane failure is scope825, duration10194.7115ms, error `OWNED_SCOPE825_RECEIPT_TIMEOUT_INITIAL`, stack helpers/activity-scope825-native.js:45:20. INITIAL is the actual closed stage label, not inferred from duration. The first owned ready receipt was not obtained within its original10-second bound. Subsequent preview/title OCR/content crop/model seam/resize/popup business assertions are not reached. The reason the initial render/foreground/focus qualification was not published remains UNKNOWN; the log does not isolate any particular condition. Normal finally retains this primary error; it does not supply a scope success or pending-cleanup receipt. Later lane stages are skipped after this failure.

## Census VM actual result

Census fails earlier in Desktop build helper controls (#480), case37 actual worker/file-reader test, duration27974.8257ms. The actual reported failure is ERR_ASSERTION with actual `spawnSync cl.exe ETIMEDOUT`, invocation at desktop-mcp-snapshot-825.test.mjs:147:15, assertion147:91. Original20000ms compiler bound is unchanged. Primary compiler error remains visible; no cleanup EBUSY replaces it. No MSVC Cxxxx diagnostic is reported. Its physical compiler/linker/stdio cause is not established by this failure.

Generator case36 PASS102.1383ms and new error-priority case38 PASS29.5936ms; actual worker case FAIL. Containing helper batch298 tests:295 PASS/1 FAIL/2 SKIP. Native fixture build, original native MCP/snapshot, Activity9 and canonical full census are skipped. Thus no canonical census total exists on this run. Later isolated diagnostic failure after missing prerequisites is not counted as full census evidence.

## Evidence files

- /tmp/cmspark-826-windows-native-64dbdaaf.log
- /tmp/cmspark-826-windows-census-64dbdaaf.log
- /tmp/cmspark-826-windows-64db-watch.log

Only metadata and public completed-job logs were inspected. Prior successful same-source-path evidence is retained without reopening a whole-repository audit, but it does not make either current failed lane green.
