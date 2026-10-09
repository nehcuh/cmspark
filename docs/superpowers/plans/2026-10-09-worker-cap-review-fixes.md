# 修复计划：PR #579 对抗评审 F1–F4（worker 占名额口径收尾）

- **日期**：2026-10-09
- **依据**：[docs/audit/reviews/pr-579-adversarial-20261009.md](../../audit/reviews/pr-579-adversarial-20261009.md)（12-agent 多路对抗评审，8 发现 0 证伪）
- **关联**：#578 / PR #579（`bd70a0c4`）；性质全部为**既有行为 bugfix**（Issue-first 豁免，见 CONTRIBUTING）
- **范围**：companion；不动 extension 行为（fleet 新增字段为 additive payload）

## F1 · 回收站占位行可见性（评审 3 路独立命中）

**缺陷**：占名额 SoT `runWorkers` 用 `tm.list({include_trashed:true})`（N、M 均含 trashed），但 `list_workers` / fleet / `wait_workers` 行集全部裸 `tm.list()` 排除回收站——gate 报 5/5 时诊断面 0 行，「名额为何满」不可解释；paused+trashed 变体名额永久占用且不可见。

**修法**：
1. `spawn.ts` `listWorkers(tm, runId, opts?: {includeTrashed?: boolean})`——默认不变（`wait_workers`、message-router 两处调用方行为不变）；仅 `list_workers` dispatch 案传 `includeTrashed: true`。
2. `list_workers` 每行新增 `trashed: !!w.trashed_at`（additive）；occupancy 照算（SoT 含 trashed，口径天然一致）。
3. `fleet.ts` 快照新增 `trashed_occupied_count`（trashed ∧ worker ∧ workerOccupiesSlot）；`worker_count` 保持库存口径不变（G10 钉死）。

**测试**：G8c——5 个新鲜 worker 全 trash → `list_workers` 返回 5 行（`trashed:true`、`occupancy:"not_started"`）与 gate 5/5 可对账；G11 扩展——trash 一个占用中 worker → fleet `trashed_occupied_count===1` 且该行不在 workers 视图。

## F2 · overdue 判定抗墙钟回拨（评审 F2，minor）

**缺陷**：`worker-occupancy.ts:65` 裸 `Date.now()` vs 固定 `created_at`，回拨 >（age−120s）时已释放孤儿翻回占位，gate/fleet/list_workers 同步振荡。

**修法**：模块内墙钟高水位钳制——缺省（生产）路径 `now = max(Date.now(), highWater)` 并推进 highWater；**注入 `opts.now` 的路径不读不写**（保测试确定性）。导出 `__resetOccupancyClockForTests` 供测试隔离。残留风险（跨重启回拨）记注释。`list_workers` dispatch 案随之去掉 once-captured `now` 注入，让模块统一持钟。

**测试**：monkeypatch `Date.now`：T+130s 判 overdue/不占 → 回拨 10 分钟仍 overdue/不占（无钳制时翻回 not_started/占）→ 恢复真实时钟。前后 `__resetOccupancyClockForTests()`。

## F3 · 双闸拒绝文案错误归因（评审 F3，minor）

**缺陷**：`expert-team.ts:516-524` 与 `l2-admission.ts` 姊妹文案在「仅预算耗尽」（occupied=0、created=20）时硬断言 `max_workers_per_orchestrator_run reached`，且无当前 N/M，违反 plan SSOT「文案必须含数字」。

**修法**：`expert-team.ts` 导出 `workerCapExhaustionMessage(usage)`（三态归因：双闸/仅名额/仅预算，均带 `${occupied}/5 occupied, ${created}/20 created this run`；仅预算态附「new thread / hard-delete」出路——与 spawn.ts 预算文案同款）；`spawnExpertTeam` 的 slots<=0 拒绝与 `l2-admission.ts` 确认卡拒绝都改用它。`spawn.ts` 两条文案**一字不动**（G1/G2 断言钉死）。

**测试**：仅预算态（occupied=0、created=20）→ 文案含 `creation budget exhausted` 且**不含** `slots full`；仅名额态 → `slots full: 5/5`；双闸态 → `both exhausted`。

## F4 · 测试缺口（评审 G7/G9 major + G11 minor）

| 项 | 缺口 | 补法 |
|---|---|---|
| G7 | 三处生产点 isActive 注入零覆盖（删光全绿） | 新文件 `worker-cap-observability.test.ts`（bindCompanionDispatchRuntime + 真实 `executeCompanionTool` + `tryAcquireMultiAgentLlmLoop` 占坑）：dispatch 生产点——4 新鲜 + 1 终局但 loop-gate 持坑 → `spawn_worker` 拒 5/5；expert-team 生产点——同态 → `spawn_expert_team` 拒且文案含 N/M |
| G9 | `remainingWorkerSlots` 预算腿从未 binding（现有 G9 两腿同值 1） | G9b：occupied=0、created=19 → slots=**1**（若删预算腿则得 5，测试必红）；G9c：M=19 时 3 人队 upfront 截断为 1 且**无全队回滚**（经真实 `spawn_expert_team` 路径） |
| G11 | `list_workers` occupancy 字段零断言 | T2 行级行为断言（not_started/completed/终局字段同现）+ 扩展 `run-terminal-persist-569` 源码守卫（occupancy/trashed 出现计数） |

## 验证与收尾

1. `node ./node_modules/typescript/bin/tsc -p tsconfig.test.json`（rc=0）+ tsc build rc=0（node 直调防管道掩盖退出码，PATH 注入 `/c/nvm4w/nodejs`）。
2. 新增/相关测试全绿；companion 全量跑一遍，失败集与既存 Windows 环境失败（mac 专属）分桶，worker-cap/expert-team/fleet/dispatch 相关必须零失败。
3. CHANGELOG `[Unreleased]` 补 4 条；catalog `list_workers` 描述补 trashed 透出；ADR-015 §3.5 若载有 idle_ttl 语义则补一句单调钳制。
4. conventional commit → push → PR（正文引用评审报告）→ **多路复审 workflow** → 修复 → CI 绿 → merge main（merge commit）→ 本机换装。

## 非目标

- extension UI 展示 trashed 占位（另票）；
- `wait_workers` / `parentRoleSnapshot`（库存口径，PR #579 已定）不改；
- ibg908 派生的 `collect_handback` fence 短路 bug 与「残留 worker UI 计数」——独立票跟踪，不混入本 PR。
