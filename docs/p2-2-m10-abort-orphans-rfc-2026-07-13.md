# P2-2 M10 — abort 孤儿消息：根因 + 修复 fork

> **状态**: 🟡 待 kimi 裁决 · **日期**: 2026-07-13
> **范围**: companion `src/llm/adapter.ts`（+ 可能 `thread-manager.ts` 已有能力复用）· **风险**: 中（触及持久化消息一致性）

---

## 1. grounding：abort 流（全 `[inspected]`）

**信号源**：`message-router.ts:33` per-thread `AbortController`；`chat.abort`（:547）→ `controller.abort()`；新 chat（:287）先 abort 旧的。signal 传给 adapter（`adapter.ts:60` params.signal / `message-router.ts:344`）。

**adapter abort 传播**（`adapter.ts`）：
- LLM 流式 `client.chat.completions.create(..., { signal })`（:315）。abort 时 `for await (chunk)` 抛 `AbortError` → 被 round-loop catch（:747）→ `:748 if (AbortError || signal?.aborted) throw e` 重抛 → 传到 `message-router.ts:347` → 发 `chat.aborted`。**干净，无孤儿**（assistant 消息 :370 未到达）。
- 工具执行 `await executeTool(tc.id, toolName, {...}, signal)`（:477-480）。**关键**：`executeTool`（`server.ts:209` createToolExecutor）**不在顶部查 `signal.aborted`**；signal 只透传给 MCP（`executeMcpTool(..., signal)` :689 → `manager.callTool(route, params, signal)` :1240，MCP 工具**会**抛 abort）。bridge 工具走 WS round-trip（await extension 响应），**不查 signal** → abort 后仍完成返回。
- 工具异常 catch（`:717`）：**吞掉所有异常**（含 AbortError）→ `addMessage(:725)` 错误 tool 结果 + `shouldStop = true` + `break`。**不重抛**。

**调用侧**（`message-router.ts:346-354`）：catch AbortError/signal.aborted → 发 `chat.aborted`；else 发 `chat.error`。

## 2. 孤儿机制（root cause）

assistant 消息在流结束后**立即持久化**（`:370 threadManager.addMessage`，含全部 N 个 `tool_calls`），**然后**才进 tool 循环（`:408 for (const tc of assistantMsg)`）逐个执行+持久化 tool 结果（:424/:458/:585/:725）。

tool 循环**早退**时（`shouldStop` at `:731` break），剩余 tool_calls **无持久化结果**。此时持久化态 = **assistant 消息带 N 个 tool_calls，只有 M<N 个结果**。下次该 thread 发消息，这段历史送 LLM → OpenAI **400 structural error**（tool_calls 缺配对结果）。

早退触发条件：
- **abort 期间执行 MCP 工具**：MCP 工具抛 AbortError → :717 吞 → shouldStop → break。多 tool_call 时 orphan。（bridge 工具不抛 abort，会跑完，下轮 create() 才 abort——干净。）
- **任意工具真异常**（非 abort）：:717 吞 → shouldStop → break。**同样 orphan**——所以 orphan 不限于 abort，是多-tool 早退的通病。

`shouldStop` 块（`:736-742`）只 `messages.pop()`（**内存**数组），**不回滚持久化**的 assistant 消息 → orphan 留在磁盘。

## 3. 可用能力

`thread-manager.ts:355 deleteMessagesFrom(threadId, messageId)`：删该 id 消息**及其后全部**（slice(0, idx) + atomicWriteJSON）。`addMessage`（:296）返回含 `id` 的 Message。→ **有现成 rollback 能力**：拿到 `savedAssistant.id`（:370），abort 时 `deleteMessagesFrom(threadId, savedAssistant.id)` 即可回滚整轮持久化（assistant + 部分结果）。

## 4. 设计 fork

