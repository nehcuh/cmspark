# ADR-015: Multi-Agent Orchestrator、Dashboard 与 Tab 排他锁

**日期**: 2026-07-27 | **状态**: 已拍板；**P0 内核已落地 + P1 部分交付**（`feat/multi-agent-p0` worktree）  
**相关**:

| 文档 | 角色 |
|------|------|
| `docs/decisions/v1.3/multi-agent-orchestrator-brief-2026-07-27.md` | 产品意图 |
| `docs/decisions/v1.3/multi-agent-orchestrator-synthesis-2026-07-27.md` | Grok 对抗 workflow 综合 |
| `docs/decisions/v1.3/multi-agent-orchestrator-review-synthesis-2026-07-27.md` | Claude+Pi 综合 |
| Claude / Pi 全文 | `docs/audit/reviews/multi-agent-orchestrator-claude-20260727-101050.md` · `…-pi-2026-07-27.md` |
| ADR-014 | Mission Pack = 角色模板，非新 runtime |
| Workflow | `.grok/workflows/multi-agent-tab-lock-adversarial.rhai` |

## 背景

复杂任务需要多个协作 Agent；用户要求 **Orchestrator + Dashboard + 人为切入**，并强调硬规则：

> 当某个 sub-agent **正在操作某 tab** 时，其他 agent **不得**再操作该 tab，必须等待 **tab 操作锁释放**。

现状：多 Thread 为人肉并行；无 tab lease；`isToolAllowed` 零调用点；`pendingToolCalls` 无 `thread_id`；`screenshot` 等可 silent active-tab。

## 产品拍板（2026-07-27 用户确认）

| # | 议题 | 决定 |
|---|------|------|
| Q1 | `SOFT_RESERVED` 是否互斥 | **互斥**（第二个 worker 对同一 tab 不得并行进 L2；禁止「用户白点 approve」） |
| Q2 | Worker 是否默认禁 `evaluate` | **不禁**；走现有 **L2 forceConfirm**，**不**列入 `WORKER_HARD_DENY` |
| Q3 | 并发上限 | **最多 5**（见 §3.5 数值表） |
| Q4 | `host_computer` vs tab lease | **采用推荐方案**：存在任意 tab lease 时，禁止 `host_computer` 对 **Chrome/Chromium 窗口** 的坐标点击/键入；须 force-release 相关 lease 或放弃 host 操作（其它 host 目标不受 tab lease 阻塞） |
| Q5 | HITL 切入 worker 后能否发指令 | **能** 注入消息 / follow-up；**不**自动偷锁；mutate 工具仍须 **持有者身份** 或用户 **force-release** 后再由新 holder 操作 |

## 决策

### 1. Worker = 子 Thread；Orchestrator = 窄工具面 Thread

- **不**新建 in-process swarm runtime 或绕开 `ThreadManager` 的并行 LLM 环。
- Worker：`parent_thread_id`、`orchestrator_run_id`、`worker_role_label`、可选 `capability_elevation_level`。
- Orchestrator 默认工具：`spawn_worker` / `wait_workers` / `collect_handback` / `ask_user` / `list_workers` / `get_worker_status` / **`list_tab_locks`**。  
  默认 **禁止** 浏览器 mutate、`shell_exec`、`netsec_*`、`host_*`、`osascript_eval`（升权另确认，且仍受 tab lease / 并发 cap 约束）。

### 2. Pack = 角色模板；能力降权必须硬门

- Spawn 经 **用户确认**（单次或 batch）后 `chat.create` + `pack.apply`（或等价）。
- 子线程 **必须** 非空 `tool_whitelist`（禁止 null=全放行）。
- `effective = (parent ∩ role_pack.allow) \ WORKER_HARD_DENY \ role_pack.deny`（parent 为 null 时用 role_pack.allow）。
- **`WORKER_HARD_DENY` 默认**（拍板后）：  
  `{ shell_exec, netsec_port_scan, osascript_eval, host_computer, host_write, host_read, host_app }`  
  **不含 `evaluate`**（Q2）。
- **`isToolAllowed` 必须在 `createToolExecutor` 入口调用**（在 L2 / module / `tool.execute` 之前）。今日零调用点是 P0 阻塞项。

### 3. Tab 排他锁（正确性核心）

#### 3.1 不变量

\[
\forall\ \mathrm{tabId},\quad |\{\text{exclusive holders}\}| \le 1
\]

