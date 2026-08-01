// Qwen3-VL environment preflight — what the Settings UI needs before
// "download → enable" so users are not dropped into opaque Python errors.

import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  migrateLegacyModelVariant,
  qwenVlMeta,
  type QwenVlVariant,
} from "./qwen-vl-catalog"
import { probeQwenModelDir } from "./qwen-vl-download"

export type DownloadSource = "auto" | "huggingface" | "hf-mirror" | "modelscope"

export interface QwenVlDepStatus {
  python: boolean
  pythonPath?: string
  huggingface_hub: boolean
  modelscope: boolean
  transformers: boolean
  torch: boolean
  pillow: boolean
}

export interface QwenVlHardware {
  platform: string
  totalRamGb: number
  freeRamGb: number
  freeDiskGb: number | null
  /** Best-effort: cuda | mps | cpu | unknown */
  accelerator: "cuda" | "mps" | "cpu" | "unknown"
  /** Discrete VRAM GB if detected; Apple unified memory → null (use totalRamGb) */
  vramGb: number | null
  notes: string[]
}

export interface QwenVlPreflight {
  deps: QwenVlDepStatus
  hardware: QwenVlHardware
  /** Suggested variant given hardware (never forces; UI may still pick larger) */
  recommendedVariant: QwenVlVariant
  /** Selected / current variant fit: ok | tight | insufficient */
  variantFit: "ok" | "tight" | "insufficient"
  modelReady: boolean
  modelSizeBytes?: number
  /** Can start HF/ModelScope download (python + hub package) */
  canDownload: boolean
  /** Can turn modelEnabled on with a chance of prepare() succeeding */
  canEnable: boolean
  /** Ordered user-facing next actions (Chinese) */
  nextSteps: string[]
  /** One-line readiness summary */
  readinessSummary: string
  installCommands: string[]
  downloadSourceResolved: "huggingface" | "hf-mirror" | "modelscope"
  downloadSourceReason: string
}

function runCapture(bin: string, args: string[], timeoutMs = 12_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env })
    let out = ""
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        /* ignore */
      }
      resolve({ code: 124, out })
    }, timeoutMs)
    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString("utf8")
    })
    child.stderr?.on("data", (b: Buffer) => {
      out += b.toString("utf8")
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve({ code: 127, out })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, out })
    })
  })
}

async function findPython(): Promise<{ ok: boolean; path?: string }> {
  const cands = process.platform === "win32" ? ["python", "py"] : ["python3", "python"]
  for (const c of cands) {
    const r = await runCapture(c, ["-c", "import sys; print(sys.executable)"])
    if (r.code === 0 && r.out.trim()) return { ok: true, path: r.out.trim().split("\n")[0]!.trim() }
  }
  return { ok: false }
}

async function probePythonDeps(pythonPath: string): Promise<Omit<QwenVlDepStatus, "python" | "pythonPath">> {
  const script = `
import json
def has(m):
    try:
        __import__(m)
        return True
    except Exception:
        return False
print(json.dumps({
  "huggingface_hub": has("huggingface_hub"),
  "modelscope": has("modelscope"),
  "transformers": has("transformers"),
  "torch": has("torch"),
  "pillow": has("PIL"),
}))
`
  const r = await runCapture(pythonPath, ["-c", script])
  if (r.code !== 0) {
    return {
      huggingface_hub: false,
      modelscope: false,
      transformers: false,
      torch: false,
      pillow: false,
    }
  }
  try {
    const line = r.out.trim().split("\n").filter(Boolean).pop()!
    return JSON.parse(line)
  } catch {
    return {
      huggingface_hub: false,
      modelscope: false,
      transformers: false,
      torch: false,
      pillow: false,
    }
  }
}

async function probeAccelerator(pythonPath: string | undefined): Promise<{
  accelerator: QwenVlHardware["accelerator"]
  vramGb: number | null
  notes: string[]
}> {
  const notes: string[] = []
  // nvidia-smi
  const smi = await runCapture("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"], 5_000)
  if (smi.code === 0) {
    const mb = parseFloat(smi.out.trim().split("\n")[0] || "")
    if (Number.isFinite(mb) && mb > 0) {
      return { accelerator: "cuda", vramGb: Math.round((mb / 1024) * 10) / 10, notes: ["检测到 NVIDIA GPU（nvidia-smi）"] }
    }
  }
  if (pythonPath) {
    const r = await runCapture(
      pythonPath,
      [
        "-c",
        `import json
acc="cpu"; vram=None; notes=[]
try:
  import torch
  if torch.cuda.is_available():
    acc="cuda"
    try:
      vram=round(torch.cuda.get_device_properties(0).total_memory/1024**3,1)
    except Exception:
      pass
    notes.append("torch.cuda available")
  elif getattr(torch.backends,"mps",None) and torch.backends.mps.is_available():
    acc="mps"
    notes.append("Apple MPS available (unified memory)")
except Exception as e:
  notes.append("torch probe failed: "+str(e)[:80])
print(json.dumps({"acc":acc,"vram":vram,"notes":notes}))
`,
      ],
      15_000,
    )
    if (r.code === 0) {
      try {
        const line = r.out.trim().split("\n").filter(Boolean).pop()!
        const j = JSON.parse(line) as { acc: string; vram: number | null; notes: string[] }
        notes.push(...(j.notes || []))
        return {
          accelerator: (j.acc as QwenVlHardware["accelerator"]) || "unknown",
          vramGb: typeof j.vram === "number" ? j.vram : null,
          notes,
        }
      } catch {
        /* fall through */
      }
    }
  }
  if (process.platform === "darwin") {
    notes.push("macOS：未确认 MPS/CUDA，将按 CPU/统一内存估算")
    return { accelerator: "unknown", vramGb: null, notes }
  }
  notes.push("未检测到 GPU，将按 CPU 估算")
  return { accelerator: "cpu", vramGb: null, notes }
}

