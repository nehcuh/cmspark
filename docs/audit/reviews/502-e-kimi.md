# 502 E 舰队 Glance + Inspect — Kimi 对抗复审

> 日期：2026-09-18 · 评审人：Kimi（READ-ONLY，未改任何文件）
> 对象：worktree `/tmp/cmspark-502/e`，diff `c61285c6..HEAD`
> 方法：对抗子代理 + 仲裁人亲证；随 commit 落地增量更新本文件
> 状态：**终裁 APPROVE-WITH-NITS**（2026-09-19，`340c1fd2` 帽冻结修复落地后；见附录 3。残余仅 NIT：`SET_FLEET` 无 worker 消失对账、`fleet.ts` 注释过时、Glance 回落可显示过时工具名、嵌套滚动）

## Task 1 增量复审 — `d15b9c41` feat(fleet): latest_tool on worker snapshot

> 范围：单 commit，2 文件（`orchestrator/fleet.ts` +38、`tests/fleet-latest-tool.test.ts` +89）
> verdict：**BLOCK**（1 条 MAJOR，仲裁人已亲证）

### MAJOR-1（BLOCK 级）：`latest_tool` 的成本不是扫描，是每 worker 每 4s 一次全量磁盘读 + JSON.parse

plan Task 1 假设「从 `tm.get(id).messages` 倒序找」——但消息**不在**内存索引行上：实现实际调 `tm.getMessages(w.id)`（`fleet.ts:112`），而 `ThreadManager.getMessages`（`thread-manager.ts:1102-1111`）是 **`fs.readFileSync(整个线程文件) + JSON.parse`**。仲裁人亲证两处源码属实。

实际循环形状：侧栏 4s 轮询 `fleet.status` → N worker × 每次阻塞读全文 transcript + 全量 parse。tool 行持久化结果每条约 8000 字符上限，5000 消息的 worker 文件可达数十 MB → 每 worker 每拍 ~100–500ms 事件循环阻塞 sync I/O，与 `chat.token` 流同进程。3 只忙 worker = 4s 周期上反复数百 ms 卡顿。

修复方向（评审建议，未实施）：按文件 mtime 缓存 `latest_tool`；在写路径盖章（`createToolResultMessage`/`persistAssistantDraft` 本就持有 tool_name）；或 tail-read。**合并前必须改读路径**，其余部分可原样 ship。

### 干净项（子代理核实 + 仲裁抽证）

- 「latest」语义正确：倒序取最新带 tool_calls 的消息，并行批取最后一个 call；flat（role=tool 行）与 function 形（assistant 行）两种持久化形状都覆盖；B 切片的红act 在两种归档档都保留 `function.name`/`tool_name`，不被误伤
- **在飞语义正确**：adapter 在工具执行循环前先持久化 assistant draft（`adapter.ts:1194`），工具运行中 `latest_tool` = 在飞工具——正是 plan 要的「当前工具」
- 隐私：字段只带 trim 后的名字字符串，params/result/stdout 不进快照（`fleet.ts:63-66,128`）
- 契约：无工具时字段整个省略（条件 spread，`:128`），非 null/空串，有测试钉
- 无放大：`fleet.status` 仍是纯 pull，无新推送/广播/频率变化
- 红线：无 `SET_STREAMING`、无 system_prompt、无 BottomBar 改动
- 故障隔离：duck-typed `getMessages` + per-worker try/catch，旧 fake 不炸快照（有测试钉）
- 测试是真实行为钉（5 个：倒序选取、assistant 文本不遮挡、双形状、字段省略、legacy fake 存活），5/5 绿

### NIT

1. 提取器未对齐仓内 canonical 读者 `thread-recall.ts:49` 的 `tool_name || name || function?.name` 回退链（实际不可达，防漂移建议对齐）。
2. 空白名跳过（`.trim()`）与并行批内排序无测试钉，低价值可选。

### 附带观察（worktree 实况，非 commit 内容）

评审期间 worktree 正在被并行编辑：`fleet-latest-tool.test.ts` 已带 Task 3 的 `brief` 测试（TDD 红，`tsc` 当前编译失败，`FleetWorkerView` 尚无 `brief` 字段）；另有未跟踪的 `fleet-strip-latest-tool.test.ts`。属正常 TDD 节奏，但意味着 worktree 内 `npm test` 此刻红，直到 `brief` 实现落地。

