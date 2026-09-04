// #260 — extension PCM upload client state machine:
// upload_start → chunks → upload_end → auto_diarize(embedding) → diarized/error.
// 缺模型错误必须原样上抛（embedding_model_required），不静默落回旧引擎。

import test from "node:test"
import assert from "node:assert/strict"
import {
  diarizeViaEmbeddingUpload,
  wavToRawPcm,
  WAV_HEADER_BYTES,
} from "../src/sidepanel/voice/meeting-diarize-upload"
import { LOCAL_STT_MAX_CHUNK_RAW_BYTES } from "../src/sidepanel/voice/local-stt-detect"

type Port = {
  sent: any[]
  send: (m: any) => void
  emit: (m: any) => void
  onMessage: (h: (m: any) => void) => () => void
}

function makePort(): Port {
  const sent: any[] = []
  const listeners = new Set<(m: any) => void>()
  return {
    sent,
    send: (m) => sent.push(m),
    emit: (m) => {
      for (const l of [...listeners]) l(m)
    },
    onMessage: (h) => {
      listeners.add(h)
      return () => listeners.delete(h)
    },
  }
}

const MEETING = "mtg-1"

test("happy path: start → session_id → chunks → end → auto_diarize → diarized", async () => {
  const port = makePort()
  const progress: { done: number; total: number }[] = []
  const p = diarizeViaEmbeddingUpload({
    meetingId: MEETING,
    pcmSegments: [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])],
    k: 0,
    send: port.send,
    onMessage: port.onMessage,
    onProgress: (pr) => progress.push(pr),
  })

  assert.equal(port.sent.length, 1)
  const start = port.sent[0]
  assert.equal(start.type, "meeting.diarize.upload_start")
  assert.equal(start.privacy_ack_v1, true)
  assert.equal(start.segments, 2)
  assert.equal(start.sample_rate, 16000)
  assert.equal(start.format, "pcm_s16le")

  port.emit({ type: "meeting.diarize.upload_started", v: 1, session_id: "dpcm_aa" })
  // chunks fired synchronously after session assignment
  const chunks = port.sent.filter((m) => m.type === "meeting.diarize.upload_chunk")
  assert.equal(chunks.length, 2)
  assert.deepEqual(
    chunks.map((c) => [c.session_id, c.index, c.seq]),
    [
      ["dpcm_aa", 0, 0],
      ["dpcm_aa", 1, 0],
    ],
  )
  assert.equal(atob(chunks[0].data).length, 4)
  const end = port.sent.find((m: any) => m.type === "meeting.diarize.upload_end")
  assert.deepEqual(end.total_seqs, [1, 1])
  assert.equal(end.session_id, "dpcm_aa")

  port.emit({ type: "meeting.diarize.upload_ended", v: 1, session_id: "dpcm_aa" })
  const auto = port.sent.find((m: any) => m.type === "meeting.auto_diarize")
  assert.equal(auto.mode, "embedding")
  assert.equal(auto.pcm_session, "dpcm_aa")
  assert.equal(auto.id, MEETING)
  assert.equal(auto.privacy_ack_v1, true)
  assert.equal(auto.k, 0)
  assert.equal(auto.preserve_manual, true)

  port.emit({ type: "meeting.diarize.progress", v: 1, id: MEETING, done: 1, total: 2 })
  port.emit({ type: "meeting.diarize.progress", v: 1, id: MEETING, done: 2, total: 2 })
  assert.deepEqual(progress, [
    { done: 1, total: 2 },
    { done: 2, total: 2 },
  ])

  port.emit({ type: "meeting.diarized", meeting: { id: MEETING } })
  assert.deepEqual(await p, { ok: true })
})

test("oversize segment splits into multiple seqs; total_seqs counts chunks", async () => {
  const port = makePort()
  const big = new Uint8Array(LOCAL_STT_MAX_CHUNK_RAW_BYTES + 10)
  const p = diarizeViaEmbeddingUpload({
    meetingId: MEETING,
    pcmSegments: [big],
    k: 3,
    preserveManual: false,
    send: port.send,
    onMessage: port.onMessage,
  })
  port.emit({ type: "meeting.diarize.upload_started", v: 1, session_id: "dpcm_bb" })
  const chunks = port.sent.filter((m) => m.type === "meeting.diarize.upload_chunk")
  assert.equal(chunks.length, 2)
  assert.equal(atob(chunks[0].data).length, LOCAL_STT_MAX_CHUNK_RAW_BYTES)
  assert.equal(atob(chunks[1].data).length, 10)
  const end = port.sent.find((m: any) => m.type === "meeting.diarize.upload_end")
  assert.deepEqual(end.total_seqs, [2])

  port.emit({ type: "meeting.diarize.upload_ended", v: 1, session_id: "dpcm_bb" })
  const auto = port.sent.find((m: any) => m.type === "meeting.auto_diarize")
  assert.equal(auto.preserve_manual, undefined)
  port.emit({ type: "meeting.diarized", meeting: { id: MEETING } })
  assert.deepEqual(await p, { ok: true })
})

