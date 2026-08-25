# Adversary review (Product / UX) — Overlay HUD Expand B1–B4

**Batch**: `overlay-hud-expand-b1b4`  
**Role**: independent Product / UX skeptic (did **not** implement; no production edits)  
**Spec**: `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`  
**Mockup**: `docs/design/overlay-hud-expand-mockup.html`  
**Dual prompt**: `docs/audit/reviews/overlay-hud-expand-b1b4-dual-review-prompt-20260825.md`  
**Owner claim**: 收起一条条；展开是同一扇窗向下变高的 Companion 工作台。对话 / 场景 / 知识 / 技能 / MCP **不经过 Chrome Side Panel**。

```text
Surface:      L0 overlay HUD workbench (Mac NSPanel) + C-thin HTML reads/toggles
L2-classes:   none on HUD; mcp.add stdio spawn uses existing tray L2
Compose:      threads + pack.apply + mcp.toggle + skill toggle
              + knowledge USE + knowledge import HITL
Autonomy:     n/a
Trust:        overlay-safe writes; mcp.add + knowledge.import denied on summoner WS;
              no overlay Allow/Deny; NSAlert 导入/添加/取消 (no 确认)
Channel:      community
```

Inspected `[inspected]`: `companion/src/tray/SummonerOverlay.swift`, `companion/src/summoner-web.ts` (`SUMMONER_HTML` + compose APIs), NSAlert copy, `menu-bar-agent.ts` rail push / compose handlers, `summoner/client.ts` overlay copy, `mcp/confirm-target.ts`. Did not run the HUD.

---

## 0. What the human was sold

| Promise | User-visible test |
|---------|-------------------|
| 展开 = Codex / 千问办公 / WorkBuddy 同构：图标轨 52pt + **一类**列表 ~220pt + 主列对话 + **底栏永远在底** | 一次只看见一类。行 = 标题 + 一行次要信息。选中靛蓝浅底。导航描边，不是 emoji 堆。 |
| 对话 / 场景 / MCP / 技能 / 知识 **不经过扩展** | 列表、开关、套用、USE、导入、添加，在召唤器里完成。 |
| 批准仍走 **托盘原生窗**，HUD 没有 Allow/Deny 方言 | 源码与按钮不得出现「确认 / 允许 / 拒绝」。回收站用 NSAlert / HTML `confirm`。 |
| 无「去侧栏」、无浏览器徽章、无标题 traffic-light、无发送大按钮 | Mockup notes 锁死。 |
| C-thin（Win/Linux，本刀不改成 HUD）仍 **能** list/toggle packs/mcp/skills/knowledge.set_active | Dual DoD 8。不能 dispatch `mcp.add` / `knowledge.import`。 |

Mac HUD **skeleton** matches the mockup: 720× collapse, expand chevron, 52pt SF-symbol rail, one 216pt list, composer under the workbench, 看山 tokens, no overlay Allow/Deny chrome. That is the only part that feels shipped.

The rest of this batch still **teaches Side Panel as home**, clips the lists so they are not a workbench, and leaves Win/Linux on a titled dark 220px mini-sidebar whose tests **assert** the anti-copy.

---

## 1. Findings (user sees vs truth)