- 锁单位：**Chrome `tabId: number`**  
- 持有者：**worker `thread_id`**（非 `orchestrator_run_id`）  
- `pinned_tabs`：**软亲和**，不赋排他  

#### 3.2 状态机（拍板修订版）

| 状态 | 含义 |
|------|------|
| `FREE` | 无持有者 |
| `SOFT_RESERVED(holder, confirm_id, deadline)` | 等待 L2；**互斥**（Q1） |
| `HELD_PENDING_L2(holder, confirm_id)` | 已 HARD 的 holder 再发本 tab 上 L2 工具：保持排他、不计 idle |
| `HARD_HELD(holder, renewed_at, idle_ttl, hard_max)` | 操作中 episode |
| `FORCE_RELEASING` | 人工 force-release 或到期 drain 中 |

**关键转移（摘要）：**

- 无 L2 的 tab 工具：`FREE` → 校验 holder → `HARD_HELD`（同 holder re-entrant renew）。
- 需 L2 且当前 FREE：`SOFT_RESERVED`（**仅一 holder**）；其它 worker → `TAB_BUSY_CONFIRMING` / `TAB_LOCKED`（可恢复，**不**进第二确认）。
- `SOFT_RESERVED` → approve → **hard re-acquire** → `HARD_HELD`；deny/timeout/rejectAll → `FREE`。
- 已在 `HARD_HELD` 的同 holder 再发 L2 工具 → `HELD_PENDING_L2`（**不**放排他）→ approve → renew `HARD_HELD`；deny → 回到 `HARD_HELD`（不释放）。
- 非持有者任意 tab-targeted 工具 → `{ error_code: 'TAB_LOCKED', tab_id, holder_thread_id }`。
- **到期 / force-release**：不得在 in-flight CDP 仍运行时静默 `FREE`。必须：reject 该 holder 在该 tab 上的 `pendingToolCalls` → 发 abort/drain（或 P0：有 pending 则拒绝 auto-free，进入 `FORCE_RELEASING` 等人）→ 再 `FREE` + 审计。

#### 3.3 作用域与禁绕过

- **P0 需要 lease 的工具**：所有 tab-targeted **读+写**（含 `screenshot` / `get_page_*` / `evaluate` 等）。  
  shared-observer 只读模式 **非默认**，归 P2。
- **Multi-agent 模式禁止 silent active-tab**：缺 `tabId` → `TAB_ID_REQUIRED`（修 `screenshot`/`analyze_image` fallback）。
- **`create_tab`**：创建成功后对该 caller **auto HARD 短租约**（防抢新 tab）。
- **`list_tabs`**：每项返回 `locked_by_thread_id` / `lease_expires_at`（防重试风暴）。
- **权威门禁**：Companion `createToolExecutor`（resolve tabId 后、L2 前、dispatch 前再检）。Extension 队列 = P1 纵深。
- **与 host 关系（Q4）**：tab lease **不**替代 `COMPUTER_TASK_BUSY`；存在任意 tab lease 时 **禁止** `host_computer` 操作 Chrome 窗口内容；其它应用窗口仍可走 host 单任务语义。

#### 3.4 取消与 HITL（Q5）

- **Cancel worker**：AbortController（LLM）+ reject 该 `thread_id` 的 pending + 释放其全部 tab lease。  
  → 要求 `pendingToolCalls` **绑定 `thread_id`（及 tabId）**——P0，不可放 P1。
- **HITL enter**：切换 `activeThreadId`，**可**发用户消息 follow-up；**不**转移 lease。  
  人要 mutate 非己持锁 tab：先 force-release 或等释放。
- **Pause**：冻结该 worker LLM 与新 dispatch；lease 保留至 TTL/resume/cancel。

#### 3.5 并发与 TTL 数值（Q3：最多 5）

| 参数 | 值 | 说明 |
|------|-----|------|
| `max_workers_per_orchestrator_run` | **5** | 单次编排最多 5 个 worker |
| `max_concurrent_multi_agent_llm_loops` | **5** | 进程内 multi-agent 同时跑的 LLM 环上限 |
| `max_tabs_leased_per_worker` | **2** | 单 worker 懒获取 tab 上限（5 总预算内控局部占用） |
| `max_tabs_leased_process` | **10** | 进程总 lease 上限 |
| `idle_ttl_ms` | **120_000** | 覆盖一轮 LLM 思考；仅 **worker tab-tool entry** 续租 |
| `hard_max_lease_ms` | **600_000** | 单 episode 硬顶 |
| `max_active_l2_per_run` | **1** | 每 orchestrator_run |
| `max_active_l2_process` | **2** | 全局 |

