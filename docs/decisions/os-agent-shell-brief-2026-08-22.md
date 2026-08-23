# Brief: OS Agent Shell — Chrome-optional L0 from OS, Chrome as L1 actuator

| Field | Value |
|-------|--------|
| Date | 2026-08-22 |
| Status | **DRAFT — post-adversary v2.1**（四路对抗 REJECT → 折回 → Pi/Claude/Kimi 均为 APPROVE_WITH_NITS；nits 已折） |
| Adversary | [synthesis](../audit/reviews/os-agent-shell-adversary-synthesis-20260822.md) |
| Identity lock | **能力**：关 Chrome 仍能在**同一 thread** 上说话；需要网页再 attach 用户 Chrome。**文案**：召唤器不是「主界面」。完整工作面在 Chrome 在场时仍是 Side Panel。非 Raycast 克隆。 |
| Related | [ADR-020](../adr/020-capability-model-three-axes.md) · [Native HUD brief](v1.3/companion-native-hud-brief-2026-07-27.md) · [N1–N10 lock](v1.3/companion-native-hud-n1n10-lock-2026-07-27.md) · [ADR-017](../adr/017-computer-use.md) · [ADR-021](../adr/021-unattended-desktop-session.md) · [ADR-022](../adr/022-outbound-mcp-server.md) · tray/`Tray.swift` · `pickAuthenticatedClientWs` |
| Blast tier | **T3** |
| Non-goal of this brief | 实现代码、Electron 重写、插件市场、Windows/Linux 原生对等、GOAL 一句话在 P0 证伪前改写 |

---

## 0. Capability declaration（ADR-020）

```text
Surface:      L0 捕获面 = macOS 召唤器（Chrome 缺席仍可续聊）；完整 L0/L1 工作面 = Side Panel；L2 = HUD/Cockpit
L2-classes:   本 brief 不新增 host_* / shell / netsec
Compose:      Skill · Knowledge · MCP · Pack — 召唤器只检索/预览；安装与 trust 抬升仍走 Panel
Autonomy:     单线程默认；不因召唤器引入 auto-spawn / 新 Board
Trust:        与 tray 同一 SHA256 门；确认单 writer = N5（overlay 不渲染 Allow）；拉起 Chrome 必须真 user-gesture UI RPC
Channel:      community；enterprise 不因召唤器抬升
```

**规范用语**：禁止「中层 Agent」、第二 runtime、把召唤器叫「家/主界面」。它是 **Axis A 的 L0 捕获壳**，不是第四轴。

**对 ADR-020 §1**：P0 证伪**通过前不改** GOAL / ADR 一句话。最多加「实验：菜单栏召唤」。通过后再开 ADR，且必须 **macOS-scoped**，禁止用「本机 Agent」与 L2 宿主面撞车。

---

## 1. Why this document exists

Owner 锁定身份 **2**：用户关浏览器仍能对话；需要网页作用面时再 attach Chrome；全局热键召唤；可查历史；可「加插件」。

这与 2026-07-27 Native HUD brief 的 **明确非目标**（「不把 L0 对话搬出 Side Panel」「不做 native chat app」）冲突。v2 收窄为：

- HUD 仍是 **L2 宽面**。**N2 不改**（MinimalConfirm 仍 Panel-only）。**N5/N6 不改**。N1：单 SHA256 二进制 LOCK；是否单进程 OPEN（IME×CU）。
- 新增 **L0 捕获 overlay**（非第三确认台、非 Electron 主窗、非「取代 Panel 的家」）。
- HUD §6.2 改为：日常完整对话在 Side Panel；召唤器是缺浏览器时的续聊/检索。P0 不改 GOAL 一句话。

v1 误写「今日拓扑已允许翻转」。对抗（CORRECTNESS）指出：**chat loop 的 `createToolExecutor(ws)` 把 `tool.execute` 发给发起 socket**；`pickAuthenticatedClientWs` **只**绑 outbound MCP。Tray 发起的 L1 会 15s timeout，不是 typed `BROWSER_UNAVAILABLE`。

| 事实 | 位置 | 含义 |
|------|------|------|
| Outbound L1 只绑 `chrome-extension://` | `lifecycle.ts` `pickAuthenticatedClientWs` | **仅 HTTP outbound**；不是 chat loop |
| Chat loop L1 绑**发起** WS | `lifecycle.ts:796` + `tool-forward.ts` | 召唤器/tray 聊再调 L1 → 打到不会 CDP 的 socket |
| 无 extension peer → outbound 快失败 | `ensureOutboundToolRunnerWired` | Outbound MCP 挂；chat 路径不会走这条 |
| Side Panel **无法**程序打开 | `platform.ts` `openSidePanel` | CTA 不得暗示侧栏已打开 |
| macOS 只认 **Google Chrome** | `tell application "Google Chrome"` | Arc / Edge / Brave 不是 attach 目标 |
| Tray 已能 `thread.list` / 确认 / activate Chrome | tray companion-client + Swift | 同一 SHA256 二进制可承载第三窗；**进程模型 OPEN**；tray **没有** chat composer |
| HUD brief §6.2 日常对话在 Side Panel | Native HUD brief | **保留**。召唤器是缺浏览器续聊，不改 HUD 空态成「对话在召唤器」 |

