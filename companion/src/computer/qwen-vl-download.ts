// Qwen3-VL model download via Hugging Face snapshot (real host — not .invalid).
// Integrity: in-repo pinned sha256+size (#359). Never generate a manifest after download.

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { DATA_DIR, getConfig, setComputerModelFields } from "../config"
import { logger } from "../logger"
import {
  qwenVlDirName,
  qwenVlMeta,
  type QwenVlVariant,
} from "./qwen-vl-catalog"
import {
  getQwenVlPinnedFiles,
  loadQwenVlManifest,
  qwenVlWeightFiles,
  type QwenVlManifestFile,
} from "./qwen-vl-manifest"
import { findPythonBase, isolatedPythonBin } from "./python-runtime"

/** 1 MiB chunks — streaming sha256 of multi-GB safetensors without slurping RAM. */
const HASH_CHUNK = 1024 * 1024

/** Default models root: ~/.cmspark-agent/models (overridable via computer.modelRootDir). */
export function resolveModelRootDir(override?: string | null): string {
  const fromCfg =
    typeof override === "string" && override.trim()
      ? override.trim()
      : typeof getConfig().computer?.modelRootDir === "string"
        ? String(getConfig().computer!.modelRootDir).trim()
        : ""
  if (fromCfg && path.isAbsolute(fromCfg)) {
    return path.resolve(fromCfg)
  }
  return path.join(DATA_DIR, "models")
}

function isFilesystemRoot(abs: string): boolean {
  const n = path.resolve(abs)
  if (n === path.parse(n).root) return true
  if (n === "/" || n === "\\") return true
  if (/^[A-Za-z]:[\\/]?$/.test(n)) return true
  return false
}

