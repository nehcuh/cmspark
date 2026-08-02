// Python runtime resolution for Qwen3-VL experimental layer.
// Product rules:
//   - Prefer `uv` when available for creating/installing isolated envs
//   - User chooses isolated (CMspark-managed venv) vs system (global) Python
//   - Paths and install commands are user-facing; package names only in commands

import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { DATA_DIR } from "../config"

export type PythonMode = "isolated" | "system"

/** Fixed allowlist for ensure_python_env / install_deps (adversary B4). */
export const ALLOWED_PYTHON_PACKAGES = new Set([
  "modelscope",
  "huggingface_hub",
  "transformers",
  "torch",
  "pillow",
  "accelerate",
  "safetensors",
  "numpy",
  "tokenizers",
  "sentencepiece",
])

/**
 * Sanitize client-supplied package list: only bare allowlisted names.
 * Rejects flags (-*), URLs, paths, git refs.
 */
export function sanitizePythonPackages(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return ["modelscope", "huggingface_hub", "transformers", "torch", "pillow"]
  }
  const out: string[] = []
  for (const item of raw) {
    const s = String(item || "").trim()
    if (!s) continue
    if (s.startsWith("-")) continue
    if (/[/:\\@\s]/.test(s) || s.includes("://")) continue
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s)) continue
    const base = s.split("[")[0]!.toLowerCase() // strip extras like package[extra]
    if (!ALLOWED_PYTHON_PACKAGES.has(base) && !ALLOWED_PYTHON_PACKAGES.has(s.toLowerCase())) continue
    out.push(base)
  }
  return out.length > 0
    ? [...new Set(out)]
    : ["modelscope", "huggingface_hub", "transformers", "torch", "pillow"]
}

export interface PythonRuntimeInfo {
  mode: PythonMode
  /** Resolved interpreter path if available */
  pythonPath?: string
  /** Whether `uv` is on PATH */
  uvAvailable: boolean
  uvPath?: string
  /** Isolated venv root (DATA_DIR/python-env) */
  isolatedRoot: string
  isolatedExists: boolean
  /** How python was chosen (for UI) */
  resolution: string
}

function runCapture(
  bin: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env })
    let out = ""
    let err = ""
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        /* ignore */
      }
      resolve({ code: 124, out, err })
    }, timeoutMs)
    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString("utf8")
    })
    child.stderr?.on("data", (b: Buffer) => {
      err += b.toString("utf8")
    })
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({ code: 127, out, err: String(e.message || e) })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, out, err })
    })
  })
}

export function isolatedPythonRoot(): string {
  return path.join(DATA_DIR, "python-env")
}

export function isolatedPythonBin(): string {
  return process.platform === "win32"
    ? path.join(isolatedPythonRoot(), "Scripts", "python.exe")
    : path.join(isolatedPythonRoot(), "bin", "python3")
}

export function isolatedPipBin(): string {
  return process.platform === "win32"
    ? path.join(isolatedPythonRoot(), "Scripts", "pip.exe")
    : path.join(isolatedPythonRoot(), "bin", "pip")
}

export async function findUv(): Promise<{ ok: boolean; path?: string }> {
  const r = await runCapture(process.platform === "win32" ? "where" : "which", ["uv"], 5_000)
  if (r.code === 0) {
    const p = r.out.trim().split(/\r?\n/)[0]?.trim()
    if (p) return { ok: true, path: p }
  }
  // try bare spawn
  const r2 = await runCapture("uv", ["--version"], 5_000)
  if (r2.code === 0) return { ok: true, path: "uv" }
  return { ok: false }
}

async function probePythonBin(bin: string): Promise<string | null> {
  const r = await runCapture(bin, ["-c", "import sys; print(sys.executable)"], 8_000)
  if (r.code === 0 && r.out.trim()) return r.out.trim().split(/\r?\n/)[0]!.trim()
  return null
}

/**
 * Resolve which Python interpreter Companion should use for download/infer.
 */
