/**
 * #260 — embedding diarize WS pipeline (upload_* + auto_diarize mode:embedding).
 * Fake embedder injected via deps; no onnxruntime needed here.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mtg260-"))

import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { loadMeeting } from "../src/meeting/meeting-store"
import { resetPcmSessionsForTests } from "../src/meeting/diarize-pcm-store"
import type { EmbedSegmentsResult } from "../src/meeting/diarize-embed"

const EXT = "chrome-extension://abcdefghijklmnopqrstuvwxyz"
const DATA = process.env.CMSPARK_DATA_DIR!

function chunkB64(bytes = 4096): string {
  return Buffer.alloc(bytes, 3).toString("base64")
}

/** Alternating two-speaker embeddings by segment index parity (one-hot 192-dim). */
function fakeEmbedderTwoSpeakers(
  captures: { count: number; progress: { done: number; total: number }[] } = { count: 0, progress: [] },
): (pcm: Float32Array[], opts?: { onProgress?: (p: { done: number; total: number }) => void }) => Promise<EmbedSegmentsResult> {
  return async (pcm, opts) => {
    captures.count = pcm.length
    const embeddings = pcm.map((_, i) => {
      const v = new Array<number>(192).fill(0)
      v[i % 2] = 1
      return v
    })
    for (let i = 0; i < pcm.length; i++) {
      opts?.onProgress?.({ done: i + 1, total: pcm.length })
    }
    return { ok: true, embeddings }
  }
}

async function makeMeetingWith4Lines(): Promise<string> {
  const created = await handleMeetingMessage(
    { type: "meeting.create", v: 1, title: "Emb" },
    { origin: EXT },
  )
  const id = created.meeting.id as string
  await handleMeetingMessage(
    {
      type: "meeting.set_transcript",
      v: 1,
      id,
      text: "第一段\n\n第二段\n\n第三段\n\n第四段",
      silence_cut: true,
    },
    { origin: EXT },
  )
  return id
}

async function uploadPcm(
  segments: number,
  chunksPerSegment: number[] = [1, 1, 1, 1],
): Promise<string> {
  const started = await handleMeetingMessage(
    {
      type: "meeting.diarize.upload_start",
      v: 1,
      privacy_ack_v1: true,
      segments,
      sample_rate: 16000,
      format: "pcm_s16le",
    },
    { origin: EXT },
  )
  assert.equal(started.type, "meeting.diarize.upload_started")
  const sessionId = started.session_id as string
  for (let i = 0; i < segments; i++) {
    for (let s = 0; s < (chunksPerSegment[i] ?? 1); s++) {
      const r = await handleMeetingMessage(
        {
          type: "meeting.diarize.upload_chunk",
          v: 1,
          session_id: sessionId,
          index: i,
          seq: s,
          data: chunkB64(),
        },
        { origin: EXT },
      )
      assert.equal(r.type, "meeting.diarize.chunk_ok", `chunk ${i}/${s}: ${JSON.stringify(r)}`)
    }
  }
  const ended = await handleMeetingMessage(
    {
      type: "meeting.diarize.upload_end",
      v: 1,
      session_id: sessionId,
      total_seqs: chunksPerSegment.slice(0, segments).map((c) => c ?? 1),
    },
    { origin: EXT },
  )
  assert.equal(ended.type, "meeting.diarize.upload_ended")
  return sessionId
}

test("upload_start requires privacy ack; non-extension origin denied", async () => {
  resetPcmSessionsForTests()
  const noAck = await handleMeetingMessage(
    {
      type: "meeting.diarize.upload_start",
      v: 1,
      segments: 2,
      sample_rate: 16000,
      format: "pcm_s16le",
    },
    { origin: EXT },
  )
  assert.equal(noAck.code, "need_privacy_ack")

  const denied = await handleMeetingMessage(
    {
      type: "meeting.diarize.upload_start",
      v: 1,
      privacy_ack_v1: true,
      segments: 2,
      sample_rate: 16000,
      format: "pcm_s16le",
    },
    { origin: "https://evil.example.com" },
  )
  assert.equal(denied.code, "origin_denied")
})

test("chunk seq gap surfaces as meeting.error seq_gap", async () => {
  resetPcmSessionsForTests()
  const started = await handleMeetingMessage(
    {
      type: "meeting.diarize.upload_start",
      v: 1,
      privacy_ack_v1: true,
      segments: 1,
      sample_rate: 16000,
      format: "pcm_s16le",
    },
    { origin: EXT },
  )
  const sessionId = started.session_id as string
  const gap = await handleMeetingMessage(
    { type: "meeting.diarize.upload_chunk", v: 1, session_id: sessionId, index: 0, seq: 5, data: chunkB64() },
    { origin: EXT },
  )
  assert.equal(gap.type, "meeting.error")
  assert.equal(gap.code, "seq_gap")
})

