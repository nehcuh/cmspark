# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-27 (S86 · PR #240 ChatShell · 0.5.3 main 仍 `ed22223`+)

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
| ChatShell 同一张脸 | **PR #240**（#239）；侧栏空态+弹出 HTML；Mac HUD 旧壳 |

## Branch lock (S85)

- **`main`**: 本地 ahead 1（session-end S85）。功能在 **PR [#240](https://github.com/nehcuh/cmspark/pull/240)** `feat/slice-239-chat-shell`。
- **活票**：[#239](https://github.com/nehcuh/cmspark/issues/239) ChatShell（PR 开着）；[#230](https://github.com/nehcuh/cmspark/issues/230) 冻 F-S-10 / overlay-acl。正交 #69/#70/#71。
- **不要**：overlay Allow/Deny；第二扩展；`ws_secret` 当 grant；T1 nit 当 SSO 墙；不经确认改 live `config.json`；#230 整票「继续」。

## Next

- 审/合 PR #240。勿声称四处已换脸。
- #230 禁止整票实现。
- #229 体感：重启仓库 tray 或重打 DMG。

## Docs SoT

- 活状态：`docs/superpowers/specs/2026-08-27-post-227-status.md`
- 形态：`docs/superpowers/specs/2026-08-26-product-form-deepening-design.md`
- 用户 / 架构：`docs/README.md`
