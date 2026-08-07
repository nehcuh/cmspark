/**
 * Path B M1 — local STT adapter (gUM → WAV chunks → voice.stt.* WS).
 * Same surface as SpeechAdapter; deps inject send/subscribe (no circular imports).
 */

import {
  LOCAL_STT_CHANNELS,
  LOCAL_STT_MAX_CHUNK_RAW_BYTES,
  LOCAL_STT_MAX_RECORD_MS,
  LOCAL_STT_SAMPLE_RATE,
} from "./local-stt-detect"
import { splitIntoChunks } from "./pcm-encode"
import {
  startCapture as defaultStartCapture,
  type CaptureHandle,
  type StartCaptureOpts,
} from "./audio-capture"
import type { SpeechAdapter, SpeechAdapterHandlers } from "./web-speech-adapter"
import { VOICE_DEFAULT_LANG } from "./detect"

export type LocalSttSend = (msg: Record<string, unknown>) => void

/** Subscribe to inbound companion messages; returns unsubscribe. */
export type LocalSttOnMessage = (handler: (msg: any) => void) => () => void

export type LocalSttAdapterDeps = {
  send: LocalSttSend
  onMessage: LocalSttOnMessage
  /** Default model when start() omits modelId. */
  modelId: string
  /**
   * Capture factory (default: real gUM MediaRecorder).
   * Unit tests inject a fake that returns fixed WAV bytes.
   */
  startCapture?: (opts?: StartCaptureOpts) => Promise<CaptureHandle>
}

export type LocalSttStartOpts = {
  lang?: string
  sessionId: string
  modelId?: string
}

/** uint8 → base64 without Node Buffer (Side Panel / tests). */
export function uint8ToBase64(data: Uint8Array): string {
  // Chunk to avoid call-stack / argument limits on large audio.
  // Pure browser-safe path only (no Node Buffer — extension tsc has no @types/node).
  const chunkSize = 0x8000
  let binary = ""
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.subarray(i, Math.min(i + chunkSize, data.length))
    binary += String.fromCharCode.apply(null, Array.from(slice) as number[])
  }
  if (typeof btoa === "function") {
    return btoa(binary)
  }
  // Node test / non-DOM: manual base64
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let out = ""
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i]
    const b = i + 1 < data.length ? data[i + 1] : 0
    const c = i + 2 < data.length ? data[i + 2] : 0
    const triple = (a << 16) | (b << 8) | c
    out += alphabet[(triple >> 18) & 63]
    out += alphabet[(triple >> 12) & 63]
    out += i + 1 < data.length ? alphabet[(triple >> 6) & 63] : "="
    out += i + 2 < data.length ? alphabet[triple & 63] : "="
  }
  return out
}