/** Validate and normalize a user-chosen model root (absolute dir). */
export function validateModelRootDir(raw: string): { ok: true; path: string } | { ok: false; error: string } {
  const p = String(raw || "").trim()
  if (!p) return { ok: false, error: "路径不能为空" }
  if (!path.isAbsolute(p)) return { ok: false, error: "请选择绝对路径" }
  if (isFilesystemRoot(p)) {
    return { ok: false, error: "请选择具体的文件夹，不要选磁盘根目录" }
  }
  try {
    fs.mkdirSync(p, { recursive: true })
    const st = fs.statSync(p)
    if (!st.isDirectory()) return { ok: false, error: "路径不是文件夹" }
    const real = fs.realpathSync(p)
    if (isFilesystemRoot(real)) {
      return { ok: false, error: "路径解析后为磁盘根目录，请另选文件夹" }
    }
    return { ok: true, path: real }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export type QwenDownloadReason =
  | "network-error"
  | "python-missing"
  | "hf-hub-missing"
  | "modelscope-missing"
  | "download-failed"
  | "disk-full"

export type QwenDownloadSource = "huggingface" | "hf-mirror" | "modelscope"

export class QwenDownloadError extends Error {
  readonly reason: QwenDownloadReason
  constructor(reason: QwenDownloadReason, message: string) {
    super(message)
    this.name = "QwenDownloadError"
    this.reason = reason
  }
}

/**
 * @param modelRootOrDataDir — preferred: models root directory.
 *   Legacy callers may pass DATA_DIR; we detect and append "models".
 */
export function qwenModelDir(variant: QwenVlVariant, modelRootOrDataDir?: string): string {
  let root = modelRootOrDataDir
  if (!root) {
    root = resolveModelRootDir()
  } else if (path.basename(root) !== "models" && fs.existsSync(path.join(root, "models"))) {
    // legacy DATA_DIR pass-through
    root = path.join(root, "models")
  } else if (root === DATA_DIR || root.endsWith(`${path.sep}.cmspark-agent`)) {
    root = path.join(root, "models")
  }
  return path.join(root, qwenVlDirName(variant))
}

export type QwenProbeStatus = "absent" | "ready" | "error"

export interface QwenProbeResult {
  status: QwenProbeStatus
  sizeBytes?: number
  error?: string
}

function sha256FileStreamingSync(filePath: string): string {
  const hash = createHash("sha256")
  const fd = fs.openSync(filePath, "r")
  const buf = Buffer.alloc(HASH_CHUNK)
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null)
      if (n <= 0) break
      hash.update(buf.subarray(0, n))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest("hex")
}

/**
 * Integrity policy (#359):
 *   - Pins live in companion/assets/qwen-vl.manifest.json (release-committed).
 *   - Every pinned file, **including all *.safetensors weights**, is checked for
 *     size then streaming sha256. There is no stat-only shortcut.
 *   - 2B weights are ~4.26GB: hashing is seconds on SSD, run on settings /
 *     admission / worker-load (not per click).
 */
export function probeQwenPinnedFiles(
  dir: string,
  files: QwenVlManifestFile[],
): QwenProbeResult {
  const configPath = path.join(dir, "config.json")
  if (!fs.existsSync(dir)) return { status: "absent" }
  let ents: string[] = []
  try {
    ents = fs.readdirSync(dir)
  } catch {
    return { status: "absent" }
  }
  if (!fs.existsSync(configPath)) {
    return ents.length === 0
      ? { status: "absent" }
      : { status: "error", error: "model-file-missing" }
  }

  let sizeBytes = 0
  for (const f of files) {
    const destPath = path.join(dir, f.name)
    if (!fs.existsSync(destPath)) {
      return { status: "error", error: "model-file-missing" }
    }
    let st: fs.Stats
    try {
      st = fs.statSync(destPath)
    } catch {
      return { status: "error", error: "model-file-missing" }
    }
    if (!st.isFile() || st.size !== f.size) {
      return { status: "error", error: "size-mismatch" }
    }
    sizeBytes += st.size
    const digest = sha256FileStreamingSync(destPath)
    if (digest !== f.sha256) {
      return { status: "error", error: "sha256-mismatch" }
    }
  }
  return { status: "ready", sizeBytes }
}

export function probeQwenModelAt(dir: string, variant: QwenVlVariant): QwenProbeResult {
  let files: QwenVlManifestFile[]
  try {
    files = getQwenVlPinnedFiles(variant, loadQwenVlManifest())
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error && "code" in err ? String((err as { code: string }).code) : "manifest-invalid",
    }
  }
  if (qwenVlWeightFiles(files).length === 0) {
    return { status: "error", error: "manifest-invalid" }
  }
  return probeQwenPinnedFiles(dir, files)
}

/** Readiness against the release-pinned manifest (not “config.json exists”). */
export function probeQwenModelDir(variant: QwenVlVariant, baseDir?: string): QwenProbeResult {
  return probeQwenModelAt(qwenModelDir(variant, baseDir), variant)
}

/**
 * If the switch is on but pins fail (missing/mismatch), force modelEnabled=false.
 * `absent` (never downloaded) does not disarm — enable-path / empty-dir stay
 * the caller's problem; only a poisoned or partial tree must not stay armed.
 */
export function clearQwenModelEnabledOnIntegrityFailure(
  variant: QwenVlVariant,
  probe: QwenProbeResult,
): void {
  if (probe.status !== "error") return
  try {
    if (getConfig().computer?.modelEnabled === true) {
      setComputerModelFields({ modelEnabled: false })
      logger.warn("computer.model.qwen.disarmed_integrity", {
        variant,
        error: probe.error || probe.status,
      })
    }
  } catch {
    /* config unavailable in some unit tests */
  }
}

export function disarmQwenIfIntegrityFailed(variant: QwenVlVariant, baseDir?: string): QwenProbeResult {
  const probe = probeQwenModelDir(variant, baseDir)
  clearQwenModelEnabledOnIntegrityFailure(variant, probe)
  return probe
}

export interface DownloadQwenArgs {
  variant: QwenVlVariant
  /** Resolved source (not "auto") */
  source?: QwenDownloadSource
  /** Optional HF mirror endpoint, e.g. https://hf-mirror.com */
  hfEndpoint?: string
  onProgress?: (file: string, receivedBytes: number, totalBytes: number) => void
  /** Test seam */
  runPython?: (args: string[], env: NodeJS.ProcessEnv) => Promise<{ code: number; stderr: string }>
}

