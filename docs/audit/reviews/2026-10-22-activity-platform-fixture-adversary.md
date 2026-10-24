# #758 owned WPF fixture rethink — independent T1 review

Reviewer: independent non-author `/root/platform_adversary_758`; 2026-10-22. Scope: test-only GUI/compiler architecture, base `e2f661e302623090bbd25d175cbd49c6d58a101b`; frozen `/tmp/cmspark-758-fixture-rethink.diff`, verified SHA-256 `abd4abeea66a0a6f6497e5b1b654f07f557681a1cd19b6f396be4ba6902357eb`. No delegation, implementation edits, CI invocation or native desktop operation.

Capability: T1, test-owned GUI on GHA Windows only; no added user tool, L2 access, autonomy, trust or channel. Prior T3 product and main-integration approvals are reused for unchanged source. Read the complete frozen delta, rethink document, controller, compiler helper, C# and the actual surface lease implementation.

## P2 blocker — compiler cancellation does not join actual close

`companion/tests/helpers/activity-native-fixture-758.ts:6–8,20–24` uses `promisify(execFile)` as the default compiler producer. When its AbortSignal is cancelled, that Promise rejects before the underlying child emits `close`. The catch immediately removes the compiler output and returns failure. The controller awaits this helper before `lease.retain()` and, on rejection, deletes the owned directory and exits the surface callback. Thus cancellation can release the surface claim and remove the compile directory while the actual compiler is still alive. This violates the explicit new DoD of actual compiler close before cleanup/return; the existing GUI close join does not cover the newly added compiler.

Independently reproduced with Node22.23.2's exact real default producer and an owned inert Node child, no GUI or compiler:

```js
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const abort = new AbortController()
const operation = promisify(execFile)(process.execPath,
  ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal })
let closed = false
operation.child.once('close', () => { closed = true; console.log('ACTUAL_CHILD_CLOSE') })
abort.abort()
try { await operation } catch (error) {
  console.log(JSON.stringify({ event: 'PROMISE_REJECTED', name: error.name, childClosed: closed }))
}
```

Observed output, in order: `{"event":"PROMISE_REJECTED","name":"AbortError","childClosed":false}`, then `ACTUAL_CHILD_CLOSE`. This proves the producer ordering; it does not claim a Windows csc execution or diagnose earlier WPF readiness failures.

Keep the original cancellation, timeout, buffer and error semantics, but join the default compiler's actual child close before helper cleanup/return. Add a bounded actual CPU child cancellation control for this boundary; Promise-only inert compiler injection cannot prove process-close ordering. No readiness or native-test budget increase is needed.

## Outcome / trajectory / component

- **Outcome:** the planned fixed Framework64 csc, seven references, fresh output/no reuse, STA owned WPF GUI and GHA-only guard are consistent with the test contract. The original PID/HWND/pixel/OCR/minimized/notification assertions and 10-second ready/90-second case budgets remain. Actual C# compile/GUI behavior is correctly declared NOT_RUN locally. One new lifecycle boundary remains unclosed.
- **Trajectory:** replacing the bounded but unexplained PS-hosted fixture is explicitly a test-architecture rethink, not a proven causal repair. Earlier UNKNOWN evidence and the single older successful native head are preserved. This review requests only the demonstrated compiler-close repair and does not reopen historical #723 or require another model/CI experiment.
- **Component:** no additional concrete blocker found in C# protocol, fixed references/argv, original controller assertions or unchanged GUI cleanup. Compiler cancellation must be covered by real child lifecycle evidence.

Independent clean-environment Node22.23.2 canonical runner execution of `activity-fixture-observation-758.test.js`, `activity-platform-758.test.js` and the actual `activity-752.test.js`: **45 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**, exit 0. Independent log `/tmp/cmspark-758-fixture-adversary-controls.log`. `git diff --cached --check` exit 0. These positives do not cover the newly demonstrated real-process ordering defect and are not actual C# compilation evidence.

The single blocker must be closed before this test architecture is accepted for its one changed-head native run. No claim is made that the new fixture will pass Windows, that old readiness/723 causes are known, or that any product/native gate can be waived.

VERDICT: REJECT
