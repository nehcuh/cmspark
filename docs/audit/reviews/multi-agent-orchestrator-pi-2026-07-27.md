# Multi-Agent Orchestrator + Tab Lock — Adversarial Design Review (Pi)

**Date**: 2026-07-27  
**Reviewer**: Pi (independent adversarial review, per review brief §"Review charter")  
**Primary artifact**: `docs/decisions/v1.3/multi-agent-orchestrator-synthesis-2026-07-27.md`  
**Code spot-checked**: `browser-bridge.ts`, `security-confirmation.ts`, `thread-manager.ts`, `server.ts` (~4073 lines), `background/index.ts`, ADR-014  
**Language**: 中文为主，关键术语保留英文

---

## 1. Overall Verdict

### **APPROVE_WITH_CHANGES — 72% confidence**

Synthesis 在核心架构选择上方向正确，正确复用了 Thread 模型（而非另起 runtime），正确定位了 Companion 侧强制锁（而非 Extension-only），正确区分了 tab lease 与 host_computer 单任务互斥。但存在 **4 个必须修复的 P0 级漏洞**（其中 2 个可能触发 user hard rule 被静默违反），以及 **3 个需人工拍板的产品决策**；这些漏洞均在现有代码中有精确锚点，不修复就进入 P0 实现将产生 **虚假排他性保证**（false exclusivity guarantee）。

**Confidence 降到 72% 的原因**：
- SOFT_RESERVED 状态机的二义性可能导致两个 worker 先后拿到用户 confirm、后 confirm 的却拿不到锁——用户白点了 approve
- 租约到期时 in-flight CDP 命令无取消机制——锁释放 ≠ 工具停止，违反 user hard rule
- `screenshot` / `analyze_image` 的 active-tab fallback 与 multi-agent "禁止静默默认 tab" 的合成结论相矛盾
- `osascript_eval` 的 "hard-resolve URL→unique tabId" 在代码中没有路径，是设计层面的 handwave

---

## 2. Attack: Tab Lock Model

### 2.1 攻击点 A — SOFT_RESERVED 状态机的二义性致命 TOCTOU（MUST-FIX #1）

**Synthesis 声称**（Locked conclusion #6, TAB_LOCK-4）：
> "Soft reservation ≤ confirm timeout + hard re-acquire immediately before dispatch; deny/timeout/rejectAll drops reservation."
> "Residual: soft-reservation exclusivity vs intent-only is underspecified (implement as non-blocking intent + hard acquire, plus early busy when hard-held to avoid post-L2 TAB_LOCKED after user already confirmed)."

**攻击**：Synthesis 明确承认 "underspecified" 但将其标为 "Residual" 而非 MUST-FIX。实际上这是 **P0 正确性问题**：

假设 worker-A 和 worker-B 同时对 tabId=5 发起 evaluate（均需 L2 confirm）：

1. T0: worker-A 进入 `createToolExecutor` → `SOFT_RESERVED`（非阻塞 intent）→ 发送 `security.confirmation.request`
2. T0+2s: worker-B 进入 `createToolExecutor` → `SOFT_RESERVED`（同一 tab，非阻塞，两个 SOFT 共存）→ 发送第二个 `security.confirmation.request`
3. T0+10s: 用户在 Confirm Center 先 **点了 B 的 approve**（两个对话框同时在屏幕上，用户随机先点了其中一个）
4. worker-B 执行 hard re-acquire → 成功，`HARD_HELD` → dispatch ws `tool.execute`
5. T0+12s: 用户点了 **A 的 approve**
6. worker-A 执行 hard re-acquire → `TAB_LOCKED`，返回 `{success: false, data: {error_code: 'TAB_LOCKED', tab_id: 5, holder_thread_id: worker-B}}`

**结果**：用户刚才亲手批准的 A 的 evaluate 被拒绝。"用户白点了 approve"——这是糟糕的 HITL 体验，在 adversarial 场景下（e.g. 安全审查 vs 正常浏览两个 worker 并行）会直接导致业务流程断裂。

**代码锚点**：`security-confirmation.ts:request()` 无 tab-scope 感知——两个 confirm 互相不知道对方在等同一个 tab；`server.ts createToolExecutor` 的 L2 gate 无 tab lease 概念。

