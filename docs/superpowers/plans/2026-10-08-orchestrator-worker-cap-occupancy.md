GitHub: #578

# Plan — worker 占名额口径（终局释放）

PRD（RALPLAN-DR / 决策记录 / 消费者清单 / 步骤）与 test-spec（T/G/R 矩阵）经 Architect PROCEED_WITH_CHANGES → Critic APPROVE 共识；评审证据见 PR 描述。

## PRD

# PRD — #578 worker 占名额口径（终局释放）

GitHub: #578 · 需求源: `.omx/specs/deep-interview-578-worker-cap.md` · 决策记录: 票评论 6050155787
类型: T1 companion 内记账口径修正 · blast 不动工具面/授权/信任

## RALPLAN-DR Summary

- **Principles**：①占名额判定单一谓词 SoT，不造第三套活跃判定；②谓词纯函数可注入 now/activeSet，计数口径可测；③治理闸只收紧不放松——终局才释放、暂停恒占、删除不退款；④复用 #569 四态词表与 `idle_ttl_ms` 既有常量；⑤T1 blast：不动工具面/授权/信任/run id 语义。
- **Decision Drivers**：①#576「收一波再派一波」使累计口径必然撞墙；②`orchestrator_run_id` 进确认弹窗/审计/HMAC，不可换新；③5118+1507 既有测试是安全网，实现必须最小面。
- **Viable Options**：
  - **A（选定）**：占用口径谓词（终局释放 + 暂停恒占 + in-flight 占 + 新鲜未跑占 + 逾期让位）+ 累计创建上限 20。pro：语义与 loop cap 一致、产品句实现、最小面。con：谓词有 5 个输入态，测试面最大。
  - **B（否决）**：每批换新 run id。con：`orchestrator_run_id` 在确认弹窗细节/审计/board actor 有消费者，换新连锁语义难讲清。
  - **C（否决）**：数值 5→10。con：口径不修，撞墙推迟而非消除；票明令禁止假装修好。
- 选项唯一化的失效理由如上；A 的 con（测试面）由 test-spec T1–T9 显式覆盖。

## 问题

`countWorkersInRun`（`spawn.ts:60`）按全量线程计数 + run id 永不重置 → 父线程一生只能 spawn 5 个 worker（`spawn.ts:151`）。#576 监督「收一波再派一波」用法必然撞墙，报错裸文案，唯一解锁是删线程（依赖 `tm.list()` 排除回收站的意外行为）。

## 占名额谓词（单一 SoT，全仓复用）

```
occupied(w, now, isActive) =
    w.paused                                            // 暂停恒占（D1）
 ∨ isActive(w.id)                                       // 三源并集：abort map ∪ loop-gate holders ∪ 排队 kick
 ∨ (w.last_run_ended_at 未设 ∧ (created_at 不可解析 ∨ now − created_at < idle_ttl))   // 新鲜未跑（D2 边界内）
released(w) = ¬occupied(w)
```

- **D1 终局释放**：`ended_at` 已设 ∧ ¬paused ∧ ¬isActive → 让位（正常收工 terminal=null / 被处死 terminal 非 null，一视同仁）
- **D2 逾期让位**：从未跑过（`ended_at` 未设）且 `created_at` 距今 ≥ `ORCHESTRATOR_CAPS.idle_ttl_ms`（120s，复用既有常量）→ 让位。**只改计数口径，不改线程字段**
- **fail-closed（Architect M2）**：`created_at` 缺失/不可解析（NaN）→ 视为新鲜、**占名额**（原则③只收紧；保 `spawn-rollback-demote.test.ts:134/:172` 两测试不破）
- **正确性要求（planner 提出，Architect m1 已核实）**：`ended_at` 由 `llm/adapter.ts:2810-2815` 在 run 结束的 finally 覆盖写（epoch 守卫只防被取代的旧 run 覆盖，不防新 run 在跑）——worker 被 re-kick 跑第二轮时 `ended_at` 仍是上一轮旧值，纯字段判定会误判让位。`fleet-supervision.ts:62`、`cooperation-state.ts:45` 两个既有消费者都是 isActive-first，谓词必须一致。

