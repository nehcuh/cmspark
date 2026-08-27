# 产品形态深化 — 定位与设计 SoT

> **日期**: 2026-08-26  
> **状态**: **LOCKED · 四路对抗 + Claude 三路 + Pi 均 AWN** `product-form-deepening-*-20260826-144035`（dual nits 已折入）  
> **脊柱**: [2026-08-26-user-first-product-form-design.md](./2026-08-26-user-first-product-form-design.md)（LOCKED；本文件是**可实现**的身体）  
> **对抗**: [synthesis](../../audit/reviews/product-form-deepening-adversary-synthesis-20260826.md)  
> **不推翻**: ADR-020 · ADR-022 L3/L4/L5/L8/L9 · ADR-025 · overlay 无 Allow/Deny · 无第二 Chrome 扩展 · `cmg_` ≠ `ws_secret`  
> **本文件不写代码。** 实现另开切片，须 dual-review 通过且用户审过本 SoT。  
> **GitHub 追踪（2026-08-27 补）**：已合 #226 切片 1–3、#227 切片 6。余项 **[#228](https://github.com/nehcuh/cmspark/issues/228) T1** · **[#229](https://github.com/nehcuh/cmspark/issues/229) 召唤器 P2** · **[#230](https://github.com/nehcuh/cmspark/issues/230) 残留**。新切片必须先有 Issue。

```text
Surface:      Capture=召唤器 ; Operate=侧栏或后台 CDP ; Confirm=确认台/托盘 ; 租手=Outbound MCP
L2-classes:   召唤器上无新类；overlay 不得充当 L2 conductor
Compose:      overlay 仅 USE；租手=策展 L1 导出 cmspark__* ；ACP=反向编程接力（不是本形态第四段）
Autonomy:     同一 tool-loop；不得因 overlay 点不到就跳过确认
Trust:        四通道四 ACL；overlay 永不 Allow/Deny；grant ≠ ws_secret；F-S-10 用 L8 修、不用 overlay 管 MCP
Channel:      community ；召唤器可关 ；outbound 非 default-on ；require_grant 默认 true
```

**Blast**: 本文件 = **T0 文档**。落地切片按 §11：grant/L8 = **T3**；召唤器文案 = **T2**；T1 bake-off = **T0 过程**。

---

## 0. 发心（用户语言，第一句）

> 热键说一句。要干活，用你**已经打开、已经登录**的 Chrome。人在侧栏就在侧栏看；人在 Codex 就在 Codex 里开同一只手。危险的事先弹确认台。不是第二套 Codex，也不是给每家 AI 再装一只扩展。

**家是已登录的 Chrome + 硬闸。** 侧栏是人盯着 Chrome 时的 Operate 面。人在别的 Agent 里时，Operate 是后台 CDP，确认台才弹出。

PRODUCT.md / GOAL.md 的「Side Panel 是家」按本句改。ADR-022 **L3–L9 物理不改**；L2 叙事句改为「主叙事 = 已登录 Chrome + 硬闸；Side Panel 是 Operate；Outbound 仍是 Composition 导出门面」。

---

## 1. 我们是 / 不是

| 他们 | 他们赢在 | 我们不是 | 我们是 |
|------|----------|----------|--------|
| **Chrome Gemini** | 原生铬、每 tab、Gmail 一体 | 消费级聊天助手；不做 Connected Apps | 已登录页上 **真干活 + 确认台** |
| **Claude for Chrome** | 品牌扩展接到 Claude | **不做第二只 CWS 扩展** | 同一只扩展；他们走 **租手（Outbound MCP）** |
| **Playwright MCP** | CI / 干净 profile / headless | 不抢 CI | 用户 **日常已登录 / SSO** 的那只 Chrome |
| **Chrome DevTools MCP** | perf / network / inspect | 不是调试器 | 页面交互与确认；互补 |
| **BrowserSkill / `bsk` / 通用 Browser MCP** | 任意 Agent 一条 shell 接浏览器 | 不是无闸 Browser MCP；Skill **只写何时用我们** | 可租、可拒绝、可审计的 **策展 L1** |
| **WorkBuddy** | 办公 Agent；浏览器是其中一项 Skill | 召唤器 **不是** 五轨工作台翻版 | 快窗口；展开是**对话** |
| **Codex 本体** | 写代码、改仓库、自带浏览器 | 不在侧栏做 IDE | 他们缺的那只 **已登录浏览器手** |

