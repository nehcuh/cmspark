// Path B M0 — Whisper model download/delete/probe (ADR-023 L8).
//
// Patterns adapted from computer/model-download.ts (https-only, streaming .part,
// sha256 verify, atomic rename, mid-stream oversize abort) — NOT coupled to
// TinyClick / computer schema.
//
// Budget is scoped to the whisper root ONLY (…/models/whisper), never the
// parent models/ tree (no double-count with Qwen / other families).
//
// No auto-start on companion boot — only explicit downloadWhisperModel() calls.

import { createHash } from "node:crypto"
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs"
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import path from "node:path"

import { DATA_DIR, getConfig } from "../config"
import {
  defaultWhisperModelsRoot,
  isWhisperModelId,
  whisperModelDirName,
  type WhisperModelId,
} from "./whisper-catalog"
import {
  getWhisperModelFiles,
  loadWhisperManifest,
  type WhisperManifest,
  type WhisperManifestFile,
} from "./whisper-manifest"

// --- constants & errors -------------------------------------------------------

/** Default disk budget (MB) for the whisper root — matches config.voice default. */
export const DEFAULT_WHISPER_DISK_BUDGET_MB = 4096

/** stale .part age threshold (24h). */
export const PART_STALE_MS = 24 * 60 * 60 * 1000

export type WhisperDownloadReason =
  | "model-unknown"
  | "disk-budget-exceeded"
  | "http-error"
  | "network-error"
  | "hash-mismatch"
  | "size-mismatch"
  | "oversize-stream"
  | "aborted"
  | "scheme-denied"

export class WhisperDownloadError extends Error {
  readonly reason: WhisperDownloadReason
  constructor(reason: WhisperDownloadReason, message: string) {
    super(message)
    this.name = "WhisperDownloadError"
    this.reason = reason
  }
}

export type WhisperDownloadProgress = {
  modelId: string
  file: string
  receivedBytes: number
  totalBytes: number
}

export type WhisperDownloadOpts = {
  signal?: AbortSignal
  onProgress?: (p: WhisperDownloadProgress) => void
  fetchImpl?: typeof fetch
  budgetMB?: number
  /** Override whisper root (…/models/whisper). */
  rootDir?: string
  /** Used when resolving default root under DATA_DIR. */
  dataDir?: string
  /**
   * Optional manifest override (tests). Production always uses loadWhisperManifest().
   * Not part of the public settings/WS surface.
   */
  manifest?: WhisperManifest
  now?: () => number
}

// --- path resolution ----------------------------------------------------------

/**
 * Resolve whisper family root.
 * Default: path.join(dataDir||DATA_DIR, "models", "whisper")
 */
export function resolveWhisperRoot(opts?: { rootDir?: string; dataDir?: string }): string {
  if (opts?.rootDir) return path.resolve(opts.rootDir)
  const dataDir = opts?.dataDir ?? DATA_DIR
  try {
    const cfg = getConfig()
    if (cfg.voice?.modelRootDir && typeof cfg.voice.modelRootDir === "string" && cfg.voice.modelRootDir.trim()) {
      // Only honor config override when caller did not pass dataDir/rootDir.
      // dataDir alone still wins over config when explicitly testing isolation.
      if (!opts?.dataDir) return path.resolve(cfg.voice.modelRootDir)
    }
  } catch {
    /* getConfig unavailable in some test harnesses */
  }
  return defaultWhisperModelsRoot(dataDir)
}

function modelDestDir(modelId: WhisperModelId, rootDir: string): string {
  return path.join(rootDir, whisperModelDirName(modelId))
}

// --- disk accounting (budgetDir = whisper root only) --------------------------

/** Recursive byte sum under dir (missing dir → 0). Exported for unit tests. */
export async function dirOccupiedBytes(dir: string): Promise<number> {
  try {
    let total = 0
    for (const e of await readdir(dir, { withFileTypes: true })) {
      try {
        if (e.isDirectory()) total += await dirOccupiedBytes(path.join(dir, e.name))
        else if (e.isFile()) total += (await stat(path.join(dir, e.name))).size
      } catch {
        /* race delete */
      }
    }
    return total
  } catch {
    return 0
  }
}