---

## 2. Approaches（实现形态，不是身份）

能力锁见文首。下面只选 **壳**。v1 把 overlay 叫「家」已被对抗否定。

### A — Thin summoner overlay（推荐 · 捕获壳）

同一 SHA256 二进制增加第三扇 **lazy** 窗。窗口/热键走 stdin；`chat.*` 走 tray-origin WS + **S21 ACL**。L0 hydrate + 发送 + 标题检索。L1 缺 peer → S19 typed degrade + 诚实 CTA。

| 利 | 弊 |
|----|----|
| 复用 SHA256 门、配对、确认单 writer | Swift overlay 的输入法 / 流式渲染成本 |
| 不引入第四进程 | Windows/Linux 只能退化 |
| 与 HUD 职责正交（L0 vs L2） | 必须严格限制 overlay 不做宽面聊天 |

### B — Full native chat app（Tauri / Electron）

独立主窗口取代 Side Panel 为家。

| 利 | 弊 |
|----|----|
| 完整聊天气泡、设置、Pack UI | 第二套前端；与 Plasmo Side Panel 双写 |
| 跨平台更齐 | 身份变成「又一个桌面 ChatGPT」；违背 HUD「不做 native chat app」的成本理由 |

**拒绝作为 v1。** 可列为 P3c 仅当 overlay 证伪「薄入口不够用」。

### C — 做进 Raycast / uTools

CMspark 变成别人启动器里的 extension，stdio/WS 打 Companion。

| 利 | 弊 |
|----|----|
| 热键/插件分发免费 | 确认台、流式、HITL、L2 急停被宿主阉割 |
| | 主场在别人产品里；ADR-022 已警告「仅 Side Panel 确认对外部调用方不足」，此处更甚 |

**拒绝作为主路径。** 允许日后做 **adoption 薄封装**（只搜线程 / 唤起召唤器），不得作为 L1/L2 操作面。

**推荐：A，分阶段。** B/C 写进非目标。

---

## 3. Product model

```text
                    ┌─────────────────────────┐
                    │     Companion           │  唯一 runtime / SoT
                    │  threads · tools · L2   │
                    └───────────┬─────────────┘
                                │
        WS / stdin JSON         │
   ┌───────────────┬────────────┼──────────────┐
   ▼               ▼            ▼              ▼
 Summoner       Side Panel    HUD/Cockpit    Tray
 overlay        (page-aware   (L2 wide)      (status /
 (L0 capture)    L0/L1 view)                 pairing /
                                             L1 confirm)
                     │
                     ▼
              Chrome extension SW  ←—— 唯一 L1 执行器
```

| Surface | 主职 | 不做什么 |
|---------|------|----------|
| **Summoner overlay** | OS 捕获：当前 thread 截断 hydrate、发送、对象检索、attach CTA | 不渲染 Allow/Deny；不做 dual-track；不做设置/Pack 安装；不搜文件/App；UI 禁用「插件」「主界面」 |
| **Side Panel** | Chrome **在场时** 的完整页感知 L0/L1 工作面 | 关 Chrome 时用户改走召唤器续聊，不是产品消失 |
| **HUD / Cockpit** | L2 宽面（N2/N5/N8） | 不做完整 L0 聊天 |
| **Tray** | 常驻、配对、状态、activate Chrome、**Chrome 缺席时的 L1 确认**（既有 stdin `respond()`） | 不是第三聊天面 |

**双 L0**：召唤器无页面上下文；Panel 有。同一 `thread_id`。草稿 SoT = Companion **`composer.lease`（S20）**：overlay 可见 ⇒ overlay 持有；关掉 overlay ⇒ Panel。拒绝「后聚焦」。LIVE L2 时仍 N6（conductor = active wide shell；overlay/Panel `chat.send` 入队）。

---

## 4. Product laws（v2 锁 · S1–S24）

外审对每条给 **LOCK / AMEND / OPEN**。v1 S2/S6/S7 已被对抗 AMEND。

