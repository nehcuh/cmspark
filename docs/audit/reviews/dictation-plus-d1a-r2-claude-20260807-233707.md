## Review findings

### Patch freshness
Live `git diff 68c1de8..HEAD --stat` reports **28 files / 6254+ / 73-**, matching the patch file's claimed scope. Patch includes fix commit `5a8bc1c`. Not stale.

### Machine
`chrome-extension` `npm test`: **547 pass / 0 fail / 0 skip** (re-run by me; matches implementer claim). The two new tests (`voice-web-speech-continuous.test.ts:156,210`) exercise both Pi blockers end-to-end with deterministic `FakeRec` instances.

### Pi blocker 1 — fatal continuous-error restart loop
`web-speech-adapter.ts:101-112`: `onerror` now sets `wantListening=false` for any code ≠ `no-speech` before dispatching `onError`. Traced: `onerror("network")` → `wantListening=false` → paired `onend` (`:113-155`) skips the restart block (`mode==="continuous" && wantListening===false`) → falls through to the terminal `handlers.onEnd()` path guarded by `endedForGen`. Exactly one `onEnd`, zero new `SpeechRecognition` instances. Matches SoT §6 ("fatal 不 restart"). Test `continuous: fatal network error stops restart and ends once` asserts `starts===firstStarts`, `ends===1`, `errors===1`. ✓

### Pi blocker 2 — stop during onend→restart microtask gap
`web-speech-adapter.ts:121-134`: the queued microtask now, when `!wantListening` (and gen still valid), delivers `handlers.onEnd()` once via the `endedForGen !== gen` guard instead of silently returning. Traced: `onend` schedules microtask and returns (no onEnd yet) → user/hard-cap `stop()` clears `wantListening` (rec already nulled, no-op) → microtask enters the `!wantListening` branch and fires `onEnd` once. Test `continuous: stop during onend→restart microtask still delivers onEnd` asserts `ends===1`, `starts===1`. ✓

### SoT floor coverage (D1a)
- Floor 1/2 default `classic`, continuous opt-in, 15-min default / 30-min clamp — `detect.ts:79-121`, `useVoiceInput.ts:399-427`. ✓
- Floor 3 no auto-send — only `onDraft` on `ENGINE_END`; never `onSend`. ✓
- Floor 4 ENGINE_END suppressed during continuous restart — `:118-150` (early return + `endedForGen`). ✓
- Floor 5/6/7 composer-only, no system inject, classic regression preserved — `:151-154` terminal path. ✓
- v3 gate enforced — `useVoiceInput.ts:326-333` before continuous browser start; `VOICE_PRIVACY_ACK_V3_CLAUSES` covers long-session cloud STT, LLM text residual, no auto-send, v1/v2 insufficiency. ✓

### ADR-020 capability checklist
Declaration present and accurate:
- **Surface L0** — composer draft only; no tools/gates/CU bypass added. ✓
- **Compose none** — no Pack writes for new keys; existing strip regex `^voice` already covers `voiceDictationMode` / `voice_privacy_ack_v3`. ✓
- **Autonomy n/a** — no agent runtime. ✓
- **Trust monotonicity** — deeper continuous surface correctly requires strictly-more v3 ack; no auto-send; no `auto_approve_*` touch. ✓
- **originWs** — n/a; no new `securityConfirmations.request`. ✓
- **No new runtime** — adapter-local restart only; no second framework. ✓
- **Channel community** — D1a not enterprise-gated. ✓

### Non-blocking nits
- **N1** `useVoiceInput.ts:330` — `onNeedPrivacyAckV3` fallback to `onNeedPrivacyAck()` (v1 sheet) would loop v1 without satisfying v3 gate; cosmetic since `App.tsx:476-479` always provides the real callback.
- **N2** `privacy-copy.ts:30` — v3 ack body references unshipped ASR Refiner ("若开启「ASR 纠错」…"). Slightly confusing but architecturally consistent with the unified v3 gate (F-S-CD15); D1b will deliver Refiner.
- **N3** `agentStore.tsx` / `useWebSocket.ts:228,256` — `voiceDictationMode` storage key uses camelCase while voice siblings use snake_case (`voice_privacy_ack_v3`). Pre-existing convention mix in this store; cosmetic.
- **N4** No explicit test for `code="aborted"` after `stop()` in continuous mode, but the path is transitively covered by the existing classic-suite regression plus the new blocker tests.

### Verdict
Both Pi REJECT blockers are closed with targeted code + regression tests; capability declaration is accurate; machine green; no security or correctness regressions introduced by the r2 fix commit. Remaining items are cosmetic or out-of-D1a-scope.

VERDICT: APPROVE_WITH_NITS
