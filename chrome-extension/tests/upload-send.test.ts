import test from "node:test"
import assert from "node:assert/strict"
import { buildOptimisticUploadBubble, uploadSendOutcome } from "../src/sidepanel/utils/upload-send"
import { isTempUserMessageId } from "../src/sidepanel/store/agentStore"

test("buildOptimisticUploadBubble: bubble id IS the file.upload clientMessageId (F2/F1)", () => {
  const { clientMessageId, message } = buildOptimisticUploadBubble({
    threadId: "thread-a",
    userMessage: "请分析我上传的文件",
    fileNames: ["报告.pdf", "截图.png"],
  })
  // F1 adopt contract: the companion echoes this clientMessageId as
  // client_message_id and the store adopts the bubble by exact id.
  assert.equal(message.id, clientMessageId)
  assert.equal(message.thread_id, "thread-a")
  assert.equal(message.role, "user")
  assert.equal(message.content, "请分析我上传的文件\n📎 报告.pdf, 截图.png")
  assert.ok(message.created_at)
  assert.equal(isTempUserMessageId(clientMessageId, "thread-a"), true)
})

test("buildOptimisticUploadBubble: same-millisecond sends get distinct ids", () => {
  const opts = { threadId: "thread-a", userMessage: "x", fileNames: ["f.pdf"] }
  const a = buildOptimisticUploadBubble(opts)
  const b = buildOptimisticUploadBubble(opts)
  assert.notStrictEqual(a.clientMessageId, b.clientMessageId)
})

test("uploadSendOutcome: ok only when the send actually succeeded", () => {
  assert.equal(uploadSendOutcome(undefined, { ok: true }), "ok")
  assert.equal(uploadSendOutcome(undefined, { ok: false }), "error")
  assert.equal(uploadSendOutcome(undefined, undefined), "error")
  assert.equal(uploadSendOutcome(null, null), "error")
  assert.equal(uploadSendOutcome("Could not establish connection", { ok: true }), "error")
})

test("uploadSendOutcome: frame-budget refusal suppresses the panel's own bubble (F6)", () => {
  // SW refused the oversized frame: it broadcast file.upload_error with the
  // correct banner AND answered ok:false with the stamped diag. Pre-F6 the
  // panel stacked its own misleading 「Companion 未连接」 bubble on top.
  const refusal = {
    ok: false,
    diag: { sent: false, json_bytes: 11_000_000, over_companion_10mb: true },
  }
  assert.equal(uploadSendOutcome(undefined, refusal), "refused")
  // Same failure shape minus the marker → generic fallback bubble.
  assert.equal(uploadSendOutcome(undefined, { ok: false, diag: { sent: false } }), "error")
})
