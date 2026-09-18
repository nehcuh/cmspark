# G1-DONE — #502 D-G1 round_limit

**Worktree**: `/tmp/cmspark-502/g1` · **Branch**: `feat/502-g1-round-limit`
**Plan**: `docs/superpowers/plans/2026-09-18-502-g1-round-limit.md` · **Spec §5.3 G1** · **Blast: T2**
**Node**: 22.23.2 (`nvm use 22`) · main checkout `/Users/huchen/Projects/cmspark` untouched

## Goal (met)

`MAX_TOOL_CALL_ROUNDS=100` 触顶从「假死：loop 仍 active 却不续跑、UI 还写推进中」变成「这一段结束；已武装则排下一段，未武装则建议卡」。连续失败 / 同工具空转仍是 `circuit_breaker`，不自动续。

**100 这个数字没动。** 改的是它的**语义**：从 `circuit_breaker`（终态）拆成 `round_limit`（run 边界）。

## Commits (4, 每 Task 一个)

| commit | Task | 内容 |
|---|---|---|
| `1f6bd4bc` | 1 | `RunTerminal` 加 `round_limit`；kernel 对它不 paused-return，落 `task_loop.round_limit` 审计后走预算/资格/续跑路径 |
| `100f1c1f` | 2 | adapter 100 耗尽出口 `chat.error` 墓碑 → `chat.done` + `terminal="round_limit"` + `llm.round_limit` 日志 |
| `f74a5f52` | 3 | `deriveLoopStatusView` 收 `lastTerminal`；round_limit + active → 「这一段跑完了 N/M，接着下一段」，message-router 传 `runStats.terminal` |
| `4b320886` | 4 | worker 线程在 round_limit 下仍不续跑/不弹卡的验收守卫 |

## 改动文件

```
 companion/src/loop/loop-state.ts       | RunTerminal += "round_limit"（注释区分 breaker 语义）
 companion/src/loop/loop-kernel.ts      | 两处：breaker 分支只拦 circuit_breaker/error；unarmed 分支放行 round_limit
 companion/src/llm/adapter.ts           | 仅 while 100 耗尽出口（1 处）
 companion/src/loop/loop-status.ts      | LoopStatusArgs.lastTerminal + fallback label
 companion/src/message-router.ts        | broadcastLoopStatus(..., lastTerminal)
 companion/tests/loop-kernel.test.ts        | +5 用例（含 worker 守卫）
 companion/tests/round-limit-exit.test.ts   | 新：adapter 源码锁（5 用例）
 companion/tests/round-limit-copy.test.ts   | 新：状态行文案 + derive + 源码锁（8 用例）
```

chrome-extension **零改动**（`LoopStatusRow.tsx` 只被源码锁读取）。

## 计划里没写、但必须做的三处（发现 → 处置）

### G-1: Task 2 的字面代码会造一个空幽灵气泡（**计划有缺陷**）

计划写 `chat.done` + `finish_reason: "round_limit"`，并假设「extension 忽略未知字段即可」。**`finish_reason` 不是未知字段**：面板的 `chat.done` handler（`useWebSocket.ts:472-513`）把 `finishReason !== undefined` 当作「提交一条新 assistant 行」的 OR 条件之一。

而在这个出口：
- 上一轮的 assistant 行**已经**由 mid-loop 的 `chat.assistant` 回显提交（`adapter.ts:1515-1520`），
- 且 `chat.assistant` 会把 `streamingRef.current` 清空（`useWebSocket.ts:626`）。

⇒ 带 `finish_reason` 的 `chat.done` 会以合成 id 追加一条 **content 为空** 的 assistant 气泡。

**处置**：发 `chat.done` 但**不带** `finish_reason` / `message_id`。此时 `useWebSocket.ts:480-488` 的 ADD_MESSAGE 条件全假 → 只清 busy/processing（`SET_THREAD_BUSY busy:false` 在 `:458`，位于 thread gate 之前，任何线程都生效），不产生任何行。用户可见的诚实文案由 Task 3 的 `task_loop.status` 承载 —— 正是计划原本的设计意图。
**未走**需要改 `useWebSocket.ts`（加 `round_limit` guard）的方案：AGENT-TASK 明确只允许动 chrome-extension 的 `LoopStatusRow`（Task 3 才需要）。

### G-2: Task 1 的用例 #2 需要**第二处** kernel 改动（**计划低估**）