function freeDiskGb(dir: string): number | null {
  try {
    // Node 18.15+ statfsSync
    const st = (fs as any).statfsSync?.(dir) as { bavail?: number; bsize?: number } | undefined
    if (st && st.bavail && st.bsize) {
      return Math.round(((st.bavail * st.bsize) / 1024 ** 3) * 10) / 10
    }
  } catch {
    /* ignore */
  }
  return null
}

function recommendVariant(hw: QwenVlHardware): QwenVlVariant {
  const budget =
    hw.accelerator === "cuda" && hw.vramGb != null
      ? hw.vramGb
      : hw.totalRamGb // unified / CPU path
  // Prefer headroom: recommend only if budget comfortably above min
  if (budget >= 28) return "8b"
  if (budget >= 16) return "4b"
  return "2b"
}

function variantFit(variant: QwenVlVariant, hw: QwenVlHardware): "ok" | "tight" | "insufficient" {
  const meta = qwenVlMeta(variant)
  const budget =
    hw.accelerator === "cuda" && hw.vramGb != null ? hw.vramGb : hw.totalRamGb
  const need = hw.accelerator === "cuda" && hw.vramGb != null ? meta.minVramGb : meta.minRamGb
  if (budget >= need) return "ok"
  if (budget >= need * 0.7) return "tight"
  return "insufficient"
}

/**
 * Connectivity-based source resolution (no IP geolocation DB).
 * Prefer ModelScope when HF is unreachable / slow; honor explicit choice.
 */
export async function resolveDownloadSource(
  preferred: DownloadSource | undefined,
): Promise<{ source: "huggingface" | "hf-mirror" | "modelscope"; reason: string }> {
  if (preferred === "huggingface") return { source: "huggingface", reason: "用户指定 Hugging Face" }
  if (preferred === "hf-mirror") return { source: "hf-mirror", reason: "用户指定 HF 镜像（hf-mirror.com）" }
  if (preferred === "modelscope") return { source: "modelscope", reason: "用户指定 ModelScope 魔搭" }

  // auto: env wins
  if (process.env.CMSPARK_MODEL_SOURCE === "modelscope") {
    return { source: "modelscope", reason: "环境变量 CMSPARK_MODEL_SOURCE=modelscope" }
  }
  if (process.env.HF_ENDPOINT && /hf-mirror|mirror/i.test(process.env.HF_ENDPOINT)) {
    return { source: "hf-mirror", reason: "检测到 HF_ENDPOINT 镜像" }
  }

  // Probe HF vs ModelScope (HEAD, short timeout)
  const probe = async (url: string): Promise<boolean> => {
    try {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 2500)
      const res = await fetch(url, { method: "HEAD", signal: ac.signal, redirect: "follow" })
      clearTimeout(t)
      return res.ok || res.status === 405 || res.status === 403 // reachable enough
    } catch {
      return false
    }
  }

  const [hfOk, msOk] = await Promise.all([
    probe("https://huggingface.co"),
    probe("https://www.modelscope.cn"),
  ])

  if (!hfOk && msOk) {
    return { source: "modelscope", reason: "Hugging Face 不可达，自动改用 ModelScope（常见于中国大陆网络）" }
  }
  if (hfOk) {
    // locale hint: still offer mirror tip in UI, default HF when reachable
    const lang = (process.env.LANG || process.env.LC_ALL || "").toLowerCase()
    if (lang.includes("zh_cn") || lang.includes("zh-cn")) {
      // Prefer modelscope for zh_CN even if HF works (often flaky)
      if (msOk) {
        return { source: "modelscope", reason: "系统语言为中文且 ModelScope 可达，默认走魔搭更稳" }
      }
      return { source: "hf-mirror", reason: "系统语言为中文；HF 可达但建议镜像（当前 ModelScope 不可达则用 hf-mirror 提示）" }
    }
    return { source: "huggingface", reason: "Hugging Face 可达" }
  }
  if (msOk) return { source: "modelscope", reason: "仅 ModelScope 可达" }
  // both failed — still default modelscope for CN likelihood, or hf with honest fail later
  return { source: "modelscope", reason: "两源探测均失败，默认 ModelScope（下载时再报错）" }
}

