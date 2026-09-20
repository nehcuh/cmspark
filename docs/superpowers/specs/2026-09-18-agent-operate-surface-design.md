# 操作面：工具史折叠 · 归档省略 · ACP 内嵌终端 · Goal Driver · 舰队透视

> GitHub: #502
> 日期：2026-09-18
> 状态：**用户锁定**（2026-09-18）线稿满意；五条结论见下。实现按切片开 PR，`Refs #502`。
> 落地顺序：**A → D-G1 → B → E Glance/Inspect → C P1**。Observatory / 原生工作台另票。
> 对抗输入：Claude `out-claude.md`（Alacritty/PTY）；Pi `out-pi.md`（100 / goal / 归档三层）；Kimi `out-kimi.md`（舰队三档）
> 线稿：`.impeccable/mocks/agent-ux-2026-09-18-wires.html`
> 交互稿：`.impeccable/mocks/agent-ux-2026-09-18-interactive.html`
> 实现计划：`docs/superpowers/plans/2026-09-18-502-a-tool-history.md` · `docs/superpowers/plans/2026-09-18-502-g1-round-limit.md`

```text
Surface:      Side Panel stream + Settings + 已有全页 terminal tab + 可选全页 observatory
L2-classes:   none new; Confirm / 急停 never buried
Compose:      ACP 仍是 Composition；Fleet 仍是 ADR-015 threads
Autonomy:     Goal/loop 续跑必须显式武装；resume/fork 不自动武装
Trust:        操作史省略不得吞 L2 证据；redact 规则不放松
Channel:      community
```

**Blast：** 本文件 = **T0 文档**。落地：A T1 · B T2 · C T2 · D T3 · E T2。

---

## 0. 产品句

人看的是对话结果，不是 agent 点了哪个按钮。中间过程默认收起、归档默认不存全文、长任务按目标停而不是数到 100、多路 agent 能被看懂、编程接力能在已有插件终端里双向交互。

副句：给 agent 用的轨迹仍在；给人看的默认是答案、目标、确认。审计是主动动作。

---

## 1. 不是五个新产品

这是同一张 Operate 面的五刀，按依赖切开，禁止打成一个 PR。

| 切片 | 用户看见 | 仓库里已有、不要重做 | 不做 |
|---|---|---|---|
| **A 工具史** | 活着的一步展开；做完折成芯 | ToolCallCard「详情」、#256 本轮步骤 | 改 run_progress 语义；overlay 画工具卡 |
| **B 归档** | 默认 stub；设置开才写正文 | `tool-persistence-redact` #255 | 磁盘删光还宣称可审计；放松 redact |
| **C 终端** | 全页 xterm 可敲 + ACP 时间线 | #432 P0 xterm.js；Mode C 外跳含 Alacritty | 把 Alacritty 嵌进 MV3；侧栏跑 TUI |
| **D Goal** | 目标卡 + 停因 | `task_loop`（20 run / 30–60 min）；`STOPPED_USER` 不自行复活；`run_progress` 1–8 | 把 100 改成 10000；绕过 L2 |
| **E 舰队** | Glance / Inspect / 可选观察面 | FleetStrip 计数、Board、tab 锁 | vis 调试器塞进 320px；新 BottomBar Tab |

---

## 2. 切片 A — 工具史折叠

### 2.1 痛点

`ChatView` 对每条 `tool_calls[]` 画 `ToolCallCard`。卡头永远占行。一轮招聘站抓取可以是 8–40 张卡，答案被顶出 320px 视口。卡上的「详情」只折叠 JSON，不折叠卡本身。

#256 本轮步骤是待办清单（≤3 默开 / ≥4 默收），**不是**工具史。

### 2.2 选定

**活轨迹 + 回合审计芯。**

进行中：

- 已完成步骤收成一条芯片：`已完成 N 步 · 展开`
- 当前步骤保持 `ToolCallCard` 展开（running / 确认中）
- 失败计入芯片：`已完成 N 步 · 1 失败`

回合结束后（`chat.done` 且无 running）：

- 整段工具史收成：`N 步浏览器操作 · K 失败 · 展开审计`
- 默认给人看的是 assistant 正文
- 芯片是 `button`，`aria-expanded`，Enter / Space
- 展开后仍是现有 ToolCallCard，不新发明卡片

换线程 / 重挂：回到该线程的默收。不写 `thread.collapsed` 字段（沿 #256 pin 4 精神：折叠是视图状态）。

### 2.3 分组

同一 assistant 回合（一次 `chat.create` 的 tool-loop）= 一颗芯。不要把历史多轮合成一颗超级芯。

