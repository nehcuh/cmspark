# 502 G1 round_limit — Kimi 对抗复审

> 日期：2026-09-18 · 评审人：Kimi（READ-ONLY，未改任何文件）
> 对象：worktree `/tmp/cmspark-502/g1`，diff `1d8c35d6..9af4fde0`（5 commits：kernel → adapter 出口 → 状态文案 → worker 验收测试 → G1-DONE 报告）
> 方法：两路独立对抗子代理（CORRECTNESS / SPEC-CONFORMANCE，互不引用结论）+ 仲裁人亲证关键主张
> 总 verdict：**APPROVE-WITH-NITS**（两路一致；无 BLOCK / MAJOR）

## brief 红线复核（仲裁人亲证）

| 红线 | 结论 | 亲证 |
|---|---|---|
| 100 是否被误删 | **HELD** | `adapter.ts:238` `MAX_TOOL_CALL_ROUNDS = 100` 原样，while cap 未动 |
| same-tool 是否被改成自动续 | **HELD** | `circuit_breaker` 全仓恰剩 2 处：`adapter.ts:2063`（same-tool）、`:2316`（连续 API 失败），diff 未触碰；kernel `loop-kernel.ts:341-353` breaker 分支仍 paused-return |
| L2 确认是否被折叠 | **N/A（未触碰）** | diff 不含确认/tier/l2-admission 代码；cruise 跳 L2 无从发生 |
| overlay 是否被碰 | **HELD** | diff 仅 5 文件（loop-state/loop-kernel/adapter + 2 测试），overlay 零 diff |

附加亲证：墓碑串「达到最大工具调用轮次」在 `companion/src` + `chrome-extension/src` **0 命中**；worker 早退 `loop-kernel.ts:145/295` 原样。

## 两路独立结论

**CORRECTNESS（APPROVE-WITH-NITS）**：round_limit 路径记账完整（token/预算/runs_used 全走正常路径，`loop-kernel.ts:386-407,559`），续跑受 `maxRuns=20`+墙钟+token 三重兜底，drain 处二次查预算——无 100×N 失控。`runStats.terminal` 时序无竞争（router 持对象引用，adapter 在 `adapter.ts:2349` 同步赋值早于 router `:1426` 读取）。「不带 finish_reason 防幽灵气泡」的 commit 主张经 extension 源码核实为真（`useWebSocket.ts:480-488` ADD_MESSAGE 条件、`:626` streamingRef 清空）。测试 44/44 通过。

**SPEC-CONFORMANCE（APPROVE-WITH-NITS）**：四条 plan NEVER 全 HELD。Task 3（诚实文案）已在 diff 内（`f74a5f52`）——armed+active 显示「这一段跑完了 N/M，接着下一段」（`loop-status.ts:161-171`），优先级正确（stopped_budget/completed/halt 等均先于换段文案返回），规格 §216 文案禁令已满足，**不存在裸奔窗口**。新审计 type `task_loop.round_limit` 对唯一消费者 `expert-panel.ts:79` 安全（白名单式过滤，未知 type 跳过）。

## 残余 NIT（均不阻塞，建议进 G2/后续票）

1. **面板重开 backfill**：`LoopStatusRow.tsx:31-32` 对 `status==="active"` 无 `lastTerminal` 可用，仍写「续跑推进中」——G1 后不再是谎言（下一段真排了），但 circuit_breaker 假死的 backfill 文案属 G2。（G1-DONE 已自报）
2. **换段 label 不自动回「推进中」**：`task_loop.status` 只在 run 结束广播，下一段 start 后 label 停留在换段文案直到该段结束。（G1-DONE 已自报）
3. **其他 broadcastLoopStatus 调用点**（`message-router.ts:3132/3143/3216/3243`）不传 `lastTerminal`，触顶与 drain 之间的极窄窗口内被触发会显示「推进中」。
4. **未武装 round_limit 无审计足迹**：审计只在 armed 分支发出；replay 无法区分「未武装自然结束」与「未武装触顶」。
5. **全勾证据 + round_limit 的 wrap-up 路径无测试**：行为正确（verdict `incomplete` → 一段通用 steer 收尾 → completed），仅覆盖缺口。
6. `round-limit-exit.test.ts:43` 的 proximity 正则（400 字符窗口）是弱源码锁，建议锚定 `llm.round_limit` 日志行。
7. `message-router.ts` 不在 plan 任何 Task 的 Files 清单（`lastTerminal` 接线的必要落点，G1-DONE G-3 已主动披露）；`G1-DONE.md`/`AGENT-TASK.md` 提交在仓根，按惯例应归 `docs/audit/reviews/` 或移出合并。
8. `loop-status.ts:12-16` import 拆行属无关 cosmetic churn。
9. 设计 mock（`.impeccable/mocks/*-wires.html:340`、`-interactive.html:609`）仍展示墓碑气泡——若意在描绘 G1 后 UI 则已过时。

## 测试证据

两路 reviewer 独立运行：`loop-kernel` + `round-limit-exit` + `round-limit-copy` 三文件 **44 pass / 0 fail**（worktree 内 `.test-dist` runner）。全量 5112 pass 为 G1-DONE 自报，未独立重跑。
