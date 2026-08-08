# Dual external review — Meeting minutes Mtg0 + workbench

**Batch**: `meeting-minutes-mtg01`  
**Branch**: `feat/meeting-minutes-mtg01`  
**Blast tier**: **T2** (transcript → LLM minutes; durable local meeting store)  
**Machine**: companion `meeting-minutes` 6/6; chrome-extension 556 pass; tsc clean

## Capability (ADR-020)

```text
Surface:      L0 workbench (document artifact)
L2-classes:   (none) from meeting itself
Compose:      Pack meeting-minutes (skills + system_prompt_append only; no voice* / autoStart)
Autonomy:     n/a
Trust:        durable transcript under meetings/; minutes text→LLM;
              meeting_privacy_ack_v1; Pack never auto-starts mic
Channel:      community
```

## Shipped

### Mtg0
- Builtin pack `meeting-minutes` + skill; honest copy (no diarize, no auto-mic)
- `meeting.generate_minutes` text-only job with fixed `MEETING_MINUTES_SYSTEM_PROMPT` (≠ ASR refiner)

### Store + WS
- `~/.cmspark-agent/meetings/<id>/` meta + transcript + minutes (0o700/0o600)
- `meeting.create|list|get|set_transcript|append_transcript|generate_minutes|set_status`
- chrome-extension origin fence

### UI
- Context panel **会议** + `/meeting` slash
- Paste → generate → copy / 发送到对话草稿 (never auto-send)
- Privacy ack sheet

## Explicitly out (SoT parking)
- Live long meeting capture workbench (can use Dictation+ continuous local + paste)
- Diarize, system audio mix, auto-start mic

## Floors to verify
1. Pack has no voice*/autoStart keys  
2. Minutes job forbids invention; distinct from asr_refiner  
3. No auto-send to chat  
4. Origin fence tray denied  
5. Path containment for meeting ids  

End with: `VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
