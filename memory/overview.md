# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-09-29 (lockstep 0.6.10 · S118 安全批次)

## CMspark — 产品 0.6.10

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL** |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024）；overlay 会议台 on main |
| Outbound MCP / 租手 | opt-in；T1 L7 **PASS 带 nit**（#228）；**禁扩**默认 profile |
| 知识诚实 Wave 0–3 + 检索 A/B + 文件夹 + 开闸 + 查重 | **on main** #272–#274/#280/#281/#283 |
| 形态切片 1–3 / 5 / 6 | **on main** |
| ChatShell / Overlay Capture 卡 | **on main**（#240/#242/#246） |
| 体检 A–F | **on main** #246/#248/#250/#252/#254 |

## Branch lock (S104)

- 包装 **0.6.9**：租手确认台到前面 / Windows 租手路径 / 舰队 kick 收口。本机已换装，GitHub Release 已挂三端 zip + Setup.exe。0.7.0 企业双场景仍未验收。
- 包装 **0.6.10**：**[已发布](https://github.com/nehcuh/cmspark/releases/tag/v0.6.10)**（三端 zip + Windows Setup.exe + SHA256SUMS；Setup sha256 `59d49e08…`）。内容为 0.6.9 拉取批次对抗评审的三条 BLOCKING 修复（#544 pivot 投递进 untrusted 通道 / #545 fleet 快照读路径抹租约 / #546 Windows 测试静默空转，经 PR #549 合入；#547 tag 脱节经 PR #551 切版归档、PR #553 落地 release-guard 防复发机制）。tag `v0.6.10` == main HEAD `fc5935e2`。
- **评审弧闭环**：c39d7d3e..26949cbb 四路对抗 7 MAJOR 全修（#261–#264），main tip `18d843d1`。
- S104 起 origin 已含开闸+查重（#280–#283）；评审波次（#286–#295）十张 PR 已合入，见 GATE-SUMMARY。
- **活票**：#230 冻 F-S-10 / overlay-acl。T1 #228 已关，**禁扩** profile。#258–#260 已在树（embedding experimental）。
- **不要**：overlay Allow/Deny；第二扩展；`ws_secret` 当 grant；#230 整票「继续」；宣称 Capture/CU/F-S-10 闭合；StatusRail 手风琴 / Wave 2 FocusBand。

## Next

- `#559`：`analyze_image` 任何失败都判 `non_recoverable`（缺 `error_code` 落默认桶）→ 整轮终止；image 家族码整族未登记。
- `#560`：`classifyError` 剩余「依赖文案恰好含某词」的脆弱点（优先显式分支、子串表逐步退役）。
- `#539`：前提已更正（管道是通的）；若确要断开期不丢日志，建议只加计数、不缓冲（该路径有回环事故史）。

- 重载 unpacked 扩展 `chrome-extension/build/chrome-mv3-prod/`，狗食租手确认是否把确认台拉到前面。
- 不要提交本机 `host-integrity.ts`（build-host 改写的 SHA）。
- #230 禁止整票实现。

## Docs SoT

- 活切点：`CHANGELOG.md` **0.6.10**
- 0.5.3 快照：`docs/superpowers/specs/2026-08-27-post-227-status.md`（SNAPSHOT）
- 用户 / 架构：`docs/README.md` · `PRODUCT.md`
