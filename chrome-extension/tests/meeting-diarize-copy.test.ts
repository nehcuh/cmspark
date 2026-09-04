import test from "node:test"
import assert from "node:assert/strict"
import {
  formatMeetingDiarizeStatus,
  mapMeetingDiarizeError,
} from "../src/sidepanel/voice/meeting-diarize-copy"

test("formatMeetingDiarizeStatus echoes K for auto audio cluster", () => {
  assert.match(formatMeetingDiarizeStatus("audio_cluster", 3), /已自动标/)
  assert.match(formatMeetingDiarizeStatus("audio_cluster", 3), /K=3/)
  assert.equal(/K=/.test(formatMeetingDiarizeStatus("audio_cluster", null)), false)
})

test("formatMeetingDiarizeStatus text_gap keeps weak-label copy and optional K", () => {
  assert.match(formatMeetingDiarizeStatus("text_gap", 2), /弱标/)
  assert.match(formatMeetingDiarizeStatus("text_gap", 2), /K=2/)
})

test("formatMeetingDiarizeStatus embedding: 说话人嵌入 · 本机 · 非身份识别 (#260)", () => {
  assert.match(formatMeetingDiarizeStatus("embedding", 3), /已自动标匿名发言人/)
  assert.match(formatMeetingDiarizeStatus("embedding", 3), /说话人嵌入 · 本机 · 非身份识别/)
  assert.match(formatMeetingDiarizeStatus("embedding", 3), /K=3/)
  assert.equal(/K=/.test(formatMeetingDiarizeStatus("embedding", null)), false)
  // 文案禁「声纹」（暗示身份识别）；用「说话人嵌入/聚类」（匿名）
  assert.equal(/声纹/.test(formatMeetingDiarizeStatus("embedding", 3)), false)
})

test("mapMeetingDiarizeError: model-missing guidance, no silent fallback (#260)", () => {
  const guidance = mapMeetingDiarizeError("embedding_model_required")
  assert.match(guidance, /设置 → 听写方式/)
  assert.match(guidance, /下载/)
  assert.match(guidance, /不会静默落回/)
  assert.equal(/识别出是谁|声纹身份|声纹/.test(guidance), false, "禁止身份识别暗示")
  assert.match(mapMeetingDiarizeError("no_segments"), /无音频段/)
})

test("mapMeetingDiarizeError: machine code + message composition", () => {
  assert.match(mapMeetingDiarizeError("seq_gap", "段序号断档"), /seq_gap/)
  assert.match(mapMeetingDiarizeError("seq_gap", "段序号断档"), /段序号断档/)
  assert.match(mapMeetingDiarizeError("timeout"), /超时/)
  assert.match(mapMeetingDiarizeError("pcm_mismatch"), /pcm_mismatch/)
})