对外禁语：「无缝对接」「通用 Browser MCP」「中层 Agent」「CMspark for Codex 扩展」「Chrome 里的 Gemini」。

Raycast / uTools / WorkBuddy 热键 = **分发**（`docs/summoner-launcher-plugins.md`），不是第三扇门。

---

## 2. 命名锁（两扇门，一个浏览器）

用户已经把「Handoff」和侧栏 **编程接力（ACP / Coding Handoff）** 混在一起。本 SoT **用户面禁止**用 Handoff 称呼 Outbound MCP。

| 门 | 方向 | 用户名 | 协议 | 前缀 | 默认 |
|----|------|--------|------|------|------|
| **租手** | 他们 → 我们的 Chrome | 租手 · Outbound MCP | 我们当 MCP **server**（ADR-022） | 工具 `cmspark__*` · 钥匙 `cmg_` | opt-in，非 default-on |
| **编程接力** | 我们 → 他们的编程 Agent | 编程接力 · ACP | 我们当 ACP **client**（ADR-025） | 工具 `acp_*` | `acp.enabled` 默认 false |

```text
cmspark__*   租手工具名（他们调我们）
cmg_*        租手钥匙（调用方凭证）
mcp__*       入站 MCP（我们调他们的 server，含用户自备 Jira）
acp_*        编程接力（我们调本机编程 Agent）
ws_secret    扩展 ↔ Companion 配对，永不作 MCP grant
```

形态图：

```text
Capture  →  Operate         →  Confirm     →  租手
召唤器      侧栏或后台 CDP      确认台/托盘     Codex 等租手
```

不是四套 App。脊柱文档里的英文 “Handoff” = 本图 **租手**。ACP 不进五分钟主路。

入站 MCP（把 Jira/filesystem 接进侧栏）是**第三件事**，不要画进这两扇门。

---

## 3. 三种人，三天日子

家永远是已登录 Chrome + 硬闸。不是三套产品。

### 3.1 热键用户（几乎不打开侧栏）

热键 → **召唤器（收起条）**。纯问 → L0，Chrome 可以关着。要动页 → **「打开浏览器」**（后台 CDP）或 **「打开并前置浏览器」**（盯页/验证码）。未白名单域 → 召唤器只出一行「需要确认」+ **「打开确认台」**。浮窗 **没有** 允许/拒绝。对话变长 → **「展开对话」** = 这篇全文 + 对话列表。Esc / 热键关整窗，Companion 还在。

### 3.2 侧栏盯页人

人在 Chrome 里过验证码、对照文档。扩展图标 → **侧栏 Operate**。装配技能/知识/MCP 在这里。高危：侧栏红条可快批（这是 **Operate 面**，不是浮窗）。确认码 / 长预览 / CU 急停 → **确认台**。召唤器可热键开口、同一 thread；侧栏占用输入时召唤器说 **「侧栏占用了输入」**。

### 3.3 Codex 租手（今天不打算看见 CMspark UI）

Companion 托盘在跑、扩展曾经配对、一把 `cmg_` 钥匙、stdio `mcp-outbound`。Codex 调 `cmspark__list_tabs` / `navigate`。要确认时：**确认台或 Mac 托盘**出现——不是「请回侧栏设置点一下」。页文/截图离开本机前，**人**在确认台或签发钥匙时勾过，不是编程助手自己 `acknowledge`。

T1 没跑赢也不撤这条路；只保持工具面窄。对外仍标 **实验 / 非产品 ship**。

---

## 4. 四面地图

会议工作台、编程观察台 **保持原名**，不在这张图的 Confirm 段。

| 面 | 产品名 | 何时出现 | 允许 | 禁止 |
|----|--------|----------|------|------|
| **Capture** | 召唤器 | 热键；默认 **收起一条作曲条** | 说、贴、打断、切/建对话、展开看对话、本轮 USE 挂载 | Allow/Deny；`config.set`；overlay WS 上的 `mcp.add` / `knowledge.get\|import`；假装打开侧栏 |
| **Operate** | 侧栏 **或** 后台 CDP | 人盯 Chrome → 侧栏；人在召唤器/Codex → 扩展后台驱页 | 完整装配、空态/作曲、红条快批、看页 | 召唤器变 IDE；第二扩展 |
| **Confirm** | 确认台 +（Mac）托盘 | 任何高危 / 域门 / L2 / 租手需批 | 允许/拒绝/停止；确认码；白名单；CU 急停 | 浮窗确认方言；没人能点就跳过 |
| **租手** | Outbound MCP | 用户在别的 Agent 里要这只手 | `cmspark__*` 白名单；`cmg_` grant；确认台/托盘 | 默认 cookies/evaluate/L2/shell；`ws_secret` 当 grant；CWS for Codex |

