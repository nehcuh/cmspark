# Multi-Agent Orchestrator + Tab Lock — 三方对抗综合结论

**Date**: 2026-07-27  
**Status**: **产品已拍板** → 见 [ADR-015](../../adr/015-multi-agent-orchestrator-tab-lock.md)；实现前仍须落地 §3 MUST-FIX  
**Pipeline**:

| 阶段 | 产物 | 结果 |
|------|------|------|
| Product brief | `multi-agent-orchestrator-brief-2026-07-27.md` | 含用户硬规则：tab 操作排他锁 |
| Grok workflow | `multi-agent-tab-lock-adversarial` · 25 agents · 18→14 survivors | `multi-agent-orchestrator-synthesis-2026-07-27.md` |
| Claude | `docs/audit/reviews/multi-agent-orchestrator-claude-20260727-101050.md` | **APPROVE_WITH_CHANGES 78%** |
| Pi | `docs/audit/reviews/multi-agent-orchestrator-pi-2026-07-27.md` | **APPROVE_WITH_CHANGES 72%** |

---

## 1. 总体裁决（综合）

**可以继续设计/写 ADR，但还不能按当前 synthesis 直接开 P0 编码。**

方向正确、与 CMspark 双层拓扑 / Thread / Pack / L2 对齐；**tab 排他锁**被三方一致认定为正确性核心（不是 polish）。  
Claude 与 Pi 共同指出：若不先修若干 **代码锚点级** 漏洞，锁会变成「虚假排他保证」。

---

## 2. 已锁定、三方基本同意的架构原则

1. **Worker = 子 Thread**（复用 ThreadManager / pack.apply / abort / 历史），不另起 swarm runtime。  
2. **Orchestrator 默认窄工具面**：spawn / wait / collect / ask_user + 只读 status；浏览器 mutate / shell / netsec / host 默认禁止。  
3. **Spawn 须用户确认**；禁止静默扇出高危模块。  
4. **Pack = 角色模板**；子线程 **非空** tool_whitelist + 与 parent 求交 + **WORKER_HARD_DENY**；**必须**在 `createToolExecutor` 真正调用 `isToolAllowed`（今日零调用点 = 能力降权是演戏）。  
5. **锁粒度 = `tabId`（number）**；持有者 = **worker `thread_id`**；`pinned_tabs` 仅亲和，不赋排他。  
6. **锁单位 = multi-tool episode lease**（不是单次 `pendingToolCalls` RTT）；Companion 权威门禁。  
7. **不要**把 HARD 锁横跨完整 45s L2 等待（会死锁 / 锁滞留）；但 same-holder 已持锁再发 L2 工具需要 **额外子状态**（见 must-fix）。  
8. **host_computer / shell / netsec 与 tab 锁正交**；shell/netsec 另加 process-wide single-flight + 每调用 L2。  
9. **L2 风暴要限流**（每 run ≤1 活跃 + 全局小 cap）；confirm 带 worker/run/tab 身份；禁止跨连接广播 approve。  
10. **Dashboard = Cockpit 级全页**；Side Panel 仅 FleetStrip。  
11. **HITL 切入 ≠ 偷锁**；cancel 必须 abort LLM + reject pending + 释锁（`chat.abort`  alone 不够）。  
12. **审计 Companion 盖章**，不信任 LLM/工具参数。

### Tab 锁状态机（workflow 版，待 must-fix 修订）

`FREE | SOFT_RESERVED | HARD_HELD | FORCE_RELEASING`  
非持有者 → `TAB_LOCKED`；闸门在 Companion `createToolExecutor`（tabId resolve 后、L2 前，dispatch 前再硬校验）。

---

## 3. Claude + Pi 共同 MUST-FIX（开 P0 前）

按严重度合并（编号为综合序号）：

| # | 问题 | Claude | Pi | 建议处置 |
|---|------|--------|-----|----------|
| **C1** | **`isToolAllowed` 零调用点** → 白名单/HARD_DENY 无效 | Blocker | M4 | **P0 第一步**：`createToolExecutor` 入口硬门 |
| **C2** | **`pendingToolCalls` 无 `thread_id`** → P0 写的 worker-cancel 无法正确 reject 归属工具 | Blocker（且与 P1 错位） | （cancel/lease 相关） | **上提到 P0**：bind `thread_id` (+ tabId) |
| **C3** | **SOFT_RESERVED 非互斥** → 两 worker 都进 L2，用户先批 B 后批 A，A 出现「白点 approve」 | 产品分叉，推 early-block | **M1** | **P0 拍板：SOFT 互斥（early busy）**；排队留给 P1 |
| **C4** | **Lease 到期不取消 in-flight CDP** → 锁释放但 click/type 仍在跑 = **违反用户硬规则** | （abort drain 相关） | **M2 最致命** | 到期前先 reject pending + abort/drain；或 **有 pending 则不 auto-free**，转 FORCE_RELEASING 等人 |
| **C5** | **`screenshot`/`analyze_image` active-tab fallback** 绕过「必须 explicit tabId」 | 同意 ban | **M3** | multi-agent 模式强制 `TAB_ID_REQUIRED` |
| **C6** | **Thread 缺 parent/orchestrator_run/worker 元数据** | Blocker | — | P0 schema |
| **C7** | **`security.confirmation.request` 缺 worker/run/tab 字段** | Blocker | — | P0 payload |
| **C8** | **Same-holder + 已 HARD + 再发 L2 工具**：#6 renew vs #7 不横跨 L2 **矛盾** | 要求 `HELD_PENDING_L2` | — | 状态机补子状态：保持排他、不计 idle |
| **C9** | `create_tab` 后新 tab FREE 窗口可被他人抢 | 要求 auto-hold | — | P0：创建 者 auto HARD 短租约 |
| **C10** | `list_tabs` 不暴露锁信息 → 重试风暴 | 要求返回 locked_by | — | P0：列表带 lease 元数据 |
| **C11** | Orchestrator 缺 `list_tab_locks` | 死锁不可见 | — | 窄工具面加只读锁列表 |

