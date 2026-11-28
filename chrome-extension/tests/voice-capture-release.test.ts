import assert from "node:assert/strict"
import test from "node:test"
import { startCapture } from "../src/sidepanel/voice/audio-capture"
import { startPcmStreamCapture } from "../src/sidepanel/voice/pcm-stream-capture"

async function withCaptureApis(apis: Record<string, unknown>, run: () => Promise<void>) {
  const previous = new Map(Object.keys(apis).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  try {
    for (const [name, value] of Object.entries(apis)) {
      Object.defineProperty(globalThis, name, { configurable: true, value })
    }
    await run()
  } finally {
    for (const name of Object.keys(apis)) {
      const descriptor = previous.get(name)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

test("recorder construction failure releases every microphone track", async () => {
  let stopped = 0
  const stream = { getTracks: () => [
    { stop() { stopped++; throw new Error("device disconnected") } },
    { stop() { stopped++ } },
  ] }
  const failure = new Error("encoder unavailable")
  await withCaptureApis({
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    MediaRecorder: class { constructor() { throw failure } },
  }, async () => {
    assert.equal(await startCapture().catch(error => error), failure)
    assert.equal(stopped, 2)
  })
})

test("PCM graph setup failure closes the context before microphone acquisition", async () => {
  let closed = 0
  let opened = 0
  const failure = new Error("processor unavailable")
  await withCaptureApis({
    navigator: { mediaDevices: { getUserMedia() { opened++ } } },
    AudioContext: class {
      createGain() { return { disconnect() {} } }
      createScriptProcessor() { throw failure }
      async close() { closed++ }
    },
  }, async () => {
    assert.equal(await startPcmStreamCapture({ onPcmChunk() {} }).catch(error => error), failure)
    assert.equal(closed, 1)
    assert.equal(opened, 0)
  })
})

test("level meter setup failure closes its context and recording can still finish", async () => {
  let closed = 0
  let stopped = 0
  await withCaptureApis({
    navigator: { mediaDevices: { getUserMedia: async () => ({
      getTracks: () => [{ stop() { stopped++ } }],
    }) } },
    AudioContext: class {
      createMediaStreamSource() { throw new Error("meter unavailable") }
      async close() { closed++ }
    },
    MediaRecorder: class {
      state = "inactive"
      onstop?: () => void
      start() { this.state = "recording" }
      stop() { this.state = "inactive"; queueMicrotask(() => this.onstop?.()) }
    },
  }, async () => {
    const handle = await startCapture({ onLevel() {} })
    try {
      assert.equal(closed, 1)
      assert.equal(stopped, 0)
      assert.equal((await handle.stop()).length, 0)
      assert.equal(stopped, 1)
    } finally {
      if (!stopped) handle.abort()
    }
  })
})
