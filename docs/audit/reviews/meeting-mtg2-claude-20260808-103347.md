I've inspected the real code, run the tests, and verified each floor. Let me finalize.

## Floor verification (all checked against actual code)

1. **No auto-diarize** — `silence-cut.ts:25-37` `parseSpeakerPrefix` only extracts when prefix exists; `bulkSetSpeaker`/`applySpeakersByIndex` use user-provided labels; pack.yaml §3 updated to forbid invention. ✅
2. **Pack clean** — pack.yaml diff only updates description/version/system_prompt_append/unsuitable_for. No voice*/autoStart/ack keys. ✅
3. **import_text ack** — `server.ts:5916-5924` validator AND `meeting-handlers.ts:250-253` handler both enforce `privacy_ack_v1 === true`. ✅
4. **Audio import readiness + v2 ack + mutex** — `MeetingPanel.tsx:645-668` checks dictation/capturing, `voicePrivacyAckV2`, local model+binary readiness, then sets `meetingCaptureActive=true`. App.tsx:437 blocks dictation when `meetingCaptureActive`. ✅
5. **Origin fence** — `meeting-handlers.ts:78-85` enforces `isChromeExtensionOrigin` at top of dispatcher; all new types inherit. ✅
6. **System audio = parking** — only `docs/superpowers/specs/2026-08-08-meeting-system-audio-parking.md`, marked PARKING. No code. ✅
7. **No auto-send to chat** — handlers return `meeting.minutes_result` to extension only. ✅

## ADR-020 checklist
- Capability declaration present in prompt (Surface/Compose/Autonomy/Trust/Channel). ✅
- Axes fit: audio import reuses existing voice.stt.* Surface; no new host Surface; no new agent runtime; pack stays skill+system_prompt_append. ✅
- Pack-first: new Mtg2 controls hang on existing MeetingPanel workbench, not new Side Panel chrome. ✅
- Confirm dialects: no new gate; import_text reuses meeting_privacy_ack_v1; audio reuses voice_privacy_ack_v2. ✅
- Trust monotonicity: deeper Surface (voice.stt.*) still requires chrome-extension origin + v2 ack; no L0 loosening. ✅
- originWs: N/A — no new `securityConfirmations.request` calls in diff. ✅
- P1 watchlist (god-mode/originWs/evaluate/shell): untouched. ✅

## Machine verification
- companion tsc clean; meeting-mtg2.test.ts + meeting-minutes.test.ts = **14 pass** ✅
- extension tsc clean; meeting-audio-import (4) + meeting-capture-mutex (3) = **7 pass** ✅
- Patch file matches `git diff origin/main..HEAD` (13 files, 1250+/19-) ✅

## Non-blocking nits

1. **`silenceCutTimedLines` is dead code** — `companion/src/meeting/silence-cut.ts:103-137`. No current producer of `t0`/`t1` exists (`meeting.append_transcript` handler doesn't set timing, Mtg1 STT segments have no timing). Either add a test exercising it or remove (YAGNI / Proportional Simplicity).
2. **Missing `return` after error finish()** — `chrome-extension/src/sidepanel/voice/meeting-audio-import.ts:224-229`. `finish()` is idempotent so not a bug, but inconsistent with the `voice.stt.result` branch which returns. Add `return` for symmetry.
3. **`setTimeout(…, 60)` race** — `MeetingPanel.tsx:556-613` (`applySilenceCut` / `bulkLabelSpeaker`). Dispatches `apply_silence_cut` 60ms after `set_transcript` and assumes disk write completes first. Functional but fragile — if WS roundtrip slips past 60ms the cut operates on stale lines. Consider chaining on the `meeting.updated` echo instead.
4. **Abort path unreachable** — `MeetingPanel.tsx:111/667/720` `importAbortRef` is initialised and checked but never set to `true` from any UI or unmount hook. The "导入已中止" status string is dead. Either expose an abort button or drop the ref.
5. **Memory peak for long decoded audio** — `meeting-audio-import.ts:115` allows 30 min. 30-min stereo 44.1k Float32 mixdown + 16k mono resample peaks near ~880 MB before chunking. Side Panel may OOM on borderline files. Consider progressive chunking or a stricter wall when `numberOfChannels > 1`.
6. **`meeting.set_speakers` server-side per-item shape not validated** — `server.ts:5903-5909` only checks `Array.isArray`. Handler coerces silently and `applySpeakersByIndex` skips bad indices, so safe; but a malformed item becomes invisible. Consider validating `{index:number, speaker?:string}` per item.
7. **`append_transcript` source enum narrows type** — `meeting-handlers.ts:186-189` coerces to `"stt" | "user_edit"` while `TranscriptSource` also allows `"paste" | "asr_refiner"`. Minor inconsistency, no runtime impact.

VERDICT: APPROVE_WITH_NITS