**浏览器两条路（用户原话）：**

- **(a) 后台驱页** — Chrome 可最小化，扩展必须连着。按钮 **「打开浏览器」**（尽量不抢焦点）。危险 → 确认台/托盘。
- **(b) 打开/前置 Chrome** — 盯页、过验证码。按钮 **「打开并前置浏览器」**。诚实：**我们不能替你弹出侧栏**（F-I-4）。盯页请点工具栏图标。

Win/Linux 无原生托盘确认：(a) 的批准 = Chrome 上的确认台。**不许**因为没人能点就跳过。

---

## 5. 召唤器生长规则 + HUD 轨

**产品默认 = 收起的作曲条。** 快窗口。不是一开就是工作台。

「对话可长高」= 这条对话的正文从条子上长出来。**不是** 条子变成五轨办公套件。

| 状态 | 用户看见 | 文案 |
|------|----------|------|
| 收起 | + 输入 📎 （🎙 若平台已接）⌄ | **展开对话** |
| 展开 | 底栏仍在；上面是 **当前对话全文** + **对话列表** | **收起对话** |
| Esc / 热键 | 整窗关 | 不 abort 已在跑的一轮，除非用户点停止 |

展开 **默认落在「对话」**。禁止再写「展开工作台」。

已落地的 HUD Expand（B0–B4，五轨对标 WorkBuddy）是债。本季 **不撕工作台架构、不加第六轨**。铬上的处置：

| 轨 | 裁决 | overlay WS / 协议 | 展开铬（用户看见） |
|----|------|-------------------|-------------------|
| **对话** | **KEEP** | 列表、搜索、新建、切换、重命名、`delete mode=trash` | 主列=全文 + 对话列表。禁硬删/批量/第三聊天 |
| **场景** | **FREEZE** | `pack.list` + overlay-eligible `pack.apply`（`allowTrust` 剥掉） | 可留图标；禁止编辑 pack / 绑工作区 / 场景市场 |
| **知识** | **FREEZE** | USE：`list` + `set_active`。禁 `get/import/update` | 可留图标做 pin。Mac HUD「＋导入知识」：**藏**（stdin 仍在，hide-not-delete） |
| **技能** | **FREEZE** | `skill.list` 只读。`activate` 仍在 ACL 上冻结 | **不陈列开关**。回滚票 `overlay-acl-rollback` |
| **MCP** | **REMOVE from expand chrome** | `mcp.list` 可读；`toggle` 冻结在 ACL。禁 `mcp.add` 上 overlay WS | **不展示 MCP 轨图标**。实现 = **hide-not-delete**（`summoner-workbench-compose.test.ts` 锁着源码里有 `mcp.toggle`/`mcp.add`；删代码会红，藏起来不会） |

Mac HUD 经 **tray stdin** 的「添加 MCP / 导入知识」：**本季冻结藏入口**——不是 overlay WS，也不当许可证再扩。`mcp.toggle_server` 是全局 CONFIGURE（回滚候选）；`skill.activate` 是线程 pin、偏 USE（票里再分类）。切片 1–3 **不**做 ACL 回滚。

HTML getUserMedia 仍关。回收站用系统 `NSAlert` / HTML `confirm`，不是工具批准。

---

## 6. 用户可见文案合同（中文铬，照贴）

**Chevron**

- 收起：`展开对话`（`title` / `aria-label` / tooltip 同一句）
- 展开：`收起对话`
- 禁：`展开工作台` `收起工作台`（确认形态图里「工作台」= 确认台；会议工作台 / 编程观察台原名不动）

**Chrome 关 / 扩展未连（要网页工具时）**

- L0 仍可用：`可以继续聊。要操作网页，需要打开浏览器。`
- 模型已要 CDP：`网页操作需要浏览器（扩展已配对的 Chrome）。`
- 租手：`编程助手要看你的页面，但浏览器没在。`
- 主按钮：**打开浏览器** · 次按钮：**打开并前置浏览器**
- 附言：`我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。`
- 禁：只丢 `BROWSER_UNAVAILABLE`；禁「请去侧栏」。

