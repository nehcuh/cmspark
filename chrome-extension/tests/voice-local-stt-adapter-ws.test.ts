/**
 * Path B M1 Task 6 — local adapter WS protocol sequence with injectable capture.
 * Tests send order: start → chunk(s) → end; abort; result/error handling.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createLocalSttAdapter } from "../src/sidepanel/voice/local-stt-adapter"
import { encodeMonoFloatToWav16k } from "../src/sidepanel/voice/pcm-encode"
import { LOCAL_STT_SAMPLE_RATE } from "../src/sidepanel/voice/local-stt-detect"
import type { CaptureHandle } from "../src/sidepanel/voice/audio-capture"

/** Silent 100ms WAV. */
function silentWav(): Uint8Array {
  const samples = new Float32Array(Math.floor(LOCAL_STT_SAMPLE_RATE * 0.1))
  return encodeMonoFloatToWav16k(samples, LOCAL_STT_SAMPLE_RATE)
}

/** Fake capture: start resolves immediately; stop returns fixed WAV. */
function fakeCaptureFactory(wav: Uint8Array, opts?: { delayMs?: number }) {
  return async (): Promise<CaptureHandle> => {
    let aborted = false
    return {
      stop: async () => {
        if (aborted) {
          throw Object.assign(new Error("aborted"), { code: "aborted" })
        }
        if (opts?.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs))
        }
        return wav
      },
      abort: () => {
        aborted = true
      },
    }
  }
}

test("happy path: start → stop → voice.stt.start/chunk/end → result", async () => {
  const wav = silentWav()
  const sent: any[] = []
  let handler: ((m: any) => void) | null = null
  const events: string[] = []
  const finals: string[] = []

  const adapter = createLocalSttAdapter(
    {
      onStart: () => events.push("start"),
      onResult: ({ finalChunk }) => {
        events.push("result")
        finals.push(finalChunk)
      },
      onError: (c) => events.push(`error:${c}`),
      onEnd: () => events.push("end"),
      onCaptureStopped: () => events.push("capture_stopped"),
    },
    {
      send: (m) => sent.push(m),
      onMessage: (h) => {
        handler = h
        return () => {
          handler = null
        }
      },
      modelId: "medium",
      startCapture: fakeCaptureFactory(wav),
    },
  )

  adapter.start({ sessionId: "s-happy", modelId: "medium", lang: "zh-CN" })
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(events.includes("start"), `expected start, got ${events.join(",")}`)

  const startMsg = sent.find((m) => m.type === "voice.stt.start")
  assert.ok(startMsg)
  assert.equal(startMsg.sessionId, "s-happy")
  assert.equal(startMsg.modelId, "medium")
  assert.equal(startMsg.format, "wav")
  assert.equal(startMsg.sampleRate, 16000)
  assert.equal(startMsg.channels, 1)
  assert.equal(startMsg.v, 1)

  adapter.stop()
  await new Promise((r) => setTimeout(r, 20))

  assert.ok(events.includes("capture_stopped"))
  const chunks = sent.filter((m) => m.type === "voice.stt.chunk")
  const endMsg = sent.find((m) => m.type === "voice.stt.end")
  assert.ok(chunks.length >= 1, "expected at least one chunk")
  assert.ok(endMsg)
  assert.equal(endMsg.totalSeq, chunks.length)
  assert.equal(typeof chunks[0].data, "string")
  assert.ok(chunks[0].data.length > 0)

  handler?.({
    type: "voice.stt.result",
    v: 1,
    sessionId: "s-happy",
    text: "你好世界",
    ms: 42,
    modelId: "medium",
  })
  await new Promise((r) => setTimeout(r, 5))

  assert.ok(events.includes("result"))
  assert.deepEqual(finals, ["你好世界"])
  assert.ok(events.includes("end"))

  adapter.destroy()
})

test("abort during recording: voice.stt.abort + silent error path", async () => {
  const wav = silentWav()
  const sent: any[] = []
  const events: string[] = []

  const adapter = createLocalSttAdapter(
    {
      onStart: () => events.push("start"),
      onResult: () => events.push("result"),
      onError: (c) => events.push(`error:${c}`),
      onEnd: () => events.push("end"),
    },
    {
      send: (m) => sent.push(m),
      onMessage: () => () => {},
      modelId: "small",
      startCapture: fakeCaptureFactory(wav),
    },
  )

  adapter.start({ sessionId: "s-ab", modelId: "small" })
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(events.includes("start"))

  adapter.abort()
  await new Promise((r) => setTimeout(r, 10))

  const abortMsg = sent.find((m) => m.type === "voice.stt.abort")
  assert.ok(abortMsg)
  assert.equal(abortMsg.sessionId, "s-ab")
  assert.ok(events.includes("error:aborted"))
  assert.ok(events.includes("end"))
  assert.ok(!events.includes("result"))

  adapter.destroy()
})

test("error from companion while waiting: maps code", async () => {
  const wav = silentWav()
  const sent: any[] = []
  let handler: ((m: any) => void) | null = null
  const events: string[] = []

  const adapter = createLocalSttAdapter(
    {
      onStart: () => events.push("start"),
      onResult: () => events.push("result"),
      onError: (c) => events.push(`error:${c}`),
      onEnd: () => events.push("end"),
      onCaptureStopped: () => events.push("capture_stopped"),
    },
    {
      send: (m) => sent.push(m),
      onMessage: (h) => {
        handler = h
        return () => {
          handler = null
        }
      },
      modelId: "medium",
      startCapture: fakeCaptureFactory(wav),
    },
  )

  adapter.start({ sessionId: "s-err", modelId: "medium" })
  await new Promise((r) => setTimeout(r, 20))
  adapter.stop()
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(events.includes("capture_stopped"))

  handler?.({
    type: "voice.stt.error",
    v: 1,
    sessionId: "s-err",
    code: "model_missing",
    message: "no model",
  })
  await new Promise((r) => setTimeout(r, 5))

  assert.ok(events.includes("error:model_missing"))
  assert.ok(events.includes("end"))
  assert.ok(!events.includes("result"))

  adapter.destroy()
})