确认中的 L2 工具**不得**折进芯——确认台 / FocusBand 仍要看见它。

### 2.4 NEVER

- overlay 画工具史
- 用折叠把失败藏成成功
- 改 `run_progress` 当工具史

---

## 3. 切片 B — 归档省略

### 3.1 三层

| 层 | 默认 | 设置「保存完整操作史」开 |
|---|---|---|
| **UI** | 切片 A 折叠 | 仍默认折叠（开设置 ≠ 默认铺开） |
| **磁盘** `threads/*.json` | stub：`name + ok/fail + sha256 + len` | 现有 redact 后的正文（read-tier 前缀仍受 #255 闸） |
| **再喂模型** | 不把历史 click/HTML 全文塞回下一轮 | 仍受 context budget / compact；不是「开了就全喂」 |

Live 回合内存里的 tool 行保持全文（模型正在用）。只在 persist 边界折叠。

### 3.2 设置

路径：设置 → 对话档案 → `保存完整操作史`，默认 **关**。

红线：cookie / `shell_exec` / `host_*` / `osascript` / MCP 密钥 **始终 redact**。开关加不开这些全文。

L2 确认记录、capability-audit.jsonl **不**走这条省略。

### 3.3 Reload 失忆

#255 已经证明：read-tier 全 collapse → reload 后模型忘了读过的页。默认 stub 之后，记忆靠：

1. assistant 正文（必须在）
2. 目标卡 / run_progress（切片 D）
3. stub 上的工具名序列（模型看见「做过 navigate/click」，看不见 HTML）

**省略正文可以，省略行不行**（Pi 亲证，#255 的新版本）：

- 磁盘没有 `role=tool` 行 → `rebuildMessagesFromHistory` 剥掉 assistant.tool_calls，模型读到字面量 `(tool call failed)`，下一轮 heal 再回填 `INTERRUPTED`。不是 400，是静默假事实 + 重复副作用。
- stub 形状沿用已有 collapseResult：`{ tool_name, success, redacted:true, len, sha256 }`。不发明新信封。
- `history.db`（≤500 字摘要、30 天）和 `logs/*.log` **本票不关**；文档必须写明隐私目标只覆盖 threads JSON，否则「默认不保存」是假的。
- 开关打开不能「恢复」已经省略的正文。文案不得承诺这一点。
- 不回溯重写旧线程。

禁止：磁盘零 tool 行却在 UI 宣称「展开审计能看到每一步」。审计芯展开的是 stub，诚实标注「正文未保存」。

---

## 4. 切片 C — ACP 双向 = #432 P1，不是嵌 Alacritty

### 4.1 考查结论

| 载体 | 结论 |
|---|---|
| **Alacritty.app 嵌进 Chrome MV3** | **不可做**。wgpu/winit 窗口，没有扩展可嵌的视图。 |
| **Native Messaging 拉起 Alacritty** | = 外跳。Mode C 已支持偏好 `Alacritty \| Ghostty \| Kitty \| iTerm \| Terminal`（`open-local-terminal.ts`）。 |
| **`alacritty_terminal` crate** | Zed 的路：原生 GPU 终端。对标未来 Host 工作台（#476），**本票不做**。 |
| **xterm.js + node-pty** | **已落地**（#432 P0，全页 tab，darwin，默认关，canvas 渲染器）。 |
| **libghostty / wezterm mux / ttyd** | 新运行时，无收益。ttyd 还要新监听口（#432 NEVER）。 |

侧栏 320px 跑 TUI：**不成立**（#432 已否）。侧栏只放入口 / 状态 / 确认。

### 4.2 选定：双通道

同一编程会话两条腿：

1. **ACP JSON-RPC** — timeline、permission、pending diff、handback（已有 CodingAgentPanel / FocusBand）
2. **PTY 字节流** — 把 Mode C 今天外跳的 argv **挂到已有 #432 PTY**（#432 spec P1：`openLocalTerminalForAgent` 的 `embed` 分支）

用户在全页 tab 里能看见 claude/pi/kimi 的 TUI，能敲，能 Ctrl-C。权限 / 写盘仍走 ACP + L2，不靠解析 ANSI 猜确认。

### 4.3 切片

- **C0** 本票只锁方向：Alacritty 不嵌；P1 = embed 到现有 PTY。
- **C1 实现**（另 plan）：darwin；默认仍关 `embedded_terminal.enabled`；ACP 启动不自动弹 PTY（user_gesture）；非 darwin 诚实 `unsupported`。
- **C2** 断线重连 = 同进程 PTY 仍活（#432 P2），不在本票。

### 4.4 NEVER

- 侧栏 IDE / free shell / 自动 spawn
- 用 Computer Use 操作 TUI
- 新监听口 / 拆 binary WS
- 声称「插件内 Alacritty」

---

## 5. 切片 D — Goal Driver，替换「数到 100」的产品语义

### 5.1 三层熔断（不要混）

| 层 | 今天 | 人看得见吗 | 角色 |
|---|---|---|---|
| **单次 tool-loop** | `MAX_TOOL_CALL_ROUNDS = 100` | 到顶才看见那句蠢文案 | 电路熔断，防一次 `chat.create` 死循环 |
| **跨 run 续跑** | `task_loop`：maxRuns 20、墙钟 30/60 min、tokens ≤ 10× median | LoopStatusRow | DeepSeek round-driver 的已有同位体 |
| **待办** | `run_progress` 1–8，页面工具前必须 propose | 本轮步骤卡 | 清单，不是目标完成态 |

用户痛点落在第一层的**文案与停因**：工作没完成却说「100 步」；也可能第 40 步已经做完却还在空转。

### 5.2 DeepSeek / Pi 要搬的纪律（不搬包）

从 `dsh-goal` + `goal-round-driver`：

1. **Goal 是完成态对象，不是调度器。** 自动续跑必须另挂、必须武装。
2. 只在 **agent idle + 已武装 + 有余量** 时续一轮。
3. **resume / fork 不自动武装。** 与现有 `STOPPED_USER` 永不自行复活同构。
4. 耗尽记 blocker（他们是 `round-limit`），不是静默停。
5. 人可以用命令看/停目标，不花一轮模型。

Pi 生态补充：**无进展检测**、**evidence-based complete**、**token 预算**。我们已有 token/墙钟/runs；缺的是「目标完成了没有」和「是不是在空转」。

### 5.3 选定

**三对象并列，不合并。** 交互稿上的「目标卡」是这三者的合成视图，磁盘上仍分家。

```
thread
├── run_progress   证据：1–8 条，工具结果 tick
├── loop_state     激活 + episode 预算：armed / runs / 墙钟 / tokens
└── goal_state     完成态：objective / phase / roundsStarted / maxGoalRounds / blocker
```

不并进 `loop_state`：`armLoop` 每次 re-arm 会把 runs/tokens 清零。goal 必须跨 resume 存活，否则「续跑」= 新任务。DeepSeek 禁止这件事；我们今天 `resume:true` **正好反着来**（开全新预算窗口）—— D 落地必须改掉。

不并进 `run_progress`：清单是证据，goal 是意图。`evaluateCompletion` 已经是 claim ⊆ tick。

人可见（一张卡，三个源）：

- 目标句
- 核验 `n/m` ← run_progress
- 续跑 `4/20` ← loop_state / goal rounds
- 停因芯片：完成 / 无进展 / 预算 / 同工具空转 / 安全 / 人停

100 的处置（Pi 亲证 G1，必须修）：

- **数字保留**，它是单次 `chatCreate` 唯一的轮次有限性；run 内没有 token/墙钟检查点。
- 触顶从 `circuit_breaker` **降级为 `round_limit`**：这一段结束 ≠ 任务结束。loop 已武装且有余量 → 排下一段；未武装 → 建议卡。
- **禁止**再对用户说「达到最大工具调用轮次 (100)」。改说：「这一段跑完了，接着下一段」或对应停因。
- 今天的 G1：100 触顶后 loop 仍 `active`、不续跑、状态行还写「推进中」——这是撒谎的死锁，D 的第一刀就修它，即使 goal 对象还没上。

无进展：仓库已有 `STALL_K = 3`（连续零进展 run），**只是信号未接线**。接到 goal `blocked{code:"no-progress"}`。另：同一工具成功但清单 `n` 不增加，也算无进展（今天 `MAX_SAME_TOOL_RECOVERABLE_FAILURES` 只计 error）。

### 5.4 NEVER

- 无武装自动续跑
- cruise / god-mode 跳过 L2
- worker 线程自己 arm loop（已有禁令）
- 把 Board 当 Goal

---

## 6. 切片 E — 舰队透视

### 6.1 痛点

FleetStrip / FleetWorkerList：计数、最坏状态、切线程。没有「这只 worker 此刻的工具、进度、提示词」。ADR-015 并发上限 5，不是 Kimi 网页 300 路蜂群。

### 6.2 对标取舍

| 来源 | 取 | 不取 |
|---|---|---|
| Kimi 网页 Swarm | 点进一只子 agent 看它在干什么 | 300 路动画、营销向蜂群 |
| `kimi vis` | 全页时间线 / context 作为 **Observatory** | 默认开在 320px 对话流 |
| Kimi Code CLI swarm | 协调者 vs 工人分视角 | 把 vis 当操作面 |

### 6.3 三档 IA

Kimi 亲证：worker 的 `chat.token` / `tool.result` **已经广播到所有侧栏**，`useWebSocket.ts` 对非活动线程直接丢弃。Inspect 的第一刀是「别扔」，不是新通道。`tool.start` 不进 FleetSnapshot；`run_progress` 对 worker 硬拒——保持。

**Glance（默认，侧栏）**

- 现有 FleetStrip 一行已经几乎对：`N worker · M 锁 · K intent`
- 唯一增强：最近工具名（`FleetWorkerView` 加一个字段）。不加行、不加百分比。
- 点 strip → 打开已有 `FleetWorkerListPortal`（不要新 BottomBar）

**Inspect（点开一只，复用 portal）**

- 任务简报 = spawn 时写入的首条 user 消息（`persistWorkerBrief` 已有），不是组合 system prompt 全文
- 直播：订阅该 `thread_id` 广播帧（绕过 `shouldApplyStreamEvent` 丢弃），渲染 token 窗 + 工具名。**不转发 `tool.progress` stdout_tail**（注释已写 tails 可能含密钥）
- 锁、claimed Intent（link Board，不内嵌）
- 「内部 prompt」产品语义 = **工人被交代的任务句**，默认可见。完整 composed system prompt 不进侧栏（kimi.com 也不暴露；`kimi vis` 才是调试器）

**Observatory（可选全页，搭 Cockpit 的车）**

- 本 run 多列 + 锁拓扑 + confirm 历史
- 对标 vis 的运行面，不是 wire.jsonl 调试器
- 「复制调试信息」才导出 `system_prompt_append` + 简报，默认不做 context viewer

进度 SoT 双轨：Board Intent 状态（语义）+ `llm_active`/最近工具（活性）。禁止给 worker 解禁 `run_progress_propose`，禁止百分比。

Board 仍是协作板。透视只 link `claimed_by_worker_id`，不合并 UI。

### 6.4 NEVER

- overlay Allow/Deny / 新 BottomBar
- 默认展示完整内部 prompt
- 把 vis 级调试器当主对话

---

## 7. 推荐落地顺序

1. **A** 工具史折叠（纯 UI，T1，立刻减轻「往下翻」）
2. **B** 归档 stub（T2，有 reload 失忆风险，A 之后做）
3. **E Glance+Inspect**（T2，不先做 Observatory）
4. **D** 目标卡文案 + 无进展停（T3，loop 已有，先改停因再动 100）
5. **C** #432 P1 embed（T2，darwin；方向已锁）

Observatory 与 Host 工作台原生终端另票。

---

## 8. 验收（设计层）

- AC-A：一轮 ≥4 个工具结束后，视口里是 1 颗芯 + 答案，不是 4 张卡；点芯能看到每一步。
- AC-B：默认新线程磁盘无 get_page_text 全文；设置打开后有 redact 前缀；cookie 全文两种开关都没有。
- AC-C：产品文案与稿面都不声称「插件内 Alacritty」；P1 计划指向现有 PTY。
- AC-D：用户不再看到「(100)」；完成/无进展/预算/人停 四条路径文案可区分。
- AC-E：两只 worker 时侧栏 Glance 可见；点开能看到当前工具；prompt 默认不出现。

---

## 9. NEVER（票面总表）

- overlay Allow/Deny
- 第二只 Chrome 扩展
- `ws_secret` 当 MCP grant
- #230 overlay-acl / 自动勾
- 扩默认 outbound profile
- 侧栏 IDE / free shell / 自动 spawn ACP
- 用 Computer Use 操作 TUI
- 把 Alacritty 嵌进 MV3
- 新 BottomBar Tab
- 把 Board 改成运行时透视

---

## 10. 开放问题（实现票再钉，不挡方向）

1. 无进展接到 `STALL_K=3` 时，是否同时计入「同工具成功但 n 不增加」（建议计入）。
2. `maxGoalRounds` 的默认数字（建议先等于 loop maxRuns=20，与 100 的「段内节拍」分开）。
3. Observatory 是否跟 #476 桌面工作台并票。
4. stub 的 `sha256` 是否允许用户「按指纹从 live cache 取回」——默认 **否**（cache 不是档案）。
5. `history.db` / `logs/*.log` 是否在后续隐私票里一起关——本票明确不管。