今天 Mac HUD 的 attach CTA **被藏着**（`SummonerOverlay.swift` `isHidden = true`）；HTML 壳没有 Chrome-closed CTA。切片 3 必须露出来。

**需要确认（召唤器 / 租手起源）**

- 状态：`需要确认才能继续。`
- 按钮：**打开确认台**
- Mac 托盘已弹出：`请在确认台或托盘里批准。`
- Chrome 关着：先 **打开浏览器**；连上后确认台由**扩展**弹出。
- 禁：`去侧栏批准` `MCP 工具需在 Chrome 侧栏批准`。

**「打开确认台」按钮做什么（禁止发明）**

1. 确认必须 fan-out 到扩展（确认台）+ Mac Swift 托盘。`originWs` **不绑召唤器**。
2. Chrome 已在且扩展已连：扩展 SW **已经**会 `openOrFocusCockpit`。按钮 = 前置 Chrome / 把确认台拉到前面。Companion **不**调用 `chrome.sidePanel.open`。
3. Chrome 没在：按钮退化成 **打开浏览器**；连上之后走 2。
4. 浮窗只报告状态，**不**收允/拒。召唤器 **永不**出现 `允许` `拒绝` `Allow` `Deny`。

**Grant 钥匙**

- 托盘菜单：**给编程助手一把钥匙**
- 一次性：`这把钥匙只出现一次。它不是扩展配对码。`
- 禁把 `ws_secret` 叫钥匙；禁把 `cmspark__*` 写成 grant。

**Pack / 装配换词**

- `这个场景要去侧栏确认` → `这个场景需要确认台批准`
- `当前对话有 Trust 快照，去侧栏换场景` → `当前对话有信任快照，请在侧栏装配里换场景`
- `侧栏占用了输入` — 保留（lease 诚实）

**复制测试（按切片改，不要 drive-by）：**

- **切片 2：** `companion/tests/mcp-confirm-target.test.ts`（`侧栏`→`确认台`）；顺手扫 `l2-admission.ts` 托盘通知「请在托盘或 Side Panel 批准/拒绝」→「确认台」。
- **切片 3：** `companion/tests/summoner-overlay.test.ts`（`展开工作台`）；`companion/tests/summoner-web.test.ts`（`去侧栏处理`）。
- **切片 3 不删：** `companion/tests/summoner-workbench-compose.test.ts` 用源码正则锁着 HUD 仍含 `mcp.toggle` / `mcp.add`。MCP 轨 = **hide-not-delete**。

---

## 7. Confirm L8（文件级）

**不变量：** pending 的 `originWs` **永远不是** summoner socket。关召唤器不得 `rejectAll` 这条确认。Overlay 永不 Allow/Deny。

路径在 `companion/src/mcp/confirm-target.ts`（**不在** `ws/confirm-target.ts`）。MCP 重定向到侧栏 **≠** overlay 起源的 L2 已修。

### 7.1 Overlay 起源 L2（今天是洞）

`createToolExecutor(ws)` 按 peer。Overlay `chat.create` 的 evaluate/navigate 把 `originWs` 绑在 overlay（`l2-admission.ts`）。Overlay 不能 `security.confirmation.response`。关 overlay → `lifecycle.ts rejectAll` **杀掉** pending。Win/Linux 无 Swift 托盘 → 45s 超时，确认台看不见。

**应当：**

1. `getWsSurface(ws)==="summoner"` 时 **不要** `{ originWs: overlay }`。
2. `sendConfirm` fan-out 到每个已鉴权 **非 summoner** peer，**必须包括**扩展 peer。
3. Mac：保留现有 Swift `trayEligible` 赛跑 + 特权 `respond()`（tray stdin，不是 overlay）。
4. 绑定 `originWs` = **扩展 WS（若在）**，否则 **unbound**（已是 outbound 模式）。
5. Overlay 可收 notice-only（已有 `mcp.confirm.pending`），文案改「打开确认台」。
6. Overlay 断开不得取消这些条目；`activeTrayConfirmsByWs` 不得以 overlay 为 key。今天 `lifecycle.ts` 在 disconnect 上既有 `rejectAll("disconnect", overlay)`，也有按该 ws 取消托盘赛跑；另有 `applyConnectionCloseGracePeriod`（约 5s）grace-kill —— **三条都要改到不杀已 retarget 的确认**（可观察效果相同）。
7. Win/Linux：`attachChromeOnly`，然后 **等扩展 WS 连上事件**（不要盲 poll）再 fan-out；超时或一直无 peer → 显式失败。**永不批准。** Cockpit 由扩展打开。