**修复要求**：二选一——
- **方案 1（保守）**：`SOFT_RESERVED` 互斥。第二个 SOFT 到来时直接 `TAB_BUSY_CONFIRMING`（不进入 L2），返回 recoverable error 给调用 worker。L2 confirm storm 本身就已被 SECURITY_L2_AND_CAPABILITY-1 限制，所以不会出现饿死。
- **方案 2（激进、更好 UX）**：SOFT_RESERVED 入队。第二个 SOFT 排队等待。当第一个 confirm resolve（approve→hard-held / deny→free），唤醒队首。用户只看到 ≤1 个 per-tab confirm。

**我的建议**：方案 1 在 P0 实现，方案 2 在 P1。原因：方案 2 的队列语义需要在 `SecurityConfirmationManager` 中加 tab-keyed admission gate，与 SECURITY_L2_AND_CAPABILITY-1 的 run-level FIFO 叠加后有死锁风险（confirm 排队 + run FIFO 排队形成环形等待）。

### 2.2 攻击点 B — 租约到期时 in-flight 工具无取消机制（MUST-FIX #2）

**Synthesis 声称**（TAB_LOCK-3, 锁状态机）：
> "HARD_HELD --idle_ttl|hard_max--> FREE + audit LEASE_EXPIRED"

**攻击**：`HARD_HELD → FREE` 仅释放租约。**已经在 Extension/CDP 层执行的 tool 不会停止**。

具体场景：

1. worker-A 持有 tabId=5 的 HARD_HELD 锁
2. worker-A dispatch `click({tabId: 5, selector: "#delete-account"})` → 租约 renew → ws `tool.execute` → Extension `tool.execute` handler → `browserBridge.execute("click", ...)` → CDP `Input.dispatchMouseEvent`（mouseMoved → mousePressed → mouseReleased）
3. mouseMoved 完成，mousePressed 完成，**在 mouseReleased 之前**，worker-A 的租约 `hard_max` 到期
4. Companion 侧：`HARD_HELD → FREE + audit LEASE_EXPIRED`
5. worker-B 发现 tabId=5 FREE → 成功 HARD_HELD → dispatch `type({tabId: 5, selector: "#search", value: "sensitive"})`
6. Extension 侧：worker-A 的 mouseReleased 还在执行，worker-B 的 `insertText` 开始执行
7. **两个 agent 同时操作同一个 tab。User hard rule 被违反。**

**代码锚点**：
- `chrome-extension/src/background/index.ts:315-342` — `tool.execute` handler 无锁检查，盲 `browserBridge.execute`
- `chrome-extension/src/background/browser-bridge.ts` — `click()` / `typeText()` / `fillForm()` 等是多步 CDP 命令序列，中间无 AbortSignal 检查
- `companion/src/server.ts:1540-1574` — `pendingToolCalls.set(toolCallId, {resolve, reject, timer})` 后用 ws send `tool.execute`，无 "pipeline drain" 机制
- **不存在** Extension 侧的 `tool.abort` 消息类型

**修复要求**：
- Companion 侧 lease auto-release **前**，必须先 reject 该 worker 在该 tabId 上的所有 pendingToolCalls 并 **等待 Extension 侧的 drain signal**（或至少发 `tool.abort` + 短超时后 force-free）。
- 或者，更简单的 P0 方案：租约到期不会释放有 active pendingToolCalls 的锁——`hard_max` 到期时如果该 worker 在该 tab 上有 pending，拒绝 release，记录 audit，转 `FORCE_RELEASING` 等待 Dashboard 人工介入。这与 user hard rule "no other agent may operate that tab **until the tab operation lock is released**" 一致——如果 worker 还没做完，锁不应该在不终止工具的前提下被释放。

### 2.3 攻击点 C — screenshot / analyze_image 的 active-tab fallback 绕锁（MUST-FIX #3）

**Synthesis 声称**（Locked conclusion #5, #6）：
> "P0: all tab-targeted tools including pure reads (screenshot/get_page_*/evaluate/osascript_eval after hard url→unique tabId resolve) require the lease"
> "Ban silent active-tab default under multi-agent (require explicit tabId)"

**攻击**：当前代码：

```typescript
// browser-bridge.ts screenshot():
let tabId = params.tabId
if (!tabId) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!activeTab?.id) throw new Error("No active tab found")
  tabId = activeTab.id
}
```

