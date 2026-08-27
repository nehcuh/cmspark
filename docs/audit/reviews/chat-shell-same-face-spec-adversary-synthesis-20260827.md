# ChatShell spec 对抗合成 — #239 · 2026-08-27

> **输入**: 三路独立对抗（Product / Impl / Trust），均 **REJECT**  
> **SoT**: `docs/superpowers/specs/2026-08-27-chat-shell-same-face-design.md`  
> **确认序**: 先折 blocker 进 spec r2，再 `dual-external-review.sh`；实现 agent 不自评放行

| 路 | VERDICT |
|----|---------|
| Product / IA | **REJECT** |
| Impl / dual-shell | **REJECT** |
| Trust / Security | **REJECT** |

共识：视觉合同（招呼、模板芯片、作曲、无 Allow/Deny、无标签栏药丸）可做。r1 把 Gemini 的**手**（贴回、四处同一窗、浮窗正在看）写进了本票 DoD，而活引擎做不到且会涨 overlay ACL。

---

## Blockers（必须改 SoT，不进 plan）

1. **「贴回侧栏」当主按钮** — 脸≠手。OS HUD / overlay HTML 不能 `sidePanel.open`（F-I-4）。看起来能点的就必须能点。本票贴回 = 现成附言「请点工具栏的 CMspark」，不是装卸命令。
2. **四处 / 托盘还是这张脸 vs Swift 不在刀内** — Mac 热键/托盘是 40pt HUD。DoD 必须缩小：本票浮动面 = overlay HTML；Mac 旧壳另票。
3. **浮窗「正在看」** — overlay 无 `chrome.tabs.query`；加 `list_tabs` = F-S-5。浮窗 v1 = 无页变体。芯片只在扩展文档里读 tab。
4. **弹出无协议** — 侧栏打不开 loopback HTML。须写清 extension 槽 `overlay.shell.open`（不进 `SUMMONER_ALLOW`），或把弹出移出本票。
5. **收起条「仍有效」+「整张脸优先」** — 对 HTML 空态显式 superseded；Swift 本票仍收起条。
6. **诚实 CTA 被空态挤掉** — `打开确认台` / `打开浏览器` 须有槽，不进三条建议。
7. **§3.3「点建议或发出本轮就把 DOM 喂给模型」** — 禁。芯片 fill = 固定模板；页操作仍走 tools。

---

## r2 针（已折进 spec）

见 spec **「r2 pins」** 节。三路报告原文在本会话 subagent 输出（未另存长文）。

---

## Nits（r2 已吸收或留给 plan）

- ChatShell = copy/layout 合同，不是共享 Plasmo `ChatView`
- 招呼去掉「今天」；干活句跟切片 5
- 钉住 StatusRail 仍是 Zone A；新对话一键不进 ⋯-only
- × 只藏 UI，不改 `tabUrlCache` / 白名单
- overlay 标题 `textContent`/`esc`
- 线稿 H 不要把「允许/拒绝」拷进产品 DOM
- F-S-10 不因本票变差；不加 overlay MCP 铬
