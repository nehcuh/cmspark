/**
 * Path B — local STT adapter (gUM → WAV/PCM chunks → voice.stt.* WS).
 * classic: one shot ≤45s then onEnd.
 * continuous (D1c): serial segments ≤45s until hard cap or user stop.
 * continuous + streamPartial (M2): PCM stream + partial_request progressive hypothesis.
 */

import {
  LOCAL_STT_CHANNELS,
  LOCAL_STT_MAX_CHUNK_RAW_BYTES,
  LOCAL_STT_MAX_RECORD_MS,
  LOCAL_STT_NEAR_REALTIME_SEGMENT_MS,
  LOCAL_STT_SAMPLE_RATE,
} from "./local-stt-detect"
import { splitIntoChunks } from "./pcm-encode"
import {
  startCapture as defaultStartCapture,
  type CaptureHandle,
  type StartCaptureOpts,
} from "./audio-capture"
import { startPcmStreamCapture, type PcmStreamHandle } from "./pcm-stream-capture"
import {
  nextPartialPollMs,
  STREAM_PARTIAL_POLL_DEFAULT_MS,
} from "./stream-partial-poll"
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
  /** Optional per-segment window override (tests); clamped to LOCAL_STT_MAX_RECORD_MS. */
  let segmentCapMs = LOCAL_STT_MAX_RECORD_MS
  let streamPartial = false
  let wallStart = 0
  let segmentIndex = 0
  let pending: PendingWait | null = null
  let loopGen = 0
  /** Continuous: resolve when current segment should stop recording. */
  let segmentStopTrigger: (() => void) | null = null
  let segmentTimer: ReturnType<typeof setTimeout> | null = null
  let partialTimer: ReturnType<typeof setTimeout> | null = null
  let pcmStream: PcmStreamHandle | null = null
  let streamSeq = 0
  let streamStable = ""
  let streamPrevHypothesis = ""
  /** Adaptive partial poll (ms); paced by last hypothesis infer time. */
  let partialPollMs = STREAM_PARTIAL_POLL_DEFAULT_MS
  /**
   * N3: soft stop requested while awaiting gUM / before window wait is armed.
   * Checked after each await so we never run a full unintended window.
   */
  let pendingSoftStop = false
  const beginCapture = deps.startCapture ?? defaultStartCapture

  const clearSegmentTimer = () => {
    if (segmentTimer) {
      clearTimeout(segmentTimer)
      segmentTimer = null
    }
  }

  const clearPartialTimer = () => {
    if (partialTimer) {
      clearTimeout(partialTimer)
      partialTimer = null
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
    clearPartialTimer()
    segmentStopTrigger = null
    if (pcmStream) {
      try {
        pcmStream.abort()
      } catch {
        /* */
      }
      pcmStream = null
    }
    clearSub()
    capture = null
    sessionId = null
    phase = "idle"
    aborted = false
    wantListening = false
    mode = "classic"
    streamPartial = false
    parentSessionId = ""
    segmentIndex = 0
    pending = null
    streamSeq = 0
    streamStable = ""
    streamPrevHypothesis = ""
    partialPollMs = STREAM_PARTIAL_POLL_DEFAULT_MS
    pendingSoftStop = false
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

    if (msg.type === "voice.stt.partial") {
      // M2 hypothesis text (status === "hypothesis"); ignore status-only partials
      // N4: drop late partials after window end / while waiting for final
      if (phase !== "recording") return
      if (msg.status === "hypothesis" && typeof msg.text === "string") {
        const hyp = msg.text.trim()
        if (!hyp) return
        // Pace next poll from companion infer wall time (medium models often >1.4s)
        if (typeof msg.ms === "number" && Number.isFinite(msg.ms) && msg.ms > 0) {
          partialPollMs = nextPartialPollMs(msg.ms)
        }
        // F3: interim-only within a window — never commit finalChunk mid-window.
        streamPrevHypothesis = hyp
        const display = hyp.startsWith(streamStable) ? hyp.slice(streamStable.length) : hyp
        handlers.onResult({
          interim: display,
          finalChunk: "",
        })
      }
      return
    }

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
      // P1: server-enforced privacy ack (chrome.storage alone is not enough)
      privacy_ack_v2: true,
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

  /**
   * M2 streaming continuous: PCM chunks live + partial_request → interim hypothesis;
   * window end → single final commit (F3: no mid-window finalChunk).
   * Window length honors segmentCapMs (F1), default ~8s when realtime.
   */
  const runStreamingContinuous = async (gen: number) => {
    try {
      handlers.onStart()
      while (!dead && wantListening && gen === loopGen) {
        const remaining = hardCapMs - (Date.now() - wallStart)
        if (remaining < 200) break

        // F1: honor near-realtime segmentCapMs (not always 45s)
        const windowMs = Math.min(segmentCapMs, LOCAL_STT_MAX_RECORD_MS, remaining)
        segmentIndex += 1
        const segSid = `${parentSessionId}-s${segmentIndex}`
        sessionId = segSid
        phase = "recording"
        streamSeq = 0
        streamStable = ""
        streamPrevHypothesis = ""
        partialPollMs = STREAM_PARTIAL_POLL_DEFAULT_MS
        let sessionStarted = false

        // N3: soft-stop may arrive while we await gUM — honor after resolve
        if (pendingSoftStop || !wantListening) {
          pendingSoftStop = false
          if (!dead) {
            handlers.onEnd()
            reset()
          }
          return
        }

        // F7: open mic first, then voice.stt.start (avoid idle abort during gUM)
        try {
          pcmStream = await startPcmStreamCapture({
            maxMs: windowMs,
            onPcmChunk: (pcm) => {
              if (dead || aborted || gen !== loopGen || sessionId !== segSid) return
              if (!sessionStarted || pcm.length === 0) return
              const chunks = splitIntoChunks(pcm, LOCAL_STT_MAX_CHUNK_RAW_BYTES)
              for (const c of chunks) {
                deps.send({
                  type: "voice.stt.chunk",
                  v: 1,
                  sessionId: segSid,
                  seq: streamSeq,
                  data: uint8ToBase64(c),
                })
                streamSeq += 1
              }
            },
          })
        } catch (e: any) {
          if (dead || gen !== loopGen) return
          handlers.onError(e?.code === "aborted" ? "aborted" : "audio-capture")
          handlers.onEnd()
          reset()
          return
        }

        // N3: soft stop during gUM — release mic, clean end (no full window)
        if (dead || gen !== loopGen) {
          try {
            pcmStream?.abort()
          } catch {
            /* */
          }
          pcmStream = null
          return
        }
        if (aborted || pendingSoftStop || !wantListening) {
          try {
            pcmStream?.abort()
          } catch {
            /* */
          }
          pcmStream = null
          pendingSoftStop = false
          if (aborted) {
            handlers.onError("aborted")
          }
          if (!dead) {
            handlers.onEnd()
            reset()
          }
          return
        }

        deps.send({
          type: "voice.stt.start",
          v: 1,
          sessionId: segSid,
          modelId,
          format: "pcm_s16le",
          sampleRate: LOCAL_STT_SAMPLE_RATE,
          channels: LOCAL_STT_CHANNELS,
          lang: lang.startsWith("zh") ? "zh" : lang,
          maxMs: windowMs,
          // P1: same wire gate as classic WAV start — continuous/hold path must not omit
          privacy_ack_v2: true,
        })
        sessionStarted = true

        // Adaptive partial poll: setTimeout chain paced by last hypothesis `ms`
        clearPartialTimer()
        const schedulePartialPoll = () => {
          clearPartialTimer()
          if (dead || aborted || gen !== loopGen || sessionId !== segSid) return
          if (phase !== "recording") return
          partialTimer = setTimeout(() => {
            partialTimer = null
            if (dead || aborted || gen !== loopGen || sessionId !== segSid) return
            if (phase !== "recording") return
            deps.send({
              type: "voice.stt.partial_request",
              v: 1,
              sessionId: segSid,
            })
            // Reschedule with current pace (updated when hypothesis with ms arrives)
            schedulePartialPoll()
          }, partialPollMs)
        }
        schedulePartialPoll()

        // Wait until window ends, user stop, or hard cap
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
          // Soft-stop already requested before wait armed → end immediately
          if (pendingSoftStop || !wantListening) {
            pendingSoftStop = false
            done()
            return
          }
          segmentTimer = setTimeout(done, windowMs)
        })

        clearPartialTimer()
        const handle = pcmStream
        pcmStream = null
        if (handle) {
          try {
            await handle.stop()
          } catch {
            /* */
          }
        }

        if (dead || gen !== loopGen) return
        if (aborted) {
          deps.send({ type: "voice.stt.abort", v: 1, sessionId: segSid })
          handlers.onError("aborted")
          handlers.onEnd()
          reset()
          return
        }

        // Final decode for this window — single commit (F3)
        phase = "waiting"
        handlers.onCaptureStopped?.()
        if (streamSeq === 0) {
          // No audio captured this window
          if (!wantListening) break
          handlers.onSegmentContinue?.()
          continue
        }
        const result = await new Promise<{ ok: true; text: string } | { ok: false; code: string }>(
          (resolve) => {
            pending = { sessionId: segSid, resolve }
            deps.send({
              type: "voice.stt.end",
              v: 1,
              sessionId: segSid,
              totalSeq: streamSeq,
            })
          },
        )

        if (dead || gen !== loopGen) return
        if (result.ok === false) {
          const streamErr = result.code
          if (streamErr === "aborted" || aborted) {
            handlers.onError("aborted")
            handlers.onEnd()
            reset()
            return
          }
          if (streamErr === "empty_result") {
            // Drop interim only
            handlers.onResult({ interim: "", finalChunk: "" })
          } else {
            handlers.onError(streamErr)
            handlers.onEnd()
            reset()
            return
          }
        } else if (result.text.trim()) {
          // Window commit: one finalChunk for the whole window text
          handlers.onResult({ interim: "", finalChunk: result.text.trim() })
          streamStable = result.text.trim()
        } else {
          handlers.onResult({ interim: "", finalChunk: "" })
        }

        if (!wantListening || aborted) break
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

  const runContinuous = async (gen: number) => {
    if (streamPartial) {
      await runStreamingContinuous(gen)
      return
    }
    try {
      handlers.onStart()
      while (!dead && wantListening && gen === loopGen) {
        const remaining = hardCapMs - (Date.now() - wallStart)
        // Allow short test segments (<800ms wall hardCap with tiny segmentCapMs)
        if (remaining < Math.min(50, segmentCapMs)) break

        const segmentMs = Math.min(segmentCapMs, LOCAL_STT_MAX_RECORD_MS, remaining)
        segmentIndex += 1
        const segSid = `${parentSessionId}-s${segmentIndex}`
        sessionId = segSid
        phase = "recording"

        // Do NOT voice.stt.start until upload: companion arms 10s idle on start
        // with zero chunks during record → forceAbort (Pi D1c blocker #2).
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

        // Open STT session then immediately stream chunks (keeps idle timer happy).
        sendStart(segSid, segmentMs)
        let result = await uploadAndWait(segSid, wav)
        // One retry on resource_conflict / session_busy (prior segment still held).
        if (
          result.ok === false &&
          (result.code === "resource_conflict" || result.code === "session_busy") &&
          !dead &&
          !aborted &&
          gen === loopGen
        ) {
          deps.send({ type: "voice.stt.abort", v: 1, sessionId: segSid })
          await new Promise((r) => setTimeout(r, 200))
          if (dead || aborted || gen !== loopGen) return
          const retrySid = `${segSid}-r1`
          sessionId = retrySid
          sendStart(retrySid, segmentMs)
          result = await uploadAndWait(retrySid, wav)
        }
        if (dead || gen !== loopGen) return

        if (result.ok === false) {
          const errCode = result.code
          if (errCode === "aborted" || aborted) {
            handlers.onError("aborted")
          } else {
            handlers.onError(errCode)
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
      segmentCapMs = LOCAL_STT_MAX_RECORD_MS
      streamPartial = false

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
        if (typeof (langOrOpts as { segmentMs?: number }).segmentMs === "number") {
          segmentCapMs = Math.max(
            20,
            Math.min(LOCAL_STT_MAX_RECORD_MS, (langOrOpts as { segmentMs: number }).segmentMs),
          )
        }
        if ((langOrOpts as { streamPartial?: boolean }).streamPartial === true) {
          streamPartial = true
          // Prefer near-realtime segment defaults when streaming
          if (segmentCapMs >= LOCAL_STT_MAX_RECORD_MS) {
            segmentCapMs = LOCAL_STT_NEAR_REALTIME_SEGMENT_MS
          }
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

      // Continuous: finish current segment early, then exit after upload / end stream
      if (mode === "continuous") {
        if (phase === "recording") {
          // N3: if window wait not armed yet (still in gUM), mark pending soft stop
          if (!segmentStopTrigger) {
            pendingSoftStop = true
          }
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
          if (result.ok === false) {
            const errCode = result.code
            handlers.onError(errCode === "aborted" ? "aborted" : errCode)
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
      clearPartialTimer()
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
      if (pcmStream) {
        try {
          pcmStream.abort()
        } catch {
          /* */
        }
        pcmStream = null
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
      pendingSoftStop = true
      loopGen += 1
      clearSegmentTimer()
      clearPartialTimer()
      // Fire wait resolvers so streaming coroutines do not hang (Pi destroy nit)
      try {
        segmentStopTrigger?.()
      } catch {
        /* */
      }
      segmentStopTrigger = null
      const sid = sessionId
      const handle = capture
      capture = null
      try {
        handle?.abort()
      } catch {
        /* */
      }
      if (pcmStream) {
        try {
          pcmStream.abort()
        } catch {
          /* */
        }
        pcmStream = null
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