| ID | Sev | Where | User sees vs truth |
|----|-----|-------|-------------------|
| P0 | **P0** | `summoner-web.ts:626-677,651-754,901-903` + `tests/summoner-web.test.ts:121-124` | C-thin **cannot** list/toggle 场景 / MCP / 技能 / 知识。用户看见：220px 只堆「对话」，顶栏「批准在侧栏」，hint「听写/知识配置/批准**去侧栏**处理」，MCP 事件「需在 Chrome **侧栏**批准」。Compose **HTTP 有、页面无按钮**。测试还把「去侧栏处理」锁成回归。DoD 8 对用户失败。 |
| P1 | **P0** | `mcp/confirm-target.ts:6-28` · `summoner/client.ts:330-364` | Spec / mockup：「批准沿用**托盘**原生窗」。实际：overlay 起源的 MCP 工具确认 **改送到 Chrome 侧栏**；侧栏没开则报错「请打开 Chrome 侧栏」。用户在 HUD 打开 MCP、开聊、工具要批 → 被撵回扩展。B2「MCP 不经 Side Panel」只覆盖开关，**不覆盖用**。 |
| P2 | **P1** | `menu-bar-agent.ts:790` · `SummonerOverlay.swift:369,562-615,1727-1746` | 「一类列表」不可滚动（`listCol`/`threadListStack` 无 `NSScrollView`），线程只 push **8** 条（`slice(0, 8)`），各轨 `prefix(12)`。12×44px 行 > 428px 工作台，多出来的行被裁掉、无「还有 N 条」。对话管理在第 9 个线程起 **不存在**。 |
| P3 | **P1** | `SummonerOverlay.swift:539-626` · `Tray.swift:75-78` · `client.ts:76-81` | Spec 行 = 标题 + **一行次要信息**。协议里线程有 `when`，Swift `RecentThread` 丢掉。场景 / 知识 / 技能 / MCP 都是单行标题，次要信息塞进 `●/○` 或「· 不可套」。选中靛蓝浅底只给**当前对话行**；其它轨点击无 `aria-current` 浅底。 |
| P4 | **P1** | `menu-bar-agent.ts:894-896` · `SummonerOverlay.swift:723-736` | 套场景成功走 `encodeSummonerError` → 主列出现「系统: 已套到当前对话（技能/提示）」。成功当错误画。且 `handleSummonerPackApply` **不** `pushSummonerRail`，列表无「已套」态。 |
| P5 | **P1** | `summoner/client.ts:331-332` | HUD 源码禁「去侧栏」（测试锁了 Swift）。运行时仍会把 `pack_not_overlay_eligible` / `pack_trust_cookie_present` 画成「要**去侧栏**确认 / **去侧栏**换场景」。产品句子分裂：Swift 本地拦是「不能在召唤器套用」；漏过则教用户回侧栏。 |
| P6 | **P1** | Spec §2.5 vs `SummonerOverlay.swift:697-720` · `menu-bar-agent.ts:996-1016` · `message-router.ts:2665-2683` | Spec：导入 = NSOpenPanel + **托盘 CONFIGURE**。Ship：NSOpenPanel + overlay `NSAlert`「导入/取消」，然后 tray `knowledge.import` **无 CONFIGURE**。面板不限类型；非 UTF-8 当 base64 塞进 `content` 当正文。导入不 `pin_thread_id`，当前对话不会自动 USE。 |
| P7 | **P1** | `SummonerOverlay.swift:1319,840-850,1262-1266` | 展开后在输入框打 `#` → **整块工作台卸掉**（428pt 跳变），搜索命中改走底栏 hits。`applyPhase` 先藏 `lastThreadField`，`updateLastThreadLabel` 马上又亮「继续 · 标题」——展开态已经在该对话里，这条是 HUD A 尸体。 |
| P8 | **P2** | `SummonerOverlay.swift:570-586,330-332` · `menu-bar-agent.ts:815-818` | MCP 行画 `enabled`，**不是** `connection.status`。`applyMcp(connected names)` 是空操作。`● filesystem` 像「已连接可用」，实际只是开关开着。 |
| P9 | **P2** | `SummonerOverlay.swift:658-681,918-924` | 「原生表单」= 260×56 两行（名字 / 命令）。无 args / cwd / env / SSE。点「添加」后 stdio 再走托盘 L2「允许/拒绝」——方言正确（不在 HUD），但用户刚点过「添加」，第二窗没有「刚才那条命令将以本机进程拉起」的回显。 |
| P10 | **P2** | `SummonerOverlay.swift:507-524,1696-1751` mockup `logHtml` | 主列永远是对话摘录（还 `capLines` 20，不是「全文」）。切到场景/知识/技能/MCP **没有** spec 的「一两句说明」。轨选中只改 `contentTintColor`，没有 mockup 的靛蓝浅底。 |
| P11 | **P2** | `SummonerOverlay.swift:1810` · `1792-1808` | 仍构造「完整格式在侧栏」、发送大按钮、继续 CTA（`applyPhase` 再藏）。折叠态 `sideNote` 在未连接时改写为工具栏提示，源码仍留侧栏句子。 |

---

## 2. Rails (Mac HUD) — skeleton vs workbench

`[inspected]` `SummonerOverlay.swift:1696-1751`, `501-626`, `39-48`

**Hold (do not regress)**

- 52pt 轨、五个 SF Symbol（对话 / 场景 / 知识 / 技能 / MCP）、`toolTip`、一次 `railSection`。
- 一类列表，不是旧 `makeRail` 三块文案竖堆。
- 工作台在输入栏**之上**，底栏 `+` 输入 📎 🎙 ⌄；`sendButton` 运行时隐藏。
- 看山：`--paper/#fff` `--text/#171717` `--muted/#f4f4f5` `--indigo/#4F46E5`。圆角 16。轨钮 / 行 / 底栏控件高度 ≥44。
- 导航不是 emoji；无 traffic-light；borderless + `canBecomeKey`。

