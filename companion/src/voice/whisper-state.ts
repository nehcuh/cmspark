// Path B M0 — voice.model.state DTO assembly (probe + binary + disk budget).
// Handlers own mutation; this module is pure observation over config + disk.

import * as path from "node:path"

import { getConfig, DATA_DIR } from "../config"
import {
  allWhisperSearchRoots,
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
import { getWhisperPrewarmStatus } from "./whisper-prewarm"
import {
  DIARIZE_MODEL_ID,
  diarizeModelDestDir,
  probeDiarizeModel,
  resolveDiarizeRoot,
} from "./diarize-model"

export type WhisperModelProbeStatus = "ready" | "absent" | "incomplete" | "downloading"

export type VoiceModelBinaryStatus =
  | "ready"
  | "not_found"
  | "hash_mismatch"
  | "unsupported_arch"

export interface VoiceModelStatePayload {
  type: "voice.model.state"
  sttEngine: "browser" | "local" | "system"
  localModelId: WhisperModelId
  recommendedModelId: WhisperModelId
  models: Record<
    string,
    { status: WhisperModelProbeStatus; bytesOnDisk?: number; error?: string }
  >
  /** #260 diarize speaker-embedding model (anonymous clustering only). */
  diarizeModel: { modelId: string; status: WhisperModelProbeStatus; bytesOnDisk?: number; error?: string }
  binary: { status: VoiceModelBinaryStatus; path?: string; message?: string }
  /** SHARED budget across whisper root + diarize root (#260). */
  diskBudgetMB: number
  diskUsedMB: number
  whisperRoot: string
  diarizeRoot: string
  /**
   * engine=local 且活动模型未就绪时，扩展本次会话回退浏览器听写 + 可见横幅
   * （非静默、不写 sttEngine）。默认 true。
   */
  autoFallbackToBrowser: boolean
  /** 模型下载源（HF 镜像）。"" = 按清单 URL 原样下载。env 覆盖不回显（配置值视图）。 */
  modelDownloadEndpoint: string
  postprocessFillers: boolean
  postprocessLowercase: boolean
  postprocessStripPunct: boolean
  postprocessMap: Array<[string, string]>
  modelPrewarm: boolean
  prewarmStatus: "idle" | "ok" | "fail"
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
  /** Override process.execPath for packaged SEA root (tests). */
  execPath?: string
}): VoiceModelStatePayload["binary"] {
  const searchRoots =
    opts?.searchRoots ??
    allWhisperSearchRoots({
      companionRoots: opts?.companionRoots ?? defaultCompanionRoots(),
      ...(opts?.execPath ? { execPath: opts.execPath } : {}),
    })
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
  // VOICE-01 / ADR-023 L5: production never silently uses PATH whisper-cli
  // (unpinned supply chain). Opt-in only: CMSPARK_WHISPER_PATH_FALLBACK=1 (dev).
  if (process.env.CMSPARK_WHISPER_PATH_FALLBACK === "1") {
    const pathCli = resolveWhisperCliOnPath()
    if (pathCli) {
      console.warn(
        "[voice] CMSPARK_WHISPER_PATH_FALLBACK=1 — using PATH whisper-cli (unpinned, dev only)",
      )
      return { status: "ready", path: pathCli }
    }
  }
  return mapBinaryResult(packaged)
}

export interface BuildVoiceModelStateOpts {
  /** Model ids currently downloading (status overlay). */
  downloadingModelIds?: Iterable<string>
  /** #260: diarize model downloading (status overlay). */
  downloadingDiarize?: boolean
  /** Optional whisper root override (tests). */
  rootDir?: string
  /** Optional diarize root override (tests). */
  diarizeRootDir?: string
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
    autoFallbackToBrowser: true,
    modelDownloadEndpoint: "",
  }
  const rootDir = opts.rootDir ?? resolveWhisperRoot()
  const diarizeRootDir = opts.diarizeRootDir ?? resolveDiarizeRoot()
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

  // #260 diarize model entry (shared budget, separate subtree)
  let diarizeModel: VoiceModelStatePayload["diarizeModel"]
  if (opts.downloadingDiarize) {
    diarizeModel = { modelId: DIARIZE_MODEL_ID, status: "downloading" }
  } else {
    const probe = probeDiarizeModel(diarizeRootDir)
    diarizeModel = { modelId: DIARIZE_MODEL_ID, status: probe.status }
    if (probe.error) diarizeModel.error = probe.error
    if (probe.status === "ready" || probe.status === "incomplete") {
      try {
        const bytes = await dirOccupiedBytes(diarizeModelDestDir(DIARIZE_MODEL_ID, diarizeRootDir))
        if (bytes > 0) diarizeModel.bytesOnDisk = bytes
      } catch {
        /* best-effort */
      }
    }
  }

  // Shared voice-models budget: whisper root + diarize root (sum of subtrees)
  const occupied = (await dirOccupiedBytes(rootDir)) + (await dirOccupiedBytes(diarizeRootDir))
  const budgetMB =
    typeof cfg.modelDiskBudgetMB === "number" &&
    Number.isFinite(cfg.modelDiskBudgetMB) &&
    cfg.modelDiskBudgetMB > 0
      ? cfg.modelDiskBudgetMB
      : DEFAULT_WHISPER_DISK_BUDGET_MB

  const localModelId = (cfg.localModelId ?? "medium") as WhisperModelId
  const sttEngine: VoiceModelStatePayload["sttEngine"] =
    cfg.sttEngine === "local"
      ? "local"
      : cfg.sttEngine === "system"
        ? "system"
        : "browser"

  return {
    type: "voice.model.state",
    sttEngine,
    localModelId,
    recommendedModelId: RECOMMENDED_WHISPER_MODEL,
    models,
    diarizeModel,
    binary: opts.binary ?? resolveBinaryForState({ companionRoots: opts.companionRoots }),
    diskBudgetMB: budgetMB,
    diskUsedMB: Math.round((occupied / (1024 * 1024)) * 10) / 10,
    whisperRoot: rootDir,
    diarizeRoot: diarizeRootDir,
    autoFallbackToBrowser: cfg.autoFallbackToBrowser !== false,
    modelDownloadEndpoint:
      typeof cfg.modelDownloadEndpoint === "string" ? cfg.modelDownloadEndpoint : "",
    postprocessFillers: cfg.postprocessFillers === true,
    postprocessLowercase: cfg.postprocessLowercase === true,
    postprocessStripPunct: cfg.postprocessStripPunct === true,
    postprocessMap: Array.isArray(cfg.postprocessMap) ? cfg.postprocessMap : [],
    modelPrewarm: cfg.modelPrewarm === true,
    // Runtime status from an actual whisper load — never equate disk-ready with ok.
    prewarmStatus: cfg.modelPrewarm === true ? getWhisperPrewarmStatus() : "idle",
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