| ID | Law |
|----|-----|
| **S1** | 唯一 runtime = Companion。禁止第二 tool-loop。 |
| **S2** | **捕获壳（macOS）= Summoner**。Chrome 缺席时这是唯一可输入 L0。Chrome 在场时 Panel 是 **完整 L0/L1 工作面**。召唤器 **不得**对外称「家/主界面」。 |
| **S3** | L1 **仅**经已鉴权 `chrome-extension://` WS 执行。召唤器不得伪造 page state。缺 peer → 类型化错误，禁止空成功。 |
| **S4** | Attach 优先已运行用户 Chrome + 已装扩展。禁止默默空白 Profile。 |
| **S5** | L0→L1 **不换** `thread_id`。 |
| **S6** | **不改 N2**：MinimalConfirm 仍 Panel-only。Chrome 缺席时 L1/L2 确认走 **既有 tray stdin `respond()`** 与 HUD/Cockpit ConfirmElevated。召唤器只显示徽章/深链，**不渲染 Allow/Deny**。禁止第四确认方言。禁止解绑非 outbound 的 `originWs`。 |
| **S7** | Overlay 窗体薄。Chrome 缺席时必须 **hydrate 当前 thread**（纯文本，可滚动，上限建议 20 条，不是装饰 3 气泡）。完整导出/Mermaid/设置/Pack 安装仍在 Panel。**v2 空场默认 TALK**（说点什么，或按住说话…）：回车发到最近线程或新建；composer 以 `#` 开头才搜标题；L0 send 在浏览器 detached 仍可用。 |
| **S8** | 组合面索引：Pack / Skill / MCP / Knowledge。UI **禁用「插件」**。OS 一级入口 = 1；overlay 常驻控件 ≤ composer + 检索 + 缺浏览器徽章。禁止 overlay origin 的 `pack.apply`+`allowTrust`（deep-link Panel）。 |
| **S9** | 关 overlay ≠ 停任务。 |
| **S10** | **一个 SHA256 门、一个 Swift 二进制**（tray+HUD+summoner）。是否单进程 = **OPEN**，待 IME×CU spike。禁止第二哈希门。 |
| **S11** | 首次启动 **强制热键选择器**（展示系统/Raycast/输入法占用）。不默认 `⌃⇧Space` / `Cmd+Space` / Raycast `⌥Space` / uTools `Alt+Space`。 |
| **S12** | 检索封闭：线程、操作历史、knowledge、已装 Pack/Skill/MCP。不搜文件/App/剪贴板/窗口。P0 不搜消息正文；空态写明范围。 |
| **S13** | Attach/launch Chrome = **UI RPC + 真手势**，**无** LLM tool schema。`god-mode` / `auto_approve_*` / 值守 **不得** 调 `getChromeOpener()`。 |
| **S14** | 浏览器缺席是一等模式：持久徽章按 §5.1 **已实现的**状态（P0 先二元：已连接 / 未连接；五态是 P1 且须新探针）。 |
| **S15** | macOS 先行。Win/Linux P0 无 overlay；安装器/关于页必须写「Windows 仍用 Chrome 侧栏」。 |
| **S16** | L1 只 offer Google Chrome。空态提前披露，不等 L1 失败。 |
| **S17** | Origin **只**复用 `cmspark-tray://local`（v1 不新 `cmspark-ui://local`）。不得冒充 `chrome-extension://`。`pickAuthenticatedClientWs` 保持 extension-only。 |
| **S18** | P0 证伪必须可观察（§11）。失败 → 退回身份 1（召唤器=捷径），不滑向 Electron。 |
| **S19** | **conversation origin ⊥ actuator origin**。tray-class 发起的 loop：L1 只 `pickAuthenticatedClientWs()`；**禁止** `tool.execute` 打回发起 socket。缺 peer → `BROWSER_UNAVAILABLE`，且 **不得**进入 `classifyError` recoverable / 自动 retry。 |
| **S20** | `composer.lease`：holder = overlay-visible ? overlay : panel；LIVE 时 N6 优先。禁止双草稿。**P0 最小字段**：`thread_id`、`holder: overlay\|panel`、`rev`（CAS）。无此三字段不得开始 spike。 |
| **S21** | Overlay 控制面 **stdin 白名单**：开窗/热键/hydrate。`chat.*` 走 **独立 WS 连接**，握手带 `surface=summoner`（可伪造程度不超过今日 Origin；仍要 HMAC）。**ACL 只绑这条连接**，不得按 Origin 一刀切（否则会砍掉 tray 现有 `skill.list` / `executeQuickAction`）。Summoner 连接只允许 `chat.create/abort`、`thread.list/select/create`、`history.query`。硬拒：`pack.apply`+`allowTrust`、`config.set`、`security.unattended.arm`、`mcp.add`、`security.confirmation.response`。Tray 连接方法集维持现状。 |
| **S22** | `host_computer` LIVE 或 pending L2 时 overlay 不画任何确认按钮；conductor 在 HUD/Cockpit。 |
| **S23** | self-ui：进程名含 Swift tray 产物；点击坐标落在召唤器/HUD/tray/配对窗 → **硬拒该 CU action**（不是 forceForeground 后 continue）。 |
| **S24** | **HUD L2 产品化不让路**。召唤器 P0 是 spike（热键+续聊+检索+typed degrade）。GOAL 一句话定位在证伪通过前不改。 |