## 待审（watcher 进行中）

- Task 2 Glance 一行：FocusBand ≤80px 预算、无 latest_tool 时完全现状
- Task 3 Inspect 抽屉：`SET_STREAMING` 隔离、`inspectedWorkerId` 生命周期、`tool.start` 单播陷阱（见 `502-ec-kimi-checklist.md` 风险 1）

---

## 附录：增量复审 — Task 2/3（`7cf24c2c` Glance + `060bbe4d` Inspect 抽屉）

> 范围：`d15b9c41..060bbe4d`，11-12 文件，+487/−5。两路独立对抗子代理（CORRECTNESS / SPEC-PRODUCT-UX）+ 仲裁人亲证。
> 总 verdict：**BLOCK（结转）+ 1 新 MAJOR**——两个新 commit 本身质量高，但 Task 1 的 BLOCK 未解且被加深。

### 红线复核（仲裁人亲证）

- **SET_STREAMING 隔离 HELD**：`useWebSocket.ts:416-423`——inspect 分支在 active-thread 闸**之前**，只 `SET_INSPECT_TAIL`（带 800 字 `inspectTailSlice` 截断），`SET_STREAMING` 仍在未改动的 `shouldApplyStreamEvent` 闸后。`chat.reasoning`/`chat.assistant`/`chat.done`/`tool.result` 未动。`tool.progress` 与 INSPECT 零交集（源码锁测试钉死，理由注释「tails may carry secrets」）
- **无 system prompt HELD**：`brief` 由 companion 侧 `firstUserPreviewFromMessages` 只扫 `role==="user"`（`thread-manager.ts:338-348`），空白折叠 + 160 字截断；`system_prompt_append` 在 `config_override` 里、从不持久化为 user 消息——无泄漏路径
- **无新 BottomBar HELD**：tab 注册表零 diff；Inspect 走 `FleetWorkerListPortal` 行内展开；「查看」不切线程（源码锁钉）
- plan 六条 NEVER 全 HELD（overlay / run_progress 硬拒未动 / 无百分比条 / 无 vis 调试器）

### MAJOR-M1（新）：Inspect buffer 生命周期在 portal 关闭 / worker 消失时不清理

亲证：`FleetWorkerList.tsx:316/332/338` 的 Escape/backdrop/onClose 只发 `SET_FLEET_LIST_OPEN:false`，**从不** `CLEAR_INSPECT`。后果：portal 关后 worker 的每条 `chat.token` 仍以 token 速率 dispatch `SET_INSPECT_TAIL`，为一个不可见抽屉重渲所有 store 消费者。800 字有界所以是性能/卫生问题而非污染，但违背清单的清理契约。一行级修复：`SET_FLEET_LIST_OPEN false` 时连带清，或在 `SET_FLEET` 里对 `inspectedWorkerId` 做对账。（worker 完成不清是 E-DONE 声明的刻意设计——「回合结束后仍可展开阅读」——不算违例。）

### BLOCK 结转加深

Task 1 的 BLOCK（`getMessages` = 全文件 `readFileSync`+`JSON.parse`，每 worker 每 4s 轮询）**未修**，且 `060bbe4d` 给同一读路径加了第二个消费者（`brief` 与 `latest_tool` 共用一次 `msgs` 读取，读次数没翻倍，但热路径更根深蒂固）。E-DONE 把它列为「已知缺口…可接受」——评审立场不变：**这不是可接受档**，合并前必须改读路径（mtime 缓存 / 写路径盖章 / tail-read）。

### 干净项

- `tool.start` 单播陷阱**诚实退化**：抽屉显示 `latestTool || w.latest_tool || "—"`，非发起方面板落回轮询快照字段，无假活
- Glance：`llm_active` 优先、无工具时完全现状、meta span nowrap+ellipsis 不换行、`FOCUS_BAND_MAX_PX=80` 未动
- 文案诚实：「最近工具」「本轮输出 · 暂无」——无实时/直播暗示
- reducer 纯函数 + identity 早退；`inspectedWorkerRef` 同步方式与 `activeThreadRef` 一致
- 测试：extension **1373/1373**、companion fleet 8/8；stream-thread-gate 真值表重钉；brief 的 tsc 红已随实现落地转绿

### NIT

