import test from "node:test"
import assert from "node:assert/strict"
import { microphoneConstraints, MICROPHONE_DEVICE_KEY } from "../src/sidepanel/voice/microphone-device"

test("dictation uses the chosen microphone and follows Chrome by default", async () => {
  const original = (globalThis as any).chrome
  let selection = ""
  ;(globalThis as any).chrome = { storage: { local: { get: async () => ({ [MICROPHONE_DEVICE_KEY]: selection }) } } }
  try {
    assert.equal((await microphoneConstraints()).deviceId, undefined)
    selection = "built-in-microphone"
    assert.deepEqual((await microphoneConstraints()).deviceId, { exact: selection })
  } finally {
    ;(globalThis as any).chrome = original
  }
})
