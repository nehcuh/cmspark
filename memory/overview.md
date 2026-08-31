# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-31 (S99 · 活文档锁 0.5.5；Unreleased 召唤器流式/语音回退/自动K)

## CMspark — 产品 0.5.5

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL** |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024）；overlay 会议台 on main |
| Outbound MCP / 租手 | opt-in；T1 L7 **PASS 带 nit**（#228）；**禁扩**默认 profile |
| 知识诚实 Wave 0–3 | **on main** |
| 形态切片 1–3 / 5 / 6 | **on main** |
| ChatShell / Overlay Capture 卡 | **on main**（#240/#242/#246） |
| 体检 A–F | **on main** #246/#248/#250/#252/#254 · tip `5c4fcab0` |

## Branch lock (S99)

- 包装 **0.5.5**。本地 `main` 含 Unreleased（召唤器流式 / 语音回退 / 会议自动 K），待 push。
- **活票**：#230 冻 F-S-10 / overlay-acl；#258–#260 语音/会议。T1 #228 已关，**禁扩** profile。
- **不要**：overlay Allow/Deny；第二扩展；`ws_secret` 当 grant；#230 整票「继续」；宣称 Capture/CU/F-S-10 闭合；包装未打 NSIS 时写成 0.5.6。

## Next

- push Unreleased 四功能提交后，发版再 lockstep 0.5.6。
- #230 禁止整票实现。

## Docs SoT

- 活切点：`CHANGELOG.md` 0.5.5 + Unreleased
- 0.5.3 快照：`docs/superpowers/specs/2026-08-27-post-227-status.md`（SNAPSHOT）
- 用户 / 架构：`docs/README.md` · `PRODUCT.md`
