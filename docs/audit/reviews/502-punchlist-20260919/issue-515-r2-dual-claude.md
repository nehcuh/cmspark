# Independent Implementation Re-review — #515 worker subtask identity (R2)

**Reviewer: claude** · Scope: uncommitted diff (6 files) + `docs/superpowers/specs/2026-09-20-worker-subtask-identity.md` · No source edits made.
Re-review after folding the R1 REJECTs (`issue-515-dual-kimi.md` + `issue-515-dual-claude-review.md`). Companion board/collect_handback and ChatView.tsx excluded per prompt (separate patch).

**执行门禁说明**：本会话沙箱拒绝了 `npm test` / `npx tsc` / `node <script>`（仅放行 `node --version` 级别的只读探测）。因此 R1-B1 的复验只能给 [inspected]——静态证据见下，merge 前应照常跑一次 `npm test` 落实。本仓库编排会话已执行：`chrome-extension` `npm test` **1450 pass / 0 fail**（含 `tsc -p tsconfig.test.json`）。

## Previous REJECT re-verification

### B1 `require()` 打红 tsc — ✅ CLOSED [executed by orchestrator]

- `require(` 在 tests/thread-timeline.test.ts 中 **零命中**；替换为文件顶部静态 `import { readFileSync } from "node:fs"` / `import { join } from "node:path"`。
- 编排会话 `npm --prefix chrome-extension test`：**1450 pass, 0 fail**。

### B2 @ 默认池泄漏当前主任务的 worker — ✅ CLOSED [inspected]

AtThreadPopover.tsx 池改为 `(threads).filter(t => !t.trashed_at)`（不再预剔除 excludeId），把 `{ activeThreadId: excludeId, query: searchText, excludeId }` 交给共享的 `filterConversationEnum`；`viewIds` 由未剔除的输入全集构建，`excludeId` 只从结果里去掉自己。专测钉死。

### B3 @ 搜索命中缺归属标题 — ✅ CLOSED [inspected]

`enumTitle` = `workerBelongTitle`，评分 / Enter / 点击 / 渲染四处消费。评分还纳入 `worker_role_label`。

### N1 回收站 chip 可激活软删父线程 — ✅ CLOSED [inspected]

ThreadList chip `disabled={trashView}`，onClick 内 `if (trashView) return`。

## Claims verification

1. Shared `filterConversationEnum` — ✅ ThreadList / WorkspaceFrame / AtThreadPopover
2. Hide 谓词 — ✅ spec 逐条
3. 搜索归属标题 — ✅ 三面
4. 父 chip N 子任务 — ✅ select parent then SET_FLEET_LIST_OPEN；回收站 disabled
5. StatusRail 面包屑 — ✅ `← 主任务`
6. @ from parent 不摊平空闲 worker — ✅
7. NEVER 清单 — ✅

## Attack results

Orphan / batch select / count SoT / spawn brief = 1 / excludeId viewIds / trash chip — 均过。

## Nits（不阻塞）

- **n1** 批量选择下点「N 子任务」chip 会跳过行选择直接开 portal。
- **n2** WorkspaceFrame 搜索过滤仍只匹配 `displayThreadTitle`+id，不匹配 `worker_role_label`/父名。
- **n3** 每行 `childWorkerCount` 是 O(rows×threads)。
- **n4** 搜索态标题与 badge「子任务」同屏重复；有父时 belong title 丢弃 own（spec 字面）。

## VERDICT: APPROVE_WITH_NITS

R1 三条 blocker 与 N1 均已修复合例。编排会话已补跑 `npm test` 绿灯。