---

## 5. Chrome attach — 状态机（本设计最硬的边界）

「拉起浏览器」不是 `openChrome()`。L1 需要的是 **已鉴权的 extension WS**，不是可见的 Side Panel。

### 5.1 观察状态

**P0 只保证二元（今日可测）**：

| 状态 | 判据 | 用户可见 |
|------|------|----------|
| `attached` | 至少一个 `chrome-extension://` WS `authenticated` | 「浏览器已连接」 |
| `detached` | 否则 | 「浏览器未连接」+ CTA（诚实：我们不能打开侧栏） |

**P1 五态是新观察器，不是现成字段**（对抗 CORRECTNESS BLOCK）：需 OS 探针 + SW 滞回。在探针落地前 **禁止** UI 假装能区分 `sw_dead` vs `chrome_absent` vs `unpaired`。配对态走现有 `.paired` / 配对窗，不要和 Chrome 进程态混成一张表。

`openSidePanel()` 今日 **不能**打开侧栏。

- L1 协议上不依赖 Panel 可见，只依赖 SW+WS。
- **MV3 现实**：Panel 关闭后 SW 易睡（30s alarm）；`attached` 会抖。P0 CTA 必须写「点工具栏 CMspark（没有就拼图 🧩 钉上）」。
- 成功条件 = `attached`，**不是**「侧栏已出现」。
- 用户文案 **禁止**「打开 Chrome 并继续」单独出现；必须并列不能打开侧栏的事实。

### 5.2 转移（全部要 user-gesture，除探测）

```text
any --probe--> {attached, chrome_running_unpaired, chrome_absent, chrome_missing_install}

chrome_absent --[用户点「打开 Chrome」]--> launch Google Chrome (existing profile)
  -- wait up to ATTACH_TIMEOUT (建议 20s，可配，封顶 45s 对齐确认超时) -->
     attached | chrome_running_unpaired | attach_timeout

chrome_running_unpaired --[用户点「显示配对码」]--> 现有配对窗（不得新发明）

chrome_running_sw_dead --[用户点「唤醒」]--> activate Chrome（仍可能要用户点扩展图标）
```

**禁止**：模型在 tool_call 里带 `force_launch_browser`；god-mode / auto_approve **不得**代替 S13。

### 5.3 升面时序（同一 thread）

**今日缺口（必须先改代码再谈 P0 L1）**：`createToolExecutor(originatingWs)` 会把 `tool.execute` 发到 tray socket → 15s 英文 timeout → `classifyError` 当 recoverable → 模型重试。v1 brief 把 outbound 的 `EXTENSION_UNAVAILABLE` 错贴到这条路径。

正确时序：

1. 召唤器 L0：只调 L0/组合面 → 不需要 attach。  
2. LLM 发出 L1 → **S19 gate**：`pickAuthenticatedClientWs()` 为空则 typed `BROWSER_UNAVAILABLE`（**新码**，非 recoverable，禁止 retry）。召唤器展示诚实 CTA。不把幻觉 DOM 塞进上下文。  
3. 用户手势 activate Chrome 后，点 **「已连接，继续对话」** = **新 user 消息**。服务器 **禁止**重放上一 L1 tool_call。  
4. 确认超时 45s 与 attach **无现成耦合**（不要假装对齐）。确认只走 N5（tray/HUD）。Overlay 不倒计时。  
5. **无** `openChrome` / `force_launch_browser` tool。

### 5.4 Profile / 多实例

- v1 只支持 **默认「Google Chrome」**，不选 Profile。多 Profile 列为 OPEN（§14 Q3）。
- 已运行的 Chrome 用 `activate`，不 `open -n` 第二实例。
- 远程调试端口、Chrome for Testing、headless：**永不**作为用户 L1 attach 目标（那是 Playwright 地盘，ADR-022 L6）。

### 5.5 与 Outbound MCP 的交叉

Outbound 已经依赖 extension peer。召唤器 **不** 变成 outbound 的确认面替代（ADR-022 L8 仍要「不要求 Side Panel 聚焦」）。Tray 确认继续承担「IDE 调用时的 allow/deny」。召唤器只订阅 N5 `resolved` 广播，显示 **只读确认徽章**（无 Allow/Deny，无响应路径）。禁止把这叫做 MinimalConfirm。

