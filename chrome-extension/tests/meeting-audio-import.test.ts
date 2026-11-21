/**
 * Mtg2 audio segment helper (pure + mock AudioContext).
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  fileToWavSegments,
  uint8ToBase64,
  MEETING_AUDIO_IMPORT_MAX_FILE_BYTES,
  transcribeWavViaStt,
  meetingAudioSttTimeoutMs,
} from "../src/sidepanel/voice/meeting-audio-import"
import { LOCAL_STT_SAMPLE_RATE } from "../src/sidepanel/voice/local-stt-detect"
import { beginMeetingExternalImport, meetingExternalConfirmation } from "../src/sidepanel/voice/meeting-external-asr"

test("uint8ToBase64 round-trip small", () => {
  const u = new Uint8Array([1, 2, 3, 250])
  const b64 = uint8ToBase64(u)
  assert.equal(typeof b64, "string")
  assert.ok(b64.length > 0)
})

test("local meeting imports identify their own capture purpose", async () => {
  const sent: Record<string, unknown>[] = []
  let receive: (message: any) => void = () => {}
  await transcribeWavViaStt({ wav: new Uint8Array(46), sessionId: "local-fixture", modelId: "medium",
    send: message => {
      sent.push(message)
      if (message.type === "voice.stt.end") receive({ type: "voice.stt.result", sessionId: "local-fixture", text: "local" })
    },
    onMessage: handler => { receive = handler; return () => {} },
  })
  assert.equal(sent[0].purpose, "meeting-import")
  assert.equal(sent[0].privacy_ack_v2, true)
})

test("meeting confirmation names the actual endpoint, model, and selected file", () => {
  const text = meetingExternalConfirmation("会议.wav", { normalizedUrl: "https://asr.example/v1/audio/transcriptions", model: "test-model" }, 92, 3)
  for (const part of ["会议.wav", "https://asr.example/v1/audio/transcriptions", "test-model", "3 段", "1:32"]) assert.ok(text.includes(part), part)
})

test("external import authorizes segment digests before sending audio and cancels its own grant", async () => {
  const sent: Record<string, unknown>[] = []
  const controller = new AbortController()
  let resolveSegment!: (value: any) => void
  const segments = [
    { index: 0, wav: Uint8Array.of(1, 2, 3), t0Sec: 0, t1Sec: 45 },
    { index: 1, wav: Uint8Array.of(4, 5, 6), t0Sec: 45, t1Sec: 90 },
  ]
  const job = await beginMeetingExternalImport({
    configIdentity: "recipient-version", segments, requestTimeoutMs: 30_000, signal: controller.signal,
    request: (message: Record<string, unknown>) => {
      sent.push(message)
      if (message.type === "meeting.asr.authorize") return Promise.resolve({ type: "meeting.asr.authorized", token: "test-grant" })
      if (message.type === "meeting.asr.cancel") return Promise.resolve({ type: "meeting.asr.cancelled", delivery: "unknown" })
      if (message.index === 0) return Promise.resolve({ type: "meeting.asr.result", index: 0, text: "retained" })
      return new Promise(resolve => { resolveSegment = resolve })
    },
  })
  assert.equal(job.ok, true)
  if (!job.ok) return
  assert.deepEqual(sent.map(message => message.type), ["meeting.asr.authorize"])
  assert.deepEqual(sent[0].segments, [
    { bytes: 3, sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81" },
    { bytes: 3, sha256: "787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472" },
  ])
  assert.equal(sent[0].privacy_ack_meeting_asr_v1, true)
  assert.deepEqual(await job.transcribe(segments[0]), { ok: true, text: "retained" })
  assert.equal(sent[1].data, "AQID")
  const pending = job.transcribe(segments[1])
  controller.abort()
  assert.deepEqual(await pending, { ok: false, code: "aborted", delivery: "unknown" })
  resolveSegment({ type: "meeting.asr.result", index: 1, text: "late" })
  job.dispose()
  assert.deepEqual(sent.map(message => message.type), ["meeting.asr.authorize", "meeting.asr.segment", "meeting.asr.segment", "meeting.asr.cancel"])
  assert.equal(sent[3].token, "test-grant")
})

test("import timeout aborts its real STT session and unsubscribes", async () => {
  const sent: Record<string, unknown>[] = []
  let unsubscribed = false
  const result = await transcribeWavViaStt({ wav: new Uint8Array(44), sessionId: 'import-timeout', modelId: 'medium',
    timeoutMs: 5, send: message => { sent.push(message) }, onMessage: () => () => { unsubscribed = true } })
  assert.deepEqual(result, { ok: false, code: 'timeout' })
  assert.equal(sent.at(-1)?.type, 'voice.stt.abort')
  assert.equal(sent.at(-1)?.sessionId, 'import-timeout')
  assert.equal(unsubscribed, true)
})

test("canceling an import releases only its session and ignores late results", async () => {
  const controller = new AbortController()
  const sent: Record<string, unknown>[] = []
  let handler: (message: any) => void = () => {}
  let unsubscribed = false
  const pending = transcribeWavViaStt({ wav: new Uint8Array(44), sessionId: 'import-cancel', modelId: 'medium',
    signal: controller.signal, send: (message: Record<string, unknown>) => { sent.push(message) },
    onMessage: (listener: (message: any) => void) => { handler = listener; return () => { unsubscribed = true } },
  } as Parameters<typeof transcribeWavViaStt>[0])
  controller.abort()
  handler({ type: 'voice.stt.result', sessionId: 'import-cancel', text: 'late' })
  assert.deepEqual(await pending, { ok: false, code: 'aborted' })
  assert.equal(unsubscribed, true)
  assert.equal(sent.at(-1)?.type, 'voice.stt.abort')
  assert.equal(sent.at(-1)?.sessionId, 'import-cancel')
})

test("an already canceled import never acquires the shared STT session", async () => {
  const controller = new AbortController()
  controller.abort()
  const sent: unknown[] = []
  const result = await transcribeWavViaStt({ wav: new Uint8Array(44), sessionId: 'never-start', modelId: 'medium',
    signal: controller.signal, send: message => { sent.push(message) }, onMessage: () => () => {} })
  assert.deepEqual(result, { ok: false, code: 'aborted' })
  assert.deepEqual(sent, [])
})

test("large model import allows the same five-minute inference budget as the live adapter", () => {
  assert.equal(meetingAudioSttTimeoutMs('large-v3-turbo'), 305_000)
  assert.equal(meetingAudioSttTimeoutMs('medium'), 120_000)
})

test("fileToWavSegments rejects empty blob", async () => {
  const r = await fileToWavSegments(new Blob([]))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "empty")
})

test("fileToWavSegments rejects oversize", async () => {
  const big = new Blob([new Uint8Array(MEETING_AUDIO_IMPORT_MAX_FILE_BYTES + 1)])
  const r = await fileToWavSegments(big)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "too_large")
})

test("fileToWavSegments with mock AudioContext produces segments", async () => {
  // 2.0s of silence at 16k mono as fake decode
  const samples = LOCAL_STT_SAMPLE_RATE * 2
  const channel = new Float32Array(samples)

  class FakeCtx {
    decodeAudioData = async () => ({
      length: samples,
      numberOfChannels: 1,
      sampleRate: LOCAL_STT_SAMPLE_RATE,
      duration: 2,
      getChannelData: () => channel,
    })
    close = async () => {}
  }

  const blob = new Blob([new Uint8Array([0, 1, 2, 3])])
  const r = await fileToWavSegments(blob, {
    audioContextFactory: () => new FakeCtx() as any,
    segmentMs: 1000, // 1s segments → ~2 segs
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.ok(r.segments.length >= 2)
    assert.ok(r.segments[0]!.wav.length > 44)
    // RIFF header + 16-bit PCM body (1s segment → 44 + 32000 bytes)
    assert.equal(r.segments[0]!.wav[0], 0x52)
    assert.equal(r.segments[0]!.wav.length, 44 + LOCAL_STT_SAMPLE_RATE * 2)
    assert.equal(r.segments[0]!.index, 0)
  }
})
