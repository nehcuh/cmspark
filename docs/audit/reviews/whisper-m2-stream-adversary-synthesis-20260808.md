# Whisper M2 Progressive Streaming — Dual-Review Synthesis

**Date**: 2026-08-08  
**Batch**: `whisper-m2-stream`  
**Inputs**: Claude `APPROVE_WITH_NITS` · Pi `REJECT` · post-fix absorb

## What M2 actually is

| Claim | Reality |
|-------|---------|
| 「真字级流式」用户体感 | 说话过程中草稿显示 **临时假设字**（约 ≥1.2s 刷新，取决于 Whisper 推断） |
| 技术机制 | 累计 PCM 会话内 **snapshot → whisper 重解码** + 窗口结束 **一次定稿** |
| 非目标 | whisper.cpp **decoder token** 流；伪造 interim |

## Dual-review outcome

| Reviewer | Verdict | Role |
|----------|---------|------|
| Claude | APPROVE_WITH_NITS | Floors mostly pass; N1–N4 actionable |
| Pi | **REJECT** | F1–F4 blocking correctness |

**Process rule**: Pi REJECT → absorb blocking list before claim ship.

## Absorbed fixes (this session)

1. **F1** — `windowMs = min(segmentCapMs, 45s, remaining)`；文案改为「约 8s 窗口」  
2. **F2** — 进行中 partial **不**取消重启；返回 `partial_busy`；慢 runner 单测  
3. **F3** — 窗口内 **仅 interim**；`finalChunk` 只在 window end 提交一次  
4. **F4** — partial 路径失败 soft-skip，不杀 live 会话  
5. **F5/F6/N1** — `abort`/`forceAbort` 取消 `partialAbort`；run 前再检 `inferring`  
6. **F7** — 先 gUM/PCM，再 `voice.stt.start`；`AudioContext.resume()`  
7. **N2** — `start` 在 prior infer 时 `resource_conflict`

## Residual nits → r3 absorb

| Nit | Fix |
|-----|-----|
| N3 soft-stop during gUM | `pendingSoftStop` + post-gUM clean `onEnd`（不跑满窗） |
| N5 ScriptProcessor only | **AudioWorklet 优先** + ScriptProcessor 回退 |
| destroy 挂起 streaming | 触发 `segmentStopTrigger`、abort pcm、清 partial timer |
| medium poll 体感 | 按 hypothesis `ms` 自适应 poll（1.15×，夹在 1.4–6s） |

产品诚实残留：仍 **不是** decoder-token 流式。

## Ship bar

- [x] Dual review executed  
- [x] Pi REJECT absorbed for F1–F4  
- [x] Residual nits r3 absorbed  
- [x] Machine: `voice-stt-partial` + `stream-stabilize` + `stream-partial-poll`  
- [ ] Manual e2e: local medium + continuous + 实时出字 ≥30s 中文  

**Synthesis**: `APPROVE_AFTER_R3_NITS`
