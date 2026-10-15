import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { createMeetingContinuousCapture } from "../src/sidepanel/voice/meeting-continuous-capture"
import { MeetingPcmEncoder, ContinuousMeetingResampler } from "../src/sidepanel/voice/meeting-continuous-pcm"
import { MEETING_PCM_WORKLET_JS } from "../src/sidepanel/voice/meeting-pcm-worklet-generated"

const initial = Array.from({ length: 8 }, (_, i) => ({ credit_id: i + 1, sample_offset: i * 640, max_frames: 640 }))
function joined(values: Uint8Array[]) { const out = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0)); let offset = 0; for (const value of values) { out.set(value, offset); offset += value.length }; return out }
const samples = (n: number) => Float32Array.from({ length: n }, (_, i) => ((i * 37) % 2000 - 1000) / 1000)
function encode(input: Float32Array, rate: number, cuts: number[]) {
  const blocks: any[] = [], seals: any[] = []
  const encoder = new MeetingPcmEncoder(b => blocks.push(b), (end, reason) => seals.push({ end, reason }))
  encoder.grant(initial)
  let offset = 0
  for (const cut of cuts) { encoder.push(input.subarray(offset, offset + cut), rate); offset += cut }
  encoder.push(input.subarray(offset), rate); encoder.seal("user_stop")
  return { blocks, seals, pcm: joined(blocks.map(b => b.pcm)) }
}

test("canonical resampler matches independent linear reference across callback cuts at 16/44.1/48k", () => {
  for (const rate of [16000, 44100, 48000]) {
    const input = samples(1201), out: number[] = []
    new ContinuousMeetingResampler().push(input, rate, value => { out.push(value); return true })
    const reference: number[] = []
    for (let k = 0; k * rate <= (input.length - 1) * 16000; k++) {
      const at = k * rate / 16000, lo = Math.floor(at), hi = Math.min(lo + 1, input.length - 1)
      reference.push(input[lo] + (at - lo) * (input[hi] - input[lo]))
    }
    assert.equal(out.length, reference.length)
    out.forEach((value, i) => assert.ok(Math.abs(value - reference[i]) < 1e-10))
    const whole = encode(input, rate, []), split = encode(input, rate, [1, 17, 128, 3, 257, 1])
    assert.deepEqual(split.pcm, whole.pcm); assert.deepEqual(split.seals, whole.seals)
    assert.equal(split.seals[0].end, reference.length)
  }
})

test("actual generated worklet runs canonical admission and preserves the same short-tail bytes", () => {
  let Processor: any
  const posted: any[] = []
  const sandbox: any = { sampleRate: 16000, currentFrame: 0, Uint8Array, Float32Array, DataView,
    AudioWorkletProcessor: class { port = { onmessage: null as any, postMessage: (m: any) => posted.push(m) } },
    registerProcessor(name: string, value: any) { assert.equal(name, "cmspark-meeting-pcm-q1"); Processor = value } }
  vm.runInNewContext(MEETING_PCM_WORKLET_JS, sandbox)
  const processor = new Processor(); processor.port.onmessage({ data: { type: "init", credits: initial } })
  assert.equal(posted[0].type, "ready")
  const input = samples(1376)
  for (let offset = 0; offset < input.length; offset += 128) {
    sandbox.currentFrame = offset
    assert.equal(processor.process([[input.subarray(offset, offset + 128)]]), true)
  }
  processor.port.onmessage({ data: { type: "seal", reason: "user_stop" } })
  assert.equal(processor.process([[samples(128)]]), false)
  const blocks = posted.filter(m => m.type === "block")
  assert.deepEqual(joined(blocks.map(b => b.pcm)), encode(input, 16000, []).pcm)
  assert.equal(posted.at(-1).end, 1376); assert.equal(blocks.at(-1).frame_count, 96)
})

