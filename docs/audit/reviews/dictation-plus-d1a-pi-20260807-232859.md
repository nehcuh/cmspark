Review complete. Verified patch freshness (live `git diff 68c1de8..8811a56` matches the patch body; status dump appended), ran the suite (545/545 pass), traced the state machine end-to-end, and empirically simulated the adapter's exact handler logic to confirm two defects.

## Spec compliance (SoT D1a)

- ✅ Floor 1/2 — Default `classic` (45s, no restart); continuous opt-in with 15 min default hard cap, 30 min clamp (`detect.ts:79-104`); local engine stays 45s.
- ✅ Floor 3 — No auto-send; merge only ever goes to draft via `onDraft`.
- ✅ Floor 5/6/7 — No Pack surface (residual documented), composer-only, no system inject.
- ✅ v3 gate — enforced in `useVoiceInput.ts:305-312` before continuous browser start; `VOICE_PRIVACY_ACK_V3_CLAUSES` covers long-session cloud STT, LLM text residual, no auto-send, v1/v2 insufficiency.
- ⚠️ Floor 4 — `ENGINE_END` is correctly suppressed on mid-session restarts, **but** the restart condition is too broad (below).

## Blocking issues

**1. Continuous mode restarts indefinitely after a fatal engine error — mic stays hot.** `web-speech-adapter.ts:101-110` only treats `no-speech` as soft; for `network` / `audio-capture` / `service-not-allowed` / `not-allowed` / `language-not-supported`, `onerror` dispatches to the reducer (error banner) but leaves `wantListening=true`, so the paired `onend` (`:111-134`) queues another restart → error → onend → restart, unbounded, with repeated mic re-acquisition and re-dispatched error banners. This directly violates Dictation+ SoT §6 ("user abort / hardcap / **fatal 不 restart**") and ADR-024 trust matrix (mic active after an error the user saw). Empirically confirmed: 2 error cycles → 3 recognition instances, `ends=0`. Fix: in `onerror`, for any code ≠ `no-speech`, set `wantListening=false` (or a fatal flag) so the subsequent `onend` delivers `onEnd` once and does not restart; add a unit test (continuous + `onerror("network")` + `onend` → no restart, exactly one `onEnd`).

**2. Lost `ENGINE_END` when stop/hard-cap lands in the onend→microtask restart gap.** In `onend` (`:111-118`) `rec` is nulled before the restart microtask (`:119-127`) runs. If the hard-cap timer (`useVoiceInput.ts:425-439`) or a user click calls `stop()` in that window, `stop()`'s `rec?.stop()` is a no-op and the microtask bails on `!wantListening` without delivering `onEnd`. The reducer stays in `stopping` (busy) with hard-cap finals never committed to the draft; only double-click recovery helps. Empirically confirmed (`ends=0`). Fix: in the queued microtask, when `!wantListening`/dead/gen-mismatch, deliver `handlers.onEnd()` once (guarded by `endedForGen`); add a test (onend then stop() before microtask → exactly one `onEnd`).

## Non-blocking nits

- Tests cover the no-speech swallow but not fatal-error termination or the stop-during-gap end delivery — both defect paths above are untested.
- `useVoiceInput.ts:327-331`: `onNeedPrivacyAckV3` fallback to `onNeedPrivacyAck()` (v1 sheet) would loop v1 without satisfying the v3 gate — cosmetic since `App.tsx` always provides the real callback.
- First continuous attempt with neither v1 nor v3 ack shows two sequential sheets (v1, then v3 after re-click) — safe, slightly awkward.

## ADR-020 checklist

Declaration is present and accurate: Surface L0 input only, Compose none, Trust = mic + browser STT (long-session residual) + `voice_privacy_ack_v3` gate, no auto-send, no tools from voice, Channel community. The v3 ack correctly gates the expanded surface; no new tool/gate surfaces added; no Pack write path. Compliant.

VERDICT: REJECT
