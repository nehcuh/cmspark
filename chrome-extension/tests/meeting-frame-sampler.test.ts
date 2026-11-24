import test from "node:test"
import assert from "node:assert/strict"
import { FrameChangeDetector, startMeetingFrameSampler, type FrameCaptureStatus } from "../src/sidepanel/voice/meeting-frame-sampler"
import * as storage from "../src/sidepanel/voice/workbench-recording-store"

const page = (value: number) => new Uint8ClampedArray(128 * 72 * 4).fill(value)
test("stable page after fast cuts, localized cursor noise and fallback for a small number", () => {
  const detector = new FrameChangeDetector()
  const a = page(0), b = page(128), c = page(255)
  assert.equal(detector.consider(a, 0), false)
  assert.equal(detector.consider(a, 500), false)
  assert.equal(detector.consider(a, 1000), true)
  detector.accept(a, 1000)
  assert.equal(detector.consider(b, 5000), false)
  assert.equal(detector.consider(c, 5500), false)
  assert.equal(detector.consider(c, 6000), false)
  assert.equal(detector.consider(c, 6500), true)
  detector.accept(c, 6500)
  const number = c.slice()
  number.fill(0, 4 * 128, 4 * (128 + 4))
  assert.equal(detector.consider(number, 13000), false)
  assert.equal(detector.consider(number, 14000), false)
  assert.equal(detector.consider(number, 66500), true)
})

test("localized webcam motion stays below a page change; settled scrolling code is retained", () => {
  const paper = page(255)
  const camera = paper.slice()
  for (let y = 3; y < 21; y++) camera.fill(0, 4 * (y * 128 + 98), 4 * (y * 128 + 123))
  const detector = new FrameChangeDetector()
  detector.accept(paper, 1000)
  detector.consider(camera, 7000)
  assert.equal(detector.consider(camera, 8000), false)
  const code = paper.slice()
  for (let y = 8; y < 64; y += 4) code.fill(0, 4 * (y * 128 + 8), 4 * (y * 128 + 68))
  assert.equal(detector.consider(code, 8500), false)
  assert.equal(detector.consider(code, 9500), true)
})

test("one encode/write at a time; stop retires capture without stopping its input track", async () => {
  let stops = 0, writeCount = 0
  const track = { readyState: "live", stop() { stops++ } }
  const video = { srcObject: null as unknown, readyState: 2, videoWidth: 1920, videoHeight: 1080,
    pause() {}, play: async () => {} }
  const image = page(0)
  let encoder!: (value: Blob | null) => void
  let drawn = 0
  const create = (tag: string) => {
    if (tag === "video") return video
    const canvas = { width: 0, height: 0,
      toBlob: (callback: typeof encoder) => { encoder = callback }, getContext: () => ({
        canvas, drawImage() { drawn++ }, getImageData: () => ({ data: image }),
      }) }
    return canvas
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "document")
  const stream = Object.getOwnPropertyDescriptor(globalThis, "MediaStream")
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: create } })
  Object.defineProperty(globalThis, "MediaStream", { configurable: true, value: class {
    constructor(tracks: unknown[]) { assert.deepEqual(tracks, [track]) }
  } })
  const restore = () => {
    if (original) Object.defineProperty(globalThis, "document", original)
    else Reflect.deleteProperty(globalThis, "document")
    if (stream) Object.defineProperty(globalThis, "MediaStream", stream)
    else Reflect.deleteProperty(globalThis, "MediaStream")
  }
  let release!: (value: storage.FrameWrite) => void, notifyWrite!: () => void
  const saving = new Promise<void>(resolve => { notifyWrite = resolve })
  const originalWrite = storage.saveMeetingFrame
  Object.defineProperty(storage, "saveMeetingFrame", { value: (frame: storage.MeetingFrame) => {
    writeCount++
    assert.equal(frame.width, 1600)
    assert.equal(frame.height, 900)
    assert.equal(frame.recordingId, "id")
    assert.equal(frame.meetingId, "meeting")
    assert.equal(frame.mime, "image/jpeg")
    assert.match(frame.sha256, /^[0-9a-f]{64}$/)
    notifyWrite()
    return new Promise<storage.FrameWrite>(resolve => { release = resolve })
  } })
  let state!: FrameCaptureStatus
  const start = () => startMeetingFrameSampler(track as unknown as MediaStreamTrack, "meeting", "id",
    performance.now(), next => { state = next })
  const capture = start()
  try {
    capture.mark()
    capture.mark()
    assert.equal(state.skippedBusy, 1)
    assert.equal(drawn, 2)
    encoder(new Blob(["first"], { type: "image/jpeg" }))
    await saving
    capture.mark()
    assert.equal(state.skippedBusy, 2)
    capture.stop()
    assert.equal(video.srcObject, null)
    assert.equal(stops, 0)
    const end = capture.finish()
    release("saved")
    const result = await end
    assert.equal(result.saved, 1)
    assert.equal(result.state, "stopped")
    assert.equal(writeCount, 1)

    // A browser encoder may never deliver its callback during page teardown.
    // This must not hold the recorder tail or persist a late screenshot.
    const abandoned = start()
    abandoned.mark()
    assert.equal((await abandoned.finish()).saved, 0)
    encoder(new Blob(["late"], { type: "image/jpeg" }))
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(writeCount, 1)
    const rejected = start()
    const settled = () => new Promise(resolve => setTimeout(resolve, 0))
    video.readyState = 0
    rejected.mark()
    await settled()
    assert.equal(state.notReady, 1)
    video.readyState = 2
    rejected.mark()
    encoder(null)
    await settled()
    assert.equal(state.encodeErrors, 1)
    rejected.mark()
    encoder(new Blob([]))
    await settled()
    assert.equal(state.empty, 1)
    rejected.mark()
    encoder(new Blob([new Uint8Array(storage.FRAME_BYTES + 1)]))
    await settled()
    assert.equal(state.state, "limit")
    assert.equal(state.oversized, 1)
    assert.equal(writeCount, 1)
    let writeFailed!: () => void
    const unavailable = new Promise<void>(resolve => { writeFailed = resolve })
    Object.defineProperty(storage, "saveMeetingFrame", { value: async () => { throw new DOMException("full", "QuotaExceededError") } })
    const full = startMeetingFrameSampler(track as unknown as MediaStreamTrack, "meeting", "id", performance.now(), s => {
      state = s
      if (s.state === "unavailable") writeFailed()
    })
    full.mark()
    encoder(new Blob(["frame"], { type: "image/jpeg" }))
    await unavailable
    assert.equal(state.saved, 0)
    assert.equal(state.writeErrors, 1)
    assert.equal(stops, 0)
  } finally {
    capture.stop()
    Object.defineProperty(storage, "saveMeetingFrame", { value: originalWrite })
    restore()
  }
})
