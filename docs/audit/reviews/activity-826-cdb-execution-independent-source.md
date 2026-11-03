# #826 final CDB tool-preparation adjustment — independent source gate

**VERDICT: APPROVE the final frozen two files for the actual GLM source gate.** No supported blocker found. This is the last bounded diagnostic-tool preparation adjustment under the parent's coordination decision, not a source fix for MCP20, Windows qualification or a dispatch/acceptance approval.

Reviewed only the complete affected delta and actual focused consumers, with the already-approved design/source context reused. `/tmp/cmspark-826-cdb-execution-implementation.md` and `.diff` bind the author handoff. Final independently matched hashes:

- Collector `companion/scripts/mcp-stack-capture-826.cjs`: `4d000b443a63a1aff6e28d57c3be0c14c1599d57867e994c3f51bea5b6d93a2e`.
- Focused test `companion/scripts/tests/mcp-stack-capture-826.test.cjs`: `3ba6aa90f9de54118f119079ebc3b5f1a1de92785845e34d618341e616c75606`.

No shared source/config edit, API/model invocation, Windows/CDB/native UI launch or dispatch/retry occurred. Only private `/tmp` controls were written. No whole-branch review/design was reopened.

## Source assessment

The actual bounded producer now returns exactly its original `ok`/private stdout/stderr plus `toolOutcome` and `exitCode`. Outcomes are the six fixed literals OK,TIMEOUT,OUTPUT_LIMIT,ERROR,NONZERO_EXIT,SIGNALLED. Qualification alone defaults NOT_RUN/null before execution.

The timer, cap and actual-process error call the same first-invalid refusal path. Once invalid/done, later events cannot replace that first outcome or issue another kill. A timeout/overflow followed by an error and close0 therefore remains a failure. The original useful-work/actual-close distinction remains: an actual PID still waits for close after the kill request. No-process spawn error may finish immediately.

`finish` now receives a separate `actualClose` flag only from the child close callback. An exitCode is copied only when that flag is true and the close code is a safe integer; otherwise it is null. Error.code, proposed kill status and raw signal text are never substituted. A normal nonzero close retains its code; a signal produces the fixed SIGNALLED label/null rather than leaking its signal string.

Qualification copies only the two declared metadata fields, restricts the outcome to the fixed set, and accepts only safe integer codes or null. It does not spread captured/raw/error objects. Actual producer success/failure fixtures are compared with real produced results, and the actual qualifier consumes the actual producer in the new integration control, avoiding the previous stale-payload issue. All parser/qd-pong/dummy-close/workspace-cleanup positives and first-failure stoppedAt semantics remain.

**Only the pre-business CPU qualification CDB useful-work window is deliberately widened6000→120000ms.** This is an explicit new preparation measurement budget, not unchanged timing or an MCP repair. The runner waits for this qualification before launching the actual original test child. Source/actual tests retain post-timeout CIM3000/native6000/browser6000, ready2000/pong1000 and original MCP20000 registration/snapshot. No retry, new command, tool path, symbol network, raw stderr artifact or cleanup deadline was added. Required teardown can follow configured work expiry; neither120s nor prior15s is claimed as a hard total wall time.

## Independent machine evidence

Node22.23.4 via nvm.

1. Complete actual affected CJS suite:
   `node --test companion/scripts/tests/mcp-stack-capture-826.test.cjs`
   **17 PASS /0 FAIL /0 CANCEL /0 SKIP**,3.215s. `/tmp/cmspark-826-cdb-execution-b-tests.log`.
   Covers actual six-class producer, no-process ERROR/null, actual close17, signal/null, invalid code/null, first-timeout/cap survival after error/close0, actual held-close fence, fixture-to-producer shape comparison, actual-producer→qualifier success, early NOT_RUN/null, privacy, all prior stoppedAt/cleanup controls and unchanged owned-process/hybrid post-timeout budgets.
2. `/tmp/cmspark-826-cdb-execution-b-controls.cjs` and `.log`: **2 additional actual producer→actual qualifier failure controls PASS**.
   - TIMEOUT followed by actual close0 remains UNKNOWN/CDB with toolOutcome TIMEOUT and exitCode0. It cannot become a positive qualification.
   - NONZERO_EXIT17 remains UNKNOWN/CDB with that actual code17.
   Both require actual dummy close, retain parser/detach false, expose no raw private stdout/error values, and observe the actual qualification call's120000ms option. Only the inert OS/process leaf shortens its simulated expiry to8ms so the control does not sleep120s. No real Windows/tool timing is claimed.
3. Exact two frozen hashes and scoped diff-check PASS. Explicit baseline diff of runner MJS, existing MJS tests, Release/canonical CI, actual native host/launcher and original MCP TS is empty. Their valid prior opinions/results are reused. In particular, unchanged MJS6/original real Node20000ms classifier was not needlessly repeated.

## Disposition

**APPROVE** for one actual GLM incremental source gate. After that, a separately authorized changed-helper Windows run may establish the actual tool outcome/exit and possibly qualify the original MCP attempt. Source/CPU evidence here cannot do so.

The old9329 CDB stop remains a CDB execution-group failure of unknown class; this patch is not proof it was the6s timer. Four historical NOT_RUN receipts remain, with zero original MCP physical attempts/target stack samples so far. Per the parent's explicit bounded plan, the next actual result is followed by retirement of the temporary probe; no further120s expansion or diagnostic framework is authorized here. Tool unavailability must remain an honest NOT_RUN/tool limitation and must neither replace nor excuse the original product's necessary CI acceptance. Any original MCP20 canonical failure stays a blocker; another lane or a diagnostic result cannot override it.