### 7.2 Overlay 起源入站 `mcp__*`

今天：`resolveMcpConfirmTarget` 转到扩展，无扩展则 **fail-closed**（不跳过）。缺托盘赛跑；文案仍「侧栏」。

**应当：** 与 7.1 同一 fan-out；copy 「侧栏」→「确认台」。trusted/非确认 `mcp__*`（F-S-10 残留：first-use cache / cruise）**不是** L8 切片；禁止用 overlay 管 MCP 当补丁。

### 7.3 租手 / Codex

已最接近 L8（fan-out + unbound origin + Mac 托盘）。Win/Linux 仍须「打开 Chrome 让扩展收到确认 → Cockpit」。配对仍要扩展；grant 只认 `CMSPARK_OUTBOUND_GRANT`。Bake-off 文档里 `Bearer ws_secret` 必须改掉。

### 7.4 F-S-10

洞的产品语言：overlay 工具环 **能调用** 需要确认的 `mcp__*`，overlay **不能确认**。代码 **没有跳过**；活缺陷是 **确认打到错误表面 / 缺 fan-out**。

修理 = L8，票名可沿用 `overlay-mcp-without-confirm`。**禁止** overlay MCP 管理台、HUD `mcp.add`、overlay Allow/Deny 当「修完」。

**L8 是 §8 五分钟租手的 DoD，不是后置 bug。** 可与 grant CLI 并行写代码；「五分钟」未完成 = L8 未绿。

---

## 8. 五分钟租手

### 8.1 公开配方必贴（实验声明）

> CMspark **租手（Outbound MCP）目前是实验能力**：非 default-on、**非产品 ship**（ADR-022）。「已登录 Chrome 相对 Playwright 不可替代」的 T1 真人 bake-off **尚未跑**。配置成功、工具列表出现 `cmspark__*`，只说明桥通了，**不**证明这个任务只能用我们。

T1 **门的是工具面宽窄**（失败 → 保持/收窄 L1，或只读枢轴），**不门**「租手算不算形态」。失败也 **禁止** 为了赢 bake-off 把 cookies/evaluate/L2/shell 放进默认 profile。

### 8.2 诚实前提（缺一则不是五分钟，是安装日）

1. Companion 在跑（托盘 / App / `daemon start`）。`daemon start` **不会**拉起 MCP stdio。
2. Chrome 扩展曾经配对（`.paired`）。
3. 要用页时 Chrome 得在（可最小化）。
4. 一把 **`cmg_…` grant**（不是 `ws_secret`）。`require_grant` 默认 true。
5. 人能够到确认台（Mac：Swift 托盘；Win/Linux：打开 Chrome 确认台，超时 `OUTBOUND_CONFIRM_REQUIRED`，不自动过）。

### 8.3 钥匙门（今天只有侧栏设置 — 这是身体）

允许：**CLI**（默认，Win/Linux 可脚本）

```text
cmspark-agent outbound-grant issue --caller-id codex --label Codex
```

token **只印一次** + env 片段。和/或 Mac 托盘一次性窗（配对窗形状，**tray stdin**，不是 overlay WS）。

侧栏「设置 → Outbound MCP」留作备用，**不是**五分钟主路。

**禁止：** overlay WS `outbound_mcp.grants.issue`；HUD `mcp.add` 当签发。

丢失租户机器：侧栏 grants 管理 **撤销/轮换**（今天已有 revoke）。切片 1 文档加一句「钥匙丢了去设置撤销」；CLI `outbound-grant revoke` 可同切片，不挡签发主路。

### 8.4 L3+ 外泄（BLOCK，折进五分钟 DoD）

页文 / 截图交给**第三方 LLM** = **操作者 HITL**，不是调用方自签。

- 今天：Codex 调 `cmspark__accept_data_disclosure` → grant bearer 标记会话。**L4 违规自证。**
- 应当（两条都要，不是二选一放空）：
  1. **签发钥匙时**勾选「允许 caller X 把页文/截图发给其云模型」。勾选 = **该 caller、可撤销、写审计**，不是 30 天无记录的笼统同意。撤销走侧栏设置（已有 grants 管理）或 `cmspark-agent outbound-grant revoke`。
  2. **首次外泄工具**仍走确认台（按会话/任务，贴 ADR-022 L3+）。
