# PR #570 独立对抗评审 — worker 终止留痕 + 关键日志补 thread_id（#569）

## 你的角色

独立高级评审员，**对抗性**立场。这是**可观测性 + 一处等级固定**的改动。
默认假设它有错，去找证据。**你可以且应该实际运行测试与突变。**

⚠️ 与常规 PR 不同：**本 PR 的正确性依赖一处落点选择**（见下「关键设计点」）——
若落点错了，功能对 worker **完全无效**，而测试仍可能全绿。请重点攻击这一点。

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #570，分支 `fix/569-terminate-trace`，base `main`，单提交 `7783f551`
- 12 个文件，+419/−4（**含**评审材料与复算脚本；纯代码约 +75/−4）
- 问题背景：issue **#569**（`gh issue view 569` 可用），另有上一轮诊断的评审
  `docs/audit/reviews/ibg908-worker-death-claude.md`

## 改动清单（逐条验证）

**① 终止留痕（承重墙）**
- `companion/src/threads/thread-manager.ts`：Thread 元数据加两个可选字段
  `last_run_terminal?: string | null` + `last_run_ended_at?: string | null`
- `companion/src/message-router.ts`（约 `:1467-1484`）：run 结束时 `threadManager.update(...)` 落盘
- `companion/src/tool/companion-dispatch.ts`：`list_workers` / `get_worker_status` / `wait_workers`
  三个返回体各带这两个字段
- `companion/src/bridge/tool-definitions-catalog.json`：三个工具的 description 同步

**② 两处日志补 `thread_id`**（`companion/src/llm/adapter.ts`）：
`llm.tool_failed`（约 `:2000`）与 `llm.recoverable_loop_detected`（约 `:2209`）

**③ 登记 `EVALUATE_NULL_RESULT`**（`companion/src/security.ts`）+ 期望表（`tests/classify-by-code.test.ts`）
—— 它此前未登记，`recoverable` 靠**文案兜底**命中 `"script evaluation failed"`，
而 `classifyError` 默认是 `non_recoverable`。

**④ 新测试** `companion/tests/run-terminal-persist-569.test.ts`（4 个用例）

## ⚠️ 关键设计点（本 PR 最该被攻击的地方）

作者称：落点**必须**在 `message-router.ts` 的 run-end 区块，**不能**放 `onLoopRunFinished`，
因为后者对 worker **直接 early-return**（`companion/src/loop/loop-kernel.ts:295`）。
作者的依据是「该区块紧邻 `#514` 的舰队刷新，而那条注释明写 'worker runs end here too'」。

**请独立验证这条控制流**：worker 的 run 结束时，**真的会**执行到那个 `threadManager.update` 吗？
- 请**实际追代码**（不是只看注释）：`message-router.ts` 那段的外层条件、`drained` 分支、
  `llmLoopGeneration` 判定、以及 worker 走的是哪条路径。
- 若某条路径**跳过**了它（例如 abort/异常/`drained` 分支），落盘就不会发生 —— 请指出是哪条，
  以及是否属于本票要覆盖的场景。
- 反过来：**worker 会不会压根不走 message-router 这条 run**？（例如 worker 的 LLM 循环是否由
  另一处驱动？）若如此，本 PR 对 worker 无效。

## 重点审查方向

### P0
- **落点是否真的覆盖 worker**（见上）。
- **`runStats.terminal` 在落盘那一刻是否已是终值**？请核 `message-router.ts` 里
  `runStats` 的创建、`try/catch` 结构、以及 `:1404-1406`（`!runStats.terminal` → `"error"`）
  与落盘点（`:1473`）的**相对顺序**。若落盘早于该兜底，某些路径会落 `null`（被读成「正常跑完」）。
- **`update()` 的副作用**：`threadManager.update` 会 `Object.assign` + `saveIndex()`（全量 index 写盘）。
  在 run-end 每次调用它，是否引入**性能/并发**问题（例如 4 个 worker 同时结束）？
  `update()` 里还有 `seedRunProgress` 等副作用 —— 对本路径是否有害？

### P1
- **三态语义是否自洽**：`last_run_terminal` 为 `undefined`（字段不存在）/ `null`（正常跑完）/
  非 null（被该 terminal 结束）。在 JSON 序列化后 **`undefined` 与 `null` 都变成 `null`**
  （`JSON.stringify` 会丢 `undefined` 键）—— 这会**破坏三态**吗？
  请实测：`update({last_run_terminal: null})` 之后落盘的 index JSON 长什么样，
  与「从未 update」的线程如何区分？作者的测试断言 `undefined` vs `null` 是否只是**内存态**成立？
- **§③ 的登记是否真的零行为变更**？请独立复算：对 `EVALUATE_NULL_RESULT` 的**全部**产出报文，
  登记前后等级是否一致？有没有报文会因此**从 non_recoverable 变 recoverable**（= 放宽）？
  若有，是否已被声明？
- 两处日志补 `thread_id` 是否**引入敏感信息**（thread_id 是否算隐私/是否需要脱敏）？

### P2
- 新测试 4 个用例是否**真有验证力**？请**独立复现**作者的突变（去掉一处字段 / 去掉 message-router 落盘）
  —— 并**额外尝试**作者没试的突变：
  - 把落盘点**移到** `onLoopRunFinished`（模拟「放错位置」）→ 测试会红吗？（若不会红，说明
    守卫证明不了落点，那么「落点正确」这个最关键的声明**没有被测试保护**）
  - 把 `update` 的两个字段改成 `undefined` 而不是 `null` → 三态是否被破坏而测试仍绿？
- catalog 描述改动是否让 JSON 仍合法、且描述对模型**真的可见**（`getToolDefinitions` 按 name 过滤，
  描述会进模型）？
- 有无 `文件:行号` 引用错误？（作者引用 `loop-kernel.ts:295`、`adapter.ts` 多处行号）

## 可用命令

- `cd companion && npm run build`
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/run-terminal-persist-569.test.js`
- `bash scripts/tests/test-package-gates.sh`
- 上一轮诊断的独立复算脚本：`scratch/rev569-replay.js`、`scratch/rev569-scan.js`
- PATH 缺 `C:\nvm4w\nodejs` 会报 node not found；若 bash 报 `pipefail invalid option`，
  说明 `C:\WINDOWS\system32` 在 `/usr/bin` 前

## 硬性规则

1. **实际运行命令与突变**，不要只读代码下结论。
2. 每条 finding 带 `文件:行号`。
3. 找不到问题就直说，别编 NIT。
4. 区分：验证过 / 推断 / 没能验证。
5. 若「落点覆盖 worker」这条**无法被证实**，请明说 —— 那是本 PR 的成立前提。

## 输出格式

```
## BLOCKING（必须修才能合）
- [P0|P1|P2] path:line — 问题 / 触发条件 / 影响

## NITS

## 未能验证

## 已核实为正确的声明

## 对「落点覆盖 worker」的裁决：已证实 / 无法证实 / 已证伪
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT
