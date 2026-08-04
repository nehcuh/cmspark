# 运行态可见 + 子任务下钻 · 交互方案

> **日期**: 2026-08-04  
> **状态**: **Implementing on `feat/run-state-worker-drilldown`** — 四路对抗 + Pi/Claude dual-review **APPROVE_WITH_NITS**；impl plan `2026-08-04-run-state-worker-drilldown-impl.md`  

> **对抗合成**: [run-state-worker-drilldown-adversary-synthesis-20260804.md](../../audit/reviews/run-state-worker-drilldown-adversary-synthesis-20260804.md)  
> **双路复审**: [claude](../../audit/reviews/run-state-worker-drilldown-claude-20260804-174619.md) · [pi](../../audit/reviews/run-state-worker-drilldown-pi-20260804-174619.md) · [verdict JSON](../../audit/reviews/run-state-worker-drilldown-verdict-20260804-174619.json)  

> **触发**: 复杂任务时 UI 像会话已结束，用户可打字，随后 agent 又突然继续；多 worker 时还需**下钻查看子任务进展**  
> **相关**: [#au4dch ST](2026-08-01-au4dch-product-plans.md) · [UIUX v2](2026-07-31-sidepanel-uiux-redesign.md) · [Multi-Agent 指南](../../multi-agent-user-guide.md) · ADR-015 / ADR-016 / ADR-020  
> **能力坐标**:
>
> ```text
> Surface: n/a (no new L2 tools)
> L2-classes: (none)
> Compose: none
> Autonomy: multi-worker | single-thread run-state
> Trust: no elevation; spawn HITL + WORKER_HARD_DENY unchanged
> Channel: n/a
> ```

---

## 0. 问题陈述（产品语言）

| 用户感受 | 系统实际 |
|----------|----------|
| 「对话好像结束了」 | 本轮 tool / 思考 / 舰队仍在跑，只是**没在吐字** |
| 「我可以正常打字发送」 | Composer 只把 `streamingContent` 当忙（**Composer** 假空闲；ChatView 已有 processingLabel） |
| 「突然又有回复」 | 后台 turn 从未结束；响应继续写入线程 |
| 「多个子任务时我想看进展」 | Fleet 有 enterWorker，但 **Panel 仅挂载 `FleetStrip focusBand`**，展开「切入」**当前不可达**；FocusBand 点舰队 → Cockpit |

**目标一句话**：用户随时知道 **「谁在忙、我在看谁、我能不能插话、怎么进子任务」**，且下钻不会破坏对「整场任务是否结束」的判断。

**代码锚点 `[inspected]`**：

- `App.tsx`：`canSend = !streamingContent && …`；Stop 仅 `isStreaming`
- `agentStore`：`SET_ACTIVE_THREAD` 清零 `isProcessing` / `streamingContent` / messages
- `useWebSocket`：`tool.start` **无 `thread_id`**，落到 `activeThreadRef`
- `fleet.ts`：worker status 仅 `idle|paused|holding_tabs`；**idle ≠ 已完成**
- `classifyFleetActivity`：`workerCount>0` 且非 paused_only → active（含残留 idle worker）

---

## 1. 现状能力与缺口

### 1.1 已有（可复用）

| 能力 | 位置 | 说明 |
|------|------|------|
| 单线程 tool 运行态 | `ChatView` processingLabel + `collectRunningTools` | ST-1/ST-3 |
| FocusBand 工具条 | `FocusBand` thread_tools | ST-4 已有 slot |
| 舰队汇总 | FocusBand → `FleetStrip focusBand` | 计数 / 全停 / 确认台链 |
| enterWorker 逻辑 | `FleetStrip.enterWorker` | 存在但 **standalone expand 未挂载到 Panel** |
| Worker 控制 | pause / resume / abort | 展开面板内 |
| Mission Board | `BoardPanel` | Fact/Intent/Hint |
| L2 任务门控 | Composer `taskActive` | CU 时禁 Panel 插话 |

### 1.2 关键缺口

| ID | 缺口 | 影响 |
|----|------|------|
| **G1** | Composer 只认 `streamingContent` | 假空闲可发 |
| **G2** | 忙态单 active 字段；切线程清零 | 下钻后假空闲 |
| **G3** | stream/tool 多仅 active；tool.* 无 thread_id | 后台进度 / 串台 |
| **G4** | 舰队入口 → Cockpit；列表不可达 | 无法下钻 |
| **G5** | 无编排面包屑 | 不知在主/子线程 |
| **G6** | orchestrator `chat.done` ≠ 任务结束 | 主线程假全结束 |
| **G7** | ThreadList 无父子树 | 盲找（W3） |

---

## 2. 信息架构

### 2.1 工程谓词（纯函数 · 可单测）

```ts
// ThreadBusy — 当前查看线程是否仍在跑 LLM/tool
deriveThreadBusy({
  streaming: boolean
  isProcessing: boolean
  runningToolCount: number  // collectRunningTools(active messages)
}): boolean
// = streaming || isProcessing || runningToolCount > 0
// Wave2+: || threadBusyById[activeThreadId]

// RunBusy — 整场任务是否仍「活着」（诚实定义，禁止 worker_count>0 单独成立）
deriveRunBusy({
  lockCount: number
  openIntents: number
  anyHoldingTabs: boolean
  llmActiveThreadIds: string[]       // **W0 建议必做**：companion `abortControllers` keys 经 fleet 或轻量 RPC 暴露
  workerBusyIds?: string[]           // Wave2 threadBusyById ∩ workers of interest
}): boolean
// = lockCount>0 || openIntents>0 || anyHoldingTabs
//   || (llmActiveThreadIds.length>0)
//   || (workerBusyIds?.length>0)
//
// 明确排除：
// - paused_only（无锁无 intent）
// - 仅存在、无锁、无 LLM 的 idle 残留 worker
//
// P0 作用域：默认 process-wide fleet 快照（诚实写清 multi-run 可能串 banner）。
// **当 active 线程已知 orchestrator_run_id 时，§6 横幅与 RunBusy 芯片优先按该 run 过滤**
// locks/workers/intents（dual-review nit：降低多 run 假阳性）。
// 开放 intent 单独为 true 时：文案用「任务板仍有未关闭意图」，不用「子任务仍在执行（N）」
```

**禁止**把 `classifyFleetActivity === "active"` 原样当 RunBusy 驱动 §6 横幅（会把 idle 残留 worker 当成「仍在执行」）。

**残差（Pi nit，可接受）**：若 W0 暂未暴露 `llm_active`，后台纯 LLM、无锁、用户不在该线程时，列表可能仍偏「就绪」——**当前查看线程**仍由 ThreadBusy 覆盖原痛点；W0 实现应优先补 `llm_active`，关闭该窗口。

### 2.2 用户可见状态（仅两态 + 就绪 · 工程名不进 UI）

| 用户可见 | 谓词 | Composer |
|----------|------|----------|
| **本对话处理中** | ThreadBusy | 停止本轮；禁发；占位引导 |
| **子任务还在跑** | !ThreadBusy && RunBusy | **允许发送**；常驻非滚动依赖的芯片/条 |
| **就绪** | 皆否 | 常态 |

### 2.3 观察 vs 指挥

| 意图 | 允许 | 说明 |
|------|------|------|
| **观察** | 任意时刻切换线程、读历史/tool 卡、看 Board/锁 | 默认下钻意图 |
| **指挥** | 对**当前线程** follow-up / 停止本轮 / 全停 | 受 ThreadBusy 门控 |

**非 trust 边界**：观察/指挥是 UX 分轨，**不是**单独权限模式。安全靠 Confirm 戳记 + 文案（§5.5 floors）。

Follow-up **不**转移 tab lease；不自动 force-release（ADR-015 Q5）。

---

## 3. 端到端场景

### A — 单线程复杂任务

```text
发送 → Composer：停止本轮 +「本对话处理中 · 停止后再指挥」
→ 消息流 / FocusBand tools：执行中…
→ chat.done 且无 running tool → 就绪
```

### B — 编排 + 多 worker

```text
spawn 批准 → RunBusy 常驻芯片（不依赖 FocusBand primary=fleet）
→ 「进入子任务」列表（portal popover）≤2 次点击（当 RunBusy 芯片可见）
→ WorkerScopeBar 单行：← 返回编排 · 角色 · 状态
→ 消息 = 该 worker 历史（完成的 tool）；in-flight 依赖切后 live 事件 / busy 图
→ Composer：ThreadBusy → 停止该子任务语义；!busy → 「发送给子任务 · {role}」
→ 编排 chat.done 且 RunBusy → 「编排本轮已结束 · 子任务还在跑」+ 打开列表
```

### C — 观察子任务时其它事件

- 不强制打断当前视图  
- 角标仅在 **非 Confirm primary** 时轻量提示  
- Confirm 仍 P0 主槽  

---

## 4. Composer

### 4.1 门控（Q1 锁定：硬门控）

| 条件 | 发送 | 停止本轮 | Placeholder |
|------|------|----------|-------------|
| ThreadBusy | 禁用 | **显示**（abort active thread） | `本对话处理中 · 停止后再指挥` |
| !ThreadBusy && RunBusy | 允许 | 隐藏 | `子任务还在跑 · 可继续指挥当前线程` + 锁数提示（见 F-S5） |
| 就绪 | 允许 | 隐藏 | 常态 |
| L2 taskActive | 禁用 | — | 既有：请到确认台（优先级最高） |

**中途纠偏（steer）契约**：

1. ThreadBusy 时 Stop **始终**可见（不限 streaming）  
2. 禁发时避免「能打字却死发送」：要么禁用 textarea，要么允许草稿但明确 **不会自动发出**（W0 **不做**跟进队列）  
3. 合法纠偏路径写清：**停止本轮 → 再发送**；或等本轮结束  

`RunBusy` **不**单独禁发（编排 wait/handback 间隙仍需指挥）。

### 4.2 停止语义

| 控件 | 作用域 | 文案 |
|------|--------|------|
| Composer 停止 | 仅 active thread LLM abort | **停止本轮**（worker 上可副标题「该子任务」） |
| Fleet 全停 | 全 run workers + lease | **全停**（确认文案含：中止全部子任务并释放 tab 锁） |
| Confirm 拒绝并停止 | **请求戳记** worker/thread | 既有；见 §5.5 F-S1 |

Composer 停止 **≠** L2 急停（急停仍只在 FocusBand / Safety）。

---

## 5. 子任务下钻

### 5.0 现状诚实声明

Panel 仅 `FleetStrip focusBand`：主点击 → `cockpit.open`；**展开列表与「切入」当前对用户不可达**。W1 是 **新建导航**，不是改个文案。

### 5.1 入口

1. **RunBusy 常驻芯片**（StatusRail 旁 / Composer 上沿 / 假结束条 — **F-UX1**）：一点开 worker 列表。  
   - 不依赖 FocusBand primary === fleet（Confirm/L2 时仍可达）。  
2. **FocusBand 舰队主槽**（primary=fleet 时）：主区 → **portal popover** worker 列表（Q2）；「确认台」文字链保留。  
3. **列表行**：「**进入子任务**」+ 暂停/恢复/取消（控制与进入分区）。  
4. Board Intent / ThreadList 树 → **W3**。

**点击 SLA**：

- RunBusy 芯片可见时：**≤2 次**进入指定 worker  
- Confirm/L2 占 primary 时：经常驻芯片 **≤2**；无芯片则失败（故芯片为 floor）

### 5.2 WorkerScopeBar（Q3：Chat 顶 · 单行）

```text
← 返回编排   ⚙️ {role} · 持锁中|处理中|空闲   [tab n]
```

- **硬预算 ≤28px 单行**（F-UX2）；RunBusy 信息并入该行或常驻芯片，**禁止** Scope 双行 + 底栏假结束 + fleet 气泡三重堆叠  
- 返回：`parent_thread_id` → fleet 同行 parent → 同 `orchestrator_run_id` 的 orchestrator → 线程列表  
- Popover **必须 portal** 到 Side Panel 根（FocusBand `maxHeight:80; overflow:hidden` 会裁切）— **F-I2**

### 5.3 观察 / 指挥表

| 操作 | 允许 |
|------|------|
| 读历史 / tool 卡 | ✅ |
| 切换其它 worker | ✅ |
| 暂停/恢复/取消该 worker | ✅（列表控制区） |
| 向该 worker 发消息 | !ThreadBusy |
| 全停 | ✅（二次确认，文案含释锁） |
| force-release | ✅ 仅锁分区 **次级**；文案「强制释放锁（其它 agent 可占用该 tab）」 |
| follow-up 偷锁 | ❌ |

### 5.4 Live 与历史诚实（F-I3）

| Wave | 进入 worker 后用户看到 |
|------|------------------------|
| W1 | `thread.select` **历史**（已完成 tool）；**不**承诺切瞬间的 in-flight 卡 |
| W0+companion | tool.* 带 `thread_id`，active 线程 transcript 不串台 |
| W2-min | `threadBusyById`：列表显示处理中；切回不永久丢 busy |

### 5.5 安全 floors（对抗强制）

| ID | Floor |
|----|--------|
| **F-S1** | Confirm 展示的 worker/tab/tool **独立于** activeThread；`stop` 目标优先请求戳记；multi-agent 缺戳记时 **deny-safe**，禁止静默 fallback 到错误 `activeThreadId` |
| **F-S2** | Worker 线程 Composer 硬标签：`发送给子任务 · {role}` |
| **F-S3** | force-release 不进 ScopeBar 主行；Pause≠Cancel≠全停 文案区分 |
| **F-S4** | 文档+验收：follow-up 不 transfer lease |
| **F-S5** | `!ThreadBusy && RunBusy && lock_count>0` → 必显「N 锁仍活跃」类提示，禁止纯「就绪」 |
| **F-S6** | Confirm primary 时不把舰队 popover/进展角标抬成主槽；确认台路径不回归 |
| **F-S7** | 回归：spawn L2 HITL、`WORKER_HARD_DENY`、无 auto-spawn、不抬 worker 工具面 |

---

## 6. 主线程「假结束」

当 `!ThreadBusy && deriveRunBusy(...)`：

> **编排本轮已结束 · 子任务还在跑** — [查看子任务]  
> （intent-only：用「任务板仍有未关闭意图」）

- 必须 **可点击** 打开与 §5.1 相同列表  
- 仅当 `deriveRunBusy` 为真；**禁止**用「有 idle worker」触发  

---

## 7. 视觉优先级

FocusBand **不改**优先级：Confirm > L2 急停 > Fleet > tools > L1。

| 增强 | 做法 |
|------|------|
| Fleet 主点击 | portal worker 列表；确认台次链（**UIUX v2 §4.3 脚注**） |
| RunBusy 芯片 | 常驻、可点（F-UX1） |
| ScopeBar | Chat 顶单行 |
| Composer | ThreadBusy → 停止本轮 |

竖向预算自检（实现前填实数）：L0 idle / fleet / worker+scene / L2+confirm — ChatStream 不低于 UIUX 最坏路径约定。

---

## 8. 交付波次（对抗后锁定）

### 同 PR 推荐：`W0 + companion thread_id + W1 + W2-min`

| 步 | 内容 | 估时 |
|----|------|------|
| **W0** | `deriveThreadBusy` + Composer 门控/停止/占位；`deriveRunBusy` + 假结束/芯片（诚实谓词） | 0.5–1d |
| **Companion** | `tool.start/result/progress` + `thread_id`；UI gate tool 写入 active transcript；**优先**暴露 `llm_active`（abortControllers keys） | 0.5d |
| **W1** | portal 列表 + ScopeBar + 进入子任务 + 文案 glossary | 1.5–2.5d |
| **W2-min** | `threadBusyById` + REMOVE_THREAD 清理 + 列表状态点；`SET_ACTIVE_THREAD` 后 busy 可读 map | 1–1.5d |
| **W3** | Board Intent 打开 / ThreadList 树 | 可选 |

**禁止**：只发 W0+W1 却验收「下钻后全程知道整场是否结束 / live 进展」而无 W2-min。  
**禁止**：§6 横幅建立在 `worker_count>0` 或未修正的 fleet-idle-active 上。

### 纯函数与单测（机器可验）

- [ ] `deriveThreadBusy` 矩阵  
- [ ] `deriveRunBusy`：idle 残留 worker → false；holding/locks/intents/llm → true  
- [ ] `canSend` / Stop 可见性（含 `isProcessing && !streaming`）  
- [ ] tool 事件带/不带 thread_id 不串台  
- [ ] ScopeBar parent 解析表  
- [ ] threadBusyById 删除不泄漏  
- [ ] F-S1 stop 目标：**无条件**改 MinimalConfirm（禁止 multi-agent 缺戳时 silent fallback 到 activeThreadId）  
- [ ] 已知 `orchestrator_run_id` 时 §6 / RunBusy 芯片按 run 过滤  
- [ ] 竖向预算表填实数（chip + Scope ≤28 + FocusBand ≤80 vs ChatStream 最坏 ≥40%）

「≤2 点击 / 真机 tool 流」→ **手工**清单。

---

## 9. 非目标

| 不做 | 原因 |
|------|------|
| 新「中层 Agent」runtime | ADR-020 |
| auto-spawn | Trust |
| 全量多线程 token 渲染 | 复杂度 |
| Side Panel 全图 Dashboard | 320px / 后置 |
| 跟进消息队列 | 单独 epic |
| 改 tab lease / worker L2 面 | 安全契约 |
| 阻塞式 `wait_workers`（旧 ST-6） | 仍 deferred |

---

## 10. 风险

| 风险 | 缓解 |
|------|------|
| 禁发过狠 | 仅 ThreadBusy；Steer=停止后再发 |
| 下钻假空闲 | W2-min 同发 |
| FocusBand 裁切 popover | portal |
| 停止误伤全舰队 | glossary + 分区控件 |
| idle worker 粘滞「还在跑」 | deriveRunBusy 排除 |
| 错 worker 确认/停止 | F-S1 |

---

## 11. 验收清单

- [ ] 单线程多 tool：Composer 全程 停止本轮 / 本对话处理中，无假空闲可发  
- [ ] `deriveRunBusy` 真时：常驻芯片或假结束可点；idle 残留不触发  
- [ ] RunBusy 芯片可见时 ≤2 点击进入指定 worker  
- [ ] Worker 有返回编排；Composer 显示「发送给子任务 · role」  
- [ ] 停止本轮只 abort 当前线程；全停二次确认且含释锁语义  
- [ ] Confirm / L2 急停优先级不因下钻破坏  
- [ ] F-S1…F-S7；无 auto-spawn、不抬 worker 工具面  
- [ ] tool.* 带 thread_id；切线程不把后台 tool 写入错误 transcript  

---

## 12. 产品默认（已锁定 · 对抗后不再「待确认」）

| # | 决策 | 锁定值 |
|---|------|--------|
| Q1 | Composer | **硬门控** ThreadBusy |
| Q2 | FocusBand 舰队主点击 | **portal worker 列表**；确认台次链 |
| Q3 | ScopeBar | **Chat 顶单行 ≤28px** |
| Q4 | 交付 | **W0 + companion thread_id + W1 + W2-min 同 ship** |
| Q5 | Board 打开 worker | **W3** |

**UIUX v2 脚注**：§4.3 Fleet primary 由「→ Cockpit」改为「→ worker list popover；Cockpit 次链」；仍 ≤80px、无第三 bar、Confirm/L2 优先不变。

---

## 13. 实现锚点

| 区域 | 文件 |
|------|------|
| 纯函数 | 新建 `thread-busy.ts`（或等价）+ 单测 |
| Composer | `App.tsx` |
| 假结束 / label | `ChatView.tsx` · chips |
| Fleet / popover | `FleetStrip.tsx` · `FocusBand.tsx` · portal host |
| ScopeBar | 新小组件挂 Chat 顶 |
| Store | `agentStore.tsx`（map + SET_ACTIVE_THREAD 策略） |
| WS | `useWebSocket.ts` gate tool.* |
| Companion | `server.ts` tool.start 等 + 可选 fleet llm_active |
| Confirm | `MinimalConfirm.tsx`（F-S1） |
| 文档 | `multi-agent-user-guide.md` · UIUX 脚注 |

---

## 14. 对抗与双路修订日志

| 日期 | 变更 |
|------|------|
| 2026-08-04 | 初稿 Draft |
| 2026-08-04 | 四路对抗：Product MAJOR_REVISE + 三路 PASS_WITH_CHANGES → 诚实 RunBusy、W2-min 同发、常驻芯片、steer、portal、tool thread_id、F-S*、Q 锁定 |
| 2026-08-04 | Pi+Claude **APPROVE_WITH_NITS**：吸收 multi-run 过滤优先、llm_active 优先、F-S1 验收无条件、预算表 |

### Dual-review nits（实现时消化 · 非阻塞）

| # | 来源 | Nit |
|---|------|-----|
| N1 | Claude/Pi | 已知 run_id 时 §6/芯片按 run 过滤 |
| N2 | Claude/Pi | `llm_active` 优先必做，关闭后台纯 LLM 残差 |
| N3 | Claude | F-S1 MinimalConfirm 今日 silent fallback 必须改；跟踪为验收项 |
| N4 | Pi | F-S1 测试无条件（非「若改」） |
| N5 | Claude/Pi | 竖向预算填实数；glossary 文案钉死在实现 PR |
| N6 | Claude/Pi | dual-review 附带 patch 含无关 dirty tree — 流程 nit，与本设计无关 |

---

*LOCKED for implementation — dual APPROVE_WITH_NITS — 2026-08-04*
