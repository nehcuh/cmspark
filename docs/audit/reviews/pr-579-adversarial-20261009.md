# PR #579 多路独立对抗评审（2026-10-09）

- **对象**：`bd70a0c4`（`763fc891..bd70a0c4`，PR #579）— worker 上限 5 改占名额口径（终局释放）+ 单 run 累计创建上限 20。Refs #578。
- **方法**：4 路独立视角（占用谓词 / 并发时序 / 双上限与对外语义 / 测试覆盖与回归）并行审 diff，每条发现交独立怀疑者对抗证伪（宁可错杀不放水）。12 agents，483 次工具调用。
- **结果**：原始发现 8 条，证伪 0 条，**确认 8 条**（去重后 4 个独立问题）。多条结论带 `[executed]` 级复现（真实 ThreadManager / 编译产物 / 全量测试变异实验）。

## F1 · 回收站行的口径矛盾（3 路独立命中，最强发现）

**gate 计数含回收站行（N 与 M），但所有诊断面都看不到它们。**

- 占名额 SoT `worker-occupancy.ts:83` 用 `tm.list({include_trashed:true})`：trashed worker 占 N（终局/逾期前），且 M 永不退款（G8/G8b 钉死）。
- `list_workers`（`spawn.ts:269-273` → 裸 `tm.list()`）、fleet 快照（`fleet.ts:95`）、`wait_workers`、`search_threads` 全部排除回收站行。
- 后果（已端到端复现）：5 个 worker 被 trash 后再 spawn 被拒「5/5 occupied (trashed workers still count)」，同刻 `list_workers` 返回 `{workers:[]}`、fleet worker 行 0——「名额为何满」在产品内不可解释，模型无任何枚举/恢复工具。这直接违背本次 diff 自我声称的 m2 目标（`companion-dispatch.ts:676`「让名额为何空了/为何满了可解释」）。
- **最恶劣变体**：paused + trashed → `worker-occupancy.ts:57` paused 恒占、无时间界，trash 不清 paused（`thread-manager.ts:749-757` 只写 trashed_at）→ **名额永久占用**，只能 restore+终局、硬删或 30 天 TTL 解锁。
- 旧口径（累计 `countWorkersInRun` 用裸 `tm.list()`）gate 与可见数恒一致；本 PR 扩 gate 口径时未同步扩枚举口径，属本次引入。

## F2 · 墙钟回拨让已释放的 overdue 孤儿翻回占位（minor）

`worker-occupancy.ts:63-66` 的宽限判定 `now - Date.parse(created_at) >= idle_ttl` 用裸 `Date.now()` 逐次现算、无闩锁。时钟回拨超过 (age−120s)（NTP 步进 / 挂起恢复 / 手动改钟）时，同一 worker 在两次 gate 评估间从 overdue 翻回 not_started（占位），spawn 再次被拒直到墙钟追回；fleet `occupied` / `list_workers occupancy` 同步振荡（已 monkeypatch 复现）。讽刺点：`monotonicTimestamp()`（`thread-manager.ts:362`）自己的文档警告「别拿这时间戳做墙钟 TTL」——本 PR 恰好这么用了。旧 gate 是纯计数无时钟依赖，属本次引入。

## F3 · expert-team 拒绝文案错误归因 + 缺当前 N/M（minor）

`expert-team.ts:516-524`（及姊妹 `l2-admission.ts:1379`）把双闸合并成一条「max_workers_per_orchestrator_run reached: …」。仅预算耗尽（occupied=0、created=20，#576「收一波再派一波」第 5 波的典型态）时该断言为假——模型会去等一个永远不会变化的「占用释放」。且无当前 N/M（对照 `spawn.ts:160-179` 两条都有「N/5 … M/20」），违反 plan 文案 SSOT「两文案都必须含数字」。

## F4 · 测试缺口 ×3（major ×2 + minor）：删除新功能全绿

| 缺口 | 规格 | 实况 | 变异实验 |
|---|---|---|---|
| **G7 (major)** 生产点谓词注入 | 「dispatch / expert-team 两生产点各一条」 | 交付的 G7 直调 `spawnWorkerThread` + 手写谓词，只证明「接受谓词」；`companion-dispatch.ts:245` / `expert-team.ts:559` / `l2-admission.ts:1373` 三处注入从未在活性区分态下被测 | 删光三处注入 → 全量测试零失败 |
| **G9 (major)** 双上限 min() 预算腿 | spec 要求 N=4/M=19（预算腿 binding） | 交付的 G9 用 N=4/M=5（min(1,15)，预算腿 slack）；`remainingWorkerSlots` 全套件仅此一个调用点 | 删预算腿 → 全绿，且经真实调用链复现了 upfront 截断本要防止的「循环中途 fail 全队回滚」 |
| **G11 (minor)** list_workers occupancy 字段 | spec 明文两半：list_workers 每行 + fleet | 只交付 fleet 半；list_workers 映射（`companion-dispatch.ts:691`）无任何断言 | 删 occupancy 键 + once-captured now + isActive → 与基线失败集逐字节相同 |

同 return body 的姊妹字段（`last_run_terminal` / `last_run_ended_at`）有 #569 源码守卫先例（正是因「变异全绿」而加），occupancy 未获同款。

## 与 ibg908 实测（同日另查）的交叉印证

- ibg908「说 4 开 9」：本轮恰 4 次 spawn；9 = 本轮 4 + 上一轮残留 5（1 完成 + 4 never-ran overdue，`parent_thread_id` 仍挂父线程占 UI 计数）。F1 的「让位后行仍以某种身份存在、且各界面口径不一致」正是同族问题——本批评审把更尖锐的 paused+trashed 永久占名额边补齐了。
- ibg908 的 4 个 never-ran worker 正是靠 120s overdue 让位解锁的——F2 说明这条释放通道对时钟回拨不鲁棒。
- 另查出与本 PR 无关的真 bug：`collect_handback` fence 分支硬失败短路 prose 兜底（`board/schema.ts:300-324` + `board/service.ts:984-988` 只认 `/prose-only/i`），markdown 报告含非 JSON 代码块即三连败触发熔断。详见当日会话记录。

## 过程事故记录

验证 agent 的变异实验（删 isActive 注入 / 删预算腿 + `void usage.created` 消音）残留在工作树（3 文件 -21/+4），并行 agent 互相误判为「他人的工作」；2026-10-09 经用户确认后 `git checkout --` 恢复 HEAD。经验已入记忆：跑变异实验类评审后必须 `git status` 核对工作树。
