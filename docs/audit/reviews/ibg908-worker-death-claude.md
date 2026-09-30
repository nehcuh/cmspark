diag: claude=/c/nvm4w/nodejs/claude
diag: started=2026-09-30T04:58:17Z
全部证据链闭合。`classifyError` 默认返回 `non_recoverable`（`security.ts:1313`）——这让 `EVALUATE_NULL_RESULT` 的等级完全悬在文案含 "script evaluation failed" 上。评审结论如下：

---

## BLOCKING（作者的结论错在哪 / 方案有硬伤）

**无。未能证伪。** 作者的因果链（同工具熔断处死）经独立重放与日志交叉验证成立，且是唯一能同时解释全部证据的机制。我的证伪尝试逐条失败：

1. **独立重放**（自写脚本 `scratch/rev569-replay.js`，按 adapter 规则：成功 delete 归零、`SITE_OP_BANNED/ESCALATE` 跳过、per-toolName 计数、非 locator 码无 pivot）：
   - `98z0ri`：stop 判定落在 `2026-09-30T04:40:37.515Z` = 线程最后一条消息（第 19/19 条）。轨迹 `NULL(1)→NULL(2)→SITE_OP_BANNED(跳过)→NULL(3)→stop`，与作者表格一致（作者省略了中间的 create_tab/get_page_text 成功——不影响 evaluate 计数，省略正确）。
   - `a56ebc`：stop 落在 `04:41:35.251Z` = 最后一条（第 51/51 条）。轨迹 `EVAL_THROWN(1)→✓(归零)→TAB_LEASE_CAP(1)→NULL(2)→TAB_LEASE_CAP(3)→stop`。作者省略 04:40:59 的 EVAL_THROWN 是对的——它被 04:41:15 的成功归零。
2. **运行时日志互证**：全日志恰好 2 条 `llm.recoverable_loop_detected`（`fail_count:3`），时间 04:40:37.532Z / 04:41:35.269Z，与两线程最后写入差 17/18ms；同刻 `llm.error_classified error_level:"recoverable"`。线程文件 mtime 精确到毫秒吻合最后写入（98z0ri=12:40:37.516+0800，a56ebc=12:41:35.252+0800），**此后零写入**。
3. **备择机制逐一排除**（全部 [executed]）：
   - 轮数上限：98z0ri 最高 round=9、a56ebc=15 ≪ 100（`llm.usage` 逐轮扫描）。
   - LLM 侧错误/断连：`failure_limit_reached`=0、`recoverable_api_error`=0；致死轮的 `llm.usage` 正常落账。
   - 确认台等待：`security.confirmation.requested`=0、`L2_ADMISSION_TIMEOUT`=0、`UNATTENDED_CONFIRM_DENIED`=0（grep -c 复核）；同期每次 evaluate 都是 `security.auto_approved reason=god_mode` + `critical_api_waived reason=full_autonomy_cruise`。**主 agent 的归因确认错误。**
   - `collect_handback` 收走 worker：collect 全部发生在死亡之后（04:41:50+，`ibg908.json` 索引 99/100/104），且语义只读；`HANDBACK_MISSING_STRUCTURE`（索引 100）是死亡的**结果**而非原因——被杀 worker 没来得及写 handback。
   - 用户 abort / 暂停：全日志 0 条 abort/worker_cancel/pause 事件。
   - 卡在 await 假活：死后两线程在日志中零提及（post-kill 扫描 = 0 条），mtime 冻结。
4. **对照组无反例**：`p151ef` 同工具计数峰=1（成功收工）；`y7l1tj` 峰=2 后被成功归零，活到 round 65（04:45:16 仍在写）。全天没有任何线程「到 3 而未死」——作者的规则未被反证。

## NITS

- [P1] `adapter.ts:2169` — `SITE_OP_BANNED/ESCALATE` 预算守卫的 `if` 在 2169 行，作者引 2168（是注释行）。其余全部行号逐一对上：adapter 256/1988/2170-2171/2208/2216/2000-2005 ✓、same-tool-guard 8-13/34-46 ✓、fleet 16/102-106 ✓。
- [P1] `EVALUATE_NULL_RESULT` 的等级机制与作者所述不同：它**不在** `ERROR_CODE_LEVELS`（实测 Map size=109，查无此码；`TAB_LEASE_CAP`→recoverable 在）。其 recoverable 来自文案兜底子串 `"script evaluation failed"`（`security.ts:1198`），而 `classifyError` 默认返回 `non_recoverable`（`security.ts:1313`）。结论对、机制错——且这是真实的潜在脆弱点：将来改一条报错文案，等级就静默翻成 `non_recoverable` 走 `security_halt`（比熔断更狠）。建议本票顺手补一行 `["EVALUATE_NULL_RESULT","recoverable"]`（#560 已标记此类未收口码）。
- [P1] 作者漏了更大的一处：致死事件本身 `llm.recoverable_loop_detected`（`adapter.ts:2209-2214`）**也没有 thread_id**——本次事故里最具诊断价值的日志无法归因到线程，比 `llm.tool_failed` 缺失更伤。修法③应两处一起补。
- [P2] 修法①的落点要避开一个坑：不能写进 `onLoopRunFinished`——它对 worker 直接 return（`loop-kernel.ts:295`），所以 worker 从未进过 task_loop 审计（`task_loop.paused reason=circuit_breaker` 只对 loop-armed 非worker 线程存在）。正确落点是 `message-router.ts:1442-1467` 区块（`runStats` 终值 + `threadManager` 都在作用域内；worker 跑完会走到这里——1468 的 #514 fleet 广播即证）。

