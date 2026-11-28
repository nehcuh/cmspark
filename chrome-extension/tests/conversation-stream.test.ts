import { initialState } from "../src/sidepanel/store/agentStore"
import assert from "node:assert/strict"
import test from "node:test"
import { mountPanel } from "./helpers/mount-sidepanel"

test("late tokens, reasoning and completion from A never appear in B or its cached history", () => {
  const panel = mountPanel()
  panel.select("A")
  panel.receive({ type: "chat.token", thread_id: "A", content: "earlier A" })
  panel.select("B", false)
  panel.receive({ type: "chat.user", thread_id: "B", message_id: "ask", content: "B question" }, false)
  panel.receive({ type: "chat.token", thread_id: "A", content: "private A" }, false)
  panel.receive({ type: "chat.reasoning", thread_id: "A", content: "also private", retrying: true }, false)
  assert.equal(panel.state().streamingContent, "")
  assert.equal(panel.state().streamingReasoning, "")
  assert.equal(panel.state().threadBusyById.A, true)
  panel.receive({ type: "chat.done", thread_id: "A", message_id: "done-A", finish_reason: "stop" })
  assert.equal(panel.state().isProcessing, true)
  assert.equal(panel.state().threadBusyById.B, true)
  assert.equal(panel.state().threadBusyById.A, undefined)
  assert.deepEqual(panel.state().messages.map(m => m.id), ["ask"])
  panel.select("C")
  panel.select("B")
  assert.deepEqual(panel.state().messages.map(m => m.id), ["ask"])
})

test("B's own stream accumulates and commits before the first render of B", () => {
  const panel = mountPanel()
  panel.select("A")
  panel.select("B", false)
  panel.receive({ type: "chat.token", thread_id: "B", content: "answer" }, false)
  panel.receive({ type: "chat.reasoning", thread_id: "B", text: "thinking", retrying: true }, false)
  assert.equal(panel.state().streamingContent, "answer")
  assert.equal(panel.state().streamingReasoning, "thinking")
  assert.match(panel.state().processingStatus ?? "", /重试/)
  const sources = [{ id: "doc", title: "document", chars: 7 }]
  panel.receive({ type: "chat.done", thread_id: "B", message_id: "persisted", truncated: true,
    generation_limit: "output_budget", finish_reason: "length", incomplete_tools: true,
    reasoning_content: "final thought", retrieved_sources: sources, knowledge_routing: { groupmap: "omitted", m: 1 } })
  const [reply] = panel.state().messages
  assert.equal(reply.id, "persisted")
  assert.equal(reply.thread_id, "B")
  assert.equal(reply.content, "answer")
  assert.equal(reply.reasoning_content, "final thought")
  assert.equal(reply.finish_reason, "length")
  assert.equal(reply.generation_limit, "output_budget")
  assert.equal(reply.truncated, true)
  assert.equal(reply.incomplete_tools, true)
  assert.deepEqual(reply.retrieved_sources, sources)
  assert.equal(reply.knowledge_routing?.m, 1)
  assert.equal(panel.state().streamingReasoning, "")
  assert.equal(panel.state().isProcessing, false)
})

test("mid-turn assistant and tool fallback each consume their owner's stream exactly once", () => {
  for (const assistantFirst of [true, false]) {
    const panel = mountPanel()
    panel.select("A")
    panel.select("B", false)
    panel.receive({ type: "chat.token", thread_id: "B", content: "B partial" }, false)
    panel.receive({ type: "chat.reasoning", thread_id: "B", content: "B thought" }, false)
    panel.receive({ type: "chat.assistant", thread_id: "A", message_id: "other", content: "A text" }, false)
    if (assistantFirst) panel.receive({ type: "chat.assistant", thread_id: "B", message_id: "mid",
      tool_calls: [{ id: "call", type: "function", function: { name: "read", arguments: "{}" } }] }, false)
    panel.receive({ type: "tool.start", thread_id: "B", tool_call_id: "call", tool_name: "read" }, false)
    panel.receive({ type: "tool.result", thread_id: "B", tool_call_id: "call", result: { success: true } }, false)
    panel.receive({ type: "chat.done", thread_id: "B", terminal: "round_limit" })
    const [mid, tool] = panel.state().messages
    assert.equal(panel.state().messages.length, 2)
    assert.equal(mid.content, "B partial")
    assert.equal(mid.reasoning_content, "B thought")
    assert.equal(mid.tool_calls?.[0].id, "call")
    assert.equal(tool.tool_calls?.[0].status, "success")
    assert.equal(panel.state().runTerminalByThreadId.B, "round_limit")
  }
})

test("legacy ownerless chat frames leave the transcript alone; upload and generic error keep the selected owner", () => {
  const panel = mountPanel()
  panel.select("A")
  panel.select("B", false)
  panel.receive({ type: "chat.token", thread_id: "B", content: "B partial" }, false)
  panel.receive({ type: "chat.token", content: "unknown" }, false)
  panel.receive({ type: "chat.done", message_id: "unknown", finish_reason: "stop" }, false)
  assert.equal(panel.state().streamingContent, "B partial")
  assert.equal(panel.state().messages.length, 0)
  assert.equal(panel.state().threadBusyById.B, undefined)
  panel.receive({ type: "file.upload_status" }, false)
  assert.equal(panel.state().threadBusyById.B, true)
  panel.receive({ type: "error", error: "old service" })
  assert.equal(panel.state().messages.at(-1)?.thread_id, "B")
  assert.match(panel.state().messages.at(-1)?.content ?? "", /old service/)
})

test("late termination of A preserves B's stream; an aborted partial completion retains its text", () => {
  const panel = mountPanel()
  panel.select("A")
  panel.select("B", false)
  panel.receive({ type: "chat.token", thread_id: "B", content: "kept partial" }, false)
  for (const type of ["chat.aborted", "chat.error", "file.upload_error", "error"]) {
    panel.receive({ type, thread_id: "A", error: "A error" }, false)
    assert.equal(panel.state().streamingContent, "kept partial")
    assert.equal(panel.state().messages.length, 0)
  }
  panel.receive({ type: "chat.done", thread_id: "B", message_id: "partial", finish_reason: "aborted" }, false)
  panel.receive({ type: "chat.aborted", thread_id: "B", stopped: true })
  assert.deepEqual(panel.state().messages.map(m => m.content), ["kept partial", "⏹ 已停止生成"])
})

for (const ackFirst of [true, false]) {
  test(`a persisted partial reply survives the explicit stop acknowledgement ${ackFirst ? "before" : "after"} chat.done`, () => {
    const panel = mountPanel()
    panel.select("A")
    panel.receive({ type: "chat.token", thread_id: "A", content: "last visible snapshot" })
    const ack = { type: "chat.aborted", thread_id: "A", stopped: true, cancelled: 0 }
    const done = { type: "chat.done", thread_id: "A", message_id: "on-disk", content: "complete partial", finish_reason: "aborted" }
    for (const frame of ackFirst ? [ack, done] : [done, ack]) panel.receive(frame, false)
    // The run handler also emits a fieldless terminal frame after persisting.
    panel.receive({ type: "chat.aborted", thread_id: "A" })
    assert.equal(panel.state().messages.find(row => row.id === "on-disk")?.content, "complete partial")
    assert.equal(panel.state().streamingContent, "")
    assert.equal(panel.state().threadBusyById.A, undefined)
  })
}

test("an explicitly empty persisted partial stays empty after an older token", () => {
  const panel = mountPanel()
  panel.select("A")
  panel.receive({ type: "chat.token", thread_id: "A", content: "discarded draft" })
  panel.receive({ type: "chat.done", thread_id: "A", message_id: "final", content: "", reasoning_content: "thought", finish_reason: "aborted" })
  assert.equal(panel.state().messages[0].content, "")
  assert.equal(panel.state().messages[0].reasoning_content, "thought")
})

test("a delayed error clears only its own pending summary export", () => {
  for (const summarizingThreadId of ["A", "B"]) {
    const panel = mountPanel({ ...initialState, summarizingThreadId })
    panel.select("A")
    panel.select("B", false)
    panel.receive({ type: "error", thread_id: "A", error: "export failed" })
    assert.equal(panel.state().summarizingThreadId, summarizingThreadId === "A" ? null : "B")
    assert.equal(panel.state().messages.length, 0)
    panel.receive({ type: "error", error: "legacy export failed" })
    assert.equal(panel.state().summarizingThreadId, null)
  }
})
