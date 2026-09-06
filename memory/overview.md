# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-09-07 (lockstep 0.6.6)

## CMspark — 产品 0.6.6

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

- 包装 **0.6.6**（已装机）：#423 Qwen3-VL 坐标系修复（L-QW-3 修订 always-map，评测门 0/10→6/10）· create-dmg cp -R 封签修复 · installer.nsi 版本锚补钉。0.6.5 = 召唤器全链路 #433 P1–P3 + #439 LLM 检索工具；0.6.4 = 内嵌终端 #432 + 召唤器命令面板。0.6.1 基础上：测试污染根治 #404–#406 · 失败升级链 #409 · outbound MCP 三件 · 全历史专家 #411/#418。
- **评审弧闭环**：c39d7d3e..26949cbb 四路对抗 7 MAJOR 全修（#261–#264），main tip `18d843d1`。
- S104 起 origin 已含开闸+查重（#280–#283）；评审波次（#286–#295）十张 PR 已合入，见 GATE-SUMMARY。
- **活票**：#230 冻 F-S-10 / overlay-acl；#258–#260 语音/会议。T1 #228 已关，**禁扩** profile。
- **不要**：overlay Allow/Deny；第二扩展；`ws_secret` 当 grant；#230 整票「继续」；宣称 Capture/CU/F-S-10 闭合；StatusRail 手风琴 / Wave 2 FocusBand。

## Next

- 重载 unpacked 扩展狗食 PDF 导入 + 「按堆选文」。再编 DMG 才有查重。
- #230 禁止整票实现。

## Docs SoT

- 活切点：`CHANGELOG.md` **0.6.6**
- 0.5.3 快照：`docs/superpowers/specs/2026-08-27-post-227-status.md`（SNAPSHOT）
- 用户 / 架构：`docs/README.md` · `PRODUCT.md`
