# Independent design review —826 scope INITIAL finite observation

VERDICT: APPROVE. The existing #758 fixed-file observation pattern is sufficient; no new generic framework, worker, retry or readiness rule is needed. Actual implementation still needs source/GLM gates before Windows validation.

Reviewed /tmp/cmspark-826-scope-initial-observation-design.md, current actual C# IsReady/Build/Main, readiness CPU source extractor, scope receipt helper/native finally, and #758 Observe/Record plus closed Node projector and cleanup placement. Source/config/CI were not modified.

## Supported current failure

Actual64db Windows scope case reports OWNED_SCOPE825_RECEIPT_TIMEOUT_INITIAL, not RESIZE/POPUP. It does not establish which initial render/foreground/focus precondition was absent. The guard is intentionally qualified and must not regress to ContentRendered-only readiness or repeated activation/focus.

The proposed phase and first-reached-reason records can add positive evidence without changing that rule:

- SOURCE_INITIALIZED/LOADED/CONTENT_RENDERED prove those callbacks were observed; a notRendered return-path record positively proves one actual check saw rendered=false. Missing phase files cannot prove rendering never occurred.
- notForeground and noKeyboardFocus prove a particular existing check reached that short-circuit return. The latter also implies its preceding checks succeeded on that check. Neither is a deadline snapshot or the last native state.
- Original Activate/Focus return booleans describe those requests once; they cannot substitute for actual foreground/IsKeyboardFocused qualification.
- qualified/READY_WRITTEN remain separate facts: record READY_WRITTEN only after the original ready write succeeds. Initial-only filtering must still permit that post-write marker. No observation can itself publish ready/ack or authorize capture.

## Independent actual-source controls

Ran the existing readiness test through the official isolated runner:4 PASS/0 FAIL/0 SKIP. This executes the actual C# guard/event/resize source with controlled native/WPF leaves, checking single activation/focus, queued-state changes, stale old-window rejection and popup behavior. Log /tmp/cmspark-826-scope-initial-existing-readiness-independent.log.

Built a temporary prototype by exact replacement of the current real IsReady body: split its original short-circuit branches only to record the reached fixed reason before returning the same value. For all128 combinations of its seven existing qualification conditions, compared baseline versus observed return value and Handle/GetForegroundWindow/focus-property query counts. All agree. A throwing observation sink remains inert; repeated checks attempt each reached reason once. All8 planned reasons are exercised. This proves the proposed branch instrumentation is implementable while preserving current evaluation; it is not a substitute for reviewing the actual implementation.

Probe /tmp/cmspark-826-scope-initial-guard-design-independent.cjs; log same stem.log.

## Implementation/acceptance constraints

Use the existing per-name-at-most-once, CreateNew pending-file plus atomic move and swallowed-observation-error pattern. Closed phase/call/reason schemas only, fixed file inventory, booleans/enums; no titles, PID/HWND, text, arbitrary error or path projection. Preserve the initial-window subject and original managed-thread comparison. Phase sets need not imply a universal ordering: current scope uses window.Show before app.Run, unlike #758's app.Run(window).

Preserve every original IsReady predicate, evaluation order and OS/property query count, original one Activate and Focus request, dispatcher scheduling/control timer,10-second receipt,180-second case and all business/cleanup assertions. No popup/resize observation expansion is needed. Preserve original truth even when observation allocation/write/rename fails. Main success stops further initial qualification observation, without suppressing the post-success READY_WRITTEN record.

Node reads only after the original child-close join and before original rmSync/lease settlement, with no diagnostic wait. Reader/projection exceptions must not skip cleanup or replace the primary error. A complete valid fixed-schema file is positive history; absent, corrupt, partial, foreign-field or failed-writer entries remain omitted/UNKNOWN. No negative inference from absence, no claim of deadline state, no historical physical root cause.

Source-machine gate should consume actual new producer/reader and actual C# body, cover writer failure/once-only/closed enums, preserve original finally ordering/primary failure and LF/CRLF consumers. The remaining Windows facts are for one purposefully instrumented run after independent source and actual GLM review, not justification to relax readiness.
