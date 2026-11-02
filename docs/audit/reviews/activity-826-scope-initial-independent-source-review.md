# Independent source review —826 scope INITIAL finite observation

VERDICT: APPROVE. No reachable blocker found. This source unit may enter the actual GLM source gate; actual Windows phase/business validation remains pending.

## Frozen scope and identity

Reviewed only the4 source paths in /tmp/cmspark-826-scope-initial-source-manifest.json, base64dbdaafda240f06cac21955e2a4a8ee163c8740:

- companion/tests/fixtures/activity-scope825-windows.cs
- companion/tests/helpers/activity-scope825-observation.cjs
- companion/tests/activity-scope825-readiness.test.ts
- companion/tests/activity-scope825-native.test.ts

All four actual SHA256 values match that manifest. Read the complete real delta, helper and author handoff /tmp/cmspark-826-scope-initial-implementation.md. Excluded A's parallel unfrozen compiler MJS and unrelated host pin/audit documents. No source/config edit, commit, push or CI run by reviewer.

## Actual implementation

C# reuses the established #758 fixed-name/once-only observation pattern. Observe catches both attempt bookkeeping and producer/write errors. Pending observations use CreateNew, close before atomic move and never produce ready/ack. The actual payload has only phase and the comparison to MainThread. Calls use18 fixed names; no title, text, PID, HWND, pointer, path or arbitrary exception is projected.

The expanded IsReady preserves all seven original predicates and their short-circuit order. It records the actually reached return branch through ReadyResult and preserves true/false even when writing the diagnostic fails. No extra Handle/GetForegroundWindow/focus-property query is introduced. InitialWindow and InitialReady bound qualification observations to the initial subject. The original ready write occurs before READY_WRITTEN observation and setting InitialReady, so the success marker is not accidentally suppressed.

Original Activate and Focus execute once, in their original order; their returned bools become closed ACTIVATE_TRUE/FALSE and FOCUS_TRUE/FALSE names. No reacquisition or retry is added. Original requested flag, dispatcher callbacks, resize/popup behavior and50ms control-command timer remain. SourceInitialized/Loaded are passive initial-window callbacks. RUN_ENTER is after original Show and before app.Run; records do not enforce an invented common phase order.

The Node reader opens only18 fixed filenames and admits only the matching phase plus boolean sameSta with exactly two keys. Missing/malformed/pending/foreign entries remain omitted; an empty set is UNKNOWN. Nonempty OBSERVED is positive history, not completeness, final state or proof that absent phases never happened.

Native source changes only its passive finally projection: after the original child-close join, before original owned-directory removal and lease settlement, wrapped to prevent diagnostic failure from replacing the primary result or skipping cleanup. Original10-second receipt and180-second case, foreground/readiness qualification, original business assertions, permissions and successful/failed cleanup remain.

## Independent verification

Node22.23.4, official isolated runner:

`node scripts/run-tests.mjs .test-dist/tests/activity-scope825-readiness.test.js`

Result8 PASS/0 FAIL/0 SKIP. Log /tmp/cmspark-826-scope-initial-independent-source-tests.log. This executes:

- Original four actual C# guard/event/resize/popup controls.
- All128 original qualification combinations, comparing return value and Handle/foreground/focus query counts with normal and throwing actual observation producer.
- Actual once-only producer, failed-writer inertness, initial-only behavior and ready-before-success-observation order.
- Actual C# Observe body/anonymous payload and actual Path.Combine target feeding the real closed reader, plus malformed/private/foreign/wrong-type/pending cases and same-thread false.
- Actual native finally body for LF/CRLF with throwing projection: original primary and stop/kill/childclose/project/remove/settle order retained.

Reused root's successful unchanged full tsconfig.test compile from /tmp/cmspark-826-scope-initial-types.log; no unrelated suite or compilation repeated. Existing original10-second/native180-second and unsupported missing-phase interpretations were not weakened.

This observational unit can positively distinguish events/branches that actually produced records. It does not itself resolve the real INITIAL timeout or authorize capture, and a missing record remains UNKNOWN. No new hypotheses or generic framework were introduced.
