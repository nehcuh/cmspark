import test from "node:test"
import assert from "node:assert/strict"
import { parseSettingsIntent } from "../src/sidepanel/utils/settings-intent"

test("parse continuous / classic dictation", () => {
  assert.deepEqual(parseSettingsIntent("开启连续听写"), {
    type: "set_dictation_mode",
    mode: "continuous",
  })
  assert.deepEqual(parseSettingsIntent("经典短听"), {
    type: "set_dictation_mode",
    mode: "classic",
  })
})

test("parse realtime and engines", () => {
  assert.deepEqual(parseSettingsIntent("开启实时出字"), {
    type: "set_realtime_streaming",
    enabled: true,
  })
  assert.deepEqual(parseSettingsIntent("浏览器听写"), {
    type: "set_stt_engine",
    engine: "browser",
  })
  assert.deepEqual(parseSettingsIntent("本机识别"), {
    type: "set_stt_engine",
    engine: "local",
  })
})

test("parse open meeting / packs", () => {
  assert.deepEqual(parseSettingsIntent("打开会议"), { type: "open_meeting" })
  assert.deepEqual(parseSettingsIntent("打开场景"), { type: "open_packs" })
})

test("unknown empty", () => {
  assert.equal(parseSettingsIntent("").type, "unknown")
  assert.equal(parseSettingsIntent("随便说说").type, "unknown")
})
