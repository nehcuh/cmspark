# #826 macOS 0666 — read-only diagnosis and minimal next observation

2026-11-03. No repository source/config/CI mutation, native UI run, external GLM call, timeout change or relaxation of actual-close acceptance. Only an inert /tmp process-boundary probe was run. Current evidence does not establish a product defect or an efficiency correction that can safely be applied as a fix.

## Actual failure and supported boundary

Read the complete sanitized /tmp/cmspark-826-macos-0666fc8d.md and relevant terminal log around lines3850–3940. Actual run41521066023/job125536906690 at0666fc8d reports all10 native workspace receipts, selected identity, cancellation result, native exit0 and all5 acknowledged UI receipts. The Node owner has observer close0 but not xcodebuild close at its original45-second rejection. Assertion site3 waits for uiOwner.complete(); failureSite9 is its rejection. This is a different reached boundary from64db, whose Cancel had not returned. The later surface acquisition failures are consequences of retaining an unsettled owner, not three additional proven product defects.

The current original completion contract is appropriate and must remain: acknowledged exact runner identity, quiescent UI if begun, actual observer close, actual xcodebuild close and successful completion code. UI receipts/native exit are not replacements. xcodebuild already has regular-file stdout/stderr; applying the Windows compiler pipe fix here would not address a demonstrated pipe dependency.

Cancel timing stage20 returned at UI-origin elapsed24354ms with remaining744ms. This is useful positive evidence that the UI sequence consumed nearly all its available deadline. It neither measures exact xcode startup time nor proves that a particular AX call or framework shutdown is defective. Observer Swift buckets are5 seconds, Node close buckets250ms, and their origins differ. No subtraction between them was used.

No cache/parallelism/test-plan flags, shortened UI procedure, new termination, reordered authority, skipped close, extra budget or repeated CI is justified by the current evidence.

## Real source inspected

- companion/tests/helpers/workspace-xctest-owned-705.ts: complete file; constructor/copyManifest, existing closeClock476/noteClose476, file-fd spawnOwned, actual wait/complete/cleanup, fixed receipts, captured xcode stream parser, two post-close result queries.
- companion/tests/desktop-native-thread-metadata-476.test.ts: actual workspace callback, exact native exit, completion assertion, abort, post-cancel observation and original cleanup.
- companion/tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift, OwnedUIProtocol.swift, OwnerObserver.swift: actual stage/cancel order, UI defer-return receipt, exact runner observer/KVO/termination, atomic fixed-file protocol and independent clock origins.
- companion/scripts/desktop-workspace-ui-705.mjs: actual precompiled runner packaging and test-without-building plan; no evidence supports moving build into this45-second case or changing flags.
- Existing source-derived controls in companion/tests/desktop-workspace-xctest-705.test.ts, and original surface tracing/lease in companion/tests/fixtures/native-surface-650.ts.

The watcher is armed before start(), wait() registers then immediately rechecks and close callbacks notify waiters. Inspection did not expose a missed registration/recheck gap that explains this run. Captured xcode output is already a regular file, not a pipe kept open by unrelated descendants. This is source evidence against those proposed fixes, not proof that the remaining SDK shutdown is healthy.

## One real, reproduced diagnostic ambiguity

The existing result705AfterActualClose.capture callback merges all of these into TOOL_FAILURE: spawn error, nonzero close code, signal, missing stdout/stderr EOF and nonempty stderr. Thus the current TOOL_FAILURE cannot select an actionable tool failure category; interpreting it as an unsupported xcresult API or a crash is unjustified.

A probe executes the actual AST-extracted current result705AfterActualClose/result selectors using real Node ChildProcess objects. Only the xcrun process leaf is routed to an inert owned Node executable or known missing owned executable; source hashes, real temporary result directory identity, original API argv/stdio options, original guard and parser are preserved. No SDK response shape or result JSON was invented. Three rounds produced12 successful controls:

| Actual process boundary | Actual captured facts | Original projection |
| --- | --- | --- |
| Nonzero child exit | error=false, code7, signal=null, stdout0/stderr0 | TOOL_FAILURE |
| Clean exit with stderr | error=false, code0, signal=null, stderr14bytes | TOOL_FAILURE |
| Spawn missing owned executable | error=true, code-2, signal=null, stdout0/stderr0 | TOOL_FAILURE |
| Clean exit with intentionally invalid-for-schema `{}` | code0, no stderr, stdout2bytes | INVALID_RESULT |

