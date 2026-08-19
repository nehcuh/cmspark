import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildOptimisticUploadBubble, nextComposerText, uploadSendFailureOps, uploadSendOutcome } from "../src/sidepanel/utils/upload-send"
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
  // lastError after a delivered sendResponse must not retract a landed turn
  assert.equal(uploadSendOutcome("Could not establish connection", { ok: true }), "ok")
  // No SW answer at all → panel posts the fallback bubble
  assert.equal(uploadSendOutcome(undefined, undefined), "error")
  assert.equal(uploadSendOutcome(null, null), "error")
  assert.equal(uploadSendOutcome("Could not establish connection", undefined), "error")
})

test("uploadSendOutcome: any SW-answered ok:false is refused (F6 for the common drop)", () => {
  // SW refused the oversized frame: it broadcast file.upload_error with the
  // correct banner AND answered ok:false with the stamped diag.
  const refusal = {
    ok: false,
    diag: { sent: false, json_bytes: 11_000_000, over_companion_10mb: true },
  }
  assert.equal(uploadSendOutcome(undefined, refusal), "refused")
  // Companion-offline uses the same broadcast + {ok:false} shape minus the stamp.
  // Must not stack a second 「Companion 未连接」 bubble.
  assert.equal(uploadSendOutcome(undefined, { ok: false, diag: { sent: false } }), "refused")
  assert.equal(uploadSendOutcome(undefined, { ok: false }), "refused")
})

test("uploadSendFailureOps: error retracts optimistic bubble then posts fallback", () => {
  const ops = uploadSendFailureOps({
    clientMessageId: "thread-a_user_1_abc",
    uploadThreadId: "thread-a",
    sendOutcome: "error",
    swErr: "Could not establish connection",
    applyToActivePanel: true,
    composerText: "请分析这张图",
  })
  assert.deepEqual(
    ops.map((o) => o.op),
    ["retract", "busy_off", "unlock_panel", "restore_composer", "error_bubble"],
  )
  assert.equal(ops[0]!.op === "retract" && ops[0].id, "thread-a_user_1_abc")
  assert.equal(ops[1]!.op === "busy_off" && ops[1].threadId, "thread-a")
  const restore = ops.find((o) => o.op === "restore_composer")
  assert.equal(restore?.op === "restore_composer" && restore.text, "请分析这张图")
  const bubble = ops.find((o) => o.op === "error_bubble")
  assert.equal(bubble?.op, "error_bubble")
  if (bubble?.op !== "error_bubble") throw new Error("expected error_bubble")
  assert.match(bubble.content, /Could not establish connection/)
})

test("uploadSendFailureOps: refused retracts but does not stack Companion-offline bubble (F6)", () => {
  const ops = uploadSendFailureOps({
    clientMessageId: "thread-a_user_1_abc",
    uploadThreadId: "thread-a",
    sendOutcome: "refused",
    applyToActivePanel: true,
    composerText: "caption",
  })
  assert.deepEqual(
    ops.map((o) => o.op),
    ["retract", "busy_off", "unlock_panel", "restore_composer"],
  )
})

test("App.tsx wires uploadSendFailureOps + REMOVE_MESSAGE on file.upload send failure", () => {
  const src = readFileSync(join(process.cwd(), "src/sidepanel/App.tsx"), "utf8")
  assert.match(src, /uploadSendFailureOps\(/)
  const failIdx = src.indexOf("uploadSendFailureOps(")
  const loop = src.slice(failIdx, failIdx + 1800)
  assert.match(loop, /type: "REMOVE_MESSAGE"/)
  assert.match(loop, /op === "restore_composer"/)
  assert.match(loop, /composerText: userMessage/)
  const setIdx = src.indexOf('type: "SET_PENDING_UPLOAD"')
  assert.ok(setIdx >= 0, "SET_PENDING_UPLOAD dispatch missing")
  const setBlock = src.slice(setIdx, setIdx + 280)
  assert.match(setBlock, /messageId: clientMessageId/)
  assert.match(setBlock, /threadId: uploadThreadId/)
  assert.match(src, /nextComposerText\(/)
})

test("nextComposerText: restore only when the composer is still empty", () => {
  assert.equal(nextComposerText("", "请看这张图"), "请看这张图")
  assert.equal(nextComposerText("   ", "请看这张图"), "请看这张图")
  assert.equal(nextComposerText("user already typed", "请看这张图"), "user already typed")
})

test("uploadSendFailureOps: switched thread still retracts + clears mapBusy, no panel unlock", () => {
  const ops = uploadSendFailureOps({
    clientMessageId: "thread-a_user_1_abc",
    uploadThreadId: "thread-a",
    sendOutcome: "error",
    swErr: "offline",
    applyToActivePanel: false,
  })
  assert.deepEqual(
    ops.map((o) => o.op),
    ["retract", "busy_off"],
  )
})