---

## 6. 「插件」映射（Composition，不是市场）

用户说「还可以添加插件」。锁成：

| 用户可能以为 | 实际原语 | 召唤器动作 |
|--------------|----------|------------|
| 斜杠命令 | Skill（Type A） | `/` 或检索名 → 激活到当前 thread |
| 场景包 | Mission Pack | 检索 → 预览 → **deep-link Panel**（overlay 不得 `pack.apply` / `allowTrust`） |
| 外接工具 | MCP server | 检索已配置 server；**不**在 overlay 里现场加任意 stdio（设置仍走 Panel/config） |
| 记忆 | Knowledge | 检索命中片段，引用进当前对话 |

v1 overlay **安装** Pack/Skill：只 deep-link Panel。URL 安装禁止。`allowTrust` / `user_gesture` **硬拒** tray/overlay origin（S8/S21）。检索命中默认返回 id+标题；纳入 LLM 要第二次手势（不默认整库上传）。

---

## 7. 历史检索

| 源 | API（已有或需扩） | 查询形态 |
|----|-------------------|----------|
| 线程列表 | `thread.list`（tray 已用） | 标题 / alias / 时间 |
| 操作历史 | `history.query` | 工具名 / URL / 时间窗 |
| 消息正文 | thread store 本地倒排或线性扫（v1 可笨） | 关键字；**不**默认丢给云模型做语义搜 |
| Knowledge | 现有 semantic-match | 站点/全局；无 tab 时不假装有「当前页」 |

隐私锁：召唤器检索默认 **本地**。禁止「把全部历史上传再问 LLM 找」。用户显式选中一条再纳入当前 LLM 上下文。

结果点击：打开对应 thread 到 overlay composer（薄）或「在 Panel 打开」（若 `attached`）。

---

## 8. Trust / 安全边界

| 主题 | 锁 |
|------|----|
| 二进制 | 同一 SHA256 门（S10） |
| 传输 | 窗口/热键 stdin；`chat.*` 可 WS 但 S21 ACL。UDS 需 peer-cred；loopback HTTP 不得当召唤器旁路 |
| 冒充 | HMAC **挡不住同用户读盘密钥**（ws-auth 已记录残差）。故 overlay **不是**第二个全权 WS 超户（S21）。配对只复用 `show-pairing-window`，overlay 不显示 secret |
| 确认 | S6：overlay **不**发 `security.confirmation.response`。tray stdin `respond()` 保持特权通道。不解绑 `originWs` |
| 拉起 Chrome | S13 UI RPC；无 tool；值守/god-mode 不得调用 opener |
| 数据外泄 | 检索默认标题；thread 正文进模型前 sanitizer + secret redact |
| 值守 | 召唤器不得武装；值守中热键可搜历史，**不可**点 Allow（S22） |
| Voice | 召唤器不做听写；不要灰色麦克风图标 |
| 自点击 | S23 窗坐标硬拒，不是「让出前台继续点」 |

---

## 9. 边界条件目录（对抗狩猎清单）

每条须有：行为、用户可见、禁止的错误行为。

### 9.1 浏览器 / 扩展

1. Chrome 关、用户只问历史/知识 → L0 成功，不弹 attach。  
2. Chrome 关、LLM 要 `navigate` → `BROWSER_UNAVAILABLE` + CTA，不重试死循环。  
3. Chrome 开、扩展未加载 → unpaired 文案 + 打开 `chrome://extensions/` 的 **用户手势** 入口。  
4. 扩展加载但从未配对 → 现有配对窗，不新发明。  
5. MV3 SW 休眠 → 已有 keep-alive；仍失败则 `sw_dead` CTA，不假装 attached。  
6. 多 Profile：v1 不选；OPEN Q3。错误时宁可 `unpaired` 也不写错 Profile。  
7. 用户主浏览是 Arc/Safari：S16，L1 不可用，L0 可用。  
8. Chrome 已开全屏演示/游戏：activate Chrome 会抢焦点 → attach CTA 必须预告「将切换到 Chrome」。  
9. 确认倒计时中用户才 attach：确认不重置；过期就过期（N5/D14）。  
10. attach 成功后自动重放 L1：**禁止**（§5.3.3）。  

### 9.2 输入面竞态

11. Overlay 与 Panel 同时打开同一 thread：一个 composer 可写，另一个 standby 文案。  
12. Overlay 发送时 Panel 正在 stream：沿用现有 supersede/CAS，不双开 loop。  
13. L2 LIVE 时 overlay 输入：排队或禁用，conductor 在 HUD（N6）。  
14. Overlay 关闭时 stream 仍在：S9；再打开 hydrate 到同一 thread。  
15. Tray 确认弹出时 overlay 只显示只读徽章；禁止 overlay 上的 Allow/Deny。  