```typescript
// browser-bridge.ts analyzeImage():
let tabId = params.tabId
// ...
if (!tabId) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!activeTab?.id) throw new Error("No active tab found")
  tabId = activeTab.id
}
```

在 multi-agent 场景，如果 LLM 不传 `tabId`（pinned_tabs 为空时 adapter.ts:656 `tabId: params.tabId ?? pinned_tabs[0]` 两路都 null），**`screenshot` 和 `analyze_image` 会静默 fallback 到当前 active tab**。

这有两层问题：
1. **锁绕行**：如果 worker-A 持有 tabId=5 的锁，但当前 active tab=5，worker-B 调用 `screenshot`（不传 tabId）→ active-tab fallback → tabId=5 → 但 Companion createToolExecutor 做锁检查时用的是 **resolved tabId**。如果 resolve 发生在 Companion 侧且 fallback 在 Extension 侧，则 Companion 侧可能不知道 tabId=5——锁检查落空。
2. **静默操作**：即使 Companion 侧正确 resolve active→tabId=5，如果 synthesis 的 "ban silent active-tab default" 没实现，LLM 可以不传 tabId 就拿到任意 active tab 的截图——information leak。

**修复要求**：
- P0: 在 `createToolExecutor` 中，multi-agent 模式下对所有 tab-targeted 工具 **强制要求 explicit tabId**。`finalParams.tabId === undefined` → 直接返回 `{success: false, error: "tabId is required in multi-agent mode"}`。
- 或者在 `browser-bridge.ts` 的 `getTabId()` 中去掉 fallback，要求 Companion 侧始终注入 explicit tabId。

### 2.4 攻击点 D — osascript_eval 的 "hard-resolve URL→unique tabId" 是设计 handwave

**Synthesis 声称**（Locked conclusion #5, TAB_LOCK-2 counter）：
> "osascript_eval: require unique tabUrlCache/list_tabs match to one tabId or fail TAB_AMBIGUOUS; never substring-only for lock"

**攻击**：当前 `osascript_eval` 是 Companion 侧工具，通过 AppleScript URL substring 匹配 target Chrome 窗口——**根本没有 tabId 概念**。Synthesis 要求 "hard-resolve URL→unique tabId" 但：

- `tabUrlCache` 是 tabId→URL 的 Map，反向查（URL→tabId）需要全量扫描
- 一个 URL 可能对应多个 tab（用户开了两个 GitHub tab）
- `osascript_eval` 的 AppleScript 可以操作任意匹配 URL substring 的窗口——无法绑定单个 tabId

**结论**：osascript_eval **本质上无法**做 per-tab 互斥锁。Synthesis 的 "hard-resolve" 要求需要承认 osascript_eval 的 tab-lock model 是 **best-effort** 而非 authoritative。两个选择：
- 1) 接受 osascript_eval 在 multi-agent 模式下 **禁止**（fallback to evaluate with explicit tabId）
- 2) osascript_eval 持有 **window-level 互斥锁**（不是 tabId 级别）——但当前代码没有 window 概念

这是一个需要人拍板的产品决策（见 §7 开放问题 #3）。

### 2.5 Tab lock model 其余检查

| Check | 状态 | 备注 |
|-------|------|------|
| 锁粒度 tabId（非 window/profile/CDP） | ✅ 正确 | 与现有 mutate 工具的 tabId 参数一致 |
| holder = worker thread_id | ✅ 正确 | 与 HITL enter-worker 的 thread 切換一致 |
| 多 tab 租约 per-worker（有界） | ✅ 正确 | Worker 可能需要多 tab 协同（login 页 + target 页） |
| pinned_tabs 仅 affinity | ✅ 正确 | 不改变现有语义 |
| Extension-only 锁被拒 | ✅ 正确 | 符合 dual-layer A1 |
| 不放锁横跨整段 L2 45s 等待 | ✅ 正确 | 否则 deadlock 多 worker |
| close_tab→release / navigate→retain | ✅ 正确 | 与 Chrome tabId 生命周期一致 |
| host_computer 正交 | ✅ 正确 | 不同中断面和取消 UX |
| 不放锁给 Dashboard 做控制面 | ✅ 正确 | Dashboard observe-only |

---

## 3. Attack: Orchestrator/Worker Model

### 3.1 攻击点 E — isToolAllowed 零调用点 = 全部 worker 降级等于演戏（MUST-FIX #4）

