/**
 * Thin browser adapter: SpeechRecognition → normalized callbacks.
 * No React.
 */

import {
  getSpeechRecognitionCtor,
  VOICE_DEFAULT_LANG,
  type SpeechRecognitionLike,
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
}

/** Browser: lang string. Local: sessionId + modelId required. */
export type SpeechAdapterStartArg =
  | string
  | {
      lang?: string
      sessionId?: string
      modelId?: string
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

  const clear = () => {
    if (!rec) return
    rec.onstart = null
    rec.onresult = null
    rec.onerror = null
    rec.onend = null
    rec = null
  }

  return {
    start(langOrOpts?: SpeechAdapterStartArg) {
      if (dead) return
      clear()
      const lang =
        typeof langOrOpts === "string"
          ? langOrOpts || VOICE_DEFAULT_LANG
          : langOrOpts?.lang || VOICE_DEFAULT_LANG
      const r = new Ctor()
      r.lang = lang
      r.continuous = true
      r.interimResults = true
      r.maxAlternatives = 1
      r.onstart = () => {
        if (!dead) handlers.onStart()
      }
      r.onresult = (ev: any) => {
        if (dead) return
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
        if (dead) return
        handlers.onError(String(ev?.error || "unknown"))
      }
      r.onend = () => {
        if (dead) return
        clear()
        handlers.onEnd()
      }
      rec = r
      try {
        r.start()
      } catch (e: any) {
        handlers.onError(e?.name === "InvalidStateError" ? "aborted" : "unknown")
        clear()
        handlers.onEnd()
      }
    },
    stop() {
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
      try {
        rec?.abort()
      } catch {
        /* */
      }
      clear()
    },
  }
}
