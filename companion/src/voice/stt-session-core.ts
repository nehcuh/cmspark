// Path B — pure STT session reassembly (Spike S5). No spawn / no FS.

import {
  STT_MAX_CHUNK_BYTES,
  STT_MAX_RECORD_MS,
  STT_MAX_SESSION_BYTES,
  isSttModelId,
  type SttModelId,
} from "./session-caps"

export type SttSessionErrorCode =
  | "session_busy"
  | "invalid_model"
  | "invalid_format"
  | "seq_gap"
  | "seq_duplicate"
  | "payload_too_large"
  | "session_unknown"
  | "already_ended"
  | "aborted"
  | "total_seq_mismatch"

export type SttSessionPhase = "receiving" | "ended" | "aborted"

export interface SttSessionStart {
  sessionId: string
  modelId: string
  format: "pcm_s16le" | "wav"
  sampleRate: number
  channels: number
  maxMs?: number
}

export interface SttSessionState {
  sessionId: string
  modelId: SttModelId
  format: "pcm_s16le" | "wav"
  sampleRate: number
  channels: number
  maxMs: number
  phase: SttSessionPhase
  epoch: number
  /** seq → chunk raw bytes */
  chunks: Map<number, Buffer>
  receivedBytes: number
  startedAt: number
}

export type SttSessionResult =
  | { ok: true }
  | { ok: false; code: SttSessionErrorCode; message: string }

/** Process-global max-1 session holder (pure; inject now for tests). */
export class SttSessionCore {
  private active: SttSessionState | null = null
  private epochCounter = 0

  constructor(private readonly now: () => number = () => Date.now()) {}

  getActive(): SttSessionState | null {
    return this.active
  }

  start(req: SttSessionStart): SttSessionResult {
    if (this.active && this.active.phase === "receiving") {
      return { ok: false, code: "session_busy", message: "STT session already active" }
    }
    if (!isSttModelId(req.modelId)) {
      return { ok: false, code: "invalid_model", message: `unknown modelId: ${req.modelId}` }
    }
    if (req.format !== "pcm_s16le" && req.format !== "wav") {
      return { ok: false, code: "invalid_format", message: "format must be pcm_s16le|wav" }
    }
    if (req.sampleRate !== 16000 || req.channels !== 1) {
      return {
        ok: false,
        code: "invalid_format",
        message: "only 16kHz mono accepted in v1",
      }
    }
    this.epochCounter += 1
    this.active = {
      sessionId: req.sessionId,
      modelId: req.modelId,
      format: req.format,
      sampleRate: req.sampleRate,
      channels: req.channels,
      maxMs: req.maxMs ?? STT_MAX_RECORD_MS,
      phase: "receiving",
      epoch: this.epochCounter,
      chunks: new Map(),
      receivedBytes: 0,
      startedAt: this.now(),
    }
    return { ok: true }
  }

  appendChunk(sessionId: string, seq: number, data: Buffer): SttSessionResult {
    const s = this.active
    if (!s || s.sessionId !== sessionId) {
      return { ok: false, code: "session_unknown", message: "no matching session" }
    }
    if (s.phase === "aborted") {
      return { ok: false, code: "aborted", message: "session aborted" }
    }
    if (s.phase === "ended") {
      return { ok: false, code: "already_ended", message: "session already ended" }
    }
    if (!Number.isInteger(seq) || seq < 0) {
      return { ok: false, code: "seq_gap", message: "seq must be non-negative integer" }
    }
    if (data.length > STT_MAX_CHUNK_BYTES) {
      return { ok: false, code: "payload_too_large", message: "chunk exceeds max" }
    }
    if (s.chunks.has(seq)) {
      return { ok: false, code: "seq_duplicate", message: `duplicate seq ${seq}` }
    }
    // Contiguous from 0: next expected is size of map
    const expected = s.chunks.size
    if (seq !== expected) {
      return {
        ok: false,
        code: "seq_gap",
        message: `expected seq ${expected}, got ${seq}`,
      }
    }
    const nextBytes = s.receivedBytes + data.length
    if (nextBytes > STT_MAX_SESSION_BYTES) {
      return { ok: false, code: "payload_too_large", message: "session byte budget exceeded" }
    }
    s.chunks.set(seq, data)
    s.receivedBytes = nextBytes
    return { ok: true }
  }

  /**
   * M2 streaming: reassemble contiguous chunks without ending the session.
   * Returns null when not receiving / empty / gap.
   */
  snapshotAudio(sessionId: string): { ok: true; audio: Buffer; bytes: number; epoch: number } | SttSessionResult {
    const s = this.active
    if (!s || s.sessionId !== sessionId) {
      return { ok: false, code: "session_unknown", message: "no matching session" }
    }
    if (s.phase === "aborted") {
      return { ok: false, code: "aborted", message: "session aborted" }
    }
    if (s.phase === "ended") {
      return { ok: false, code: "already_ended", message: "session already ended" }
    }
    const n = s.chunks.size
    if (n === 0) {
      return { ok: true, audio: Buffer.alloc(0), bytes: 0, epoch: s.epoch }
    }
    const parts: Buffer[] = []
    for (let i = 0; i < n; i++) {
      const c = s.chunks.get(i)
      if (!c) {
        return { ok: false, code: "seq_gap", message: `missing seq ${i}` }
      }
      parts.push(c)
    }
    const audio = Buffer.concat(parts)
    return { ok: true, audio, bytes: audio.length, epoch: s.epoch }
  }

  end(sessionId: string, totalSeq: number): SttSessionResult & { audio?: Buffer; epoch?: number } {
    const s = this.active
    if (!s || s.sessionId !== sessionId) {
      return { ok: false, code: "session_unknown", message: "no matching session" }
    }
    if (s.phase === "aborted") {
      return { ok: false, code: "aborted", message: "session aborted" }
    }
    if (s.phase === "ended") {
      return { ok: false, code: "already_ended", message: "session already ended" }
    }
    if (totalSeq !== s.chunks.size) {
      return {
        ok: false,
        code: "total_seq_mismatch",
        message: `totalSeq ${totalSeq} != chunks ${s.chunks.size}`,
      }
    }
    const parts: Buffer[] = []
    for (let i = 0; i < totalSeq; i++) {
      const c = s.chunks.get(i)
      if (!c) {
        return { ok: false, code: "seq_gap", message: `missing seq ${i}` }
      }
      parts.push(c)
    }
    s.phase = "ended"
    const audio = Buffer.concat(parts)
    return { ok: true, audio, epoch: s.epoch }
  }

  abort(sessionId?: string): SttSessionResult {
    const s = this.active
    if (!s) {
      return { ok: false, code: "session_unknown", message: "no active session" }
    }
    if (sessionId !== undefined && s.sessionId !== sessionId) {
      return { ok: false, code: "session_unknown", message: "session id mismatch" }
    }
    s.phase = "aborted"
    this.epochCounter += 1
    s.epoch = this.epochCounter
    s.chunks.clear()
    s.receivedBytes = 0
    this.active = null
    return { ok: true }
  }

  /** Drop ended session so next start can run. */
  clearIfEnded(): void {
    if (this.active && this.active.phase === "ended") {
      this.active = null
    }
  }
}
