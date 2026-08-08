All four r2 fixes verified against the actual code in HEAD (1f81e37). Machine gate green (556 pass / 0 fail; `tsc -p tsconfig.json --noEmit` clean). Companion untouched (Floor 1 holds).

## Verification of r1 blockers

**Pi #1 (tsc narrowing)** — Fixed. `local-stt-adapter.ts:370,495` use `result.ok === false` discriminant; `tsc -p tsconfig.json --noEmit` returns 0 errors on this branch. `[executed]`

**Pi #2 (10s idle abort)** — Fixed. `runContinuous` (local-stt-adapter.ts:327-401) records the segment FIRST via `recordSegment(segmentMs)` (line 345), then sends `voice.stt.start` (line 366) immediately followed by `uploadAndWait` (line 367) which synchronously streams `voice.stt.chunk[]` + `voice.stt.end`. Start and chunks land in the same JS tick. Test `voice.stt.start is deferred until after record (idle-safe)` (tests/voice-local-continuous.test.ts) asserts timeline ordering `captureBegin → captureStop → voice.stt.start`. `[executed]`

**Claude B1 (stop during processing loses finals)** — Fixed. `useVoiceInput.ts:423-430` now special-cases continuous+local+processing to call `stopEngine("stop")` only (no `USER_TOGGLE_STOP`). SM stays uncommitted, current segment's `uploadAndWait` resolves, `runContinuous` breaks on `!wantListening`, `onEnd` fires, `shouldApplyDraft` is true → `mergeFinalTranscript` runs over accumulated finals. `[inspected]`

**Claude B2/B3 (test coverage)** — Fixed. New tests:
- `local continuous: two short segments → two finals then onEnd` uses `hardCapMs: 200, segmentMs: 40` override (line 1133-1138) so the genuine multi-iteration loop body actually runs (5 iterations of 40ms each complete within the 350ms wait); asserts `captures >= 2`, `finals.length >= 2`, segment-id pattern `-s\d+$`.
- `continuous: finals survive stop-after-segments path (graceful ENGINE_END)` — SM-level test confirming no-USER_TOGGLE_STOP ENGINE_END preserves `finals` and triggers merge. `[executed]`

## ADR-020 capability check

- Surface L0 / Compose none / Autonomy n/a — consistent with diff (voice input refinement only, no new gate/tool/runtime). `[inspected]`
- Trust: continuous now requires privacy v3 for LOCAL too (useVoiceInput.ts:468-474), previously browser-only — bar is *raised*, monotonicity preserved. ✅
- Channel community. No new originWs / confirm-dialect / pack concerns. ✅

## Nits (non-blocking)

- **N1.** `local-stt-adapter.ts:541-565` `destroy()` nulls `segmentStopTrigger` without invoking it; if destroy lands mid-`recordSegment` await, the segment-timer Promise hangs indefinitely. `dead=true` + `loopGen+=1` guards prevent any handler side-effects, and the closure is GC'd with the adapter, so it's a one-shot leak — not a correctness bug. Mirror the abort() pattern (`segmentStopTrigger?.()`) for symmetry if desired.
- **N2.** Wall-clock cap is soft: a segment started near `hardCapMs` can extend total wall time by up to ~segmentCapMs (≤45s) + infer (~90s). Mic-live time stays strictly bounded. Acceptable per implementer's Floor 5 contract ("user stop ends after current segment"); a one-line comment near line 331 already documents this.
- **N3.** `useVoiceInput.ts:571` computes `cont` but the local branch of the hard-cap timer doesn't use it (only the browser TIMEOUT code does). Trivial dead-in-branch; collapse or hoist.

Nits are all minor — none block merge. The four blocking r1 issues are resolved with verifying tests.

VERDICT: APPROVE_WITH_NITS
