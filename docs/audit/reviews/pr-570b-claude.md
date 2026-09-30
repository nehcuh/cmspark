diag: claude=/c/nvm4w/nodejs/claude
diag: started=2026-09-30T12:58:08Z
所有验证完成，工作树已恢复原状。评审结果如下：

---

# PR #570（修正版）复审

## BLOCKING（必须修才能合）

- **[P1] `companion/src/llm/adapter.ts:1302/2588-2605` — 落点搬进 `finally` 后，丢掉了旧落点（router catch 之后的落盘）对「异常逃逸类」的覆盖：未处理异常的 run 现在会在磁盘上留下**「正常跑完」的错误肯定痕迹**，pre-try 崩溃则什么都不留。**
  - **结构实测** `[inspected + executed grep]`：函数级 `try`（:1302）**只有 `finally`、没有 `catch`**（`awk` 扫 1302–2590 无函数级 `} catch`）；12 处 `if (runStats) runStats.terminal = …` 全部位于 `return`/`break` 之前（:1391/:1501/:2160/:2231/:2296/:2408/:2445/:2455/:2500/:2521/:2546/:2587）。
  - **触发条件 A（in-try 逃逸）**：异常从函数级 try 内、且不经 12 个登记点地抛出——现实来源：`runContextBudgetPass("mid_loop")`（:1312，在内层 try :1327 **之外**）、`buildCurrentContext`（:1306）、循环内 `threadManager.addMessage/update` 磁盘写、任何未分类 bug。异常展开时 **finally 先于 router catch 执行** → `runStats.terminal` 仍为 `null` → 落盘 `{null, now}` = catalog 文案教的「ended normally」→ 异常继续传到 router catch（`message-router.ts:1403-1406`）把 `"error"` 只写进**内存**，`broadcastLoopStatus`（面板显示 error）与磁盘 trace 从此分叉。
  - **触发条件 B（pre-try 崩溃）**：entry(:523)→try(:1302) 之间的未守卫调用抛出——`persistHealedToolRows`（:559）、初始 `buildCurrentContext()`（:767）等 → finally 不执行 → **零落盘**，读到上一次 run 的残留。
  - **对照旧设计** `[executed]`：`git show 7783f551:companion/src/message-router.ts` — catch（相对 :1401-1405，置 `aborted`/`error`）**先于**落盘（相对 :1475）→ 旧落点对这两类都会写 `"error"`。即本 PR 在这两类上是**相对旧代码的回归**（对 router 线程严格变差；对 worker 从「无痕迹」变成「自信的错误痕迹」）。
  - **影响**：#569 的全部目的就是让父线程事后凭 `last_run_*` 判断 worker 怎么死的；中途崩死的 worker 会被记成「正常收工」——比没有痕迹更糟，正是 ibg908「误读 worker 状态」的复刻。
  - **修法（~3 行）**：在函数级 try 与 finally 之间补 `catch (e) { if (!runStats.terminal) runStats.terminal = "error"; throw e }`（abort 路径已被内层 :2347 rethrow + finally 首行覆盖，不受影响）；这同时精确恢复旧 router catch 的语义。

## NITS

