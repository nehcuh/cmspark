# Eval gate card — voice-classic-idle-20260819

**Blast tier**: T2  
**Date**: 2026-08-19  
**Base**: working tree on `main` (ahead 1) · 未 commit

## Capability declaration (ADR-020)

```text
Surface:      L0 输入 only（composer 草稿）
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        本机 PCM/WAV → Companion whisper；不抬 confirm / auto_approve
Channel:      已鉴权 chrome-extension WS · 既有 voice.stt.*
```

## Machine (must pass first)

- [x] `npx tsx --test tests/voice-*.test.ts` — **96 pass** · exit 0 `[executed]`（实现会话 95；Pi 复审自跑含 backoff 测为 96）
- [x] `npx tsc --noEmit` — exit 0 `[executed]`
- [x] 未改 companion idle 合同（S1 未做）
- [x] Outcome DoD:
  - 经典录音期间 **无** `voice.stt.start`
  - `capture.stop()` 后立刻 start+chunk+end
  - `resource_conflict` 一次 `-r1` 重试
  - `session_unknown` 中文 banner，不是「未识别到内容」
- [x] 无 default-on / 无新工具 / 无静默回云

## Trajectory

- [x] Diff 仅 adapter C1 + error-map/reducer 诚实映射 + 测试 + 对抗过程件
- [x] 无 drive-by

## Component

- `chrome-extension/src/sidepanel/voice/local-stt-adapter.ts` `runClassic` / `stop()`
- `chrome-extension/src/sidepanel/voice/error-map.ts` `session_unknown`
- `chrome-extension/src/sidepanel/voice/session-reducer.ts` LOCAL_STT_ERROR_CODES

## Judges（确认序：独立对抗 → Pi 复审）

- [x] **设计对抗** 三路 + 合成：`voice-classic-idle-adversary-synthesis-20260819.md`
- [x] **实现对抗** `explore` vs synthesis+diff：**APPROVE_WITH_NITS**（P1：retry 未看 `loopGen`）
- [x] P1 已 fold：`genAtStop !== loopGen` 取消后不 `-r1`；测 `classic: abort during conflict backoff does not start -r1`
- [x] **Pi 复审** `voice-classic-idle-pi-20260819-164619.md` · **APPROVE_WITH_NITS**（P2 only；自跑 27+96+16+tsc 全绿）
- [x] Nits：S1 已按 A 路砍掉；B 路文案已 fold；实现 P1 已折；Pi P2 不挡合入

## Blast

- [x] T2：对抗+Pi 均 APPROVE* 才可合
- [x] Residual：large 无 interim（已文档化）；medium `.part` 未修

## Verdict

| Gate | Result |
|------|--------|
| MACHINE | PASS |
| ADVERSARY (design) | APPROVE_WITH_NITS（合成锁 C1-only） |
| ADVERSARY (impl) | APPROVE_WITH_NITS → nits folded |
| PI_REREVIEW | **APPROVE_WITH_NITS** |
| MERGE | **YES（闸门）** — MACHINE + 对抗 + Pi 均为 APPROVE*；未 commit / 未 PR / 未 CI |