### 9.3 检索 / 插件

16. 空查询 + 热键 = 聚焦上次 thread composer，不是全库搜索。  
17. 检索命中含 prompt-injection 的页面历史：当 **数据** 引用，沿用 page-sanitizer 家族，不升级为指令。  
18. Pack apply 带 `trust` 块：overlay 不得静默 allowTrust；必须完整后果或 deep-link 到 Panel。  
19. MCP 未连接：检索可显示「未连接」，不在 overlay 里改 mcp config。  
20. 用户想「装一个 Raycast 式插件」：引导 Pack/MCP 文档，不提供任意脚本槽。  

### 9.4 平台 / 热键

21. 热键与 Raycast 冲突：安装时检测（尽力），设置里改。默认 S11。  
22. 中文 IME 组字期间热键/回车：overlay 必须不截半拼音（P0 体验，否则中国用户不可用）。  
23. 无障碍 VoiceOver：v1 最低 = 系统焦点可进输入框 + 确认按钮可 Tab。非 P0 完整对等。  
24. Windows：无 Swift。P0 不做 Win overlay；托盘「打开对话」可先 **打开 Chrome + 请点扩展**（承认家还在浏览器，直到 Win 原生）。诚实降级优于假对等。  
25. Linux：同 Windows。  

### 9.5 产品身份 / 范围

26. 召唤器做成文件搜索：S12 禁止。  
27. 召唤器做成 CU 控制台：禁止，那是 HUD。  
28. GOAL.md 一句话在 **P0 证伪通过前冻结**（最多加「实验：菜单栏召唤」）。证伪通过后的 P2 必须改 GOAL / architecture §0，否则文档分裂。  
29. Outbound MCP 调用方以为召唤器会弹给 IDE 用户看：L8 仍靠 tray/HUD，不假设 overlay 在前台。  
30. 无人值守中热键弹出 overlay：允许（人回来了）；不因此 disarm。  

### 9.6 失败注入

31. Companion 未运行：热键启动 daemon（现有 tray start）或提示「正在启动」；冷启动不得丢第一条消息（队列到 `companion_ready`，封顶 ~5s，超时可见错误）。  
32. `ws_secret` 未配对：召唤器仍可出配对 UI（tray 已有）。  
33. LLM 幻觉 tabId：现有可恢复错误不变；无 peer 时不要先说「没有这个 tab」而要先说「浏览器未连接」。  
34. 截图/粘贴图：v1 overlay **可以** 不做附图（Panel 已有）。若做，走同一多模态路径，不新协议。  

---

## 10. 类型化错误（实现须可测）

| Code | 何时 | 用户文案方向 |
|------|------|----------------|
| `BROWSER_UNAVAILABLE` | P0：无 extension peer | 浏览器未连接。我们不能替你打开侧栏。可激活 Google Chrome，然后点工具栏 CMspark（没有就拼图钉上），再点「已连接，继续对话」。 |
| `BROWSER_UNPAIRED` | P1+ 能区分时 | 扩展未配对 · 复用现有配对窗 |
| `BROWSER_SW_DEAD` | P1+ 滞回落地后 | 扩展可能休眠 · 点工具栏图标 |
| `BROWSER_WRONG` | P1+ | 需要 Google Chrome |
| `CHROME_NOT_INSTALLED` | P1+ | 安装 Chrome |
| `ATTACH_TIMEOUT` | P1+ | 重试 |
| `OVERLAY_STANDBY` | 本面不是 lease holder | 「正在侧栏输入」或「正在召唤器输入」（必须有面名称 + 不可写） |
| `L2_CONDUCTOR_ELSEWHERE` | LIVE | 请在确认台继续 |

P0 实现最小集 = `BROWSER_UNAVAILABLE` + `OVERLAY_STANDBY` + `L2_CONDUCTOR_ELSEWHERE`。错误字符串 **不得** 含子串 `timeout` / `disconnected` / `not found`。`classifyError` 须有 `error_code === "BROWSER_UNAVAILABLE"` 显式 non-recoverable 分支（不能只靠默认）。L1 **不得** 自动 retry attach。

---

## 11. Phasing 与证伪

### P0 — 证伪「关着 Chrome 也能续同一线程」（macOS spike）

实现范围：