/** Unified downloader: argv = source, model_id, local_dir */
const DOWNLOAD_SCRIPT = `
import sys, json
source, model_id, local_dir = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({"event":"progress","file":"snapshot","receivedBytes":0,"totalBytes":1}), flush=True)
try:
    if source == "modelscope":
        try:
            from modelscope.hub.snapshot_download import snapshot_download as ms_dl
        except ImportError:
            try:
                from modelscope import snapshot_download as ms_dl
            except ImportError:
                print(json.dumps({"event":"error","reason":"modelscope-missing","message":"pip install modelscope"}), flush=True)
                sys.exit(2)
        path = ms_dl(model_id, local_dir=local_dir)
    else:
        try:
            from huggingface_hub import snapshot_download
        except ImportError:
            print(json.dumps({"event":"error","reason":"hf-hub-missing","message":"pip install huggingface_hub"}), flush=True)
            sys.exit(2)
        kwargs = dict(repo_id=model_id, local_dir=local_dir, resume_download=True)
        try:
            path = snapshot_download(**kwargs, local_dir_use_symlinks=False)
        except TypeError:
            path = snapshot_download(**kwargs)
    print(json.dumps({"event":"progress","file":"snapshot","receivedBytes":1,"totalBytes":1}), flush=True)
    print(json.dumps({"event":"done","path": str(path)}), flush=True)
except Exception as e:
    print(json.dumps({"event":"error","reason":"download-failed","message": str(e)}), flush=True)
    sys.exit(1)
`

function defaultRunPython(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(args[0]!, args.slice(1), {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let stderr = ""
    let stdout = ""
    child.stdout?.on("data", (b: Buffer) => {
      stdout += b.toString("utf8")
    })
    child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString("utf8")
    })
    child.on("error", (err) => {
      resolve({ code: 127, stderr: String(err.message || err) + "\n" + stderr })
    })
    child.on("close", (code) => {
      // Attach stdout to stderr channel for caller parsing when needed
      resolve({ code: code ?? 1, stderr: stdout + (stderr ? "\n" + stderr : "") })
    })
  })
}

/**
 * Download a Qwen3-VL variant into DATA_DIR/models/qwen3-vl-<variant>/.
 * Sources: huggingface | hf-mirror (HF_ENDPOINT) | modelscope.
 */
