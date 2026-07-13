# RFC · P2-3 M20 — LLM 并发 + usage 记录 + 预算

> **日期**: 2026-07-13 · **Finding**: M20 (`docs/optimization-plan-post-v0.3.0.md:68`)
> **状态**: ✅ 已闭环（PR #55）— kimi 裁决 F1-a/F2-a/F4-0/F5 no-op + 终审 GO

## 0. 裁决与终审结果（kimi）

**设计裁决**：

| 项 | 选择 | 说明 |
|---|---|---|
| **F1** | **F1-a** | 保持 abort-and-replace（刻意的 chat UX：新消息取代在跑的旧请求），仅在 abort 点加 `llm.thread_request_superseded` 可观测日志。不引入 queue / reject（两者均 UX 退化）。 |
| **F2** | **F2-a** | 仅日志（JSONL，`logEvent`），不做 schema/持久化变更——贴合 M20 字面"日志记"；持久化/聚合留待 P4"成本面深化"。 |
| **F4** | **F4-0** | M20 **不含** `daily_token_budget`，整体 defer 至 P4。budget 是 net-new 策略（block vs warn / in-memory vs 持久 / global vs per-thread / reset 边界），需 usage 数据先跑起来；P2-3"成本可观测"由 F2-a 满足。 |
| **F5** | **no-op** | `adapter.ts:593-596` 今日已在 `toolResult.success` 时重置 `continuousFailures = 0`（+ `recoverableFailureCounts.delete`）。M20 此项无需改动。 |

**实现**（`companion/src/llm/adapter.ts` + `message-router.ts`，companion-only，零行为变更）：
- `chatCreate` 流式调用加 `stream_options: { include_usage: true }`；`for await` 循环捕获终末 `chunk.usage`（OpenAI 兼容：终末 chunk 空 choices 带 usage）；循环后仅当 `total_tokens !== undefined` 时 `logger.info("llm.usage", {thread_id, model, kind:"chat", round, prompt/completion/total_tokens, reasoning_tokens?})`。
- `generateThreadTitle`（非流式）捕获 `response.usage`，记 `kind:"title"`（无 round）。
- 无 usage（provider 不支持 / 流被 abort 中断）→ 不抛、不记。
- `message-router` abort-and-replace 点记 `logger.info("llm.thread_request_superseded", {thread_id})`。

**我加的 refinement**（独立审，kimi 只覆盖了 `chat.create` abort 点）：同一 abort-and-replace 模式还存在于 `chat.regenerate`（:622）+ `file.upload`（:456），两处也补 `llm.thread_request_superseded`——否则该可观测信号 undercount（regenerate/upload 触发的取代不可见）。同模式 2 行，bounded，F1-a 范围内。

**验证**（独立复跑，非 kimi 沙箱）：tsc prod+test clean；focused `adapter-usage.test.js` **5/5**；全量 `npm test` **857 测 / 856 pass / 1 skip / 0 fail** + settings-web/cli 15/15（baseline 852 + 5 新）。

---

## 0.5. Grounding（已独立核验）

| 关注点 | 现状 | 位置 |
|---|---|---|
| `stream_options.include_usage` | 未设 | `adapter.ts:311-318` |
| `chunk.usage` 解析 | 从不读；循环只读 `choices[0].delta`（content/reasoning_content/tool_calls） | `adapter.ts:323-362` |
| title-gen（非流式）usage | `response.usage` 丢弃 | `adapter.ts:882-894` |
| per-thread 并发结构 | 仅 `Map<threadId, AbortController>`（单例），无 queue/mutex | `message-router.ts:33` |
| 并发策略 | **abort-and-replace**：B 到达时 abort A 的 controller、覆写 map；A 收 AbortError 走 rollback。B 不等 A。即"瞬时双活（A 收尾+B 起步），但从无两个 *新* 请求并行" | `message-router.ts:290-298`（chat.create）+ `:620-627`（regenerate）+ `:454-461`（file.upload） |
| `continuousFailures` | `chatCreate` 局部变量；声明 `:301`，**成功重置 `:595`**（toolResult.success 时），自增 `:813`（LLM API error catch），达 5 在 `:819` 暂停 | `adapter.ts` |
| config LLM 字段 | `llm.{base_url, api_key, model_name, temperature, context_window}`；**无** daily_token_budget / 任何 token 字段 | `config.ts:72-78`, `103-109` |
| token 持久化 | **无**；`operations` 表无 token 列；无 usage 表/文件 | `history/store.ts:290-300` |
| `logEvent` 记 usage | 从不（grep `usage|prompt_tokens|completion_tokens|total_tokens|include_usage|stream_options` 全 companion 零命中） | — |

**关键结论**：
1. token usage（chat 流式 + title-gen）今日**全部丢弃**——`include_usage` 没开，`chunk.usage` 没读。
2. **"成功重置 continuousFailures" 今日已实现**（`adapter.ts:595`，tool 成功即重置）。M20 此项疑似 no-op（待 kimi 确认意图）。
3. **"per-thread in-flight cap(1)" 今日由 abort-and-replace 实质满足**——同一 thread 任一时刻至多一个"新"请求在推进；B 到达即 abort A。这不是 queue（B 不排队等 A），是"新消息取代旧消息"的常见 chat UX。

## 1. M20 原文

> "LLM 并发+usage+预算 | M20 | per-thread in-flight cap(1)；日志记 `usage.total_tokens`；可选 `daily_token_budget`；成功重置 continuousFailures | 1d"

