# Path B Local STT M1 — Completion Note

> **Date**: 2026-08-07  
> **Branch**: `feat/voice-local-stt-m1` (stacked on M0)  
> **Plan**: [2026-08-07-voice-local-stt-m1-impl.md](./2026-08-07-voice-local-stt-m1-impl.md)  
> **Status**: **M1 code complete** (Subagent-Driven T0–T7, T9; T8 optional skipped)

---

## What shipped

| Layer | Capability |
|-------|------------|
| Reducer | `processing` phase + `CAPTURE_STOPPED` (local only) |
| Privacy | `voice_privacy_ack_v2` + residual copy; local error map §6.5 |
| Companion | tmp sandbox + GC, whisper-runner, SttSessionService, `voice.stt.*` handlers |
| Origin | chrome-extension only; tray denied |
| Binary | pin + build script + package.sh soft stage; dist binary gitignored |
| Extension | audio-capture → local adapter → WS chunks; engine factory; mic matrix |
| UX | 45s countdown badge, processing spinner, CTA 改用浏览器 / 去设置 |

## Machine verification `[executed]`

```text
companion voice-*.test.js     113 pass
chrome-extension voice-*.test  68 pass
```

## Explicit residuals

1. **dylib packaging**: brew `whisper-cli` copy under `dist/bin` may need Homebrew dylibs; production needs static/self-contained `cmspark-whisper` or embed libs. Dev can set `CMSPARK_WHISPER_UNPINNED=1` and ensure PATH `whisper-cli` works, or improve resolve to prefer PATH when pin binary fails dyld.
2. **T8 Qwen soft gate**: not implemented — resource_conflict remains residual; soft only.
3. **Human S0–S2 / e2e Chinese ≥15 字**: still operator checklist (below).
4. **Windows/Linux binary**: pins empty; local Disable until built.

## Commits (M1-only, on top of M0)

```
feat(voice-m1): session-reducer processing phase for local STT
feat(voice-m1): local STT error map and privacy ack v2
feat(voice-m1): STT tmp, whisper-runner, session service
feat(voice-m1): voice.stt.* WS protocol and handlers
feat(voice-m1): cmspark-whisper package pins and resolve
feat(voice-m1): local STT adapter and engine factory
feat(voice-m1): local listening/processing chrome and browser CTA
(+ this completion note)
```

## Manual acceptance (before merge claim)

| # | Check |
|---|--------|
| 1 | engine=browser: Companion disconnected still can dictate (Web Speech) |
| 2 | M0 path: download medium → 启用本机转写 |
| 3 | Local 🎤: privacy v2 → record → processing → draft text |
| 4 | Abort mid-record and mid-processing |
| 5 | Disconnect mid-local → banner not silent browser |
| 6 | CTA「改用浏览器听写」works + cloud residual visible |
| 7 | `~/.cmspark-agent/tmp/voice-stt` empty after sessions |
| 8 | Companion logs: no full transcript / no base64 audio |

### Dev binary tip

```bash
# ensure brew whisper-cpp installed
bash companion/scripts/build-cmspark-whisper.sh --write-pins
# if dyld fails on dist copy, use PATH for dev:
export CMSPARK_WHISPER_UNPINNED=1
# and ensure resolve finds /opt/homebrew/bin/whisper-cli (may need small follow-up)
```

## Next

- Fix self-contained binary packaging (dylib bundle or static build)  
- Human e2e QA + PR dual-review  
- Optional T8 resource confirm when Qwen loaded  
