All checks complete. Summary of my independent verification:

## Verification performed

**Patch freshness** — `git diff 68c1de8..HEAD` matches the patch body exactly (only the 85-line preamble differs); merge-base confirmed at `68c1de8`; branch contains feat `8811a56` + fix `5a8bc1c`.

**Machine gates** — `npm test`: **547/547 pass** (incl. both new regression tests); `tsc --noEmit`: clean.

## Fix 1 — Fatal errors end continuous session ✅

`web-speech-adapter.ts:107-110` now clears `wantListening = false` for any `onerror` code ≠ `no-speech` (no-speech stays swallowed for restart). Trace: fatal error → `onError` → reducer `ENGINE_ERROR` → phase `error` (banner kept, `sessionId` cleared) → paired `onend` sees `wantListening=false` → skips restart microtask → falls through to `onEnd` once (guarded by `endedForGen`). Test `continuous: fatal network error stops restart and ends once` reproduces the exact r1 defect empirically (errors=1, ends=1, starts unchanged). No unbounded mic re-acquisition remains.

## Fix 2 — Stop during onend→restart microtask ✅

`web-speech-adapter.ts:122-131`: the queued microtask now delivers `handlers.onEnd()` once (via `endedForGen` guard) when `!wantListening`, instead of bailing silently. Trace with the hook: `stop()`/hard-cap `TIMEOUT` sets `wantListening=false` (rec already nulled) → microtask delivers `onEnd` → reducer `ENGINE_END` from `stopping` commits finals to draft. Hard-cap variant covered by `continuous-timeout banner copy` reducer test; the adapter gap covered by `continuous: stop during onend→restart microtask still delivers onEnd`.

## Additional adversarial traces (passed)

- no-speech swallow → restart → fatal error on 2nd instance: ends exactly once, no 3rd instance
- double `onend`: second is no-op via `endedForGen === gen`
- abort-in-gap (thread switch / chat abort): `onEnd` delivered, reducer `shouldApplyDraft=false` → no merge (correct)
- destroy-in-gap: `dead`/gen bump → no `onEnd`, `UNMOUNT` handles state
- InvalidStateError retry path: guarded by `wantListening` + gen, `onEnd` exactly once
- Hard-cap timer for continuous uses `maxListenMsForSession` (15 min, 30 min clamp); local engine stays classic 45 s

## ADR-020 checklist

Declaration present and accurate (Surface L0, Compose none, Trust = mic + long-session browser STT residual + `voice_privacy_ack_v3`, no auto-send, Channel community). v3 gate enforced in `useVoiceInput.ts:326-334` before continuous-browser start and persists via `SET_VOICE_PRIVACY_ACK_V3`. No new tools/gates/confirm families (v3 is an L0 privacy gate, justified by F-S-CD15 since v1/v2 don't cover long-session cloud STT). No `securityConfirmations.request` → originWs n/a. Pack boundary documented in ADR-024 (strip regex `^voice` covers new keys). Trust monotonicity holds — continuous inherits identical draft-only semantics, no loosening.

## Nits (non-blocking)

1. **Mid-session fatal error drops accumulated finals** — reducer `ENGINE_ERROR` clears `finals` (`session-reducer.ts:236-246`), so a `network` error at minute 14 of a 15-min continuous session loses everything dictated (only `baseText` survives). Pre-existing M1 semantic, consistent with the documented SoT, and not part of the r1 REJECT scope — worth revisiting in D1b/D2.
2. `onNeedPrivacyAckV3` fallback to v1 `onNeedPrivacyAck()` (`useVoiceInput.ts:330-331`) would loop v1 without satisfying the v3 gate — cosmetic; `App.tsx` always supplies the real callback.
3. First continuous attempt with neither ack shows two sequential sheets (v1 then v3) — safe, slightly awkward.
4. No automated test for the v3 privacy gate (hook-level, integration only); abort-during-gap is covered only by the analogous stop test (same branch).
5. v3 ack body pre-consents unshipped ASR Refiner (Claude r1 N3) — architecturally deliberate (one gate for continuous + refiner).

Both r1 blocking issues are closed with genuine regression tests that exercise the defect paths, machine gates are green, and the patch is current.

VERDICT: APPROVE_WITH_NITS
