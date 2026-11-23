import * as os from "node:os"
import type { WhisperModelId } from "./whisper-catalog"

export type WhisperHardware = { cpu: string; logicalCores: number; memoryGB: number }

/** A conservative resource hint, not a latency prediction or automatic selection. */
export function recommendWhisper(hardware: WhisperHardware): WhisperModelId {
  if (hardware.memoryGB > 0 && (hardware.memoryGB < 6 || (hardware.memoryGB < 8 && hardware.logicalCores > 0 && hardware.logicalCores <= 4))) return "small"
  return "medium"
}

export function detectWhisperHardware(): WhisperHardware {
  const cpus = os.cpus()
  return {
    cpu: cpus[0]?.model?.trim() || "未知处理器",
    logicalCores: cpus.length,
    memoryGB: Math.round(os.totalmem() / 1024 ** 3 * 10) / 10,
  }
}