- 热键 overlay（首次选择器）；L0 `chat.create` 流式（tray client 不得 5s RPC 死等）；thread hydrate 纯文本上限 20；`thread.list` 搜标题。  
- **S19** + `classifyError` 显式码。**S21** 硬拒（`allowTrust` / `config.set` / `unattended.arm` / `confirmation.response`）必须有单测，不能只写在 brief。  
- **S20** 三字段。IME×CU：非激活面板 + 输入时临时 regular，作为 **明示 P0 spike 任务**（组字中不截半拼音）。  
- 诚实 CTA。无 overlay Allow。无 Pack 安装。无听写。无自动重放。不改 GOAL 一句话（S24）。  
- overlay `chat.create` **可以**让 LLM 走到 companion 侧 L2/MCP；那不是 overlay 能力限制。确认仍在 tray/HUD（S6）。须在 spike 计划写明，以免「L0 捕获面」被误读成工具白名单。

**对象（禁止写「目标用户」）**：8 名已用 Side Panel 的现有用户 + 5 名日常 Raycast/uTools 且使用中文或日文 IME 的用户。预置：已配对、已配 LLM、Chrome **完全退出**。

**任务卡（Chrome 必须保持退出，否则该卡失败）**：

1. 热键打开 overlay，用标题找到指定旧线程，看到截断历史。  
2. 在任务 1 的**同一 thread** 里追问，并引用 hydrate 到的历史内容，看到短回复。  
3. 再问「打开某网站」——必须类型化缺浏览器，不得假装在浏览。

**通过（才允许讨论 ADR-020 文案）**

- 8 人中 ≥6 人 **不启动 Chrome** 完成 1+2。  
- 任务 3 主按钮不得单独写「打开侧栏并继续」。  
- 「继续」出现前 `history.db` 零次自动 L1。  
- IME：组字中回车不发送（5/5）；失败则 overlay **不得对中国用户作为 P0 发货**（战略证伪仍看 1+2，但产品门另计）。  
- 同时开 overlay+Panel：只有一块能打字，另一块有面名称。

**证伪（停，退回身份 1：召唤器=捷径；不滑向 B）**

- ≥50% 在完成 1+2 前自己打开 Chrome 或点 attach。  
- ≥3/8 侧栏用户说「这不像对话 / 找不到记录」。  
- ≥3/5 启动器用户说「还不如继续用启动器」。  
- 任一用户点 CTA 后以为侧栏已开，30s 内放弃。

Windows：看安装器关于页是否写明家仍在侧栏；没写 = 文档失败。

### P1 — attach 协议硬化

- §5 状态机 + 错误码单测。  
- SW dead / unpaired 文案。  
- Overlay **只读确认徽章**（订阅 N5 resolved；无响应路径）。不把 overlay 接入 MinimalConfirm。  
- self-ui 排除召唤器窗。  

### P2 — 叙事切换

- GOAL / ADR-020 一句话修订。  
- HUD empty copy。  
- Pack/Skill 检索。  
- 召唤器入口引导（首次安装：热键提示，而不是只说「打开侧栏」）。  

### P3 — 平台与是否加厚

- Win/Linux overlay 或永久托盘降级文档。  
- 仅当 P0 证伪「薄不够」才讨论 B（原生主窗）。  

---

## 12. Non-goals（刻意边界）

- Raycast/uTools 式通用启动器、插件商店、剪贴板/文件索引。  
- Electron/Tauri 主应用（Approach B）。  
- 以 CMspark 为 Raycast 扩展作为 L1 操作面（Approach C 主路径）。  
- 程序化打开 Chrome Side Panel（Chrome 不给这个 API；不砸 CDP hack）。  
- Headless / Chrome for Testing 当用户会话。  
- 召唤器内 Computer Use、shell、netsec。  
- 召唤器武装 ADR-021。  
- 多浏览器引擎（Firefox/Safari/Arc）L1。  
- 自动重放 attach 前那次 L1 tool_call。  
- 新确认方言、新 runtime、新 WS 家族（可扩展现有 stdin JSON / WS 信封）。  

---

## 13. 与既有锁的关系

| 既有锁 | 本 brief |
|--------|----------|
| ADR-020 三轴 | 遵守；P2 才改默认文案，不是轴 |
| HUD N1 单二进制 | SHA256/二进制 LOCK；进程模型 OPEN |
| HUD N2 一个宽面 | **不改**；召唤器不是宽面，也不是 MinimalConfirm |
| HUD N5 单 writer | overlay **不是** writer；tray stdin 保持特权 `respond()` |
| HUD N6 conductor | L2 LIVE 时 overlay 非 conductor（S22） |
| HUD §1.3 / §6.2 | **不废止**「完整 L0 在 Panel」。放宽的仅是：Chrome 缺席时允许召唤器续聊该线程 |
| ADR-022 L2 主叙事 | P0 不改。证伪通过后：主叙事仍是人机浏览器 Agent；L9 赢家 = **人机会话**（Panel ∪ summoner-origin thread），MCP 排队。L8 确认仍不依赖 overlay 前台 |
| Pack-first | 召唤器是 L0 捕获壳不是场景入口；overlay 常驻控件有上限（S8）。禁止往 overlay 堆一级功能 |

