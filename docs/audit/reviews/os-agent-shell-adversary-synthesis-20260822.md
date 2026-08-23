# OS Agent Shell — 四通道独立对抗合成（2026-08-22）

| Field | Value |
|-------|--------|
| Input | `docs/decisions/os-agent-shell-brief-2026-08-22.md` v1（pre-adversary） |
| Lanes | ARCHITECTURE · CORRECTNESS · SECURITY · PRODUCT-UX（并行、互不可见） |
| 四路 VERDICT | 全部 **REJECT** |
| 本文件角色 | 折回 BLOCK/MAJOR → brief v2；再送 Pi / Claude / Kimi |
| 证据 | `[inspected]` 代码 + 四路报告；无 `[executed]` |

四路原文（会话内完整；本合成不替代原文）：

- Architecture: subagent `01a028be-2f8d-7371-8e0b-834579c6eb42`
- Correctness: `01a028be-2f8e-7cc3-a41f-b52a1935fc68`
- Security: `01a028be-2f8e-7cc3-a41f-b53ddc14fc6e`
- Product-UX: `01a028be-2f8e-7cc3-a41f-b54871eb6572`

---

## 1. 交叉共识（独立出现 ≥3 路 → 视为真）

| ID | 共识 | 路 |
|----|------|-----|
| X1 | **「不改 N1–N10」为假**：S6 overlay MinimalConfirm 改 N2；S10 扩 N1。必须显式 AMEND 或收回。 | A, S, P |
| X2 | **会话 origin ⊥ 执行器 origin 不存在**：`chat.create` 的 `createToolExecutor(ws)` 把 L1 打到**发起 socket**；`pickAuthenticatedClientWs` 只服务 outbound MCP。召唤器聊 → L1 会 15s timeout，不是 `BROWSER_UNAVAILABLE`。 | A, C, S |
| X3 | **薄 overlay 不能叫「家」**：S2 与 S7 互斥。关 Chrome 若只能 3 行装饰，身份 2 在 UX 上失败。 | A, P |
| X4 | **§5.1 五态不可测**：今日只有「有无已鉴权 extension WS」。无 macOS Chrome 进程探针、无 SW 滞回。 | C（主），A 附和 attach 夸大 |
| X5 | **P0 不是「加一扇已有窗」**：无热键、无 composer、无 IME、无 overlay stdin cmd。HUD spike 是 label。 | C, P |
| X6 | **召唤器不得成为全权 WS 超户**：tray origin 鉴权后几乎无方法 ACL。overlay 走 WS 可 `pack.apply`+`user_gesture`、`unattended.arm`、确认 response。 | S（主），C M5 |
| X7 | **Attach CTA「打开 Chrome 并继续」骗人**：`openSidePanel` 只能 activate。 | C, P |
| X8 | **`BROWSER_*` 不是现成家族**；timeout/`disconnected` 被当成 recoverable → 模型重试 ≈ 禁止的自动重放。 | C, S |
| X9 | **P0 证伪指标是剧场**。 | P（主），A S18 |

---

## 2. BLOCK 处置（必须折进 v2，否则不得外审当 APPROVE 候选）

| BLOCK | 来源 | 折回 |
|-------|------|------|
| A1 静默改 N1–N10 | Arch | v2 **废止**「不改 N1–N10」。N2 **不改**（MinimalConfirm 仍 Panel-only）。N1 二进制 LOCK、进程模型 OPEN。HUD §1.3 改为：召唤器是 L0 **捕获面**，不是废止 Panel 完整聊天。 |
| A2 / C-B1 执行器绑错 socket | Arch+Corr | 新锁 **S19**：L1 只经 `pickAuthenticatedClientWs()`；发起 origin 是 tray-class 时 **禁止** `tool.execute` 打回该 socket；缺 peer → 非 recoverable `BROWSER_UNAVAILABLE`。 |
| A3 双 composer 无 SoT | Arch | 新锁 **S20**：Companion `composer.lease`；Q1 锁为 overlay 可见则可写、关掉则 Panel 可写（拒「后聚焦」）。 |
| P-B1/B2/B3 家/CTA/证伪 | Product | S2 AMEND：对外不称 overlay 为「主界面」。能力锁仍是「关 Chrome 能继续同一 thread」。P0 指标改可观察清单。CTA 文案禁止暗示侧栏已打开。 |
| P-B4 冷启动仍在浏览器 | Product | P0 不宣称「家已迁移」。首次安装路径保持扩展+配对；召唤器是配对之后的捕获面。 |
| P-B5 抢 HUD | Product | 排期锁 **S24**：HUD ConfirmElevated/急停仍是 L2 P0。召唤器 P0 = spike，不得改写 GOAL 一句话定位直到证伪通过。 |
| S-BLOCK-1 假 UI 超户 | Sec | **S21**：overlay 控制面 = stdin 白名单（`chat.create` 流式 / `thread.list` / `history.query`）。禁止 overlay/tray origin：`pack.apply`+`allowTrust`、`config.set`、`unattended.arm`、`security.confirmation.response`（非 outbound）。确认只走既有 stdin `respond()`。 |
| S-BLOCK-2 CU 点 Allow | Sec | **S22**：LIVE CU 或 pending L2 时 overlay **不画** Allow。**S23**：self-ui 命中召唤器/HUD/tray 窗口坐标 → **硬拒该次点击**（不是让出前台继续）。 |

