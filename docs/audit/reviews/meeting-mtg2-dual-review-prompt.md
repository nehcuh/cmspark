# Dual external review — Meeting Mtg2 (speaker / silence-cut / upload)

**Batch**: `meeting-mtg2`  
**Branch**: `feat/meeting-mtg2-speaker-upload`  
**PR**: https://github.com/nehcuh/cmspark/pull/144  
**Base**: `origin/main` (f1468a2 Mtg1 merge)  
**Blast tier**: **T2** (transcript durable + optional audio decode → local STT → minutes LLM)  
**Machine**: companion meeting tests 14 pass; extension import+mutex 7 pass; tsc clean; CI build SUCCESS on PR

## Capability (ADR-020)

```text
Surface:      L0 workbench; audio import reuses voice.stt.* Surface (no new host surface)
L2-classes:   (none) from meeting
Compose:      Pack meeting-minutes still skills + system_prompt_append only
Autonomy:     n/a
Trust:        meeting_privacy_ack_v1 for import_text; audio import also needs voice_privacy_ack_v2
              + local model/binary; mutex via meetingCaptureActive during import
Channel:      community
```

## Shipped (this PR)

### Companion
- `silence-cut.ts`: paragraph/sentence cut, speaker prefix parse, timed gap, bulk/index speakers
- Handlers: `apply_silence_cut`, `set_speakers`, `bulk_speaker`, `import_text` (ack required)
- `set_transcript` default silence_cut (opt-out `silence_cut:false`)
- Pack copy: no auto diarize; version 0.3.0

### Extension
- MeetingPanel Mtg2 tools: default speaker, silence-cut, bulk label, text/audio file pickers
- `meeting-audio-import.ts`: Web Audio decode → 16k mono WAV segments → `transcribeWavViaStt`
- Import holds `meetingCaptureActive` (dictation mutex)

### Docs
- System audio **parking** research only: `docs/superpowers/specs/2026-08-08-meeting-system-audio-parking.md`
- SoT status line updated for Mtg2

## Floors (blocking if broken)
1. No auto-diarize claims / no invented speakers in minutes job path  
2. Pack has no voice*/autoStart/ack keys  
3. `import_text` requires `privacy_ack_v1`  
4. Audio import requires local STT readiness + v2 ack; mutex with dictation  
5. Origin fence still chrome-extension for meeting.*  
6. System audio not implemented as product (parking doc only)  
7. No auto-send minutes to chat  

## Known honest limits (not REJECT)
- Silence-cut is heuristic  
- Audio via existing Path B segment STT caps  
- System mix still parking  

Inspect: `companion/src/meeting/silence-cut.ts`, handlers, `MeetingPanel.tsx`, `meeting-audio-import.ts`.

End with exactly one of:  
`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
