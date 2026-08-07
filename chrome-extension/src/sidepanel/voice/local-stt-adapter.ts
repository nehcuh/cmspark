/**
 * Path B — local STT adapter (gUM → WAV chunks → voice.stt.* WS).
 * classic: one shot ≤45s then onEnd.
 * continuous (D1c): serial segments ≤45s until hard cap or user stop; no fake interim.
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
import type {
  SpeechAdapter,
  SpeechAdapterHandlers,
  SpeechAdapterStartArg,
} from "./web-speech-adapter"
import {
  VOICE_CONTINUOUS_HARD_CAP_MS,
  VOICE_DEFAULT_LANG,
  type VoiceDictationMode,
} from "./detect"

export type LocalSttSend = (msg: Record<string, unknown>) => void

/** Subscribe to inbound companion messages; returns unsubscribe. */
export type LocalSttOnMessage = (handler: (msg: any) => void) => () => void

export type LocalSttAdapterDeps = {
  send: LocalSttSend
  onMessage: LocalSttOnMessage
  modelId: string
  startCapture?: (opts?: StartCaptureOpts) => Promise<CaptureHandle>
}

/** uint8 → base64 without Node Buffer (Side Panel / tests). */
export function uint8ToBase64(data: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ""
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.subarray(i, Math.min(i + chunkSize, data.length))
    binary += String.fromCharCode.apply(null, Array.from(slice) as number[])
  }
  if (typeof btoa === "function") {
    return btoa(binary)
  }
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