- Companion 服务端会话是 SoT。MCP `acknowledge` **不够**。
- 隐私文案不得在流式外泄时写「仅本地」。

### 8.5 用户步骤（Codex / Claude Code / Grok）

1. 确认托盘是绿的。
2. 拿钥匙（§8.3），caller 填 `codex` / `claude-code` / `grok-build`。
3. 接到编程 Agent（**每份片段都必须带 grant env**；Mac DMG 路径如下，Windows NSIS 用设置页复制的 `command`+`args`，**禁止**只给 `/Applications/...`）：

```json
{
  "mcpServers": {
    "cmspark": {
      "command": "/Applications/CMspark.app/Contents/Resources/cmspark-agent",
      "args": ["mcp-outbound"],
      "env": {
        "CMSPARK_OUTBOUND_GRANT": "cmg_粘贴刚才那把钥匙",
        "CMSPARK_OUTBOUND_CALLER_ID": "codex",
        "CMSPARK_OUTBOUND_PORT": "23401"
      }
    }
  }
}
```

Claude Code：`claude mcp add cmspark -- <绝对路径> mcp-outbound` 然后补同样 env。Grok：`config.toml` 同样 env（今天 `docs/mcp.md` 片段 **漏了 grant**，文档切片必须补）。

4. **新开一轮**对话，问「用 cmspark 列出我的 Chrome 标签」。`doctor` 绿 ≠ 当前这轮已挂上。
5. 要动未批准的站：看 **确认台/托盘**，不要看 IDE。超时失败并停。

五分钟内故意不做：cookies、evaluate、CU、Jira 对象同步、第二扩展、overlay 签发钥匙。

**Adoption skill（以后写，本季文档可先一段）：** 已登录 / SSO / 已打开的页 → CMspark。CI / 干净浏览器 / 无头 → Playwright。看网络面板 → DevTools MCP。

### 8.6 本季网站 / CWS / README 永不说

无缝对接；通用 Browser MCP / 工具数竞赛；CI/headless 替代 Playwright；Connected Apps / Auto Browse；Skill-only 浏览器服务；`ws_secret` 当 MCP 钥匙；Jira/GitHub 双向对象同步；召唤器对标 WorkBuddy；0.5.2 是召唤器/租手里程碑（0.5.2 = Windows NSIS）；「用户已同意云端外泄」因为 disclosure 工具返回 ok；已登录会话不可替代（T1 未跑，只许文档内当假说）。

---

## 9. Trust：四通道四 ACL

| 通道 | 物理 | 信任 | 允许 | 禁止 |
|------|------|------|------|------|
| **1 Overlay / summoner** | `surface=summoner` WS + C-thin HTTP dispatch | **不可信 HTML** | Chat/steer；thread trash/alias；USE（list/set_active、overlay-eligible pack.apply）；冻结中的 toggle/activate | `config.set`；`mcp.add`；`knowledge.get/import/update`；`security.confirmation.response`；F-I-4 |
| **2 Tray stdin + tray WS** | Swift stdin；`surface=tray` **不受** SUMMONER_ALLOW | **本机特权助手** | 原生确认。HUD add/import **代码仍在**（hide-not-delete） | **本季铬上冻结藏入口**。不当许可证加 `knowledge.get` / 签发 grant |
| **3 Side Panel / 确认台** | 扩展 WS | 操作者面 | 全量 CONFIGURE、grant、Allow/Deny、Cockpit | 租手时不得是**唯一**确认面（L8） |
| **4 Outbound MCP caller** | stdio → loopback HTTP | **不可信**（L4） | 策展 `cmspark__*`；HITL；外泄要人批 | 默认 L2/cookies/evaluate/shell；`ws_secret`；confirm-skip |

Win/Linux：`trayEligible` 仅 Swift。Fail-closed：打开 Chrome 确认台。

---

## 10. F-UX-OVERLAY-1 / F-S-5 / F-S-10 修订（替换 08-25 一句）