**Synthesis 正确识别**（ORCHESTRATOR_WORKER_MODEL-4, locked conclusion #4）：

> "isToolAllowed is defined but never invoked on the execute path—so a hallucinated click/navigate/evaluate/shell_exec would still run under L2 only."
> "Wire isToolAllowed at createToolExecutor entry BEFORE L2/module gates/tool.execute"

**攻击**：这不是理论问题。Synthesis 中 locked conclusion #4 已经将 isToolAllowed 列为 MUST，但代码事实是：

```typescript
// thread-manager.ts:499-503 — 唯一定义，零调用点
isToolAllowed(threadId: string, toolName: string): boolean {
  const thread = this.get(threadId)
  if (!thread) return false
  if (thread.tool_whitelist === null) return true  // ← null = allow-all
  return thread.tool_whitelist.includes(toolName)
}
```

```
$ rg "isToolAllowed" companion/src/ --no-filename
thread-manager.ts:  isToolAllowed(threadId: string, toolName: string): boolean {
# 零调用点。adapter.ts Line 438 是 getToolDefinitions() 无 filter。
```

**后果**：
1. applyPack 正确写 `tool_whitelist`，但 `createToolExecutor` 永远不读——worker 实际拥有全部工具
2. WORKER_HARD_DENY 列表为 `{shell_exec, netsec_port_scan, osascript_eval, host_computer, host_write, host_read, host_app, evaluate}`——全部这些工具只在 L2 gate 检查，但 `tool_whitelist` 不阻止它们进入 LLM schema
3. 即使用了 pack downgrade，worker 的 LLM 仍能看到所有工具（adapter.ts:438 全量注入 schema），只是执行时可能被拒——浪费 tokens + LLM 可能 hallucinate 调被拒工具

**修复要求**（P0 不可降级）：
- `createToolExecutor` 入口第一行：解析 `finalParams.__thread_id` → 调 `threadManager.isToolAllowed(threadId, toolName)` → 不通过即返回 `{success: false}`
- `adapter.ts` schema 构建时按 thread 过滤工具列表（defense-in-depth，非强制执行点）
- WORKER_HARD_DENY 在 worker spawn 时直接写入 `tool_whitelist`（而非只做运行时检查）

### 3.2 攻击点 F — worker spawn confirm 的时间窗

**Synthesis 声称**（ORCHESTRATOR_WORKER_MODEL-3）：
> "Spawn is user-approved (single or batch confirm) before any child chat.create"

**攻击**：用户 batch confirm 5 个 worker → 5 个 `chat.create` 几乎同时触发 → abortControllers 全部注册 → 5 个 LLM loop 同时启动 → 5 个 worker 同时开始 dispatch tool → L2 confirm storm。

即使 SECURITY_L2_AND_CAPABILITY-1 限制 ≤1 active L2 per run，L1（非 L2 工具如 click/type/screenshot）仍可并行。如果 5 个 worker 各 dispatch 一个 `click` 到 5 个不同 tab，这是允许的——但 5 个 LLM loop 同时运行意味着 5 路 token 消耗。

**这不是正确性漏洞**（concurrency caps 会兜底），但 synthesis 的 "batch confirm" 措辞暗示用户一次 approve 多个 worker，实现时必须明确 batch confirm 的 go-live 策略——逐个启动还是批次并发？建议与 ORCHESTRATOR_WORKER_MODEL-5 的 concurrency caps 一起显式化。

### 3.3 攻击点 G — parent collect 工具的 "不可重入子 tool loop" 缺乏执行护栏

**Synthesis 声称**（ORCHESTRATOR_WORKER_MODEL-5）：
> "parent collect tools only read completed handbacks — they do not re-enter child tool loops or steal pendingToolCalls"

**攻击**：`pendingToolCalls` 是全局 Map keyed by `tool_call_id`——无 thread_id。如果 parent 在 collect 时拿到了子 worker 的 `tool_call_id`（通过 handback 中的 artifact ref），parent 可以**注入一个伪造的 `tool.result`** 到该 tool_call_id。

虽然 WebSocket 连接独立（parent 和 child 用不同 thread_id，可能同一 WS），但 `handleToolResult` 不校验 thread_id：

```typescript
// server.ts handleToolResult — 全局匹配 tool_call_id only
pendingToolCalls.get(msg.tool_call_id) // 无 thread_id 绑定
```

