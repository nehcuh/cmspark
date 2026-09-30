diag: claude=/c/nvm4w/nodejs/claude
diag: started=2026-09-30T05:26:13Z
所有验证已完成。工作区中多出的一个测试文件是并发写入导致的（mtime 13:28:22，本周会话期间，非我所为）——我会保留它并记录下来。以下是评审结果：

---

## BLOCKING（必须修才能合）

- **[P0] `companion/src/message-router.ts:1475`（落点）— 本 PR 的承重墙对 worker 的主路径**完全不生效**：被 kick 的 worker run 根本不经过 message-router，落盘代码永远不会为它执行。**
  - **控制流实测**（全仓穷尽，非注释推断）：
    - worker 的 run 由 `spawn_worker` kick 启动：`companion/src/tool/companion-dispatch.ts:374` → `execOpts.kickWorkerChat`；
    - `executeCompanionTool` **全仓唯一**调用点是 `companion/src/server.ts:710`，其 `kickWorkerChat` 绑定在 `server.ts:771`，回调里 **直接 `await chatCreate(...)`（`server.ts:789`）** —— 不经过 `handleMessage` 的 `case "chat.create"`（`message-router.ts:1111`）；
    - 全仓 `chatCreate` 调用点仅 4 处（router 的 chat.create/file.upload/regenerate + server.ts 的 kick）；`adapter.ts` **不 import** message-router/loop-kernel（无回调环）；`dist/server.js:744-745`（编译产物）grep `last_run_terminal` = **0 次**；
    - 事故本身即是 kick 路径：`~/.cmspark-agent/threads/ibg908.json` 消息 30-35 含 4 次 `spawn_worker` 调用；`index.json` 实测 98z0ri/a56ebc = `agent_role:"worker"`, parent=ibg908, 同一 `orun_3eba58af`。
  - **触发条件**：父线程 spawn worker → worker 被同工具熔断处死（#569 原始场景）→ run 在 `server.ts:789` 的 await 内结束 → `broadcastFleetSnapshotIfWorkers` 后直接 return → **无任何落盘**。且 kick 路径连 `runStats` 都没传（`adapter.ts:212` 为可选参数），terminal 无处可取。
  - **影响**：死掉的 kick-worker 查询时两字段皆 `undefined` → dispatch `?? null` 强转（`companion-dispatch.ts:654-655` 等 3 处）→ 父线程看到 `{null, null}`，按 catalog 文案即「**从未跑过**」——比改动前更糟：不仅没修好「死 vs 闲」，还给了一个**错误的肯定答案**。PR 对 #569 的目标场景是纯 no-op。
  - **作者的依据为何错**：`「1468 的 #514 fleet 广播即证 worker 跑完会走到这里」`（`docs/audit/reviews/ibg908-worker-death-claude.md:56`）不成立——`broadcastFleetSnapshotIfWorkers`（`orchestrator/fleet.ts:197-206`）只要线程集合里**存在** worker 就广播，父线程（走 router）run 结束时同样触发；且同属 #514 的 `server.ts:774-775` 注释明写 **"expert-team worker runs bypass the router's run-end fleet push"** —— 同一 PR 系列里两处注释互相矛盾，作者信了错的那条。
  - **测试为何全绿**：新测试 4 例全是 ThreadManager 单测 + 源码字符串守卫，无一驱动真实 run-end。我做了作者没做的突变：**在落盘处显式跳过 worker（`if (agent_role !== "worker")`）→ 5/5 全绿**。即「落点覆盖 worker」这一成立前提**未被任何测试保护**。
  - **修法建议**（供作者参考）：把 `runStats` 传入 kick 的 `chatCreate` 并在 `server.ts` 回调 settle 后落盘；或更彻底——在 `adapter.ts` 的 chatCreate 自身 finally 里落盘（threadId + terminal 都在作用域），一处覆盖 kick/router/regenerate/file.upload 全部路径。

- **[P1] `companion/src/message-router.ts:1544/2216` — 即便在 router 内部，覆盖也不完整**：`file.upload` 与 `chat.regenerate` 各自驱动 run（chatCreate 于 ：1973/:2377）但**没有**落盘块。经这两条路径结束的 run（含 orchestrator）不更新 `last_run_*`，读到的是上一次 run 的残留值——与「last finished run」语义相悖。

## NITS