export async function downloadQwenVlVariant(args: DownloadQwenArgs): Promise<{ dir: string }> {
  const meta = qwenVlMeta(args.variant)
  const dir = qwenModelDir(args.variant)
  fs.mkdirSync(dir, { recursive: true })

  const source: QwenDownloadSource = args.source ?? "huggingface"
  const modelId = source === "modelscope" ? meta.modelscopeId : meta.hfRepo

  const env: NodeJS.ProcessEnv = { ...process.env }
  if (source === "hf-mirror") {
    env.HF_ENDPOINT = (args.hfEndpoint || "https://hf-mirror.com").replace(/\/$/, "")
  } else if (args.hfEndpoint) {
    env.HF_ENDPOINT = args.hfEndpoint.replace(/\/$/, "")
  }

  const run = args.runPython ?? defaultRunPython
  // Adversary B3: isolated mode MUST NOT fall back to PATH/system python.
  // PY1 / C7: final argv0 must be absolute — never bare python/py.
  const cfg = getConfig().computer
  const mode = cfg?.pythonMode === "system" ? "system" : "isolated"
  const iso = isolatedPythonBin()
  const sysPath = typeof cfg?.pythonPath === "string" ? cfg.pythonPath.trim() : ""
  const pyCandidates: string[] = []
  if (mode === "system") {
    if (sysPath && path.isAbsolute(sysPath)) pyCandidates.push(sysPath)
    const base = await findPythonBase({
      configPath: sysPath && path.isAbsolute(sysPath) ? sysPath : undefined,
      includeIsolated: false,
    })
    if (base.ok && path.isAbsolute(base.path) && !pyCandidates.includes(base.path)) {
      pyCandidates.push(base.path)
    }
  } else if (fs.existsSync(iso) && path.isAbsolute(iso)) {
    pyCandidates.push(iso)
  }
  // Absolute-only filter (G1)
  const absoluteCandidates = pyCandidates.filter((p) => path.isAbsolute(p))
  if (absoluteCandidates.length === 0) {
    throw new QwenDownloadError(
      "python-missing",
      mode === "isolated"
        ? "独立环境尚未创建。请在设置页点「创建独立环境」后再下载。"
        : "未找到可用的全局 Python（绝对路径）。请安装 Python 3 或选择解释器路径。",
    )
  }
  let lastErr = ""
  for (const py of absoluteCandidates) {
    const result = await run([py, "-c", DOWNLOAD_SCRIPT, source, modelId, dir], env)
    for (const line of result.stderr.split("\n")) {
      const t = line.trim()
      if (!t.startsWith("{")) continue
      try {
        const ev = JSON.parse(t) as {
          event?: string
          file?: string
          receivedBytes?: number
          totalBytes?: number
          reason?: string
          message?: string
        }
        if (ev.event === "progress" && args.onProgress) {
          args.onProgress(
            ev.file || "snapshot",
            Number(ev.receivedBytes) || 0,
            Number(ev.totalBytes) || 1,
          )
        }
        if (ev.event === "error") {
          if (ev.reason === "hf-hub-missing") {
            throw new QwenDownloadError(
              "hf-hub-missing",
              "缺少 huggingface_hub：请执行 pip install huggingface_hub 后重试",
            )
          }
          if (ev.reason === "modelscope-missing") {
            throw new QwenDownloadError(
              "modelscope-missing",
              "缺少 modelscope：请执行 pip install modelscope 后重试（中国大陆推荐）",
            )
          }
          throw new QwenDownloadError("download-failed", ev.message || "模型下载失败")
        }
      } catch (e) {
        if (e instanceof QwenDownloadError) throw e
      }
    }
    if (result.code === 0) {
      const probe = probeQwenModelDir(args.variant)
      if (probe.status !== "ready") {
        throw new QwenDownloadError(
          "download-failed",
          `下载结束但完整性校验失败（${probe.error || probe.status}）——请换源重下，勿使用被改动的权重`,
        )
      }
      logger.info("computer.model.qwen.download.completed", {
        variant: args.variant,
        source,
        modelId,
        sizeBytes: probe.sizeBytes,
      })
      return { dir }
    }
    lastErr = result.stderr
    if (result.code === 127 || /not found|ENOENT/i.test(result.stderr)) continue
    if (/modelscope|No module named 'modelscope'/i.test(result.stderr)) {
      throw new QwenDownloadError(
        "modelscope-missing",
        "缺少 modelscope：请执行 pip install modelscope 后重试",
      )
    }
    if (/huggingface_hub|No module named/i.test(result.stderr)) {
      throw new QwenDownloadError(
        "hf-hub-missing",
        "缺少 huggingface_hub：请执行 pip install huggingface_hub 后重试",
      )
    }
    throw new QwenDownloadError(
      "download-failed",
      `Qwen3-VL 下载失败（source=${source}, exit ${result.code}）：${lastErr.slice(-400)}`,
    )
  }
  throw new QwenDownloadError(
    "python-missing",
    "未找到 Python 3。请先安装 python3，再 pip install transformers torch pillow 以及 huggingface_hub 或 modelscope",
  )
}

export async function deleteQwenVlVariant(variant: QwenVlVariant): Promise<{ removedBytes: number }> {
  const dir = qwenModelDir(variant)
  let removedBytes = 0
  const walk = (p: string) => {
    if (!fs.existsSync(p)) return
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) walk(path.join(p, name))
      fs.rmdirSync(p)
    } else {
      removedBytes += st.size
      fs.unlinkSync(p)
    }
  }
  walk(dir)
  return { removedBytes }
}