The last row is a negative control for the tool-failure classification, not a fake valid SDK result. It proves the original clean-close guard is passed and original parser remains authoritative. The initial temporary harness used lexical /var while sameBundle requires canonical /private/var; it was corrected with realpath before the successful controls. That harness setup rejection is not a product finding.

Artifacts: /tmp/cmspark-826-macos-close-query-probe.cjs and /tmp/cmspark-826-macos-close-query-probe.log. Node22.23.4; exit0. The experiment establishes lost discrimination, not which of these happened on CI.

## Proposed minimal observational unit (not implemented or approved)

Use existing Node closeClock476, held ChildProcess objects, original fixed logs and existing output slots. Add no worker, polling, watcher, timer, receipt, arbitrary raw log, permission or lifecycle framework.

1. Extend the existing first-once, bounded Node-clock observation with only these fixed points: owner constructor return (includes package-copy/setup cost), xcode spawn call enter/return, native exit callback observed, complete rejection, first cancel request, xcode exit, xcode close. Keep a single closeClock476 origin,250ms saturated bucket and closed exit/signal/error categories. Existing observer close remains. The native callback may call one passive owner method; it must not alter when launch/exit resolves. `exit` is observation only; **actual `close` remains the completion authority**.
2. At the current failure projection emit the accumulated points; at the already-existing observeXcodeCloseOnce post-cancel callback emit the same finite observation once again. Today noteClose476 can record xcode close later, but its only snapshot was emitted before that close. Reusing the post-close callback exposes a fact already available without any new wait. Mark whether cancellation had already been requested; never interpret a post-cancel exit as normal successful completion.
3. Preserve the current post-close xcresult query and all its rejection rules. Add process facts already captured at its close callback, not new stderr parsing: fixed query stage TESTS/DETAILS, spawn/stream-error boolean, close-code category (or admitted0..255), closed signal enum, stdout/stderr EOF booleans, bounded output byte counts/overflow. Return the original UNKNOWN/TOOL_FAILURE when it currently would; attach only these finite facts. No raw stderr, descriptions, result paths, bundles, IDs, environment or inferred SDK cause. Do not retry aliases or add calls/time/byte budgets.

These are finite distinctions whose consumers already exist. There is no need to add per-UI-call or per-file wallclock instrumentation yet. In particular avoid adding five repeated receipt reads to every existing filesystem notification merely to estimate UI arrival; that would add work to the very budget being investigated.

## How the next evidence changes the decision

- Constructor/start interval materially large: investigate that exact owned copy/setup boundary using its actual manifest and original operations; do not change AX steps or xcode close.
- Native exit near the deadline with xcode not yet exited: the consumed budget is before/through UI completion. The next question is an evidenced stage interval, not general xcode shutdown tuning. Current UI timing alone cannot identify exact startup duration.
- Native exit substantially earlier but xcode exit absent until cancel: isolates a post-business/xctest-command interval. Use admitted existing result/tool facts to select the next supported inquiry; do not drop close or guess a runtime cause.
- Xcode exit observed but close materially later: isolates the Node process-close boundary and prompts an actual owned process/descriptor experiment. It still does not establish a pipe issue (stdio is already files).
- Tool nonzero versus clean-exit/stderr versus spawn/EOF failure: distinguishes execution failure, strict stream rejection, setup or incomplete capture. A clean process with invalid JSON remains INVALID_RESULT. These facts do not identify an SDK-internal cause, and cannot turn a rejected result into pass.
- Any missed/failed observation remains UNKNOWN; no subtraction across Node/Swift clock origins and no negative inference from absent events.

## Required pre-implementation / source / platform checks

Independent agent + actual GLM design approval before source changes. Source tests must extract the real changed owner/capture bodies, preserve original whole completion/cleanup guards and test LF/CRLF raw inputs where they are claimed. Extend the actual held-child spawn port to exercise exit-before-close, close-without-success and delayed/absent close: no accepted UI receipts may settle the owner until all original gates. Verify timeline records first-once, no extra authoritative read/wait, closed bounds, invalid-clock/sink failures inert and original primary error preserved.

For query facts, reuse this actual-process four-way control and add signal/EOF/overflow controls through the actual capture port, with explicit positive clean-capture/parser and negative guard results. Do not hand-author a valid SDK response for new parsing. No new SDK shape is required because the proposal exposes only existing real Node process facts.

After implementation machine checks, B source APPROVE and actual GLM source gate, one purposefully changed-head macOS run must still satisfy original45-second full native/UI/observer/xcode completion and normal cleanup. A richer failure is diagnostic progress, not acceptance or permission to release.