**Not a workbench yet**

1. **裁切**：无列表滚动 + 线程 8 条硬切。用户无法完成「对话管理不经侧栏」——第 9 个线程在 overlay 里不存在。
2. **状态不可读**：无次要行。技能/知识用 `●` 前缀代替「已挂 / 内置」。MCP 用开关冒充连接。场景无「已套到当前」。
3. **不可套场景仍是按钮**（变淡 + 标题「· 不可套」），点击再报错。应直接不可点，并写清「为什么」——不要「去侧栏」。
4. **点击即生效、无对象句**：技能 / 知识 / 场景都是「当前对话」，MCP 是全局。同一套行点击，列表头只有一个词「技能」，主列不解释。切轨后对话摘录还在，用户不知道刚才点的是 USE 还是全局杀进程开关。
5. **知识 USE 是 toggle**（`menu-bar-agent.ts:979` 有则剥、无则加）——对，但行上无「再点取消」。技能关是 `on: !on`，关着的行和「未装」看起来一样。

---

## 3. NSAlert copy — dialect holds; HITL shape does not

`[inspected]` overlay alerts:

| Flow | `messageText` | Buttons | Spec / dual |
|------|----------------|---------|-------------|
| 重命名 | 重命名 / 给这条对话一个名字 | **重命名** · **取消** | Pass |
| 回收站 | 移到回收站 / 「标题」会离开当前列表 | **移到回收站** · **取消** | Pass — not 删除/确认 |
| MCP 添加 | 添加 MCP / 名字和启动命令（stdio） | **添加** · **取消** | Dialect pass；表单过瘦（P9） |
| 知识导入 | 导入知识 / 把「文件名」加进知识库 | **导入** · **取消** | Dialect pass；**不是** CONFIGURE（P6） |

Overlay Swift 无「确认 / 允许 / 拒绝 / Allow / Deny」（`summoner-workbench-compose.test.ts` 锁了）。**不要把托盘确认台的允许/拒绝算进 HUD**——那是对的。

失败在 **门的形状**，不在用词：

- 知识导入：用户点完系统文件框再点「导入」，文件已经进 Companion。没有托盘 CONFIGURE 预览（将写入哪、多大、是否挂上本对话）。
- 空名字 / 空命令 / 空 alias：`guard` 直接 return，Alert 关掉、无「没写名字」。像没点过。
- HTML 回收站用 `window.confirm("把「…」移到回收站？")` — 源码无「确认」，系统按钮在 zh-CN 常为「确定」。Dual 允许 HTML `confirm`；不要再做成 overlay Allow/Deny。

---

## 4. C-thin HTML — 明确不做 HUD，但 DoD 8 也没做

`[inspected]` `SUMMONER_HTML` 整页；JS 到 `refresh()` / `selectThread` 为止。`/api/packs` `/api/mcp` `/api/skills` `/api/knowledge` 有服务端，**页面零调用**。

Spec：「Win/Linux HTML 本文件不改成 HUD；先 Mac。」这豁免的是 **视觉世界**（不要 52pt 纸面轨），不是豁免「用户能开关组合面」。Dual DoD 8 写的是 *can list/toggle*，不是 *endpoints exist*。

用户打开 C-thin 实际得到的是 **已否的反模式**：

- 标题窗 + 顶栏「CMspark 召唤器（实验）」
- 220px 左栏只堆对话；每行常驻「重命名」「移到回收站」文案按钮（Mac 用 ⋯ 菜单，这边更像迷你侧栏）
- 底栏 **发送** 主按钮 + 纠偏/排队/停止
- 暗色 `#12141c` / `#3d6df2`，不是看山纸面
- 句子锁死去侧栏（测试 `assert.match(..., /去侧栏处理/)`）

工程测试 `SUMMONER_WEB_DISPATCH_ALLOW.has("pack.apply")` 与 `assert.match(web, /knowledge.set_active/)` 会绿。产品测试「Win/Linux 用户不打开 Chrome 能不能挂一篇知识」会红。

`mcp.add` / `knowledge.import` 不在 allow-set、页面也无入口 — **DoD 8 后半句成立**。前半句（能 list/toggle）对用户不成立。

---

## 5. DoD as the user would score it

