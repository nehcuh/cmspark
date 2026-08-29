# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-29 (S94 · 体检 A–F 合 main `5c4fcab0`)

## CMspark — 产品 0.5.3

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

## Branch lock (S94)

- **`main` == `origin/main` `5c4fcab0`**。无其它远程枝。
- **活票**：#228 禁扩 profile；#230 仍冻 F-S-10 / overlay-acl。
- **不要**：overlay Allow/Deny；第二扩展；`ws_secret` 当 grant；#230 整票「继续」；宣称 Capture/CU/F-S-10 闭合。

## Next

- 残留 Medium 须新 GitHub Issue（privacy_ack、HUD 导入、grant_id、conductor 按 thread）。
- 可选重打 DMG 狗食 Capture 卡。
- #230 禁止整票实现。

## Docs SoT

- 活状态：`docs/superpowers/specs/2026-08-27-post-227-status.md`
- 体检：`docs/audit/deep-diagnosis-fanout-2026-08-28.md`
- 用户 / 架构：`docs/README.md`