Architecture A4（IME×CU 单进程）保持 **S10 OPEN**，P0 spike 用非激活面板 + 输入时临时 regular；未 spike 不得锁单进程。

---

## 3. MAJOR 折回（v2 写入；外审可降 NIT）

- A5：L0 走现有 WS `chat.*`（tray origin + ACL），stdin 只管窗口/热键/HUD。禁止把 token 流绑死 stdin。  
- A6：OS 一级入口 = 1（召唤器）；overlay 常驻控件 ≤ composer + 检索 + 缺浏览器徽章。场景仍 Pack。  
- A7：一句话定位 **macOS-scoped**；禁止用「本机 Agent」冒充 L2。Win 安装器诚实降级（S15）。  
- A8：ADR-022 L9 赢家改 **人机会话**（Panel ∪ summoner-origin thread），MCP 仍排队。L8 确认面仍是 tray/HUD，不假设 overlay 在前台。  
- C-M2：P0 文案承认 Panel 关闭后 SW 可能睡；`attached` 会抖；CTA 含「点工具栏图标/拼图」。  
- C-M7：P0 证伪 **不要**把 IME 当唯一闸（仍是 P0 体验门，失败则 overlay 不可对中国用户发货，但不等于身份 2 战略失败）。  
- S-MAJOR-1：无 `openChrome` tool schema；`BROWSER_*` 禁止进 `classifyError` recoverable。  
- S-MAJOR-3：检索默认 id+标题；纳入 LLM 要第二次手势。  
- S-MAJOR-4：tray/overlay origin 硬拒 `allowTrust`。  
- S-MAJOR-5：配对只复用 `show-pairing-window`。  
- P-M3：UI 禁用「插件」二字。  
- P-M2：首次强制热键选择器；默认不抢 ⌃⇧Space。  

---

## 4. 身份 2 怎么折才不骗用户

Owner 锁的是 **能力**：关浏览器仍能在同一 thread 上说话，需要网页再 attach。

四路共同否定的是 **营销**：把薄 overlay 叫「家 / 主界面 / 取代 Side Panel」。

v2 锁定的产品句：

> **能力**：macOS 上，Chrome 缺席时用户仍能通过召唤器继续当前线程（截断 hydrate + 发送 + 短流式）。  
> **完整工作面**：Chrome 在场时仍是 Side Panel（页感知 L0/L1）。  
> **L2 宽面**：仍是 HUD/Cockpit。  
> **召唤器**：OS 捕获 / 检索 / 缺浏览器续聊。对外文案不使用「主界面」。  
> **GOAL 一句话**：P0 证伪通过前 **不改**；最多加「实验：菜单栏召唤」。

若证伪失败（用户总是立刻开 Chrome，或觉得这不是对话）→ 退回身份 1（召唤器 = 捷径），**不**滑向 Electron 主窗。

---

## 5. Q1–Q7 合成锁

| Q | 锁 |
|---|-----|
| Q1 | overlay 可见 ⇒ overlay 持 `composer.lease`；关掉 ⇒ Panel。拒后聚焦。LIVE 仍 N6。 |
| Q2 | 首次强制热键选择器；预填检测后的空闲组合；不默认 ⌃⇧Space。 |
| Q3 | v1 忽略 Profile；失败文案提「当前 Chrome 用户」。 |
| Q4 | 显式按钮「已连接，继续对话」= 新 user 消息，服务器禁止重放上一 L1 tool。 |
| Q5 | P0：标题+时间+别名；空态写「不搜正文」。 |
| Q6 | P0：输入框 + **hydrate 的截断线程**（纯文本，可滚动上限 N 条，N 建议 20 不是 3）+「完整格式在侧栏」。拒绝装饰性 3 气泡。 |
| Q7 | Win/Linux 诚实降级，安装器写明。 |

---

## 6. 外审应盯的残余

1. S10 进程 vs IME×CU 仍 OPEN — 外审可要求 P0 用 nonactivating 降级 IME 或把 IME 移出 P0 门。  
2. `composer.lease` 协议尚未画帧 — 外审可要求补最小字段再 ADR。  
3. 身份措辞是否仍过满（「本机 Agent」）。  
4. stdin 白名单 vs L0 走 WS：两路都出现过，v2 采取 **混合**（窗口 stdin + chat WS + 方法 ACL）。外审应打这个混合是否又变回超户。  
5. 排期 S24 与 owner「先把边界谈清」不冲突；若外审认为 spike 都不应写进 ADR-020，应尊重。

---

**合成者 VERDICT（实现/设计会话，非正式闸门）**: v1 **REJECT 成立**。v2 折回后才具备送 Pi/Claude/Kimi 的资格。
