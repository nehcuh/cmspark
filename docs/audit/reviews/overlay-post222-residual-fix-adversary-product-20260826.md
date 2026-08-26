# Overlay post-#222 residual-fix — Product / UX adversary

**Batch:** `overlay-post222-residual-fix`  
**Lane:** PRODUCT-UX (independent; did not implement; did not read other `overlay-post222-residual-fix-adversary-*` reports)  
**HEAD (committed):** `a58b78fd444bcd5eb49698b1d802d4fc959d963a` (`origin/main`)  
**Working tree:** branch `fix/overlay-post222-residual`, uncommitted fold vs `a58b78f`  
**Prior REJECT:** product lane `overlay-post222-residual-adversary-product-20260826.md` + dual `093708` (R5 merge ate paper HUD / I1 / I2)  
**Diff:** `docs/audit/reviews/overlay-post222-residual-fix-diff-20260826.patch` (10 files)  
**Spec:** `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`

```text
Surface:      Darwin HUD = Swift NSPanel C-thin; Win/Linux = loopback HTML --app (not a Mac HUD clone)
L2-classes:   none on HUD; tray showConfirmDialog on security.confirmation.request
Compose:      overlay-safe SUMMONER_ALLOW + applySummonerPayloadPolicy
Trust:        monotonic; knowledge.import / mcp.add stay off overlay WS
Channel:      community; CDP still needs Chrome
```

**Blast:** T2 residual UX. This lane does **not** demand overlay `knowledge.import` / CONFIGURE on WS, HUD Allow/Deny, or C-thin as a Mac pixel clone.

Evidence tags: `[inspected]` source + lock tests + prior REJECT. This session has **no shell tool**; machine suite was **not re-executed**. Live HTML / Swift / ACL / tests were read on the working tree.

---

## 刻意边界（遵守，不挑战）

- 网页 CDP 仍要 Chrome 扩展。不把「MCP **工具**执行走 Side Panel」判成 BLOCK。
- Overlay **不做** Allow/Deny。不要求 HUD 画确认钮。
- Win/Linux C-thin **不是** Mac HUD 视觉克隆。不因配色/52pt 轨是否像素对齐而 REJECT。
- **不**要求 `knowledge.import` 上 overlay WS。C-thin 知识 tab 只有 USE 是正确产品面。
- Win/Linux systray2 never-promise L2 是 **NIT**，除非 Darwin tray ride 被弄坏。

---

## Machine `[inspected]`

| Check | Result |
|-------|--------|
| Live `summoner-web.ts` HTML | `--paper:#fff`, `.rail-btn`, `.list-scroll`, `placeWindow(false)`, **no** `#12141c` |
| Skills click | `on:!on` + 行内「已用于本对话 / 未用」；HTTP `body.on !== false` → `skill.deactivate` |
| Knowledge click | `ids:next`（`filter` / `concat`）；**禁止** `ids:[id]` 整表替换 |
| `planSummonerShellOpen` | `--window-size=720,120` |
| Lock tests | **未**改去迁就暗色壳；反而 **加严**：flex / `.list-scroll` / `NSScrollView` / I3 文案 / `dropped` |
| `SWIFT_TRAY_SHA256` | pin = `57e1fba2c5d7dd5bde0f462a85e92d8839ff7c9c8b7c8e9f5bd897d6285a6052`；二进制存在。本通道未 `shasum` |
| Scope | 10 files；无 ACL / confirm 方言 / F-I-5 旁路 |

先前红的三条契约（`summoner-web.test.ts:112-125` paper HUD、`:542-547` `on:!on`/`ids:next`、`summoner-shell-open.test.ts:71` `720,120`）在 **工作树源码上与断言同向**。不是把测试改成暗色 HTML。

---

## I1–I8

