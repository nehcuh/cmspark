# Independent Windows acceptance —PR826 0666fc8d

VERDICT: directed Windows native PASS; Windows census FAIL at CPU compiler gate. Overall Windows integration is not accepted. All statements below use this exact run, with no rerun/cancellation/source modification.

## Identity and terminal jobs

Head0666fc8d066ec6a0941c5edec865063a30692cf9, CI41521066023 attempt1. Windows-native125536906590 completed SUCCESS, no failed step or `not ok` anywhere in the complete job. Windows census125536906500 completed FAILURE in Desktop build helper controls (#480); its full canonical census was skipped.

## Directed actual Windows evidence

Three new CPU cases are actual PASS/non-skip:

| Case | Duration ms |
| --- | --- |
| Snapshot generator/EOL |131.2302 |
| Actual native worker/file reader/control case |15020.932 |
| Actual callback error/cleanup priority |38.6364 |

The actual worker case includes the reviewed unconditional live-child control: Windows Node inherits the two regular file fds, IPC ready precedes actual removal of its complete owned output directory, the still-running child then late-writes and naturally closes, and retained fds must return exact READY/LATE bytes. TAP success follows these assertions and original cleanup. Thus the Windows platform deletion control actually passed on this VM; this is stronger than only citing share-delete semantics. Helper batch298:296 PASS/0 FAIL/2 unrelated SKIP.

Original MCP20-second business case actually passes7409.7006ms: all eight phases, successful matching navigation/status0, requestMask7, three windows, approve/deny/done/exited true. Actual independent snapshot is `{status:"UNKNOWN"}`. No sampling-state or historical-cause conclusion follows from that UNKNOWN result.

Activity step actually runs9/9 PASS,0 FAIL,0 SKIP. Apps real PS201/4096/4097 producer9671.0409ms; real visible/minimized/hidden/no-window process/foreground case10463.2133ms; original #758 real passive pixels/local OCR/refusal/notification PASS. scope825 real main/independent two-column case27036.1651ms passes original local title OCR, mismatch refusal, content-only crop/model pixel seam, embedded image, resize refusal, popup profile/extraction, pending-image cleanup and original child-close/directory/lease cleanup. This is the explicit extraction pixel seam, not a claim of a cloud model call. Later directed stages also pass.

## Actual INITIAL positive history

`D825_SCOPE_INITIAL` is schema1/OBSERVED with true points RUN_ENTER, SOURCE_INITIALIZED, LOADED, CONTENT_RENDERED, READY_WRITTEN, ACTIVATE_TRUE, FOCUS_TRUE, NOT_RENDERED and QUALIFIED.

These are past observed events/branches on the original thread, not a final snapshot. NOT_RENDERED and QUALIFIED coexist validly as different earlier/later checks. Missing NOT_FOREGROUND, NO_KEYBOARD_FOCUS or RUN_RETURN proves nothing about whether they ever occurred. No OS/SDK historical root cause is inferred.

## Census actual failure and counts

Case37 actual worker test fails24395.716ms at the unchanged20000ms compiler invocation: spawnSync cl.exe ETIMEDOUT, .mjs153:16 / assertion156:11. Finite file-fd compiler logs now show warning C4244 in the CPU wchar-to-char utf8 leaf (probe.cpp124) and template context notes; they show no Cxxxx error or fatal compiler diagnostic. The warning must not be mislabeled as the rejection cause. Actual error remains the bounded compiler timeout, preserved through cleanup.

Census generator case36 PASS99.6559ms and callback guard case38 PASS32.7501ms. Helper batch298:295 PASS/1 FAIL/2 SKIP. Full canonical census, including new8 readiness cases, was skipped and has no actual total/targeted result. No native-pass result from the separate VM overrides this failure or identifies its physical compiler cause.

Evidence: /tmp/cmspark-826-windows-native-0666fc8d.log, /tmp/cmspark-826-windows-census-0666fc8d.log, /tmp/cmspark-826-windows-0666-watch.log. Only terminal job logs downloaded using actions/jobs/ID/logs. No new full-repository audit or unrelated hash replay.