**修复**：`pendingToolCalls` 加 thread_id 字段，`handleToolResult` 校验 `msg.__thread_id === entry.thread_id`。

---

## 4. Attack: Dashboard / HITL

### 4.1 攻击点 H — HITL enter-worker 的消息注入语义未定义

**Synthesis 声称**（DASHBOARD_AND_HITL-3）：
> "HITL enter-worker switches the dashboard (and optionally Panel) activeThreadId to that worker thread for transcript/follow-up only"

**攻击**："transcript/follow-up only" 的含义未展开。

如果 HITL enter 后用户在 Panel 输入框打字——这条消息：
1. 是否发到 worker 的 Thread？→ 如果 worker 的 LLM loop 还在跑，这意味着**用户注入 prompt 到运行中的 agent**——是好是坏？
2. 还是只发到 orchestrator 的 Thread？→ 用户看的是 worker 的 transcript，但消息去了 parent——UX 错位

Synthesis 的 "follow-up" 暗示只读。但 Panel 只有一个输入框。实现时要么：
- HITL enter 后 readonly（仅展示 transcript，不暴露输入框）
- 明确允许用户向 worker 注入（这是个产品决策）

### 4.2 攻击点 I — Confirm Center 的单队列串行化饥饿

**Synthesis 声称**（SECURITY_L2_AND_CAPABILITY-1）：
> "≤1 active force-confirm dialog per orchestrator_run + small process-wide cap (e.g. ≤2)"

**攻击**：如果 worker-A 的 evaluate（L2）正在等待用户 45s 倒计时，worker-B 的 host_computer task（也是 L2）在 FIFO 中排队——但 host_computer 本身已有 COMPUTER_TASK_BUSY 拒绝，这个排队是多余的。更糟的是：

- worker-A 的 evaluate 被用户忽略直到 45s 超时
- 45s 后 worker-B 的 host_computer 才开始展示 L2 对话框
- 但 45s 内 worker-A 可能又发了 2 个 evaluate —— 排队更长了

45s × 3 = 135s 的串行 L2 链。如果 per-run cap 是 1，整个 orchestrator run 被一个被忽略的 evaluate 对话框卡住 45s。

**这不是 P0 正确性漏洞**（user hard rule 关于 tab lock，非 confirm speed），但需要人工决定 "L2 confirm storm 串行化" 的 acceptable latency。建议 per-run cap=1 但 global cap=2（允许不同 run 并行 confirm），加上 15s 未响应自动降级为 timeout（非 45s）。

### 4.3 Dashboard 其余检查

| Check | 状态 | 备注 |
|-------|------|------|
| FleetStrip 320px / Cockpit full-page | ✅ 正确 | 匹配 existing D10' UI redesign |
| Confirm Center 共享 | ✅ 正确 | 防止 N-worker confirm storm |
| respondFrom originWs 保留 | ✅ 正确 | C-SEC-2 不削弱 |
| Force-release 需 explicit action | ✅ 正确 | 不静默 steal 锁 |
| Stop-all vs per-worker cancel | ✅ 正确 | 区分 panic 和 precision |

---

## 5. Ordered MUST-FIX Before Any P0 Code

| # | 问题 | 严重度 | 违反哪条规则 |
|----|------|--------|-------------|
| **M1** | **SOFT_RESERVED 非互斥 → 用户白 approve（见 §2.1）** | 致命 | Locked conclusion #6, H3 user hard rule |
| **M2** | **lease 到期不 cancel in-flight CDP → 两个 agent 同时操作同一 tab（见 §2.2）** | 致命 | User hard rule "while a sub-agent operates a tab, no other agent may operate that tab" |
| **M3** | **screenshot/analyze_image active-tab fallback 绕锁（见 §2.3）** | 致命 | Locked conclusion #5, #6, P0 pure-read exclusivity |
| **M4** | **isToolAllowed 零调用点 → worker downgrade 是演戏（见 §3.1）** | 致命 | Locked conclusion #4, H6, WORKER_HARD_DENY |
| **M5** | `pendingToolCalls` 缺 thread_id 绑定 → parent collect 可注入 child result（见 §3.3） | 高 | ORCHESTRATOR_WORKER_MODEL-5 |
| **M6** | `handleToolResult` 不校验 originWs / __thread_id → 跨连接 result injection | 高 | Grounding hotspot "tool.result trust" |
| **M7** | Concurrency caps 的默认数值未定义 → spawn batch 可能 5 个同时启动 → L2 storm 45s×N | 中 | ORCHESTRATOR_WORKER_MODEL-3, SECURITY_L2_AND_CAPABILITY-1 |
| **M8** | osascript_eval 的 unique tabId resolve 路径不存在 → 需要在实现前明确策略 | 中 | Locked conclusion #5 |

