# Dual external review — Whisper M2 progressive local streaming

**Batch**: `whisper-m2-stream`  
**Scope**: Path B local STT **progressive hypothesis streaming** (re-decode cumulative audio + prefix stabilize)  
**Blast tier**: **T2** (L0 input; new `voice.stt.partial_request` + `partial.status=hypothesis` text)  
**Machine**:
- companion `npx tsx --test tests/voice-stt-partial.test.ts` — 3 pass
- chrome-extension stream-stabilize / hotkey tests green in suite

## Capability (ADR-020)

```text
Surface:      L0 composer draft only
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        mic + local Companion tmp + whisper.cpp re-decode residual;
              no auto-send; no silent browser fallback
Channel:      community; opt-in local + continuous + voiceRealtimeStreaming
```

## What shipped

### Protocol (ADR-023 amendment)

- `voice.stt.partial_request` E→C
- `voice.stt.partial` may carry `status:"hypothesis"` + `text` (progressive re-decode)
- Status-only `receiving`/`transcribing` unchanged

### Companion

- `SttSessionCore.snapshotAudio` — non-destructive reassembly
- `SttSessionService.partial` — rate-limited (≥1.2s), min audio bytes, cancels prior partial, wraps pcm as WAV
- `pcm-wav.ts` — wrap pcm_s16le for whisper-cli
- Final `end` also wraps pcm → wav

### Extension

- `pcm-stream-capture.ts` — ScriptProcessor → 16 kHz s16le chunks
- `stream-stabilize.ts` — LCP / agreement promotion (CJK-safe chars)
- `local-stt-adapter` continuous + `streamPartial`: live chunk + poll partial_request + end finalize
- Gate: `voiceRealtimeStreaming` + continuous + local engine

### Explicit honesty

- **Not** whisper decoder token streaming
- Latency ≈ max(1.2s poll, whisper infer time) per hypothesis
- CPU cost: multiple whisper runs per utterance

## Floors to verify

1. No auto-send  
2. No silent local→browser fallback  
3. max-1 session: partial must not end receiving session  
4. Origin fence still chrome-extension only  
5. No logging of audio base64 or full transcripts  
6. Classic / non-stream continuous path zero regression  
7. Idle timer not forceAbort while PCM chunks flowing  
8. Abort cancels partial + pcm stream  
9. Marketing copy must not claim "true decoder streaming"

## Reviewer instructions

1. Read attached git diff.  
2. Spec: ADR-023 + local STT SoT M2 progressive re-decode.  
3. Security: peer bind, path sandbox for partial tmp dirs, rate limit abuse.  
4. Race: partial vs end, partial vs abort, multi-window continuous.  
5. End with exactly one line:

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`

Nits non-blocking. REJECT requires concrete fix list.