> Overlay 是 Capture + 这轮 USE，不是启动器，不是第二侧栏，不是 Confirm。  
> **USE（overlay WS 已有，不涨）：** `knowledge.list` / `set_active`；`pack.list` / overlay-eligible `pack.apply`（`allowTrust` 剥掉）；`skill.list`；`mcp.list`；thread 列表/选择/新建/重命名/`delete mode=trash`；chat / file.upload 进线程。  
> **CONFIGURE（不在 overlay socket，也不在 C-thin dispatch）：** `knowledge.get/import/update/export/delete`；`mcp.add`；`config.set`；密钥；域白名单；CU 武装；grant 签发。  
> Overlay **永不** Allow/Deny。批准文案 **「打开确认台 / 托盘」**，不是「去侧栏」。Companion **不得** `chrome.sidePanel.open`（F-I-4）。  
> Mac HUD **tray stdin** `mcp.add` / `knowledge.import` **不是** overlay WS；本季 **冻结**；**不是** 加 CONFIGURE 的许可证（含 `knowledge.get`）。  
> `mcp.toggle_server` / `skill.activate` 仍在 `SUMMONER_ALLOW` 上算 **冻结的 Trust 抬升**；回滚票 `overlay-acl-rollback`；**不涨**。  
> **F-S-5：** Overlay ACL 不涨。冻结残留不是先例。  
> **F-S-10：** 用 Confirm L8 fan-out 修。操作者面不可达 → fail-closed，永不跳过。禁止用 overlay 管 MCP 掩盖。

`knowledge.get` 走托盘原生窗：本季 **REJECT**（Security + Product）。看正文 = 侧栏知识阅读器。

---

## 11. 本季切片（顺序锁）

匹配 IDF / RunProgress **不得**在 1–3 DoD 绿之前开工。

| # | 切片 | Blast | 用户能看见的完成 | 未完成时禁止假装 |
|---|------|-------|------------------|------------------|
| **1** | 租手钥匙 + 文档片段 | T3 + T0 | 不打开侧栏设置也能签发 `cmg_`（CLI 或托盘）；片段含 grant + Windows 路径；`require_grant` 仍默认 true | 「无缝」；JSON 缺 grant；bake-off 仍 Bearer `ws_secret` |
| **2** | Confirm L8 | T3 | Overlay/租手起源：确认台+Mac 托盘能批；关召唤器确认还在；浮窗无允/拒；Win/Linux 打开 Chrome 才能批 | 浮窗 Allow/Deny；没人点就跳过；仍说「去侧栏批准」 |
| **3** | 召唤器诚实 | T2 | 默认收起条；「展开对话」；Chrome 关着 L0 能聊、L1 有 **打开浏览器**；MCP 轨从展开铬拿掉；HUD 导入/添加入口隐藏 | 「展开工作台」；丢英文错误码；承诺弹出侧栏 |
| **4** | T1 真人 | T0 过程 | 已登录任务 bake-off 记分卡。门面宽，不门形态 | T1 没跑就扩 profile；T1 失败就删租手 |
| **5** | 侧栏空态/作曲 | T2 | 打开侧栏：角色+22px 招呼+句子邀请+能打字。确认/急停不藏 | 变成 Chrome Gemini；新视觉世界压过 stream |
| **6** | 匹配诚实 / RunProgress | T2，挡在 1–3 后 | IDF port 进现有 TS（不嵌 Python）；清单 = 聊天列 L0 显示，勾选绑 `tool_result` 或人手势 | 宣称语义匹配已修好；Mission Board 当 todo；模型自勾 |

切片 1 与 2 **同一里程碑**：五分钟租手未完成 = L8 未绿。代码可并行。

**切片 1 DoD（外部可观察）**

- 不打开 Side Panel → 设置，能签发 `cmg_` 并贴进 `CMSPARK_OUTBOUND_GRANT`。
- 空 grant + 默认 config → `GRANT_REQUIRED`（不静默 `ws_secret`）。
- grant + Chrome 关/未配对 → `EXTENSION_UNAVAILABLE`。
- Codex navigate 非白名单 → 人看见确认台和/或 Mac 托盘；拒绝/超时 → `OUTBOUND_CONFIRM_REQUIRED`。
- 默认 profile 仍拒 cookies/evaluate/shell。
- 签发钥匙或首次外泄：人勾过披露。调用方 `acknowledge` 不够。

**切片 2 DoD**

- Overlay 触发需确认的 L2 或入站 MCP：HUD/HTML **无** Allow/Deny；确认台打开或 Mac 托盘出现；**可关掉 overlay** 再批。
- 杀 overlay 进程：确认仍在，直到托盘/Cockpit/超时。
- Win：不跳过；扩展能连则确认台出现，否则显式失败。

**切片 3 DoD**

