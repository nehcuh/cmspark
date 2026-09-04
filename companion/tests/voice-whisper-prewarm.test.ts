import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-prewarm-"))

import test from "node:test"
import assert from "node:assert/strict"

import {
  buildSilentWavBytes,
  maybePrewarmWhisper,
  resetWhisperPrewarmForTests,
  getWhisperPrewarmStatus,
} from "../src/voice/whisper-prewarm"

test("silent wav is a well-formed 16kHz mono PCM header", () => {
  const buf = buildSilentWavBytes(80)
  assert.equal(buf.toString("ascii", 0, 4), "RIFF")
  assert.equal(buf.toString("ascii", 8, 12), "WAVE")
  assert.ok(buf.length > 44)
})

test("prewarm off → idle, transcribe never called", async () => {
  resetWhisperPrewarmForTests()
  let calls = 0
  const r = await maybePrewarmWhisper({
    enabled: false,
    resolveReady: () => ({ modelId: "medium", modelPath: "/m.bin", binaryPath: "/w" }),
    transcribe: async () => {
      calls++
      return { text: "", ms: 1 }
    },
  })
  assert.equal(r, "idle")
  assert.equal(getWhisperPrewarmStatus(), "idle")
  assert.equal(calls, 0)
})

test("prewarm on + nothing ready → idle (NOT fail — never attempted)", async () => {
  resetWhisperPrewarmForTests()
  let calls = 0
  const r = await maybePrewarmWhisper({
    enabled: true,
    resolveReady: () => null,
    transcribe: async () => {
      calls++
      return { text: "", ms: 1 }
    },
  })
  assert.equal(r, "idle")
  assert.equal(calls, 0)
})

test("prewarm on + ready + transcribe ok → ok (real load, not disk probe)", async () => {
  resetWhisperPrewarmForTests()
  const calls: string[] = []
  const r = await maybePrewarmWhisper({
    enabled: true,
    resolveReady: () => ({ modelId: "medium", modelPath: "/models/medium.bin", binaryPath: "/bin/whisper" }),
    transcribe: async (o) => {
      calls.push(o.modelPath)
      assert.equal(o.binaryPath, "/bin/whisper")
      assert.ok(fs.existsSync(o.audioPath))
      return { text: "", ms: 12 }
    },
  })
  assert.equal(r, "ok")
  assert.equal(getWhisperPrewarmStatus(), "ok")
  assert.deepEqual(calls, ["/models/medium.bin"])
})

test("prewarm on + transcribe throws → fail", async () => {
  resetWhisperPrewarmForTests()
  const r = await maybePrewarmWhisper({
    enabled: true,
    resolveReady: () => ({ modelId: "medium", modelPath: "/m.bin", binaryPath: "/w" }),
    transcribe: async () => {
      throw new Error("spawn_error")
    },
  })
  assert.equal(r, "fail")
  assert.equal(getWhisperPrewarmStatus(), "fail")
})
