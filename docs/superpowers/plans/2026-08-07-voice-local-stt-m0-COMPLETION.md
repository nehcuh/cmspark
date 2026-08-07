# Path B Local STT M0 — Completion Note

> **Date**: 2026-08-07  
> **Branch**: `feat/voice-local-stt-m0`  
> **Plan**: [2026-08-07-voice-local-stt-m0-impl.md](./2026-08-07-voice-local-stt-m0-impl.md)  
> **Status**: **M0 implemented** (Subagent-Driven Tasks 0–8)

---

## What shipped

| Layer | Capability |
|-------|------------|
| Manifest | In-repo `companion/assets/whisper-models.manifest.json` (small / medium / large-v3-turbo), https + sha256 pins |
| Download | `whisper-download.ts` — user-triggered, scoped budget on `models/whisper/`, cancel, delete, probe |
| Config | `config.voice.{ sttEngine, localModelId, modelDiskBudgetMB }` default browser / medium / 4096 |
| WS | `voice.model.*` only; mutators `source:"settings"` dual fence |
| Pack | Voice keys stripped/rejected on install/apply/save |
| Extension | Store mirror + Settings progressive disclosure (UI draft → enable when ready) |

## Explicit non-goals still true

- No `voice.stt.*` audio/transcription path  
- No `cmspark-whisper` binary packaging  
- No auto-download on boot  
- Human spike S0–S2 (real mic) still PENDING for **M1**

## Verification (machine)

```text
companion voice-*.test.js     70 pass
chrome-extension voice-*.test  (suite green in Task 6/7: 500+ pass)
rg voice.stt companion/src    empty
```

## Commits (main..HEAD)

```
feat(voice): Path B foundation — spike S0–S5, ADR-023, M0 plan
feat(voice-m0): whisper catalog + in-repo model manifest
feat(voice-m0): config.voice defaults and setVoiceFields
feat(voice-m0): whisper download/delete with scoped disk budget
feat(voice-m0): voice.model.* handlers and WS validation
fix(voice-m0): pack cannot write voice engine or model keys
feat(voice-m0): extension mirror for voice.model state
feat(voice-m0): settings UI for local STT model download
(+ docs completion)
```

## Manual smoke (before merge claim)

1. Start Companion; open Side Panel settings  
2. 听写方式 → 本机转写 (draft)  
3. Download **medium** once (large; network required)  
4. Progress → ready → **启用本机转写**  
5. Delete model → engine returns browser  
6. Browser mic (M1) still works  

## Next

M1 plan: binary package + STT session WS + local adapter + privacy ack v2 — after human S0–S2.
