import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { midTurnToolCalls } from "../src/sidepanel/hooks/useWebSocket"
import { truncationHonestyChip } from "../src/sidepanel/chat-shell-copy"

// #295 review MAJOR: in a live session the mid-turn assistant row (thinking →
// tool call) was committed WITHOUT tool_calls — only the persisted/hydrated
// row carried them — so truncationHonestyChip mislabeled a normal tool round
// as 模型未返回内容. The companion chat.assistant frame must carry tool_calls
// and the committed row must keep them.

test("#295 live chat.assistant row with tool_calls gets no honesty chip", () => {
  // Shape of the companion chat.assistant frame (adapter.ts mid-loop echo).
  const frame = {
    content: "",
    reasoning_content: "thinking about which tool to call",
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "list_tabs", arguments: "{}" } },
    ],
  }
  const toolCalls = midTurnToolCalls(frame.tool_calls)
  assert.ok(toolCalls && toolCalls.length === 1, "frame tool_calls must reach the committed row")
  // The row useWebSocket commits on chat.assistant: empty content + reasoning + tool_calls.
  assert.equal(
    truncationHonestyChip({
      content: frame.content,
      reasoning_content: frame.reasoning_content,
      tool_calls: toolCalls,
    }),
    null,
  )
})

test("#295 midTurnToolCalls: absent/empty tool_calls stays a true empty reply", () => {
  assert.equal(midTurnToolCalls(undefined), undefined)
  assert.equal(midTurnToolCalls(null), undefined)
  assert.equal(midTurnToolCalls([]), undefined)
  assert.equal(midTurnToolCalls("nope"), undefined)
  // Genuine empty reply (no tools) still gets the neutral chip.
  assert.equal(
    truncationHonestyChip({
      content: "",
      reasoning_content: "t",
      tool_calls: midTurnToolCalls(undefined),
    }),
    "模型未返回内容",
  )
})

test("#295 useWebSocket chat.assistant commit carries tool_calls (source)", () => {
  const src = readFileSync(join(process.cwd(), "src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  const start = src.indexOf('case "chat.assistant"')
  assert.ok(start >= 0, "chat.assistant case missing")
  const body = src.slice(start, src.indexOf('case "tool.start"', start))
  assert.match(body, /midTurnToolCalls\(msg\.tool_calls\)/)
  assert.match(body, /tool_calls/)
})

test("#295 useWebSocket tool.start fallback row is marked as a tool round (source)", () => {
  const src = readFileSync(join(process.cwd(), "src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  const start = src.indexOf('case "tool.start"')
  assert.ok(start >= 0, "tool.start case missing")
  const body = src.slice(start, src.indexOf('case "tool.result"', start))
  // Fallback commit (older companion / tools-before-echo race) — a tool is
  // starting by definition, so the row must be marked or the chip mislabels it.
  const fallback = body.slice(0, body.indexOf('role: "tool"'))
  assert.ok(fallback.includes('role: "assistant"'), "fallback assistant commit missing")
  assert.match(fallback, /tool_calls/)
})

test("#295 companion chat.assistant frame carries tool_calls (source)", () => {
  const src = readFileSync(
    join(process.cwd(), "..", "companion", "src", "llm", "adapter.ts"),
    "utf8",
  )
  const start = src.indexOf('type: "chat.assistant"')
  assert.ok(start >= 0, "chat.assistant frame missing")
  const body = src.slice(start, start + 500)
  assert.match(body, /tool_calls/)
})
