import { test } from "node:test"
import assert from "node:assert/strict"
import { recognitionLanguage, transcriptionLocale, transcriptionText } from "../src/voice/transcription-language"
import { trimMeetingOverlap } from "../src/voice/meeting-overlap"

test("computer language and explicit orthography map to spoken Chinese and persisted characters", () => {
  assert.equal(transcriptionLocale("system", "zh-TW"), "zh-Hant")
  assert.equal(transcriptionLocale("system", "zh-SG"), "zh-Hans")
  assert.equal(transcriptionLocale("system", "de-DE"), "de")
  assert.equal(recognitionLanguage("zh-Hans"), "zh")
  assert.equal(transcriptionText("會議記錄，週五發給同事。", "zh-Hans"), "会议记录，周五发给同事。")
  assert.equal(transcriptionText("会议记录", "zh-Hant"), "會議記錄")
  assert.equal(transcriptionText("记录", "ja"), "记录")
})

test("only a matching recognition suffix is removed from audio shared by adjacent windows", () => {
  assert.equal(trimMeetingOverlap("讨论会议。", "会议记录"), "记录")
  assert.equal(trimMeetingOverlap("review the release.", "The release is ready."), "is ready.")
  assert.equal(trimMeetingOverlap("使用 API 接口", "API接口已经更新"), "已经更新")
  assert.equal(trimMeetingOverlap("important", "ant colony"), "ant colony")
  assert.equal(trimMeetingOverlap("讨论", "完全不同"), "完全不同")
})
