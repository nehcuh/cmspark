/**
 * Path B M1 — STT engine factory (browser Web Speech | local Companion whisper).
 * Never silent-fallback: caller chooses kind; factory returns null only if
 * that kind is impossible (missing ctor / missing local deps).
 */

import {
  createWebSpeechAdapter,
  type SpeechAdapter,
  type SpeechAdapterHandlers,
} from "./web-speech-adapter"
import {
  createLocalSttAdapter,
  type LocalSttAdapterDeps,
} from "./local-stt-adapter"

export type SttEngineKind = "browser" | "local"

export type CreateSttAdapterDeps = {
  handlers: SpeechAdapterHandlers
  /** Required when kind === "local". */
  local?: LocalSttAdapterDeps
}

/**
 * Create the STT adapter for the selected engine.
 * - browser: Web Speech; null if SpeechRecognition missing
 * - local: Companion WS path; null if local deps incomplete
 */
export function createSttAdapter(
  kind: SttEngineKind,
  deps: CreateSttAdapterDeps,
): SpeechAdapter | null {
  if (kind === "browser") {
    return createWebSpeechAdapter(deps.handlers)
  }
  if (kind === "local") {
    if (!deps.local?.send || !deps.local?.onMessage || !deps.local?.modelId) {
      return null
    }
    return createLocalSttAdapter(deps.handlers, deps.local)
  }
  return null
}
