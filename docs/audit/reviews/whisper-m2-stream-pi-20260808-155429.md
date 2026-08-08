I've completed a full read of the diff against the actual sources and verified the tests. Here's my review.

---

## Dual external review — `whisper-m2-stream`

### Tests (verified)
- `companion/tests/voice-stt-partial.test.ts` — 3/3 pass ✓
- `chrome-extension/tests/stream-stabilize.test.ts` — 4/4 pass ✓
- `chrome-extension/tests/hotkey-chord.test.ts` — 7/7 pass ✓

### Floors
1. **No auto-send** — PASS. `onDraft` only; nothing issues a chat send from the STT path.
2. **No silent local→browser fallback** — PASS. `localGateError()` is fail-closed; `sttEngine` is never downgraded.
3. **Max-1 session, partial doesn't end** — PASS. `snapshotAudio` is non-destructive; `service.partial` never touches `core.end`; test asserts phase stays `receiving`.
4. **Origin fence** — PASS. `partial_request` routes through `handleVoiceSttMessage` with `isChromeExtensionOrigin` + peer bind; `validateWsMessage` entry added.
5. **No audio/transcript logging** — PASS. Handler logs sessionId/seq/bytes/ms/modelId/textLen only; partial rejects log `code` only.
6. **Classic / non-stream continuous** — PASS. `runContinuous`/`runClassic` bodies unchanged (only an early `streamPartial` branch); Web Speech adapter only gains a doc-commented optional field.
7. **Idle timer while PCM flows** — MOSTLY PASS, with a real caveat (finding F7).
8. **Abort cancels partial + pcm** — PARTIAL. Extension aborts the PCM stream and sends `voice.stt.abort`; but the companion's in-flight partial whisper child is NOT cancelled by `abort()`/`forceAbort()` (finding F6).
9. **Copy honesty re decoder streaming** — PASS on the decoder-token claim ("非 decoder token 流" in both UI copy and ADR table). BUT the "约 8 秒一段" claim is factually wrong vs actual behavior (finding F1).

### Security
- **Peer bind**: `requirePeer` on start/chunk/partial/end/abort — sound.
- **Path sandbox**: partial tmp dir `createSessionDir(`${sessionId}-p${now}`)` stays in `[a-zA-Z0-9_-]` (sessionId pre-sanitized), 0o700 dir / 0o600 file, basename-only filename. Sound. One edge: a ≥115-char sessionId makes the suffix exceed the 128-char `sanitizeSessionId` cap → `resource_conflict` error mid-stream (compounds F4).
- **Rate-limit abuse**: per-session 1.2 s wall clock + min 0.8 s audio + max one partial child (new cancels old) + 25 s partial timeout. An origin-fenced first-party extension can churn sessions to peg CPU, but that's outside the trust model. Acceptable.

### Findings (by severity)

**F1 — Window cap is dead code; streaming windows are up to 45 s, not 8 s. (blocking)**
`runStreamingContinuous` computes `windowMs = Math.min(LOCAL_STT_MAX_RECORD_MS, remaining)` (adapter L387) and never references `segmentCapMs`, which `start()` sets to `LOCAL_STT_NEAR_REALTIME_SEGMENT_MS` (8 000) when `streamPartial` is true. `segmentCapMs` is only used in the non-streaming `runContinuous` (L546-549). So the 8 s near-realtime segment is dead in exactly the path it was designed for, and the UI copy ("本机约 8 秒一段", SettingsSlideout L702/L1149) overpromises. Every window is ≤45 s of cumulative audio.

**F2 — Hypothesis starvation: every poll cancels the in-flight partial, so nothing completes when whisper > ~1.4 s. (blocking)**
Extension polls at 1 400 ms; companion rate limit is ≥1 200 ms, so **every** poll passes the gate and then *aborts the running partial and starts a fresh one* (service L243-249). A hypothesis is only delivered if whisper finishes within the poll gap. Default model is `medium`; whisper on just a few seconds of audio with medium (and, per F1, on 45 s cumulative audio with *any* model) exceeds 1.4 s. Net effect: progressive hypotheses silently stop appearing a few seconds into every utterance; the 25 s partial timeout and the "cancel prior" logic turn into an abort/restart loop. The tests only exercise an instant fake runner, so this is untested. The batch's stated latency model ("≈ max(1.2 s poll, infer time)") is wrong in practice — the delivered hypothesis requires infer < poll gap.

