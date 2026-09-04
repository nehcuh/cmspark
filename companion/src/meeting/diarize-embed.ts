/**
 * #260 — speaker-embedding runtime for diarize (ONNX, local-only inference).
 * Pipeline per segment: fbank (80-dim log-mel, pure TS) → utterance CMN →
 * onnxruntime-node → 192-dim embedding. Audio never leaves this machine.
 *
 * Model readiness gates first: absent/incomplete model → embedding_model_required
 * (UI guides to settings download; never silently falls back to the legacy
 * 3-feature engine). Native runtime missing → diarize_runtime_unavailable.
 */

import { diarizeModelDestDir, probeDiarizeModel, DIARIZE_MODEL_ID } from "../voice/diarize-model"
import { getDiarizeModelFiles, type DiarizeManifest } from "../voice/diarize-manifest"
import { cmnOverTime, computeFbank, FBANK_NUM_BINS } from "./fbank"

export const DIARIZE_EMBEDDING_DIM = 192

export type EmbedProgress = { done: number; total: number }

export type EmbedSegmentsResult =
  | { ok: true; embeddings: number[][] }
  | { ok: false; code: "embedding_model_required" | "diarize_runtime_unavailable"; message: string }

/** Structural slice of onnxruntime-node used here (test seam friendly). */
export type OrtSessionLike = {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: ArrayLike<number> }>>
}

export type OrtLike = {
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => unknown
  InferenceSession: { create: (modelPath: string) => Promise<OrtSessionLike> }
}

// --- lazy native runtime load ---------------------------------------------------

let ortCached: OrtLike | null | undefined

/** Plain require first (dev/dist node_modules), then executable-dir resolver (packaged single-file, systray2 precedent). */
export function loadOrtRuntime(): OrtLike | null {
  if (ortCached !== undefined) return ortCached
  ortCached = null
  try {
    ortCached = require("onnxruntime-node") as OrtLike
    return ortCached
  } catch {
    /* fall through */
  }
  try {
    const { createRequire } = require("node:module") as typeof import("node:module")
    const req = createRequire(process.execPath)
    ortCached = req("onnxruntime-node") as OrtLike
  } catch {
    ortCached = null
  }
  return ortCached
}

/** Test seam: drop cached ort module handle. */
export function __resetOrtCacheForTests(): void {
  ortCached = undefined
  sessionCache.clear()
}

// --- session cache ---------------------------------------------------------------

const sessionCache = new Map<string, Promise<OrtSessionLike>>()

async function getSession(modelPath: string, ort: OrtLike): Promise<OrtSessionLike> {
  const existing = sessionCache.get(modelPath)
  if (existing) return existing
  const p = ort.InferenceSession.create(modelPath)
  sessionCache.set(modelPath, p)
  try {
    return await p
  } catch (e) {
    sessionCache.delete(modelPath)
    throw e
  }
}

// --- embed ------------------------------------------------------------------------

export async function embedSegmentsForDiarize(
  pcm: Float32Array[],
  opts: {
    onProgress?: (p: EmbedProgress) => void
    /** Test seam: inject a fake onnxruntime. */
    ort?: OrtLike
    modelRootDir?: string
    manifest?: DiarizeManifest
  } = {},
): Promise<EmbedSegmentsResult> {
  const probe = probeDiarizeModel(opts.modelRootDir, opts.manifest)
  if (probe.status !== "ready") {
    return {
      ok: false,
      code: "embedding_model_required",
      message: `说话人模型未就绪（${probe.status}${probe.error ? ` · ${probe.error}` : ""}）：请到 设置 → 听写方式 下载「说话人分离模型」后重试`,
    }
  }

  const ort = opts.ort ?? loadOrtRuntime()
  if (!ort) {
    return {
      ok: false,
      code: "diarize_runtime_unavailable",
      message: "本机缺少 onnxruntime 原生运行时（onnxruntime-node），无法进行本地说话人嵌入推理",
    }
  }

  let files
  try {
    files = getDiarizeModelFiles(DIARIZE_MODEL_ID, opts.manifest)
  } catch {
    return {
      ok: false,
      code: "embedding_model_required",
      message: "说话人模型清单缺失（diarize-models.manifest.json）",
    }
  }
  const modelPath = `${diarizeModelDestDir(DIARIZE_MODEL_ID, opts.modelRootDir)}/${files[0]!.name}`

  let session: OrtSessionLike
  try {
    session = await getSession(modelPath, ort)
  } catch (e) {
    return {
      ok: false,
      code: "diarize_runtime_unavailable",
      message: `说话人模型加载失败：${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  if (!inputName || !outputName) {
    return {
      ok: false,
      code: "diarize_runtime_unavailable",
      message: "说话人模型输入/输出名缺失（非常规 ONNX 导出）",
    }
  }

  const embeddings: number[][] = []
  for (let i = 0; i < pcm.length; i++) {
    const seg = pcm[i] ?? new Float32Array(0)
    if (seg.length === 0) {
      embeddings.push(new Array<number>(DIARIZE_EMBEDDING_DIM).fill(0))
      opts.onProgress?.({ done: i + 1, total: pcm.length })
      continue
    }
    const rows = cmnOverTime(computeFbank(seg))
    const frames = rows.length
    const flat = new Float32Array(frames * FBANK_NUM_BINS)
    for (let f = 0; f < frames; f++) {
      flat.set(rows[f]!, f * FBANK_NUM_BINS)
    }
    let out: Record<string, { data: ArrayLike<number> }>
    try {
      out = await session.run({
        [inputName]: new ort.Tensor("float32", flat, [1, frames, FBANK_NUM_BINS]),
      })
    } catch (e) {
      return {
        ok: false,
        code: "diarize_runtime_unavailable",
        message: `说话人嵌入推理失败（段 ${i}）：${e instanceof Error ? e.message : String(e)}`,
      }
    }
    const raw = out[outputName]?.data
    if (!raw || raw.length !== DIARIZE_EMBEDDING_DIM) {
      return {
        ok: false,
        code: "diarize_runtime_unavailable",
        message: `说话人模型输出维度异常（期望 ${DIARIZE_EMBEDDING_DIM}，得到 ${raw ? raw.length : 0}）`,
      }
    }
    embeddings.push(Array.from(raw))
    opts.onProgress?.({ done: i + 1, total: pcm.length })
  }
  return { ok: true, embeddings }
}
