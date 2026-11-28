import assert from "node:assert/strict"
import test from "node:test"
import { summarizeDroppedContext } from "../src/llm/context-compaction-summary"
import { buildOmitNotice, shortSha256, type CompactResult } from "../src/llm/context-budget"
import * as extraction from "../src/llm/llm-extract"

const compact: CompactResult = {
  compacted: true, messages: [buildOmitNotice(1)], droppedCount: 1,
  droppedMessages: [{ role: "user", content: "Keep the notes" }], tokensBefore: 800, tokensAfter: 300,
}
const config = { base_url: "http://127.0.0.1:9", model_name: "fixture", api_key: "fixture", temperature: 0 }

test("structured handoff is attached before falling back to prose", async t => {
  const extract = t.mock.method(extraction, "llmExtract", async () => JSON.stringify({ goals: ["Keep the notes"] }))
  const result = await summarizeDroppedContext(compact, config, null)
  assert.equal(result.mode, "h1")
  assert.deepEqual(result.handoff?.goals, ["Keep the notes"])
  assert.match(String(result.messages[0].content), /Keep the notes/)
  assert.equal(extract.mock.callCount(), 1)
})

test("a fast parse failure produces exactly one prose fallback and its receipt", async t => {
  const extract = t.mock.method(extraction, "llmExtract", async () => "Meeting notes")
  const result = await summarizeDroppedContext(compact, config, null)
  assert.equal(result.mode, "m2")
  assert.equal(result.h1Error, "parse_empty")
  assert.equal(result.rollingSummary, "Meeting notes")
  assert.equal(result.summarySha, shortSha256("Meeting notes"))
  assert.equal(result.summaryBytes, Buffer.byteLength("Meeting notes"))
  assert.match(String(result.messages[0].content), /Meeting notes/)
  assert.equal(extract.mock.callCount(), 2)
})

test("timeout or cancellation during handoff preserves the omit notice without a second call", async t => {
  const controller = new AbortController()
  const extract = t.mock.method(extraction, "llmExtract", async () => { throw Error("timeout") })
  const timedOut = await summarizeDroppedContext(compact, config, null)
  assert.equal(timedOut.mode, "m1")
  assert.equal(timedOut.messages, compact.messages)
  extract.mock.mockImplementation(async () => { controller.abort(); return "unparseable" })
  const stopped = await summarizeDroppedContext(compact, config, null, controller.signal)
  assert.equal(stopped.mode, "m1")
  assert.equal(stopped.messages, compact.messages)
  assert.equal(extract.mock.callCount(), 2)
})
