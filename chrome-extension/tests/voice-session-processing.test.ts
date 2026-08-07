/**
 * M1 Task 1: session-reducer `processing` phase for local STT.
 * Browser Web Speech stays listening → stopping → idle (no CAPTURE_STOPPED).
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  reduceVoiceSession,
  shouldApplyDraft,
} from "../src/sidepanel/voice/session-reducer"
import { initialVoiceSession } from "../src/sidepanel/voice/types"
import { mergeFinalTranscript } from "../src/sidepanel/voice/text-merge"

function startListening(baseText = "前缀") {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s-local",
    baseText,
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  assert.equal(s.phase, "listening")
  return s
}

test("CAPTURE_STOPPED: listening → processing (local path)", () => {
  let s = startListening()
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  assert.equal(s.phase, "processing")
  assert.equal(s.sessionId, "s-local")
  assert.equal(s.baseText, "前缀")
  assert.equal(s.abortReason, null)
})

test("browser path: USER_TOGGLE_STOP from listening still → stopping (not processing)", () => {
  let s = startListening()
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
  assert.equal(s.phase, "stopping")
  assert.equal(s.abortReason, "user")
})

test("CAPTURE_STOPPED ignored outside listening", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  assert.equal(s.phase, "idle")

  s = startListening()
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  assert.equal(s.phase, "processing")
  const again = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  assert.equal(again.phase, "processing")
})

test("processing + ENGINE_RESULT final → keep finals", () => {
  let s = startListening()
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "本机转写" })
  assert.equal(s.phase, "processing")
  assert.deepEqual(s.finals, ["本机转写"])
  s = reduceVoiceSession(s, {
    type: "ENGINE_RESULT",
    finalChunk: "第二段",
  })
  assert.deepEqual(s.finals, ["本机转写", "第二段"])
})

test("processing + ENGINE_END commits draft (same rules as stopping)", () => {
  let s = startListening("已有")
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "识别结果" })
  assert.equal(shouldApplyDraft(s), true)
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.phase, "idle")
  assert.equal(s.committed, true)
  assert.deepEqual(s.finals, ["识别结果"])
  assert.equal(mergeFinalTranscript(s.baseText, s.finals), "已有识别结果")
  assert.equal(s.banner, null)
})

test("processing + ENGINE_END empty finals → empty banner, preserve baseText", () => {
  let s = startListening("底稿")
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.phase, "idle")
  assert.equal(s.committed, true)
  assert.equal(s.baseText, "底稿")
  assert.match(s.banner || "", /未识别/)
})

test("processing + ENGINE_ERROR → error banner, preserve baseText, no wipe", () => {
  let s = startListening("不可丢")
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, {
    type: "ENGINE_ERROR",
    code: "network",
  })
  assert.equal(s.phase, "error")
  assert.equal(s.baseText, "不可丢")
  assert.match(s.banner || "", /网络/)
  assert.equal(s.errorCode, "network")
  // ENGINE_END after error must not clobber banner / base intent
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.phase, "idle")
  assert.match(s.banner || "", /网络/)
})

test("processing + CHAT_ABORT → abort, no merge", () => {
  let s = startListening()
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "应丢弃" })
  s = reduceVoiceSession(s, { type: "CHAT_ABORT" })
  assert.equal(s.phase, "stopping")
  assert.equal(s.abortReason, "chat_abort")
  assert.equal(shouldApplyDraft(s), false)
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.phase, "idle")
  assert.equal(s.committed, false)
  assert.deepEqual(s.finals, [])
})

test("processing + THREAD_SWITCH → abort, no merge", () => {
  let s = startListening("x")
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "y" })
  s = reduceVoiceSession(s, { type: "THREAD_SWITCH" })
  assert.equal(s.abortReason, "thread_switch")
  assert.equal(shouldApplyDraft(s), false)
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.committed, false)
  assert.deepEqual(s.finals, [])
})

test("processing + UNMOUNT → abort, no merge", () => {
  let s = startListening()
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "z" })
  s = reduceVoiceSession(s, { type: "UNMOUNT" })
  assert.equal(s.phase, "stopping")
  assert.equal(s.abortReason, "unmount")
  assert.equal(shouldApplyDraft(s), false)
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.committed, false)
  assert.deepEqual(s.finals, [])
})

test("USER_TOGGLE_STOP from processing → stopping, abortReason user, no draft merge", () => {
  let s = startListening("保留底")
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "半成品" })
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
  assert.equal(s.phase, "stopping")
  assert.equal(s.abortReason, "user")
  assert.equal(shouldApplyDraft(s), false)
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.phase, "idle")
  assert.equal(s.committed, false)
  assert.deepEqual(s.finals, [])
  // no empty-result banner on user cancel mid-processing
  assert.equal(s.banner, null)
})

test("TIMEOUT from listening → stopping (existing); local may CAPTURE_STOPPED after stop", () => {
  let s = startListening()
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "超时前" })
  s = reduceVoiceSession(s, { type: "TIMEOUT" })
  assert.equal(s.phase, "stopping")
  assert.equal(s.abortReason, "timeout")
  // CAPTURE_STOPPED only from listening — ignored while stopping
  const ignored = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  assert.equal(ignored.phase, "stopping")
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.committed, true)
  assert.deepEqual(s.finals, ["超时前"])
  assert.match(s.banner || "", /上限/)
})

test("hard aborts drop late ENGINE_RESULT while processing", () => {
  let s = startListening()
  s = reduceVoiceSession(s, { type: "CAPTURE_STOPPED" })
  s = reduceVoiceSession(s, { type: "CHAT_ABORT" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "迟到" })
  // still stopping after abort; result must not stick for merge path
  assert.equal(s.abortReason, "chat_abort")
  // ENGINE_RESULT ignored for hard aborts — finals unchanged from before abort
  // (we had no finals before CHAT_ABORT in this scenario after abort clears interim only)
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.deepEqual(s.finals, [])
  assert.equal(s.committed, false)
})
