import test from "node:test"
import assert from "node:assert/strict"
import { archiveToolPayload, redactAssistantToolCallsForPersistence } from "../src/security/tool-persistence-redact"
import { HistoryStore, redactForStorage } from "../src/history/store"
import { buildRedactedTranscript, redactMessagesForCompaction } from "../src/llm/context-budget"
import { redactHitExcerpt } from "../src/threads/thread-recall"
import { buildSummaryTranscript } from "../src/threads/summary-export"
import type { ExportMessage } from "../src/threads/markdown-export"

const tool = "terminal_tail_read"
const sentinel = "OWNED_TAIL_SCREEN_BODY_725"
const noBody = (value: unknown) => assert.equal(JSON.stringify(value).includes(sentinel), false)

for (const persistFull of [false, true]) {
  test(`terminal tail: durable tool payload omits all bodies, full=${persistFull}`, () => {
    const params = { session_id: sentinel, extra: sentinel }
    for (const result of [
      { success: true, data: { text: sentinel, bytes: 25, tainted: true } },
      { success: false, error: sentinel, error_code: sentinel, data: { suggested_action: sentinel } },
      sentinel,
    ]) {
      const before = JSON.stringify({ params, result })
      const safe = archiveToolPayload(tool, params, result, persistFull)
      noBody(safe)
      assert.equal(JSON.stringify({ params, result }), before)
    }
  })
  test(`terminal tail: assistant tool arguments omit bodies, full=${persistFull}`, () => {
    const input = [{ id: "tail-1", type: "function" as const,
      function: { name: tool, arguments: JSON.stringify({ session_id: sentinel, unknown: sentinel }) } }]
    const safe = redactAssistantToolCallsForPersistence(input, { persistFull })
    noBody(safe)
    assert.equal(safe[0].id, "tail-1")
    assert.equal(safe[0].function.name, tool)
    assert.ok(input[0].function.arguments.includes(sentinel))
  })
}

test("terminal tail: interrupted heal marker survives with a fixed error only", () => {
  for (const full of [false, true]) {
    const safe = archiveToolPayload(tool, {}, { success: false, error: sentinel, error_code: "INTERRUPTED" }, full)
    noBody(safe)
    assert.equal((safe.result as any).error_code, "INTERRUPTED")
    assert.equal((safe.result as any).error, "interrupted")
  }
})

test("terminal tail: operation summary and params omit arbitrary JSON or partial text", () => {
  for (const raw of [sentinel, JSON.stringify({ text: sentinel }), `{"text":"${sentinel}`]) {
    noBody(redactForStorage(tool, raw, raw))
  }
})

test("terminal tail: actual history record also drops the separate error column", async () => {
  const rows: unknown[][] = []
  const store = Object.create(HistoryStore.prototype) as any
  store.ready = Promise.resolve()
  store.db = { run(_sql: string, values: unknown[]) { rows.push(values) },
    exec() { return [{ values: [[725]] }] } }
  store.pendingSinceFlush = 0
  // Existing non-null timer prevents this method scheduling a real flush.
  store.flushTimer = { ownedInertTimer: true }
  assert.equal(await store.record({ tool_name: tool, thread_id: "owned-thread", params: sentinel,
    result_summary: sentinel, error: sentinel, success: 0, created_at: "owned-time" }), 725)
  noBody(rows)
  assert.equal(rows.length, 1)
  assert.equal(rows[0][1], tool)
})

test("terminal tail: paired and named orphan compaction omit only the tool body", () => {
  const assistant = { role: "assistant" as const, content: "normal assistant prose",
    tool_calls: [{ id: "tail-1", type: "function" as const, function: { name: tool, arguments: "{}" } }] }
  const paired = [assistant, { role: "tool" as const, tool_call_id: "tail-1", name: tool, content: sentinel }]
  noBody(redactMessagesForCompaction(paired))
  noBody(redactMessagesForCompaction([paired[1]]))
  noBody(buildRedactedTranscript(paired))
  assert.ok(buildRedactedTranscript(paired).includes("normal assistant prose"))
})

test("terminal tail: actual recall excerpt redacts an orphan stored tool row", () => {
  const row = { id: "tail-row", role: "tool", content: sentinel,
    tool_calls: [{ id: "tail-1", tool_name: tool, result: { success: true, data: { text: sentinel } } }] }
  const out = redactHitExcerpt(row, [row], 0)
  assert.ok(out?.includes(tool))
  noBody(out)
})

test("terminal tail: automatic note summary drops direct tool rows, keeps ordinary prose", () => {
  const rows: ExportMessage[] = [
    { role: "user", content: "question one" },
    { role: "assistant", content: "ordinary assistant may quote retained information" },
    { role: "tool", content: sentinel },
    { role: "user", content: "question two" },
    { role: "assistant", content: "normal response" },
  ].map((row, i) => ({ ...row, id: String(i) })) as ExportMessage[]
  const out = buildSummaryTranscript(rows)
  noBody(out)
  assert.ok(out?.includes("ordinary assistant may quote retained information"))
})

test("terminal tail: another read tool keeps its existing generic/full-history behavior", () => {
  const data = { text: "public unchanged page data" }
  const safe = archiveToolPayload("owned_non_sensitive_read", {}, { success: true, data }, true)
  assert.deepEqual((safe.result as any).data, data)
})