type PendingWait = {
  sessionId: string
  resolve: (r: { ok: true; text: string } | { ok: false; code: string }) => void
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
  let wantListening = false
  let mode: VoiceDictationMode = "classic"
  let parentSessionId = ""
  let lang = VOICE_DEFAULT_LANG
  let hardCapMs = VOICE_CONTINUOUS_HARD_CAP_MS
  let wallStart = 0
  let segmentIndex = 0
  let pending: PendingWait | null = null
  let loopGen = 0
  /** Continuous: resolve when current segment should stop recording. */
  let segmentStopTrigger: (() => void) | null = null
  let segmentTimer: ReturnType<typeof setTimeout> | null = null
  const beginCapture = deps.startCapture ?? defaultStartCapture

  const clearSegmentTimer = () => {
    if (segmentTimer) {
      clearTimeout(segmentTimer)
      segmentTimer = null
    }
  }

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
    clearSegmentTimer()
    segmentStopTrigger = null
    clearSub()
    capture = null
    sessionId = null
    phase = "idle"
    aborted = false
    wantListening = false
    mode = "classic"
    parentSessionId = ""
    segmentIndex = 0
    pending = null
  }

  const finishPending = (r: { ok: true; text: string } | { ok: false; code: string }) => {
    const p = pending
    pending = null
    p?.resolve(r)
  }

  const onWs = (msg: any) => {
    if (dead || !msg || typeof msg.type !== "string") return
    const sid = typeof msg.sessionId === "string" ? msg.sessionId : ""
    if (!sessionId || sid !== sessionId) return

    if (msg.type === "voice.stt.partial") return

    if (msg.type === "voice.stt.result") {
      const text = typeof msg.text === "string" ? msg.text : ""
      if (pending && pending.sessionId === sid) {
        finishPending({ ok: true, text })
        return
      }
      if (aborted) {
        handlers.onEnd()
        reset()
        return
      }
      if (text.trim()) {
        handlers.onResult({ interim: "", finalChunk: text })
      }
      handlers.onEnd()
      reset()
      return
    }

    if (msg.type === "voice.stt.error") {
      const code = typeof msg.code === "string" && msg.code ? msg.code : "unknown"
      if (pending && pending.sessionId === sid) {
        finishPending({
          ok: false,
          code: code === "aborted" || aborted ? "aborted" : code,
        })
        return
      }
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

  const uploadAndWait = (
    sid: string,
    wav: Uint8Array,
  ): Promise<{ ok: true; text: string } | { ok: false; code: string }> => {
    return new Promise((resolve) => {
      if (!sid || dead) {
        resolve({ ok: false, code: "aborted" })
        return
      }
      phase = "uploading"
      handlers.onCaptureStopped?.()

      if (wav.length === 0) {
        resolve({ ok: false, code: "empty_result" })
        return
      }

      pending = { sessionId: sid, resolve }
      sessionId = sid

      const chunks = splitIntoChunks(wav, LOCAL_STT_MAX_CHUNK_RAW_BYTES)
      for (let seq = 0; seq < chunks.length; seq++) {
        if (dead || aborted || sessionId !== sid) {
          finishPending({ ok: false, code: "aborted" })
          return
        }
        deps.send({
          type: "voice.stt.chunk",
          v: 1,
          sessionId: sid,
          seq,
          data: uint8ToBase64(chunks[seq]!),
        })
      }

      if (dead || aborted || sessionId !== sid) {
        finishPending({ ok: false, code: "aborted" })
        return
      }
      phase = "waiting"
      deps.send({
        type: "voice.stt.end",
        v: 1,
        sessionId: sid,
        totalSeq: chunks.length,
      })
    })
  }

  const sendStart = (sid: string, maxMs: number) => {
    deps.send({
      type: "voice.stt.start",
      v: 1,
      sessionId: sid,
      modelId,
      format: "wav",
      sampleRate: LOCAL_STT_SAMPLE_RATE,
      channels: LOCAL_STT_CHANNELS,
      lang: lang.startsWith("zh") ? "zh" : lang,
      maxMs,
    })
  }

  /**
   * Record one segment: wait segmentMs or user stop(), then return WAV.
   */
  const recordSegment = async (segmentMs: number): Promise<Uint8Array | null> => {
    const handle = await beginCapture({ maxMs: segmentMs })
    if (dead || aborted || !wantListening) {
      try {
        handle.abort()
      } catch {
        /* */
      }
      return null
    }
    capture = handle

    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearSegmentTimer()
        segmentStopTrigger = null
        resolve()
      }
      segmentStopTrigger = done
      segmentTimer = setTimeout(done, segmentMs)
    })

    capture = null
    if (dead || aborted) {
      try {
        handle.abort()
      } catch {
        /* */
      }
      return null
    }
    try {
      return await handle.stop()
    } catch (e: any) {
      if (e?.code === "aborted" || aborted) return null
      throw e
    }
  }

  const runClassic = async (sid: string) => {
    try {
      const handle = await beginCapture({ maxMs: LOCAL_STT_MAX_RECORD_MS })
      if (dead || aborted || sessionId !== sid) {
        handle.abort()
        return
      }
      capture = handle
      sendStart(sid, LOCAL_STT_MAX_RECORD_MS)
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
            : "audio-capture"
      handlers.onError(code)
      handlers.onEnd()
      reset()
    }
  }

  const runContinuous = async (gen: number) => {
    try {
      handlers.onStart()
      while (!dead && wantListening && gen === loopGen) {
        const remaining = hardCapMs - (Date.now() - wallStart)
        if (remaining < 800) break

        const segmentMs = Math.min(LOCAL_STT_MAX_RECORD_MS, remaining)
        segmentIndex += 1
        const segSid = `${parentSessionId}-s${segmentIndex}`
        sessionId = segSid
        phase = "recording"

        sendStart(segSid, segmentMs)

        let wav: Uint8Array | null
        try {
          wav = await recordSegment(segmentMs)
        } catch (e: any) {
          if (dead || gen !== loopGen) return
          handlers.onError(e?.code === "aborted" ? "aborted" : "audio-capture")
          handlers.onEnd()
          reset()
          return
        }

        if (dead || gen !== loopGen) return
        if (aborted || wav == null) {
          // User abort or cancelled before audio
          if (aborted) {
            handlers.onError("aborted")
          }
          handlers.onEnd()
          reset()
          return
        }

        const result = await uploadAndWait(segSid, wav)
        if (dead || gen !== loopGen) return

        if (!result.ok) {
          if (result.code === "aborted" || aborted) {
            handlers.onError("aborted")
          } else {
            handlers.onError(result.code)
          }
          handlers.onEnd()
          reset()
          return
        }

        if (result.text.trim()) {
          handlers.onResult({ interim: "", finalChunk: result.text })
        }

        if (!wantListening || aborted) break

        // Resume listening chrome between segments
        handlers.onSegmentContinue?.()
      }

      if (!dead) handlers.onEnd()
      reset()
    } catch {
      if (!dead) {
        handlers.onError("unknown")
        handlers.onEnd()
      }
      reset()
    }
  }

  return {
    start(langOrOpts?: SpeechAdapterStartArg) {
      if (dead) return
      if (phase !== "idle") return

      aborted = false
      wantListening = true
      lang = VOICE_DEFAULT_LANG
      let sid = ""
      let mid = deps.modelId
      mode = "classic"
      hardCapMs = VOICE_CONTINUOUS_HARD_CAP_MS

      if (typeof langOrOpts === "string") {
        lang = langOrOpts || VOICE_DEFAULT_LANG
      } else if (langOrOpts && typeof langOrOpts === "object") {
        if (langOrOpts.lang) lang = langOrOpts.lang
        if (langOrOpts.sessionId) sid = langOrOpts.sessionId
        if (langOrOpts.modelId) mid = langOrOpts.modelId
        if (langOrOpts.mode === "continuous") mode = "continuous"
        if (typeof (langOrOpts as { hardCapMs?: number }).hardCapMs === "number") {
          hardCapMs = (langOrOpts as { hardCapMs: number }).hardCapMs
        }
      }

      if (!sid) {
        handlers.onError("session_busy")
        handlers.onEnd()
        return
      }

      parentSessionId = sid
      sessionId = sid
      modelId = mid || deps.modelId
      ensureSub()
      phase = "recording"
      wallStart = Date.now()
      segmentIndex = 0
      loopGen += 1
      const gen = loopGen

      if (mode === "continuous") {
        void runContinuous(gen)
      } else {
        void runClassic(sid)
      }
    },

    stop() {
      if (dead) return
      if (phase === "idle") return

      wantListening = false

      // Continuous: finish current segment early, then exit after upload
      if (mode === "continuous") {
        if (phase === "recording") {
          segmentStopTrigger?.()
        }
        // uploading/waiting: let segment complete, loop exits
        return
      }

      // classic
      if (phase === "uploading" || phase === "waiting") {
        return
      }

      const handle = capture
      capture = null
      if (!handle) {
        aborted = true
        handlers.onError("aborted")
        handlers.onEnd()
        reset()
        return
      }

      void handle
        .stop()
        .then(async (wav) => {
          const sid = sessionId
          if (!sid) return
          const result = await uploadAndWait(sid, wav)
          if (dead) return
          if (!result.ok) {
            handlers.onError(result.code === "aborted" ? "aborted" : result.code)
          } else if (result.text.trim()) {
            handlers.onResult({ interim: "", finalChunk: result.text })
          }
          handlers.onEnd()
          reset()
        })
        .catch((e: any) => {
          if (aborted || dead) return
          handlers.onError(e?.code === "aborted" ? "aborted" : "audio-capture")
          handlers.onEnd()
          reset()
        })
    },

    abort() {
      if (dead) return
      aborted = true
      wantListening = false
      loopGen += 1
      clearSegmentTimer()
      segmentStopTrigger?.()
      segmentStopTrigger = null
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
      finishPending({ ok: false, code: "aborted" })
      handlers.onError("aborted")
      handlers.onEnd()
      reset()
    },

    destroy() {
      dead = true
      aborted = true
      wantListening = false
      loopGen += 1
      clearSegmentTimer()
      segmentStopTrigger = null
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
      finishPending({ ok: false, code: "aborted" })
      reset()
    },
  }
}
