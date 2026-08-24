import test from "node:test"
import assert from "node:assert/strict"
import {
  buildInterruptedDiskRow,
  healNewestUnpairedAssistant,
  persistHealedToolRows,
  unpairedToolCallsFromAssistant,
} from "../src/llm/tool-batch-heal"
import { rebuildMessagesFromHistory } from "../src/llm/adapter"

test("unpairedToolCallsFromAssistant: missing ids after a partial tool block", () => {
  const assistant = {
    role: "assistant",
    content: "calling",
    tool_calls: [
      { id: "call_A", function: { name: "list_tabs", arguments: "{}" } },
      { id: "call_B", function: { name: "list_tabs", arguments: "{}" } },
    ],
  }
  const following = [
    {
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "call_A", tool_name: "list_tabs", result: { success: true, data: [] } }],
    },
  ]
  const missing = unpairedToolCallsFromAssistant(assistant, following)
  assert.deepEqual(
    missing.map((m) => m.id),
    ["call_B"],
  )
  assert.equal(missing[0].toolName, "list_tabs")
})

test("healNewestUnpairedAssistant: fills remaining ids so rebuild keeps the round", () => {
  const history = [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "calling tools",
      tool_calls: [
        { id: "call_A", function: { name: "list_tabs", arguments: "{}" } },
        { id: "call_B", function: { name: "get_page_text", arguments: "{}" } },
      ],
    },
    {
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "call_A", tool_name: "list_tabs", result: { success: true, data: {} } }],
    },
  ]
  const { messages, healed } = healNewestUnpairedAssistant(history, { threadId: "t1" })
  assert.equal(healed, 1)
  assert.equal(messages.filter((m) => m.role === "tool").length, 2)
  const rebuilt = rebuildMessagesFromHistory(messages)
  assert.equal(rebuilt.length, 4)
  assert.equal(rebuilt[1].role, "assistant")
  assert.equal((rebuilt[1] as any).tool_calls.length, 2)
  assert.equal((rebuilt[3] as any).tool_call_id, "call_B")
  assert.match(String((rebuilt[3] as any).content), /INTERRUPTED|interrupted|已中断/)
})

test("healNewestUnpairedAssistant: no-op when already paired", () => {
  const history = [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_A", function: { name: "list_tabs", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "call_A", tool_name: "list_tabs", result: { success: true } }],
    },
  ]
  const { messages, healed } = healNewestUnpairedAssistant(history, { threadId: "t1" })
  assert.equal(healed, 0)
  assert.equal(messages.length, history.length)
})

test("rebuildMessagesFromHistory still strips unpaired history that was not healed", () => {
  const history = [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "calling",
      tool_calls: [
        { id: "call_A", function: { name: "list_tabs", arguments: "{}" } },
        { id: "call_B", function: { name: "list_tabs", arguments: "{}" } },
      ],
    },
    {
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "call_A", tool_name: "list_tabs", result: { success: true, data: {} } }],
    },
  ]
  const rebuilt = rebuildMessagesFromHistory(history)
  assert.equal(rebuilt.length, 2)
  assert.ok(!(rebuilt[1] as any).tool_calls)
})

test("healNewestUnpairedAssistant: splices INTERRUPTED before a following user (not EOF)", () => {
  const history = [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "calling",
      tool_calls: [
        { id: "call_A", function: { name: "list_tabs", arguments: "{}" } },
        { id: "call_B", function: { name: "list_tabs", arguments: "{}" } },
      ],
    },
    { role: "user", content: "continue" },
  ]
  const { messages, healed } = healNewestUnpairedAssistant(history, { threadId: "t1" })
  assert.equal(healed, 2)
  assert.equal(messages[2].role, "tool")
  assert.equal(messages[3].role, "tool")
  assert.equal(messages[4].role, "user")
  assert.equal(messages[4].content, "continue")
  const rebuilt = rebuildMessagesFromHistory(messages)
  assert.equal(rebuilt.length, 5)
  assert.equal(rebuilt[1].role, "assistant")
  assert.equal((rebuilt[1] as any).tool_calls.length, 2)
  assert.equal(rebuilt[4].role, "user")
})

test("persistHealedToolRows: inserts after the unpaired assistant, not after a later user", () => {
  const tape: any[] = [
    { id: "u1", role: "user", content: "go" },
    {
      id: "a1",
      role: "assistant",
      content: "calling",
      tool_calls: [
        { id: "call_A", function: { name: "list_tabs", arguments: "{}" } },
        { id: "call_B", function: { name: "list_tabs", arguments: "{}" } },
      ],
    },
    { id: "u2", role: "user", content: "next" },
  ]
  const tm = {
    getMessages: () => tape,
    insertMessageAt: (_id: string, index: number, msg: any) => {
      tape.splice(index, 0, { ...msg, id: `ins-${tape.length}` })
    },
    addMessage: (_id: string, msg: any) => {
      tape.push({ ...msg, id: `eof-${tape.length}` })
      return tape[tape.length - 1]
    },
  }
  const n = persistHealedToolRows(tm, "t1")
  assert.equal(n, 2)
  assert.equal(tape[2].role, "tool")
  assert.equal(tape[3].role, "tool")
  assert.equal(tape[4].id, "u2")
  assert.ok(!tape.some((m) => String(m.id || "").startsWith("eof-")), "must not append at EOF")
  const rebuilt = rebuildMessagesFromHistory(tape)
  assert.equal((rebuilt[1] as any).tool_calls.length, 2)
})

test("buildInterruptedDiskRow uses createToolResultMessage disk shape", () => {
  const row = buildInterruptedDiskRow("t1", {
    id: "call_Z",
    toolName: "list_tabs",
    args: "{}",
  })
  assert.equal(row.role, "tool")
  assert.equal(row.thread_id, "t1")
  assert.equal(row.tool_calls?.[0]?.id, "call_Z")
  assert.equal(row.tool_calls?.[0]?.result?.success, false)
  assert.equal(row.tool_calls?.[0]?.result?.error_code, "INTERRUPTED")
})