test("session-mismatch upload_ended ignored; foreign diarized ignored", async () => {
  const port = makePort()
  const p = diarizeViaEmbeddingUpload({
    meetingId: MEETING,
    pcmSegments: [new Uint8Array([9, 9])],
    k: 2,
    send: port.send,
    onMessage: port.onMessage,
  })
  port.emit({ type: "meeting.diarize.upload_started", v: 1, session_id: "dpcm_cc" })
  port.emit({ type: "meeting.diarize.upload_ended", v: 1, session_id: "dpcm_other" })
  assert.equal(
    port.sent.some((m) => m.type === "meeting.auto_diarize"),
    false,
    "foreign session must not advance the machine",
  )
  port.emit({ type: "meeting.diarize.upload_ended", v: 1, session_id: "dpcm_cc" })
  port.emit({ type: "meeting.diarized", meeting: { id: "mtg-other" } })
  assert.equal((p as any).settledValue, undefined)
  port.emit({ type: "meeting.diarized", meeting: { id: MEETING } })
  assert.deepEqual(await p, { ok: true })
})

test("meeting.error surfaces machine code (embedding_model_required) — no silent fallback", async () => {
  const port = makePort()
  const p = diarizeViaEmbeddingUpload({
    meetingId: MEETING,
    pcmSegments: [new Uint8Array([1])],
    k: 0,
    send: port.send,
    onMessage: port.onMessage,
  })
  port.emit({ type: "meeting.diarize.upload_started", v: 1, session_id: "dpcm_dd" })
  port.emit({
    type: "meeting.error",
    v: 1,
    code: "embedding_model_required",
    message: "请到 设置 → 语音模型 下载",
  })
  const r = await p
  assert.equal(r.ok, false)
  if (r.ok === false) {
    assert.equal(r.code, "embedding_model_required")
    assert.match(r.message ?? "", /语音模型/)
  }
})

test("error bound to another meeting id is ignored", async () => {
  const port = makePort()
  const p = diarizeViaEmbeddingUpload({
    meetingId: MEETING,
    pcmSegments: [new Uint8Array([1])],
    k: 0,
    send: port.send,
    onMessage: port.onMessage,
    timeoutMs: 60,
  })
  port.emit({ type: "meeting.diarize.upload_started", v: 1, session_id: "dpcm_ee" })
  port.emit({ type: "meeting.error", v: 1, id: "mtg-other", code: "boom" })
  port.emit({ type: "meeting.diarized", meeting: { id: MEETING } })
  assert.deepEqual(await p, { ok: true })
})

test("timeout with no server response", async () => {
  const port = makePort()
  const r = await diarizeViaEmbeddingUpload({
    meetingId: MEETING,
    pcmSegments: [new Uint8Array([1])],
    k: 0,
    send: port.send,
    onMessage: port.onMessage,
    timeoutMs: 15,
  })
  assert.deepEqual(r, { ok: false, code: "timeout" })
})

test("empty segment list → no_segments without any send", async () => {
  const port = makePort()
  const r = await diarizeViaEmbeddingUpload({
    meetingId: MEETING,
    pcmSegments: [],
    k: 0,
    send: port.send,
    onMessage: port.onMessage,
  })
  assert.equal(r.ok, false)
  if (r.ok === false) assert.equal(r.code, "no_segments")
  assert.equal(port.sent.length, 0)
})

test("wavToRawPcm strips the 44-byte header; short input → empty", () => {
  const wav = new Uint8Array(WAV_HEADER_BYTES + 5)
  wav[44] = 0xab
  const pcm = wavToRawPcm(wav)
  assert.equal(pcm.length, 5)
  assert.equal(pcm[0], 0xab)
  assert.equal(wavToRawPcm(new Uint8Array(WAV_HEADER_BYTES)).length, 0)
})

test("legacy mode: mode audio_cluster sent through (explicit old-engine fallback)", async () => {
  const port = makePort()
  const p = diarizeViaEmbeddingUpload({
    meetingId: MEETING,
    pcmSegments: [new Uint8Array([1, 2])],
    k: 0,
    mode: "audio_cluster",
    send: port.send,
    onMessage: port.onMessage,
  })
  port.emit({ type: "meeting.diarize.upload_started", v: 1, session_id: "dpcm_fg" })
  port.emit({ type: "meeting.diarize.upload_ended", v: 1, session_id: "dpcm_fg" })
  const auto = port.sent.find((m: any) => m.type === "meeting.auto_diarize")
  assert.equal(auto.mode, "audio_cluster")
  assert.equal(auto.pcm_session, "dpcm_fg")
  assert.equal(auto.privacy_ack_v1, true)
  port.emit({ type: "meeting.diarized", meeting: { id: MEETING } })
  assert.deepEqual(await p, { ok: true })
})