## 实现形状（Architect 裁决定稿：B′）

- 新 helper `companion/src/orchestrator/worker-occupancy.ts`：**纯函数、零运行时依赖**（只 import `type ThreadManager` 与 `ORCHESTRATOR_CAPS`），一次 `tm.list({include_trashed:true})` 扫描同时导出 N 与 M
  - `occupiedWorkerCount(tm, runId, {now, isActive})` → N（**含 trashed 行**：trash 不结束 run、不清 paused、可 restore，trash 不应释放占用）
  - `createdWorkerCount(tm, runId)` → M（含 trashed；**删除不退款**——但 30 天 `purgeExpiredTrash` / 手动 `cleanup_empty` 后 M 自然衰减，属预期，ADR 写明防后人当 bug 修；#292 pack/intent 失败回滚硬删不计数，与「spawn 从未发生」哲学一致，ADR 同步写明）
  - `workerOccupancyStatus(w, {now, isActive})` → paused > not_started/overdue > running > completed/terminal（与 `fleet-supervision.ts:73` 同族；overdue 是新区分）
- **gate 同步、谓词注入（B′）**：`spawnWorkerThread` 签名不变，新增可选 `isActive?: (id) => boolean`；两个生产调用点必须注入——dispatch（`companion-dispatch.ts:234`，本地已有 `buildIsThreadLlmActive` :141）、expert-team（`expert-team.ts:525`，加 lazy dynamic import，先例 `adapter.ts:1701`）。与 `collect_handback` 的 `isThreadLlmActive` 参数下传（`companion-dispatch.ts:751→759`）同一注入缝。**禁静态导入 message-router**（`spawn → worker-occupancy → message-router → llm-loop-gate → spawn` 是已核实的加载期环，`message-router.ts:192-193`/`fleet.ts:68-70`/`companion-dispatch.ts:141-143` 三处防环先例）；形状 C（纯字段）否决；形状 B（gate 全 async，~15 处调用点涟漪）为架构等价备选，不选。
- **注入缺省退化只在 advisory 路径可接受**（l2-admission 确认卡、`remainingWorkerSlots` 截断）——执行闸永远持有完整谓词，advice 错了 gate 会纠正（fail-open 后果有界：loop cap 5 封顶同时跑、M=20 封顶总量）。

## 累计创建上限（D3 对冲）

- 新常量 `ORCHESTRATOR_CAPS.max_workers_created_per_run = 20`
- 累计 M = 该 run 创建过的**全部** worker 数，`tm.list({ include_trashed: true })` 过滤 run id——**删除/回收站不退款**（防失控语义）
- gate 顺序（都在 `userConfirmed` / parent 检查之后）：占名额 N → 累计 M，两 gate 独立，均过才创建

## 消费者清单（Architect M1，逐一处置）

| 消费点 | 处置 |
|---|---|
| spawn gate（`spawn.ts:151`） | 改用 helper，注入完整谓词（执行闸，必须完整） |
| `expert-team.ts:267-273 remainingWorkerSlots` → `:492-500` 团队截断、`l2-admission.ts:1365-1374` 确认卡 | advisory 口径：改用 helper，且 expert-team 注入点把已获取的 `isActive` 顺手传入（Critic 建议：截断与执行闸持同一完整谓词）；截断改为 **upfront `min(5−N, 20−M)`**——防止预算不足时循环内 spawn 失败触发 `fail()` **全队回滚**（Architect 张力 5） |
| `expert-team.ts:602 parentRoleSnapshot.worker_count` | **保持库存口径**（全部创建过的 worker 数），不得静默继承占用数 |
| `list_workers`（`companion-dispatch.ts:667`） | 每个 worker 透出 occupancy status（m2：让「名额为何空了」可解释） |
| fleet snapshot（`fleet.ts:96-135`） | **新增 `occupied` 字段/计数**；**不动 `llm_active` 语义**（`fleet.ts:123` 只含 abort map 的现状保留，重定义会偷换 UI 芯片语义；fleet→llm-loop-gate 静态导入无回边成环，m5） |

