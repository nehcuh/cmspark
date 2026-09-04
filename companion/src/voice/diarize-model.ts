// #260 — diarize speaker-embedding model download/delete/probe.
//
// Thin wrapper over the whisper download machinery (downloadPinnedFiles /
// probePinnedDir / WhisperDownloadError): same https+sha256+size pins, same
// .part resume + atomic rename, same 45s-free single-flight shape. The diarize
// model subtree (<dataDir>/models/diarize) shares ONE voice-models disk budget
// with the whisper root — enforced via budgetRoots below.

import path from "node:path"
import { rm } from "node:fs/promises"

import { DATA_DIR } from "../config"
import { diarizeModelsRootOf } from "./models-roots"
import {
  loadDiarizeManifest,
  getDiarizeModelFiles,
  type DiarizeManifest,
  type DiarizeManifestFile,
} from "./diarize-manifest"
import {
  dirOccupiedBytes,
  downloadPinnedFiles,
  probePinnedDir,
  resolveBudgetMB,
  resolveModelDownloadEndpoint,
  resolveWhisperRoot,
  rewriteWhisperFileUrl,
  WhisperDownloadError,
} from "./whisper-download"

/** Single pinned speaker-embedding model (#260). Anonymous clustering only. */
export const DIARIZE_MODEL_ID = "3dspeaker_speech_eres2net_sv_en_voxceleb_16k"

export type DiarizeModelDownloadProgress = {
  modelId: string
  file: string
  receivedBytes: number
  totalBytes: number
}

export type DiarizeModelOpts = {
  signal?: AbortSignal
  onProgress?: (p: DiarizeModelDownloadProgress) => void
  fetchImpl?: typeof fetch
  budgetMB?: number
  /** Override diarize root (…/models/diarize). */
  rootDir?: string
  /** Used when resolving default roots under DATA_DIR (tests). */
  dataDir?: string
  manifest?: DiarizeManifest
  now?: () => number
}

export function resolveDiarizeRoot(opts?: { rootDir?: string; dataDir?: string }): string {
  if (opts?.rootDir) return path.resolve(opts.rootDir)
  return diarizeModelsRootOf(opts?.dataDir ?? DATA_DIR)
}

export function diarizeModelDestDir(
  modelId: string = DIARIZE_MODEL_ID,
  rootDir?: string,
): string {
  const root = rootDir ? path.resolve(rootDir) : resolveDiarizeRoot()
  return path.join(root, modelId)
}

// --- single-flight ------------------------------------------------------------

const inflight = new Map<string, Promise<void>>()

/** Test/debug: clear single-flight map (never needed in production). */
export function _resetDiarizeDownloadInflightForTests(): void {
  inflight.clear()
}

// --- probe --------------------------------------------------------------------

export function probeDiarizeModel(
  rootDir?: string,
  manifest?: DiarizeManifest,
): { status: "ready" | "absent" | "incomplete"; error?: string } {
  let files: DiarizeManifestFile[]
  try {
    files = getDiarizeModelFiles(DIARIZE_MODEL_ID, manifest ?? loadDiarizeManifest())
  } catch (err) {
    // Manifest asset missing/corrupt → treat as absent (mirrors whisper probe)
    return {
      status: "absent",
      error: err instanceof Error ? err.message : String(err),
    }
  }
  return probePinnedDir(diarizeModelDestDir(DIARIZE_MODEL_ID, rootDir), files)
}

/** Bytes occupied by the diarize subtree (disk accounting / settings state). */
export async function diarizeRootBytes(rootDir?: string): Promise<number> {
  return dirOccupiedBytes(rootDir ? path.resolve(rootDir) : resolveDiarizeRoot())
}

// --- delete -------------------------------------------------------------------

export async function deleteDiarizeModel(rootDir?: string): Promise<void> {
  await rm(diarizeModelDestDir(DIARIZE_MODEL_ID, rootDir), { recursive: true, force: true })
}

// --- download -----------------------------------------------------------------

export async function downloadDiarizeModel(opts: DiarizeModelOpts = {}): Promise<void> {
  const existing = inflight.get(DIARIZE_MODEL_ID)
  if (existing) return existing

  const run = doDownloadDiarizeModel(opts).finally(() => {
    if (inflight.get(DIARIZE_MODEL_ID) === run) inflight.delete(DIARIZE_MODEL_ID)
  })
  inflight.set(DIARIZE_MODEL_ID, run)
  return run
}

async function doDownloadDiarizeModel(opts: DiarizeModelOpts): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const signal = opts.signal

  if (signal?.aborted) {
    throw new WhisperDownloadError("aborted", `download aborted before start: ${DIARIZE_MODEL_ID}`)
  }

  let files: DiarizeManifestFile[]
  try {
    files = getDiarizeModelFiles(DIARIZE_MODEL_ID, opts.manifest ?? loadDiarizeManifest())
  } catch (err) {
    throw new WhisperDownloadError(
      "model-unknown",
      err instanceof Error ? err.message : `manifest missing model: ${DIARIZE_MODEL_ID}`,
    )
  }

  const endpoint = resolveModelDownloadEndpoint()
  if (endpoint) {
    files = files.map((f) => ({ ...f, url: rewriteWhisperFileUrl(f.url, endpoint) }))
  }

  const diarizeRoot = resolveDiarizeRoot({ rootDir: opts.rootDir, dataDir: opts.dataDir })
  const whisperRoot = resolveWhisperRoot({ dataDir: opts.dataDir })

  await downloadPinnedFiles({
    destDir: path.join(diarizeRoot, DIARIZE_MODEL_ID),
    files,
    fetchImpl,
    signal,
    now,
    budgetMB: resolveBudgetMB({ budgetMB: opts.budgetMB }),
    budgetRoots: [whisperRoot, diarizeRoot],
    label: DIARIZE_MODEL_ID,
    onProgress: opts.onProgress
      ? (p) => opts.onProgress!({ modelId: DIARIZE_MODEL_ID, ...p })
      : undefined,
  })
}
