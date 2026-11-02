# Mac query lifetime — read-only design addendum

2026-11-03. No repository edits, CI, native UI operation, external GLM call or authority/budget change. This is a single-point refinement of the approved finite Mac observation unit, pending coordinator/independent review.

## Reproduced supported order

The current xcode close callback sets xcodeClosed and notifies the original waiters. The existing observeXcodeCloseOnce callback starts result705AfterActualClose asynchronously. With observer0, runner closed and UI quiescent receipts all present, original cleanup may finish and the native finally may remove the entire owned parent directory before that query process reads Result.xcresult. This is legal caller cleanup, not a defect in the full-close guard.0666's mask31/observer0 makes this path supported; the observed TOOL_FAILURE does not reveal whether it actually happened there.

The new /tmp/cmspark-826-macos-query-lifetime-probe.cjs extracts and executes:

- Actual result705AfterActualClose and its original selectors/guards.
- Actual OwnedUI705Boundary, using all five real canonically serialized fixed receipts, exact startup bundle/executable representations and identity-bound ack/closed/quiescent fields.
- Actual OwnedWorkspaceUI705 cleanup/wait/canSettle/cancel/notify bodies, with original observerClosed/xcodeClosed true and codes0. Only held watcher/process ports are inert; closure reads the actual owned files.
- The unique actual native finally tail beginning `let uiClosed=true`, including its awaited cleanup, original rmSync, environment restoration and lease settlement.

Only xcrun's executable leaf is routed to a real owned Node process. IPC gates its file read until before or after the actual parent tail; original query argv/three stdio slots are asserted. IPC is an inert experimental scheduling port, not a proposed product change. No valid SDK JSON is invented.

Three rounds,6/6 PASS, Node22.23.4, exit0; log /tmp/cmspark-826-macos-query-lifetime-probe.log:

- Read before parent cleanup: bundle exists, leaf close0/no stderr, deliberately invalid-for-SDK `{}` reaches the original parser and yields INVALID_RESULT. Then original cleanup/rm/settle succeeds.
- Parent cleanup/rm/settle first: original full authority is satisfied; owned directory is actually gone; leaf then reads the missing bundle and closes7 with a finite owned refusal; original query produces TOOL_FAILURE.

This is a counterexample to treating TOOL_FAILURE as necessarily independent of caller cleanup. It is not the unique physical explanation of0666, an xcrun internal reproduction or a successful result response.

## Minimal refinement: one ROOT_REMOVED point

Add only a first-once ROOT_REMOVED positive fact to the already-approved Node closeClock476/250ms/240-saturated observation. Record it best-effort immediately after the original fs.rmSync(dir,...) returns successfully and before the original lease.settled(). No stat/read/exists check is needed. If rm throws or the original cleanup guard refuses removal, do not record it; preserve the original error and retained lease. Observation/sink/clock failure remains UNKNOWN and cannot skip settlement or replace primary failure.

No snapshot copy, directory retention, query join, cleanup delay, new process, polling, new clock origin, SDK call, query retry, raw output or output-cap increase is proposed. Original45s, shared5s/two-query/CAP rules, process/JSON rejection, actual-close authority and cleanup order stay unchanged.

## Emission and interpretation condition

Merely storing a new point is insufficient if it is emitted only in the existing pre-query/pre-removal timeline projection. At the existing final query-result output slot, include the **current in-memory** timeline snapshot (or this point from that snapshot), within the unchanged output byte cap. The async callback already retains the owner; this requires no extra event/file read/wait or output slot. This is part of wiring the one new point, not another observation mechanism.

A present ROOT_REMOVED at query-result emission positively establishes that caller removal had already returned before that projection. Together with the actual query's captured code/stderr/EOF facts it prevents diagnosing TOOL_FAILURE as a tool/SDK defect without considering lifetime. It does **not** prove the query attempted its read after removal, that removal caused this particular nonzero exit, or that xcrun did not have a separate error. Even chronological Node buckets describe callbacks/observations, not exact OS I/O time. Missing ROOT_REMOVED remains UNKNOWN, never proof that the bundle survived.

This one fact is sufficient for the next run's conservative lifetime association; it is not enough for causal attribution, which is not needed for this bounded diagnostic unit.

## Small source-machine acceptance addition

Use the actual changed native finally and owner methods. Positive: successful original cleanup→rm records ROOT_REMOVED once before settled and the later query output sees it. Negative: cleanup refusal or rm throw produces no point; note/clock/logger throw does not change original failure or lease order; repeated note cannot rewrite first time. Query completing before removal must not retrospectively report a future removal. Reuse the real six-way lifetime control and unchanged two-query/byte/call/authority tests. Validate maximum output remains under the existing cap; do not grow it to fit this point.