| # | Claim | Product |
|---|--------|---------|
| 1 | 场景列表；点 overlay-eligible → apply | Mac：**能点**。无已套态；成功画成系统错误；不可套仍可点。 |
| 2 | MCP 列表/开关；＋ 添加 → stdin → tray `mcp.add` | Mac：能开关、能出表单。列表撒谎（enabled≠connected）。 |
| 3 | 技能列表；点 toggle 当前对话 | Mac：能点。无线索「这是本对话」。 |
| 4 | 知识列表；点 set_active；＋ 导入 NSOpenPanel + NSAlert → tray import | Mac：能 toggle / 能导入。无 CONFIGURE；不自动 USE；任意文件。 |
| 5 | set_active 剥多余 key（trust） | 用户不可见。不评分。 |
| 6 | 无 HUD Allow/Deny / `summoner.confirm.*` | **Pass**（方言）。MCP **用**时仍把人送侧栏（P1）。 |
| 7 | Pin lockstep | 不在本角色。 |
| 8 | C-thin 能 list/toggle；不能 add/import | **Fail / Pass**。不能 add/import。**不能** list/toggle（无 UI）。 |

REJECT gates R1–R6 是信任/协议，不是本角色。产品等价门：

- **PR1** 用户完成组合面必须打开 Side Panel → **triggered**（C-thin 全轨 + Mac MCP 工具确认 + 运行时「去侧栏」句）
- **PR2** HUD 出现 Allow/Deny 方言 → not triggered
- **PR3** 展开仍是 200pt 标签堆 / 发送大按钮 / 去侧栏自称 → **triggered on C-thin**；Mac 骨架未触发

---

## 6. Must-fix vs next knife

**Must-fix before calling B1–B4 落地**

1. **C-thin**：给 场景 / MCP / 技能 / 知识 真实列表 + toggle/apply/USE。继续禁止 add/import。删掉（并改测试）「去侧栏 / 批准在侧栏 / 知识配置去侧栏」。MCP 待批改为「看托盘确认窗」，侧栏未开不要叫人去开扩展。
2. **Mac 列表**：`NSScrollView`；线程不要静默 8 条；次要行用协议里已有的 `when` / 已挂 / 未启用 / 不可套原因。选中浅底。
3. **运行时 copy**：`client.ts` 去掉「去侧栏」；overlay-ineligible 只说「召唤器不能套，这条要更高权限」——若更高权限仍是侧栏，**本刀就不要宣称组合面不经扩展**。
4. **MCP 确认目标**：overlay 起源走 **托盘** 确认台（spec 原文），或诚实写「开关在这，批工具仍要 Chrome」。现在是第三种：宣传不经侧栏，运行时撵回侧栏。
5. **成功不是错误**：pack apply 用 hydrate/状态句，不要 `encodeSummonerError`。导入后可选挂到当前对话，并刷新轨。
6. **展开 + `#`**：搜索应过滤左列对话，而不是拆掉工作台。藏死「继续 ·」在 expand 态。

**Next knife（不挡方言，挡「工作台」自称）**

- 主列非对话时一两句说明（mockup `logHtml`）。
- MCP 行显示 connected，而不是 enabled。
- 知识 NSOpenPanel 限文本/已支持类型；CONFIGURE 预览若仍要 T3 名分。
- MCP 添加表单：命令预览 + 与 L2 窗同一条 command。
- 轨选中浅底；`●` 换成次要行。
- 删发送/继续/「完整格式在侧栏」死控件。
- 空 alias / 空 MCP 字段：Alert 留着并指出缺什么。

---

## 7. What already matches the visual lock

Keep these. They are the only reason this is not the rejected titled-640 + 200pt 竖堆：

- 同一扇窗变高，不是新 `--app`。
- 图标轨 + 一类列表 + 底栏输入。
- NSAlert 用 重命名 / 移到回收站 / 添加 / 导入 / 取消。
- Overlay 无 Allow/Deny、无 `getUserMedia`、无 HTML 麦。
- `mcp.add` / `knowledge.import` 不走 summoner WS（Mac stdin → tray client）。这是信任正确；**产品**还要把「然后发生什么」说完。

---

## VERDICT: REJECT

Mac HUD 有展开骨架和五条轨的点击，NSAlert 方言干净。这不够叫 B1–B4 工作台。C-thin 仍是「去侧栏」迷你侧栏且 **没有** 组合面 UI（DoD 8 对用户失败）。Mac 列表静默裁切、成功当错误、MCP **用**时把批准送回 Chrome。用户要的「对话 / 场景 / MCP / 技能 / 知识，全部不经 Side Panel」没有在任一端闭环。