计划只提到把 breaker 分支收窄。但 `loop-kernel.ts:345` 的 unarmed 分支条件是 `!stats.terminal`，`"round_limit"` 是真值 ⇒ 建议卡**不会**发，Task 1 用例 #2（未武装 + round_limit → `suggestFrames.length === 1`）必红。

**处置**：改成 `(stats.terminal === null || stats.terminal === "round_limit")`。breaker 仍在排除之外，并有专门用例钉住（`circuit_breaker still does not continue`：0 nextRun + 0 suggest + 0 run_scheduled）。

### G-3: Task 3 的接线计划留了「或」

计划没定 `lastTerminal` 怎么进 derive。**处置**：`broadcastLoopStatus` 加可选第 4 参，调用点传 `runStats.terminal`。选这条是因为 `message-router.ts:1421` 的广播就在 run-finally 出口检查之后、drain 之前，`runStats` 在同一作用域；比「在 run_scheduled 广播里塞 reason」少一次协议面改动。

另：`CapabilityAuditEvent` 是开放类型（`type: string` + index signature，`packs/audit-log.ts:10-14`），故 `task_loop.round_limit` 无需改 audit 类型文件。

## 验收证据（全绿）

| 验收项 | 证据 |
|---|---|
| 武装 + 未勾 + round_limit → `peekNextRunCount === 1`，status 仍 `active` | `loop-kernel.test.ts` #17 `ok` |
| 未武装 + round_limit → 0 next run + suggest 卡 | `loop-kernel.test.ts` #18 `ok` |
| same-tool 3 次 / API 5 次 → 仍 `circuit_breaker`，0 next run | 源码锁 `round-limit-exit.test.ts` #4「恰好 2 处 `circuit_breaker`、1 处 `round_limit`」+ `loop-kernel.test.ts` #16/#21 |
| 用户再也看不到「达到最大工具调用轮次 (100)，已暂停。」 | 全仓 sweep：`companion/src` 与 `chrome-extension/src` **0 命中**（仅两份测试以负断言引用该串）；状态行两份文案源同样 0 命中（`round-limit-copy.test.ts` #8） |
| worker 线程行为不变 | `loop-kernel.test.ts` #20（0 nextRun / 0 suggest / 0 audit）+ 既有 #26 |
| 其余终态不误伤 | `round-limit-copy.test.ts` #3（circuit_breaker/error/aborted/security_halt 都不拿换段文案）、#2（正常收口仍「推进中 1/2」） |
| 阻断优先于换段注记 | `round-limit-copy.test.ts` #4–#7（确认中 / 换路中 / 受阻 / 已完成 各自压过 round_limit） |

**测试总量**

```
companion 全量:  5112 tests, 5088 pass, 0 fail, 24 skipped  (+ settings-web 20/20)
chrome-extension: 1339 tests, 1339 pass, 0 fail
companion tsc --noEmit: exit 0
```

## NEVER 遵守情况

| NEVER | 状态 |
|---|---|
| 删 100 这个数字 | ✅ 未动（`MAX_TOOL_CALL_ROUNDS = 100` 原样） |
| 完整 `goal_state` 对象 | ✅ 未引入（只加了 RunTerminal 的一个枚举值） |
| worker arm loop | ✅ `onLoopRunFinished` 第 295 行的 worker 早退未动，并加了 round_limit 专项守卫 |
| cruise 跳 L2 | ✅ 未触碰确认代数 / tier 绑定 |
| 把 same-tool / 5-failure 也改成自动续 | ✅ 两处仍 `circuit_breaker`，源码锁钉死数量 |
| 改 main checkout | ✅ 只动 `/tmp/cmspark-502/g1` |

## 已知残留（不在本 PR，供后续 ticket）

1. **面板重开的 backfill 文案**：`LoopStatusRow.tsx` 的 `BACKFILL_LABEL` 对 `status==="active"` 仍写「续跑推进中」（无 `lastTerminal` 可用）。G1 后这**不再必然是谎**（armed 时下一段真的会跑），但 `circuit_breaker` 后的 active 仍是假死 —— 那是 G2（aborted/breaker 状态转移）的范围，本 PR 明确「`circuit_breaker` 行为不变」。
2. **下一段真正 start 后 label 不会自动回「推进中」**：`task_loop.status` 只在 run 结束时广播。计划 Task 3 只要求「不得仍是推进中」，已满足；若要更精确需在 run 开始处加一次广播（新协议面）。
3. `runs_used` 只统计 loop 自排的续跑（人类触发的 run 不计），且「继续」会重置 per-run 熔断预算 —— 见主仓调研 `.tmp/design-2026-09-18/out-pi.md` §G3，属独立 ticket。