**F3 — No retraction on revision → duplicated/garbled draft text. (medium)**
`finals` is append-only; `promoteStableByAgreement` commits `newlyStable` as `finalChunk` mid-session, and nothing can retract it. If the window-final re-decode (or a later hypothesis) revises a *committed* prefix, `runStreamingContinuous` falls into `newly = finalText` (L442-446) and re-emits the entire divergent text as a new final. Example: stable committed "打开设置", final decodes "打开窗口设置" → draft becomes "打开设置打开窗口设置". F1 makes this revision likely (45 s full re-decode). `stream-stabilize.ts` handles interim retreats, but committed text has no retreat path.

**F4 — Partial failures tear down the whole continuous session. (medium)**
`onWs` treats any `voice.stt.error` with `pending === null` (true during streaming polls) as fatal: `onError` + `onEnd` + `reset`. Only `partial_skipped`/`partial_busy` are soft in the handler; `infer_timeout` (25 s partial cap, more likely under F1), `resource_conflict`, `hash_fail`, `model_missing`, `binary_missing` are sent as errors and kill the live session. A best-effort progressive feature failing must not end dictation.

**F5 — TOCTOU: partial can run concurrently with the final decode. (low)**
Messages are handled concurrently per connection. A `partial_request` can pass the `bound.inferring` check just before `end()` sets it, then run whisper in parallel with the final (result is dropped via the post-run check, but two whisper children compete for CPU and can push the final toward its 90 s timeout).

**F6 — `abort()`/`forceAbort()` don't cancel the in-flight partial. (low)**
Only `end()` aborts `partialAbort`. A partial whisper child keeps running up to its 25 s timeout after session abort — CPU waste, no correctness impact.

**F7 — Streaming sends `voice.stt.start` *before* `getUserMedia` resolves. (low-medium)**
`runStreamingContinuous` sends start, then awaits `startPcmStreamCapture` → gUM. If gUM takes > 10 s (`STT_UPLOAD_IDLE_MS`), the idle timer forceAborts the session before the first chunk; subsequent chunks error with `session_unknown` and the extension tears down. The non-streaming path's comment (L294-296) explicitly documents this as "Pi D1c blocker #2" and avoids it by starting after recording. Related: the AudioContext is never `resume()`d — if it starts suspended, `onaudioprocess` never fires and the session silently dies on idle-abort.

**Nits**
- `bound.partialInferring` is set but never read — the intended "partial busy" gate is unused (its absence is the root of F2).
- `destroy()` during streaming clears the segment timer without firing `segmentStopTrigger` → the window wait promise never resolves (leaked suspended coroutine; mic is released via `reset()`, so no user impact).
- Partial tmp dir name can exceed the 128-char sanitize cap (see Security).
- Diff bundles out-of-scope hunks (`SettingsIntentBar`, `HotkeyCaptureField`, `settings-intent`, `hotkey-chord`) — flagging for scope hygiene, not reviewed in depth.

### Concrete fix list (for REJECT)
1. **F1**: use `Math.min(segmentCapMs, LOCAL_STT_MAX_RECORD_MS, remaining)` for `windowMs` in `runStreamingContinuous`, or align the copy to actual windows.
2. **F2**: stop cancelling in-flight partials — return `partial_busy` when a partial is running (wire up `partialInferring`), and/or have the extension await the partial response before re-polling; ensure effective cadence is ≥ expected infer time.
3. **F3**: on window-final divergence from `streamStable`, do not re-emit the full text (emit only the non-overlapping tail, or keep the committed stable); consider interim-only within a window and commit only at window end.
4. **F4**: treat partial-origin failures (`infer_timeout`, `resource_conflict`, binary/model errors) as soft skips in the handler, or make the extension ignore non-session errors while streaming.
5. **F5/F6**: re-check `bound.inferring` after the partial run starts; abort `partialAbort` in `abort()`/`forceAbort()`.
6. **F7**: resolve gUM (and `ctx.resume()`) before sending `voice.stt.start`, or send a heartbeat; surface suspended-context as an error rather than silent idle-abort.
7. **Tests**: add a slow-runner test (e.g., 2 s fake whisper) proving hypotheses still deliver under the poll cadence, and a test asserting the streaming window honors `segmentCapMs`.

VERDICT: REJECT
