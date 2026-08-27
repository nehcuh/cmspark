# 薄聊天壳同一张脸 — 侧栏 / 悬浮 / 托盘

> **日期**: 2026-08-27  
> **状态**: **r2 LOCKED · dual Claude+Pi 均 AWN** `chat-shell-same-face-spec-r2-*-20260827-153041`  
> **GitHub:** [#239](https://github.com/nehcuh/cmspark/issues/239)  
> **线稿:** [docs/design/chat-shell-same-face-wireframes.html](../../design/chat-shell-same-face-wireframes.html)  
> **对抗合成:** [chat-shell-same-face-spec-adversary-synthesis-20260827.md](../../audit/reviews/chat-shell-same-face-spec-adversary-synthesis-20260827.md)  
> **触发**: 用户给 Gemini 四张截图，定义「我们的悬浮」= Chrome 入口 → 清爽侧栏 → 弹出小窗 → 托盘也开这只窗  
> **不推翻**: ADR-020 · overlay 永不 Allow/Deny · F-I-4 Companion 不 `sidePanel.open` · 无第二 Chrome 扩展 · `cmg_` ≠ `ws_secret` · 看山角色印记 · HUD 五轨冻结  
> **本文件不写代码。** 实现另开 plan + PR，`Closes #239`。  
> **形态 SoT**: [2026-08-26-product-form-deepening-design.md](./2026-08-26-product-form-deepening-design.md)。**例外（须写进落地 PR 的 PRODUCT/DESIGN）**：overlay **HTML** 空态默认整张脸，supersede「默认 40pt 收起条」**仅此壳**。Mac Swift HUD 本票仍收起条。

```text
Surface:      L0 ChatShell 合同（copy+layout）；钉住=侧栏；HTML 浮动=Capture
L2-classes:   none
Compose:      建议芯片 = 静态模板填作曲；不新增知识/MCP/Pack 协议
Autonomy:     none
Trust:        overlay 永不 Allow/Deny；F-I-4；SUMMONER_ALLOW 不加 tab.* / dock
Channel:      community
```

**Blast**: 本文件 = **T0 文档**。落地 = **T2**。Chrome 窗装卸引擎 / Swift HUD 重绘 = **另票**。

---

## 0. 产品句

四处同一张薄聊天脸。钉在 Chrome 里是侧栏，弹出来是悬浮，托盘点开也是它。招呼、当前页、三条建议、作曲。装配和批准不在这张脸上。

不是 Chrome 里的 Gemini。家仍是**已登录 Chrome + 硬闸**。这张脸只是开口。

**本票可验收的椅子（r2，对抗后收窄）**：侧栏空态换成这张脸（有页则「当前页」+ 3 模板）。点「弹出对话框」打开 **overlay HTML** 同一 copy 的整张脸（**无页**：没有「当前页」芯片）。Mac 热键/托盘仍是 Swift 收起条（旧壳，不假装已换脸）。贴回不是装卸按钮。

---

## r2 pins（折三路 REJECT）

1. **ChatShell = copy + layout 合同**，不是共享 Plasmo `ChatView`。React 侧栏一套；C-thin HTML 孪生；禁止把 `chrome.*` / `agentStore` 打进 `summoner-web`。
2. **本票浮动 DoD = overlay HTML**。Mac Swift HUD / 热键 / 托盘菜单 **不在本票用户完成**；标「旧壳」。Win/Linux 托盘已走 HTML 的，点开即 ChatShell。
3. **「当前页」芯片只在扩展文档**（Side Panel 用 `chrome.tabs.query`）。Overlay HTML / Swift **永远无页变体**。禁止 `list_tabs` / `tab.*` / `ui.dock` / `ui.open_sidepanel` 进入 `SUMMONER_ALLOW`、`SUMMONER_WEB_DISPATCH_ALLOW`、overlay SSE。
4. **弹出协议（必须写进 plan）**：扩展槽（非 summoner ACL）`overlay.shell.open` `{ thread_id }` → 已有 `openLoopbackPage`。不得 `sidePanel.open`。
5. **贴回本票 = F-I-4 附言**「我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。」不画实心「贴回侧栏」。Chrome 窗真贴回另票，且按钮必须在 `chrome-extension://` 用户手势栈。
6. **诚实 CTA 槽保留**：`打开确认台` / `打开浏览器` / `打开并前置浏览器` 仍用 `client.ts` 文案。不进三条建议。L2 空态邀请迁 FocusBand + overlay `cta-box`，不删。
7. **钉住 StatusRail 仍是 Zone A**（Mode + 一键新对话）。ChatShell 顶栏 `⋯` 是附加，不是替换。
8. **招呼**：有页用切片 5「要对这页做什么？」；无页「要我帮你做什么？」。去掉「今天」。称呼可作小字，不双招呼。
9. **芯片 fill = 固定模板**，永不插入 `{标题}` / DOM。发出本轮 ≠ 把页文拼进 prompt。默认填入待发。
10. **×** 只藏芯片/建议。不改 `tabUrlCache`、白名单、domain/L2/MCP 门。
11. **HTML 空态默认整张脸**（显式 superseded 08-26 收起条，仅 HTML 壳）。Swift 本票仍 40pt + `展开对话`。
12. **测试锁文件点名**：`empty-state-copy.test.ts`（含 computer 迁走）；`summoner-web.test.ts`（空态 copy、默认整张脸、rail 仍 hide-not-delete、无 Allow/Deny）；Swift `展开对话` **不翻**。禁止 overlay 源码出现作为控件的「允许/拒绝」。

---

## 1. 我们从 Gemini 学什么 / 不学什么

参考用户截图：标签栏药丸 → 侧栏空态 → 「弹出对话框」→ 浮窗「附加到原始标签页」→ 菜单栏图标。

| Gemini | 特权 | 我们 |
|--------|------|------|
| 标签栏「问问 Gemini」药丸 | Chrome 一等公民 | **做不到**。诚实入口 = 已钉住的扩展图标 C（工具栏，不是标签栏） |
| 侧栏留白 + 招呼 + 建议芯片 + 当前页 | `chrome.sidePanel` 我们已有 | **学 IA**。角色仍是 CompanionMark，不抄星星 |
| 弹出 / 贴回 | Chrome 自有 panel 装卸 | **按钮进脸**。引擎（`chrome.windows` vs OS HUD）**本票不锁** |
| 菜单栏图标点开同一只窗 | 他们的 helper | **学入口**。我们已有 Swift 托盘；图标另切片可换，点击必须开 ChatShell |

**明确不学（消费级 Gemini REJECT，08-26 策略仍在）：** Connected Apps、系统级「分享标签」、`@` 添加任意标签当产品、把 CMspark 做成聊天助手而不是已登录页上的手。

---

## 2. 考虑过的三条路

| | 路 | 为何 |
|--|----|------|
| **A 采用** | **共用 ChatShell 视觉合同**，引擎后定 | 用户锁了「同一张脸」且「引擎后定」。先抽一张脸，四处挂上。弹出按钮有文案合同；行为用适配器填，不在本票赌进程 |
| B 否 | 只改召唤器，侧栏不动 | 违反「同一张脸」 |
| C 否 | 一刀做完 Gemini 环 + 锁引擎 | 太大；锁 Chrome 窗则热键/托盘在 Chrome 没焦点时变弱；锁 OS HUD 则「贴回」不能一键 |

---

## 3. ChatShell（同一张脸）

一张壳，三处挂：侧栏聊天列、弹出小窗、托盘/热键打开的窗。

### 3.1 空态（无消息）

```text
┌─  ⋯          [弹出对话框] ─┐     浮动 HTML：无实心贴回；可有 × 关窗
│                            │
│        CompanionMark       │
│     要对这页做什么？         │     无页：要我帮你做什么？
│                            │
│   [总结这一页]              │     仅侧栏有页时；overlay HTML 永不渲染
│   [用更简单的话讲这一页]     │
│   [列出我能在这页替你做的操作] │
│                            │
│  [当前页：{标题}          ×] │     仅扩展文档。禁止「正在看」「正在分享」
│  ┌────────────────────────┐│
│  │ 说一句，或点上面的建议   ││
│  └────────────────────────┘│
│  （需要时）打开确认台 / 打开浏览器   │  诚实 CTA，不是芯片
└────────────────────────────┘
```

有消息后：印记/招呼/建议**收起**。流占中列。侧栏「当前页」可留在作曲区上方。

### 3.2 顶栏（薄）

| 态 | 左 | 右 |
|----|----|----|
| 钉住（侧栏） | `⋯` | **弹出对话框** |
| 浮动 HTML | `⋯` | 关窗。**不**放实心「贴回侧栏」。需要盯页时用附言 `SUMMONER_ATTACH_FOOTNOTE` |

`⋯` 最低：新对话、对话列表。不放 Allow/Deny、不放 MCP 添加、不放知识正文。钉住时 StatusRail（Mode + 一键新对话）仍在 ChatShell **上面**，不删。

**侧栏钉住时允许壳外多一截**（现 BottomBar / 装配 / StatusRail 的非聊天部分）。那是 Operate 仪表，**不是 ChatShell 的一部分**。浮窗**不得**把仪表克隆进去。

Mode 徽章、连接点、值守、确认条：**不进 ChatShell 顶栏**。断连仍用现有 DisconnectedBanner，不新做顶栏灯。

### 3.3 当前页芯片

- 文案：**`当前页：{标题}`**，标题截断；无标题则 hostname。禁止「正在看」「正在分享」。
- **只在 Side Panel**（`chrome.tabs.query`）。Overlay HTML / Swift = 无页，不向 overlay 推 tab。
- 标题只显示（`textContent` / `esc`）。点建议或发送 **不得**把标题/URL/DOM 拼进 user/system prompt。页操作仍走现有 tools + untrusted 标签。
- `×`：只藏芯片与建议。不改 `tabUrlCache`、白名单、L2/domain/MCP 门、不停 CDP。

### 3.4 建议芯片（v1 = 模板）

仅侧栏有「当前页」才出现，最多 3 条。点芯片 = **填入作曲区**（填入待发，plan 不得改成直接发送）。

v1 固定模板，**不** LLM 现算：

1. 总结这一页  
2. 用更简单的话讲这一页在干什么  
3. 列出我能在这页替你做的操作  

无页（含全部 overlay HTML）：不渲染建议。切片 5 computer「打开确认台」迁 FocusBand / overlay `cta-box`，不进这三颗。无页 L0 不再保留「起草」行（composer 自己能打）。

禁止把芯片画成工具批准。禁止芯片文案含「允许 / 拒绝 / 去侧栏」。

### 3.5 弹出 / 贴回（文案合同；引擎另票）

| 按钮 | 用户语言 | 本票 |
|------|----------|------|
| 弹出对话框 | 把这场对话拿到小窗 | 侧栏按钮。协议：扩展 WS `overlay.shell.open` `{ thread_id }` → 现有 `openLoopbackPage`（overlay HTML 已是 ChatShell）。**不**进 `SUMMONER_ALLOW`。**不** `sidePanel.open`。 |
| （不画贴回） | 盯页请点工具栏 | 浮动面只用 `SUMMONER_ATTACH_FOOTNOTE`。禁止 overlay/托盘/热键发 dock WS/HTTP。 |

Companion / 托盘 / 热键 **永远**不得 `chrome.sidePanel.open`（F-I-4）。

### 3.6 Chrome 入口（截图 1 的诚实版）

- **能做**：工具栏 C（`chrome.action`）点开侧栏（已有）；引导用户钉住图标；tooltip 用产品名。
- **不能做**：标签栏药丸、跟 Gemini 药丸并排、把扩展图标画进 tab strip。
- 产品对外禁止写「标签栏旁边有 CMspark 按钮」。

### 3.7 托盘入口（截图 5）

- 点击托盘图标 = 打开**浮动 ChatShell**（同一张脸）。
- 图标换皮可同切片或紧随，不挡 ChatShell。
- 不在托盘菜单做 Allow/Deny。

---

## 4. 和现四面地图的关系

```text
Capture  →  Operate         →  Confirm     →  租手
浮动 ChatShell  钉住 ChatShell    确认台/托盘     不变
（原召唤器）    + 壳外装配
```

- 热键仍开**浮动**（Mac = Swift 旧壳；Win/Linux = HTML ChatShell），不是侧栏（F-I-4）。
- overlay **HTML** 空态默认整张脸（本票显式 superseded 08-26 收起条，**仅 HTML**）。Swift 仍 40pt + `展开对话`。
- HUD 五轨工作台：**继续冻结**（hide-not-delete）。ChatShell 不是第六轨。HTML 默认不得露出 packs/knowledge/skills 轨。

---

## 5. 实现边界（给后续 plan，本文件仍不写码）

建议切片（顺序锁，可在 plan 改细，不可偷偷加 ACL）：

| 刀 | 用户能看见 | 不在这刀 |
|----|------------|----------|
| **0** | spec r2 + dual APPROVE* | 写码 |
| **1** | 侧栏空态：印记 / 「要对这页做什么？」/ `当前页：` / 3 模板 / 作曲；无页无芯片；StatusRail 仍在 | Swift；弹出 |
| **2** | overlay HTML 空态同一 copy 函数、整张脸、**无页**；rail 仍藏 | `list_tabs`；正在看 |
| **3** | 侧栏「弹出对话框」→ `overlay.shell.open` → HTML ChatShell | Chrome `windows.create`；贴回装卸；Swift 重绘 |
| **4** | 文档：PRODUCT/DESIGN 入口诚实 + HTML 空态 superseded 收起条；Mac 旧壳一句 | 托盘换图标；声称四处已换脸 |

测试锁（plan 必须带）：

- 无 tab（侧栏）或 overlay HTML → 无「当前页」、无 3 芯片。
- 侧栏有 title → `当前页：` 且不含「分享」「正在看」。
- overlay 源码控件无「允许/拒绝」。
- `SUMMONER_ALLOW` / C-thin dispatch / overlay SSE diff **空** of `list_tabs`/`tab.`/`ui.dock`/`sidePanel`。
- 侧栏与 HTML 空态同一 copy 模块；Swift 测不翻 `展开对话`。

---

## 6. NEVER

1. 标签栏「问问 CMspark」药丸，或对外声称已有  
2. overlay / ChatShell Allow/Deny  
3. 第二只 Chrome 扩展  
4. `ws_secret` 当 MCP grant  
5. 浮窗克隆装配 / Mode / 值守 / 确认条  
6. 系统级分享标签、`@` 加任意 tab 当本票产品  
7. 建议芯片 LLM 现算当 v1 DoD  
8. 本票锁死并实现双引擎  
9. 用 overlay 管 MCP 掩盖 F-S-10  
10. 换掉看山 CompanionMark 去抄 Gemini 星星  
11. Companion 侧 `sidePanel.open`  
12. 为这张脸扩 outbound 默认 profile  
13. `list_tabs` / `tab.*` / `ui.dock` 进 overlay ACL 或 C-thin  
14. 在 overlay/托盘画实心「贴回侧栏」假装能钉住  
15. 本票声称 Mac 热键/托盘已换脸  

---

## 7. 开放题（本 SoT 结案 / 留给引擎票）

| 题 | 本票裁决 |
|----|----------|
| 引擎 Chrome 窗 vs OS HUD | **不锁**。本票浮动 = 已有 overlay HTML |
| 点芯片填入 vs 直接发送 | **填入待发**（plan 不得改成直接发送） |
| HTML 空态整张脸 vs 收起条 | **HTML = 整张脸**（显式 superseded）；Swift = 收起条 |
| 称呼 | 可小字；主标题用切片 5 干活句 |
| Swift WKWebView | **本票不做** |

---

## 8. 文档同步（落地 PR，不是本 T0 必改）

| 文件 | 改什么 |
|------|--------|
| `PRODUCT.md` Surfaces | 侧栏 ChatShell；HTML 浮动同一 copy；Mac 热键仍收起条旧壳；入口=工具栏 C |
| `docs/DESIGN.md` | 顶栏：弹出对话框；当前页；三芯片；贴回不是按钮 |
| `docs/GOAL.md` | 不把本票写成召唤器/四处换脸完成 |

---

## 9. 成功标准（用户椅子）

打开侧栏空态：像在见一个人，不是仪表盘。有一页时能看见「当前页」和三条可点建议。点「弹出对话框」打开 HTML 小窗，同一场对话、无页芯片。Mac 托盘仍是旧条——文档诚实写。危险的事仍在确认台；浮窗没有允许/拒绝。