function resolveBudgetMB(opts?: WhisperDownloadOpts): number {
  if (opts?.budgetMB !== undefined && Number.isFinite(opts.budgetMB) && opts.budgetMB > 0) {
    return opts.budgetMB
  }
  try {
    const v = getConfig().voice?.modelDiskBudgetMB
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_WHISPER_DISK_BUDGET_MB
}

// --- crypto helpers -----------------------------------------------------------

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest("hex")
}

function sha256FileSync(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

// --- .part meta ---------------------------------------------------------------

interface PartMeta {
  url: string
  sha256: string
  size: number
  startedAt: number
}

async function readPartMeta(metaPath: string): Promise<PartMeta | null> {
  try {
    const parsed = JSON.parse(await readFile(metaPath, "utf-8")) as Partial<PartMeta>
    if (
      typeof parsed.url !== "string" ||
      typeof parsed.sha256 !== "string" ||
      typeof parsed.size !== "number" ||
      typeof parsed.startedAt !== "number"
    ) {
      return null
    }
    return parsed as PartMeta
  } catch {
    return null
  }
}

// --- single-flight ------------------------------------------------------------

const inflight = new Map<string, Promise<void>>()

/** Test/debug: clear single-flight map (never needed in production). */
export function _resetWhisperDownloadInflightForTests(): void {
  inflight.clear()
}

// --- probe --------------------------------------------------------------------

/**
 * Probe model directory readiness against the pinned manifest.
 * - ready: all files exist with matching size + sha256
 * - absent: model dir missing or empty of expected finals
 * - incomplete: partial / size or hash mismatch / only .part
 *
 * Hash check uses streaming read for correctness; for multi-GB models prefer
 * calling this off the hot path (settings get_state is infrequent).
 */
export function probeWhisperModelDir(
  modelId: WhisperModelId,
  rootDir?: string,
  manifest?: WhisperManifest,
): { status: "ready" | "absent" | "incomplete"; error?: string } {
  if (!isWhisperModelId(modelId)) {
    return { status: "absent", error: "model-unknown" }
  }
  const root = rootDir ? path.resolve(rootDir) : resolveWhisperRoot()
  const destDir = modelDestDir(modelId, root)

  let files: WhisperManifestFile[]
  try {
    files = getWhisperModelFiles(modelId, manifest ?? loadWhisperManifest())
  } catch (err) {
    return {
      status: "absent",
      error: err instanceof Error ? err.message : String(err),
    }
  }

  if (!existsSync(destDir)) {
    return { status: "absent" }
  }

  let anyPresent = false
  let allReady = true
  for (const f of files) {
    const destPath = path.join(destDir, f.name)
    if (!existsSync(destPath)) {
      allReady = false
      // .part counts as incomplete presence
      if (existsSync(`${destPath}.part`)) anyPresent = true
      continue
    }
    anyPresent = true
    try {
      const st = statSync(destPath)
      if (st.size !== f.size) {
        allReady = false
        continue
      }
      // size match — verify sha (sync; rare call path)
      const digest = sha256FileSync(destPath)
      if (digest !== f.sha256) {
        allReady = false
      }
    } catch {
      allReady = false
    }
  }

  if (allReady) return { status: "ready" }
  if (!anyPresent) {
    // dir may exist empty or with unrelated junk
    try {
      const ents = readdirSync(destDir)
      if (ents.length === 0) return { status: "absent" }
    } catch {
      return { status: "absent" }
    }
    return { status: "incomplete", error: "unexpected-files" }
  }
  return { status: "incomplete" }
}

// --- delete -------------------------------------------------------------------

export async function deleteWhisperModel(modelId: WhisperModelId, rootDir?: string): Promise<void> {
  if (!isWhisperModelId(modelId)) {
    throw new WhisperDownloadError("model-unknown", `not a whisper model id: ${modelId}`)
  }
  const root = rootDir ? path.resolve(rootDir) : resolveWhisperRoot()
  const destDir = modelDestDir(modelId, root)
  await rm(destDir, { recursive: true, force: true })
}

// --- download -----------------------------------------------------------------

export async function downloadWhisperModel(
  modelId: WhisperModelId,
  opts: WhisperDownloadOpts = {},
): Promise<void> {
  if (!isWhisperModelId(modelId)) {
    throw new WhisperDownloadError("model-unknown", `not a whisper model id: ${modelId}`)
  }

  const existing = inflight.get(modelId)
  if (existing) return existing

  const run = doDownloadWhisperModel(modelId, opts).finally(() => {
    if (inflight.get(modelId) === run) inflight.delete(modelId)
  })
  inflight.set(modelId, run)
  return run
}

async function doDownloadWhisperModel(
  modelId: WhisperModelId,
  opts: WhisperDownloadOpts,
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const signal = opts.signal

  if (signal?.aborted) {
    throw new WhisperDownloadError("aborted", `download aborted before start: ${modelId}`)
  }

  const manifest = opts.manifest ?? loadWhisperManifest()
  let files: WhisperManifestFile[]
  try {
    files = getWhisperModelFiles(modelId, manifest)
  } catch (err) {
    throw new WhisperDownloadError(
      "model-unknown",
      err instanceof Error ? err.message : `manifest missing model: ${modelId}`,
    )
  }

  const rootDir = resolveWhisperRoot({ rootDir: opts.rootDir, dataDir: opts.dataDir })
  const destDir = modelDestDir(modelId, rootDir)
  await mkdir(destDir, { recursive: true })

  const totalSize = files.reduce((acc, f) => acc + f.size, 0)

  // Disk budget — pre-check only (fail-closed). Budget dir = whisper root, NOT models/.
  const budgetMB = resolveBudgetMB(opts)
  const occupied = await dirOccupiedBytes(rootDir)
  const projected = occupied + totalSize
  if (projected > budgetMB * 1024 * 1024) {
    throw new WhisperDownloadError(
      "disk-budget-exceeded",
      `磁盘预算超限：whisper 根目录占用 ${occupied} + 本次 ${totalSize} = ${projected} 字节 > 预算 ${budgetMB}MB`,
    )
  }

  for (const f of files) {
    if (signal?.aborted) {
      throw new WhisperDownloadError("aborted", `download aborted: ${modelId}/${f.name}`)
    }

    if (!f.url.startsWith("https://")) {
      throw new WhisperDownloadError("scheme-denied", `url must be https: ${f.url}`)
    }

    const destPath = path.join(destDir, f.name)
    // basename-only already enforced by manifest schema; belt-and-suspenders
    if (f.name.includes("/") || f.name.includes("\\") || f.name.includes("..")) {
      throw new WhisperDownloadError("model-unknown", `invalid file name: ${f.name}`)
    }

    const partPath = `${destPath}.part`
    const metaPath = `${partPath}.json`

    // Idempotent skip: final file size+sha256 match → zero fetch
    try {
      const s = await stat(destPath)
      if (s.size === f.size && (await sha256File(destPath)) === f.sha256) {
        await rm(partPath, { force: true })
        await rm(metaPath, { force: true })
        continue
      }
    } catch {
      /* missing → download */
    }

    // stale .part
    let resumeFrom = 0
    const meta = await readPartMeta(metaPath)
    const metaValid =
      meta !== null &&
      meta.url === f.url &&
      meta.sha256 === f.sha256 &&
      meta.size === f.size &&
      now() - meta.startedAt <= PART_STALE_MS
    if (metaValid && meta) {
      try {
        const s = await stat(partPath)
        if (s.size > 0 && s.size <= f.size) {
          resumeFrom = s.size
        } else {
          await rm(partPath, { force: true })
        }
      } catch {
        resumeFrom = 0
      }
    } else {
      await rm(partPath, { force: true })
      await rm(metaPath, { force: true })
    }
    if (resumeFrom === 0) {
      const freshMeta: PartMeta = {
        url: f.url,
        sha256: f.sha256,
        size: f.size,
        startedAt: now(),
      }
      await writeFile(metaPath, JSON.stringify(freshMeta), "utf-8")
    }

    if (resumeFrom < f.size) {
      try {
        await downloadOne({
          fetchImpl,
          url: f.url,
          partPath,
          resumeFrom,
          expectedSize: f.size,
          signal,
          onProgress: opts.onProgress
            ? (received, total) =>
                opts.onProgress!({
                  modelId,
                  file: f.name,
                  receivedBytes: received,
                  totalBytes: total,
                })
            : undefined,
          fileName: f.name,
        })
      } catch (err) {
        if (err instanceof WhisperDownloadError && err.reason === "oversize-stream") {
          await rm(partPath, { force: true })
          await rm(metaPath, { force: true })
        }
        throw err
      }
    }

    // Full verify + atomic rename
    const partStat = await stat(partPath)
    if (partStat.size !== f.size) {
      await rm(partPath, { force: true })
      await rm(metaPath, { force: true })
      throw new WhisperDownloadError(
        "size-mismatch",
        `${f.name} size mismatch (expected ${f.size}, got ${partStat.size})`,
      )
    }
    const digest = await sha256File(partPath)
    if (digest !== f.sha256) {
      await rm(partPath, { force: true })
      await rm(metaPath, { force: true })
      throw new WhisperDownloadError(
        "hash-mismatch",
        `${f.name} sha256 mismatch (expected ${f.sha256}, got ${digest})`,
      )
    }
    await rename(partPath, destPath)
    await rm(metaPath, { force: true })
  }
}

/** Single-file streaming download with Range resume + oversize abort + AbortSignal. */
async function downloadOne(args: {
  fetchImpl: typeof fetch
  url: string
  partPath: string
  resumeFrom: number
  expectedSize: number
  signal?: AbortSignal
  onProgress?: (receivedBytes: number, totalBytes: number) => void
  fileName: string
}): Promise<void> {
  const { fetchImpl, url, partPath, expectedSize, signal, onProgress, fileName } = args
  let resumeFrom = args.resumeFrom

  const doFetch = async (rangeFrom: number): Promise<Response> => {
    if (signal?.aborted) {
      throw new WhisperDownloadError("aborted", `aborted before fetch (${fileName})`)
    }
    const headers: Record<string, string> = rangeFrom > 0 ? { Range: `bytes=${rangeFrom}-` } : {}
    try {
      return await fetchImpl(url, { headers, redirect: "manual", signal })
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        throw new WhisperDownloadError("aborted", `download aborted (${fileName})`)
      }
      throw new WhisperDownloadError(
        "network-error",
        `network error (${fileName}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  let appendAt = resumeFrom
  let res = await doFetch(resumeFrom)
  if (resumeFrom > 0 && res.status === 416) {
    await rm(partPath, { force: true })
    appendAt = 0
    res = await doFetch(0)
  }
  const okStatus = appendAt > 0 ? 206 : 200
  if (res.status === 0 || (res.status >= 300 && res.status < 400)) {
    throw new WhisperDownloadError("http-error", `redirect denied (${fileName}, HTTP ${res.status}): ${url}`)
  }
  if (res.status !== okStatus) {
    if (appendAt > 0 && res.status === 200) {
      appendAt = 0
    } else {
      throw new WhisperDownloadError("http-error", `HTTP ${res.status} (${fileName}): ${url}`)
    }
  }
  if (!res.body) {
    throw new WhisperDownloadError("network-error", `empty body (${fileName})`)
  }

  const contentLength = Number(res.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > 0 && appendAt + contentLength > expectedSize) {
    throw new WhisperDownloadError(
      "oversize-stream",
      `Content-Length oversize (${fileName}: ${contentLength}+${appendAt} > ${expectedSize})`,
    )
  }

  let received = appendAt
  const source = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream)
  source.on("data", (chunk: Buffer) => {
    received += chunk.byteLength
    onProgress?.(received, expectedSize)
    if (received > expectedSize) {
      source.destroy(
        new WhisperDownloadError(
          "oversize-stream",
          `stream oversize (${fileName}: ${received} > ${expectedSize})`,
        ),
      )
    }
  })
  try {
    await pipeline(source, createWriteStream(partPath, { flags: appendAt > 0 ? "a" : "w" }))
  } catch (err) {
    if (err instanceof WhisperDownloadError) throw err
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      throw new WhisperDownloadError("aborted", `download aborted mid-stream (${fileName})`)
    }
    throw new WhisperDownloadError(
      "network-error",
      `stream interrupted (${fileName}, received ${received}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