## 未能验证

- GitHub #548 原文（本机无 `gh`，WebFetch 未授权）。但「相邻但不同」已由本地材料核实：`memory/session.md:208`、`CHANGELOG.md:51`、`docs/audit/reviews/069-pull-20260927/pr-549-kimi.md:1074`——#548 = site-op 按 locator 在第 2 次拦截发 `SITE_OP_BANNED`（预算豁免）→ 同工具计数到不了 3 → pivot 在其声称场景不可达；#569 = 非 locator 码（pivot **设计上就不适用**）到 3 直接 stop。两票机制正交，判断成立。旁证：全天 `locator_pivot` 触发 0 次；98z0ri 里 `SITE_OP_BANNED`（04:40:31）正是 #548 机制的现场直播，预算豁免让死刑晚一步落在了别的码上。
- 扩展端是否收到并渲染了熔断 `chat.error`（`adapter.ts:2236`，带 thread_id 的帧）：只验了发送侧代码，帧在扩展 UI 的呈现无法从留存数据验证。

## 已核实为正确的声明（含你复算出的数字）

- 三计数 = 0/0/0 [executed，grep -c]。
- 两条死亡时间线（含计数 1→2→跳过→3）逐条复算一致 [executed]。
- 两码等级均为 recoverable（结论对；`TAB_LEASE_CAP` 经码表、`EVALUATE_NULL_RESULT` 经文案兜底——运行时 `llm.error_classified` 两条均记 `recoverable`）[executed]。
- 缺口①：`runStats.terminal` 在 adapter 14 处赋值（作者称 10+ ✓）；全仓无 `ended_reason`/`halt_reason`/`last_run_terminal`；`broadcastLoopStatus`（`message-router.ts:479-511`）只发帧不落盘 [inspected+grep]。
- 缺口②：`fleet.ts:16` 枚举无「已结束」；102-106 判定只看锁与暂停位；死亡 worker 租约被释放（fleet.ts:81-86）后显示 `idle`，与从未跑过的 worker 无异 [inspected]。（补充：快照里有 `llm_active` 字段 `fleet.ts:123`，区分所需的数据其实在，缺的只是语义。）
- 缺口③：`llm.tool_failed`（2000-2005）无 thread_id，而 `threadId` 在作用域内（:2022 即在用）[inspected]。
- 「8 次 `EVALUATE_NULL_RESULT`」：复算 = 98z0ri 3 + a56ebc 1 + ibg908 2 + y7l1tj 2 = 8，发生在 **4 条不同线程**、同一个 5 分钟窗口内——「结构性脆弱」成立（但其中 6 次并未致死；致死需要 per-tool 连续到 3）。
- 一个作者没点破的加重因素：98z0ri 的预算有 **2/3 在同一轮烧掉**（04:40:30 同一条 assistant 消息里两个并行重复 evaluate，相隔 40ms，各自计数）——并行重复调用各自消耗预算，一轮就能花光 3 次预算。改不改属 stop 策略的产品决策，但值得写进 #569。

## 对四条修法的裁决：必须 / 可缓 / 应改为…

1. **worker 终止留痕 — 必须（承重墙）**。结构上可行：写点放 `message-router.ts:1467` 旁（所有路径的 terminal 终值 + `services.threadManager` 都在；**勿**放 `onLoopRunFinished` 内，worker 在 `loop-kernel.ts:295` 被 early-return）。写法用现成 `threadManager.update(threadId, {last_run_terminal, ended_at})`（`thread-manager.ts:922`），与 `paused`/`latest_tool`/`brief` 同模式——index JSON 持久化新增可选字段无 schema 破坏，并发安全性与现有 stamping 相同；且因为是 run-end 即时写，**daemon 重启不丢**。`list_workers`/`wait_workers` 返回是顺路（`companion-dispatch.ts:906-912` 显式 map 加两字段）；记得同步 `tool-definitions-catalog.json` 的工具描述，否则模型不知道新字段。
2. **fleet「已结束」语义 — 可缓，且应改为基于①的持久化字段而非纯启发式**。`llm_active` 覆盖整个 run（含工具执行与确认等待），故 `llm_active===false` 在进程内确是「无在跑 run」；但它分不清「正常收工」与「被处死」，daemon 重启后 in-memory 集合为空会全量误报。有了①，`ended+原因`直接从线程记录读，宽限期只需覆盖帧延迟（秒级），无需为「可能还在跑」留长宽限。
3. **`llm.tool_failed` 补 thread_id — 必须（一行）**；应扩为两处：`llm.recoverable_loop_detected`（:2209）一并补。
4. **熔断时告知父线程 — 可缓**。扩展端其实已收到带 thread_id 的 `chat.error`（:2236），缺的是父线程视角；等①落地后让 `wait_workers` 携带终止原因，比主动向父线程注消息更便宜、不刷屏。

**总评**：作者的诊断在机制、时间线、行号、结构性缺口四个层面全部经得起对抗复核，排除清单完备；修复方向正确，唯落点与依赖关系需按上述微调。

VERDICT: APPROVE_WITH_NITS
CLAUDE_EXIT=0
diag: finished=2026-09-30T05:13:20Z