function audioEnvironment(gum?: Promise<any>, rate = 16000) {
  let stops = 0, closes = 0, gumCalls = 0
  const track: any = { stop() { stops++ } }
  const stream = { getTracks: () => [track] }
  let processor: any, context: any
  class Context {
    sampleRate = rate; state = "running"; destination = {}; onstatechange: any = null
    constructor() { context = this }
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} } }
    createScriptProcessor() { processor = { onaudioprocess: null, connect() {}, disconnect() {} }; return processor }
    async close() { closes++; this.state = "closed" }
  }
  let playback = 0
  return { env: { navigator: { mediaDevices: { getUserMedia() { gumCalls++; return gum ?? Promise.resolve(stream) } } }, AudioContext: Context }, stream, track,
    push(input: Float32Array, playbackTime = playback) { processor.onaudioprocess({ inputBuffer: { getChannelData: () => input }, playbackTime }); playback = playbackTime + input.length / rate },
    get stops() { return stops }, get closes() { return closes }, get gumCalls() { return gumCalls }, get context() { return context } }
}
const identity = { queue_contract: 1, meeting_id: "owned-meeting", capture_id: "00000000-0000-4000-8000-000000000494", capture_epoch: 1 }
function status(phase = "capturing", extra: any = {}) { return { type: "meeting.capture.status", ...identity, phase, input_open: phase === "capturing", credits: [], ...extra } }

test("actual ScriptProcessor stays open while earlier chunk ACK is delayed; Stop flushes all 1376 samples once", async () => {
  const audio = audioEnvironment(), wire: any[] = [], errors: string[] = []
  let release!: (ack: any) => void, ended = 0
  const capture = createMeetingContinuousCapture({ meetingId: identity.meeting_id, captureId: identity.capture_id, epoch: 1, modelId: "medium", env: audio.env,
    onError: c => errors.push(c), onEnd: () => ended++, request: async m => {
      wire.push(m)
      if (m.type === "voice.stt.start") return status("capturing", { type: "voice.stt.partial", status: "receiving", credits: initial })
      if (m.type === "voice.stt.chunk") {
        const ack = status("capturing", { credit_id: m.credit_id, accepted_through: Number(m.sample_offset) + Number(m.frame_count) })
        if (m.credit_id === 1) return new Promise(resolve => { release = resolve })
        return ack
      }
      return status(m.type === "voice.stt.abort" ? "finished" : "draining")
    } })
  try {
    await capture.start(); assert.equal(capture.backend, "scriptprocessor")
    const input = samples(1376)
    audio.push(input.subarray(0, 640)); assert.equal(audio.stops, 0)
    audio.push(input.subarray(640, 1280)); assert.equal(audio.stops, 0, "slow ACK/inference is not a microphone pause")
    audio.push(input.subarray(1280)); const stopping = capture.stop()
    assert.equal(audio.stops, 1)
    release(status("capturing", { credit_id: 1, accepted_through: 640 }))
    await stopping
    const chunks = wire.filter(m => m.type === "voice.stt.chunk")
    assert.deepEqual(chunks.map(m => [m.sample_offset, m.frame_count]), [[0, 640], [640, 640], [1280, 96]])
    assert.deepEqual(joined(chunks.map(m => Uint8Array.from(atob(m.data), char => char.charCodeAt(0)))), encode(input, 16000, []).pcm)
    assert.equal(wire.at(-1).type, "voice.stt.end"); assert.equal(wire.at(-1).final_sample_end, 1376)
    assert.equal(audio.closes, 1); assert.equal(audio.gumCalls, 1); assert.equal(ended, 0)
    capture.handleStatus(status("finished")); assert.equal(ended, 1)
    assert.deepEqual(errors, [])
  } finally { capture.destroy() }
})

test("Cancel before permission resolution stops late tracks and never sends voice.start/chunk/end", async () => {
  let resolve!: (s: any) => void
  const audio = audioEnvironment(new Promise(r => { resolve = r })), wire: any[] = []
  const capture = createMeetingContinuousCapture({ meetingId: identity.meeting_id, captureId: identity.capture_id, epoch: 1, modelId: "medium", env: audio.env,
    request: async m => { wire.push(m); return status("finished") } })
  const start = capture.start(); await capture.abort(); resolve(audio.stream); await start
  assert.equal(audio.stops, 1); assert.equal(audio.closes, 0)
  assert.deepEqual(wire.map(m => m.type), ["voice.stt.abort"])
})