---

## 4. 产品拍板（2026-07-27 用户确认）

| ID | 问题 | **决定** |
|----|------|----------|
| Q1 | SOFT 是否互斥 | **互斥** |
| Q2 | Worker 默认禁 `evaluate`？ | **不禁**（标准 L2；不进 `WORKER_HARD_DENY`） |
| Q3 | 并发上限 | **最多 5**（见 ADR-015 §3.5：workers/run≤5，LLM loops≤5，tabs/worker≤2…） |
| Q4 | host_computer × tab lease | **推荐方案**：任意 tab lease 存在时禁止 host 点 Chrome 窗口 |
| Q5 | HITL 能否注入指令 | **能**；不偷锁；mutate 仍须 holder / force-release |
| （继承） | P0 纯读排他 | **是**（shared-observer → P2） |
| （继承） | Dashboard | **扩展现有 Cockpit**，单一 L2 中心 |
| （继承） | `osascript_eval` | Worker **HARD_DENY** 直至可靠 tab 绑定 |

正式条文：**[ADR-015](../../adr/015-multi-agent-orchestrator-tab-lock.md)**。

---

## 5. 修订后的交付阶段（综合）

### P0 — 正确性内核（无 Dashboard 全功能也可）

- Tab lease Map + `createToolExecutor` 硬门 + multi-tool lease + TTL 策略（含 **C4**）  
- **C1** isToolAllowed、**C2** pendingToolCalls.thread_id、**C5** 禁 silent active-tab  
- Worker=Thread spawn + 用户确认 + Pack 降权 + 窄 orchestrator  
- SOFT **互斥（C3）**；状态机补 **HELD_PENDING_L2（C8）**  
- create_tab auto-hold（C9）；list_tabs 暴露锁（C10）；list_tab_locks（C11）  
- 最小 FleetStrip：stop-all + pending badge  
- 审计 spawn/L2/lease  

### P1 — L2×锁卫生 + HITL

- Confirm Center 身份字段、FIFO、worker 标签  
- HITL enter/pause/force-release  
- shell/netsec single-flight  
- 可选 SOFT 排队（替代互斥）  

### P2 — Fleet 产品面

- 全量 Dashboard、tab map、shared-observer 只读模式  
- Extension per-tab 队列 defense-in-depth  
- auto-spawn 仅非高危 pack  

---

## 6. 明确否决（三方一致）

- 仅靠 prompt「别碰那个 tab」  
- 只锁单次 tool RTT  
- 仅 Extension 侧锁  
- HARD 锁横跨整个 45s 确认等待（无 HELD_PENDING_L2 补丁时）  
- 静默并行 shell/netsec / 跳过 L2  
- null whitelist 当 worker 默认  
- pinned_tabs = 所有权  
- Dashboard 广播 approve  

---

## 7. 推荐下一步

1. ~~拍板 Q1–Q8~~ → **已完成**（§4 + ADR-015）。  
2. ~~ADR-015~~ → **已写** `docs/adr/015-multi-agent-orchestrator-tab-lock.md`。  
3. 可选：writing-plan / 实现 worktree——**不要**跳过 C1–C5 与 ADR 状态机（SOFT 互斥、`HELD_PENDING_L2`、lease drain）。

---

## 8. 文件索引

| 文件 | 用途 |
|------|------|
| `docs/decisions/v1.3/multi-agent-orchestrator-brief-2026-07-27.md` | 产品意图 |
| `docs/decisions/v1.3/multi-agent-orchestrator-synthesis-2026-07-27.md` | Workflow 完整 synthesis |
| `docs/audit/reviews/multi-agent-orchestrator-claude-20260727-101050.md` | Claude 全文 |
| `docs/audit/reviews/multi-agent-orchestrator-pi-2026-07-27.md` | Pi 全文 |
| `.grok/workflows/multi-agent-tab-lock-adversarial.rhai` | 可复跑对抗 workflow |