export async function runQwenVlPreflight(args: {
  variant?: string
  downloadSource?: DownloadSource
  dataDir?: string
}): Promise<QwenVlPreflight> {
  const variant = migrateLegacyModelVariant(args.variant)
  const meta = qwenVlMeta(variant)

  const py = await findPython()
  const depExtras = py.ok && py.path ? await probePythonDeps(py.path) : {
    huggingface_hub: false,
    modelscope: false,
    transformers: false,
    torch: false,
    pillow: false,
  }
  const deps: QwenVlDepStatus = {
    python: py.ok,
    ...(py.path ? { pythonPath: py.path } : {}),
    ...depExtras,
  }

  const totalRamGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10
  const freeRamGb = Math.round((os.freemem() / 1024 ** 3) * 10) / 10
  const modelsRoot = path.join(args.dataDir || path.join(os.homedir(), ".cmspark-agent"), "models")
  try {
    fs.mkdirSync(modelsRoot, { recursive: true })
  } catch {
    /* ignore */
  }
  const acc = await probeAccelerator(py.path)
  const hardware: QwenVlHardware = {
    platform: `${process.platform}/${process.arch}`,
    totalRamGb,
    freeRamGb,
    freeDiskGb: freeDiskGb(modelsRoot),
    accelerator: acc.accelerator,
    vramGb: acc.vramGb,
    notes: acc.notes,
  }

  const probe = probeQwenModelDir(variant, args.dataDir)
  const modelReady = probe.status === "ready"
  const recommendedVariant = recommendVariant(hardware)
  const fit = variantFit(variant, hardware)

  const src = await resolveDownloadSource(args.downloadSource)

  const needHub =
    src.source === "modelscope" ? !deps.modelscope : !deps.huggingface_hub
  const needInfer = !deps.transformers || !deps.torch || !deps.pillow

  const canDownload = deps.python && !needHub
  const canEnable = modelReady && deps.python && !needInfer

  const nextSteps: string[] = []
  const installCommands: string[] = []

  if (!deps.python) {
    nextSteps.push("安装 Python 3（macOS: brew install python3；Windows: python.org 安装并勾选 PATH）")
  } else {
    const pkgs: string[] = []
    if (src.source === "modelscope" && !deps.modelscope) pkgs.push("modelscope")
    if (src.source !== "modelscope" && !deps.huggingface_hub) pkgs.push("huggingface_hub")
    if (!deps.transformers) pkgs.push("transformers")
    if (!deps.torch) pkgs.push("torch")
    if (!deps.pillow) pkgs.push("pillow")
    if (pkgs.length) {
      const cmd = `pip install ${pkgs.join(" ")}`
      installCommands.push(cmd)
      nextSteps.push(`安装推理/下载依赖：在终端执行 \`${cmd}\``)
    }
  }

  if (hardware.freeDiskGb != null && hardware.freeDiskGb < meta.downloadGb + 2) {
    nextSteps.push(
      `磁盘空间可能不足：当前变体约需 ${meta.downloadGb}GB，可用约 ${hardware.freeDiskGb}GB，请清理磁盘后再下载`,
    )
  }

  if (fit === "insufficient") {
    nextSteps.push(
      `当前机器对「${meta.label}」可能偏紧（建议内存≥${meta.minRamGb}GB` +
        (hardware.accelerator === "cuda" ? ` / 显存≥${meta.minVramGb}GB` : "") +
        `）。可改选 ${recommendedVariant.toUpperCase()} 或接受较慢/OOM 风险`,
    )
  } else if (variant !== recommendedVariant) {
    nextSteps.push(`根据本机资源，更推荐 ${recommendedVariant.toUpperCase()}（当前选择 ${variant.toUpperCase()}）`)
  }

  if (canDownload && !modelReady) {
    nextSteps.push(`在设置页点击「下载模型」（源：${src.source === "modelscope" ? "ModelScope 魔搭" : src.source === "hf-mirror" ? "HF 镜像" : "Hugging Face"}）`)
  }
  if (modelReady && !canEnable) {
    nextSteps.push("权重已在盘，但仍缺推理依赖——安装 transformers/torch/pillow 后即可开启")
  }
  if (canEnable) {
    nextSteps.push("点击「开启」实验层（可能需生物识别确认）；任务中每个建议点仍会二次确认")
  }
  if (nextSteps.length === 0) {
    nextSteps.push("环境就绪。可下载或启用实验层。")
  }

  let readinessSummary: string
  if (!deps.python) readinessSummary = "未就绪：缺少 Python 3"
  else if (!canDownload && !modelReady) readinessSummary = "未就绪：缺少下载依赖"
  else if (modelReady && !canEnable) readinessSummary = "模型已下载，但推理依赖未齐"
  else if (canEnable) readinessSummary = "就绪：可启用实验层"
  else if (canDownload) readinessSummary = "可下载：依赖基本齐，请下载当前变体"
  else readinessSummary = "部分就绪"

  return {
    deps,
    hardware,
    recommendedVariant,
    variantFit: fit,
    modelReady,
    ...(probe.sizeBytes != null ? { modelSizeBytes: probe.sizeBytes } : {}),
    canDownload,
    canEnable,
    nextSteps,
    readinessSummary,
    installCommands,
    downloadSourceResolved: src.source,
    downloadSourceReason: src.reason,
  }
}
