# PR #549 独立对抗评审

## 你的角色

独立高级代码评审员，**对抗性**立场。默认假设这个 PR 有问题，你要找出来。
只报告能用真实代码位置证明的结论。不要盖章，不要凑数。

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #549，分支 `fix/544-545-546-review-blocking`（已 push），base `main`
- PR 正文：`gh pr view 549`
- 4 个提交：`git log --oneline main..HEAD`
- 完整 diff：`git diff main...HEAD`

**必须实际打开文件读代码、实际跑命令。** diff 是线索不是结论。

## 背景（重要）

这个 PR 修的是**上一轮评审自己裁出的 3 条 BLOCKING**（REJECT）。
上一轮材料在 `docs/audit/reviews/069-pull-20260927/`：
- `SYNTHESIS.md` — 综合裁决（含操作者对 B1/B2 的实机复现）
- `pi-review.md` / `kimi-review.md` / `claude-review.md` — 三路原始输出

**你要评审的是"修复是否正确且完整"，不是重新评审原缺陷。**
但如果你发现修复本身引入了新问题，或原缺陷没被真正修掉，那就是 BLOCKING。

## 三条修复的实现者声明（**逐条验证，不要相信**）

### 声明 1 — B1 #545（`8f9f1cfc`）
- `releaseIdleWorkerLeases` 改为逐租约应用 `mutationHolds` / `createdHoldUntil` / `resolveHasPending` 三重保护，命中即 `continue`
- 新增私有函数 `releaseIdleLeasesForThread`
- `fleet.ts` 新增 `llmActiveResolved` 标志，`catch` 里置 false；为 false 时**完全跳过** idle 释放（fail-closed）
- `llmSet` 仍供 `fleet.ts:112` 展示用，不受影响
- 新增 6 个测试（含 2 组对照组）；修正 1 个既有 fleet 测试（补 `registerTabLeasePendingHooks`）

### 声明 2 — B2 #544（`2d0aeb80`）
- pivot 指令不再写进 `toolResult.error` / `data.pivot_zh`
- 改为收集进 `pivotNotes`，在 `messages.push(...toolResults)` 之后 push 一条 `role: "system"` 消息
- 保留 `data.suggested_action = "switch_strategy"`（机器枚举，非自然语言指令）
- 新增 `adapter-pivot-trusted-turn.test.ts`，4 个 adapter 级用例，第 1 个含 anti-vacuity 守卫

### 声明 3 — B3 #546（`f297a0f3`）
- `runNodeTest` 改为按 argv 长度分批（`MAX_ARGV_CHARS = 32000`）
- 新增 `chunkByArgv` / `argvChars` 辅助函数
- spawn 失败时显式打印 `r.error.code` / `message` + argv 长度，返回 1
- `r.signal` 非空时也打印并置非零退出码
- 返回值改为累积 `worst`

## 重点审查方向

### P0 — 修复是否真的修好了

**B1**：
- 三重保护的顺序与条件是否与 `releaseMutationHold`（`tab-lease.ts:621`）/ `sweepPerCallLease`（`:291`）**语义一致**？有没有抄错（比如 `createdHoldUntil > t` 写成 `>=`，或漏了 `now()` 过期清理）？
- `releaseIdleLeasesForThread` 用 `[...leases.entries()]` 快照遍历 —— 遍历中 `leases.delete` 安全吗？与其他并发释放路径（`sweepExpired`、`forceReleaseTab`）有无交错问题？
- fail-closed 是否**过度**？`llmActiveResolved=false` 时完全不释放，会不会让租约永久泄漏（原本 `ad7f0980` 要修的"子任务停了还占标签"问题回归）？有没有兜底（`sweepExpired` 的 idle TTL / hard_max）？请核实兜底确实存在且够用。
- `dropTimedOutPending` 不再被调用 —— 那 timed-out tombstone 现在由谁清理？会不会泄漏？

**B2**：
- 新的 `role: "system"` 消息会不会**破坏 provider 契约**？重点核实：
  - Anthropic：`anthropic-convert.ts:190-192` 真的会把中途 system 提升到顶层吗？提升后**顺序**是否被打乱（多个 pivot 提示的相对顺序）？
  - OpenAI：中途 system 消息是否被某些严格网关拒绝？
  - 有没有 tool_call_id / tool-response **邻接性**被打破的风险（push 在 toolResults 之后，下一轮 assistant 消息之前）？