（TTL 可按 Pack 覆盖，但不得超过 hard 上限表。）

### 4. L2 与安全

- Confirm 请求/响应携带：`worker_id`、`parent_thread_id`、`orchestrator_run_id`、`tabId`（tab 范围时）。
- 保持 `originWs` + `respondFrom`；**禁止** Dashboard 广播 approve。
- `shell_exec` / `netsec_port_scan`：每调用 L2 + **process-wide single-flight**；spawn **不得**改 `capability_profile` / 启用 modules。
- 审计：Companion `AuditWriter` 盖章（spawn / L2 / lease / elevation / HITL / force-release）。
- **L2 admission 顺序**：`acquireL2Admission` → SOFT（tab L2 tools）→ Confirm → hard re-acquire；admission 在 `finally` 释放。SOFT 在 admission 之后获取，`softDeadline` = confirm timeout，避免排队时 SOFT 过期。
- **L2 admission 队列语义（scan-skip FIFO，非严格 HOL）**：等待者按到达顺序排列，但 `tryDequeue` 扫描队列并放行**当前** `canAdmit` 的每一位 waiter（在 process/run cap 下可 multi-admit）。队首若仅因 per-run cap=1 被挡，**不会**阻塞后续不同 run 的 waiter。文档表述为「当前可准入 waiters 中的 FIFO」，勿声称严格 head-of-line。
- **shell/netsec single-flight**：在展示 L2 之前 reserve flight；deny/timeout 释放；approve 保留至 execute（同 owner re-entrant），避免用户白点后 `*_BUSY`。
- **Confirm stop**：companion 消费 `stop_thread` + `stop_thread_id`；优先服务端 stamped `worker_id` 做 abort + reject pending + release leases（UI `chat.abort` 为冗余 best-effort）。

### 5. Dashboard UX

- **全页** Cockpit 级窗口：worker 网格、状态、lease 图、Confirm Center、切入。
- Side Panel ~320px：**FleetStrip** only（数量、最坏状态、pending 确认徽标、打开 Dashboard、stop-all）。
- **优先扩展现有 Cockpit 壳**，保证单一 L2 确认中心（避免双窗确认风暴）。

### 6. 分阶段交付

| 阶段 | 内容 |
|------|------|
| **P0** | Lease Map + 状态机（含 SOFT 互斥、`HELD_PENDING_L2`）；`isToolAllowed` 硬门；`pendingToolCalls.thread_id`；禁 active-tab 绕过；spawn+确认+Pack 降权；窄 orchestrator；数值 cap；worker-cancel；`list_tabs` 锁元数据 + `list_tab_locks`；`create_tab` auto-hold；最小 FleetStrip；审计；host_computer×Chrome×lease 门禁 |
| **P1** | Confirm Center 完整身份与 FIFO；HITL pause/force-release UX；shell/netsec single-flight；可选 SOFT 排队（替代纯拒绝） |
| **P2** | 全量 Dashboard；shared-observer 只读；Extension per-tab 队列；受限 auto-spawn |

## 否决

- Prompt-only 锁；仅 RTT 锁；仅 Extension 锁  
- HARD 锁裸横跨 45s L2（无 `HELD_PENDING_L2`）  
- 静默并行 shell/netsec；null worker whitelist  
- `pinned_tabs` 当所有权；run_id 当 tab holder  
- 广播 approve  

## 后果

- **正面**：复杂任务可编排；tab 正确性可论证；与 Pack/L2/双层拓扑一致。  
- **代价**：多 worker 浏览器 mutate 在同 tab 上串行；P0 工作量大（executor / schema / abort 链路）。  
- **已做**：P0 内核 + P1 FleetStrip/L2 FIFO/single-flight/llm-loop cap/spawn HITL（见上方进度表）。  
- **未做**：全量 Dashboard / shared-observer / E2E；默认 Chrome Store 分发「多 agent 攻击面」SKU。

## 实现入口（供 writing-plan）

- `companion/src/server.ts` — `createToolExecutor`、`pendingToolCalls`、L2  
- `companion/src/threads/thread-manager.ts` — worker 字段、`isToolAllowed`  
- `companion/src/security-confirmation.ts` — 身份字段、SOFT 互斥准入  
- 新建 `companion/src/orchestrator/` 或 `capability/tab-lease.ts`  
- Extension：`browser-bridge` 去掉 multi-agent 下 active-tab fallback；可选 `tool.abort`  
- UI：FleetStrip + Cockpit Dashboard  