- `companion/src/security.ts:1092` — 行尾注释 `报文模板含 "already holds" → 命中子串表` 是从 `INTENT_CAP` 复制来的**错误注释**；`EVALUATE_NULL_RESULT` 模板实含 `"script evaluation failed"`（`site-op-memory.ts:337`）。上方块注释是对的，行尾与之矛盾。
- `companion/src/message-router.ts:1468` — 注释 "persist ... **before the broadcast above**"：上方并无 broadcast，两个广播（`broadcastLoopStatus`/fleet 刷新）都在落盘点**下方**。意图可读，措辞错。
- `tool-definitions-catalog.json:1209/1221/1326` — 文案说 "both absent = it never ran"，但 dispatch 把 `undefined` 强转成 `null`，工具返回体里**永远不会出现「absent」键**，「没跑过」实际呈现为两个显式 `null`。建议文案改为 "both null"。
- 测试守卫的限度（突变实测）：M1（删落盘块）与 M4（删 dispatch 字段）会红（字符串守卫起效）；但 **M3（`?? null` 改为传 `undefined`）与 M5（terminal 值换成常量 `null`）都 5/5 全绿** —— 落盘处的三态取值与值流没有行为测试。建议补一条经 `handleMessage("chat.create")` 驱动、断言字段真落盘且值等于该 run terminal 的测试。
- 跨进程写盘：`saveIndex` 只从磁盘回补 `digest`/`last_message_at`（`thread-manager.ts:604-633`），tray 进程持旧 index 时下一次写盘会丢掉 daemon 写的 `last_run_*` —— 与 `paused`/`brief`/`latest_tool` 同一既有暴露，非本 PR 引入，记录备查。

## 未能验证

- 全量套件 60+5 个失败（Windows 环境）：逐一看均为 Unix-only 断言（symlink EPERM、0o600、launchd、macOS bundleId、SIGTERM），且分布在本 PR 未触碰的文件；worker 相邻测试文件 83/83 通过、classify 全过。**未**在 main 上重跑全量以正式证明 pre-existing（时间成本），此判断基于失败面与本 PR 改动面零交集。
- 扩展端是否消费新字段（本 PR 未动扩展；侧栏 fleet UI 读的是 `fleet.status` 而非这三个工具）——未审计扩展渲染链。
- PR #570 的 GitHub 描述原文（只审了提交内容与本仓内材料）。

## 已核实为正确的声明

- `loop-kernel.ts:295` 逐字符核实：`if (!thread || thread.agent_role === "worker") return` —— 「`onLoopRunFinished` 对 worker early-return、不能作落点」这条**否定性**判断正确（错的是肯定性判断：router 区块同样覆盖不到 kick-worker）。
- `runStats.terminal` 终值顺序正确：catch 兜底（`message-router.ts:1404-1406`）先于落盘（:1475），落盘先于两个广播；`try/catch` 结构下无「落盘早于兜底」路径。
- `update()` 副作用无害：新字段不触发任何校验分支；`seedRunProgress` 仅在 `run_progress === undefined` 时播种，实际序列中 handoff 写入当时即已播种（测试⑤钉住 sticky-null）；每 run-end 一次 `saveIndex` 与现有每工具调用 `latest_tool` 更新同成本级，4 worker 并发结束在单线程事件循环 + atomicWriteJSON 下无撕裂。
- §③ 零行为变更**成立**（独立复算）：`EVALUATE_NULL_RESULT` 全仓唯一产出点 `site-op-memory.ts:332-343`，报文为**固定模板**且含 `"script evaluation failed"`；pre-PR 子串遍历（security.ts:1198 前无更早命中——已逐条核对 security/nonRecoverable/recoverable 三表）→ recoverable；post-PR 码表直返 recoverable（adapter.ts:2135 确实传 `error_code`，登记生效）。唯一理论放宽：伪造 `data.error_code` 的调用方原本可借文案升为 security、现固定 recoverable —— 这正是整张表（#556/#560）已声明的「码优先」语义，非本条特有。
- 两处 `thread_id` 补齐：作用域内（:2002/:2212），与 ：2207 `llm.locator_pivot` 先例一致；thread_id 为 6 位随机 id，日志本就遍地携带，无新增敏感面。
- catalog JSON 合法（tsc 直接 import 编译通过），描述经 `getToolDefinitions`（仅滤 `osascript_eval`）可见于模型。
- 三态在**磁盘上**成立：`update({terminal: null})` 落盘为显式 `null` 键，从未更新的线程无该键；测试①②经 `new ThreadManager()` 真实重载（run-tests.mjs 预加载 `CMSPARK_DATA_DIR` 隔离）——提示语担心的 `JSON.stringify` 丢 `undefined` 不适用于 index 持久化路径。
- 测试实跑：定向 17/17 过（提交内 4 例 + 工作区未提交的第 5 例）；`npm run build` 通过；行号引用（loop-kernel:295、adapter:2000/2209、site-op-memory:334-343）核实无误。
- 附注：评审期间工作区在 13:28 被并发会话追加了一例未提交测试（`run_progress` 播种钉子），已如实一并跑过，不影响上述任何结论；我未改动它。

## 对「落点覆盖 worker」的裁决：已证伪

VERDICT: REJECT
CLAUDE_EXIT=0
diag: finished=2026-09-30T05:55:10Z
