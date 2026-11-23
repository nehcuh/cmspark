import assert from "node:assert/strict"
import test from "node:test"
import { openDesktopMeetingMedia } from "../src/sidepanel/voice/desktop-meeting-media"
import { recordingStore, type ScreenRecording } from "../src/sidepanel/voice/workbench-recording-store"
import type { FrameCaptureStatus } from "../src/sidepanel/voice/meeting-frame-sampler"

class Track extends EventTarget {
  readyState = "live"
  constructor(readonly kind: "audio" | "video", readonly origin: string) { super() }
  getSettings() { return { displaySurface: this.origin } }
  clone() { return new Track(this.kind, this.origin) }
  stop() { this.readyState = "ended" }
}
class Stream {
  constructor(private readonly tracks: Track[]) {}
  getTracks() { return this.tracks }
  getVideoTracks() { return this.tracks.filter(t => t.kind === "video") }
  getAudioTracks() { return this.tracks.filter(t => t.kind === "audio") }
}
function fixture(restore: Array<() => void>, options: { shared?: boolean, surface?: string, mic?: boolean } = {}) {
  function patch(object: object, name: string, value: unknown) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name)
    Object.defineProperty(object, name, { configurable: true, value })
    restore.push(() => {
      if (descriptor) Object.defineProperty(object, name, descriptor)
      else Reflect.deleteProperty(object, name)
    })
  }
  const video = new Track("video", options.surface ?? "window")
  const shared = new Track("audio", "shared")
  const mic = new Track("audio", "mic")
  const mixed = new Track("audio", "mix")
  const display = new Stream(options.shared === false ? [video] : [video, shared])
  let micOpens = 0, pickerOpens = 0, closed = false
  const devices = {
    async getDisplayMedia() { pickerOpens++; return display },
    async getUserMedia() { micOpens++; return new Stream(options.mic === false ? [] : [mic]) },
  }
  patch(navigator, "mediaDevices", devices)
  patch(navigator, "locks", { request: (_key: string, _opts: any, run: Function) => run({}) })
  patch(globalThis, "MediaStream", Stream)
  const wiredInputs: Track[] = []
  const destination = { stream: new Stream([mixed]) }
  const gain = { gain: { value: 0 }, connect: (node: unknown) => assert.equal(node, destination) }
  class Context {
    state = "running"
    async close() { closed = true }
    createMediaStreamDestination() { return destination }
    createGain() { return gain }
    createMediaStreamSource(input: Stream) {
      return { connect: (node: unknown) => {
        assert.equal(node, gain)
        wiredInputs.push(...input.getAudioTracks())
      } }
    }
  }
  patch(globalThis, "AudioContext", Context)
  let recorderInput: Stream | undefined
  class Recorder {
    static isTypeSupported = () => true
    state = "inactive"
    mimeType = "video/webm"
    ondataavailable?: (event: { data: Blob }) => void
    onstop?: () => void
    constructor(input: Stream) { recorderInput = input }
    start() { this.state = "recording" }
    stop() {
      this.state = "inactive"
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["tail"]) })
        this.onstop?.()
      })
    }
  }
  patch(globalThis, "MediaRecorder", Recorder)
  const stored: ScreenRecording[] = []
  patch(recordingStore, "save", async (row: ScreenRecording) => { stored.push(row) })
  patch(recordingStore, "append", async (row: ScreenRecording, data: Blob) => ({
    ...row, chunks: row.chunks + 1, bytes: row.bytes + data.size,
  }))
  return { video, shared, mic, mixed, devices, stored, display, wiredInputs, gain,
    recorderInput: () => recorderInput, pickerOpens: () => pickerOpens, micOpens: () => micOpens, closed: () => closed }
}

async function rejects(promise: Promise<unknown>, expected: RegExp) {
  const reason = await promise.then(() => assert.fail("expected capture to reject"), error => error)
  assert.match(reason.message, expected)
}

function mediaTest(name: string, run: (restore: Array<() => void>) => Promise<void>) {
  test(name, async () => {
    const restore: Array<() => void> = []
    try { await run(restore) }
    finally { restore.reverse().forEach(reset => reset()) }
  })
}

