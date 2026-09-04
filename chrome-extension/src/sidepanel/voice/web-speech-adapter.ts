/**
 * Thin browser adapter: SpeechRecognition → normalized callbacks.
 * classic: no onend restart (M1). continuous: adapter-local restart while wantListening.
 * No React.
 */

import {
  getSpeechRecognitionCtor,
  VOICE_DEFAULT_LANG,
  type SpeechRecognitionLike,
  type VoiceDictationMode,
} from "./detect"

export type SpeechAdapterHandlers = {
  onStart: () => void
  onResult: (p: { interim: string; finalChunk: string }) => void
  onError: (code: string) => void
  onEnd: () => void
  /**
   * Local STT only: capture ended → host should dispatch CAPTURE_STOPPED
   * before waiting for voice.stt.result (enter processing phase).
   */
  onCaptureStopped?: () => void
  /**
   * Local continuous D1c: segment transcribed; resume listening chrome for next window.
   */
  onSegmentContinue?: () => void
  /** Local capture RMS 0–1 (browser Web Speech has no audio stream). */
  onLevel?: (level: number) => void
}

/** Browser: lang string. Local: sessionId + modelId required. Dictation+ mode optional. */
export type SpeechAdapterStartArg =
  | string
  | {
      lang?: string
      sessionId?: string
      modelId?: string
      /** classic | continuous (browser restart / local segments) */
      mode?: VoiceDictationMode
      /** continuous hard cap ms (local D1c) */
      hardCapMs?: number
      /** continuous per-segment window ms (tests / clamp ≤45s) */
      segmentMs?: number
      /**
       * M2: local progressive hypothesis streaming (PCM stream + partial_request).
       * Only meaningful for continuous local; not decoder-token Whisper.
       */
      streamPartial?: boolean
    }

export type SpeechAdapter = {
  start: (langOrOpts?: SpeechAdapterStartArg) => void
  stop: () => void
  abort: () => void
  destroy: () => void
}

export function createWebSpeechAdapter(handlers: SpeechAdapterHandlers): SpeechAdapter | null {
  const Ctor = getSpeechRecognitionCtor(
    typeof globalThis !== "undefined" ? (globalThis as any) : {},
  )
  if (!Ctor) return null

  let rec: SpeechRecognitionLike | null = null
  let dead = false
  /** When true, continuous mode may restart on onend. */
  let wantListening = false
  let mode: VoiceDictationMode = "classic"
  /** Bumped on each start/destroy; stale onend/onerror no-op. stop() does not bump (must deliver onEnd). */
  let listenGen = 0
  /** Prevent double onEnd for one session. */
  let endedForGen = -1
  let lang = VOICE_DEFAULT_LANG

  const clearHandlers = (r: SpeechRecognitionLike) => {
    r.onstart = null
    r.onresult = null
    r.onerror = null
    r.onend = null
  }

  const clear = () => {
    if (!rec) return
    clearHandlers(rec)
    rec = null
  }

  const bindAndStart = (gen: number) => {
    if (dead || gen !== listenGen || !wantListening) return
    clear()
    const r = new Ctor()
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    r.maxAlternatives = 1
    r.onstart = () => {
      if (dead || gen !== listenGen) return
      handlers.onStart()
    }
    r.onresult = (ev: any) => {
      if (dead || gen !== listenGen) return
      let interim = ""
      let finalChunk = ""
      const results = ev?.results
      const start = typeof ev?.resultIndex === "number" ? ev.resultIndex : 0
      if (!results) return
      for (let i = start; i < results.length; i++) {
        const row = results[i]
        const t = row?.[0]?.transcript || ""
        if (row?.isFinal) finalChunk += t
        else interim += t
      }
      handlers.onResult({ interim, finalChunk })
    }
    r.onerror = (ev: any) => {
      if (dead || gen !== listenGen) return
      const code = String(ev?.error || "unknown")
      // Continuous: soft no-speech — wait for onend and restart; do not kill session.
      if (mode === "continuous" && wantListening && code === "no-speech") {
        return
      }
      // Fatal engine errors (network, not-allowed, audio-capture, …): SoT §6 —
      // must NOT restart. Clear wantListening so paired onend delivers onEnd once.
      wantListening = false
      handlers.onError(code)
    }
    r.onend = () => {
      if (dead || gen !== listenGen) return
      clearHandlers(r)
      if (rec === r) rec = null
      // Continuous restart while user still wants listening (F-I-CD3 adapter-local).
      if (mode === "continuous" && wantListening && !dead) {
        try {
          // Brief yield so Chrome accepts a new start() after onend.
          queueMicrotask(() => {
            if (dead || gen !== listenGen) {
              // Gen invalidated / destroyed — do not double-end if already ended.
              return
            }
            // stop()/hard-cap may clear wantListening in the gap after rec was nulled;
            // must still deliver onEnd so SM leaves "stopping" and can commit finals.
            if (!wantListening) {
              if (endedForGen !== gen) {
                endedForGen = gen
                handlers.onEnd()
              }
              return
            }
            try {
              bindAndStart(gen)
            } catch {
              wantListening = false
              handlers.onError("unknown")
              if (endedForGen !== gen) {
                endedForGen = gen
                handlers.onEnd()
              }
            }
          })
          return
        } catch {
          /* fall through to end */
        }
      }
      wantListening = false
      if (endedForGen === gen) return
      endedForGen = gen
      handlers.onEnd()
    }
    rec = r
    try {
      r.start()
    } catch (e: any) {
      // Rapid restart InvalidStateError: retry once microtask later if still wanted
      if (mode === "continuous" && wantListening && e?.name === "InvalidStateError") {
        queueMicrotask(() => {
          if (dead || gen !== listenGen || !wantListening) return
          try {
            bindAndStart(gen)
          } catch {
            wantListening = false
            handlers.onError("aborted")
            handlers.onEnd()
          }
        })
        return
      }
      wantListening = false
      handlers.onError(e?.name === "InvalidStateError" ? "aborted" : "unknown")
      clear()
      handlers.onEnd()
    }
  }

  return {
    start(langOrOpts?: SpeechAdapterStartArg) {
      if (dead) return
      listenGen += 1
      const gen = listenGen
      endedForGen = -1
      wantListening = true
      if (typeof langOrOpts === "string") {
        lang = langOrOpts || VOICE_DEFAULT_LANG
        mode = "classic"
      } else {
        lang = langOrOpts?.lang || VOICE_DEFAULT_LANG
        mode = langOrOpts?.mode === "continuous" ? "continuous" : "classic"
      }
      bindAndStart(gen)
    },
    stop() {
      // Clear wantListening so continuous will not restart; keep listenGen so onend fires onEnd.
      wantListening = false
      try {
        rec?.stop()
      } catch {
        try {
          rec?.abort()
        } catch {
          /* */
        }
      }
    },
    abort() {
      wantListening = false
      try {
        rec?.abort()
      } catch {
        try {
          rec?.stop()
        } catch {
          /* */
        }
      }
    },
    destroy() {
      dead = true
      wantListening = false
      listenGen += 1
      try {
        rec?.abort()
      } catch {
        /* */
      }
      clear()
    },
  }
}
