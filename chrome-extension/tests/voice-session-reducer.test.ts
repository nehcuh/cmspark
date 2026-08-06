import test from "node:test"
import assert from "node:assert/strict"
import { reduceVoiceSession, shouldApplyDraft } from "../src/sidepanel/voice/session-reducer"
import { initialVoiceSession } from "../src/sidepanel/voice/types"
import { mergeFinalTranscript, isEmptyFinals } from "../src/sidepanel/voice/text-merge"

test("happy path: start → result → stop → end commits finals", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "前缀",
  })
  assert.equal(s.phase, "starting")
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  assert.equal(s.phase, "listening")
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "你好" })
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
  assert.equal(s.phase, "stopping")
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.phase, "idle")
  assert.equal(s.committed, true)
  assert.deepEqual(s.finals, ["你好"])
  assert.equal(mergeFinalTranscript(s.baseText, s.finals), "前缀你好")
})

test("empty final → banner, no meaningful merge", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.committed, true)
  assert.ok(isEmptyFinals(s.finals))
  assert.match(s.banner || "", /未识别/)
})

test("CHAT_ABORT discards draft", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "危险命令" })
  s = reduceVoiceSession(s, { type: "CHAT_ABORT" })
  assert.equal(s.abortReason, "chat_abort")
  assert.equal(shouldApplyDraft(s), false)
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.phase, "idle")
  assert.equal(s.committed, false)
  assert.deepEqual(s.finals, [])
})

test("THREAD_SWITCH discards", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "x",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "y" })
  s = reduceVoiceSession(s, { type: "THREAD_SWITCH" })
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.committed, false)
  assert.deepEqual(s.finals, [])
})

test("timeout keeps finals with banner", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "超时保留" })
  s = reduceVoiceSession(s, { type: "TIMEOUT" })
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.committed, true)
  assert.deepEqual(s.finals, ["超时保留"])
  assert.match(s.banner || "", /上限/)
})

test("not-allowed → error banner survives ENGINE_END (real Web Speech order)", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_ERROR", code: "not-allowed" })
  assert.equal(s.phase, "error")
  assert.match(s.banner || "", /麦克风/)
  // Chrome always fires onend after onerror — must not clobber §6.6 copy
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.phase, "idle")
  assert.match(s.banner || "", /麦克风/)
  assert.ok(!/未识别/.test(s.banner || ""), "must not clobber with empty-final banner")
})

test("network error → end keeps network banner", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_ERROR", code: "network" })
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.match(s.banner || "", /网络/)
})

test("USER_TOGGLE_STOP while stopping forces idle (stuck recovery)", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
  assert.equal(s.phase, "stopping")
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
  assert.equal(s.phase, "idle")
})

test("mergeFinalTranscript spacing", () => {
  assert.equal(mergeFinalTranscript("hello", ["world"]), "hello world")
  assert.equal(mergeFinalTranscript("你好", ["世界"]), "你好世界")
  assert.equal(mergeFinalTranscript("", ["a", "b"]), "a b")
})