**M1–M4 必须在任何 P0 代码落笔之前解决。M5–M8 在 P0 实现期间解决。**

---

## 6. What Synthesis Got Right

以下决策体现了对现有代码拓扑的精确理解和正确的 adversarial 判断：

1. **Worker = first-class Thread（ORCHESTRATOR_WORKER_MODEL-1）** — 最重要的架构决策。正确拒绝了「新 runtime/子进程 swarm」的诱惑，复用 abortControllers、history、pack.apply、pinned_tabs、tool_whitelist 的现有隔离。证据：`thread-manager.ts` Thread 接口 + `message-router.ts` abortControllers + `pack-engine.ts` apply→Thread patch 形成了成熟的 Thread 生命周期，无需发明第二套。

2. **Tab lock = Companion-side multi-tool episode lease（TAB_LOCK-3, TAB_LOCK-4）** — 正确识别了 per-RTT lock 的 interleave 窗口，并与 `host_computer` 的 `COMPUTER_TASK_BUSY` 模式对齐（early refuse → authoritative check-and-set）。正确拒绝了 Extension-only 锁（`background/index.ts:315-342` 的盲 dispatch 天然不支持锁检查）。

3. **SOFT_RESERVED 不横跨 L2 45s（TAB_LOCK-4）** — 正确识别了长时间 HARD_HELD 横跨 confirm 的 deadlock 风险，并明确要求 "soft reservation ≤ confirm timeout, then hard re-acquire immediately before dispatch"。"No silent agent steal" 的设计原则也正确。

4. **host_computer 与 tab lock 正交（TAB_LOCK-5）** — 正确的边界划分。host_computer 是全局单任务（global single-task），锁定的是整个计算机；tab lock 是 per-tab 互斥。二者有不同的中断面、取消 UX 和安全合同。强行合并会产生 false busy 和错误取消行为。

5. **L2 confirm storm bound（SECURITY_L2_AND_CAPABILITY-1）** — 正确识别了 `SecurityConfirmationManager.pending` 是无界 Map，以及 multi-worker 会放大 L2 fan-out。≤1 active per run + FIFO + worker/run identity 标记是正确且可实现的方案。

6. **isToolAllowed 的识别（ORCHESTRATOR_WORKER_MODEL-2/4）** — 正确发现 `isToolAllowed` 零调用点这一关键差距，并正确要求 "wire at createToolExecutor entry BEFORE L2/module gates/tool.execute"。这是 `tool_whitelist` 从 honor-system 变成强制执行的唯一切入点。

7. **SECURITY_L2_AND_CAPABILITY-2 的正确杀死（killed as unsound）** — 正确识别了那个提案的 "intersect with orchestrator_default_deny" 公式在语义上与现有 `computeWhitelist` (allow\deny) 不兼容，以及 null parent whitelist（today = all tools）的未指定行为。Killed proposal 的 counter 采用了更正确的公式。

8. **Audit 的 Companion-stamped 设计（locked conclusion #12）** — 正确要求 audit 从 trusted run context 生成（非 tool/LLM args），actor_role 三元组（user|orchestrator|worker），以及 `capability-audit.jsonl` 作为 SoT（append-only 0o600）。Workers/WS 不可写入 audit 是正确的安全分界。

9. **Killed proposals 的整体质量** — 所有 4 个被 kill 的提案都有正确的 kill reason。特别是 TAB_LOCK-1（"gate-only after normalize / before ws send" 漏 osascript_eval 和无 L2 处理）和 TAB_LOCK-2（"derive from getTabId callers" 漏 screenshot/analyze_image）的 kill 论证准确且与代码锚点一致。

10. **18→14 的漏斗纪律** — Synthesis 展现了正确的 adversarial 纪律：不当妥协、基于证据 kill、对 survivor 仍保留 residual risk 标注。这种工作流质量值得肯定。

---

## 7. Open Product Calls for Human

以下问题不能由工程或安全分析独立决定，需产品/用户拍板：

