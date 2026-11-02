# Scope825 fixture readiness — independent non-author review

VERDICT: APPROVE

Reviewed the current two-file unit: companion/tests/fixtures/activity-scope825-windows.cs and new companion/tests/activity-scope825-readiness.test.ts. No source edits, commits, pushes or CI reruns performed.

## Verified behavior

The actual IsReady body qualifies the captured Window and TextBox with rendered=true, Current==window, ReceiptWindow==window, non-null pending receipt, nonzero native HWND equal to GetForegroundWindow(), and actual IsKeyboardFocused. Per-window ContentRendered requests activation/focus only once; Activated/GotKeyboardFocus schedule the captured check after event processing and do not request either again. Every check re-reads current state, so queued-event state loss and old-window callbacks refuse publication. Pending is consumed before the original atomic receipt writer. Initial ready and popup ack use this same path. Resize executes its original Width/UpdateLayout then submits its ack through the same current-window gate. The original control-command timer is not a readiness poll.

The native controller, owned receipt helper and all activity product files are byte-unchanged against HEAD. Original 10-second receipt and 180-second case budgets, HWND/PID/ROI/OCR/crop/pixel/model assertions and finally cleanup are retained. This does not add foreground reacquisition, a retry or forced focus. If Windows never grants foreground/keyboard focus, the original receipt deadline still rejects.

## Independent machine evidence

1. Extracted the original ContentRendered body from actual git HEAD, rather than copying a guessed old condition. Executed the verbatim body in a VM over all four Activate/Focus return combinations. All four publish ready, including false/false: the old false-ready counterexample is reachable.
2. Executed the current test's actual-C# source-extraction harness with additional independent scenarios, three rounds (24 checks total): unrendered; foreign foreground; missing keyboard focus; zero HWND; different Current Window with same numeric HWND; different ReceiptWindow with same numeric HWND; null pending; plus already-qualified initial ready followed by new-popup pending, queued state loss, stale old-window events, legitimate popup qualification and duplicate events. Every negative case withheld the receipt; positive paths emitted exactly one correctly bound receipt and one activation/focus request per window.
3. Ran official isolated runner on activity-scope825-readiness.test.js: 4 PASS /0 FAIL /0 SKIP. These actual guard/event/resize consumers passed.
4. Reused the author's unchanged full tsconfig.test compile result, which was successful. No additional compile was needed because the input files have not changed.

Probe: /tmp/cmspark-825-scope-readiness-independent.cjs; final log: /tmp/cmspark-825-scope-readiness-independent.log; isolated runner log: /tmp/cmspark-825-scope-readiness-independent-runner.log. The first version of the additional probe used deepStrictEqual on a VM-origin array, causing a cross-realm-prototype assertion despite equal elements; changed only the temporary probe to compare serialized primitives, then all scenarios passed. No product/test behavior was changed for this harness correction.

## Evidence boundary

This proves the fixture's publish qualification and event binding, not actual Windows foreground grant. It does not prove why the prior CI foreground changed or what application owned it. The guard establishes facts at publication only; subsequent OS foreground changes still fail the original Probe identity assertion. Windows C# compilation and exact-head native scope business/cleanup acceptance remain required after the independent/GLM gates.
