# 对抗复审：worker「卡住」的真因推断 + 修复方案（#569）

## 你的角色

独立高级评审员，**对抗性**立场。这不是审代码 diff，而是审**一份故障归因**：
作者给出一条因果链 + 一组证据 + 修复方案。你的任务是**证伪它**。

**最重要的一条**：作者声称 worker 是被「同工具熔断」处死的。
请优先寻找**别的机制**能更好地解释同样的证据。若找不到，也请明说「未能证伪」。

**你可以且应该实际运行命令、读线程文件、读源码、做实验。**

## 仓库与数据

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- **实跑数据**（本机 0.6.11 真实运行留存）：
  - `~/.cmspark-agent/threads/ibg908.json`（主对话，153 条消息）
  - `~/.cmspark-agent/threads/98z0ri.json`（声称被处死的 worker，20 条）
  - `~/.cmspark-agent/threads/a56ebc.json`（声称被处死的 worker，52 条）
  - `~/.cmspark-agent/threads/p151ef.json`（成功完成的对照 worker）
  - `~/.cmspark-agent/threads/y7l1tj.json`（继续运行的对照 worker）
  - `~/.cmspark-agent/logs/companion-2026-09-30.log`
- 线程文件格式：`{ "messages": [ { thread_id, role, content, id, created_at, tool_calls? } ] }`
  - `role==="tool"` 的 `content` 是 JSON 字符串：`{"success":bool,"error":...,"data":{"error_code":...}}`
  - 每次工具调用的工具名在**该条消息**的 `tool_calls[0].tool_name`
- ⚠️ `/tmp` 在 node 眼里是 `C:\tmp`；用相对路径或 `C:/...` 形式。

## 作者的因果链（逐条验证，不要相信）

1. **用户症状**：对话 `ibg908` 里 4 个 worker 并行调研，**2 个中途无声消失**（无报告、无错误）。
   主 agent 对用户说「部分 worker 似乎卡住了（`evaluate` 在 worker 里是 L2 门控，
   **可能在等确认中心批准**）」，但**确认台什么都没有**。

2. **作者称主 agent 的归因是错的**：日志里 `security.confirmation.requested` 出现 **0 次**，
   `L2_ADMISSION_TIMEOUT` / `UNATTENDED_CONFIRM_DENIED` 也是 **0 次**
   （请**独立复核**这三个计数）。

3. **作者称真因是「同工具熔断」**：
   - `companion/src/llm/adapter.ts:256` `MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3`
   - 成功会归零：`adapter.ts:1988` `recoverableFailureCounts.delete(toolName)`
   - 计数：`adapter.ts:2170-2171`
   - `SITE_OP_BANNED` / `SITE_OP_ESCALATE` **不消耗预算**（`adapter.ts:2168` 的 `if` 守卫）
   - 判定 `llm/same-tool-guard.ts:34-46`：`failCount < 3` → count；
     否则若是 **locator 类**（`ELEMENT_NOT_FOUND`/`ELEMENT_AMBIGUOUS`/`SELECTOR_OR_TEXT_REQUIRED`/`INVALID_SELECTOR`，
     `same-tool-guard.ts:8-13`）→ **pivot**（换路、计数归零）；
     **否则 → stop** → `adapter.ts:2208-2216` `shouldStop = true` + `terminal = "circuit_breaker"`
     → **整个回合立即结束**。

4. **作者给出的证据（请独立复算）**：

   ```
   98z0ri 末 10 条工具结果
     04:40:28  evaluate  ✓            ← 成功，计数归零
     04:40:30  evaluate  ✗ EVALUATE_NULL_RESULT   1
     04:40:30  evaluate  ✗ EVALUATE_NULL_RESULT   2
     04:40:31  evaluate  ✗ SITE_OP_BANNED        ← 不计预算
     04:40:37  evaluate  ✗ EVALUATE_NULL_RESULT   3  → stop
     （之后线程无任何消息）

   a56ebc 末 4 条 evaluate
     04:41:15  evaluate  ✓
     04:41:15  evaluate  ✗ TAB_LEASE_CAP       1
     04:41:28  evaluate  ✗ EVALUATE_NULL_RESULT  2
     04:41:35  evaluate  ✗ TAB_LEASE_CAP       3  → stop
   ```

   作者结论：两个 worker 都**精确死在计数到 3 的那一刻**，且最后一条消息就是那次失败。

5. **作者称这三个码的「等级」都不是原因**（`EVALUATE_NULL_RESULT` / `TAB_LEASE_CAP` 经
   `classifyError` 都是 `recoverable`），所以它们**不走** `non_recoverable`/`shouldStop` 分支，
   **而是走熔断分支**。请独立复核这两个码的等级（`companion/dist/security.js` 的 `ERROR_CODE_LEVELS`）。

