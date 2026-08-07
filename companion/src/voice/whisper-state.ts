// Path B M0 — voice.model.state DTO assembly (probe + binary + disk budget).
// Handlers own mutation; this module is pure observation over config + disk.

import * as path from "node:path"

import { getConfig, DATA_DIR } from "../config"
import {
  defaultWhisperSearchRoots,
  resolveWhisperArch,
  resolveWhisperBinary,
  resolveWhisperCliOnPath,
  type ResolveWhisperBinaryResult,
} from "./binary-resolve"
import { whisperPinResolveOpts } from "./whisper-binary-pins"
import {
  RECOMMENDED_WHISPER_MODEL,
  WHISPER_MODEL_IDS,
  type WhisperModelId,
} from "./whisper-catalog"
import {
  DEFAULT_WHISPER_DISK_BUDGET_MB,
  dirOccupiedBytes,
  probeWhisperModelDir,
  resolveWhisperRoot,
} from "./whisper-download"

export type WhisperModelProbeStatus = "ready" | "absent" | "incomplete" | "downloading"

export type VoiceModelBinaryStatus =
  | "ready"
  | "not_found"
  | "hash_mismatch"
  | "unsupported_arch"

export interface VoiceModelStatePayload {
  type: "voice.model.state"
  sttEngine: "browser" | "local"
  localModelId: WhisperModelId
  recommendedModelId: WhisperModelId
  models: Record<
    string,
    { status: WhisperModelProbeStatus; bytesOnDisk?: number; error?: string }
  >
  binary: { status: VoiceModelBinaryStatus; path?: string; message?: string }
  diskBudgetMB: number
  diskUsedMB: number
  whisperRoot: string
}

/** Companion package root candidates (src layout / test-dist / bundle). */
export function defaultCompanionRoots(fromDir: string = __dirname): string[] {
  return [
    path.join(fromDir, "..", ".."), // companion/src/voice → companion/
    path.join(fromDir, "..", "..", ".."), // companion/.test-dist/src/voice → companion/
    path.join(fromDir, ".."), // esbuild bundle next to voice chunk
  ]
}

export function mapBinaryResult(r: ResolveWhisperBinaryResult): VoiceModelStatePayload["binary"] {
  if (r.ok) {
    return { status: "ready", path: r.path }
  }
  if (r.reason === "unsupported_arch") {
    return { status: "unsupported_arch", message: r.message }
  }
  if (r.reason === "hash_mismatch") {
    return {
      status: "hash_mismatch",
      ...(r.path ? { path: r.path } : {}),
      message: r.message,
    }
  }
  // not_found | unreadable → not_found is OK for M0
  return {
    status: "not_found",
    ...(r.path ? { path: r.path } : {}),
    message: r.message,
  }
}

export function resolveBinaryForState(opts?: {
  companionRoots?: string[]
  searchRoots?: string[]
}): VoiceModelStatePayload["binary"] {
  const roots =
    opts?.searchRoots ??
    (opts?.companionRoots ?? defaultCompanionRoots()).flatMap((r) => defaultWhisperSearchRoots(r))
  // de-dupe while preserving order
  const seen = new Set<string>()
  const searchRoots: string[] = []
  for (const r of roots) {
    if (!seen.has(r)) {
      seen.add(r)
      searchRoots.push(r)
    }
  }
  const warch = resolveWhisperArch()
  const pinOpts = whisperPinResolveOpts(warch)
  if (pinOpts.forceUnpinned) {
    console.warn(
      "[voice] CMSPARK_WHISPER_UNPINNED=1 — skipping cmspark-whisper SHA256 pin (dev only)",
    )
  }
  const packaged = resolveWhisperBinary({
    searchRoots,
    expectedSha256: pinOpts.expectedSha256,
    allowUnpinned: pinOpts.allowUnpinned,
  })
  if (packaged.ok) return mapBinaryResult(packaged)
  // Dev fallback: Homebrew/PATH whisper-cli (packaged copy may miss dylibs)
  const pathCli = resolveWhisperCliOnPath()
  if (pathCli) {
    return { status: "ready", path: pathCli }
  }
  return mapBinaryResult(packaged)
}

export interface BuildVoiceModelStateOpts {
  /** Model ids currently downloading (status overlay). */
  downloadingModelIds?: Iterable<string>
  /** Optional whisper root override (tests). */
  rootDir?: string
  /** Inject binary result (tests). */
  binary?: VoiceModelStatePayload["binary"]
  /** Inject companion roots for binary search. */
  companionRoots?: string[]
}

/**
 * Build the full voice.model.state payload.
 * Lightweight enough for settings open / post-mutator broadcast.
 */
export async function buildVoiceModelState(
  opts: BuildVoiceModelStateOpts = {},
): Promise<VoiceModelStatePayload> {
  const cfg = getConfig().voice ?? {
    sttEngine: "browser" as const,
    localModelId: "medium" as const,
    modelDiskBudgetMB: DEFAULT_WHISPER_DISK_BUDGET_MB,
  }
  const rootDir = opts.rootDir ?? resolveWhisperRoot()
  const downloading = new Set(opts.downloadingModelIds ?? [])

  const models: VoiceModelStatePayload["models"] = {}
  for (const id of WHISPER_MODEL_IDS) {
    if (downloading.has(id)) {
      models[id] = { status: "downloading" }
      continue
    }
    const probe = probeWhisperModelDir(id as WhisperModelId, rootDir)
    const entry: { status: WhisperModelProbeStatus; bytesOnDisk?: number; error?: string } = {
      status: probe.status,
    }
    if (probe.error) entry.error = probe.error
    if (probe.status === "ready" || probe.status === "incomplete") {
      try {
        const bytes = await dirOccupiedBytes(path.join(rootDir, id))
        if (bytes > 0) entry.bytesOnDisk = bytes
      } catch {
        /* best-effort */
      }
    }
    models[id] = entry
  }

  const occupied = await dirOccupiedBytes(rootDir)
  const budgetMB =
    typeof cfg.modelDiskBudgetMB === "number" &&
    Number.isFinite(cfg.modelDiskBudgetMB) &&
    cfg.modelDiskBudgetMB > 0
      ? cfg.modelDiskBudgetMB
      : DEFAULT_WHISPER_DISK_BUDGET_MB

  const localModelId = (cfg.localModelId ?? "medium") as WhisperModelId
  const sttEngine = cfg.sttEngine === "local" ? "local" : "browser"

  return {
    type: "voice.model.state",
    sttEngine,
    localModelId,
    recommendedModelId: RECOMMENDED_WHISPER_MODEL,
    models,
    binary: opts.binary ?? resolveBinaryForState({ companionRoots: opts.companionRoots }),
    diskBudgetMB: budgetMB,
    diskUsedMB: Math.round((occupied / (1024 * 1024)) * 10) / 10,
    whisperRoot: rootDir,
  }
}

/** List model ids whose probe status is ready. */
export function listReadyWhisperModels(rootDir?: string): WhisperModelId[] {
  const root = rootDir ?? resolveWhisperRoot()
  const ready: WhisperModelId[] = []
  for (const id of WHISPER_MODEL_IDS) {
    const probe = probeWhisperModelDir(id as WhisperModelId, root)
    if (probe.status === "ready") ready.push(id as WhisperModelId)
  }
  return ready
}

/** DATA_DIR helper for tests that need isolation context. */
export function voiceDataDir(): string {
  return DATA_DIR
}
