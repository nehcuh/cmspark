/**
 * Mtg2: client-side audio file → 16k mono WAV segments for voice.stt.*
 * Not auto-diarize. System audio mix is still parking-lot (see SoT).
 */

import {
  LOCAL_STT_CHANNELS,
  LOCAL_STT_MAX_CHUNK_RAW_BYTES,
  LOCAL_STT_MAX_RECORD_MS,
  LOCAL_STT_SAMPLE_RATE,
} from "./local-stt-detect"
import {
  float32ToS16lePcm,
  resampleFloat32Mono,
  splitIntoChunks,
  wrapPcmS16leAsWav,
} from "./pcm-encode"

/** Soft cap: ~10 min @ 16k mono s16 (~19MB raw pcm) — we segment; reject huge files early. */
export const MEETING_AUDIO_IMPORT_MAX_FILE_BYTES = 25 * 1024 * 1024

/** Per-segment wall for Path B STT (matches classic max). */
export const MEETING_AUDIO_SEGMENT_MS = LOCAL_STT_MAX_RECORD_MS

export type AudioSegmentWav = {
  index: number
  wav: Uint8Array
  t0Sec: number
  t1Sec: number
}

/**
 * Decode browser File/Blob via Web Audio, resample mono 16k, slice into ≤45s WAV segments.
 */
export async function fileToWavSegments(
  file: Blob,
  opts: {
    maxFileBytes?: number
    segmentMs?: number
    /** Inject AudioContext for tests */
    audioContextFactory?: () => AudioContext
  } = {},
): Promise<
  | { ok: true; segments: AudioSegmentWav[]; durationSec: number }
  | { ok: false; code: string; message: string }
> {
  const maxBytes = opts.maxFileBytes ?? MEETING_AUDIO_IMPORT_MAX_FILE_BYTES
  if (typeof file.size === "number" && file.size > maxBytes) {
    return {
      ok: false,
      code: "too_large",
      message: `音频文件过大（>${Math.round(maxBytes / (1024 * 1024))}MB）`,
    }
  }
  if (file.size === 0) {
    return { ok: false, code: "empty", message: "空文件" }
  }

  let ab: ArrayBuffer
  try {
    ab = await file.arrayBuffer()
  } catch {
    return { ok: false, code: "read_failed", message: "无法读取文件" }
  }

  const Ctx =
    opts.audioContextFactory ||
    (() => {
      const AC =
        (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext
      if (typeof AC !== "function") {
        throw new Error("no_audio_context")
      }
      return new AC() as AudioContext
    })

  let ctx: AudioContext
  try {
    ctx = Ctx()
  } catch {
    return {
      ok: false,
      code: "no_audio_context",
      message: "当前环境无法解码音频（需要 Web Audio）",
    }
  }

  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(ab.slice(0))
  } catch {
    try {
      await ctx.close()
    } catch {
      /* */
    }
    return {
      ok: false,
      code: "decode_failed",
      message: "无法解码音频（请用常见格式：WAV / MP3 / M4A / OGG）",
    }
  }

  try {
    await ctx.close()
  } catch {
    /* */
  }

  const durationSec = decoded.duration
  if (!(durationSec > 0) || !Number.isFinite(durationSec)) {
    return { ok: false, code: "empty", message: "音频时长无效" }
  }
  // Hard cap 30 min wall (same absolute continuous cap family)
  if (durationSec > 30 * 60) {
    return {
      ok: false,
      code: "too_long",
      message: "音频超过 30 分钟上限，请先裁剪",
    }
  }

  // Mixdown to mono float
  const n = decoded.length
  const ch = decoded.numberOfChannels
  const mono = new Float32Array(n)
  for (let c = 0; c < ch; c++) {
    const data = decoded.getChannelData(c)
    for (let i = 0; i < n; i++) {
      mono[i] += data[i] / ch
    }
  }
  const resampled = resampleFloat32Mono(mono, decoded.sampleRate, LOCAL_STT_SAMPLE_RATE)
  const segmentMs = opts.segmentMs ?? MEETING_AUDIO_SEGMENT_MS
  const samplesPerSeg = Math.max(
    1,
    Math.floor((LOCAL_STT_SAMPLE_RATE * segmentMs) / 1000),
  )

  const segments: AudioSegmentWav[] = []
  let index = 0
  for (let off = 0; off < resampled.length; off += samplesPerSeg) {
    const end = Math.min(off + samplesPerSeg, resampled.length)
    const slice = resampled.subarray(off, end)
    if (slice.length < LOCAL_STT_SAMPLE_RATE * 0.2) {
      // drop trailing <200ms
      if (segments.length > 0) break
    }
    const pcm = float32ToS16lePcm(slice)
    const wav = wrapPcmS16leAsWav(pcm, LOCAL_STT_SAMPLE_RATE, LOCAL_STT_CHANNELS)
    const t0Sec = off / LOCAL_STT_SAMPLE_RATE
    const t1Sec = end / LOCAL_STT_SAMPLE_RATE
    segments.push({ index, wav, t0Sec, t1Sec })
    index += 1
  }

  if (segments.length === 0) {
    return { ok: false, code: "empty", message: "无有效音频段" }
  }

  return { ok: true, segments, durationSec }
}