| Fork | 选项 | 我的推荐 |
|---|---|---|
| **F1 abort-during-streaming 部分回复** | (a) 丢弃（现状，UI 已 chat.token 显示但 DB 无→reload 丢） / (b) catch 里持久化非空 `assistantContent` 为 text-only assistant 消息（保住部分回复） | **(b)**——plan 明确担心「丢部分 assistant 回复」；用户看到流式文字，reload 消失是 UX 倒退。text-only（丢半截 tool_calls）保持一致性 |
| **F2 abort/早退后持久化态** | (a) rollback：`deleteMessagesFrom(savedAssistant.id)` 回滚整轮 / (b) synthesize：给未跑的 tool_calls 补占位结果（"aborted"）使 N=M / (c) 现状（留 orphan） | **(a) rollback**——最干净，复用现成 `deleteMessagesFrom`；synthesize 引入假数据语义；现状就是 bug |
| **F3 abort 传播** | (a) tool catch（:717）查 `signal?.aborted`/AbortError 时**重抛**（如 :748），让 message-router 发 `chat.aborted` / (b) 现状（吞成 tool error + `chat.done`） | **(a)**——abort 应表现为 abort（chat.aborted），不是误导的 tool 异常 + chat.done |
| **F4 scope** | (a) 仅修 abort 路径 / (b) 连带修非-abort 异常 orphan（shouldStop 多-tool 早退通用问题） | **(a) 仅 abort**——M10 框架是 abort；非-abort 异常 orphan 是独立 follow-up（避免 scope 膨胀，META 2.1）。**但** F2 的 rollback 机制天然对两者都适用，若 kimi 觉得顺手可扩到 shouldStop 通用路径 |

## 5. 推荐实现（采纳 F1-b / F2-a / F3-a / F4-a 时）

```ts
// adapter.ts，round-loop try 内，:370 处提升 savedAssistantId 到 try 外层可见
let savedAssistantId: string | undefined
// ...
const savedAssistant = threadManager.addMessage(threadId, savedMsg)  // :370
savedAssistantId = savedAssistant.id
```

```ts
// tool 循环顶部（:408 for 内首行）：abort 即停，不再持久化更多部分结果
if (signal?.aborted) break
```

```ts
// tool 异常 catch（:717）：abort 重抛（F3-a）
} catch (e: any) {
  if (e.name === "AbortError" || signal?.aborted) throw e   // 传播，不再 shouldStop
  // ... 原异常处理（shouldStop 等，非-abort 路径不变） ...
}
```

```ts
// round-loop catch（:747）abort 分支：rollback + (F1-b) 保部分回复，再重抛
} catch (e: any) {
  if (e.name === "AbortError" || signal?.aborted) {
    if (savedAssistantId) {
      threadManager.deleteMessagesFrom(threadId, savedAssistantId)  // F2-a rollback
    }
    // F1-b: 流式 abort（savedAssistantId 未设）且有非空部分内容 → 保为 text-only
    if (!savedAssistantId && assistantContent && assistantContent.trim()) {
      threadManager.addMessage(threadId, { thread_id: threadId, role: "assistant", content: assistantContent })
    }
    throw e
  }
  // ... 原错误恢复 ...
}
```

**注意**：`assistantContent` 当前在 try 内（:317）声明；F1-b 需提升到与 `savedAssistantId` 同层（try 外、round-loop try 内）。

**测试**：
- 单元/集成：mock threadManager，abort 后断言 `deleteMessagesFrom` 被调（rollback）；多-tool abort 后线程无 dangling tool_calls（重新加载线程，assistant 消息要么无 tool_calls 要么 tool_calls 全有结果）。
- 现有 adapter 测试基线不回归。

## 6. 待 kimi 裁决

1. **F1**：abort-during-streaming 时，持久化非空部分回复（b）还是丢弃（a）？
2. **F2**：abort 后用 `deleteMessagesFrom` rollback（a）？认可复用该 API？
3. **F3**：tool catch 重抛 abort 让发 `chat.aborted`（a）？
4. **F4**：scope 仅 abort（a）还是扩到通用 shouldStop 异常 orphan（b）？
5. 实现草案（§5）是否有遗漏的 race（如 rollback 与并发同 thread 操作）？

请逐项裁决或给整体 GO/NEEDS-FIX。