mediaTest("desktop meeting records the selected external window and mix, and lets ASR stop its own track", async t => {
  const h = fixture(t)
  const opening = openDesktopMeetingMedia(new AbortController().signal)
  assert.equal(h.pickerOpens(), 1)
  const media = await opening
  assert.deepEqual(h.wiredInputs, [h.shared, h.mic])
  assert.equal(h.gain.gain.value, 0.5)
  const [asr] = media.audio.getAudioTracks()
  assert.notStrictEqual(asr, h.mixed)
  const row = await media.startRecording("meeting-1", () => {
    assert.deepEqual(h.recorderInput()?.getTracks(), [h.video, h.mixed])
    asr.stop()
    assert.equal(h.mixed.readyState, "live")
    media.close("stop")
  })
  assert.equal(row.meetingId, "meeting-1")
  assert.equal(row.state, "complete")
  assert.equal(row.bytes, 4)
  assert.ok(h.closed())
  assert.ok([h.video, h.shared, h.mic, h.mixed, asr].every(track => track.readyState === "ended"))
})

mediaTest("listen-only records actual shared sound at unity gain and never requests a microphone", async t => {
  const h = fixture(t, { surface: "monitor" })
  const media = await openDesktopMeetingMedia(new AbortController().signal, false)
  assert.deepEqual(h.wiredInputs, [h.shared])
  assert.equal(h.gain.gain.value, 1)
  assert.equal(h.micOpens(), 0)
  const row = await media.startRecording("meeting-2", () => {
    h.shared.dispatchEvent(new Event("ended"))
    assert.equal(media.signal.aborted, true)
  })
  assert.equal(row.state, "partial")
  assert.match(row.detail, /断开/)
  assert.equal(row.bytes, 4)
  assert.equal(h.mic.readyState, "live")
})

mediaTest("an unavailable image sampler allows recording; revocation still flushes the final audio/video block", async t => {
  const h = fixture(t)
  const media = await openDesktopMeetingMedia(new AbortController().signal, false)
  let coverage: FrameCaptureStatus | undefined
  let mark: (() => void) | undefined
  // This environment has a recorder and the selected streams but no DOM canvas.
  const row = await media.startRecording("fixture-meeting", () => {
    assert.equal(coverage?.state, "unavailable")
    assert.equal(h.video.readyState, "live")
    mark?.()
    h.video.dispatchEvent(new Event("ended"))
  }, { report(value) { coverage = value }, bindMark(fn) { mark = fn } }, "fixture-capture")
  assert.equal(h.pickerOpens(), 1)
  assert.equal(h.micOpens(), 0)
  assert.equal(row.id, "fixture-capture")
  assert.equal(row.frameStatus?.state, "unavailable")
  assert.equal(row.frameStatus?.saved, 0)
  assert.equal(row.bytes, 4)
  assert.equal(row.state, "partial")
  assert.equal(h.video.readyState, "ended")
})

mediaTest("desktop without shared sound rejects before mic, recordings or ASR", async t => {
  const h = fixture(t, { shared: false })
  await rejects(openDesktopMeetingMedia(new AbortController().signal, false), /没有共享声音/)
  assert.equal(h.micOpens(), 0)
  assert.deepEqual(h.stored, [])
  assert.equal(h.video.readyState, "ended")
})

mediaTest("mic requested but absent never switches to shared-only recording", async t => {
  const h = fixture(t, { mic: false })
  await rejects(openDesktopMeetingMedia(new AbortController().signal), /麦克风音轨/)
  assert.equal(h.micOpens(), 1)
  assert.deepEqual(h.stored, [])
  assert.equal(h.shared.readyState, "ended")
})

mediaTest("rejects a browser tab and releases both video and shared audio", async t => {
  const h = fixture(t, { surface: "browser" })
  await rejects(openDesktopMeetingMedia(new AbortController().signal), /窗口或整个屏幕/)
  assert.equal(h.micOpens(), 0)
  assert.equal(h.video.readyState, "ended")
  assert.equal(h.shared.readyState, "ended")
})

mediaTest("before recording, revocation closes both devices and prevents future writes", async t => {
  const h = fixture(t)
  const media = await openDesktopMeetingMedia(new AbortController().signal)
  h.mic.dispatchEvent(new Event("mute"))
  assert.equal(media.signal.aborted, true)
  await rejects(media.startRecording("old", () => assert.fail()), /无法再次开始/)
  assert.equal(h.video.readyState, "ended")
  assert.deepEqual(h.stored, [])
})

mediaTest("cancelled desktop picker releases a later successful selection without opening mic", async t => {
  const h = fixture(t)
  let finish!: (stream: Stream) => void
  h.devices.getDisplayMedia = () => new Promise(resolve => { finish = resolve })
  const owner = new AbortController()
  const opening = openDesktopMeetingMedia(owner.signal)
  owner.abort()
  await rejects(opening, /中断/)
  finish(h.display)
  await Promise.resolve()
  assert.equal(h.video.readyState, "ended")
  assert.equal(h.shared.readyState, "ended")
  assert.equal(h.micOpens(), 0)
})
