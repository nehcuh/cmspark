# Dual external review — Meeting Mtg1 live capture

**Batch**: `meeting-mtg1-live-capture`  
**Branch**: `feat/meeting-mtg1-live-capture`  
**PR**: https://github.com/nehcuh/cmspark/pull/143  
**Base**: `origin/main` (666f0dd Mtg0 merge)  
**Blast tier**: **T2** (mic + local STT segments + durable transcript → minutes LLM)  
**Machine**: companion meeting-minutes 9/9; extension mutex 3/3; tsc clean both packages; CI build SUCCESS at open

## Capability (ADR-020)

```text
Surface:      L0 workbench (document artifact); capture uses existing voice.stt.* Surface
L2-classes:   (none) from meeting capture itself
Compose:      Pack meeting-minutes still skills + system_prompt_append only (no voice*/autoStart)
Autonomy:     n/a
Trust:        meeting_privacy_ack_v1 required for meeting.start;
              local STT also needs voice_privacy_ack_v2 + model/binary ready;
              default delete meetings/<id>/audio on end when not retained;
              minutes text → user LLM (existing job)
Channel:      community
```

## Shipped (this PR only — Mtg1 gap fill)

### Companion
- `meeting.start` — requires `privacy_ack_v1 === true`; create or resume; status=recording; stt_engine=local; optional audio_retained ≤7d
- `meeting.end` — status=ready; default `deleteMeetingAudio` when not retained; returns `audio_deleted`
- Store helpers: `startMeetingRecording` / `endMeetingRecording` / `meetingAudioDir`
- Validators + message-router + tests (need_ack, delete audio, retain opt-in)

### Extension
- MeetingPanel: **开始录制** → continuous local STT via `createLocalSttAdapter` (D1c segments, hard cap 15m) → append local + `meeting.append_transcript` → **结束 / 结束并生成纪要**
- Mutual exclusion: `meetingCaptureActive` / `dictationCaptureActive` in agentStore; composer mic blocked while meeting captures; reverse blocks Start
- No pack auto-mic; close panel attempts stop without generate

## Floors to verify (blocking if broken)
1. **No start without meeting ack** — server + UI (voice_privacy_ack_v3 must NOT substitute)  
2. **Pack still has no voice*/autoStart/ack keys**  
3. **Long capture is local-only** (no browser Web Speech path in MeetingPanel)  
4. **Default audio policy**: end deletes `meetings/<id>/audio` when not retained (test proves)  
5. **Dictation ↔ meeting mutex** (store flags + allowStart)  
6. **Origin fence** still chrome-extension for meeting.*  
7. **No auto-send** minutes to chat (draft only)  
8. **No double meeting.end / double generate** races on stop  

## Known honest limits (not REJECT)
- Path B STT still uses `tmp/voice-stt` for segment blobs; durable `meetings/*/audio` is the optional retain bucket — default delete still correct for residual files  
- Diarize / system mix still out of scope  

## Out of scope
- Mtg2 speaker labels, file upload, system audio  
- Mtg3 auto diarize  

Inspect real files under `companion/src/meeting/`, `chrome-extension/src/sidepanel/components/MeetingPanel.tsx`, store flags in `agentStore` + `App.tsx`.

End with exactly one of:  
`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
