import test from "node:test"
import assert from "node:assert/strict"
import { reduceVoiceSession, shouldApplyDraft } from "../src/sidepanel/voice/session-reducer"
import { initialVoiceSession } from "../src/sidepanel/voice/types"
import {
  mergeFinalTranscript,
  isEmptyFinals,
  voiceLiveComposerText,
} from "../src/sidepanel/voice/text-merge"

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

test("voiceLiveComposerText keeps finals during processing (no flash disappear)", () => {
  // Local continuous gap: after segment final, phase=processing — must still show text
  const listening = voiceLiveComposerText({
    phase: "listening",
    abortReason: null,
    baseText: "",
    finals: ["第一段"],
    interim: "临",
  })
  assert.equal(listening, "第一段临")

  const processing = voiceLiveComposerText({
    phase: "processing",
    abortReason: null,
    baseText: "",
    finals: ["第一段", "第二段"],
    interim: "",
  })
  assert.equal(processing, "第一段第二段")

  const idle = voiceLiveComposerText({
    phase: "idle",
    abortReason: null,
    baseText: "",
    finals: ["应隐藏"],
    interim: "",
  })
  assert.equal(idle, null)
})

test("voiceLiveComposerText keeps finals during refining", () => {
  const refining = voiceLiveComposerText({
    phase: "refining",
    abortReason: null,
    baseText: "",
    finals: ["识别原文"],
    interim: "",
  })
  assert.equal(refining, "识别原文")
})

test("ENGINE_RESULT empty interim keeps previous hypothesis", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_START", sessionId: "s1", baseText: "" })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", interim: "正在说" })
  assert.equal(s.interim, "正在说")
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", interim: "" })
  assert.equal(s.interim, "正在说")
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "定稿", interim: "" })
  assert.equal(s.interim, "")
  assert.deepEqual(s.finals, ["定稿"])
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

test("continuous-timeout banner copy differs from classic", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "长听" })
  s = reduceVoiceSession(s, { type: "TIMEOUT", code: "continuous-timeout" })
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.committed, true)
  assert.match(s.banner || "", /连续听写/)
})

test("SOFT_CAP_HINT keeps listening and sets banner", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, {
    type: "SOFT_CAP_HINT",
    message: "仍在连续听写，可点麦克风结束",
  })
  assert.equal(s.phase, "listening")
  assert.match(s.banner || "", /连续听写/)
  assert.equal(s.errorCode, null)
})

test("SOFT_CAP_HINT local_fallback sets code; ENGINE_END keeps chip", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, {
    type: "SOFT_CAP_HINT",
    message: "本机模型未就绪，本次使用浏览器听写。可能经浏览器厂商云端",
    code: "local_fallback",
  })
  assert.equal(s.errorCode, "local_fallback")
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "你好" })
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.phase, "idle")
  assert.equal(s.errorCode, "local_fallback")
  assert.match(s.banner || "", /本次使用浏览器听写/)
})

test("code-less SOFT_CAP_HINT clears stale local_fallback code", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, {
    type: "SOFT_CAP_HINT",
    message: "本机模型未就绪，本次使用浏览器听写。可能经浏览器厂商云端",
    code: "local_fallback",
  })
  s = reduceVoiceSession(s, {
    type: "SOFT_CAP_HINT",
    message: "仍在连续听写，可点麦克风结束",
  })
  assert.equal(s.errorCode, null)
  assert.match(s.banner || "", /连续听写/)
})

test("D1b START_REFINE → REFINE_OK keeps committed raw path", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "前缀",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "配森" })
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.equal(s.phase, "idle")
  assert.equal(s.committed, true)
  s = reduceVoiceSession(s, {
    type: "START_REFINE",
    refineGen: 1,
    rawSnapshot: "前缀配森",
  })
  assert.equal(s.phase, "refining")
  assert.equal(s.rawSnapshot, "前缀配森")
  s = reduceVoiceSession(s, {
    type: "REFINE_OK",
    refineGen: 1,
    text: "前缀Python",
    unchanged: false,
  })
  assert.equal(s.phase, "idle")
  assert.match(s.banner || "", /纠错/)
  assert.equal(s.rawSnapshot, "前缀配森")
})

test("D1b REFINE_FAIL stale gen ignored", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_START" })
  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "hi" })
  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  s = reduceVoiceSession(s, {
    type: "START_REFINE",
    refineGen: 2,
    rawSnapshot: "hi",
  })
  s = reduceVoiceSession(s, {
    type: "REFINE_OK",
    refineGen: 1,
    text: "stale",
  })
  assert.equal(s.phase, "refining")
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

test("session_unknown uses local banner, not empty-listen copy", () => {
  let s = initialVoiceSession(true)
  s = reduceVoiceSession(s, {
    type: "USER_TOGGLE_START",
    sessionId: "s1",
    baseText: "",
  })
  s = reduceVoiceSession(s, { type: "ENGINE_ERROR", code: "session_unknown" })
  s = reduceVoiceSession(s, { type: "ENGINE_END" })
  assert.match(s.banner || "", /会话已断开/)
  assert.equal(/未识别到内容/.test(s.banner || ""), false)
  assert.equal(/session_unknown/.test(s.banner || ""), false)
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