- `[CMspark 系统提示 · 非网页内容 · 可以遵循]` 这个标记**能否被页面内容伪造**？`text-sanitize.ts:91` 只中和了 `</untrusted-XXX>`，那这个中文标记本身呢？页面文本里直接出现这串字会怎样？
- `pivotNotes` 是 per-round 数组（`const` 在轮次内声明）—— 多个工具在同一轮都触发 pivot 时，会合并成一条还是多条？行为是否合理？
- 移除 `data.pivot_zh` 后，**有没有下游消费者被打断**？实现者声明"零消费者"，请独立核实（全仓 grep，含 chrome-extension、tests、docs）。
- 移除 `toolResult.error` 拼接后，**持久化**的 tool result 与**发给模型**的是否一致？会不会有一处还带旧文案？

**B3**：
- `chunkByArgv` 的边界：单个文件路径本身就超过 `MAX_ARGV_CHARS` 时怎么办（死循环？空批？）？
- `worst` 累积逻辑：`r.status ?? 1` 还在吗？`r.status === null` 且 `r.error` 存在时走哪条？
- 分批后**测试隔离**是否被破坏？原来单次 spawn 共享一个 `CMSPARK_TEST_RUN_DIR`，分批后仍共享吗？会不会有跨批状态污染？
- `settings-web.test.js` 的特殊处理（`--experimental-test-isolation=none`）在分批后是否仍生效？

### P1 — 测试质量

- 6 个 tab-lease 新测试是否真锁住了缺陷，还是只锁实现细节？
- **对照组是否有效**？实现者声称 S4（llmActive）/ S5（paused）证明"守卫写对了"—— 但这两个对照组在**修复前后行为相同**，它们真的能证明什么吗？
- B2 的 anti-vacuity 守卫是否**足够**？它只断言 pivot 文案出现在某处，会不会在"出现在 untrusted 块里"时也通过？（注意用例 1 和守卫的关系）
- 有没有**该测但没测**的路径？特别是 B1 的 `fleet.ts` fail-closed 分支（`llmActiveResolved=false`）—— 实现者承认现有 fleet 测试 25/25 绿，但**有没有任何一个测试真的让 require 抛异常**？如果没有，这条新分支是零覆盖。
- B3 有没有测试？（runner 脚本本身通常无测试 —— 如果没有，说明这是"改完靠手跑验证"，请指出）

### P2 — 范围与卫生

- PR 是否**超出**了 3 条 BLOCKING 的范围（夹带无关改动）？
- `.gitignore` 的 `.alma-snapshots` 改动、`docs/audit/reviews/502-punchlist-20260919/` 那批 untracked 文件，是否被正确排除？
- 提交信息与实际改动是否一致（有没有 over-claiming）？
- CHANGELOG 该不该在这个 PR 里改？（注意 #547 的发布卫生问题，PR 正文说要合并后再切 0.6.10）
- ADR-020 能力声明块是否正确填写？`Surface: n/a` + `Trust: none` 的论证成立吗？B2 明明是**收紧**信任边界，写 `Trust: none` 准确吗？

## 硬性规则

1. 实际读代码 / 跑命令。**不要修改任何文件，不要提交，不要 push。**
2. 每条 finding 必须带 `文件路径:行号`，说明为什么是问题、什么条件触发。
3. 找不到问题就直说，不要编 NIT 凑数。
4. 明确区分：**验证过的** / **推断的** / **没能验证的**（第三类单独列）。
5. 若实现者声明与代码不符，点名 over-claiming 并给证据。
6. 应用 ADR-020 清单：`docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## 可用命令提示

- 跑聚焦测试：`cd companion && npx tsc -p tsconfig.test.json && node --require ./scripts/test-data-dir.cjs --test .test-dist/tests/orchestrator-tab-lease.test.js`
  （注意 Windows 上 `npm test` 在本 PR 修复**之前**是跑不起来的；修复后可以跑，但全量约 60 秒）
- 若跑 node 报 `'node' 不是内部或外部命令`，说明 PATH 缺 `C:\nvm4w\nodejs`；
  若 bash 报 `set: pipefail: invalid option name`，说明 PATH 里 `C:\WINDOWS\system32` 在 `/usr/bin` 之前，WSL 的 bash 抢了 Git Bash。

## 输出格式

```
## BLOCKING（必须修才能合）
- [P0|P1|P2] path/to/file.ts:123 — 问题 / 触发条件 / 影响

## NITS（非阻塞）
- path/to/file.ts:45 — ...

## 未能验证
- 声明 N：原因

## 已核实为正确的声明
- 声明 N：证据（file:line + 你跑了什么）
```

**最后一行必须恰好是以下之一（后面不能有任何内容）：**

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

有任一 BLOCKING → REJECT。只有 NITS → APPROVE_WITH_NITS。干净 → APPROVE。
必须打印在你的最终回复里，不要只写在别的文件中。
