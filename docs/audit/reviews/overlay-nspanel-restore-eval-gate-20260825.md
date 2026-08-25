# Eval gate card — overlay-nspanel-restore-20260825

**Blast tier**: T2  
**Date**: 2026-08-25  
**Base**: `feat/knowledge-honesty-wave0` vs HEAD `2dee37a` (uncommitted NSPanel restore + Slice A)

## Capability declaration (ADR-020)

```text
Surface:      L0 overlay Darwin NSPanel restore + 📎/🎙 paint; L0 Side Panel markdown/pack
L2-classes:   (none)
Compose:      overlay pack.apply rail (pre-existing); knowledge USE via thread ids only
Autonomy:     n/a
Trust:        overlay ACL no-grow; no HTML getUserMedia; files via existing file.upload
Channel:      community
```

## Machine (must pass first)

- [x] `npx tsx --test tests/summoner-overlay.test.ts tests/summoner-protocol.test.ts tests/summoner-web.test.ts tests/summoner-acl.test.ts` → **95 pass / 0 fail** `[executed]`
- [x] `npx tsx --test tests/markdown-breaks.test.ts` (chrome-extension) → **2 pass** `[executed]`
- [x] `validateWsMessage` empty MIME → invalid 「每个文件需要 name, type, content 字段」 `[executed]`
- [x] SHA pin == `companion/dist/cmspark-tray` == `5d17fe174b241491a0c1c1071f9dc6494a09aad3506a813d2544d5b170ecb44b` `[executed]`
- [x] Outcome DoD (external): 📎 small `.txt` from NSPanel into current overlay thread **and** HUD shows success/error — **FAIL** (empty MIME + unmapped `file.upload_error`)
- [x] No forbidden tools/paths / no default-on surprise — ACL no `knowledge.*` / HTML STT `[inspected]`

## Trajectory

- [x] Diff scope matches “restore Mac HUD + paint 📎/🎙” — **plus** Slice A (valid leftover) and HTML hint copy
- [ ] Thrash: Slice B HTML Darwin was dual-approved then user-rejected then inverted without SUPERSEDED spec — **process thrash**, not tool spam

## Component

- `companion/src/tray/SummonerOverlay.swift:646-664` empty MIME
- `companion/src/ws/validate.ts:781` truthy `type`
- `companion/src/menu-bar-agent.ts:1117-1142` no lease claim
- `companion/src/summoner/client.ts` no `file.upload_*` map
- `companion/src/tray/SummonerOverlay.swift:1029-1038` titled 640 + `:966` 200pt rail

## Judges（确认序：独立对抗 → Pi 复审）

- [x] Product: `docs/audit/reviews/overlay-nspanel-restore-adversary-product-20260825.md` · **REJECT**
- [x] Impl: `docs/audit/reviews/overlay-nspanel-restore-adversary-impl-20260825.md` · **REJECT**
- [x] Security: `docs/audit/reviews/overlay-nspanel-restore-adversary-security-20260825.md` · **APPROVE_WITH_NITS**
- [x] External: `docs/audit/reviews/overlay-nspanel-restore-adversary-external-20260825.md` · **REJECT**
- [x] Pi 复审: `docs/audit/reviews/overlay-nspanel-restore-pi-20260825-150534.md` · **REJECT**
- [x] Claude dual: `docs/audit/reviews/overlay-nspanel-restore-claude-20260825-150534.md` · **REJECT**
- [x] Verdict JSON: `docs/audit/reviews/overlay-nspanel-restore-verdict-20260825-150534.json` · `both_approve: false`
- [ ] Nits folded — **not started** (review-only turn)

## Blast

- [x] T2: MERGE requires MACHINE + 对抗 APPROVE* + Pi APPROVE*
- [x] Residual: 📎 dead; IA workbench; stale `142137` HTML APPROVE on disk

## Verdict

| Gate | Result |
|------|--------|
| MACHINE | **PASS tests / FAIL DoD** (tests cannot see dead 📎) |
| ADVERSARY | **REJECT** (3/4 REJECT; Security AWN only) |
| PI_REREVIEW | **REJECT** (Claude REJECT + Pi REJECT) |
| MERGE | **NO** — 对抗 REJECT + Pi REJECT 不 waive |