- `companion/src/bridge/tool-definitions-catalog.json:1221/:1326` — catalog NIT **只修了 1/3**：`list_workers`（:1209）改成 "both null"，但 `get_worker_status` 与 `wait_workers` 仍写 "**both absent** = it never ran"——dispatch 在三处都 `?? null` 强转（`companion-dispatch.ts:654-655/:677-678/:920-921`），工具返回体里 absent 永不出现。且 ：1209 新文案自身冗余自撞：开头已说 "null terminal with a set timestamp = ended normally"，结尾又重复一遍同义句；括号 "(the fields are never set)" 与强转矛盾（返回体里字段**恒被设置**，至多是 null）。
- `companion/src/threads/thread-manager.ts:98` — 字段 doc 仍写 "Persisted at run end (**`message-router`**)"，与本 PR 把落点搬到 adapter 的改动**同一 diff 内自相矛盾**，应改为 `llm/adapter.ts` `chatCreate` finally。
- 测试守卫深度（`[executed]` 突变）：作者 4 条突变**全数复现为红**（M1 worker 条件化 / M2 删兜底 / M3 搬回 router / M4 删 `?? null`），但我补了两条作者没试的突变**仍绿**：**M5** 把落盘块从 finally 挪到 try 之前（5/5 绿——「落在 finally 里」无任何守卫钉住，挪出去后每次落盘的都是 entry 重置后的 `null`，即全员「正常跑完」）；**M8** 把落盘包进 `if (!params.runStats)`（5/5 绿——router 三条路的落盘会静默消失，只剩 kick worker 落盘）。根因相同：**没有任何测试驱动真实 run-end 断言线程行上的值**，守卫全部是源码字符串级。建议补一条行为测试（stub LLM 驱动 `handleMessage("chat.create")`，断言 `last_run_terminal` 等于该 run 的终值），或至少加源码守卫钉住落盘块位于 `} finally {` 之后。突变脚本留在 `companion/scratch/mutate-569.mjs`（未跟踪）供复跑。另：message-router 的反向守卫是字符串级 "不得出现 `last_run_terminal`"（`run-terminal-persist-569.test.ts:124-127`），将来在该文件写一句提到它的注释也会误红——与仓库既有 #502/#565 守卫同风格，可接受，知悉即可。
- 分支上的 `59b0e0d3`（`.gitignore` 加 `.alma-snapshots/`）与本票无关，建议合入前剔除或拆单独 PR。
- `M7`（兜底字面量删 `terminal: null`）字符串守卫抓不住，但 **tsc 直接拒编** `[executed]`：`TS2322: Property 'terminal' is missing`——编译器守住了它，无需加守卫。

## 未能验证

- **「companion 全量连跑两次 70/70」无法按字面复现**：本仓 companion 有 **404 个测试文件**（`ls tests/*.test.ts | wc -l`）；本机全量实跑 `[executed]` = **4582 pass / 60 fail**，60 个失败全部是已知 Windows 环境断言（symlink EPERM / 0o600 / macOS bundleId / SIGTERM / HOME 路径），分布在本 PR 未触碰的文件（daemon 14、daemon-cli 5、capability-workspace 4…），且**数量与上一轮我测得的 pre-PR 基线完全一致（60）**——「0 新增失败」这个关键不变量成立，但 "70/70" 的口径（70 个什么）无法对应到全量套件，疑为某个子集或统计口径不同。
- 作者所称「中间一次 2 个 voice/STT 文件失败」的具体文件名无从得知；我做了独立判断：24 个 voice/STT/whisper 测试文件（292 用例）**连跑 3 次全过** `[executed]`，其中 ≥5 个文件依赖 `mkdtemp` 临时目录（负载下磁盘抖动可解释偶发），且**没有一个 import adapter/message-router**（与本次改动面零交集）——「判为负载偶发、与改动无关」**成立**。
- `bash scripts/tests/test-package-gates.sh` `[executed]`：node 不在 PATH 时 121/12；补 PATH 后 141/15——失败全部是 release-guard 动态用例（git 树状态敏感），与本 PR 改动面无关，不作数。
- PR #570 的 GitHub 描述原文（同上一轮，只审了提交与本仓材料）。

## 已核实为正确的声明

