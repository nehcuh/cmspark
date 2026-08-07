// Path B M0 — Whisper model catalog (ids, UI meta, dir names).
// Model allowlist is owned by session-caps (STT_MODEL_IDS); this module re-exports
// and adds download-UI metadata only.

import path from "node:path"
import { STT_MODEL_IDS, type SttModelId, isSttModelId } from "./session-caps"

export type WhisperModelId = SttModelId
export { isSttModelId as isWhisperModelId, STT_MODEL_IDS as WHISPER_MODEL_IDS }

/** UI primary recommendation (SoT); S3 may later swap to turbo via one-line change. */
export const RECOMMENDED_WHISPER_MODEL: WhisperModelId = "medium"

/** Directory basename for a model under the whisper models root (no path seps). */
export function whisperModelDirName(id: WhisperModelId): string {
  return id
}

export const WHISPER_MODEL_UI: Record<
  WhisperModelId,
  { label: string; approxDiskGB: number; approxRamGB: number; notes: string }
> = {
  small: { label: "small", approxDiskGB: 0.5, approxRamGB: 1, notes: "轻量试水" },
  medium: {
    label: "medium（推荐）",
    approxDiskGB: 1.5,
    approxRamGB: 2.5,
    notes: "中文短指令默认推荐",
  },
  "large-v3-turbo": {
    label: "large-v3-turbo",
    // Full f16 ggml-large-v3-turbo.bin ≈ 1.62 GiB (not a Q5 quant).
    approxDiskGB: 1.6,
    approxRamGB: 2,
    notes: "更快大模型蒸馏档",
  },
}

/** Default models root for whisper family only: `<dataDir>/models/whisper`. */
export function defaultWhisperModelsRoot(dataDir: string): string {
  return path.join(dataDir, "models", "whisper")
}