### 7.1 P0 pure-read 排他 vs P1 shared-observer（Synthesis open question #2）

当前 synthesis P0 要求 "all tab-targeted tools including pure reads require the exclusive lease"。这意味着 worker-A 在 `screenshot` 时，worker-B 连 `get_page_text` 都不能执行。

**Trade-off**：
- 排他纯读 = 正确性最简单、无 TOCTOU 读取陈旧状态
- shared-observer = 更实用（一个 worker 在 click，另一个可以看别的 tab），但需要额外区分 "observer lease" 与 "mutate lease"

**我的建议**：P0 排他全锁，P2 加 observer mode。原因：P0 先把正确性咬死；observer mode 可以通过 "read-only lease (shared, count-based)" 与 "mutate lease (exclusive)" 在 P2 安全叠加。

### 7.2 osascript_eval 在 multi-agent 中的命运（见 §2.4）

三个选择：
- A) 禁止 osascript_eval 在 worker 中使用（只允许 orchestrator 经 elevation 使用）
- B) 将 osascript_eval 视为 window-level 互斥，而非 tab-level
- C) 要求 osascript_eval 使用 explicit tabId（需改 AppleScript 实现）

**我的建议**：P0 选 A（最安全、实现成本最低）；P2 评估 B 或 C 的可行性。osascript_eval 本质是 macOS 特有的、window/substring 级别的工具——强行塞进 tabId 互斥模型会引入更多边界情况。

### 7.3 默认数值 caps（Synthesis open question #1）

合成中未指定：
- `max_concurrent_workers_per_orchestrator_run`：建议 3-5
- `process_wide_max_llm_loops`：建议 8-12
- `per_worker_max_simultaneous_tab_leases`：建议 3
- `idle_ttl`：建议 30s
- `hard_max_lease`：建议 120s

这些数值需要产品决定（成本 / 用户体验 / 安全 trade-off）。

### 7.4 HITL enter-worker 是 read-only 还是可注入？（见 §4.1）

两个选择：
- A) HITL enter 后 transcript 只读，不暴露输入框
- B) 允许用户向 worker 注入 prompt（"follow-up" 模式）

**我的建议**：P0 选 A（安全简单）；P2 加 B 作为 "HITL takeover" 模式（显式 transfer lock + 切换为用户驾驶）。

### 7.5 host_computer 在 tab lease 存在时的行为（Synthesis open question #4）

host_computer 可以通过坐标点击 Chrome 窗口来修改页面内容——绕过 tabId 锁。

**我的建议**：P0 不耦合二者。如果产品认为这是风险，加一条规则："Dashboard 显式 warning + user confirm 当 host_computer task 与 active tab lease 共存时"。这是两个正交的安全面（tab lock 管 browser CDP，host_computer 管 OS-level 注入），强行耦合会导致 host_computer 在 browser-heavy 场景无法使用。

---

## Appendix: Review Coverage Map

| Artifact | Coverage |
|----------|----------|
| `docs/decisions/v1.3/multi-agent-orchestrator-brief-2026-07-27.md` | 全文覆盖 |
| `docs/decisions/v1.3/multi-agent-orchestrator-synthesis-2026-07-27.md` | 全部 14 survivors + 4 killed + 12 locked conclusions + 6 open questions |
| `docs/decisions/v1.3/multi-agent-orchestrator-review-brief-2026-07-27.md` | 全文覆盖 |
| `chrome-extension/src/background/browser-bridge.ts` | 全部 ~700 行，重点 `getTabId()`, `screenshot()`, `analyzeImage()`, `click()`, `execute()` switch |
| `companion/src/security-confirmation.ts` | 全部 ~250 行，重点 `request()`, `respondFrom()`, `respond()`, `rejectAll()`, `pending` Map |
| `companion/src/threads/thread-manager.ts` | 全部 ~522 行，重点 `Thread` interface, `isToolAllowed()`, `pinned_tabs` |
| `companion/src/server.ts` | 部分 ~4073 行，重点 `createToolExecutor` (369-1574), L2 gate (482+), `pendingToolCalls`, `computerTaskAbort`, `chat.abort`→`flipAllComputerTaskAborts` |
| `chrome-extension/src/background/index.ts` | 重点 `tool.execute` handler (315-342), 无锁检查 |
| `docs/adr/014-mission-pack-enterprise-modules.md` | 全部 |