test("full pipeline: upload → auto_diarize embedding → 发言人N labels + progress", async () => {
  resetPcmSessionsForTests()
  const id = await makeMeetingWith4Lines()
  const m0 = loadMeeting(id, DATA)!
  assert.ok(m0.transcript.length >= 2)
  const n = m0.transcript.length

  const sessionId = await uploadPcm(n, new Array(n).fill(1))

  const sent: any[] = []
  const caps = { count: 0, progress: [] as { done: number; total: number }[] }
  const r = await handleMeetingMessage(
    {
      type: "meeting.auto_diarize",
      v: 1,
      privacy_ack_v1: true,
      id,
      mode: "embedding",
      pcm_session: sessionId,
      k: 2,
      preserve_manual: true,
    },
    { origin: EXT, send: (d) => sent.push(d) },
    { embedSegments: fakeEmbedderTwoSpeakers(caps) as any },
  )
  assert.equal(r.type, "meeting.diarized", JSON.stringify(r))
  assert.equal(r.diarize.method, "embedding")
  assert.equal(r.diarize.k, 2)
  assert.equal(r.diarize.experimental, true) // round-2 held-out gate FAIL → experimental back on
  assert.equal(caps.count, n)
  // progress broadcast via ctx.send
  assert.ok(
    sent.some((d) => d.type === "meeting.diarize.progress" && d.total === n && d.done === n),
    "progress broadcast present",
  )
  const m1 = loadMeeting(id, DATA)!
  assert.equal(m1.diarize?.method, "embedding")
  const speakers = new Set(m1.transcript.map((l) => l.speaker))
  for (const sp of speakers) assert.match(sp!, /^发言人\d+$/)
  assert.ok(speakers.size >= 1 && speakers.size <= 2)
})

test("embedding session consumed once: second run → pcm_session_not_found", async () => {
  resetPcmSessionsForTests()
  const id = await makeMeetingWith4Lines()
  const n = loadMeeting(id, DATA)!.transcript.length
  const sessionId = await uploadPcm(n, new Array(n).fill(1))
  await handleMeetingMessage(
    { type: "meeting.auto_diarize", v: 1, privacy_ack_v1: true, id, mode: "embedding", pcm_session: sessionId, k: 2 },
    { origin: EXT },
    { embedSegments: fakeEmbedderTwoSpeakers() as any },
  )
  const again = await handleMeetingMessage(
    { type: "meeting.auto_diarize", v: 1, privacy_ack_v1: true, id, mode: "embedding", pcm_session: sessionId, k: 2 },
    { origin: EXT },
    { embedSegments: fakeEmbedderTwoSpeakers() as any },
  )
  assert.equal(again.code, "pcm_session_not_found")
})

test("pcm segment count mismatch → pcm_mismatch (session NOT consumed)", async () => {
  resetPcmSessionsForTests()
  const id = await makeMeetingWith4Lines()
  const n = loadMeeting(id, DATA)!.transcript.length
  const sessionId = await uploadPcm(n + 1, new Array(n + 1).fill(1))
  const r = await handleMeetingMessage(
    { type: "meeting.auto_diarize", v: 1, privacy_ack_v1: true, id, mode: "embedding", pcm_session: sessionId, k: 2 },
    { origin: EXT },
    { embedSegments: fakeEmbedderTwoSpeakers() as any },
  )
  assert.equal(r.code, "pcm_mismatch")
})

test("model not ready passthrough: embedding_model_required, no silent legacy fallback", async () => {
  resetPcmSessionsForTests()
  const id = await makeMeetingWith4Lines()
  const n = loadMeeting(id, DATA)!.transcript.length
  const sessionId = await uploadPcm(n, new Array(n).fill(1))
  const r = await handleMeetingMessage(
    { type: "meeting.auto_diarize", v: 1, privacy_ack_v1: true, id, mode: "embedding", pcm_session: sessionId, k: 2 },
    { origin: EXT },
    {
      embedSegments: (async () => ({
        ok: false,
        code: "embedding_model_required",
        message: "说话人模型未就绪",
      })) as any,
    },
  )
  assert.equal(r.type, "meeting.error")
  assert.equal(r.code, "embedding_model_required")
  // transcript untouched (no legacy auto-labeling)
  const m = loadMeeting(id, DATA)!
  assert.ok(m.transcript.every((l) => !/^发言人\d+$/.test(l.speaker ?? "")))
})

test("upload_end total_seqs mismatch kept actionable (session stays)", async () => {
  resetPcmSessionsForTests()
  const started = await handleMeetingMessage(
    {
      type: "meeting.diarize.upload_start",
      v: 1,
      privacy_ack_v1: true,
      segments: 2,
      sample_rate: 16000,
      format: "pcm_s16le",
    },
    { origin: EXT },
  )
  const sessionId = started.session_id as string
  await handleMeetingMessage(
    { type: "meeting.diarize.upload_chunk", v: 1, session_id: sessionId, index: 0, seq: 0, data: chunkB64() },
    { origin: EXT },
  )
  const bad = await handleMeetingMessage(
    { type: "meeting.diarize.upload_end", v: 1, session_id: sessionId, total_seqs: [2, 0] },
    { origin: EXT },
  )
  assert.equal(bad.code, "total_seqs_mismatch")
  // correct end still works afterwards
  await handleMeetingMessage(
    { type: "meeting.diarize.upload_chunk", v: 1, session_id: sessionId, index: 0, seq: 1, data: chunkB64() },
    { origin: EXT },
  )
  await handleMeetingMessage(
    { type: "meeting.diarize.upload_chunk", v: 1, session_id: sessionId, index: 1, seq: 0, data: chunkB64() },
    { origin: EXT },
  )
  const ok = await handleMeetingMessage(
    { type: "meeting.diarize.upload_end", v: 1, session_id: sessionId, total_seqs: [2, 1] },
    { origin: EXT },
  )
  assert.equal(ok.type, "meeting.diarize.upload_ended")
})
