# 当轮活计划：做事时聊天列就要有具体「本轮步骤」

> **日期**: 2026-08-31  
> **状态**: **r2b LOCKED · r2b dual Product/Trust/UX AWN · Skeptic REJECT（信封/key/缺 stamp 双义）已折进正文。可写 plan**  
> **GitHub:** [#265](https://github.com/nehcuh/cmspark/issues/265)  
> **对抗合成:** [runprogress-265-spec-adversary-synthesis-2026-08-31.md](../../audit/reviews/runprogress-265-spec-adversary-synthesis-2026-08-31.md)  
> **线稿:** [.impeccable/mocks/runprogress-live-plan-wires.html](../../../.impeccable/mocks/runprogress-live-plan-wires.html)（00 现状空 · **01/02 采用** · 03 草稿否 · 04 C 仍否）  
> **不推翻**: ADR-020 · ADR-016 Board ≠ 本轮步骤 · #227 其余 · #237 exact `tool` · #256 Wave 1 铬（C 否，Wave 2 NO-GO）· #262 sticky `null` · #230 自动勾仍冻 · overlay 无勾 · `ComputerTaskBar` 不回 Panel  
> **本票修订切片 6**：`source: "seed"` = 可勾的 companion 写入（H1 **或** `run_progress_propose`），不再是「仅 H1」。  
> **本文件不写代码。** 实现另开 plan + PR，`Closes #265`。

```text
Surface:      L0 ChatView RunProgress only; no StatusRail; no overlay paint
L2-classes:   none; Confirm / 急停 never buried
Compose:      run_progress_propose + per-request page-tool PROPOSE_REQUIRED
Autonomy:     n/a — sequencing error, not Mission Board, not L2
Trust:        ticks = exact item.tool or Side Panel click; overlay handshake deny; no model self-tick
Channel:      community
```

**Blast:** 本文件 = **T0 文档**。落地 = **T3**。

---

## 0. 产品句

用侧栏让已经打开的 Chrome 干活时，**这一则用户消息里只要开始操作页面，聊天列就要出现具体可勾步骤**。不必等 H1 压缩。它仍是「本轮步骤」，不是顶栏任务板，也不是确认台步骤轨。

「看见」= 本则 `chat.create` 里 **`run_progress_propose` 成功之后**才挂卡。第一次页面工具可先失败（`PROPOSE_REQUIRED`，无副作用）再 propose 再重试。不做页面工具的闲聊可以没有卡。用户已清卡（sticky `null`）本请求可以无卡、页面工具照常。准入挡的是「还能操页但清单仍空」。

用户选线稿 **01+02**，否 **03 / 04**。

---

## 1. 选定的路（r2）

| 分叉 | r2 锁定 |
|------|---------|
| 谁写 | 工具 `run_progress_propose`。禁止散文抽取、禁止从用户句拆。 |
| 本轮 | **一次 `chat.create`**。该请求至多一次成功 propose。下一则用户消息可整表替换（含 H1 残单）。 |
| 忘了调 | 第一次页面工具返回 `PROPOSE_REQUIRED`（可重试）。`list_tabs` 不挡。propose 成功后本请求不再挡。 |
| 写成什么 | `source: "seed"`，id `live:{i}`，`done` 强制 false。非法/`run_progress_propose` 的 `tool` 丢掉。 |
| 挂在哪 | Wave 1 聊天列。不进 StatusRail / FocusBand / overlay。 |
| Wave 2 / C | 不开门。 |

---

## 2. 用户能看见的完成

- 侧栏对当前页发出操作（`click` / `navigate` / `get_page_text` / `type` / `wait_for` / `evaluate` / `screenshot` / `create_tab` 等 **页面工具**）时：同一则消息内，模型必须先成功 `run_progress_propose`，聊天列出现 1–8 条具体「本轮步骤」。**不**等 H1。
- 只 `list_tabs` / 纯问答：可以没有卡。
- ≤3 摊开 / ≥4 默收 / sticky / `n/m` / 禁「进行中」= Wave 1。本票 UI 只允许 `ChatView` `key={`${activeThreadId}:${listSig(runItems)}`}`（全表 id+text，禁止只取首条 id）。`RunProgress.tsx` 零行为 diff。
- 精确 `item.tool` + 成功 `tool.result` → 勾。没绑则手点。`run_progress_propose` **永不**当勾证据。
- 召唤器不画、不勾、不写。
- `#230` 仍冻。

### 未完成时禁止假装

- 禁止说顶栏有清单。
- 禁止把「没做页面工具所以空」说成 bug；禁止把「准入被绕过仍空」说成完成。
- 禁止模型 JSON 自勾、子串勾、overlay ingest。
- 禁止同一 `chat.create` 内第二次成功 propose。
- 禁止新 `thread.todo`、Board / ComputerTaskBar 进 Panel、文案「进行中」、Wave 2。

---

## 3. 协议

### 3.1 工具 `run_progress_propose`

- catalog + `COMPANION_TOOLS` + dispatch case。
- **不**进 `l2-admission`、outbound `cmspark__*`、`SUMMONER_ALLOW`。
- **工人**：名加入 `WORKER_HARD_DENY`；`isToolAllowed` / `roleAllow` / `thread.update` 滤掉。工人 **免** `PROPOSE_REQUIRED`，也 **禁** propose。只写 conductor/normal 线程。测：`tool_allow: ["run_progress_propose","click"]` 的工人工具表无 propose，click 不挡。
- 写入走独立 `mapProposeItems`（强制 `done:false, source:seed, id:live:i`），禁止成功路径「只 sanitize(raw)」；测：`sanitize(rawModel)` 不得当成功路径。
- 参数：`items` 1..8，每项 `text`（scrub 后 cap 120）+ 可选 `tool`（`scrubTool`；`run_progress_propose` 视为非法，丢掉 tool）。schema **拒**第 9 条（不要静默 cap 成 8 当成功）。
- 映射（唯一写入形状；先 map 再 sanitize）：

```text
{ text, tool? } → { id: "live:{i}", text, tool?, source: "seed", done: false }
```

模型传入的 `done` / `source` / `id` **丢弃**。测：payload `{ done: true, source: "user", id: "x" }` 仍落 `done: false, source: "seed", id: "live:0"`。

- 成功：`{ success: true, data: { written: N } }`。失败与现网 companion-dispatch 同形：`{ success: false, error: string, data: { error_code } }`。`error_code` 仅：`ALREADY_HAS_STEPS` `PROPOSE_REQUIRED` `CLEARED` `EMPTY_ITEMS` `SUMMONER_ACL` `WORKER_DENIED` `THREAD_REQUIRED`。
- catalog 描述（中文，禁「进行中」）：在操作页面前提出本轮具体步骤。每则用户消息最多成功一次。每条可附精确内部工具名（`click`、`get_page_text`、`navigate`…），不要从中文猜。若返回 `ALREADY_HAS_STEPS` 不要在本则消息里重试。

### 3.2 `proposeRunProgress(thread, items, *, { replaceOk })`

纯函数。`replaceOk === true` 时允许整表替换未勾残单。

sticky `null` → `{ ok: false, error_code: "CLEARED" }`（`=== null`，禁 `!progress`）。  
`EMPTY_ITEMS`：map 后 0 行。  
既有 `applyToolResult` / `userToggle` / `seedRunProgress` / `nextRunProgressAfterToolSuccess`：**除** adapter 对 `toolName === "run_progress_propose"` 跳过 tick 外，零行为变。

### 3.3 本轮门（adapter 请求内状态，不进 thread 字段）

每个 `chat.create` 闭包一个 `proposedThisRequest: boolean`（默认 false）。

| 事件 | 行为 |
|------|------|
| `run_progress_propose` 且 `proposedThisRequest === false` 且非 sticky null | 调用 `proposeRunProgress(..., { replaceOk: true })`（可冲 H1 残单）；成功则 `proposedThisRequest = true`；一次 `update` + **仅** `execOpts.broadcast({ type: "thread.updated", thread })` |
| 再次 `run_progress_propose` 同请求 | 不写；`ALREADY_HAS_STEPS` |
| 页面工具 且 `proposedThisRequest === false` 且非 sticky null | **不执行**；返回失败信封（见 §3.1）`data.error_code: "PROPOSE_REQUIRED"`。模型应 propose 再重试该工具 |
| 页面工具 且已 propose / sticky null | 照常执行（null 保持无卡） |
| `list_tabs` 及其它非页面工具 | 不挡 |

**页面工具 SoT（导出常量 `RUN_PROGRESS_PAGE_TOOLS`）** = `TAB_LEASE_TOOLS` ∪ `{ create_tab, osascript_eval, host_computer }`。名字必须 ⊆ catalog（`drag_and_drop` 不是 `drag`；含 `get_page_html` `dblclick` `fill_form` `browser_download`）。`list_tabs` 不在集合内。

`mcp__*` **不是**本票准入（产品句 = 自家 CDP/host 操页；MCP 旁路记已知残，不假装已保证）。`PROPOSE_REQUIRED` **不**计入 `CONTINUOUS_FAILURE_LIMIT`，也 **不**计入 `recoverableFailureCounts` / `MAX_SAME_TOOL_RECOVERABLE_FAILURES`（否则模型连点三次 click 会停轮、卡永远挂不上）。

**不是** L2：无确认台、无 `security_token`。

sticky `null`：本请求不要求 propose，也不写。

### 3.4 overlay / surface

- `filterToolsForSurface("summoner")` 剥离 catalog 名（既有 `isSummonerNativeExecutorDenied`）。
- **ACL 位不准进模型袋。** `execParams` 禁止出现 `surface`；LLM args 里的 `surface` 剥掉（与 `__outbound_*` 同形）。dispatch 读 adapter 闭包里的 handshake / `chatCreate.surface`（`stampCmsparkSurface`），**不**读 tool params。
- **缺 stamp 一义：** executor 必须从 **WS handshake**（`getWsAuthState(ws)`，经 `execOpts.handshakeSurface`）传入。`handshakeSurface === "summoner"` → 不写。`handshakeSurface` 缺失 → 不写。`tray`（panel 省略经 `stampCmsparkSurface` 变成 tray）→ 可写。模型 args `surface` **永不**当门。
- 新系统规则只在 `chatCreate` handshake **不是** summoner 时拼接（`tray` / omit）。禁止写进共享 `basePrompt`。缺 stamp 的 dispatch 不写；prompt 只看 chatCreate handshake，不看 tool params。

### 3.5 勾

- `applyToolResult` 仍 exact `item.tool === toolName`，只 seed\|user。
- adapter 成功路径：`if (toolName === "run_progress_propose")` **不**调用 `nextRunProgressAfterToolSuccess`。
- 测：propose 成功不得把任何行 `done` 变 true。

### 3.6 广播 / 替换原子

成功路径一次 `threadManager.update({ run_progress: next })`，`next.items.length >= 1`，然后 **仅** `execOpts.broadcast({ type: "thread.updated", thread })`。禁止先写 `{ items: [] }`。`EMPTY_ITEMS` / `CLEARED` / 任何失败 **不写**（含不写空数组）。adapter tick 路径的 `sendToExtension` 只管 `applyToolResult`，不管 propose。

---

## 4. UI / 文档

- `RunProgress.tsx` 零行为 diff。
- `ChatView.tsx`：`key={`${activeThreadId}:${listSig(runItems)}`}`。`listSig` = 各行 `id + "\t" + text` 用 `\n` 拼接（不是只取 `items[0].id`：`live:0` 在 live→live 替换时不变）。thread 换或清单身份换 → 按 `defaultExpanded(n)` 重挂。
- StatusRail / FocusBand / overlay HTML：零清单铬。overlay 源码锁「本轮步骤」勾选 UI 仍在。
- 密度：01 场景流内三摊开约 110px 是选定，不进顶栏。不宣称 App 铬占比不变。L2 40% 债不修。线稿 busy「正在操作当前页」**不是**产品铬，实现不得抄。
- `DESIGN.md` Side Panel：**删**「density budget unchanged」和单独「(H1 seed)」；改为 H1 **或** 当轮 propose。Wave 1 的 ≤3/≥4、sticky、`maxHeight`、`n/m`、exact `tool`、不进 StatusRail/overlay **保留**。
- 切片 6 / `run-progress.ts` 头注释：v1「seed-only from H1」改为 seed = 可勾 companion 写入。

---

## 5. 测试锁

1. 线程 `run_progress` 为 `undefined` / `{ items: [] }` 时 propose 合法 `items` → `live:0` seed、`done: false`。空 `items` 或 map 后 0 行 → `EMPTY_ITEMS`，不写。
2. 同请求第二次 propose → `ALREADY_HAS_STEPS`，对象恒等。
3. 新 `chat.create`（`replaceOk`）可替换未勾 H1 残单。
4. sticky `null` → `CLEARED`；页面工具不要求 propose。
5. `{ done: true, source: "user", id: "x" }` → 仍 `live:0` seed 未勾。
6. `tool: "run_progress_propose"` 被丢掉；propose 成功不 tick。
7. 未 propose 时 `click` → `{ success: false, error: string, data: { error_code: "PROPOSE_REQUIRED" } }` 且无副作用；不增加 `recoverableFailureCounts`；propose 后再 `click` 执行。`get_page_html` / `dblclick` / `fill_form` / `osascript_eval` 同。
8. `list_tabs` 未 propose 也可执行。
9. catalog + `COMPANION_TOOLS` 含名；`l2-admission` 不含；outbound `cmspark__run_progress_propose` 禁止。
10. summoner 工具表不含；handshake summoner **或** 缺 stamp 不写；passthrough `surface:"tray"` 在 summoner 不写。
11. overlay 会话 prompt **不含** `run_progress_propose`；`basePrompt` 常量不含该名；panel 路径含；新句无「进行中」。
12. `RUN_PROGRESS_PAGE_TOOLS ⊇ TAB_LEASE_TOOLS ∪ {create_tab, osascript_eval, host_computer}`；每个名字要么在 catalog / `getAllToolDefinitions()`，要么本就在 `TAB_LEASE_TOOLS`（允许 `set_tab_url` / `browser_download` 别名）。**不含** `read_page` / 裸 `drag`；含 `drag_and_drop`。
13. 成功 propose 仅 `execOpts.broadcast(thread.updated)`；单次 update `items.length>=1`；失败不写 `[]`。
14. overlay HTML glob 本轮步骤勾选 UI 仍禁。
15. H1 在 **另一请求已 propose** 之后仍 no-clobber（既有测 + 本请求内 H1 不得覆盖）。
16. 工人 HARD_DENY + click 免准入。
17. 适配器首次 propose 必 `replaceOk: true`（测 3 不得只测纯函数）。

Extension：`run-progress-ui.test.ts` 锁 `listSig`（id+text 全表），禁止只 `items[0].id`。不改 Wave 1 默开公式。

---

## 6. NEVER

- overlay Allow/Deny；第二扩展；`ws_secret` 当 grant
- StatusRail 手风琴 / Wave 2 Glance
- 复活 `ComputerTaskBar`；新 `thread.todo`
- toggle 进 `SUMMONER_ALLOW`
- 散文抽取 / 用户句拆步骤
- 把 `run_progress_propose` 当 L2 / 确认台
- 模型 JSON 自勾；`text.includes`；对该工具名 tick
- 宣称 #230 已闭合
- 扩 outbound profile
- 同一请求内无界改写
- 共享 `basePrompt` 常量对 overlay 注入本工具
- 文案「进行中」当本轮步骤标题

---

## 7. PR 切

一刀 T3：catalog + `COMPANION_TOOLS` + dispatch + adapter 准入/surface 注入/跳过 tick + `proposeRunProgress` + ChatView key + 测 + DESIGN/切片 6 句。

---

## 8. 自检

- r1 四路 REJECT + r2 Trust/UX/Skeptic 冲突针已折进 r2b。
- 页面工具 = `TAB_LEASE_TOOLS` ∪ create_tab/osascript/host_computer；无 `read_page`/`drag`。
- surface 不进 execParams；工人 HARD_DENY；listSig 全表。
- 顶栏 C / Wave 2 仍否。
