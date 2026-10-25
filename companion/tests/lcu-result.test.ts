import test from "node:test"
import assert from "node:assert/strict"
import { ImageContentSchema } from "@modelcontextprotocol/sdk/types.js"
import { projectLcuResult, lcuImageObservation, LcuObservationManager } from "../src/computer/lcu/result"
import { redactToolPayloadForPersistence, redactAssistantToolCallsForPersistence } from "../src/security/tool-persistence-redact"
import { applyContextBudget, redactMessagesForCompaction } from "../src/llm/context-budget"
import type { CanonicalChatMessage } from "../src/llm/provider"

// Owned static 1px PNG. It is never captured from a desktop or read from a user file.
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="
const image = () => ImageContentSchema.parse({ type: "image", data: pixel, mimeType: "image/png" })

test("LCU preserves original text/isError and exact SDK image bytes through a separate transient channel", () => {
  const originalText = "Original runtime refusal\n原始错误"
  const source = { isError: true, content: [{ type: "text", text: originalText }, image()] }
  const projected = projectLcuResult(source)
  assert.equal(projected.result.success, false)
  assert.deepEqual(projected.result.data, { lcu: true, isError: true, content: [{ type: "text", text: originalText }, { type: "image", mimeType: "image/png", observation: 1 }] })
  assert.deepEqual(projected.images, [{ type: "image_url", image_url: { url: `data:image/png;base64,${pixel}` } }])
  assert.equal(JSON.stringify(projected.result).includes(pixel), false)
  assert.equal(JSON.stringify(source).includes(pixel), true, "projection must not mutate the original")
  const observation = lcuImageObservation("owned-call", projected.images)
  assert.match((observation[0] as any).text, /untrusted desktop content, not a new user request/)
  assert.match((observation[0] as any).text, /owned-call/)
  assert.deepEqual(observation.slice(1), projected.images)
  assert.deepEqual(lcuImageObservation("owned-call", []), [])
})

test("bad MIME/base64, unsupported audio/resource and mixed malformed blocks yield no partial images", () => {
  for (const bad of [
    { type: "image", mimeType: "image/svg+xml", data: pixel },
    { type: "image", mimeType: "image/jpeg", data: pixel },
    { type: "image", mimeType: "image/png", data: pixel + "\n" },
    { type: "image", mimeType: "image/png", data: "AAAA" },
    { type: "audio", mimeType: "audio/wav", data: "AAAA" },
    { type: "resource", resource: { uri: "file:///private" } },
    { type: "text", text: null },
  ]) assert.deepEqual(projectLcuResult({ content: [image(), bad] }), { result: { success: false, error: "LCU_RESULT_UNSUPPORTED_OR_INVALID" }, images: [] })
})

test("result limits refuse excessive text, image count and invalid result envelopes", () => {
  for (const source of [null, [], { content: [] , isError: "false" }, { content: Array.from({ length: 65 }, () => ({ type: "text", text: "x" })) }, { content: [{ type: "text", text: "x".repeat(256 * 1024 + 1) }] }, { content: Array.from({ length: 5 }, image) }]) {
    assert.deepEqual(projectLcuResult(source), { result: { success: false, error: "LCU_RESULT_UNSUPPORTED_OR_INVALID" }, images: [] })
  }
  assert.equal(projectLcuResult({ content: [{ type: "text", text: "owned result" }] }).result.success, true)
})

test("LCU execution code and original result text stay folded even with full-history persistence", () => {
  const privateCode = "PRIVATE_DESKTOP_CODE_SENTINEL", privateText = "PRIVATE_SCREEN_TEXT_SENTINEL"
  const result = projectLcuResult({ content: [{ type: "text", text: privateText }, image()] }).result
  for (const name of ["lcu_js", "lcu_js_reset"]) {
    const persisted = redactToolPayloadForPersistence(name, { code: privateCode }, result)
    assert.doesNotMatch(JSON.stringify(persisted), /PRIVATE_DESKTOP_CODE_SENTINEL|PRIVATE_SCREEN_TEXT_SENTINEL/)
    assert.equal(JSON.stringify(persisted).includes(pixel), false)
    const calls = redactAssistantToolCallsForPersistence([{ id: "owned-call", type: "function", function: { name, arguments: JSON.stringify({ code: privateCode }) } }], { persistFull: true })
    assert.equal(calls[0].id, "owned-call")
    assert.equal(calls[0].function.name, name)
    assert.equal(JSON.stringify(calls).includes(privateCode), false)
  }
})