export async function resolvePythonRuntime(opts: {
  mode?: PythonMode
  /** Explicit system python path when mode=system */
  systemPythonPath?: string
  preferUv?: boolean
}): Promise<PythonRuntimeInfo> {
  const mode: PythonMode = opts.mode === "system" ? "system" : "isolated"
  const root = isolatedPythonRoot()
  const isoBin = isolatedPythonBin()
  const isolatedExists = fs.existsSync(isoBin)
  const uv = await findUv()

  if (mode === "system") {
    const cands = [
      ...(opts.systemPythonPath ? [opts.systemPythonPath] : []),
      ...(process.platform === "win32" ? ["python", "py"] : ["python3", "python"]),
    ]
    for (const c of cands) {
      const exe = await probePythonBin(c)
      if (exe) {
        return {
          mode: "system",
          pythonPath: exe,
          uvAvailable: uv.ok,
          ...(uv.path ? { uvPath: uv.path } : {}),
          isolatedRoot: root,
          isolatedExists,
          resolution: "使用本机全局 Python",
        }
      }
    }
    return {
      mode: "system",
      uvAvailable: uv.ok,
      ...(uv.path ? { uvPath: uv.path } : {}),
      isolatedRoot: root,
      isolatedExists,
      resolution: "已选全局 Python，但未在 PATH 中找到可用的 python3",
    }
  }

  // isolated
  if (isolatedExists) {
    const exe = await probePythonBin(isoBin)
    if (exe) {
      return {
        mode: "isolated",
        pythonPath: exe,
        uvAvailable: uv.ok,
        ...(uv.path ? { uvPath: uv.path } : {}),
        isolatedRoot: root,
        isolatedExists: true,
        resolution: uv.ok
          ? "使用 CMspark 独立环境（推荐；本机已检测到 uv，安装依赖时可优先用 uv）"
          : "使用 CMspark 独立环境（推荐）",
      }
    }
  }

  // Isolated missing: do NOT return system python as pythonPath (would pollute dep probes).
  const basePy =
    (await probePythonBin("python3")) ||
    (await probePythonBin("python")) ||
    (process.platform === "win32" ? await probePythonBin("py") : null)

  return {
    mode: "isolated",
    // intentionally omit pythonPath until venv exists
    uvAvailable: uv.ok,
    ...(uv.path ? { uvPath: uv.path } : {}),
    isolatedRoot: root,
    isolatedExists: false,
    resolution: basePy
      ? "独立环境尚未创建；本机有 Python，可一键创建独立环境"
      : uv.ok
        ? "独立环境尚未创建；可用 uv 创建（需本机有可被 uv 使用的 Python）"
        : "独立环境尚未创建，且未找到 Python 3",
  }
}

export interface EnsureEnvResult {
  ok: boolean
  pythonPath?: string
  usedUv: boolean
  log: string
  error?: string
}

/**
 * Create/repair isolated venv and install packages.
 * Prefer: uv venv + uv pip install when uv available.
 */