| ID | 用户可见问题 | 判定 | 证据 |
|----|----------------|------|------|
| **I1** | C-thin 技能只开不关 | **CLOSED** | `[inspected]` `summoner-web.ts:1051-1057` `on:!on` + 「已用于本对话 / 未用」；`:476-483` `on===false` → `skill.deactivate`；测试 `summoner-web.test.ts:542-547` 禁止 `on:true` |
| **I2** | C-thin 知识 `ids:[id]` 覆盖整表、不能卸 | **CLOSED** | `[inspected]` `summoner-web.ts:1065-1075` `next=on?filter:concat`，POST `ids:next`；行内「已挂到本对话 / 点击挂上」；测试禁止 `ids:[id]` |
| **I3** | Swift 非 UTF-8 当正文 | **CLOSED** | `[inspected]` `SummonerOverlay.swift:734-745` fail-close「只支持文本知识（md/txt）」；`content: text`；函数体内无 `base64EncodedString()`；`applyError` 写入 HUD 日志 `系统: …` |
| **I4** | C-thin 开禁用 stdio MCP → 45s 死点击 | **CLOSED** + NIT | Darwin tray ride 仍在 `menu-bar-agent.ts:1629-1631`。systray2 never-promise **未再弄坏** Darwin。Win/Linux 死点击按本批次边界记 NIT |
| **I5** | Mac 列表 8/12 截断、无独立滚动 | **CLOSED** + NIT | `[inspected]` `listScroll.documentView = tStack`（`:1771-1782`）；`prefix(64)` × 列表；launcher `slice(0, SUMMONER_RAIL_LIST_CAP)`；无 `prefix(12)` / `slice(0, 8)`。NIT：`workbench.alignment = .top`（`:1533`），`listCol` 未钉死 428pt 高，未像素跑 |
| **I6** | `set_active` 未知 id 静默丢 | **CLOSED** + NIT | `[inspected]` `message-router.ts:2625-2630` `dropped` 回传；单测 `knowledge-active-ids.test.ts:260-274`。未知 id **不会**挂上。HUD/C-thin 不 toast `dropped`（点选路径发的是已知 id） |
| **I7** | C-thin flex 头/底被挤、列表与轨未分离 | **CLOSED** | `[inspected]` 纸面 HUD **叠** dfab3eb flex：`html,body{height:100%;overflow:hidden}`、`.rail{flex-shrink:0}`、`.main/.log{min-height:0}`、`.composer{flex-shrink:0}`、独立 `.list-scroll`。未浏览器实测 |
| **I8** | F-I-5 / PEM END / F-S-1 | **CLOSED** | 本 fold 未改 `skill-engine.ts` / `distill.ts` / `content-sanitizer.ts` |

**R5 不因 I1/I2 开火：** 上批次 merge 回滚的技能/知识语义与纸面壳已回到工作树；锁测试加严而非放水。

---

## R1–R6

| ID | 判定 | 说明 |
|----|------|------|
| R1 | **HOLD** | `SUMMONER_ALLOW` 无 `mcp.add` / `knowledge.import` / `config.set`。C-thin dispatch 无 import。Mac 导入走 stdin `summoner.knowledge.import` → tray `companionClient`（`menu-bar-agent.ts:996-1004`），**不是** overlay WS。本通道不要求 C-thin 做 CONFIGURE |
| R2 | **HOLD** | `applySummonerPayloadPolicy` 仍 alias-only；本 fold 未改 ACL |
| R3 | **HOLD** | HUD/C-thin 无 Allow/Deny / `summoner.confirm.*`。回收站是 `window.confirm` / 原生 NSAlert「导入/取消」，不是 L2 方言。锁测试 `doesNotMatch(/允许\|拒绝\|Allow\|Deny\|确认/)` |
| R4 | **HOLD** `[inspected]` | pin 已改为声称的 `57e1fba2…6052`；二进制文件存在。本通道未独立 `shasum`（交给 security/external） |
| R5 | **HOLD** | 声称 CLOSED 的 I1–I2 在 live HTML 上为真；锁测试仍要 paper HUD / `on:!on` / `ids:next` / `720,120`。I5/I6 结构闭合，残余见 NIT |
| R6 | **HOLD** | `summoner-acl.ts` 不在本 patch；overlay-safe 集合未扩到 import/add |

---

## Outcome

Win/Linux 用户再打开召唤器，应看到 **纸面收起条**（`--app 720×120` + `placeWindow(false)`），不是 `#12141c` 迷你 Side Panel。展开后是 52px 描边轨 + 216px 一类列表（`.list-scroll`）+ 主列 + 底栏 composer；**发送是 ghost，不是主按钮**。

技能行是真开关：已用/未用，再点走 `skill.deactivate`。知识行是增删：已挂/点击挂上，再点卸下，**不会**把 A+B 静默换成只剩 C。

Mac 一类列表不再是「最多 8/12 条且无滚」的硬截断；cap 64 + `NSScrollView`。知识导入选非 UTF-8 会在 HUD 日志看到「只支持文本知识（md/txt）」，不会把 base64 当 markdown。

C-thin **没有**知识导入入口、**没有** Allow/Deny —— 这是正确产品，不是缺口。

---

## Trajectory

1. `03de168` 折过 I1/I2 + 纸面 HUD。  
2. `dfab3eb` 从 #222 暗色壳修 flex，不是 `03de168` 后代。  
3. `a58b78f` 取暗色 blob、留纸面锁测试 → 上批次 R5 REJECT。  
4. **本 fold** 把纸面 HUD 接回，并把 dfab3eb flex **叠上去**（不是留下暗色壳）；`shell-open` 回到 `720,120`；Swift 加 scroller / UTF-8 fail-close；router 报 `dropped`。  
5. 测试是 **加断言**（flex、list-scroll、NSScrollView、I3 文案、dropped），**不是**把 GET HTML 改成认 `#12141c`。

