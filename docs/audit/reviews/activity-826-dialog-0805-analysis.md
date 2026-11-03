# #826 first0805 dialog failure — narrow independent read-only analysis

**Conclusion: no confirmed supported product race was found. Actual Windows cause remains UNKNOWN.** Do not change budgets, permission gates, retry behavior or product code on this evidence. This report covers the FIRST dialog only, not Local/archive/terminal failures.

## Actual failure facts

Existing log `/tmp/cmspark-826-shipping-0805bca0-job-125714652955.log:3844` onward: original New/Send/stream/Stop/reopen case times out after20000ms (20058.9784ms). Native phase receiptMask11 = CREATED+USER+L2_DENIED; STREAMED/STOPPED/REOPEN absent. providerCalls1/userCommits1/denied1/toolEffects0, abortedfalse/droppedfalse, one authenticated connection and window requested. No D476_FAIL_DIALOG_PHASE receipt is recorded. Later resource and Workspace pass on this VM. Those do not prove anything about later unrelated failures or a physical SDK/focus cause. `childExited:false` is a finally-time sample, not an independent cause.

## Actual supported chain

- `tests/desktop-native-thread-metadata-476.test.ts:77–110` installs the controlled provider and **actual** native dialog runtime/router/L2. `helpers/desktop-dialog-l2-fixture-476.ts` sets manual skill/knowledge selection and tool_whitelist evaluate/run_progressnull, so the first tool reaches L2 rather than run-progress refusal.
- `desktop/dialog-runtime.ts:23` maps the actual executor's unavailable notification to the dialog event; it awaits real handleMessage. The already-aborted confirmation request in the hosted executor resolves denied immediately (`security-confirmation.ts:281`) without a pending confirmation or fanout. Adapter's security classification ends the first request, rather than requesting the second stream automatically.
- `desktop/dialog.ts:94–103` awaits runtime and emits its terminal from finally. Renderer `assets/app.js:158` clears the completed run and requests current persisted history via openDialog. Actual fixture wraps that receiver, invokes the original first, then on the first terminal sets phase2→8 (`dialog-form.js:37`). Its next same-target open result validates the first persisted user and requests the native FOLLOWUP key (`dialog-form.js:26`). Only that actual key's subsequent click creates the second Send. Thus L2_DENIED alone cannot establish whether terminal, history reopening or follow-up input happened.
- In the real asynchronous socket/WebView message path, the original terminal call completes the fixture phase update before a later open reply executes. A synchronously reentrant fake transport could manufacture an open-result-before-phase8 or busy-operation schedule, but that is not the actual bound asynchronous producer; it is not a supported reproduction and was not elevated as a defect.

## Actual full-source controlled execution

Created only `/tmp/cmspark-826-dialog-0805-controls.cjs`. It extracts the current renderer harness definitions from actual TS; loads current complete app.js and complete actual dialog-form.js. The providerFactory and createExecutor expressions are AST-extracted from the actual hosted FIRST dialog test (not rewritten backend logic). It runs the real authenticated HMAC/channel, createDesktopDialog, createNativeDialogRuntime, handleMessage, chatCreate adapter, runL2ToolAdmission, SecurityConfirmationManager and actual owned ThreadManager/HistoryStore. Only socket/DOM/native-key/provider leaves are controlled; no native/Win32/API/model/network invocation. Original backend constraints and original fixture phase/key assertions remain.

Three supported FIFO delivery granularities (1,3,99 frames per turn), with real asynchronous task yields, all finish the complete form:

`providerCalls2,userCommits3,denied1,toolEffects0,keys7,receiptMask63,abortedtrue,droppedtrue,offlineok`.

These include actual second Send after L2 denial, streaming, Stop, history reopen and deliberately lost third user ACK with no replay. **3PASS**, log `/tmp/cmspark-826-dialog-0805-controls.log` (about443ms). This does not emulate physical native input or claim Windows success.

Command from companion (Node22.23.4 via nvm, existing isolation preload before application imports):

`CMSPARK_TEST_RUN_DIR="$(mktemp -d /tmp/cmspark-dialog-analysis-XXXXXX)" node --require ./scripts/test-data-dir.cjs --test /tmp/cmspark-826-dialog-0805-controls.cjs`

Read-only source binding separately compares actual current TS emitted function bodies with the compiled functions used by the control: createDesktopDialog, createNativeDialogRuntime, handleMessage, chatCreate, runL2ToolAdmission, prepareDialogL2Fixture. All6AST-printed bodies equal; `/tmp/cmspark-826-dialog-0805-source-binding.log`. No stale helper-response shape or handwritten backend ACK supplies this positive.

## Focus-HWND candidate disposition

`dialog-acceptance.cpp:17–22` checks MoveFocus success, real foreground and focused HWND's GA_ROOT equals owned root, then PostMessage keys to that focus HWND. Source predicate admits the root itself; production root proc (`DesktopHost.cpp:432–436`) has no keyboard forwarding branch and falls to DefWindowProc. That alone does not establish the root can actually be returned by GetGUIThreadInfo after the successful MoveFocus in this observed execution. No actual focused HWND/native-key receipt exists for this failing point. Treat as **unconfirmed candidate**, not a proven bug, not historical cause, and not justification for adding input/retries or weakening ownership.

## Smallest next decision-changing boundary

Current receipts stop at L2_UNAVAILABLE; they do not distinguish a still-pending first runtime from a completed terminal/history flow whose native follow-up key failed to reach the DOM. The minimal further fact, if root decides instrumentation is necessary in an already-required changed-input Windows verification, is a test-owned fixed positive boundary for **first runtime/terminal completion versus FOLLOWUP key/second-Send admission** using existing callbacks. If runtime has not settled, investigate the actual completion path; if runtime/terminal/history completed and the follow-up native request occurred with no second Send, inspect that concrete native input boundary. Absence remains UNKNOWN; no wall-clock inference. This is a proposed finite discriminator, not an implemented observer framework or authorization for another run.

No old-red/new-green supported product fix can be claimed: the source-bound scheduling controls are all green and the physical missing boundary is unobserved. Do not infer that ordinary phase ordering is faulty, or merge unrelated timeout explanations. No shared source edit, CI/API/dispatch/rerun, permission/timing change or product fix was made.