## 文案（唯一 SSOT，含 Architect m7 逃生口）

占名额拒绝：`worker slots full: N/5 occupied (paused/running/pending), M/20 created this run (trashed workers still count)`
累计拒绝：`worker creation cap reached: M/20 created this run — finished workers free slots but not the creation budget; start a new thread for a fresh run, or hard-delete workers (trash does not refund the budget)`
（英文，与现有 tool error 一致；两文案都必须含数字。括注为人类措辞，与 T9 状态枚举映射：running=有 isActive、paused=paused、pending or overdue=not_started/overdue）
catalog：`tool-definitions-catalog.json:997` spawn_worker 描述（"Max 5 workers per run."）与 `:1105` spawn_expert_team "Total workers ≤5." 一并修正为新口径表述（:1209 list_workers 无名额口径，不动）。

## 不做（NEVER，票 + 访谈锁定）

worker 权限扩展；自动派发/重试；改其他 caps；run id 换新（方案 B 否决：确认弹窗/审计/HMAC 连锁）；只调数值不改口径（否决：撞墙只是推迟）；「删线程」写进文档当路径。

## 步骤（自适应，含 Architect 修订）

1. `worker-occupancy.ts` helper（纯函数、单次扫描导出 N/M、fail-closed created_at）+ 单测（五态 × 边界：119s/121s、paused、re-kick in-flight、trashed 不退款、created_at NaN 占名额）
2. spawn gate 接线：占名额 + 累计 + 文案；dispatch / expert-team 两生产点注入 `isActive`；**expert-team upfront 截断 `min(5−N, 20−M)`** 防全队回滚
3. 消费者同源化：`list_workers` 透出 occupancy status；fleet 加 `occupied`（不动 `llm_active`）；`parentRoleSnapshot.worker_count` 保持库存口径
4. caps 常量 `max_workers_created_per_run = 20` + ADR-015 §3.5 补记（占用口径、M 衰减与回滚不计数、`idle_ttl_ms` 与租约释放双用途耦合）+ catalog 描述修正（`spawn_worker` :997、`spawn_expert_team` :1105）
5. 全量测试（5418 companion）+ `npm run build` 干净

## 验收标准 → test-spec 映射

见 `.omx/plans/test-spec-578-worker-cap.md`（1:1 覆盖票内 7 条验收 + planner 新增 re-kick/退款边界）。

## Test Spec

# Test Spec — #578 worker 占名额口径

GitHub: #578 · PRD: `.omx/plans/prd-578-worker-cap.md`
框架：companion 现有 vitest 套件；helper 单测放 `companion/tests/worker-occupancy.test.ts`，gate 集成测扩展既有 `spawn-rollback-demote.test.ts` 同族（或新 `worker-cap-gate.test.ts`）。

## 单元：worker-occupancy helper（纯函数，注入 now/activeSet）