/** uint8 → base64 (Side Panel safe). */
export function uint8ToBase64(data: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ""
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.subarray(i, Math.min(i + chunkSize, data.length))
    binary += String.fromCharCode.apply(null, Array.from(slice) as number[])
  }
  if (typeof btoa === "function") return btoa(binary)
  throw new Error("btoa unavailable")
}

export type SttSend = (msg: Record<string, unknown>) => void
export type SttOnMessage = (handler: (msg: any) => void) => () => void

/**
 * One-shot voice.stt.* for a prebuilt WAV (upload path). Serial max-1 sessions.
 */
export function transcribeWavViaStt(opts: {
  wav: Uint8Array
  sessionId: string
  modelId: string
  send: SttSend
  onMessage: SttOnMessage
  lang?: string
  maxMs?: number
  timeoutMs?: number
}): Promise<{ ok: true; text: string } | { ok: false; code: string }> {
  const {
    wav,
    sessionId,
    modelId,
    send,
    onMessage,
    lang = "zh",
    maxMs = MEETING_AUDIO_SEGMENT_MS,
    timeoutMs = 120_000,
  } = opts

  return new Promise((resolve) => {
    let settled = false
    const finish = (r: { ok: true; text: string } | { ok: false; code: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        unsub()
      } catch {
        /* */
      }
      resolve(r)
    }

    const unsub = onMessage((msg) => {
      if (!msg || typeof msg.type !== "string") return
      if (msg.sessionId !== sessionId) return
      if (msg.type === "voice.stt.result") {
        finish({ ok: true, text: typeof msg.text === "string" ? msg.text : "" })
        return
      }
      if (msg.type === "voice.stt.error") {
        finish({
          ok: false,
          code: typeof msg.code === "string" && msg.code ? msg.code : "stt_error",
        })
        return
      }
    })

    const timer = setTimeout(() => finish({ ok: false, code: "timeout" }), timeoutMs)

    try {
      send({
        type: "voice.stt.start",
        v: 1,
        sessionId,
        modelId,
        format: "wav",
        sampleRate: LOCAL_STT_SAMPLE_RATE,
        channels: LOCAL_STT_CHANNELS,
        lang: lang.startsWith("zh") ? "zh" : lang,
        maxMs,
      })
      const chunks = splitIntoChunks(wav, LOCAL_STT_MAX_CHUNK_RAW_BYTES)
      for (let seq = 0; seq < chunks.length; seq++) {
        send({
          type: "voice.stt.chunk",
          v: 1,
          sessionId,
          seq,
          data: uint8ToBase64(chunks[seq]!),
        })
      }
      send({
        type: "voice.stt.end",
        v: 1,
        sessionId,
        totalSeq: chunks.length,
      })
    } catch {
      finish({ ok: false, code: "send_failed" })
    }
  })
}