export async function ensureIsolatedPythonEnv(packages: string[]): Promise<EnsureEnvResult> {
  const root = isolatedPythonRoot()
  const uv = await findUv()
  const logs: string[] = []
  const usedUv = uv.ok

  try {
    fs.mkdirSync(path.dirname(root), { recursive: true })
  } catch {
    /* ignore */
  }

  if (uv.ok) {
    logs.push("检测到 uv，使用 uv 创建/维护独立环境")
    const uvBin = uv.path || "uv"
    if (!fs.existsSync(isolatedPythonBin())) {
      const cr = await runCapture(uvBin, ["venv", root], 120_000)
      logs.push(`uv venv → exit ${cr.code}`)
      if (cr.out) logs.push(cr.out.trim().slice(0, 500))
      if (cr.err) logs.push(cr.err.trim().slice(0, 500))
      if (cr.code !== 0) {
        return { ok: false, usedUv: true, log: logs.join("\n"), error: "uv venv 创建失败" }
      }
    }
    if (packages.length > 0) {
      const args = ["pip", "install", "--python", isolatedPythonBin(), ...packages]
      const ir = await runCapture(uvBin, args, 600_000)
      logs.push(`uv pip install ${packages.join(" ")} → exit ${ir.code}`)
      if (ir.out) logs.push(ir.out.trim().slice(-800))
      if (ir.err) logs.push(ir.err.trim().slice(-800))
      if (ir.code !== 0) {
        return {
          ok: false,
          usedUv: true,
          pythonPath: fs.existsSync(isolatedPythonBin()) ? isolatedPythonBin() : undefined,
          log: logs.join("\n"),
          error: "uv pip install 失败（见日志）",
        }
      }
    }
  } else {
    logs.push("未检测到 uv，使用 python -m venv + pip")
    const basePy =
      (await probePythonBin("python3")) ||
      (await probePythonBin("python")) ||
      (process.platform === "win32" ? await probePythonBin("py") : null)
    if (!basePy) {
      return { ok: false, usedUv: false, log: logs.join("\n"), error: "本机没有可用的 Python，无法创建独立环境" }
    }
    if (!fs.existsSync(isolatedPythonBin())) {
      const cr = await runCapture(basePy, ["-m", "venv", root], 120_000)
      logs.push(`python -m venv → exit ${cr.code}`)
      if (cr.code !== 0) {
        return { ok: false, usedUv: false, log: logs.join("\n"), error: "venv 创建失败" }
      }
    }
    if (packages.length > 0) {
      const pip = isolatedPipBin()
      const ir = await runCapture(pip, ["install", ...packages], 600_000)
      logs.push(`pip install ${packages.join(" ")} → exit ${ir.code}`)
      if (ir.code !== 0) {
        return {
          ok: false,
          usedUv: false,
          pythonPath: isolatedPythonBin(),
          log: logs.join("\n"),
          error: "pip install 失败（见日志）",
        }
      }
    }
  }

  const exe = await probePythonBin(isolatedPythonBin())
  if (!exe) {
    return { ok: false, usedUv, log: logs.join("\n"), error: "独立环境创建后仍无法启动 Python" }
  }
  return { ok: true, pythonPath: exe, usedUv, log: logs.join("\n") }
}

/** Build user-facing install command lines (prefer uv when available + isolated). */
export function buildInstallCommands(opts: {
  mode: PythonMode
  uvAvailable: boolean
  packages: string[]
  pythonPath?: string
}): string[] {
  if (opts.packages.length === 0) return []
  const pkgs = opts.packages.join(" ")
  if (opts.mode === "isolated") {
    if (opts.uvAvailable) {
      return [
        `uv venv "${isolatedPythonRoot()}"`,
        `uv pip install --python "${isolatedPythonBin()}" ${pkgs}`,
      ]
    }
    const py = opts.pythonPath || (process.platform === "win32" ? "python" : "python3")
    return [`"${py}" -m venv "${isolatedPythonRoot()}"`, `"${isolatedPipBin()}" install ${pkgs}`]
  }
  // system
  if (opts.uvAvailable) {
    return [`uv pip install ${pkgs}`]
  }
  const py = opts.pythonPath || (process.platform === "win32" ? "python" : "python3")
  return [`"${py}" -m pip install ${pkgs}`]
}


/** Ensure path looks like a usable Python binary (absolute + runs -c). */
export async function validatePythonExecutable(
  raw: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const p = String(raw || "").trim()
  if (!p) return { ok: false, error: "路径不能为空" }
  if (!path.isAbsolute(p)) return { ok: false, error: "请选择绝对路径的 Python 可执行文件" }
  if (!fs.existsSync(p)) return { ok: false, error: "文件不存在" }
  try {
    const st = fs.statSync(p)
    if (!st.isFile() && !st.isSymbolicLink()) {
      // on unix python can be symlink to file — isFile follows links usually
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
  const exe = await probePythonBin(p)
  if (!exe) {
    return {
      ok: false,
      error: "无法作为 Python 启动（请选择 python / python3 可执行文件，而不是目录）",
    }
  }
  // Prefer realpath for stability
  try {
    return { ok: true, path: fs.realpathSync(p) }
  } catch {
    return { ok: true, path: p }
  }
}