6. **作者称三个结构性缺口**：
   - ① `runStats.terminal` 在 adapter 里 10+ 处赋值，但**既不写日志也不写线程** ——
     全仓没有 `ended_reason` / `halt_reason` 之类的持久化字段。请**独立搜索**是否真的没有。
   - ② `companion/src/orchestrator/fleet.ts:16` 的状态枚举
     `"idle" | "paused" | "holding_tabs" | "unknown"` **没有「已结束」**；
     判定（`fleet.ts:102-106`）只看标签锁与暂停位 ⇒ **被处死的 worker 与空闲 worker 显示相同**。
   - ③ `adapter.ts:2000-2005` 的 `llm.tool_failed` 日志**不含 `thread_id`** ⇒ 多 worker 下无法归因。

## 请你重点做的事

### P0 — 证伪尝试（最重要）
- **复算时间线**：自己写脚本，从 `98z0ri.json` / `a56ebc.json` 提取**完整的工具结果序列**，
  按「成功归零、SITE_OP_BANNED/ESCALATE 不计、连续同类计数」的规则**手工重放计数**。
  作者的「第 3 次」结论成立吗？两条都成立吗？
- **找别的解释**，至少排查这些：
  - `MAX_TOOL_CALL_ROUNDS = 100`（`adapter.ts`）—— worker 是否其实是撞了轮数上限？
    （请数每条线程的**轮次**，注意一轮可能含多个工具调用）
  - 是否可能是 LLM 侧错误 / 断连 / 超时结束的回合？（日志里 `llm.usage` 的 `round` 字段可用）
  - 是否可能是 `wait_workers` / `collect_handback` 提前收工？
  - 是否可能是 `p151ef` 的 `collect_handback` 把别人「收」掉了？（`HANDBACK_MISSING_STRUCTURE` 出现在主线程）
  - 有没有可能 worker 其实**还在跑**、只是不再写消息（例如卡在某个 await）？
    证据：线程文件 mtime 与最后消息时间的关系。
- **交叉核对**：`y7l1tj`（继续跑）与 `p151ef`（成功）的计数轨迹，是否**反证**了作者的规则？
  （如果它们的连续失败也到了 3 却没死，作者的规则就是错的）

### P1 — 证据与行号
- 作者引用的**每个行号**是否准确？（`adapter.ts` 的 256/1988/2170/2171/2168/2208/2216/2000-2005；
  `same-tool-guard.ts` 的 8-13/34-46；`fleet.ts` 的 16/102-106）
- `security.confirmation.requested` 等三个计数是否真的为 0？
- `EVALUATE_NULL_RESULT` 与 `TAB_LEASE_CAP` 的实际等级？

### P2 — 修复方案是否成立
作者提议（按性价比）：
1. **给 worker 终止留痕**：回合结束时把 `terminal` 落到线程（如 `last_run_terminal` + `ended_at`），
   `list_workers` / `wait_workers` 一并返回
2. **`fleet.status` 增加「已结束」语义**：`llm_active === false` 且未 handback 且过宽限期 → `ended`（含原因）
3. **`llm.tool_failed` 补 `thread_id`**（一行）
4. （可选）熔断处死 worker 时**告知父线程**

请判断：
- ① 在**代码结构上**可行吗？`runStats.terminal` 被赋值的地方，能不能拿到 `threadManager` /
  线程对象来写？写到哪里（线程对象？新增字段？）会不会破坏 schema / 并发写？
- ② 的「已结束」判据会不会**误判**（例如 worker 只是慢、或在等 LLM 响应）？宽限期该怎么定？
- 有没有**更小、更安全**的等价修法？有没有作者没想到的**副作用**（例如 daemon 重启后状态丢失）？
- 这四条里，哪一条是**必须**、哪一条可以缓？

### P3 — 影响面
- 作者称「`evaluate` 在 CSP 页面返回 null 很常见，所以这是**结构性脆弱**」。请评估该说法是否成立
  （从本次数据看，8 次 `EVALUATE_NULL_RESULT` 发生在几个 worker 上？）
- 作者称「#548 相邻但不同」：请核实该判断（#548 讲 pivot 该发生时没发生；本票讲不该 stop 时 stop 了）。
  `gh issue view 548` 可用。

## 可用命令

- 数据解析建议：`node -e "..."`（PATH 缺 `C:\nvm4w\nodejs` 会报 node not found）
- `cd companion && npm run build` 后可用 `import('file:///C:/Users/HuChen/Projects/cmspark/companion/dist/security.js')`
- 日志计数：`grep -c` on `~/.cmspark-agent/logs/companion-2026-09-30.log`
- 若 bash 报 `pipefail invalid option`，说明 `C:\WINDOWS\system32` 在 `/usr/bin` 前

## 硬性规则

1. **实际运行命令**，不要只读代码就下结论。
2. 每条 finding 带 `文件:行号` 或 `数据文件:证据`。
3. **未能证伪就明说「未能证伪」**，不要为了显得严格而编造反例。
4. 区分：验证过 / 推断 / 没能验证。
5. 若作者的因果链**错了**，请给出**你的**机制并附能区分两者的证据。

## 输出格式

```
## BLOCKING（作者的结论错在哪 / 方案有硬伤）
- [P0|P1|P2] 位置 — 问题 / 你的证据

## NITS

## 未能验证

## 已核实为正确的声明（含你复算出的数字）

## 对四条修法的裁决：必须 / 可缓 / 应改为…
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT
