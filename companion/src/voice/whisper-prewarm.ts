// #258 — real companion-start prewarm: run whisper-cli once on a silent WAV
// so the first dictation is not a cold load. Disk-ready ≠ prewarmed.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { getConfig } from "../config"
import { logger } from "../logger"
import {
  allWhisperSearchRoots,
  resolveWhisperArch,
  resolveWhisperBinary,
} from "./binary-resolve"
import { whisperPinResolveOpts } from "./whisper-binary-pins"
import { isWhisperModelId, type WhisperModelId, whisperModelDirName } from "./whisper-catalog"
import { getWhisperModelFiles, loadWhisperManifest } from "./whisper-manifest"
import { probeWhisperModelDir, resolveWhisperRoot } from "./whisper-download"
import { runWhisperTranscribe, type WhisperRunResult } from "./whisper-runner"

function companionRoots(): string[] {
  return [
    path.join(__dirname, "..", ".."),
    path.join(__dirname, "..", "..", ".."),
    path.join(__dirname, ".."),
  ]
}

export type WhisperPrewarmStatus = "idle" | "ok" | "fail"

let status: WhisperPrewarmStatus = "idle"
let inFlight: Promise<WhisperPrewarmStatus> | null = null
let lastModel: string | null = null

export function getWhisperPrewarmStatus(): WhisperPrewarmStatus {
  return status
}

export function resetWhisperPrewarm(): void {
  status = "idle"
  inFlight = null
  lastModel = null
}

export const resetWhisperPrewarmForTests = resetWhisperPrewarm

/** 16 kHz / 16-bit / mono silent WAV (enough to force ggml model load). */
export function buildSilentWavBytes(durationMs = 80): Buffer {
  const sampleRate = 16000
  const n = Math.max(1, Math.floor((sampleRate * durationMs) / 1000))
  const dataBytes = n * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write("RIFF", 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write("WAVE", 8)
  buf.write("fmt ", 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write("data", 36)
  buf.writeUInt32LE(dataBytes, 40)
  return buf
}

export type PrewarmResolveReady = {
  modelId: string
  modelPath: string
  binaryPath: string
} | null

export function resolvePrewarmReady(): PrewarmResolveReady {
  const voice = getConfig().voice
  const modelIdRaw = voice?.localModelId ?? "medium"
  if (!isWhisperModelId(modelIdRaw)) return null
  const modelId = modelIdRaw as WhisperModelId
  const root = resolveWhisperRoot()
  if (probeWhisperModelDir(modelId, root).status !== "ready") return null
  let files
  try {
    files = getWhisperModelFiles(modelId, loadWhisperManifest())
  } catch {
    return null
  }
  const primary = files.find((f) => f.name.endsWith(".bin")) ?? files[0]
  if (!primary || primary.name.includes("..") || primary.name.includes("/") || primary.name.includes("\\")) {
    return null
  }
  const modelPath = path.join(root, whisperModelDirName(modelId), primary.name)
  if (!fs.existsSync(modelPath)) return null

  const warch = resolveWhisperArch()
  const pinOpts = whisperPinResolveOpts(warch)
  const packaged = resolveWhisperBinary({
    searchRoots: allWhisperSearchRoots({ companionRoots: companionRoots() }),
    expectedSha256: pinOpts.expectedSha256,
    allowUnpinned: pinOpts.allowUnpinned,
  })
  if (!packaged.ok) return null
  return { modelId, modelPath, binaryPath: packaged.path }
}

export async function maybePrewarmWhisper(opts?: {
  enabled?: boolean
  resolveReady?: () => PrewarmResolveReady
  transcribe?: (o: {
    binaryPath: string
    modelPath: string
    audioPath: string
  }) => Promise<WhisperRunResult>
}): Promise<WhisperPrewarmStatus> {
  const enabled = opts?.enabled ?? getConfig().voice?.modelPrewarm === true
  if (!enabled) {
    status = "idle"
    lastModel = null
    return status
  }
  const ready = (opts?.resolveReady ?? resolvePrewarmReady)()
  if (!ready) {
    // Never attempted — model/binary missing is not "预热失败".
    status = "idle"
    lastModel = null
    return status
  }
  if (status === "ok" && lastModel === ready.modelId && !opts?.transcribe) {
    return status
  }
  if (inFlight) return inFlight

  const run = (async (): Promise<WhisperPrewarmStatus> => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-whisper-prewarm-"))
    const wavPath = path.join(tmpDir, "silence.wav")
    try {
      fs.writeFileSync(wavPath, buildSilentWavBytes())
      const transcribe = opts?.transcribe ?? ((o) => runWhisperTranscribe(o))
      await transcribe({
        binaryPath: ready.binaryPath,
        modelPath: ready.modelPath,
        audioPath: wavPath,
      })
      status = "ok"
      lastModel = ready.modelId
      logger.info("voice.prewarm.ok", { modelId: ready.modelId })
      return status
    } catch (err) {
      status = "fail"
      lastModel = ready.modelId
      logger.warn("voice.prewarm.fail", {
        modelId: ready.modelId,
        error: err instanceof Error ? err.message : String(err),
      })
      return status
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        /* */
      }
      inFlight = null
    }
  })()
  inFlight = run
  return run
}

/** Fire-and-forget after companion listen. Default-off: no-ops unless pref is on. */
export function scheduleWhisperPrewarm(): void {
  if (getConfig().voice?.modelPrewarm !== true) return
  setTimeout(() => {
    void maybePrewarmWhisper()
  }, 0)
}