Scope = 声称的 10 个文件。无 confirm 方言、无 overlay import、无 drive-by ACL。

---

## Component

| 用户面 | 位置 |
|--------|------|
| 纸面 token / 轨 / 列表滚 / 收起 | `companion/src/summoner-web.ts:620-705, 709-771, 783-800, 1148` |
| 技能开关 | `summoner-web.ts:1047-1057` + HTTP `:472-485` |
| 知识增删 | `summoner-web.ts:1063-1076` + HTTP `:493-501` |
| 收起窗 | `companion/src/summoner/shell-open.ts:55` |
| Mac 列表滚 | `SummonerOverlay.swift:371, 534-540, 1771-1782` |
| I3 文案 | `SummonerOverlay.swift:734-736, 746-758` |
| I6 `dropped` | `message-router.ts:2625-2630` |
| MCP 仍走 tray | `menu-bar-agent.ts:1629-1631` |
| 锁（未放水） | `tests/summoner-web.test.ts:112-139, 542-547`；`summoner-shell-open.test.ts:71`；`summoner-workbench-compose.test.ts:155-176` |

---

## Blockers

无。I1/I2 已回到 live HTML；测试未迁就暗色壳；未要求 overlay import / HUD Allow/Deny。

---

## Nits（不挡）

1. **I5 Auto Layout 未钉列高** — `workbench.alignment = .top`（`SummonerOverlay.swift:1533`），`listCol` 只有宽 216、没有 `height = 428`。内部 scroller hugging/compression 是对的配方，但列高若不被压进 428，长列表仍可能溢出底栏而不是在 `NSScrollView` 里滚。未像素跑 Mac HUD。建议 follow-up：`alignment = .fill` 或 `listCol.height = workbench.height`。cap 64 仍静默截断；`#` 搜索仍 `hits.prefix(6)`（`:1144`）。超过 64 应有「还有 N 条」而不是装成全部。

2. **收起尺寸双故事** — `--app` 是 `720,120`（DoD）；JS `placeWindow(false)` 却 `resizeTo(500, 140)`（`summoner-web.ts:783-784`）。都是收起条，不是暗色全屏回归。Chrome `--app` 常忽略 `resizeTo`，用户多半看见 720×120。对齐成一个数字即可。

3. **I4 Win/Linux** — C-thin MCP 点击仍 `.then(function(){loadCompose("mcp")})`（`:1041`）不读 `error`、无 pending。Darwin 有托盘 L2，路径未回退。systray2 `Promise<never>` 仍是死点击。可接受修：关着的 stdio 行不可点 + 一句「到设置页启用」，或 status「等托盘确认」。不要在 HTML 里做 Allow/Deny。

4. **I6 HUD 不展示 `dropped`** — 协议诚实已够（点选不会发未知 id）。脚本/竞态若丢 id，C-thin 只 reload，无「未找到这篇」。可忽略。

5. **文案过载 / 小谎** — 空日志与禁用麦克风 title 仍写「听写、知识配置、批准去侧栏处理」（`:751, 870`）。在刻意边界下 **CONFIGURE 去侧栏是实话**（本通道不要求 overlay import）；把它绑在麦克风按钮上会教错表面。hint「点击右上角 ⋮」vs 齿轮设置钮（`:769, 958-959`）。I3 空文件与非 UTF-8 共用「只支持文本知识」——空 md 不是「不是文本」。

6. **I7 未像素跑** — CSS 结构像能保住轨/底栏/独立列表滚。长对话/长列表未在 `--app` 里点过。

---

## 三层结论

| 层 | 判断 |
|----|------|
| **outcome** | 纸面收起工作台回来了；C-thin 技能能关、知识能卸；Mac 列表有独立滚容器与 64 cap；非 UTF-8 导入对用户说「只支持文本」；`dropped` 让未知 id 不再是协议层沉默。不是暗色迷你 Side Panel，也不是要求 C-thin 克隆 Mac。 |
| **trajectory** | 针对上批次 R5：恢复 `03de168` 用户面并把 flex 叠上，而不是改测试去认 `dfab3eb` 暗色壳。范围干净。 |
| **component** | 见上表。残余是 Auto Layout 列高、收起 500×140 vs 720×120、Win/Linux L2 诚实 pending——NIT，不是 I1/I2 再开。 |

未改生产代码。未读其它 `overlay-post222-residual-fix-adversary-*`。读过上批次 product REJECT（无 `-fix-`）与 `093708` dual。

VERDICT: APPROVE_WITH_NITS
