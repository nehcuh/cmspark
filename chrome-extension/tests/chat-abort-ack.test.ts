/**
 * #291 — honest chat.abort ACK rendering.
 *
 * Companion now answers chat.abort with `{ stopped, cancelled }`:
 *  - stopped:false (no controller / wrong thread_id) must surface as
 *    "未找到运行中的任务" instead of the old unconditional "已停止生成";
 *  - cancelled:N (nextRun queue cleared on stop) must be disclosed;
 *  - run-driven chat.aborted pushes (no ack fields) keep the legacy copy.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { chatAbortedAckText, shouldClearBusyOnChatAborted } from "../src/sidepanel/hooks/useWebSocket"

test("#291: stopped:false renders the honest 'no running task' copy", () => {
  assert.equal(
    chatAbortedAckText({ stopped: false }),
    "⚠️ 未找到运行中的任务（可能已停止或线程不匹配）",
  )
  // cancelled without a stop still reports the not-found state first
  assert.match(chatAbortedAckText({ stopped: false, cancelled: 1 }), /未找到运行中的任务/)
})

test("#291: stopped:true discloses cancelled queued messages", () => {
  assert.equal(chatAbortedAckText({ stopped: true, cancelled: 2 }), "⏹ 已停止生成，已取消 2 条排队消息")
  assert.equal(chatAbortedAckText({ stopped: true, cancelled: 1 }), "⏹ 已停止生成，已取消 1 条排队消息")
})

test("#291: legacy/field-less and zero-cancel acks keep the plain stop copy", () => {
  assert.equal(chatAbortedAckText({}), "⏹ 已停止生成")
  assert.equal(chatAbortedAckText({ stopped: true }), "⏹ 已停止生成")
  assert.equal(chatAbortedAckText({ stopped: true, cancelled: 0 }), "⏹ 已停止生成")
  // Non-number cancelled must not leak into the copy
  assert.equal(chatAbortedAckText({ stopped: true, cancelled: "2" as any }), "⏹ 已停止生成")
})

test("#308: stopped:false ACK must not clear thread busy (Stop stays available)", () => {
  assert.equal(shouldClearBusyOnChatAborted({ stopped: false }), false)
  assert.equal(shouldClearBusyOnChatAborted({ stopped: false, cancelled: 1 }), false)
})

test("#308: stopped:true and field-less run-driven push still clear busy", () => {
  assert.equal(shouldClearBusyOnChatAborted({ stopped: true }), true)
  assert.equal(shouldClearBusyOnChatAborted({ stopped: true, cancelled: 2 }), true)
  assert.equal(shouldClearBusyOnChatAborted({}), true)
  assert.equal(shouldClearBusyOnChatAborted({ cancelled: 1 }), true)
})

test("#291: chat.aborted case renders chatAbortedAckText; background forwards threadId verbatim", () => {
  const ws = readFileSync(join(process.cwd(), "src/sidepanel/hooks/useWebSocket.ts"), "utf8")
  const start = ws.indexOf('case "chat.aborted"')
  assert.ok(start >= 0, "chat.aborted case missing")
  const body = ws.slice(start, start + 2000)
  assert.match(body, /chatAbortedAckText\(msg\)/, "ack text must come from the helper")
  assert.match(
    body,
    /shouldClearBusyOnChatAborted\(msg\)/,
    "#308: busy clear must go through the helper so stopped:false keeps Stop",
  )

  const bg = readFileSync(join(process.cwd(), "src/background/index.ts"), "utf8")
  const abortAt = bg.indexOf('case "chat.abort"')
  assert.ok(abortAt >= 0, "background chat.abort case missing")
  const abortCase = bg.slice(abortAt, abortAt + 400)
  assert.match(
    abortCase,
    /thread_id:\s*message\.threadId \|\| message\.thread_id/,
    "background must forward the sidepanel's threadId unchanged",
  )
})