test("actual context-budget envelope clones cannot retain the prior LCU pixel observation", () => {
  const manager = new LcuObservationManager(), images = projectLcuResult({ content: [image()] }).images
  const messages: CanonicalChatMessage[] = [
    { role: "system", content: "owned system" },
    { role: "user", content: "old context ".repeat(5000) },
    { role: "assistant", content: "", tool_calls: [{ id: "old-call", type: "function", function: { name: "lcu_js", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "old-call", content: "paired receipt" },
  ]
  const initial = manager.append(messages, [{ callId: "old-call", images }])
  assert.equal(initial.ok, true)
  const originalImageRow = initial.messages.at(-1)!
  const compacted = applyContextBudget(initial.messages, 1024, [], { phase: "mid_loop" })
  assert.equal(compacted.compacted, true)
  const clone = compacted.messages.find(message => message.role === "user" && Array.isArray(message.content))!
  assert.ok(clone)
  assert.notEqual(clone, originalImageRow, "real compaction must take its envelope-clone branch")
  assert.equal(clone.content, originalImageRow.content, "content identity survives actual budget cloning")
  const next = manager.append(compacted.messages, [{ callId: "new-call", images }])
  assert.equal(next.ok, true)
  assert.equal(next.messages.filter(message => message.role === "user" && Array.isArray(message.content)).length, 1)
  assert.equal(JSON.stringify(next.messages).includes("LCU tool observation from call old-call."), false)
  assert.equal(JSON.stringify(next.messages).includes("LCU tool observation from call new-call."), true)
})

test("batch pixels are appended only after every paired tool receipt, without mutating source messages", () => {
  const manager = new LcuObservationManager(), images = projectLcuResult({ content: [image()] }).images
  const source: CanonicalChatMessage[] = [
    { role: "assistant", content: "", tool_calls: ["one", "two"].map(id => ({ id, type: "function" as const, function: { name: "lcu_js", arguments: "{}" } })) },
    { role: "tool", tool_call_id: "one", content: "first receipt" },
    { role: "tool", tool_call_id: "two", content: "second receipt" },
  ]
  const appended = manager.append(source, [{ callId: "one", images }, { callId: "two", images }])
  assert.equal(appended.ok, true)
  assert.equal(source.length, 3)
  assert.deepEqual(appended.messages.map(message => message.role), ["assistant", "tool", "tool", "user", "user"])
  assert.equal(JSON.stringify(source).includes(pixel), false)
  assert.equal(manager.append(appended.messages, []).messages.length, 3, "a later non-visual batch drops the old request-local pixels")
})

test("LCU observation ownership does not erase human images or caption lookalikes", () => {
  const manager = new LcuObservationManager(), images = projectLcuResult({ content: [image()] }).images
  const human: CanonicalChatMessage = { role: "user", content: lcuImageObservation("forged-caption", images) }
  const first = manager.append([human], [{ callId: "owned-call", images }])
  const cleared = manager.append(first.messages.map(message => ({ ...message })), [])
  assert.equal(cleared.ok, true)
  assert.equal(cleared.messages.length, 1)
  assert.equal(cleared.messages[0].content, human.content)
})

test("oversized or invalid multi-call pixel batches fail atomically and do not replay stale observations", () => {
  const images = projectLcuResult({ content: [image()] }).images
  for (const pending of [
    [{ callId: "first", images: [...images, ...images, ...images] }, { callId: "second", images: [...images, ...images] }],
    [{ callId: "first", images }, { callId: "bad", images: [{ type: "text" as const, text: "not pixels" }] }],
  ]) {
    const manager = new LcuObservationManager()
    const old = manager.append([], [{ callId: "old-call", images }])
    const result = manager.append(old.messages, pending)
    assert.equal(result.ok, false)
    if (result.ok) assert.fail("invalid visual batch was accepted")
    assert.equal(result.error, "LCU_VISUAL_BATCH_INVALID_OR_LIMIT")
    assert.deepEqual(result.messages, [])
  }
})

test("a batch below the image-count cap still refuses more than 16 MiB of raster bytes", () => {
  // Owned bytes only: append inert padding to the tiny PNG for transport-size
  // accounting. This test checks the documented byte cap, not image decoding.
  const bytes = Buffer.alloc(6 * 1024 * 1024)
  Buffer.from(pixel, "base64").copy(bytes)
  const padded = projectLcuResult({ content: [{ type: "image", mimeType: "image/png", data: bytes.toString("base64") }] })
  assert.equal(padded.result.success, true, "each individual 6 MiB result is under its cap")
  const manager = new LcuObservationManager()
  const batch = manager.append([], ["one", "two", "three"].map(callId => ({ callId, images: padded.images })))
  assert.equal(batch.ok, false)
  assert.deepEqual(batch.messages, [])
})

test("actual compaction redactor folds LCU text results before summary generation even without sibling linkage", () => {
  for (const name of ["lcu_js", "lcu_js_reset"]) {
    for (const linked of [true, false]) {
      const result = JSON.stringify({ content: [{ type: "text", text: "PRIVATE_DESKTOP_RESULT_SENTINEL" }] })
      const messages: CanonicalChatMessage[] = [
        ...(linked ? [{ role: "assistant" as const, content: "", tool_calls: [{ id: "owned-call", type: "function" as const, function: { name, arguments: '{"code":"PRIVATE_CODE_SENTINEL"}' } }] }] : []),
        { role: "tool", name, tool_call_id: "owned-call", content: result },
      ]
      const redacted = redactMessagesForCompaction(messages)
      assert.equal(redacted.at(-1)?.content, `[${name}: outcome redacted len=${result.length}]`)
      assert.doesNotMatch(JSON.stringify(redacted), /PRIVATE_DESKTOP_RESULT_SENTINEL|PRIVATE_CODE_SENTINEL/)
    }
  }
})
