# Independent Implementation Review — #515 worker subtask identity

**Reviewer: claude** · Scope: uncommitted diff (6 files) + `docs/superpowers/specs/2026-09-20-worker-subtask-identity.md` · No source edits made.
（注：`issue-515-dual-claude.md` 桩文件被其他进程独占锁死——append/truncate/redirect 均报 `Device or resource busy`，本评审落到此相邻文件；解锁后 `mv issue-515-dual-claude-review.md issue-515-dual-claude.md` 即可归位。）

## Claims verification

1. **Shared `filterConversationEnum`** — ✅ ThreadList.tsx:399-404, WorkspaceFrame.tsx:50-53, AtThreadPopover.tsx:38-43 all route through it; a source-grep test pins the three surfaces (tests/thread-timeline.test.ts:663-669).
2. **Hide predicate** — ✅ `shouldHideInConversationEnum` (thread-timeline.ts:432-455) implements the spec formula exactly: worker role → not searching → not active → `user_message_count ≤ 1`（缺失按 0，等价 `!(count > 1)`）→ parent 非空且在 `viewIds`。ThreadList 的 useMemo 依赖补了 `activeThreadId`，无 stale。
3. **搜索显示 worker + 归属标题** — ⚠️ 部分。ThreadList.tsx:980-984 在 `query` 非空时用 `workerBelongTitle` → `子任务 · 属于「父」` ✅。但 **AtThreadPopover 两处不达标**（见 Blocker 2/3），WorkspaceFrame 搜索态也是裸标题（spec 的「必须带归属」写在 @ 条款内，WorkspaceFrame 记 nit）。
4. **父 chip N 子任务** — ✅ ThreadList.tsx:1041-1056：`SET_ACTIVE_THREAD` + `thread.select`，再 `SET_FLEET_LIST_OPEN(true)`（action 在 agentStore.tsx:594/1811；SET_ACTIVE_THREAD 不重置 fleetListOpen，同批 dispatch 后 portal 以父线程为 scope 渲染，FleetWorkerList.tsx:41-62）。
5. **StatusRail 面包屑** — ✅ StatusRail.tsx:83-92, 245-264：父可解析才显示 `← 主任务` 按钮 + `子任务 · {worker_role_label || title}`；回退按钮用与 ThreadList.handleSelect / FleetWorkerList.enterWorker 相同的 `SET_ACTIVE_THREAD` + `thread.select` 惯用法。
6. **NEVER 清单** — ✅ [executed] 六文件 diff 内 `tabs.create` / `windows.create` / `spawn` / `forceConfirm` / L2 零匹配。`roleBadge` 文案改动（worker→子任务、orch→编排）唯一消费方是 ThreadList（grep 全仓），随测试更新。

## Attack results

- **Orphan** — ✅ parent 不在 `viewIds` → 行保留（thread-timeline.ts:450，有测试）；StatusRail 父不可解析回落纯标题；`workerBelongTitle` 无父回落 `子任务 · own`。
- **Batch select** — ✅ `selectableIds` 派生自 `filtered`（ThreadList.tsx:523-530），隐藏 worker 进不了全选，且 531-536 的 prune effect 会把已隐藏者从 `selected` 剔除——不会出现「看不见却被批量删」。⚠️ 同理：正在运行、user_message_count=1 的 worker 从列表消失，只能靠 Fleet portal 管理（符合产品句，记录在案）。
- **Count SoT** — ✅ `childWorkerCount`（thread-timeline.ts:474-481）= spec 公式逐字（raw `threads` + role + parent_thread_id，不用 Glance）。已知发散：chip 数（含 trashed/隐藏 worker）与 Fleet portal 列表（fleet.status 快照）可能不一致——spec 明示选择 threads 为 SoT，接受。
- **Spawn brief = count 1** — ✅ 端到端验证：companion-dispatch.ts:315-344 持久化 role-aware brief（SPAWN_BRIEF_FAILED 回滚路径在），expert-team.ts:370 落为第一条 `role:"user"`；`listWithPreviews`（thread-manager.ts:841）每次 thread.list 现算 `user_message_count`，非快照。新 worker=1 → 隐藏；人跟帖=2 → 复活。方向正确。

## Blockers

### B1 [executed] `npm test` 红灯 — TS2591 ×2

