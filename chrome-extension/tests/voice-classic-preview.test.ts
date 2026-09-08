import test from "node:test"
import assert from "node:assert/strict"
import { createLocalSttAdapter } from "../src/sidepanel/voice/local-stt-adapter"
import type { PcmStreamCaptureOpts } from "../src/sidepanel/voice/pcm-stream-capture"
import type { PcmStreamHandle } from "../src/sidepanel/voice/pcm-stream-capture"

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

test("#482 streaming remains starting until capture is ready; continuous windows report start once", async () => {
  for (const mode of ["classic", "continuous"] as const) {
    const sent: any[] = [], pending: { resolve: (h: PcmStreamHandle) => void; opts: PcmStreamCaptureOpts }[] = []
    let receive: (msg: any) => void = () => {}, starts = 0
    const adapter = createLocalSttAdapter({ onStart: () => { starts++ }, onResult() {}, onError() {}, onEnd() {} }, {
      modelId: "small", send: (msg) => { sent.push(msg); if (msg.type === "voice.stt.end") queueMicrotask(() => receive({ type: "voice.stt.result", sessionId: msg.sessionId, text: "一段" })) },
      onMessage: (h) => { receive = h; return () => {} },
      startPcmStreamCapture: (opts) => new Promise((resolve) => pending.push({ resolve, opts })),
    })
    const handle = (): PcmStreamHandle => ({ backend: "scriptprocessor", stop: async () => {}, abort() {} })
    try {
      adapter.start({ sessionId: "permission-" + mode, mode, streamPartial: true, segmentMs: 25, hardCapMs: 1000 })
      await turn()
      assert.equal(pending.length, 1); assert.equal(starts, 0)
      assert.equal(sent.some((m) => m.type === "voice.stt.start"), false)
      pending[0].resolve(handle()); await turn()
      assert.equal(starts, 1)
      pending[0].opts.onPcmChunk(new Uint8Array(32000))
      if (mode === "continuous") {
        await new Promise((resolve) => setTimeout(resolve, 60))
        assert.equal(pending.length, 2)
        assert.equal(starts, 1, "a later permission/capture acquisition must not emit another ENGINE_START")
        pending[1].resolve(handle()); await turn()
        assert.equal(starts, 1)
      }
    } finally { adapter.abort(); adapter.destroy() }
  }
})

test("#482 stopping while capture permission is pending never reports listening", async () => {
  let grant!: (h: PcmStreamHandle) => void, starts = 0, released = 0, ends = 0
  const adapter = createLocalSttAdapter({ onStart: () => { starts++ }, onResult() {}, onError() {}, onEnd: () => { ends++ } }, {
    modelId: "medium", send() {}, onMessage: () => () => {},
    startPcmStreamCapture: () => new Promise((resolve) => { grant = resolve }),
  })
  adapter.start({ sessionId: "permission-cancel", mode: "classic", streamPartial: true }); await turn()
  adapter.stop(); grant({ backend: "scriptprocessor", stop: async () => {}, abort: () => { released++ } }); await turn()
  assert.equal(starts, 0); assert.equal(released, 1); assert.equal(ends, 1)
  adapter.destroy()
})

test("#482 ordinary local dictation previews during recording, then commits one final on stop", async () => {
  const sent: any[] = [], results: { interim: string; finalChunk: string }[] = []
  let receive: (msg: any) => void = () => {}, capture: PcmStreamCaptureOpts | undefined
  let ends = 0, stops = 0
  const adapter = createLocalSttAdapter({
    onStart() {}, onResult: (r) => results.push(r), onError: (e) => { throw new Error(e) }, onEnd: () => { ends++ },
  }, {
    modelId: "medium", send: (msg) => sent.push(msg),
    onMessage: (h) => { receive = h; return () => { receive = () => {} } },
    startCapture: async () => { throw new Error("batch capture should not run") },
    startPcmStreamCapture: async (opts) => { capture = opts; return { backend: "scriptprocessor", stop: async () => { stops++ }, abort() {} } },
    pendingTimeoutMs: 200, stopGraceMs: 1,
  })
  try {
    adapter.start({ sessionId: "classic-preview", mode: "classic", streamPartial: true })
    await turn()
    const start = sent.find((m) => m.type === "voice.stt.start")
    assert.equal(start.format, "pcm_s16le"); assert.equal(start.privacy_ack_v2, true)
    assert.ok(start.maxMs <= 45_000 && start.maxMs > 40_000)
    capture!.onPcmChunk(new Uint8Array(32000))
    receive({ type: "voice.stt.partial", sessionId: start.sessionId, status: "hypothesis", text: "听写预览" })
    assert.deepEqual(results, [{ interim: "听写预览", finalChunk: "" }])
    assert.equal(sent.some((m) => m.type === "voice.stt.end"), false)
    adapter.stop(); await turn()
    const end = sent.find((m) => m.type === "voice.stt.end")
    assert.equal(end.totalSeq, 1)
    // Classic stop is normal finalization, so the short continuous stop-grace cannot discard it.
    await new Promise((r) => setTimeout(r, 15))
    assert.equal(ends, 0)
    receive({ type: "voice.stt.result", sessionId: start.sessionId, text: "最终听写" })
    await turn()
    assert.equal(ends, 1); assert.equal(stops, 1)
    assert.deepEqual(results.map((r) => r.finalChunk).filter(Boolean), ["最终听写"])
    assert.equal(sent.filter((m) => m.type === "voice.stt.start").length, 1)
  } finally { adapter.destroy() }
})

test("#482 cancel ordinary streaming dictation discards a late final", async () => {
  const sent: any[] = [], finals: string[] = []
  let receive: (msg: any) => void = () => {}, capture: PcmStreamCaptureOpts | undefined
  const adapter = createLocalSttAdapter({ onStart() {}, onError() {}, onEnd() {}, onResult: (r) => { if (r.finalChunk) finals.push(r.finalChunk) } }, {
    modelId: "small", send: (m) => sent.push(m), onMessage: (h) => { receive = h; return () => {} },
    startPcmStreamCapture: async (opts) => { capture = opts; return { backend: "scriptprocessor", stop: async () => {}, abort() {} } },
  })
  try {
    adapter.start({ sessionId: "cancel-preview", mode: "classic", streamPartial: true }); await turn()
    capture!.onPcmChunk(new Uint8Array(32000)); adapter.stop(); await turn()
    const end = sent.find((m) => m.type === "voice.stt.end")
    adapter.abort(); receive({ type: "voice.stt.result", sessionId: end.sessionId, text: "不应写入" }); await turn()
    assert.deepEqual(finals, [])
    assert.ok(sent.some((m) => m.type === "voice.stt.abort" && m.sessionId === end.sessionId))
  } finally { adapter.destroy() }
})
