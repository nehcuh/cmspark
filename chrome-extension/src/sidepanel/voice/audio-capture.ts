/**
 * Path B M1 — Side Panel mic capture → 16 kHz mono WAV (Uint8Array).
 * MediaRecorder → decodeAudioData → encodeMonoFloatToWav16k.
 * No DOM beyond Web Audio / gUM; abort/stop always release tracks.
 */

import { LOCAL_STT_MAX_RECORD_MS } from "./local-stt-detect"
import { encodeMonoFloatToWav16k } from "./pcm-encode"

export type StartCaptureOpts = {
  /** Hard cap; default LOCAL_STT_MAX_RECORD_MS (45s). */
  maxMs?: number
  /** Optional 0–1 RMS level callback (best-effort). */
  onLevel?: (level: number) => void
}

export type CaptureHandle = {
  /** Stop recording and resolve WAV bytes (16 kHz mono s16le). */
  stop: () => Promise<Uint8Array>
  /** Abort without producing audio; releases tracks. */
  abort: () => void
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ]
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported?.(m)) return m
    } catch {
      /* continue */
    }
  }
  return undefined
}

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return
  for (const t of stream.getTracks()) {
    try {
      t.stop()
    } catch {
      /* */
    }
  }
}

/**
 * Start mic capture. Caller must stop() or abort() to release the mic.
 * Prefer getUserMedia + MediaRecorder → decode → 16 kHz WAV.
 */
export async function startCapture(opts: StartCaptureOpts = {}): Promise<CaptureHandle> {
  const maxMs = opts.maxMs ?? LOCAL_STT_MAX_RECORD_MS
  const onLevel = opts.onLevel

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("getUserMedia unavailable"), { code: "audio-capture" })
  }
  if (typeof MediaRecorder === "undefined") {
    throw Object.assign(new Error("MediaRecorder unavailable"), { code: "audio-capture" })
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  })

  const mimeType = pickRecorderMime()
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream)

  const chunks: BlobPart[] = []
  let settled = false
  let levelCtx: AudioContext | null = null
  let levelRaf = 0
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  let stopResolve: ((wav: Uint8Array) => void) | null = null
  let stopReject: ((err: unknown) => void) | null = null
  let stopPromise: Promise<Uint8Array> | null = null

  recorder.ondataavailable = (ev: BlobEvent) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data)
  }

  const cleanupLevel = () => {
    if (levelRaf) {
      cancelAnimationFrame(levelRaf)
      levelRaf = 0
    }
    if (levelCtx) {
      try {
        void levelCtx.close()
      } catch {
        /* */
      }
      levelCtx = null
    }
  }

  const release = () => {
    if (maxTimer) {
      clearTimeout(maxTimer)
      maxTimer = null
    }
    cleanupLevel()
    stopTracks(stream)
  }

  // Optional RMS level via AnalyserNode
  if (onLevel && typeof AudioContext !== "undefined") {
    try {
      levelCtx = new AudioContext()
      const src = levelCtx.createMediaStreamSource(stream)
      const analyser = levelCtx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        if (settled || !levelCtx) return
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i]! - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / buf.length)
        onLevel(Math.min(1, rms * 2))
        levelRaf = requestAnimationFrame(tick)
      }
      levelRaf = requestAnimationFrame(tick)
    } catch {
      levelCtx = null
    }
  }

  const finalizeToWav = async (): Promise<Uint8Array> => {
    const blob = new Blob(chunks, {
      type: recorder.mimeType || mimeType || "audio/webm",
    })
    if (blob.size === 0) {
      return new Uint8Array(0)
    }
    if (typeof AudioContext === "undefined") {
      throw Object.assign(new Error("AudioContext unavailable"), { code: "audio-capture" })
    }
    const ctx = new AudioContext()
    try {
      const ab = await blob.arrayBuffer()
      const audioBuf = await ctx.decodeAudioData(ab.slice(0))
      const ch0 = audioBuf.getChannelData(0)
      // If multi-channel, mix to mono average
      let mono: Float32Array
      if (audioBuf.numberOfChannels <= 1) {
        mono = new Float32Array(ch0)
      } else {
        mono = new Float32Array(audioBuf.length)
        const n = audioBuf.numberOfChannels
        for (let c = 0; c < n; c++) {
          const data = audioBuf.getChannelData(c)
          for (let i = 0; i < mono.length; i++) {
            mono[i]! += data[i]! / n
          }
        }
      }
      return encodeMonoFloatToWav16k(mono, audioBuf.sampleRate)
    } finally {
      try {
        await ctx.close()
      } catch {
        /* */
      }
    }
  }

  recorder.onstop = () => {
    if (settled) return
    settled = true
    release()
    void finalizeToWav()
      .then((wav) => {
        stopResolve?.(wav)
      })
      .catch((err) => {
        stopReject?.(err)
      })
  }

  recorder.onerror = () => {
    if (settled) return
    settled = true
    release()
    stopReject?.(
      Object.assign(new Error("MediaRecorder error"), { code: "audio-capture" }),
    )
  }

  try {
    recorder.start(250)
  } catch (e) {
    settled = true
    release()
    throw e
  }

  // Auto-stop at maxMs so caller still gets WAV (local adapter then uploads).
  maxTimer = setTimeout(() => {
    maxTimer = null
    if (settled) return
    if (recorder.state === "recording" || recorder.state === "paused") {
      try {
        recorder.stop()
      } catch {
        /* */
      }
    }
  }, maxMs)

  const handle: CaptureHandle = {
    stop() {
      if (stopPromise) return stopPromise
      stopPromise = new Promise<Uint8Array>((resolve, reject) => {
        stopResolve = resolve
        stopReject = reject
        if (settled) {
          // Already finished (e.g. maxMs) — wait for onstop path via stored promise
          // If already resolved via onstop before stop() was called, re-finalize from chunks.
          void finalizeToWav().then(resolve).catch(reject)
          return
        }
        if (recorder.state === "inactive") {
          settled = true
          release()
          void finalizeToWav().then(resolve).catch(reject)
          return
        }
        try {
          recorder.stop()
        } catch (e) {
          settled = true
          release()
          reject(e)
        }
      })
      return stopPromise
    },
    abort() {
      if (settled) {
        release()
        return
      }
      settled = true
      stopReject?.(Object.assign(new Error("aborted"), { code: "aborted" }))
      stopResolve = null
      stopReject = null
      try {
        if (recorder.state === "recording" || recorder.state === "paused") {
          recorder.stop()
        }
      } catch {
        /* */
      }
      release()
      chunks.length = 0
    },
  }

  return handle
}
