// Qwen3-VL model download via Hugging Face snapshot (real host — not .invalid).
// Progress is best-effort (bytes of completed files); integrity is “config.json present”.

import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { DATA_DIR } from "../config"
import { logger } from "../logger"
import {
  qwenVlDirName,
  qwenVlMeta,
  type QwenVlVariant,
} from "./qwen-vl-catalog"

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

export function qwenModelDir(variant: QwenVlVariant, baseDir?: string): string {
  return path.join(baseDir ?? DATA_DIR, "models", qwenVlDirName(variant))
}

/** Lightweight readiness: HF snapshot always writes config.json. */
export function probeQwenModelDir(variant: QwenVlVariant, baseDir?: string): {
  status: "absent" | "ready" | "error"
  sizeBytes?: number
  error?: string
} {
  const dir = qwenModelDir(variant, baseDir)
  const configPath = path.join(dir, "config.json")
  if (!fs.existsSync(configPath)) {
    // Partial dir without config
    if (fs.existsSync(dir)) {
      try {
        const ents = fs.readdirSync(dir)
        if (ents.length > 0) return { status: "error", error: "model-file-missing" }
      } catch {
        /* ignore */
      }
    }
    return { status: "absent" }
  }
  let sizeBytes = 0
  const walk = (p: string) => {
    let st: fs.Stats
    try {
      st = fs.statSync(p)
    } catch {
      return
    }
    if (st.isFile()) sizeBytes += st.size
    else if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) walk(path.join(p, name))
    }
  }
  walk(dir)
  return { status: "ready", sizeBytes }
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
  // Prefer ~/.cmspark-agent/python-env when present (PEP 668 / GUI PATH).
  const venvPy =
    process.platform === "win32"
      ? path.join(DATA_DIR, "python-env", "Scripts", "python.exe")
      : path.join(DATA_DIR, "python-env", "bin", "python3")
  const pyCandidates =
    process.platform === "win32"
      ? [venvPy, "python", "py"]
      : [venvPy, "python3", "python"]
  let lastErr = ""
  for (const py of pyCandidates) {
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
          "下载结束但未找到 config.json——请检查网络、镜像源或 ModelScope 仓库是否可用",
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
