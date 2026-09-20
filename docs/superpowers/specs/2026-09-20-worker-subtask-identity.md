# 子任务身份：最近对话不把 worker 摊成平级聊天

GitHub: #515
Parent: #502 E
Date: 2026-09-20
Status: LOCKED（实现 r2 dual AWN：kimi + claude）

## 产品句

子任务是主对话下面的执行切片，不是新开的一摞平级对话。

## 调词（共享）

`isFleetWorkerThread(t)` ≡ `t.agent_role === "worker"`

`shouldHideInConversationEnum(t, ctx)` 为真当且仅当：

1. `isFleetWorkerThread(t)`
2. 且父 `parent_thread_id` 能在 **同一视图** 的 thread 集合里解析到
3. 且 `t.id !== ctx.activeThreadId`
4. 且 `!(user_message_count > 1)`（spawn brief 是第一条 user；>1 才是人在子任务里说过话）

无 query：隐藏满足上式的行。有 query：不隐藏（搜索可见）。

计数 SoT：`threads.filter(w => w.parent_thread_id === parent.id && isFleetWorkerThread(w)).length`。不用 Glance 快照。

## 三面同调

ThreadList 活列表、WorkspaceFrame 最近对话、AtThreadPopover 默认池都走同一调词。**回收站不走此调词**（恢复/销毁面，父子都列出）。图谱 / 相关 / 检索只纳主对话（含 orchestrator 父），不把 worker 当平级节点（#517）。@ 引用默认排除隐藏的 worker（搜索式 @ 查询仍可命中，标题 `子任务 · {own} · 属于「父」`，无父则 `子任务 · {own}`）。搜索态 ThreadList 不再叠 roleBadge「子任务」。

`filterConversationEnum` 的 `viewIds` 必须来自**未剔除当前会话**的集合。`excludeId`（@ 当前线程）只从**结果**去掉自己，不得先从输入里拿掉父行——否则条件 2 恒假，主任务里 @ 会把该父的空闲 worker 摊回默认池。

## 面包屑

`agent_role === "worker"` 且父可解析：StatusRail 标题区 `← 主任务` + `子任务 · {worker_role_label || 短标题}`。

「N 子任务」chip：先 `thread.select` 父线程，再开已有 Fleet portal。回收站与批量选择该 chip `disabled`（不得激活已软删父线程，也不得跳出 selectMode）。

## NEVER

新 Tab、Observatory、overlay 确认、改 spawn/L2/arm、stdout_tail。