test("no credit stops at the admitted boundary with explicit transport_backpressure", () => {
  const blocks: any[] = [], sealed: any[] = []
  const encoder = new MeetingPcmEncoder(b => blocks.push(b), (end, reason) => sealed.push({ end, reason }))
  encoder.grant(initial.slice(0, 1)); encoder.push(samples(641), 16000)
  encoder.push(samples(999), 16000)
  assert.equal(blocks.length, 1); assert.equal(blocks[0].frame_count, 640)
  assert.deepEqual(sealed, [{ end: 640, reason: "transport_backpressure" }])
})

// Recorded native Chrome153 fallback: full1024-frame input callbacks at48k arrive
// about20ms apart while OUTPUT playbackTime jumps5.333ms. It is not an input cursor.
test("actual ScriptProcessor preserves identical valid PCM across the recorded native output timestamp jump", async () => {
  const audio = audioEnvironment(undefined, 48000), wire: any[] = []
  const capture = createMeetingContinuousCapture({ meetingId: identity.meeting_id, captureId: identity.capture_id, epoch: 1, modelId: "medium", env: audio.env, request: async m => {
    wire.push(m)
    if (m.type === "voice.stt.start") return status("capturing", { type: "voice.stt.partial", status: "receiving", credits: initial })
    if (m.type === "voice.stt.chunk") return status("capturing", { credit_id: m.credit_id, accepted_through: Number(m.sample_offset) + Number(m.frame_count) })
    return status("draining")
  } })
  try {
    await capture.start()
    const input = samples(2048)
    audio.push(input.subarray(0, 1024), 0.4533333333333333)
    audio.push(input.subarray(1024), 0.48)
    assert.equal(audio.stops, 0, "native output scheduling metadata cannot manufacture an input gap")
    await capture.stop()
    const chunks = wire.filter(m => m.type === "voice.stt.chunk")
    assert.deepEqual(joined(chunks.map(m => Uint8Array.from(atob(m.data), value => value.charCodeAt(0)))), encode(input, 48000, []).pcm)
    assert.equal(wire.at(-1).stop_reason, "user_stop")
    assert.equal(wire.at(-1).final_sample_end, encode(input, 48000, []).seals[0].end)
    assert.equal(audio.stops, 1); assert.equal(audio.closes, 1)
  } finally { capture.destroy() }
})

test("real track end/mute, context suspension and the original10s callback-idle guard still stop admission", async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout
  const idleTimers = new Map<number, () => void>(); let next = 10000000
  globalThis.setTimeout = ((handler: any, ms?: number, ...args: any[]) => {
    if (ms === 10000) { const id = ++next; idleTimers.set(id, () => handler(...args)); return id }
    return originalSet(handler, ms, ...args)
  }) as typeof setTimeout
  globalThis.clearTimeout = ((id: number | undefined) => { if (id !== undefined && idleTimers.has(id)) idleTimers.delete(id); else originalClear(id) }) as typeof clearTimeout
  try {
    for (const cause of ["mute", "ended", "suspended", "idle"] as const) {
      const audio = audioEnvironment(), wire: any[] = []
      const capture = createMeetingContinuousCapture({ meetingId: identity.meeting_id, captureId: identity.capture_id, epoch: 1, modelId: "medium", env: audio.env, request: async m => {
        wire.push(m)
        if (m.type === "voice.stt.start") return status("capturing", { type: "voice.stt.partial", status: "receiving", credits: initial })
        return status("draining")
      } })
      try {
        await capture.start(); assert.equal(audio.stops, 0)
        if (cause === "mute") audio.track.onmute()
        if (cause === "ended") audio.track.onended()
        if (cause === "suspended") { audio.context.state = "suspended"; audio.context.onstatechange() }
        if (cause === "idle") { assert.equal(idleTimers.size, 1, "actual timer remains exactly10000ms"); [...idleTimers.values()][0]() }
        await capture.stop()
        assert.equal(audio.stops, 1); assert.equal(audio.closes, 1)
        assert.equal(wire.at(-1).type, "voice.stt.end")
        assert.equal(wire.at(-1).stop_reason, cause === "ended" ? "permission_revoked" : cause === "suspended" ? "suspended" : "input_gap")
        assert.equal(wire.filter(m => m.type === "voice.stt.chunk").length, 0)
      } finally { capture.destroy() }
    }
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear }
})