| # | 场景 | 期望 |
|---|---|---|
| T1 | 5 worker 全部正常收工（ended_at 设、terminal=null、非 paused、非 active） | occupied=0，第 6 次 spawn 放行（票验收 1） |
| T2 | 被 circuit_breaker 处死（terminal 非 null、ended_at 设） | 不占（票验收 2） |
| T3 | 在跑（三源任一含其 id；ended_at 为旧值或未设） | 占（票验收 3；**re-kick in-flight**：ended_at 是上一轮旧值仍占） |
| T4 | paused=true（无论 ended_at 是否已设、无论 active） | 占（D1 暂停恒占） |
| T5 | 从未跑（ended_at 未设）且 created_at 距 now 119s | 占（D2 边界内） |
| T5b | 从未跑且 created_at 缺失 / 不可解析（NaN） | **占**（fail-closed，Architect M2；保 spawn-rollback-demote 既有断言不破） |
| T6 | 从未跑且 created_at 距 now 121s | 让位（D2 逾期；票验收 4） |
| T7 | aborted/error/round_limit 终局的 worker（非 active 非 paused） | 让位（终局一视同仁，不区分成败） |
| T8 | createdWorkerCount：3 活 + 2 trashed | M=5（**删除不退款**） |
| T9 | workerOccupancyStatus 状态优先级 | paused > not_started/overdue > running > completed/terminal，与 fleet-supervision.ts:73 同族不矛盾 |

## 集成：spawn gate

| # | 场景 | 期望 |
|---|---|---|
| G1 | 占名额满（5 占）+ spawn | 拒绝，error 含 `N/5` 与 `M/20` 两个数字（票验收 5 文案断言）；保留 `max_workers` 稳定词元（保 :134/:172 既有断言与日志匹配） |
| G2 | 名额有空 + 累计 M=20 | 拒绝，error 含 `M/20` 与 trash 不退款逃生口提示（累计独立 gate） |
| G3 | 名额有空 + M=19 | 放行，新 worker 计入 M |
| G4 | 逾期孤儿让位后 spawn | 放行（不要求删线程） |
| G5 | userConfirmed=false / parent=worker 既有拒绝路径 | 不回归（顺序在占名额 gate 之前） |
| G6 | run id 不变（成功 spawn 后 parent.orchestrator_run_id 稳定） | 不回归（方案 B 禁区） |
| G7 | **gate 消费注入谓词**（Architect 必改 4）：dispatch / expert-team 两生产点各一条——注入的 isActive 把某 ended_at 已设的 worker 判活 | 该 worker 计占，spawn 拒绝（证明执行闸持有完整谓词，非纯字段退化） |
| G8 | trashed worker 计入 N 与 M（**前提：被 trash 的 worker 处于 occupied 态——running / paused / 新鲜未跑**；已终局收工的 trash 后本就不占，勿用其构造用例） | trash 后立即 spawn：N/M 均含该 trashed 行（m3：trash 不释放占用、不退预算） |
| G9 | expert-team 截断（Architect M1/张力 5）：N=4、M=19，请求 5 人队 | upfront 截断为 min(5−4, 20−19)=1 人，成功创建 1 worker；**不发生**循环中途失败全队回滚 |
| G10 | `parentRoleSnapshot.worker_count` 保持库存口径 | 占用口径上线后该字段仍数全部创建过的 worker（M1 处置断言） |
| G11 | `list_workers` 每行含 occupancy status；fleet snapshot 含 `occupied` 且 `llm_active` 语义不变 | m2/m5 断言 |

## 回归

| # | 场景 | 期望 |
|---|---|---|
| R1 | multi-agent loop gate 并发 cap（≤5 同时跑） | 既有测试全绿（票验收 6） |
| R2 | collect_handback WORKER_STILL_RUNNING 谓词 | 不改其语义；若复用 helper 需逐源单测仍绿 |
| R3 | 全量 `npm --prefix companion test` + `npm run build` | 全绿 + 干净（票验收 7） |

## 覆盖矩阵（票验收 ↔ 测试）

票 1→T1+G4 · 票 2→T2 · 票 3→T3/T4/T5 · 票 4→T6+G4 · 票 5→G1/G2 · 票 6→R1 · 票 7→R3 · planner 增补→T3(re-kick)/T8(退款)/T9(同源) · Architect 修订→T5b(fail-closed)/G7(注入消费)/G8(trash 占用)/G9(截断防回滚)/G10(库存口径)/G11(同源字段)
