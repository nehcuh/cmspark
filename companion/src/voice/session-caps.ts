// Path B STT session caps (ADR-023 L9–L10 / SoT §8). Spike S5 pure constants.

/** Record hard cap (ms) — client + server. */
export const STT_MAX_RECORD_MS = 45_000

/** No chunk idle abort (ms). */
export const STT_UPLOAD_IDLE_MS = 10_000

/** Whisper infer wall timeout (ms). */
export const STT_INFER_MAX_MS = 90_000

/** Aggregate raw audio bytes per session (PCM/WAV body). */
export const STT_MAX_SESSION_BYTES = 2_500_000

/** Single chunk decoded size cap. */
export const STT_MAX_CHUNK_BYTES = 256 * 1024

/** Allowlisted model ids (v1 catalog). */
export const STT_MODEL_IDS = ["small", "medium", "large-v3-turbo"] as const
export type SttModelId = (typeof STT_MODEL_IDS)[number]

export function isSttModelId(id: string): id is SttModelId {
  return (STT_MODEL_IDS as readonly string[]).includes(id)
}