1. Glance 回落可显示 idle/paused worker 的过时工具名（fallback 不看 llm_active/paused）——文案中性，误导性低，可选修
2. `inspectTail`（120px 滚动区）嵌在 70vh portal 滚动区内——触控板双滚动陷阱
3. token 窗只含 answer tokens 不含 reasoning（plan 字面如此；长思考期显示「暂无」，E-DONE 已声明）
4. `SET_INSPECT_WORKER` 同 id 早退实际不可达（toggle-off 走 CLEAR_INSPECT）——无害

### 放行条件

1. 修 Task 1 读路径（结转 BLOCK）
2. 补 inspect 清理（M1，一行级）
两者落地后本线转 APPROVE-WITH-NITS。

---

## 附录 2：增量复审 — `ae014446` 修复 commit（写路径盖章 + portal 关闭清 inspect）

> 范围：单 commit，6 文件。一路 CORRECTNESS 对抗子代理（含实证复现）+ 仲裁人亲证关键 claim。
> verdict：**BLOCK**——两个原 finding 均实质修复，但修复引入一条新的确定性 MAJOR。

### 原 finding 处置

- **BLOCK（4s 轮询全文件读）：FIXED**。`buildFleetSnapshot` 现在只读线程元数据（`fleet.ts:91-97`），`getMessages`/`latestToolName` 读路径整体删除；盖章在 `insertMessageAt`（`thread-manager.ts:1200-1211`）——`persistAssistantDraft` 先于工具执行落盘，在飞工具语义保持；`brief` 也改盖章，4s tick 完全无文件 I/O（`countOpenIntents` 只读索引内 `mission_board`）。throwing-`getMessages` fake 测试锁死 tick 路径
- **MAJOR-M1（portal 关闭不清 inspect）：FIXED（关闭路径）**。`SET_FLEET_LIST_OPEN open:false` 在单一收口清 `inspectedWorkerId`/`inspectTokenTail`/`inspectLatestTool`（`agentStore.tsx:1708-1720`），Escape/backdrop/onClose/enterWorker 四路全过此口，真 reducer 测试钉死
- 并发安全：`insertMessageAt` 全同步，盖章与写原子；历史 mid-insert 正确跳过（`at !== length-1`，有测试钉）
- 测试：companion 全量 5143/5143、extension 1374/1374

### 新 MAJOR（仲裁人亲证）：过 1000 消息帽后 `latest_tool` 永久冻结

`thread-manager.ts:1177` 的 `at` 对**裁剪前**长度计算，`:1208` 的盖章守卫 `at === data.messages.length - 1` 对**裁剪后**数组比较。一旦 `trimMessagesTurnSafe` 真裁行，此后每次 append：`at`=1000、裁剪后 `length-1`=999，守卫永假——`latest_tool` 永远停在帽前最后一条。子代理对编译产物实证复现（帽后两次 append，值不变）。长跑 worker 过帽后 Glance 显示永久过时的工具名 = 活活性说谎，正是本字段的产品语义。一行修复：splice 后裁剪前记录 `isAppend`（或身份比较 `data.messages.at(-1) === msg`），补一条帽边测试。仲裁人亲读 `thread-manager.ts:1177-1210`，claim 属实。

### NIT

1. M1 残余：`SET_FLEET` 仍不做对账——portal 开着时被 inspect 的 worker 从快照消失，`inspectedWorkerId` 存活，token 继续喂不可见 buffer 直到关 portal（有界 800 字，影响小）
2. `fleet.ts:20-22` 文档注释仍写「Reverse-scans the thread messages」——盖章后已不真

### 放行条件（更新）

帽冻结一行修复 + 帽边测试落地后，E 线转 APPROVE-WITH-NITS（残余仅 NIT）。

---

## 附录 3：BLOCK 解除 — `340c1fd2` 帽冻结修复（仲裁人亲证）

- `isAppend` 在 splice+trim **之前**捕获（`at === data.messages.length`，`thread-manager.ts:1178-1181`），盖章守卫改用 `isAppend`（`:1212`）——裁剪不再影响判定，帽后 append 正常盖章；历史 mid-insert 仍正确跳过
- 帽边测试已补（fleet-latest-tool 8/8 绿，仲裁人复跑）
- **E 线 verdict 升级：APPROVE-WITH-NITS**（残余 NIT：`SET_FLEET` 无 worker 消失对账、`fleet.ts` 注释过时、Glance 回落可显示 idle worker 过时工具名、嵌套滚动）
