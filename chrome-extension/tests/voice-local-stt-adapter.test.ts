/**
 * Path B M1 Task 6 — local-stt-adapter unit tests (mock send / onMessage).
 * Does not require real gUM; injects capture via module surface + WS mocks.
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  createLocalSttAdapter,
  uint8ToBase64,
} from "../src/sidepanel/voice/local-stt-adapter"
import { createSttAdapter } from "../src/sidepanel/voice/stt-engine"
import { splitIntoChunks } from "../src/sidepanel/voice/pcm-encode"
import { LOCAL_STT_MAX_CHUNK_RAW_BYTES } from "../src/sidepanel/voice/local-stt-detect"

// --- pure helpers -------------------------------------------------------------

test("uint8ToBase64 round-trips ASCII", () => {
  const u8 = new Uint8Array([72, 105]) // Hi
  const b64 = uint8ToBase64(u8)
  assert.equal(b64, "SGk=")
  // decode base64 without Node Buffer (tsconfig.tests has no @types/node)
  const bin = atob(b64)
  assert.equal(bin, "Hi")
})

test("splitIntoChunks used for voice.stt.chunk size", () => {
  const data = new Uint8Array(LOCAL_STT_MAX_CHUNK_RAW_BYTES + 10)
  data.fill(1)
  const chunks = splitIntoChunks(data, LOCAL_STT_MAX_CHUNK_RAW_BYTES)
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0]!.length, LOCAL_STT_MAX_CHUNK_RAW_BYTES)
  assert.equal(chunks[1]!.length, 10)
})

// --- adapter with mocked capture ----------------------------------------------

test("local adapter: abort after start sends voice.stt.abort and fires onError/onEnd", async () => {
  const sent: any[] = []
  let errCount = 0
  let endCount = 0
  const adapter = createLocalSttAdapter(
    {
      onStart: () => {},
      onResult: () => {},
      onError: (code) => {
        errCount++
        assert.equal(code, "aborted")
      },
      onEnd: () => {
        endCount++
      },
    },
    {
      send: (msg) => sent.push(msg),
      onMessage: () => () => {},
      modelId: "medium",
      startCapture: async () => ({
        stop: async () => new Uint8Array([1, 2, 3]),
        abort: () => {},
      }),
    },
  )

  adapter.start({ sessionId: "sess-abort", modelId: "small", lang: "zh-CN" })
  await new Promise((r) => setTimeout(r, 15))
  adapter.abort()
  assert.equal(errCount, 1)
  assert.equal(endCount, 1)
  assert.ok(sent.some((m) => m.type === "voice.stt.abort" && m.sessionId === "sess-abort"))
  adapter.destroy()
})

test("local adapter: voice.stt.error maps to onError + onEnd", async () => {
  const inbox: { emit?: (m: any) => void } = {}
  const events: string[] = []
  const adapter = createLocalSttAdapter(
    {
      onStart: () => events.push("start"),
      onResult: () => events.push("result"),
      onError: (c) => events.push(`error:${c}`),
      onEnd: () => events.push("end"),
    },
    {
      send: () => {},
      onMessage: (h) => {
        inbox.emit = h
        return () => {
          inbox.emit = undefined
        }
      },
      modelId: "medium",
      startCapture: async () => ({
        stop: async () => new Uint8Array([9, 9]),
        abort: () => {},
      }),
    },
  )

  adapter.start({ sessionId: "err-1", modelId: "medium" })
  await new Promise((r) => setTimeout(r, 15))
  inbox.emit?.({
    type: "voice.stt.error",
    v: 1,
    sessionId: "err-1",
    code: "infer_timeout",
    message: "timeout",
  })
  await new Promise((r) => setTimeout(r, 5))

  assert.ok(events.includes("error:infer_timeout"))
  assert.ok(events.includes("end"))
  assert.ok(!events.includes("result"))
  adapter.destroy()
})

test("createSttAdapter factory: browser null without SpeechRecognition; local needs deps", () => {
  const handlers = {
    onStart: () => {},
    onResult: () => {},
    onError: () => {},
    onEnd: () => {},
  }
  // Node has no SpeechRecognition
  const browser = createSttAdapter("browser", { handlers })
  assert.equal(browser, null)

  const localMissing = createSttAdapter("local", { handlers })
  assert.equal(localMissing, null)

  const local = createSttAdapter("local", {
    handlers,
    local: {
      send: () => {},
      onMessage: () => () => {},
      modelId: "medium",
    },
  })
  assert.ok(local)
  assert.equal(typeof local!.start, "function")
  assert.equal(typeof local!.stop, "function")
  assert.equal(typeof local!.abort, "function")
  assert.equal(typeof local!.destroy, "function")
  local!.destroy()
})

test("local adapter: missing sessionId on start → session_busy error", () => {
  const events: string[] = []
  const adapter = createLocalSttAdapter(
    {
      onStart: () => events.push("start"),
      onResult: () => {},
      onError: (c) => events.push(`error:${c}`),
      onEnd: () => events.push("end"),
    },
    {
      send: () => {},
      onMessage: () => () => {},
      modelId: "medium",
    },
  )
  // start with bare lang string (no sessionId)
  adapter.start("zh-CN")
  assert.ok(events.includes("error:session_busy"))
  assert.ok(events.includes("end"))
  adapter.destroy()
})