- **新落点覆盖 4 个 chatCreate 调用点** `[executed grep + 控制流]`：router×3（`message-router.ts:1369/1958/2362`，即 chat.create / file.upload / chat.regenerate —— 上一轮的 **P1（file.upload/regenerate 无落盘）随搬迁自动消解** ✓）+ server kick×1（`server.ts:789`）。全仓无第 5 个调用点；ACP 不直调 chatCreate（grep 空）；orchestrator 父线程走 router → 同一个 finally 覆盖，无遗漏的 run 驱动方。
- **worker kick 控制流逐环核实**：`companion-dispatch.ts` `spawn_worker` → `execOpts.kickWorkerChat` → `server.ts:771` 回调 → `installKickAbortController`（被占用则跳过——无 run 即无落盘，语义正确）→ `scheduleWhenLlmSlotAvailable` → `await chatCreate({ threadId, message, threadManager, … })`。**`threadManager` 与 `threadId` 都在作用域内**；kick 不传 `runStats` → 走本地兜底；`skipUserMessage: true`。run 无论正常 `return`、中途 `throw` 还是 abort，都会经过函数级 finally（异常展开时 finally 必执行）→ **worker 的 run 会落盘**。
- **声明 6 全部成立** `[inspected + grep]`：① router 传了 `runStats` 时 `runStats === params.runStats`（同一引用，`??` 不换绑）；② finally 落盘与 router 的 `broadcastLoopStatus`（:1470）读的是同一个被 12 个终止点更新的对象；③ 兜底对象是 chatCreate 局部量，adapter 内 `runStats` 仅 ：212（参数声明）/:533（局部）/:2585（日志），**无泄漏**；④ 无任何调用方依赖「不传 runStats 就不落盘」（kick 是唯一不传者，恰是本票要落盘的对象）；⑤ `runStats` 恒真后 reset 块对传参者语义不变、对 kick 是新建对象上的无观测操作；⑥ 全仓无 `params.runStats === undefined` 哨兵读取。
- **落盘时序无「上一 run 覆盖」问题**：落盘是 finally 的**第一条语句**，先于同 finally 内的 `convertLeftoverSteerToNextRun`，更先于 router 的 `drainNextRun`（`message-router.ts:1480`，在 chatCreate 返回**之后**）→ 每个 run 在下一个 run 开始前写完自己的终值，语义即「last finished run」。
- **声明 7 成立**：4 条突变全红（见 NITS 第 3 条）；新增测试为正向（adapter 字符串断言）+ 反向（message-router 禁现 `last_run_terminal`）+ 「不得被 agent_role 包裹」（500 字符窗口）+ dispatch `?? null` 精确计数（每字段 ≥3，实为 3 工具 × 1 次/字段，计数正确）。我上一轮的突变（落盘处跳过 worker → 旧测试全绿）**现已红**（M1 复现）✓。
- **声明 9 成立**：`round-limit-exit.test.ts` 6/6 绿 `[executed]`，其中 3 条源码守卫保持**原严格度未被放宽**——精确计数 `circuit_breaker === 3`、`round_limit === 1`、字面量 `runStats.terminal = "round_limit"` 必须存在（:40/:48-51）；源码现仍是 12 处字面量形式，`markTerminal(...)` 式重构确实会打破它们。
- 两处 NIT 修复：`security.ts:1083` 行尾错误注释已删、说明移入块注释（"already holds" 仅剩 ：1255 的 INTENT_CAP 模板本体现身，正确）✓；catalog 见 NITS（1/3）。
- 新增注释的行号引用核对无误（`message-router.ts:1369/1958/2362`、`server.ts:789`）；`thread_id` 补进 `llm.tool_failed`（:2008）与 `llm.recoverable_loop_detected`（:2221），与 ：2214 `llm.locator_pivot` 先例一致，作用域内合法。
- 定向套件：`run-terminal-persist-569` **5/5**、`round-limit-exit` **6/6**、`classify-by-code`（新增 `EVALUATE_NULL_RESULT: "recoverable"` 钉子）在全量跑中通过 `[executed]`；`npm run build` 通过。

## 对「新落点覆盖 worker」的裁决：已证实

kick 路径（`server.ts:771→789`）携带 `threadId`+`threadManager` 进入 `chatCreate`，其函数级 finally 对该 run 的所有正常/异常/abort 退出都会执行且无 agent_role 条件——#569 的目标场景（worker 被熔断处死）的 `circuit_breaker` 会真实落盘并被三个查询工具带出。**唯一残余**是上方 P1：逃逸异常类会落成错误的「正常跑完」而非旧设计的 `"error"`——这是落点搬迁引入的回归类，修一处 catch 即可闭合，不推翻落点选择本身。

VERDICT: REJECT
CLAUDE_EXIT=0
diag: finished=2026-09-30T13:22:26Z