- 双壳 chevron = 展开/收起对话。
- Chrome 未连：可见 **打开浏览器**，文案含「不能替你打开侧栏」。
- 展开默认 = 对话；MCP 图标不在展开铬上（**hide-not-delete**）。
- 切片 3 复制测试改完且绿；`summoner-workbench-compose.test.ts` 保持绿（不删 MCP 源码）。

---

## 12. NEVER（深化后仍成立）

1. 第二只 Chrome 扩展（CWS for Codex/Claude/Cursor/WorkBuddy）  
2. 召唤器变成 WorkBuddy；第三聊天；第六轨  
3. 侧栏 IDE；ACP `allow_exec`；静默 apply  
4. Overlay 确认方言；`knowledge.import/get` 进 summoner WS；`mcp.add` 进 overlay WS；`config.set`；HTML 麦  
5. 默认 outbound 放入 L2 / cookies / evaluate / shell  
6. `ws_secret` 当 MCP grant  
7. 因 overlay 不能点就跳过确认  
8. Jira/GitHub 当 CMspark 对象双向同步（真相源仍是那一页 + 用户自备 inbound MCP + ACP 任务包；正文 = 不可信检索数据 F-S-1）  
9. 默认 embedding / Companion 内嵌 Python matcher  
10. 用 overlay 管 MCP 掩盖 F-S-10  
11. 用户面把租手叫成 Handoff / 编程接力  
12. 公开配方不写「实验 / T1 未跑」却声称护城河或五分钟无缝  
13. 调用方自签当作用户同意云端外泄  

**作废（相对 08-26 策略，脊柱已废）：** 「给别人当插件整段降级」；「脱离扩展的一概不得在召唤器」；「T1 没跑就不能把租手当形态」。

---

## 13. 开放题 — 本 SoT 结案

| 题 | 本季裁决 | 以后 |
|----|----------|------|
| Mac HUD vs HTML 双壳 | **保持双壳**。Mac 热键 = Swift HUD；Win/Linux = HTML。**同一文案合同**。不合并展开面。Mac 托盘菜单若仍开 HTML，标「实验网页壳」 | 原生壳统一另票 |
| `knowledge.get` 托盘原生窗 | **否。** 看正文 = 侧栏 | 若做：原生窗 + 非 overlay WS + 只读 + dual-review |
| Win/Linux 托盘原生确认 | **否。** 强制打开 Chrome → 确认台。超时失败 | 工时单独立项 |
| grant 前缀 | 对外永远：`cmg_` 钥匙；`cmspark__*` 工具；`ws_secret` 配对 | — |
| overlay-acl-rollback | 票存在；切片 1–3 不实施。铬上先藏开关 | 回滚 `mcp.toggle_server`；`skill.activate` 再分类 |

Kimi 报告：**诊断保留**。三处校正：0.5.2 = Windows 安装器不是召唤器里程碑；T1 未跑；UX 护城河最薄 → 季度押在租手 + 确认诚实，不押抄 Gemini。

---

## 14. 文档同步清单（本 T0 切片内完成）

| 文件 | 改什么 |
|------|--------|
| `PRODUCT.md` | One sentence / Jobs / Surfaces：家 = 已登录 Chrome + 硬闸 |
| `docs/GOAL.md` | 定位段同一句 |
| `docs/DESIGN.md` | 四面 + 召唤器默认收起条；展开 = 对话 |
| `docs/README.md` | 链到本 SoT |
| 本目录 user-first 脊柱 | 头注：身体 = 本文件；图上 Handoff → 租手 |
| `docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md` | F-UX-OVERLAY-1 换成 §10 |
| `docs/adr/022-outbound-mcp-server.md` | L2 **叙事句**加 08-26 注；L3–L9 不动 |
| `docs/mcp.md` | **实现切片 1 再改**公开配方（grant env、声明、Windows）。本 T0 不把未实现的 CLI 写成已存在 |

确认台用户指南：侧栏红条 Allow/Deny **仍正确**（Operate 面）。加 8 行：召唤器/租手起源看确认台，浮窗没有批准按钮 — 可随切片 2。

---

## 15. 自检

- [x] 无 TBD 当门（开放题已结案）  
- [x] 与脊柱不矛盾：同一只手、USE/CONFIGURE、无第二扩展  
- [x] 「打开确认台」有动词，不是口号  
- [x] 实现者不能发明 grant 门（CLI / 非 overlay）  
- [x] L8 ≠ 已有 MCP 侧栏重定向  
- [x] 用户面租手 ≠ ACP 编程接力  
- [x] 本文件不包含实现代码  
