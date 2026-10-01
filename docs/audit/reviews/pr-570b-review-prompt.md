# PR #570（修正版）复审 — 你上一轮判了 REJECT，验证修正是否到位

## 你的角色

你（pi/claude）上一轮审这个 PR 并给 **REJECT**，P0 是：
**落盘点在 `message-router`，而 worker 的 kick 路径（`server.ts:789` 直接调 `chatCreate`）不经过 router
⇒ 对 #569 的目标场景是 no-op。**

作者已按此重做。当前 head：`953fd53a`（分支 `fix/569-terminate-trace`）。
**请验证修正是否真的到位，并攻击新实现。**

## 你上一轮的发现（逐条验证）

1. **[P0] 落点对 worker 无效** → 作者声称已把落点移到 `companion/src/llm/adapter.ts` 的
   `chatCreate` **finally**，一处覆盖 router(`chat.create`/`regenerate`/`file.upload`，`:1369`/`:1958`/`:2362`)
   与 server kick(`:789`)。**请独立验证这个新落点真能覆盖 worker**。
2. **[P1] `file.upload` / `chat.regenerate` 无落盘** → 作者声称随搬迁**自动消解**。请核实。
3. **NIT**：`security.ts` 行尾注释误抄自 `INTENT_CAP`（写 `"already holds"`）→ 已改。
4. **NIT**：catalog 文案 "both absent = it never ran" 与 dispatch 强转 `null` 矛盾 → 已改。
5. **你上一轮的突变**「落盘处显式跳过 worker → 旧测试 5/5 全绿」→ 作者声称现在这条突变**会红**。
   **请复现**。

## 作者的新声明（逐条验证，不要相信）

6. **本地兜底**：`const runStats: RunStats = params.runStats ?? { toolCalls: 0, closingTurnToolCalls: 0, totalTokens: 0, terminal: null }`
   —— 因为 `params.runStats` 是**可选**传入（kick 路径不传）。
   作者称：这样下游 **12 处 `if (runStats) runStats.terminal = …` 一字未动**，
   且当 router 传了 runStats 时 `runStats === params.runStats`（**同一引用**），
   所以 router 侧 `broadcastLoopStatus(..., runStats.terminal)` 仍拿得到终值。
   **请验证**：① 引用同一性；② 若 router 传了，落盘读到的是**同一个**被更新的对象；
   ③ 若没传（kick），本地兜底对象是否只用于落盘、不泄漏成别处的状态。
7. **测试加固**：落点用例重写为正向（adapter 断言）+ **反向**（`message-router` 里不得再出现
   `last_run_terminal`）；新增「落盘不得被 `agent_role`/worker 条件包裹」；
   dispatch 三处字段**必须 `?? null`**（精确计数）。
   作者称 **4 处突变全红**：① 落盘条件化；② 去掉本地兜底；③ 挪回 router；④ 去掉 `?? null`。
   **请独立复现至少两处**，并**尝试作者没试的突变**（例如：把 finally 的落盘挪到 `try` 之前？
   把 `last_run_ended_at` 写成常量？把本地兜底的 `terminal: null` 初始化删掉？）。
8. **回归**：作者称 companion 全量**连跑两次 70/70 = 基线、0 新增**；
   中间一次出现 2 个 voice/STT 文件失败但单独/成对跑均全过、且不复现（判为负载偶发）。
   **请独立判断**该偶发是否真的与本次改动无关（例如：那些用例是否依赖端口/临时目录/时序）。
9. 作者称 `round-limit-exit.test.ts` 的 3 条源码守卫曾被其第一版重构（`markTerminal(...)`）
   **打破**，改用本地兜底后恢复 6/6。请核实现在这 6 条真的有效（而非事后放宽）。

## 重点审查方向

### P0
- **新落点是否真覆盖 worker kick**：请**实际追控制流**（不要只看注释）：
  `companion-dispatch.ts` 的 `spawn_worker` → `execOpts.kickWorkerChat` → `server.ts:771` 回调
  → `chatCreate(...)`。这条路径上 `threadManager`/`threadId` 是否都在？
  `chatCreate` 的 `finally` 在**所有**退出路径上都会执行吗（含 `return` / `throw` / 提前 return）？
  **worker 的 run 是否会走到这个 `finally`**？
- **`params.runStats ?? {…}` 是否引入了行为变化**？特别：
  - 若某调用方**依赖**「不传 runStats 就不累计/不落盘」，现在会怎样？
  - `runStats` 现在**恒为真**，那么原来 `if (runStats) { reset }` 的语义是否被静默改变？
  - 有没有别处读 `params.runStats === undefined` 来判别「调用方是否关心统计」？
- **落盘时机**：`finally` 里落盘相对 `convertLeftoverSteerToNextRun`、以及相对
  `message-router` 的 `drainNextRun` 的顺序 —— 会不会出现「落盘的是**上一个** run 的终值」
  或「连续 run 覆盖」的问题？请核 `llm/next-run` 的 drain 时序。

### P1
- 测试守卫是否**真有牙**（见声明 7）。**尤其**：`message-router` 的反向守卫是
  「不得出现 `last_run_terminal`」—— 这是**字符串**级，会不会误伤（例如有人在那里写注释提到它）？
- 两处 NIT 修复是否准确？catalog 新文案与 dispatch 实际行为是否一致（`null` vs `absent`）？
- 有无 `文件:行号` 引用错误？

### P2
- `chore: ignore .alma-snapshots/` 与本票无关，是否应该剔除出本 PR？
- 是否有别的地方也需要落盘（例如 ACP session、orchestrator 自己的 run）？

## 可用命令

- `cd companion && npm run build`
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/run-terminal-persist-569.test.js`
- `node scripts/run-tests.mjs .test-dist/tests/round-limit-exit.test.js`
- `bash scripts/tests/test-package-gates.sh`
- PATH 缺 `C:\nvm4w\nodejs` 会报 node not found；若 bash 报 `pipefail invalid option`，
  说明 `C:\WINDOWS\system32` 在 `/usr/bin` 前
- 上一轮你的原始意见：`docs/audit/reviews/pr-570-claude.md`

## 硬性规则

1. **实际运行命令与突变**，不要只读代码下结论。
2. 每条 finding 带 `文件:行号`。
3. 找不到问题就直说，别编 NIT。
4. 区分：验证过 / 推断 / 没能验证。
5. **若「新落点覆盖 worker」仍无法被证实，请明说** —— 那是本 PR 的成立前提。

## 输出格式

```
## BLOCKING（必须修才能合）
- [P0|P1|P2] path:line — 问题 / 触发条件 / 影响

## NITS

## 未能验证

## 已核实为正确的声明

## 对「新落点覆盖 worker」的裁决：已证实 / 无法证实 / 已证伪
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT
