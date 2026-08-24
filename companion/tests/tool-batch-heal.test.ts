import test from "node:test"
import assert from "node:assert/strict"
import {
  buildInterruptedDiskRow,
  healNewestUnpairedAssistant,
  persistHealedToolRows,
  replaceInterruptedFillerIfPresent,
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

test("persistHealedToolRows: skips filler when the real result landed after the snapshot (supersede race)", () => {
  // Snapshot says call_A + call_B are unpaired. While heal is mid-loop, the old
  // run's real result for call_B lands (simulated inside insertMessageAt, which
  // is where the in-process race interleaves). Heal must not write a second row
  // for call_B — a duplicate id would orphan one of the two at rebuild.
  const tape: any[] = [
    { id: "u1", role: "user", content: "go" },
    {
      id: "a1",
      role: "assistant",
      content: "calling",
      tool_calls: [
        { id: "call_A", function: { name: "list_tabs", arguments: "{}" } },
        { id: "call_B", function: { name: "shell_exec", arguments: "{}" } },
      ],
    },
  ]
  const realB = {
    id: "real-b",
    role: "tool",
    content: JSON.stringify({ success: true, data: { ok: 1 } }),
    tool_calls: [{ id: "call_B", tool_name: "shell_exec", params: {}, result: { success: true, data: { ok: 1 } } }],
  }
  let inserted = 0
  const tm = {
    getMessages: () => tape,
    insertMessageAt: (_id: string, index: number, msg: any) => {
      tape.splice(index, 0, { ...msg, id: `heal-${inserted}` })
      inserted++
      // Race: the superseded run's real call_B result lands after the first filler.
      if (inserted === 1) tape.push(realB)
    },
  }
  const n = persistHealedToolRows(tm, "t1")
  assert.equal(n, 1, "only call_A gets a filler")
  const fillerIds = tape
    .filter((m) => m.role === "tool")
    .flatMap((m) => (m.tool_calls || []).map((tc: any) => `${tc.id}:${tc.result?.error_code || "real"}`))
  assert.deepEqual(fillerIds.sort(), ["call_A:INTERRUPTED", "call_B:real"])
})

test("persistHealedToolRows: stops when the healed assistant was cap-trimmed (no EOF orphan)", () => {
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
  let inserted = 0
  const tm = {
    getMessages: () => tape,
    insertMessageAt: (_id: string, index: number, msg: any) => {
      tape.splice(index, 0, { ...msg, id: `heal-${inserted}` })
      inserted++
      // Simulate cap-trim removing the healed assistant between inserts.
      if (inserted === 1) {
        const at = tape.findIndex((m) => m.id === "a1")
        tape.splice(at, 1)
      }
    },
  }
  const n = persistHealedToolRows(tm, "t1")
  assert.equal(n, 1, "second filler must be abandoned, not appended")
  const toolRows = tape.filter((m) => m.role === "tool")
  assert.equal(toolRows.length, 1)
  assert.equal(toolRows[0].tool_calls[0].id, "call_A")
  // No filler for call_B anywhere — especially not at EOF.
  assert.ok(!tape.some((m) => (m.tool_calls || []).some((tc: any) => tc.id === "call_B")))
  assert.equal(tape[tape.length - 1].id, "u2")
})

test("replaceInterruptedFillerIfPresent: swaps the filler in place, keeping row id and position", () => {
  const fillerResult = { success: false, error: "interrupted", error_code: "INTERRUPTED" }
  const tape: any[] = [
    { id: "u1", role: "user", content: "go" },
    {
      id: "a1",
      role: "assistant",
      content: "calling",
      tool_calls: [{ id: "call_A", function: { name: "shell_exec", arguments: "{}" } }],
    },
    {
      id: "f1",
      role: "tool",
      content: JSON.stringify(fillerResult),
      tool_calls: [{ id: "call_A", tool_name: "shell_exec", params: {}, result: fillerResult }],
    },
    { id: "u2", role: "user", content: "next" },
  ]
  const tm = {
    getMessages: () => tape,
    updateMessage: (_id: string, messageId: string, updates: Record<string, unknown>) => {
      const m = tape.find((row) => row.id === messageId)
      if (m) Object.assign(m, updates)
    },
  }
  const realRow = {
    role: "tool" as const,
    content: JSON.stringify({ success: true, data: { ok: 1 } }),
    tool_calls: [{ id: "call_A", tool_name: "shell_exec", params: {}, result: { success: true, data: { ok: 1 } } }],
  }
  const replaced = replaceInterruptedFillerIfPresent(tm, "t1", "call_A", realRow)
  assert.equal(replaced, true)
  assert.equal(tape.length, 4, "no row appended")
  assert.equal(tape[2].id, "f1", "same persisted row id")
  assert.equal(tape[2].tool_calls[0].result.success, true, "real result now in place")
  assert.equal(tape[3].id, "u2", "position unchanged — still before the next user")
  const rebuilt = rebuildMessagesFromHistory(tape)
  assert.equal((rebuilt[1] as any).tool_calls.length, 1, "rebuild keeps the paired round")
  assert.equal((rebuilt[2] as any).tool_call_id, "call_A")
  assert.match(String((rebuilt[2] as any).content), /"success":true/)
})

test("replaceInterruptedFillerIfPresent: assistantId scopes to that round (does not rewrite an older filler)", () => {
  const filler = { success: false, error: "interrupted", error_code: "INTERRUPTED" }
  const tape: any[] = [
    { id: "a-old", role: "assistant", content: "old", tool_calls: [{ id: "call_A", function: { name: "list_tabs", arguments: "{}" } }] },
    {
      id: "f-old",
      role: "tool",
      content: JSON.stringify(filler),
      tool_calls: [{ id: "call_A", tool_name: "list_tabs", params: {}, result: filler }],
    },
    { id: "a-new", role: "assistant", content: "new", tool_calls: [{ id: "call_A", function: { name: "list_tabs", arguments: "{}" } }] },
    {
      id: "f-new",
      role: "tool",
      content: JSON.stringify(filler),
      tool_calls: [{ id: "call_A", tool_name: "list_tabs", params: {}, result: filler }],
    },
  ]
  const tm = {
    getMessages: () => tape,
    updateMessage: (_id: string, messageId: string, updates: Record<string, unknown>) => {
      const m = tape.find((row) => row.id === messageId)
      if (m) Object.assign(m, updates)
    },
  }
  const realRow = {
    content: JSON.stringify({ success: true, data: { ok: 1 } }),
    tool_calls: [{ id: "call_A", result: { success: true, data: { ok: 1 } } }],
  }
  const replaced = replaceInterruptedFillerIfPresent(tm, "t1", "call_A", realRow, "a-new")
  assert.equal(replaced, true)
  assert.equal(tape.find((m) => m.id === "f-old").tool_calls[0].result.error_code, "INTERRUPTED")
  assert.equal(tape.find((m) => m.id === "f-new").tool_calls[0].result.success, true)
})

test("replaceInterruptedFillerIfPresent: returns false without an INTERRUPTED filler", () => {
  const tape: any[] = [
    {
      id: "t-real",
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "call_A", tool_name: "list_tabs", params: {}, result: { success: true } }],
    },
  ]
  const tm = {
    getMessages: () => tape,
    updateMessage: () => {
      throw new Error("must not be called")
    },
  }
  const replaced = replaceInterruptedFillerIfPresent(tm, "t1", "call_A", {
    content: "{}",
    tool_calls: [{ id: "call_A" }],
  })
  assert.equal(replaced, false)
})