## 2. 设计分叉（请 kimi 裁决）

### F1 — 并发模型（per-thread in-flight cap(1)）

| 选项 | 机制 | 评价 |
|---|---|---|
| **F1-a**（推荐）保持 abort-and-replace，仅加可观测 | 现状（B abort A）；在 abort 点加结构化日志 `llm.thread_request_superseded`（thread_id、aborted_round）使"取代"可见 | **proportionate**：abort-and-replace 是刻意的 chat UX（用户发新消息应取代在跑的旧请求，而非排队卡 UI）；"cap(1)" 意（至多一个新请求推进）已满足。零行为变更 |
| F1-b 真 per-thread promise queue | B 入队等 A 完成才跑，不 abort | UX 退化：连发两条会串行卡住；且 abort 语义（chat.abort 按钮）需重设计 |
| F1-c 拒绝并发 | A 在跑时 B 返 "thread busy" error | UX 退化：用户必须等 |

**推荐 F1-a**。请裁决。

### F2 — usage 记录面（log-only vs 持久化）

| 选项 | 机制 | 评价 |
|---|---|---|
| **F2-a**（推荐）仅日志 | `logEvent("llm.usage", {...})` 落 JSONL（queryable via grep/`jq`） | **贴合 M20 字面"日志记"**；零 schema/迁移；P4"成本面深化 基于 P2-3 的 usage 数据做配额/告警"自然承接持久化/聚合 |
| F2-b 也持久化 history.db | 加 `llm_usage` 表或 operations 加 token 列 | 超出 M20 范围（schema 变更 + 迁移）；与 P4 重叠；当前无消费方 |

**推荐 F2-a**（defer 持久化至 P4）。请裁决。

### F3 — usage 捕获覆盖面（无分叉，确认）

两处都捕获：
- **chat 流式**（`adapter.ts:311`）：加 `stream_options: { include_usage: true }`；在 `for await` 末尾读终末 `chunk.usage`（OpenAI 兼容：最后一个 chunk 带 `usage` + 空 choices）。
- **title-gen 非流式**（`adapter.ts:882`）：直接读 `response.usage`。
- 日志字段：`{ event: "llm.usage", thread_id, model, kind: "chat"|"title", round?, prompt_tokens, completion_tokens, total_tokens, reasoning_tokens? }`。
- **健壮性**：`include_usage` 非所有 provider 必支持（DeepSeek 支持）；终末 chunk 可能无 `usage`（流被中断/abort）→ `chunk.usage` 可能 undefined → 仅在有值时记，永不抛。

### F4 — daily_token_budget

| 选项 | 机制 | 评价 |
|---|---|---|
| **F4-0**（推荐）M20 不含 budget，defer 至 P4 | usage 数据先跑起来；budget 是 net-new 策略，需独立设计（block vs warn、in-memory vs 持久、global vs per-thread、reset 边界） | **proportionate + 单一职责**：P2-3 "成本可观测" 由 F2-a 满足；budget 执罚属 P4"成本面深化"；M20 字面"可选"=可推迟 |
| F4-a in-memory daily 累计 + 超限 block | `Map<utcDateKey, number>`，UTC 零点重置；超限返 `chat.error` 阻断 | 重启即丢（crash-loop 可超预算）；可选字段故可接受 |
| F4-b 持久 daily 累计 + 超限 block | 文件或 history.db | 更正确但超 M20 范围 |

**推荐 F4-0**（M20 = 纯观测；budget 整体 defer 至 P4）。**若 kimi 要求 M20 含 budget**，我推荐 F4-a（in-memory + block，与 M8 一致 UTC 零点重置）。请裁决。

### F5 — continuousFailures 重置（确认 no-op？）

grounding 证 `adapter.ts:595` 今日已 `continuousFailures = 0`（tool 成功时）。M20 此项疑似已满足。**请 kimi 确认**：是 (a) no-op（已在早期 PR 实现，M20 标注即可），还是 (b) 意图是"LLM round 成功（无 API error 完成一轮）即重置"而非"tool 成功"——若是 (b) 需补一处重置点。

## 3. 推荐方案（整体，待 kimi 裁决后定稿）

```
M20 = 纯成本可观测（companion-only，零行为变更）：

1. adapter.ts:311 chatCreate 流式调用加 stream_options:{include_usage:true}
2. adapter.ts:323 for-await 循环：捕获终末 chunk.usage（仅当有值）
3. adapter.ts:882 generateThreadTitle：捕获 response.usage
4. 两处 logEvent("llm.usage", {thread_id, model, kind, prompt/completion/total_tokens, ...})
5. （F1-a）message-router.ts:292 abort-and-replace 点加 logEvent("llm.thread_request_superseded")
6. continuousFailures：确认 F5（多半 no-op）
7. daily_token_budget：F4-0 defer 至 P4（除非 kimi 要求含）

测试：
- adapter-usage.test.ts：fake stream 喂带 usage 的终末 chunk → logEvent 被调且字段正确；
  无 usage 的终末 chunk（abort/不支持）→ 不抛、不记；
  title-gen usage 捕获。
- 全量 npm test 绿（baseline 852）。
```

## 4. 非目标

- 不做 usage 持久化/聚合/告警（P4"成本面深化"）。
- 不改并发模型为 queue/reject（保持 abort-and-replace UX）。
- 不做 budget 执罚（除非 kimi 裁决含）。
- 不改 `continuousFailures` 语义（除非 F5=b）。