---

## 14. 原 Open questions → v2 已锁

1. **Composer**：overlay 可见 ⇒ overlay 持 lease；关掉 ⇒ Panel。拒后聚焦。LIVE 仍 N6。  
2. **热键**：首次强制选择器；不默认 ⌃⇧Space。  
3. **Profile**：v1 忽略；失败文案提当前 Chrome 用户。  
4. **继续**：显式按钮 = 新 user 消息；服务器禁重放 L1。  
5. **检索**：P0 标题+时间+别名；空态「不搜正文」。  
6. **气泡**：hydrate 截断纯文本（上限 20）+「完整格式在侧栏」。拒装饰 3 气泡。  
7. **Windows**：诚实降级写进安装器。

仍 OPEN（外审可改，不得假装已锁）：S10 单进程 vs IME×CU；`composer.lease` 帧字段；extension id pin（既有残差）。  

---

## 15. Eval gate card（设计阶段）

**Blast tier**: T3  
**MACHINE（本阶段）**: 不适用代码；要求 brief 内每条 law 可在实现时写成单测名或 UX 检查表。  
**ADVERSARY**: v1 四通道全部 REJECT；合成已折回本 v2。  
**EXTERNAL**: Pi + Claude + Kimi 审 **v2 + synthesis**（可驳回折回过松）。  
**MERGE/ADR**: 三路 APPROVE* 才允许 **spike 计划**；ADR-020 一句话仍须 P0 证伪通过。

---

## 16. Suggested adversary hunting（通道拆分，互不引用）

- **ARCHITECTURE**: 是否第二 runtime？与 HUD N1–N10 是否咬合？ADR-020 家迁移是否真正交？Pack-first 是否被钻空子？  
- **CORRECTNESS**: 与 `pickAuthenticatedClientWs` / `openSidePanel` / tray origin / 确认队列 **真实代码** 是否可落地？哪些 WS 方法今日拒绝 tray origin？  
- **SECURITY**: 热键 UI 鉴权、假 overlay、自动 launch、确认双写、Pack trust 从 overlay 抬升、self-ui 点击、历史外泄。  
- **PRODUCT-UX**: 三入口心智、IME、热键战争、Win 诚实降级、薄 overlay 能否承担「家」、P0 证伪是否真能失败。  

---

---

## 17. Adversary fold log（2026-08-22）

四路 VERDICT 均为 REJECT。折回见 [synthesis](../audit/reviews/os-agent-shell-adversary-synthesis-20260822.md)。

| 来源 | BLOCK/MAJOR | v2 |
|------|-------------|-----|
| Arch A1 | 静默改 N1–N10 | 显式：N2/N5/N6 不改；N1 进程 OPEN |
| Arch A2 / Corr B1 | L1 绑错 socket | S19 |
| Arch A3 | 双草稿 | S20；拒后聚焦 |
| Product B1–B3 | 家/CTA/证伪剧场 | S2/S7 文案；§11 可观察门 |
| Product B5 | 抢 HUD | S24 |
| Sec B1 | WS 超户 | S21 stdin+ACL |
| Sec B2 | CU 点 Allow | S6 无 overlay Allow；S22/S23 |
| 多路 | 五态不可测 | §5.1 P0 二元 |
| 多路 | 无 openChrome tool / retry | S13；`BROWSER_*` 非 recoverable |

### 17.1 Triple-review fold（2026-08-22）

| Lane | Path | VERDICT |
|------|------|---------|
| Claude | `docs/audit/reviews/os-agent-shell-v2-claude-20260822-172434.md` | APPROVE_WITH_NITS |
| Pi | `docs/audit/reviews/os-agent-shell-v2-pi-20260822-172436.md` | APPROVE_WITH_NITS |
| Kimi | `docs/audit/reviews/os-agent-shell-v2-kimi-20260822-172436.md` | APPROVE_WITH_NITS |

已折 nits：图中 OS home；MinimalConfirm 残留改只读徽章；GOAL 冻结时点；S21 按连接而非 Origin 一刀切；S20 P0 三字段；`classifyError` 显式码；P0 含 S21 硬拒 + IME×CU 任务；任务 2 改为引用 hydrate 历史。

*v2.1 — 允许写 spike 计划。非正式 ADR。GOAL 一句话未改。Owner 能力锁 = Chrome-optional same-thread L0；拒绝薄 overlay 自称主界面。*
