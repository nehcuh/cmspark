/**
 * #260 — in-memory PCM upload sessions for embedding diarize.
 * Extension chunks base64 s16le mono 16k PCM per transcript segment up; the
 * audio lives ONLY in this process's memory (never persisted, never leaves the
 * machine) and is consumed once by meeting.auto_diarize mode:"embedding".
 * Fail-closed caps: segments / chunk size / total bytes / session count / TTL.
 */

import { randomBytes } from "node:crypto"

export const DIARIZE_PCM_MAX_SEGMENTS = 2000
export const DIARIZE_PCM_MAX_CHUNK_BYTES = 2 * 1024 * 1024
export const DIARIZE_PCM_MAX_TOTAL_BYTES = 400 * 1024 * 1024
export const DIARIZE_PCM_SESSION_TTL_MS = 10 * 60 * 1000
export const DIARIZE_PCM_MAX_SESSIONS = 8

type SegmentAcc = {
  bytes: Buffer[]
  total: number
  chunks: number
}

type PcmSession = {
  id: string
  createdAt: number
  sampleRate: number
  segments: SegmentAcc[]
  pcm?: Float32Array[]
}

const sessions = new Map<string, PcmSession>()

export function resetPcmSessionsForTests(): void {
  sessions.clear()
}

export function pcmSessionCount(): number {
  return sessions.size
}

export type PcmStoreOk<T> = { ok: true; value: T }
export type PcmStoreErr = { ok: false; code: string; message: string }
export type PcmStoreResult<T> = PcmStoreOk<T> | PcmStoreErr

function err(code: string, message: string): PcmStoreErr {
  return { ok: false, code, message }
}

function sweepStale(now: number): void {
  for (const [id, s] of sessions) {
    if (now - s.createdAt > DIARIZE_PCM_SESSION_TTL_MS) sessions.delete(id)
  }
}

export function createPcmSession(
  input: { segments: number; sampleRate: number; format: string },
  now: number = Date.now(),
): PcmStoreResult<string> {
  sweepStale(now)
  if (!Number.isInteger(input.segments) || input.segments < 1 || input.segments > DIARIZE_PCM_MAX_SEGMENTS) {
    return err("invalid_segments", `segments must be integer 1..${DIARIZE_PCM_MAX_SEGMENTS}`)
  }
  if (input.sampleRate !== 16000) {
    return err("invalid_sample_rate", "sample_rate must be 16000")
  }
  if (input.format !== "pcm_s16le") {
    return err("invalid_format", 'format must be "pcm_s16le"')
  }
  // Cap concurrent sessions; drop oldest first.
  while (sessions.size >= DIARIZE_PCM_MAX_SESSIONS) {
    let oldest: string | null = null
    let oldestAt = Infinity
    for (const [id, s] of sessions) {
      if (s.createdAt < oldestAt) {
        oldestAt = s.createdAt
        oldest = id
      }
    }
    if (!oldest) break
    sessions.delete(oldest)
  }
  const id = `dpcm_${randomBytes(8).toString("hex")}`
  sessions.set(id, {
    id,
    createdAt: now,
    sampleRate: input.sampleRate,
    segments: Array.from({ length: input.segments }, () => ({ bytes: [], total: 0, chunks: 0 })),
  })
  return { ok: true, value: id }
}

export function appendPcmChunk(
  sessionId: string,
  index: number,
  seq: number,
  dataBase64: string,
  now: number = Date.now(),
): PcmStoreResult<{ received: number }> {
  sweepStale(now)
  const s = sessions.get(sessionId)
  if (!s) return err("session_not_found", `pcm session not found: ${sessionId}`)
  if (s.pcm) return err("session_finalized", "pcm session already finalized")
  if (!Number.isInteger(index) || index < 0 || index >= s.segments.length) {
    return err("invalid_index", `index must be integer 0..${s.segments.length - 1}`)
  }
  const seg = s.segments[index]!
  if (!Number.isInteger(seq) || seq < 0) {
    return err("invalid_seq", "seq must be non-negative integer")
  }
  if (seq !== seg.chunks) {
    return err("seq_gap", `expected seq ${seg.chunks} for segment ${index}, got ${seq}`)
  }
  let buf: Buffer
  try {
    buf = Buffer.from(dataBase64, "base64")
  } catch {
    return err("invalid_base64", "data is not valid base64")
  }
  if (buf.byteLength === 0) return err("empty_chunk", "chunk decoded to 0 bytes")
  if (buf.byteLength > DIARIZE_PCM_MAX_CHUNK_BYTES) {
    return err("chunk_too_large", `chunk decoded ${buf.byteLength} > ${DIARIZE_PCM_MAX_CHUNK_BYTES} bytes`)
  }
  const sessionTotal = s.segments.reduce((acc, x) => acc + x.total, 0) + buf.byteLength
  if (sessionTotal > DIARIZE_PCM_MAX_TOTAL_BYTES) {
    return err("total_too_large", `session total would exceed ${DIARIZE_PCM_MAX_TOTAL_BYTES} bytes`)
  }
  seg.bytes.push(buf)
  seg.total += buf.byteLength
  seg.chunks++
  return { ok: true, value: { received: seg.total } }
}

export function finalizePcmSession(
  sessionId: string,
  totalSeqs: number[],
  now: number = Date.now(),
): PcmStoreResult<{ segments: number }> {
  sweepStale(now)
  const s = sessions.get(sessionId)
  if (!s) return err("session_not_found", `pcm session not found: ${sessionId}`)
  if (s.pcm) return err("session_finalized", "pcm session already finalized")
  if (!Array.isArray(totalSeqs) || totalSeqs.length !== s.segments.length) {
    return err("total_seqs_mismatch", `total_seqs length must equal segments (${s.segments.length})`)
  }
  for (let i = 0; i < s.segments.length; i++) {
    const t = totalSeqs[i]
    if (!Number.isInteger(t) || t < 0) {
      return err("total_seqs_mismatch", `total_seqs[${i}] must be non-negative integer`)
    }
    const seg = s.segments[i]!
    if (t !== seg.chunks) {
      return err(
        "total_seqs_mismatch",
        `segment ${i}: total_seqs ${t} != received chunks ${seg.chunks}`,
      )
    }
    if (seg.total === 0) {
      return err("empty_segment", `segment ${i} received no audio`)
    }
    if (seg.total % 2 !== 0) {
      return err("odd_bytes", `segment ${i} byte length is not s16-aligned`)
    }
  }
  // Decode once: s16le → float32 [-1,1); keep only floats (drop raw bytes).
  s.pcm = s.segments.map((seg) => {
    const out = new Float32Array(seg.total / 2)
    let o = 0
    for (const b of seg.bytes) {
      for (let i = 0; i + 1 < b.byteLength; i += 2) {
        out[o++] = b.readInt16LE(i) / 32768
      }
    }
    seg.bytes = []
    seg.total = 0
    return out
  })
  return { ok: true, value: { segments: s.pcm.length } }
}

/** One-shot consume of finalized PCM (deletes the session). */
export function consumeFinalizedPcm(sessionId: string): Float32Array[] | null {
  const s = sessions.get(sessionId)
  if (!s || !s.pcm) return null
  sessions.delete(sessionId)
  return s.pcm
}
