Confirmed both material findings by direct read. Writing the verdict now.

---

# External Review — Whisper M2 Progressive Local Streaming

**Spec basis**: ADR-023 amendment (M2 progressive re-decode + prefix stabilize, **not** decoder token streaming). All nine reviewer floors addressed below.

## Floor verification — all PASS

| # | Floor | Verdict | Evidence |
|---|---|---|---|
| 1 | No auto-send | **PASS** | `useVoiceInput.ts:326-331` ENGINE_RESULT → reducer → `onDraft(partial)` only; no send/submit/compose call on streaming path |
| 2 | No silent local→browser fallback | **PASS** | `useVoiceInput.ts:119` picks engine strictly from `opts.sttEngine`; streaming capture failure → `onError("audio-capture")` + `onEnd` + `reset`, no engine swap |
| 3 | max-1 session: partial must not end receiving session | **PASS** | `snapshotAudio` (stt-session-core.ts:136-167) is non-destructive; `partial()` returns ok without phase change; segment sub-session `${parent}-s${n}` is per-window, not the parent |
| 4 | Origin fence chrome-extension only | **PASS** | `stt-handlers.ts:123-140` `isChromeExtensionOrigin` applied to all `voice.stt.*` including `partial_request` (message-router.ts:1921) |
| 5 | No logging of audio base64 / transcripts | **PASS** | No `console.`/`logger.` in pcm-stream-capture / stream-stabilize / streaming branch of local-stt-adapter; handler logs only `{sessionId, code}` on rejection |
| 6 | Classic / non-stream continuous zero regression | **PASS** | `runContinuous` early-returns to `runStreamingContinuous` only when `streamPartial===true` (local-stt-adapter.ts:538-541); `segmentCapMs`/`streamPartial` flags initialized to legacy defaults |
| 7 | Idle timer not forceAbort while PCM chunks flowing | **PASS** | `chunk()` → `armIdleTimer()` (stt-session-service.ts:199-204); PCM bursts at ~256ms cadence keep resetting; partial_request alone does NOT reset idle (correct) |
| 8 | Abort cancels partial + pcm stream | **PARTIAL** | Adapter side: clean (partialTimer + pcmStream.abort + send abort, local-stt-adapter.ts:737-773). Companion side: see N1 below |
| 9 | Marketing copy honest | **PASS** | Checkbox label + green banner + SettingsIntentBar all explicitly say "渐进重解码假设"/"非 decoder token 流"; no "true decoder streaming" / "real-time token" claim |

## Path sandbox / peer bind / rate-limit

- **Path sandbox**: `sanitizeSessionId` rejects `..` `/` `\` and enforces `/^[a-zA-Z0-9_-]+$/`; `-p${now}` suffix is digit+hyphen only; `createSessionDir` re-sanitizes + `assertWithin` on realpath. **Fine.**
- **Peer bind**: `requirePeer` at top of `partial()` (stt-session-service.ts:213); cross-peer partial_request → `peer_mismatch`. **Fine.**
- **Rate limit**: `lastPartialAt` on `BoundSession`, service is process singleton with one `bound` slot — multi-session bypass is impossible because there is no multi-session. **Fine.**

## Nits (non-blocking, ordered by impact)

**N1 — abort/forceAbort does not cancel in-flight partial infer.**
`stt-session-service.ts:424-445 (abort)` and `:447-462 (forceAbort)` call `bound.abortController.abort()` but never `bound.partialAbort?.abort()`. The partial whisper run was started with `signal: pac.signal` (line 272) — the *partial* controller, not the session one. So a `voice.stt.abort` arriving during a partial infer leaves an orphan whisper process running up to `STT_PARTIAL_INFER_MAX_MS` (25s wall, though practical small/medium model runtime is ~1-3s). Tmp dir is reclaimed by partial's own `finally`; result is correctly dropped by the `this.bound?.sessionId !== sessionId` check at line 278. Bounded CPU leak per occurrence. **Fix**: in both `abort()` and `forceAbort()`, also call `this.bound?.partialAbort?.abort()`.

**N2 — `start()` overwrites a still-inferring bound.**
`stt-session-service.ts:180-193`. After `end()` flips core phase to `ended` but before final whisper completes (`bound.inferring===true`), a rapid `voice.stt.start` for a new session passes `core.start()` (which only blocks `receiving`) and unconditionally overwrites `this.bound`. The previous final whisper: (a) keeps running orphaned, (b) its `this.bound.inferring = false` write lands on the new bound, (c) its result is dropped by the `sessionId` guard in `end()`'s post-await block. Result: leaked whisper spawn + tmp dir for ~5-25s + lost transcript of the first session. **Fix**: at top of `start()`, reject with `resource_conflict` if `this.bound?.inferring || this.bound?.partialInferring`.

**N3 — Soft `stop()` during `getUserMedia` await runs an unintended full window.**
`local-stt-adapter.ts:411-436`. `startPcmStreamCapture` awaits gUM. If user toggles stop before it resolves, `segmentStopTrigger` is not yet installed (set at line 460 post-await) and soft `stop()` does not bump `loopGen`. After gUM resolves, the segment runs its full `windowMs`. Only `abort()` (which bumps loopGen at line 741) interrupts cleanly. **Fix**: in `stop()`'s continuous + `phase==="recording"` branch, also handle the pre-await window by setting a `pendingStop` flag checked after the await.

**N4 — Orphan partial response between `end` send and next iteration.**
`local-stt-adapter.ts:177-193 vs 487-497`. A `voice.stt.partial` arriving in the narrow window between `voice.stt.end` send and the next loop iteration's `sessionId` reassignment could trigger one extra `onResult` after the final. The companion's `end()` does abort in-flight partials (line 324), so this only manifests if the partial infer completed before `end` arrived and the response is in flight on the wire. Cosmetic — extra interim flicker, no data loss. **Fix**: in `onWs` partial handler, drop if `phase !== "recording"`.

**N5 — ScriptProcessor deprecation acknowledged only in comment.**
`pcm-stream-capture.ts:64-65`. No AudioWorklet fallback; relies on Chrome keeping ScriptProcessor alive in extension context. Fine for ship; flag for future migration.

## Stabilizer correctness

`stream-stabilize.ts` `promoteStableByAgreement` correctly: (a) bootstraps with interim-only on first hypothesis, (b) grows stable only on `agreed.startsWith(stable)` (forward monotonic), (c) retreats to LCP on conflict, (d) never shrinks `newlyStable` to negative. CJK-safe char-level LCP. Test coverage in `stream-stabilize.test.ts` exercises all three branches. **Fine.**

## WAV wrapping

`pcm-wav.ts` correctly emits RIFF/WAVE/fmt /data headers; sample rate × channels × 2 byte-rate; 16-bit field. `audioBodyForWhisper` is now used by both `end()` and `partial()` — fixes a latent issue where the previous `end()` wrote raw `.pcm` for `pcm_s16le` format, which whisper-cli cannot ingest without a container. **Fix, not regression.** One nit: when `format==="wav"`, the body is passed through unchanged but the file is always named `audio.wav` — if a caller uploads a body that isn't actually WAV, this mislabels. Not currently reachable (extension always sends `pcm_s16le`), but worth a defensive check.

---

VERDICT: APPROVE_WITH_NITS