export function createLocalSttAdapter(
  handlers: SpeechAdapterHandlers,
  deps: LocalSttAdapterDeps,
): SpeechAdapter {
  let dead = false
  let capture: CaptureHandle | null = null
  let sessionId: string | null = null
  let modelId = deps.modelId
  let unsub: (() => void) | null = null
  let phase: "idle" | "recording" | "uploading" | "waiting" = "idle"
  let aborted = false
  const beginCapture = deps.startCapture ?? defaultStartCapture

  const clearSub = () => {
    if (unsub) {
      try {
        unsub()
      } catch {
        /* */
      }
      unsub = null
    }
  }

  const reset = () => {
    clearSub()
    capture = null
    sessionId = null
    phase = "idle"
    aborted = false
  }

  const onWs = (msg: any) => {
    if (dead || !msg || typeof msg.type !== "string") return
    const sid = typeof msg.sessionId === "string" ? msg.sessionId : ""
    if (!sessionId || sid !== sessionId) return

    if (msg.type === "voice.stt.partial") {
      // Status only; no interim transcript in M1.
      return
    }

    if (msg.type === "voice.stt.result") {
      if (aborted) {
        handlers.onEnd()
        reset()
        return
      }
      const text = typeof msg.text === "string" ? msg.text : ""
      if (text.trim()) {
        handlers.onResult({ interim: "", finalChunk: text })
      }
      handlers.onEnd()
      reset()
      return
    }

    if (msg.type === "voice.stt.error") {
      const code = typeof msg.code === "string" && msg.code ? msg.code : "unknown"
      if (code === "aborted" || aborted) {
        handlers.onError("aborted")
        handlers.onEnd()
        reset()
        return
      }
      handlers.onError(code)
      handlers.onEnd()
      reset()
    }
  }

  const ensureSub = () => {
    if (unsub) return
    unsub = deps.onMessage(onWs)
  }

  const uploadAndEnd = async (wav: Uint8Array) => {
    const sid = sessionId
    if (!sid || dead || aborted) return

    phase = "uploading"
    handlers.onCaptureStopped?.()

    if (wav.length === 0) {
      handlers.onError("empty_result")
      handlers.onEnd()
      reset()
      return
    }

    const chunks = splitIntoChunks(wav, LOCAL_STT_MAX_CHUNK_RAW_BYTES)
    for (let seq = 0; seq < chunks.length; seq++) {
      if (dead || aborted || sessionId !== sid) return
      const data = uint8ToBase64(chunks[seq]!)
      deps.send({
        type: "voice.stt.chunk",
        v: 1,
        sessionId: sid,
        seq,
        data,
      })
    }

    if (dead || aborted || sessionId !== sid) return
    phase = "waiting"
    deps.send({
      type: "voice.stt.end",
      v: 1,
      sessionId: sid,
      totalSeq: chunks.length,
    })
    // Result / error arrives via onMessage
  }

  return {
    start(langOrOpts?: string | LocalSttStartOpts) {
      if (dead) return
      if (phase !== "idle") return

      aborted = false
      let lang = VOICE_DEFAULT_LANG
      let sid = ""
      let mid = deps.modelId

      if (typeof langOrOpts === "string") {
        lang = langOrOpts || VOICE_DEFAULT_LANG
      } else if (langOrOpts && typeof langOrOpts === "object") {
        if (langOrOpts.lang) lang = langOrOpts.lang
        if (langOrOpts.sessionId) sid = langOrOpts.sessionId
        if (langOrOpts.modelId) mid = langOrOpts.modelId
      }

      if (!sid) {
        handlers.onError("session_busy")
        handlers.onEnd()
        return
      }

      sessionId = sid
      modelId = mid || deps.modelId
      ensureSub()
      phase = "recording"

      // Fire start async so callers stay sync-compatible with Web Speech.
      void (async () => {
        try {
          const handle = await beginCapture({ maxMs: LOCAL_STT_MAX_RECORD_MS })
          if (dead || aborted || sessionId !== sid) {
            handle.abort()
            return
          }
          capture = handle

          deps.send({
            type: "voice.stt.start",
            v: 1,
            sessionId: sid,
            modelId,
            format: "wav",
            sampleRate: LOCAL_STT_SAMPLE_RATE,
            channels: LOCAL_STT_CHANNELS,
            lang: lang.startsWith("zh") ? "zh" : lang,
            maxMs: LOCAL_STT_MAX_RECORD_MS,
          })

          if (dead || aborted) {
            handle.abort()
            return
          }
          handlers.onStart()
        } catch (e: any) {
          if (dead || aborted) return
          const code =
            e?.code === "aborted"
              ? "aborted"
              : e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError"
                ? "not-allowed"
                : e?.code === "audio-capture" || e?.name === "NotFoundError"
                  ? "audio-capture"
                  : "audio-capture"
          handlers.onError(code)
          handlers.onEnd()
          reset()
        }
      })()
    },

    stop() {
      if (dead) return
      if (phase === "idle") return

      // Mid-upload / waiting: treat as graceful wait (do not abort server).
      if (phase === "uploading" || phase === "waiting") {
        return
      }

      const handle = capture
      capture = null
      if (!handle) {
        // Still starting gUM — mark aborted-ish
        aborted = true
        handlers.onError("aborted")
        handlers.onEnd()
        reset()
        return
      }

      void handle
        .stop()
        .then((wav) => uploadAndEnd(wav))
        .catch((e: any) => {
          if (aborted || dead) return
          const code = e?.code === "aborted" ? "aborted" : "audio-capture"
          handlers.onError(code)
          handlers.onEnd()
          reset()
        })
    },

    abort() {
      if (dead) return
      aborted = true
      const sid = sessionId
      const handle = capture
      capture = null
      try {
        handle?.abort()
      } catch {
        /* */
      }
      if (sid) {
        try {
          deps.send({ type: "voice.stt.abort", v: 1, sessionId: sid })
        } catch {
          /* */
        }
      }
      // Server may reply voice.stt.error aborted; also end locally so SM recovers.
      handlers.onError("aborted")
      handlers.onEnd()
      reset()
    },

    destroy() {
      dead = true
      aborted = true
      const sid = sessionId
      const handle = capture
      capture = null
      try {
        handle?.abort()
      } catch {
        /* */
      }
      if (sid) {
        try {
          deps.send({ type: "voice.stt.abort", v: 1, sessionId: sid })
        } catch {
          /* */
        }
      }
      reset()
    },
  }
}
