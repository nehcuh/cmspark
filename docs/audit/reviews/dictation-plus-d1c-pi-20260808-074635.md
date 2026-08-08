I've verified everything I need. Summary of the review:

**Capability declaration (ADR-020):** Present and consistent (Surface L0, no L2 classes, Compose none, Autonomy n/a, Trust = mic + local WS segment residual with v3 gate + no auto-send, Channel community). Privacy v3 is now correctly required for continuous *local* (previously browser-only), trust is not loosened, no new runtime/tools. Checklist passes.

**Machine gate:** `npm test` = 553 pass (confirmed by running it). But this masks a real build break (below).

## BLOCKING ISSUES

**1. Build gate broken — `tsc -p tsconfig.json` fails (new TS errors).**
`chrome-extension/src/sidepanel/voice/local-stt-adapter.ts:366,369` — `if (!result.ok) { result.code ... }` fails discriminant narrowing under the repo's build config. `plasmo/templates/tsconfig.base.json` sets `"strict": false`, and under `strict:false` the `ok: true|false` union does not narrow (reproduced in isolation; strict:true passes — which is why `tsconfig.test.json` and the 553 tests are green). `npm run build` = `tsc --noEmit && plasmo build` therefore fails on this branch. Verified `main` compiles clean via worktree (`tsc -p tsconfig.json` exit 0 on `36f5f52`), so this is introduced by D1c. The narrowing also breaks at line 369. (Note: this also means `result.code` is `undefined`-typed at runtime-unsafe positions.)

**2. Continuous local cannot complete any segment >10s against the actual companion — feature non-functional end-to-end.**
Companion force-aborts any STT session receiving no `voice.stt.chunk` for 10s: `STT_UPLOAD_IDLE_MS = 10_000` (`companion/src/voice/session-caps.ts:7`), armed at `start()` (`stt-session-service.ts:184`) and firing `forceAbort()` (`:448`). The D1c adapter records full-length segments (no VAD; `segmentMs = min(45_000, remaining)`) and streams **zero** chunks during recording — the only `voice.stt.chunk` send is in `uploadAndWait` (`local-stt-adapter.ts:216`), after the segment ends. Every real segment runs 45s → server aborts at 10s → `voice.stt.end` returns `session_unknown` → `runContinuous` error path → the whole continuous session dies with an error banner. A user stop at >10s hits the same wall (server already aborted). This is a guaranteed failure mode, not an edge case. No test covers the 10s/45s idle boundary (client tests mock the WS; the companion idle test asserts the abort as intended behavior).

## Nits (non-blocking)

- `detect.ts:125` `LOCAL_CONTINUOUS_SEGMENT_MS` is exported but never used (adapter uses `LOCAL_STT_MAX_RECORD_MS`).
- `useVoiceInput.ts:568-573` — redundant identical `if (cont) {…} else {…}` branches in the hard-cap timer.
- `onWs` non-pending result branch can deliver a duplicate `onResult`+`onEnd` in the microtask window between `finishPending` and the next segment's `sessionId` update — no epoch guard on the non-pending path.
- No end-to-end/integration test exercising the real companion WS timing (segments, idle, record timers).

VERDICT: REJECT
