import test from "node:test"
import assert from "node:assert/strict"
import { createDesktopMeetingInput, chooseDesktopMeetingInput } from "../src/sidepanel/voice/meeting-desktop-input"
import { createPanelMeetingCapture } from "../src/sidepanel/voice/meeting-panel-continuous"
import type { DesktopMeetingMedia } from "../src/sidepanel/voice/desktop-meeting-media"
import type { ScreenRecording } from "../src/sidepanel/voice/workbench-recording-store"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function selection() {
  const lifetime = new AbortController()
  const flush = deferred<ScreenRecording>()
  const ready = deferred<() => void>()
  const audio = new EventTarget() as MediaStream
  const messages: string[] = [], meetingIds: string[] = [], stops: string[] = []
  let interruptions = 0
  const media: DesktopMeetingMedia = {
    audio, signal: lifetime.signal,
    startRecording(id, started) { meetingIds.push(id); ready.resolve(started); return flush.promise },
    close(reason = "stop") { stops.push(reason); lifetime.abort(reason) },
  }
  const input = createDesktopMeetingInput("meeting-880", async () => media, message => messages.push(message), () => interruptions++)
  return { input, audio, ready, flush, stops, meetingIds, messages, lifetime, interruptions: () => interruptions }
}

const row: ScreenRecording = { id: "video-880", mime: "video/webm", bytes: 256, chunks: 1, started: 100,
  elapsedMs: 60, state: "complete", detail: "已保存" }

test("the meeting waits for recorder admission, gives ASR the selected mix and waits for the WebM commit", async () => {
  const s = selection()
  await s.input.select()
  let ready = false
  const input = s.input.acquireAudio().then(stream => { ready = true; return stream })
  const start = await s.ready.promise
  assert.equal(ready, false)
  assert.deepEqual(s.meetingIds, ["meeting-880"])
  start()
  assert.equal(await input, s.audio)
  const closed = s.input.close("stop")
  assert.deepEqual(s.stops, ["stop"])
  assert.equal(s.interruptions(), 0)
  assert.deepEqual(s.messages, [])
  s.flush.resolve(row)
  await closed
  assert.equal(s.input.failed, false)
  assert.match(s.messages.join(""), /视频已保存/)
})

test("source loss immediately signals capture and the final partial video cannot produce a success receipt", async () => {
  const s = selection()
  await s.input.select()
  const input = s.input.acquireAudio()
  const start = await s.ready.promise
  start()
  await input
  s.lifetime.abort("共享来源已断开")
  assert.equal(s.interruptions(), 1)
  const closed = s.input.close("interrupted")
  s.flush.resolve({ ...row, state: "partial", detail: "共享来源已断开" })
  await closed
  assert.match(s.messages.join(""), /未完整保存/)
  assert.equal(s.input.failed, true)
})

test("cancelling the panel before the source-selection click rejects promptly and the stale button cannot open a picker", async () => {
  const lifetime = new AbortController()
  let click!: () => void
  const selection = chooseDesktopMeetingInput(lifetime.signal, true, choose => { click = choose })
  lifetime.abort()
  assert.match(await selection.then(() => "unexpected success", error => error.message), /capture_cancelled/)
  click()
})

test("panel sends to its confirmed meeting ASR only after selection and finishes only after the video is saved", async () => {
  const restore: Array<() => void> = []
  function replace(target: object, name: string, value: unknown) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name)
    Object.defineProperty(target, name, { value, configurable: true })
    restore.push(() => { if (descriptor) Object.defineProperty(target, name, descriptor); else Reflect.deleteProperty(target, name) })
  }
  const listeners = new Set<(reply: any) => void>()
  const frames: any[] = []
  const meeting = { id: "desktop-test", capture_epoch: 0 }
  let identity: Record<string, unknown> = {}
  const terminal = deferred<void>()
  function replyTo(frame: any) {
    switch (frame.type) {
      case "system.ping": return { type: "system.pong", meeting_pcm_contract: 1 }
      case "meeting.get": return { type: "meeting.get_result", meeting }
      case "meeting.start":
        identity = { capture_id: frame.capture_id, meeting_id: meeting.id, queue_contract: 1, capture_epoch: 1 }
        return { type: "meeting.started", meeting, continuous_capture: identity }
      case "voice.stt.start": return { ...identity, type: "voice.stt.partial", status: "receiving", credits: [], input_open: true }
      case "voice.stt.end":
        terminal.resolve()
        return { ...identity, type: "meeting.capture.status", phase: "finished", credits: [], completion: { outcome: "complete" } }
      default: throw new Error(String(frame.type))
    }
  }
  replace(globalThis, "chrome", { runtime: {
    onMessage: { addListener: (fn: (m: unknown) => void) => listeners.add(fn), removeListener: (fn: (m: unknown) => void) => listeners.delete(fn) },
    sendMessage(frame: any, receipt: (r: object) => void) {
      frames.push(frame); receipt({ ok: true })
      queueMicrotask(() => { const reply = { ...replyTo(frame), id: frame.id }; listeners.forEach(fn => fn(reply)) })
    },
  } })
  replace(navigator, "locks", { request: async (_name: string, _options: object, own: (lock: object) => Promise<void>) => own({}) })
  const lifetime = new AbortController(), video = deferred<ScreenRecording>()
  const offered = deferred<void>(), selected = deferred<DesktopMeetingMedia>(), finished = deferred<void>()
  const track = { stop() {} }, audio = { getTracks: () => [track] } as unknown as MediaStream
  const node = () => ({ connect() {}, disconnect() {} })
  class Context {
    state = "running"; destination = {}; sampleRate = 16000
    createGain() { return { ...node(), gain: { value: 1 } } }
    createMediaStreamSource(s: MediaStream) { assert.equal(s, audio); return node() }
    createScriptProcessor() { return node() }
    async close() { this.state = "closed" }
  }
  const messages: string[] = [], errors: string[] = []
  const actor = createPanelMeetingCapture({ meetingId: meeting.id, modelId: "", liveAsr: "confirmed-endpoint",
    env: { AudioContext: Context, navigator: { mediaDevices: { getUserMedia() { throw new Error("second microphone") } } } },
    desktop: { select: () => { offered.resolve(); return selected.promise }, report: m => messages.push(m) },
    onStarted() {}, onStart() {}, onStopped() {}, onStatus() {}, onError: error => errors.push(error), onEnd: () => finished.resolve(),
  })
  try {
    const starting = actor.start()
    await offered.promise
    assert.deepEqual(frames.map(f => f.type), ["system.ping", "meeting.get"])
    selected.resolve({ audio, signal: lifetime.signal, startRecording(id, began) { assert.equal(id, meeting.id); began(); return video.promise },
      close(reason) { lifetime.abort(reason) } })
    await starting
    assert.deepEqual(frames.slice(2).map(f => f.type), ["meeting.start", "voice.stt.start"])
    assert.equal(frames[2].live_asr, "confirmed-endpoint")
    assert.equal(frames[2].privacy_ack_meeting_asr_v1, true)
    assert.equal(frames[3].engine, "meeting-external")
    let ended = false
    void finished.promise.then(() => { ended = true })
    await actor.stop()
    await terminal.promise
    assert.equal(ended, false)
    assert.equal(lifetime.signal.reason, "stop")
    video.resolve({ ...row, meetingId: meeting.id })
    await finished.promise
    assert.equal(ended, true)
    assert.deepEqual(errors, [])
    assert.match(messages.join(""), /视频已保存/)
  } finally { actor.destroy(); restore.reverse().forEach(reset => reset()) }
})