新 source-grep 测试用 `require("node:fs")` / `require("node:path")`（tests/thread-timeline.test.ts:665-666），而 tsconfig.test.json `types: ["chrome","react","react-dom"]` 无 node 全局；其余全部测试文件都是 `import { readFileSync } from "node:fs"`。

```
tests/thread-timeline.test.ts(665,28): error TS2591: Cannot find name 'require'.
tests/thread-timeline.test.ts(666,20): error TS2591: Cannot find name 'require'.
```

`tsc -p tsconfig.test.json` exit 2 → `test` 脚本 `&&` 链在 tsc 断掉，`node --test` 不执行——**整个 extension 套件门禁被本改动打红**。测试单独跑能绿只是因为 tsc 默认照常 emit。修复：测试文件顶部静态 `import`（仓库惯例），两行改动。错误行号即本 diff 新增行，非 HEAD 遗留。

### B2 [inspected] @ 默认池泄漏当前主任务的 worker — 谓词条件 2 用错了集合

AtThreadPopover.tsx:38-43 先 `filter(t => t.id !== excludeId && !t.trashed_at)` 再把**裁剪后的池**交给 `filterConversationEnum`，`viewIds` 由裁剪后列表构建。App.tsx:865 `excludeId={state.activeThreadId}`：

在**父线程里** @ 引用时，父被 excludeId 预剔除 → `viewIds` 不含 parent_thread_id → 条件 2（父在同类视图可解析）恒假 → 该父的全部空闲 worker **以平级身份留在默认 @ 池**（裸标题，常为 `z1p2kd`/未命名）。这正是 spec 第一句要消灭的「摊成平级聊天」，且发生在最常见的调用语境（在主任务里 @ 别的会话）。从非父线程 @ 时反而正常隐藏——泄漏方向恰好反了。修法：`viewIds` 应基于剔除前的全集（或把 `threads` 全集传给解析），约一行。

### B3 [inspected] @ 搜索命中缺归属标题 — spec MUST 未实现

spec L29「搜索式 @ 查询仍可命中，**标题必须带归属**」。AtThreadPopover.tsx:147 渲染与 :90 `onSelect` 都用裸 `displayThreadTitle`——搜索命中的 worker 插入引用时无任何「子任务 · 属于…」标记。claim 3 因此只在 ThreadList 成立。

## Nits（不阻塞）

- **N1** 回收站视图 chip 绕过 trashView 守卫：kidCount chip 在 trash view 仍可点（ThreadList.tsx:1044-1053），会把**可能已软删的父线程**激活进主聊天，绕过 handleSelect 的 `trashView`/`trashed_at` 双守卫（762-765，前轮 dual-review 产物）。建议 chip `disabled={trashView}`（与标题按钮一致）。同视图下被隐藏的 trashed worker 与 chip 计数也会对不上。
- **N2** `workerBelongTitle` 算了 `own` 又在有父分支丢弃——同一父的多个 worker 搜索态标题完全同形（`子任务 · 属于「X」` ×N），无法区分；spec 字面如此，产品上可考虑 `子任务 · {own} · 属于「X」`。且 popover 评分不搜 `worker_role_label`，按角色名搜不到。
- **N3** 搜索态 worker 行 = 标题 `子任务 · …` + badge `子任务`，同屏重复。纯外观。
- **N4** WorkspaceFrame 顺手加了 id 子串匹配（53 行 `|| (t.id).includes(query)`），spec 外的小行为增量；与 popover 既有行为对齐，良性，记录 scope。
- **N5** `require` 风格之外，测试读源码断言三面接线是字符串级 pin——可接受（仓库既有惯例），但对重命名脆弱。

## VERDICT: REJECT

B1（`npm test` 门禁红，[executed] exit 2）单独即构成 reject；B2/B3 让 @ 面在 spec 的两条明确要求（默认排除、归属标题）上都不达标，且 B2 的泄漏方向恰好命中最高频语境。核心逻辑本身是健康的：隐藏谓词、计数 SoT、spawn-brief 链路、chip/breadcrumb 接线全部验证通过——B1 两行 import、B2 一行集合修正、B3 一处 `workerBelongTitle` 换用，修完三处即可进入 APPROVE_WITH_NITS。
