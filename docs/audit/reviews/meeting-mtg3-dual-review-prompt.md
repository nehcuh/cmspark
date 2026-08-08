# Dual external review — Meeting Mtg3 auto-diarize

**Batch**: `meeting-mtg3`  
**Branch**: `feat/meeting-mtg3-auto-diarize`  
**PR**: https://github.com/nehcuh/cmspark/pull/145  
**Base**: `origin/main` (bc0bc66 Mtg2 merge)  
**Blast tier**: **T2** (local feature vectors + durable speaker labels on meetings/)  
**Machine**: companion mtg3-diarize 7 + meeting-minutes 9; extension audio-import 4; tsc clean

## Capability (ADR-020)

```text
Surface:      L0 workbench; reuses voice.stt.* for import only (no new host surface)
L2-classes:   (none)
Compose:      Pack meeting-minutes skills + system_prompt_append only
Autonomy:     n/a
Trust:        meeting_privacy_ack_v1 for auto_diarize; features only (no re-upload audio for cluster);
              experimental anonymous labels 发言人N — NOT identity
Channel:      community
```

## Shipped

### Design
- `docs/superpowers/specs/2026-08-08-meeting-mtg3-diarize-design.md` LOCKED floors

### Companion
- `auto-diarize.ts`: k-means, extractSegmentFeatures, audio_cluster / text_gap
- `meeting.auto_diarize` + validators + origin fence
- meta.diarize; minutes prompt allows existing labels only

### Extension
- Segment features on audio import; auto-diarize button; weak text_gap; optional post-import auto
- Honest UI copy (非身份识别)

## Floors (blocking if broken)
1. No claim of real-name / Otter-grade diarize  
2. `auto_diarize` requires privacy_ack_v1  
3. Pack has no voice*/autoStart  
4. audio_cluster requires features aligned with transcript lines  
5. Origin fence chrome-extension  
6. Labels are 发言人N style (or user-overridable), not invented real names by LLM job  
7. text_gap is explicitly weak / experimental  

## Known honest limits (not REJECT)
- Segment-level not word-level; k-means quality varies  
- Live capture without import has no features until audio re-import  
- System audio still parking  

Inspect: `companion/src/meeting/auto-diarize.ts`, handlers, MeetingPanel diarize UI.

End with exactly one of:  
`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
