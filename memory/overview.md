# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-28 (S87 · overlay Capture 卡狗食 · main 含 #240/#242)

## CMspark — 产品 0.5.3

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL** |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024） |
| Outbound MCP / 租手 | opt-in；T1 L7 **PASS 带 nit**（#228 关）；**禁扩**默认 profile |
| 知识诚实 Wave 0–3 | **on main**（#222/#223/#226） |
| 形态切片 1–3 / 5 / 6 | **on main**（#226/#227） |
| 召唤器 P2 快/淡 | **on main**（#234）；安装包 0.5.3 DMG **未含** 此 Swift |
| grant-cli 未知 flag | **on main**（#236） |
| RunProgress H1 `tool` | **on main**（#238）；无 tool 仍只能点 |
| ChatShell 同一张脸 | **on main**（#240） |
| Overlay Capture 卡 | **on main** 骨架（#242）；狗食在 `feat/overlay-card-first-paint`（录制/历史/近实时/发言人N） |

## Branch lock (S87)

- **`main`**: 含 #240 ChatShell + #242 Capture 骨架。狗食枝 **`feat/overlay-card-first-paint`**（未开 PR）。
- **活票**：[#243](https://github.com/nehcuh/cmspark/issues/243) 新对话+历史 · [#244](https://github.com/nehcuh/cmspark/issues/244) 会议台；[#230](https://github.com/nehcuh/cmspark/issues/230) 仍冻。#228 T1 关。
- **不要**：overlay Allow/Deny；第二扩展；`ws_secret` 当 grant；#230 整票「继续」；声称像素级 Gemini。

## Next

- 关旧浮窗狗食会议台。再开 PR。
- #230 禁止整票实现。
- 扩展重载后验「打开侧栏」只绑普通窗。

## Docs SoT

- 活状态：`docs/superpowers/specs/2026-08-27-post-227-status.md`
- 形态：`docs/superpowers/specs/2026-08-26-product-form-deepening-design.md`
- 用户 / 架构：`docs/README.md`