## 实现进度（worktree `feat/multi-agent-p0`，2026-07-27）

### 已交付（P0 内核 + 部分 P1）

| 项 | 位置 / 备注 |
|----|-------------|
| Tab lease Map + 状态机（SOFT 互斥、HELD_PENDING_L2、HARD、FORCE_RELEASING、TTL caps、审计） | `companion/src/orchestrator/tab-lease.ts` |
| `isToolAllowed` 硬门（L2/dispatch 前） | `createToolExecutor` |
| `pendingToolCalls.thread_id` + `tabId`；`rejectPendingForThread`；worker_cancel / fleet.stop_all 排水 | `server.ts` / `message-router.ts` |
| Multi-agent `TAB_ID_REQUIRED`；extension 禁 silent active-tab fallback | executor + BrowserBridge |
| `spawn_worker` + `WORKER_HARD_DENY` + 非空 whitelist + max 5 workers/run + list/collect/wait(snapshot)/list_tab_locks | `orchestrator/spawn.ts` |
| **Real spawn HITL**：`spawn_worker` 走 L2 forceConfirm + `security_token`；**禁止** LLM `user_confirmed` 自批 | `server.ts` L2_GATE_TOOLS |
| 可选 `pack.apply` after spawn（role template；不抬 `capability_profile`） | `executeCompanionTool` spawn case |
| `list_tabs` lock 元数据；`create_tab` auto HARD-hold；host_computer×Chrome×lease（Q4） | executor |
| L2 multi-agent 身份字段 + **FIFO admission**（1/run、2/process；`finally` release） | `l2-admission.ts` + `createToolExecutor` |
| shell_exec / netsec **process single-flight** | `single-flight.ts` |
| **`max_concurrent_multi_agent_llm_loops=5`** 门控 multi-agent `chat.create` | `llm-loop-gate.ts` + message-router |
| **Filter LLM tool schemas** by thread `tool_whitelist` | `llm/adapter.ts` |
| **`ask_user`** binary HITL via L2 Confirm Center | tool def + companion case |
| **`wait_workers` frozen poll-only**（带 llm_loops 快照；非 barrier） | tool def + companion case |
| Pending-aware force-release（`FORCE_RELEASING` → reject pending → complete） | `forceReleaseTab` / `completeForceRelease` |
| Extension BrowserBridge **per-tab serialize queue** | `browser-bridge.ts` `withTabQueue` |
| FleetStrip + fleet.status/stop_all/pause/resume/force_release；Confirm Center worker/tab/run；Cockpit 舰队计数 | extension UI |
| Unit tests：lease + L2 admission + single-flight + llm-loop gate + force-release drain | `orchestrator-*.test.ts` |

### 仍开放（按优先级）

| 项 | 说明 |
|----|------|
| E2E/integration：lease lock、cancel、stop-all、L2 identity 端到端 | 单元已覆盖内核；WS E2E 待补 |
| SOFT 排队（替代纯 `TAB_BUSY_CONFIRMING` reject） | P1 optional |
| `wait_workers` 真 barrier | 当前明确 poll-only |
| Extension `tool.abort` 深度排水 | force-release 已 reject companion pending；CDP abort 待补 |
| P2 全量 Dashboard 网格 / lease 图 / audit trail | FleetStrip + Cockpit 计数已有 |
| P2 shared-observer 只读 lease；受限 auto-spawn | 未做 |
| `ask_user` 自由文本答案 | 当前 binary approve/deny |

### 关键不变量（实现必须保持）

1. `isToolAllowed` 在 L2 与 dispatch **之前**  
2. L2 admission acquire 后 **必有** `finally { releaseL2Admission }`  
3. shell/netsec single-flight acquire 后 **必有** `finally { releaseFlight }`  
4. multi-agent LLM loop gate acquire 后 **必有** `finally { releaseMultiAgentLlmLoop }`  
5. Worker whitelist **非空**；spawn **不得**改 `capability_profile` / 启用 modules  
6. Tab lease 权威在 Companion；extension 队列仅为纵深  

## 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-27 | 初版：对抗 workflow + Claude/Pi + 用户 Q1–Q5 拍板 |
| 2026-07-27 | P0 内核 + P1 FleetStrip/L2 FIFO/single-flight/llm-loop cap/spawn HITL/ask_user/tool whitelist filter/pending force-release；更新本进度表 |
