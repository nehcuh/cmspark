import test from "node:test"
import assert from "node:assert/strict"
import { recordWorkbenchScreen, ScreenCaptureBusy } from "../src/sidepanel/voice/workbench-screen-capture"
import { claimWorkbenchCapture } from "../src/sidepanel/voice/workbench-capture-owner"
import { recordingStore, type ScreenRecording } from "../src/sidepanel/voice/workbench-recording-store"

function setup(restore: Array<() => void>) {
  function replace(target: object, key: string, value: unknown) {
    const original = Object.getOwnPropertyDescriptor(target, key)
    Object.defineProperty(target, key, { configurable: true, value })
    restore.push(() => {
      if (original) Object.defineProperty(target, key, original)
      else Reflect.deleteProperty(target, key)
    })
  }
  class Track extends EventTarget {
    readyState = "live"
    stop() { this.readyState = "ended" }
  }
  const video = new Track(), audio = new Track()
  let constraints: DisplayMediaStreamOptions | undefined
  const stream = { getTracks: () => [video, audio], getVideoTracks: () => [video], getAudioTracks: () => [audio] }
  let picker = async () => stream
  replace(navigator, "mediaDevices", { getDisplayMedia: (options: DisplayMediaStreamOptions) => {
    constraints = options
    return picker()
  } })
  let locks = 0
  replace(navigator, "locks", { request: async (_: string, options: LockOptions, run: (lock: object) => Promise<void>) => {
    assert.equal(options.ifAvailable, true)
    locks++
    try { await run({}) } finally { locks-- }
  } })
  let selected: Track[] = []
  replace(globalThis, "MediaStream", class { constructor(tracks: Track[]) { selected = tracks } })
  let current: Recorder
  class Recorder {
    static isTypeSupported(type: string) { return type === "video/webm" }
    state = "inactive"
    mimeType = "video/webm"
    ondataavailable?: (e: { data: Blob }) => void
    onstop?: () => void
    start() { this.state = "recording"; current = this }
    emit(text: string) { this.ondataavailable?.({ data: new Blob([text]) }) }
    stop() { this.state = "inactive"; queueMicrotask(() => { this.emit("tail"); this.onstop?.() }) }
  }
  replace(globalThis, "MediaRecorder", Recorder)
  const saved: string[] = []
  const metadatas: ScreenRecording[] = []
  replace(recordingStore, "save", async (row: ScreenRecording) => { metadatas.push(row) })
  let failAt = -1
  replace(recordingStore, "append", async (row: ScreenRecording, blob: Blob, elapsedMs: number) => {
    if (saved.length === failAt) throw new DOMException("full", "QuotaExceededError")
    assert.equal(saved.length, row.chunks)
    saved.push(await blob.text())
    return { ...row, bytes: row.bytes + blob.size, chunks: row.chunks + 1, elapsedMs }
  })
  return {
    audio, video, saved, metadatas, emit: (data: string) => current.emit(data),
    locks: () => locks, chosen: () => ({ constraints, selected }),
    failAt: (index: number) => { failAt = index },
    deferPicker(wait: Promise<void>, opened: () => void) {
      picker = async () => { opened(); await wait; return stream }
    },
  }
}

function captureTest(name: string, run: (h: ReturnType<typeof setup>) => Promise<void>) {
  test(name, async () => {
    const restore: Array<() => void> = []
    try { await run(setup(restore)) }
    finally { restore.reverse().forEach(reset => reset()) }
  })
}

captureTest("capture keeps the committed prefix in order, flushes the final event, and excludes unrequested audio", async h => {
  const controller = new AbortController()
  const mic = await claimWorkbenchCapture("microphone")
  assert.ok(mic)
  const result = await recordWorkbenchScreen(false, controller.signal, (phase) => {
    if (phase === "recording") {
      h.emit("first"); h.emit("second")
      controller.abort("stop")
    }
  })
  assert.deepEqual(h.chosen(), { constraints: { video: true, audio: false }, selected: [h.video] })
  assert.equal(h.audio.readyState, "ended")
  assert.equal(h.video.readyState, "ended")
  assert.deepEqual(h.saved, ["first", "second", "tail"])
  assert.equal(result.state, "complete")
  assert.equal(result.chunks, 3)
  assert.equal(h.locks(), 1)
  mic!()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(h.locks(), 0)
})

captureTest("quota failure stops both selected tracks, ignores later chunks, and reports the recoverable prefix", async h => {
  h.failAt(1)
  const result = await recordWorkbenchScreen(true, new AbortController().signal, phase => {
    if (phase === "recording") { h.emit("prefix"); h.emit("failed"); h.emit("queued") }
  })
  assert.equal(result.state, "partial")
  assert.equal(result.chunks, 1)
  assert.match(result.detail, /空间不足/)
  assert.deepEqual(h.saved, ["prefix"])
  assert.deepEqual(h.chosen().selected, [h.video, h.audio])
  assert.equal(h.audio.readyState, "ended")
  assert.equal(h.video.readyState, "ended")
})

captureTest("cancel during the browser picker releases late tracks without recording or writing any data", async h => {
  let finish!: () => void, open!: () => void
  const opened = new Promise<void>(resolve => { open = resolve })
  h.deferPicker(new Promise<void>(resolve => { finish = resolve }), open)
  const controller = new AbortController()
  const result = recordWorkbenchScreen(true, controller.signal, () => {})
  await opened
  assert.ok(await recordWorkbenchScreen(false, new AbortController().signal, () => {}).then(() => false, error => error instanceof ScreenCaptureBusy))
  controller.abort("cancel")
  finish()
  assert.match(await result.then(() => "unexpected success", error => error.message), /取消/)
  assert.equal(h.audio.readyState, "ended")
  assert.equal(h.video.readyState, "ended")
  assert.deepEqual(h.metadatas, [])
})

captureTest("the source ending finalizes the last chunk without waiting for a second UI click", async h => {
  const result = await recordWorkbenchScreen(false, new AbortController().signal, phase => {
    if (phase === "recording") { h.emit("start"); h.video.dispatchEvent(new Event("ended")) }
  })
  assert.equal(result.state, "complete")
  assert.match(result.detail, /来源已停止/)
  assert.deepEqual(h.saved, ["start", "tail"])
})
