GitHub: #578

# Deep-Interview Spec — 578-worker-cap

## Metadata

- Issue: nehcuh/cmspark#578
- Profile: standard (threshold 0.20) · Rounds: 3 · Final ambiguity: 0.085 · Type: brownfield
- Context snapshot: `.omx/context/578-worker-cap-20261007T234537Z.md`
- Transcript: `.omx/interviews/578-worker-cap-20261007T235116Z.md`
- omx CLI 不可用：状态以 `.omx/` 工件为 SSOT（本机无 CLI 写者，无第二写者问题）

## Clarity Breakdown

| 维度 | 分 | 依据 |
|---|---|---|
| intent | 0.95 | 票 #578「为什么要有这张票」+ #576 落地后的分波用法 |
| outcome | 0.90 | 票「用户能看见的完成」+ 本访谈 D1 收紧 |
| scope | 0.95 | 本访谈 D2/D3 定界（对冲包含；孤儿逾期让位） |
| constraints | 0.85 | T1 blast；run id 语义不变；其他 caps 不动 |
| success | 0.85 | 票完成判定 + 本 spec 验收标准 |
| context | 0.95 | 代码事实全部 [from-code] 钉死（见下） |

## Intent

ADR-015 §3.5 的 `max_workers_per_orchestrator_run = 5` 在实现里是累计口径（`countWorkersInRun` 数全量线程 + run id 永不重置），父线程一生只能 spawn 5 个 worker。#576「收一波再派一波」的监督用法落地后必然撞墙。

## Desired Outcome

5 个名额按「同时占用的 worker」计；跑完的让位；撞限时报错可读（占名额 N/5 + 累计创建 M/上限）；舰队计数口径与 spawn 判定一致。

## 决策记录（本访谈产出）

- **D1 释放口径 = 终局释放** [from-user]：worker 让位 ⟺ `last_run_ended_at` 已设（正常收工 terminal=null，或被处死 terminal 非 null）。**`paused` 恒占名额**（无论 ended_at）。在跑、从未跑的占名额。
- **D2 孤儿兜底 = 逾期让位** [from-user]：「从未跑过」且创建超过 `ORCHESTRATOR_CAPS.idle_ttl_ms`（120s）的 worker，spawn 计数视为已让位（**只改计数口径，不改线程字段、不新机制**）。跑过但未终局的不适用逾期让位。
- **D3 对冲上限 = 本票包含** [from-user]：新增单 run 累计创建上限常量（spec 值 20，实现评审可调）；达到后 spawn 拒绝，文案含累计 M/20，并引导人工决策（ask_user / 确认台通道，具体 ralplan 定）。

## In-Scope

- `countWorkersInRun` → 占名额判定：`ended_at 未设 && !逾期未跑` ∪ `paused`（以 ralplan 核实 pause/ended_at 字段语义后定实现式）
- 新常量 `max_workers_created_per_run`（≈20）+ 累计创建计数 + 拒绝文案
- spawn 拒绝文案：`worker slots N/5 in use (M/20 created this run)`
- `list_workers` / 舰队条活跃计数与占名额判定同源
- ADR-015 §3.5 口径补记（「单次编排最多 5 个 worker」→ 明确为占用口径；已在票规格锚点 opt-in）
- 单测：终局释放 / paused 占 / 从未跑占 / 逾期让位 / 累计上限 / 文案断言

## Out-of-Scope / Non-goals（票 NEVER + 访谈确认）

- worker 权限扩展（shell/host/netsec/ACP）；自动批准/派发/重试
- 改 `max_concurrent_multi_agent_llm_loops`、lease TTL 等其他 caps
- run id 换新（方案 B）——确认弹窗/审计/HMAC 的 `orchestrator_run_id` 语义不动
- overlay Allow/Deny、第二只 Chrome 扩展、`ws_secret` 当 MCP grant
- 把「删 worker 线程」写进用户文档当正式路径

## Decision Boundaries（实现者可自决，无需再确认）

- 占名额谓词的实现式（字段读法、谓词放 spawn.ts 还是独立 helper）与测试形状
- 拒绝文案的具体措辞（须含 N/5 与 M/20）
- 舰队计数同源化的最小改动面（复用同一谓词即可，不要求 UI 改版）
- 上限常量 20 的微调（15–25 区间）

## Constraints

- T1 blast（票内 eval gate）：不动工具面/授权/信任边界
- 既有 5418 companion 测试 + 1507 extension 测试不回归
- 復用既有 SoT：#569 四态字段、`ORCHESTRATOR_CAPS.idle_ttl_ms`；不引入第三套活跃判定

## Testable Acceptance Criteria

1. 5 worker 全部正常收工 → 第 6 次 spawn 成功
2. 被 circuit_breaker 处死的 worker 不占名额
3. 在跑 / 暂停 / 从未跑（<120s）各占名额（spawn 拒绝）
4. 从未跑超 120s → 不占（spawn 成功）
5. 单 run 累计创建达上限 → 拒绝且文案含 M/20；人工通道可继续
6. loop gate 并发 cap 回归不变
7. 全量测试绿 + build 干净

## Pressure-pass / Scenario Findings

- Round 2 以「重启丢 kick / 批准窗口悬置 → worker 永远从未跑过」压测 Round 1 的隐藏假设，发现 [from-code]：`never_ran` 孤儿在 #576 监督代码中无任何处理（fleet-supervision ledger 只记录不改终局）→ 产出 D2。

## Brownfield Evidence

- [from-code][auto-confirmed] spawn gate `spawn.ts:60/:151`；唯一 run-id 清空点 `:195`（回滚）
- [from-code][auto-confirmed] `buildIsThreadLlmActive`（`companion-dispatch.ts:141`）三源并集——loop cap 与 collect_handback 在用；本票**不**采用它做占名额判定（D1 选终局口径），但舰活跃计数同源化时不得与之矛盾
- [from-code][auto-confirmed] `list_workers`（`companion-dispatch.ts:667`）已暴露 `paused`/`last_run_terminal`/`last_run_ended_at`
- [from-code] tm.list() 默认排除回收站（`thread-manager.ts:816`）——现状唯一解锁路径，改后不再是依赖

## Docs/Terminology Ledger

- ADR-015 §3.5 数值表：`max_workers_per_orchestrator_run | 5 | 单次编排最多 5 个 worker`——需补记「占用口径」；实现 PR 内一并改
- 术语锁定：让位（不占名额）/ 终局（ended_at 已设）/ 累计创建（M）——沿用 #569 词表，不造新词

## Durable Doc Recommendations（opt-in）

- ADR-015 §3.5 补记（已 opt-in，随 PR）
- 用户指南多智能体章节补一句名额语义——**尚未 opt-in**，PR 里作为建议提出

## Assumptions & Resolutions

- 票原句「已结束（完成/停止/已收集）」模糊 → D1 收紧为字段化终局判定（「已收集」不是条件）
- 票假设孤儿场景可忽略 → 压测证伪（批准窗口/重启丢 kick）→ D2 兜底
