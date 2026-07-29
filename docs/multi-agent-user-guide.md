# Multi-Agent 与 Mission Board 使用说明

> **面向使用者**：编排者如何拉起 Worker、tab 锁是什么、任务板怎么用、上限与禁区。  
> **产品版本**：0.3.0  
> **决策**：[ADR-015](adr/015-multi-agent-orchestrator-tab-lock.md) · [ADR-016](adr/016-mission-board.md)  
> **任务包交叉**：[mission-pack-usage.md §10](mission-pack-usage.md#10-multi-agent编排-worker与任务包) · **确认台**：[confirm-center-user-guide.md](confirm-center-user-guide.md)

### 能力坐标

| 轴 | 本指南位置 |
|----|------------|
| **Surface** | Worker 默认在 **L1 网页**（浏览器工具）；**硬禁** L2 类 `host_*` / shell / netsec — **高自主度 ≠ 更深桌面** |
| **Composition** | Pack 只作 worker **角色模板**（白名单 + skills），不新开 runtime |
| **Autonomy** | **本指南主轴** — 单线程 → multi-worker + tab lease → Mission Board（Fact/Intent/Hint） |
| **Trust** | `spawn_worker` **必须** L2 HITL；无 auto-spawn / 静默 fan-out |
| **规范** | [ADR-020](adr/020-capability-model-three-axes.md) · [ADR-015](adr/015-multi-agent-orchestrator-tab-lock.md) · [ADR-016](adr/016-mission-board.md) |

---

## 1. 一句话

复杂任务可由 **Orchestrator（编排线程）** 经你确认后 **`spawn_worker`** 拉起多个 **Worker（子线程）**；同一 Chrome **tab 同时只能被一个 holder 操作**（tab lease）。  
**Mission Board** 是线程上的结构化黑板（Fact / Intent / Hint），避免「散文 handback 幻觉扫完」——它属于 **自主度 / 协作**，不是 Skill/MCP 那种组合原语。

这与 GOAL 里实验性 **Type C Skill / `sub_agent`** 设想、以及「再装一个深层 Agent」**不是同一机制**：这里是 **同一 Companion 上的编排 + 子线程**。

---

## 2. 角色模型

| 角色 | 是什么 | 默认工具面 |
|------|--------|------------|
| **Orchestrator** | 窄工具面主线程 | `spawn_worker` · `wait_workers` · `collect_handback` · `list_workers` · `get_worker_status` · `list_tab_locks` · `ask_user` · `board_*` 等 |
| **Worker** | 子 Thread（`parent_thread_id` + `orchestrator_run_id`） | 浏览器 **L1** 工具等（受 whitelist）；**硬禁** shell/netsec/host_* / osascript（**L2 不交给 worker**） |
| **Mission Pack** | 角色 **模板**（skills + whitelist + 提示词） | **组合面**配方；**不**抬 `capability_profile`，**不**偷偷开 shell/netsec |

Orchestrator **默认不能**直接 mutate 浏览器 / shell / host；执行细节交给 Worker。

---

## 3. Spawn：必须你点同意

1. 用自然语言让当前线程扮演编排者（或系统已把工具面收成 orchestrator）。  
2. 模型调用 **`spawn_worker`** → **L2 确认**（侧栏红条或 FleetStrip **确认台**）。  
3. **没有** auto-spawn / 静默 fan-out；参数里的 `user_confirmed` **不被信任**。  
4. 你批准后：Companion 建子线程 → 可选 `pack.apply` 角色模板 → 计算非空 `tool_whitelist`：  
   `parent ∩ pack.allow \ WORKER_HARD_DENY`。

### 默认上限（`ORCHESTRATOR_CAPS`）

| 上限 | 默认值 |
|------|--------|
| 每个 orchestrator run 的 worker 数 | **5** |
| 进程内 multi-agent LLM 环并发 | **5** |
| 每个 worker 持有的 tab lease | **2** |
| 进程总 tab lease | **10** |
| 单 run / 进程活跃 L2 | 1 / 2 |
| tab lease 空闲 TTL | **120s**（`idle_ttl_ms`） |
| tab lease 硬上限 | **600s**（`hard_max_lease_ms`） |

超限会得到可理解错误（如 `MULTI_AGENT_LLM_CAP` / `TAB_LEASE_CAP`），应等待或取消 worker，而不是死循环 spawn。

**`wait_workers` 是轮询/状态查询，不是屏障**：不会阻塞到所有 worker 结束；主线程需自行循环查询或结合 handback / Board 状态。

---

## 4. Tab 排他锁

- **单位**：Chrome `tabId`。  
- **不变量**：同一时刻最多 **一个** exclusive holder。  
- Worker 对 tab 的读/写工具（navigate、screenshot、`get_page_*`、click、`evaluate`…）都要 **lease**；本阶段 **没有**「只读共享 observer」。  
- 其它 worker 撞锁 → 可恢复错误（如 `TAB_LOCKED` / `TAB_BUSY_CONFIRMING`），**不会**并行进第二确认。  
- 权威在 Companion（`orchestrator/tab-lease`）；扩展另有 per-tab 串行队列防 CDP 竞态。  
- 你向 worker 发 follow-up **不会**自动偷锁；要操作非己持锁 tab 须等待释放或 **force-release**（高级）。  
- **`host_computer` vs Chrome 窗**：存在任意 tab lease 时，禁止对 Chrome/Chromium 窗口做坐标操控（见 Computer Use 指南）。

可查询：`list_tab_locks` / FleetStrip 状态。

---

## 5. Mission Board（任务板）

### 5.1 概念

线程作用域内的可变 run 状态（P0 已交付）：

| 字段 | 含义 |
|------|------|
| `origin` / `goal` | 起点与成功条件 |
| `facts[]` | 已记录主张（带 trust tier，**默认非绝对真理**） |
| `intents[]` | 待探索 / 进行中 / 废弃意图 |
| `hints[]` | 人/编排侧约束与提示 |
| `status` | `open` \| `completed` \| `abandoned` |

### 5.2 工具与 UI

| 工具 | 作用 |
|------|------|
| `board_read` | 读板 |
| `board_complete` | 申请收工（**L2** + 可完成性检查；`empty_complete` 等会在确认里暴露） |
| `board_claim_intent` / `board_heartbeat_intent` | Intent 认领 / 心跳（进阶） |
| `collect_handback` | board 模式下要求 **结构化** handback，抑制散文幻觉 |

Side Panel：**BoardPanel**（底栏/上下文入口以当前 UI 为准）展示板状态。  
FleetStrip：worker 数量、状态、**全停**（abort LLM + 拒 pending + 释放该 run 相关 lease）。

### 5.3 本阶段不做（避免期待过度）

| 项 | 状态 |
|----|------|
| auto-spawn | **不做** |
| 只读 tab 共享 | **延期** |
| 全量图 Dashboard / Intent 抢占调度 | 后置（ADR-016 阶段 3+） |

---

## 6. 与任务包 / 企业模块

- Worker **硬禁**：`shell_exec`、`netsec_port_scan`、`osascript_eval`、`host_computer`、`host_write`、`host_read`、`host_app`。  
- **`evaluate` 不禁**，但仍走 L2。  
- Spawn **不得**改 `capability_profile` 或启用 modules。  
- 需要 shell/netsec：仍走 [mission-pack-usage](mission-pack-usage.md) 本机 opt-in；多 agent 下另有 process **single-flight**。

---

## 7. 推荐试用路径

1. 开新线程，描述「你编排，子 agent 分头看页面 A/B」。  
2. 批准 **spawn** 确认；在 FleetStrip 看 worker。  
3. 危险浏览器操作与 spawn 看清 **worker / tab / run** 再批。  
4. 需要结构化收尾：启用/使用 Board，`board_complete` 再批一次。  
5. 失控时用 **全停** 或确认台 **拒绝并停止**。

---

## 8. 相关文档

| 文档 | 用途 |
|------|------|
| [ADR-020](adr/020-capability-model-three-axes.md) | Autonomy 轴；Worker≠深层 Agent |
| [ADR-015](adr/015-multi-agent-orchestrator-tab-lock.md) | Orchestrator / tab lock |
| [ADR-016](adr/016-mission-board.md) | Board 契约 |
| [mission-pack-usage.md](mission-pack-usage.md) | Pack 与 §10 交叉 |
| [confirm-center-user-guide.md](confirm-center-user-guide.md) | L2 / 舰队确认 |
| [architecture.md](architecture.md) §10 | 模块路径 |

---

*文档版本：2026-07-29 · 对齐 ADR-020 能力坐标 · 与 `orchestrator/*` · `board/*` · ORCHESTRATOR_CAPS 一致。*
