// Qwen3-VL environment preflight — what the Settings UI needs before
// "download → enable" so users are not dropped into opaque Python errors.

import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import { DATA_DIR } from "../config"
import * as path from "node:path"
import {
  migrateLegacyModelVariant,
  qwenVlMeta,
  type QwenVlVariant,
} from "./qwen-vl-catalog"
import { probeQwenModelDir, resolveModelRootDir } from "./qwen-vl-download"
import {
  buildInstallCommands,
  resolvePythonRuntime,
  uvInstallHint,
  type PythonMode,
} from "./python-runtime"

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

/** Checklist row for Settings UI (user-facing labels, no developer jargon first). */
export interface QwenVlRequirementItem {
  id: string
  category: "software" | "hardware" | "model"
  /** Short label shown in checklist */
  label: string
  ok: boolean
  /** Optional secondary explanation */
  detail?: string
  /** Highlight as blocking download/enable */
  blocking?: boolean
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
  /** Explicit checklist for UI: software / hardware / model */
  requirements: QwenVlRequirementItem[]
  /** Plain-language block reason when canDownload is false */
  downloadBlockReason?: string
  /** Plain-language block reason when canEnable is false but model may be on disk */
  enableBlockReason?: string
  /** Absolute models root directory (user-selectable) */
  modelRootDir: string
  /** isolated | system */
  pythonMode: PythonMode
  /** uv available (absolute path discovered) */
  uvAvailable: boolean
  /** Absolute uv path when discovered (W8) */
  uvPath?: string
  /** Server-driven platform install hint (W7 / N4) */
  uvInstallHint: string
  /** How Python was resolved (user-facing) */
  pythonResolution: string
  isolatedEnvExists: boolean
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
  const venvPy =
    process.platform === "win32"
      ? path.join(DATA_DIR, "python-env", "Scripts", "python.exe")
      : path.join(DATA_DIR, "python-env", "bin", "python3")
  const cands =
    process.platform === "win32"
      ? [venvPy, "python", "py"]
      : [venvPy, "python3", "python"]
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
  /** Override model root (absolute). Default: config.modelRootDir or DATA_DIR/models */
  modelRootDir?: string
  pythonMode?: PythonMode
  pythonPath?: string
}): Promise<QwenVlPreflight> {
  const variant = migrateLegacyModelVariant(args.variant)
  const meta = qwenVlMeta(variant)

  // Lazy import getConfig to avoid circular init in tests
  let cfgMode: PythonMode | undefined = args.pythonMode
  let cfgPyPath: string | undefined = args.pythonPath
  try {
    const { getConfig } = require("../config") as typeof import("../config")
    const c = getConfig().computer
    if (!cfgMode) cfgMode = c?.pythonMode === "system" ? "system" : "isolated"
    if (!cfgPyPath && typeof c?.pythonPath === "string") cfgPyPath = c.pythonPath
  } catch {
    cfgMode = cfgMode || "isolated"
  }

  const runtime = await resolvePythonRuntime({
    mode: cfgMode,
    systemPythonPath: cfgPyPath,
  })
  const py = {
    ok: Boolean(runtime.pythonPath),
    path: runtime.pythonPath,
  }
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
  const modelsRoot = resolveModelRootDir(args.modelRootDir ?? null)
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

  const probe = probeQwenModelDir(variant, modelsRoot)
  const modelReady = probe.status === "ready"
  const recommendedVariant = recommendVariant(hardware)
  const fit = variantFit(variant, hardware)

  const src = await resolveDownloadSource(args.downloadSource)

  const needHub =
    src.source === "modelscope" ? !deps.modelscope : !deps.huggingface_hub
  const needInfer = !deps.transformers || !deps.torch || !deps.pillow
  const diskTight =
    hardware.freeDiskGb != null && hardware.freeDiskGb < meta.downloadGb + 2

  // Isolated mode requires the managed venv to exist (not just any system python).
  const pythonEnvReady =
    runtime.mode === "system" ? deps.python === true : runtime.isolatedExists && deps.python === true
  // Product rule: never force-block download solely on RAM (user may still try),
  // but always surface hardware guidance. Disk critically short → block download.
  const canDownload = pythonEnvReady && !needHub && !diskTight
  const canEnable = modelReady && pythonEnvReady && !needInfer

  const nextSteps: string[] = []
  const installCommands: string[] = []
  let downloadBlockReason: string | undefined
  let enableBlockReason: string | undefined

  // --- Software install commands (copy-paste; prefer uv when available) ---
  if (!deps.python && runtime.mode === "system") {
    nextSteps.push(
      "本机未检测到可用的全局 Python。请安装 Python 3，或改选「CMspark 独立环境」并点「创建独立环境」。",
    )
    downloadBlockReason = "需要可用的 Python 环境才能下载本机视觉模型"
  } else if (!deps.python || (runtime.mode === "isolated" && !runtime.isolatedExists)) {
    const installUv = uvInstallHint()
    nextSteps.push(
      runtime.uvAvailable
        ? "推荐：点下方「创建独立环境」——将优先使用本机 uv 创建专用虚拟环境（不污染全局 Python）。"
        : `推荐：点下方「创建独立环境」创建专用虚拟环境；或安装 uv（${installUv}）后再创建，安装依赖更快。`,
    )
    downloadBlockReason = "请先创建 CMspark 独立 Python 环境，或切换为「使用全局 Python」"
  } else {
    const downloadPkgs: string[] = []
    if (src.source === "modelscope" && !deps.modelscope) downloadPkgs.push("modelscope")
    if (src.source !== "modelscope" && !deps.huggingface_hub) downloadPkgs.push("huggingface_hub")
    const inferPkgs: string[] = []
    if (!deps.transformers) inferPkgs.push("transformers")
    if (!deps.torch) inferPkgs.push("torch")
    if (!deps.pillow) inferPkgs.push("pillow")
    const allPkgs = [...new Set([...downloadPkgs, ...inferPkgs])]
    if (allPkgs.length) {
      const cmds = buildInstallCommands({
        mode: runtime.mode,
        uvAvailable: runtime.uvAvailable,
        uvPath: runtime.uvPath,
        packages: allPkgs,
        pythonPath: deps.pythonPath,
      })
      installCommands.push(...cmds)
      if (downloadPkgs.length) {
        nextSteps.push(
          "下载模型前，需准备「模型获取工具」。可点「安装缺失依赖」（优先 uv），或复制下方命令到终端。",
        )
        downloadBlockReason =
          "本机尚未准备好「模型下载组件」。请先安装缺失依赖（可用 uv / 独立环境），再点下载。"
      }
      if (inferPkgs.length) {
        nextSteps.push("启用实验层前，还需「本地推理组件」。可与下载组件一并安装。")
        if (modelReady) {
          enableBlockReason = "模型文件已在本机，但仍缺推理组件，无法开启。"
        }
      }
      for (const cmd of cmds) nextSteps.push(`终端：${cmd}`)
    }
  }

  nextSteps.push(`模型保存位置：${modelsRoot}（可在下方更改）`)
  nextSteps.push(
    `Python：${runtime.resolution}` +
      (runtime.uvAvailable ? " · 已检测到 uv" : " · 未检测到 uv（可选安装以加速）"),
  )

  if (diskTight) {
    nextSteps.push(
      `磁盘空间不足：当前规模约需 ${meta.downloadGb}GB（建议另留 2GB 余量），可用约 ${hardware.freeDiskGb}GB。请清理磁盘或改选更小规模后再下载。`,
    )
    downloadBlockReason =
      downloadBlockReason ||
      `磁盘空间不足（可用约 ${hardware.freeDiskGb}GB，当前规模约需 ${meta.downloadGb}+2 GB）`
  }

  if (fit === "insufficient") {
    nextSteps.push(
      `硬件偏紧：当前选「${meta.label}」建议内存 ≥${meta.minRamGb}GB` +
        (hardware.accelerator === "cuda" ? ` 或显存 ≥${meta.minVramGb}GB` : "（Apple 芯片看统一内存）") +
        `。你本机约 ${hardware.totalRamGb}GB。可改选 ${recommendedVariant.toUpperCase()}，或接受较慢/可能失败。`,
    )
  } else if (variant !== recommendedVariant) {
    nextSteps.push(
      `根据本机资源，更推荐规模 ${recommendedVariant.toUpperCase()}（当前 ${variant.toUpperCase()}）。更大模型更准但更吃内存。`,
    )
  }

  if (canDownload && !modelReady) {
    const srcLabel =
      src.source === "modelscope" ? "魔搭 ModelScope" : src.source === "hf-mirror" ? "HF 镜像" : "Hugging Face"
    nextSteps.push(`环境已满足下载条件。点「下载模型」（源：${srcLabel}）。体积约 ${meta.downloadGb}GB，请保持网络畅通。`)
  }
  if (modelReady && !canEnable && !enableBlockReason) {
    enableBlockReason = "模型已下载，但仍缺推理组件，暂不可开启"
    nextSteps.push(enableBlockReason)
  }
  if (canEnable) {
    nextSteps.push("点击「开启」实验层（可能需本机确认）；任务中每个建议点仍会二次确认。")
  }
  if (nextSteps.length === 0) {
    nextSteps.push("环境就绪。可下载或启用实验层。")
  }

  const requirements: QwenVlRequirementItem[] = [
    {
      id: "python",
      category: "software",
      label:
        runtime.mode === "isolated"
          ? "Python 环境（CMspark 独立环境）"
          : "Python 环境（本机全局）",
      ok: pythonEnvReady,
      detail: runtime.resolution + (deps.pythonPath ? ` · ${deps.pythonPath}` : ""),
      blocking: !pythonEnvReady,
    },
    {
      id: "uv",
      category: "software",
      label: "uv（可选，推荐）",
      ok: runtime.uvAvailable,
      detail: runtime.uvAvailable
        ? runtime.uvPath
          ? `已检测：创建/安装独立环境时将优先使用 uv · ${runtime.uvPath}`
          : "已检测：创建/安装独立环境时将优先使用 uv"
        : `未检测：仍可用 python -m venv；安装 uv 可加速（${uvInstallHint()}）`,
      blocking: false,
    },
    {
      id: "download-tools",
      category: "software",
      label: "模型下载组件",
      ok: deps.python && !needHub,
      detail: !deps.python
        ? "需先有 Python"
        : needHub
          ? src.source === "modelscope"
            ? "大陆源需要安装下载组件（见下方一键命令）"
            : "当前下载源需要安装下载组件（见下方一键命令）；也可改选「魔搭」"
          : src.source === "modelscope"
            ? "已就绪（魔搭源）"
            : "已就绪",
      blocking: needHub || !deps.python,
    },
    {
      id: "infer-tools",
      category: "software",
      label: "本地推理组件",
      ok: deps.python && !needInfer,
      detail: needInfer
        ? "开启实验层前需要（可与下载组件同一条 pip 命令安装）"
        : "已就绪",
      blocking: modelReady && needInfer,
    },
    {
      id: "disk",
      category: "hardware",
      label: `可用磁盘（约需 ${meta.downloadGb}+2 GB）`,
      ok: !diskTight,
      detail:
        hardware.freeDiskGb == null
          ? "未能探测磁盘，请自行确认空间充足"
          : `当前可用约 ${hardware.freeDiskGb}GB`,
      blocking: diskTight,
    },
    {
      id: "memory",
      category: "hardware",
      label: `内存建议 ≥${meta.minRamGb}GB（当前规模）`,
      ok: fit !== "insufficient",
      detail: `本机约 ${hardware.totalRamGb}GB · 加速：${hardware.accelerator}${
        hardware.vramGb != null ? ` · 显存 ${hardware.vramGb}GB` : ""
      } · 推荐规模 ${recommendedVariant.toUpperCase()}`,
      blocking: false,
    },
    {
      id: "weights",
      category: "model",
      label: "模型权重文件",
      ok: modelReady,
      detail: modelReady
        ? probe.sizeBytes
          ? `已在盘（约 ${(probe.sizeBytes / 1024 ** 3).toFixed(1)}GB）`
          : "已在盘"
        : "尚未下载或文件不完整",
      blocking: false,
    },
  ]

  let readinessSummary: string
  if (!deps.python) readinessSummary = "未就绪：请先安装 Python 3"
  else if (diskTight) readinessSummary = "未就绪：磁盘空间不足"
  else if (!canDownload && !modelReady) readinessSummary = "未就绪：请先安装「模型下载组件」（见下方清单与命令）"
  else if (modelReady && !canEnable) readinessSummary = "模型已下载，但仍缺「本地推理组件」，暂不可开启"
  else if (canEnable) readinessSummary = "就绪：可启用实验层"
  else if (canDownload) readinessSummary = "可下载：软件与磁盘已满足，请下载当前规模"
  else readinessSummary = "部分就绪：请按清单完成缺失项"

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
    requirements,
    ...(downloadBlockReason ? { downloadBlockReason } : {}),
    ...(enableBlockReason ? { enableBlockReason } : {}),
    modelRootDir: modelsRoot,
    pythonMode: runtime.mode,
    uvAvailable: runtime.uvAvailable,
    ...(runtime.uvPath ? { uvPath: runtime.uvPath } : {}),
    uvInstallHint: uvInstallHint(),
    pythonResolution: runtime.resolution,
    isolatedEnvExists: runtime.isolatedExists,
  }
}
