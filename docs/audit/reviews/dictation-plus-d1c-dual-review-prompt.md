# Dual external review — Dictation+ D1c local continuous segments

**Batch**: `dictation-plus-d1c`  
**Branch**: `feat/dictation-plus-d1c`  
**Blast tier**: **T2** (longer local STT residual via multi-segment)  
**Machine**: chrome-extension `npm test` — **553 pass**

## Capability declaration (ADR-020)

```text
Surface:      L0
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        mic + local WS segment residual (max-1 STT still);
              continuous opt-in + privacy v3; no auto-send; no raised single-blob 45s server cap
Channel:      community
```

## What shipped

- `maxListenMsForSession("continuous", "local")` → 15m hard cap (segments still ≤45s)
- `local-stt-adapter` continuous mode: serial `parent-sN` `voice.stt` epochs, `onSegmentContinue`
- SM: `SEGMENT_CONTINUE` processing → listening; CAPTURE_STOPPED banner「本机识别中…」
- Settings copy + mic chrome for continuous local
- Classic local path preserved (one-shot)

## Floors

1. Do **not** raise companion `STT_MAX_RECORD_MS` to 15 min  
2. Serial segments only (no concurrent STT)  
3. No fake interim tokens  
4. Classic local regression  
5. Hard cap wall-clock; user stop ends after current segment  

## Out of scope

D2 hotkey/HUD, Meeting, concurrent dual-slot STT

## Reviewer instructions

Diff vs main. End with:

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
