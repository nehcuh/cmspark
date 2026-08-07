# Pi re-review: Path B Local STT product design SoT (post four-lane adversary)

**Batch:** `voice-local-stt-design`  
**Stage:** External Pi confirmation after internal adversarial synthesis  
**Date:** 2026-08-07  

## Context

CMspark already shipped M1 voice input via Chrome Web Speech (draft only). Path B adds **optional local Whisper (whisper.cpp)** with user-selected model download and Companion transcription. Four-lane adversary (Product/Security/Platform/Impl) all returned **MAJOR_REVISE**; floors were merged into SoT.

User pre-decisions retained after adversary: whisper.cpp; Ext→WS→Companion audio; models small/medium/turbo (UI recommends medium); binary ships with Companion.

## Read these (in order)

1. `docs/superpowers/specs/2026-08-07-voice-local-stt-design.md` — **SoT under review**
2. `docs/audit/reviews/voice-local-stt-adversary-synthesis-20260807.md` — floors + conflict resolution
3. Optional contrast: `docs/superpowers/specs/2026-08-07-voice-local-stt-design-strawman.md`
4. M1 baseline: `docs/superpowers/specs/2026-08-06-voice-input-design.md` (must not regress)
5. Spot-check: `chrome-extension/src/sidepanel/hooks/useVoiceInput.ts`, `SettingsSlideout.tsx` voice block, `companion/src/computer/model-download.ts` patterns
6. ADR-020 checklist style: `docs/adr/020-capability-model-three-axes.md`
7. Dual-review checklist: `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Your job

Independent senior product/security/platform reviewer. **Do not rubber-stamp.**

1. Verify SoT absorbs adversary floors (F-UX-B*, F-S-B*, F-C-B*, F-I-B*) — call out missing, weakened, or contradictory floors.
2. Check conflict resolutions especially: **one-click switch to browser STT**, prefs SoT split, PCM vs ffmpeg, medium as recommended, Qwen coexistence.
3. Privacy honesty for **dual engines** (no false 完全本地; local must not keep M1 “audio never hits Companion”).
4. ADR-020: L0 only; no Trust elevation via voice; Pack cannot write voice risk keys.
5. M1 regression: browser path must remain usable without Companion when engine=browser.
6. Flag **ship-blockers before spike/M0** vs **non-blocking nits**.
7. Challenge whether recommended model **medium** is right vs turbo for short Chinese commands + disk.

## Verdict rules

End with **exactly one** of:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

- **REJECT** if SoT still allows silent cloud fallback, lies about privacy, elevates Surface/L2, dual-write prefs without SoT, ffmpeg as required path, or auto-send.
- **APPROVE_WITH_NITS** if floors present but minor gaps remain (list nits before VERDICT).
- **APPROVE** only if ready for spike + M0 without further SoT rewrite.

Use Read/Bash on real files. Cite paths for blocking issues.
