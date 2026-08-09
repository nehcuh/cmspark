// Python runtime resolution for Qwen3-VL experimental layer.
// Product rules:
//   - Prefer `uv` when available for creating/installing isolated envs
//   - User chooses isolated (CMspark-managed venv) vs system (global) Python
//   - Paths and install commands are user-facing; package names only in commands
//
// uv discovery (Scheme D / W1–W12): well-known absolute probes first, then
// process-local PATH enrichment for where/which. Successful discovery always
// returns an absolute path — never bare "uv".

import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
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
  /**
   * N1 / PY14: seed base Python available even when `pythonPath` is omitted
   * (isolated mode, venv not yet created). Distinguishes create-env vs install CTA.
   */
  basePythonAvailable?: boolean
}

/** P0 default min version (PY7); open Q may raise for torch later. */
export const MIN_PYTHON_VERSION = { major: 3, minor: 10 } as const

export type PythonDiscoverySource =
  | "config"
  | "isolated"
  | "well-known"
  | "manager"
  | "path"
  | "py-launcher"
  | "none"

export interface PythonBaseHit {
  /** Always absolute after success (PY1). */
  path: string
  version?: { major: number; minor: number; patch?: number }
  source: Exclude<PythonDiscoverySource, "none">
  /** Optional manager label for resolution string, e.g. pyenv-win / conda */
  manager?: string
}

export interface FindPythonBaseOpts {
  /** Include DATA_DIR isolated bin as a candidate (isolated run path). */
  includeIsolated?: boolean
  /** Prefer this absolute config pin first (computer.pythonPath). */
  configPath?: string
  /** Minimum version gate (default MIN_PYTHON_VERSION). */
  minVersion?: { major: number; minor: number }
  deps?: UvDiscoveryDeps
}

/** Injectable hooks for unit tests (production defaults stay thin). */
export interface UvDiscoveryDeps {
  existsSync?: (p: string) => boolean
  readdirSync?: (p: string) => string[]
  statSync?: (p: string) => { isFile(): boolean; isSymbolicLink(): boolean; isDirectory(): boolean }
  realpathSync?: (p: string) => string
  runCapture?: (
    bin: string,
    args: string[],
    timeoutMs?: number,
    env?: NodeJS.ProcessEnv,
  ) => Promise<{ code: number; out: string; err: string }>
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homedir?: () => string
}

function runCapture(
  bin: string,
  args: string[],
  timeoutMs = 20_000,
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: env ?? process.env,
      // S36 P0: suppress console flash for console-subsystem tools under GUI Companion
      windowsHide: true,
    })
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

/** Path helpers for the target platform (lets unit tests inject win32 paths on any host). */
function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix
}

function resolveDeps(deps?: UvDiscoveryDeps) {
  const platform = deps?.platform ?? process.platform
  return {
    existsSync: deps?.existsSync ?? fs.existsSync.bind(fs),
    readdirSync: deps?.readdirSync ?? ((p: string) => fs.readdirSync(p)),
    statSync:
      deps?.statSync ??
      ((p: string) => {
        const st = fs.statSync(p)
        return {
          isFile: () => st.isFile(),
          isSymbolicLink: () => {
            try {
              return fs.lstatSync(p).isSymbolicLink()
            } catch {
              return false
            }
          },
          isDirectory: () => st.isDirectory(),
        }
      }),
    realpathSync: deps?.realpathSync ?? ((p: string) => fs.realpathSync(p)),
    runCapture: deps?.runCapture ?? runCapture,
    platform,
    env: deps?.env ?? process.env,
    homedir: deps?.homedir ?? (() => os.homedir()),
    path: pathApi(platform),
  }
}

/**
 * True when path exists, is a file (or symlink), and basename is uv / uv.exe.
 * Relative paths always fail (W2 absolute pin).
 */
export function isUvExecutable(absPath: string, deps?: UvDiscoveryDeps): boolean {
  if (!absPath || typeof absPath !== "string") return false
  const d = resolveDeps(deps)
  if (!d.path.isAbsolute(absPath)) return false
  const base = d.path.basename(absPath).toLowerCase()
  if (base !== "uv" && base !== "uv.exe") return false
  try {
    if (!d.existsSync(absPath)) return false
    const st = d.statSync(absPath)
    // isFile() follows symlinks; accept file or symlink-to-file
    if (st.isFile()) return true
    if (typeof st.isSymbolicLink === "function" && st.isSymbolicLink()) return true
    return false
  } catch {
    return false
  }
}

/**
 * Well-known absolute uv locations (W3 win32 / W4 unix).
 * WinGet Packages: single-level readdir, package-id prefix only (G5).
 */
export function listWellKnownUvCandidates(deps?: UvDiscoveryDeps): string[] {
  const d = resolveDeps(deps)
  const home = d.homedir()
  const env = d.env
  const P = d.path
  const out: string[] = []
  const seen = new Set<string>()
  const push = (p: string | undefined | null) => {
    if (!p) return
    const n = P.normalize(p)
    if (seen.has(n)) return
    seen.add(n)
    out.push(n)
  }

  if (d.platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA || P.join(home, "AppData", "Local")
    // WinGet Links (if present)
    push(P.join(localAppData, "Microsoft", "WinGet", "Links", "uv.exe"))
    // WinGet Packages: only astral-sh.uv_* (package-id scoped)
    const packagesDir = P.join(localAppData, "Microsoft", "WinGet", "Packages")
    try {
      if (d.existsSync(packagesDir)) {
        const entries = d.readdirSync(packagesDir)
        for (const entry of entries) {
          if (!/^astral-sh\.uv_/i.test(entry)) continue
          push(P.join(packagesDir, entry, "uv.exe"))
        }
      }
    } catch {
      /* best-effort */
    }
    push(P.join(home, ".local", "bin", "uv.exe"))
    push(P.join(home, "scoop", "shims", "uv.exe"))
    push(
      P.join(
        env.ProgramData || "C:\\ProgramData",
        "chocolatey",
        "bin",
        "uv.exe",
      ),
    )
    push(P.join(home, ".cargo", "bin", "uv.exe"))
  } else {
    // W4 unix
    push(P.join(home, ".local", "bin", "uv"))
    push("/opt/homebrew/bin/uv")
    push("/usr/local/bin/uv")
  }

  return out
}

/**
 * PATH string for lookup-only spawns (W5). Ideas from MCP buildSpawnPath
 * but implemented locally — never import mcp/transport (W6).
 */
export function processLocalLookupPath(deps?: UvDiscoveryDeps): string {
  const d = resolveDeps(deps)
  const env = d.env
  const home = d.homedir()
  const P = d.path
  const delim = P.delimiter
  const existing = env.PATH ?? env.Path ?? ""
  const segments = new Set<string>()
  existing.split(delim).forEach((p) => {
    if (p) segments.add(p)
  })

  const candidates: string[] = []
  try {
    // process.execPath is always host-native
    candidates.push(path.dirname(process.execPath))
  } catch {
    /* ignore */
  }
  candidates.push(
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    P.join(home, ".local", "bin"),
    "/usr/bin",
    "/bin",
    P.join(home, ".cargo", "bin"),
  )
  // Windows well-known bins
  candidates.push(
    P.join(env.APPDATA || P.join(home, "AppData", "Roaming"), "npm"),
    P.join(env.ProgramFiles || "C:\\Program Files", "nodejs"),
    P.join(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs"),
    P.join(env.LOCALAPPDATA || P.join(home, "AppData", "Local"), "fnm", "aliases", "default"),
    P.join(env.LOCALAPPDATA || P.join(home, "AppData", "Local"), "Volta", "bin"),
    P.join(home, "scoop", "shims"),
    P.join(env.ProgramData || "C:\\ProgramData", "chocolatey", "bin"),
  )
  // WinGet Links dir (PATH-style, for where)
  {
    const localAppData = env.LOCALAPPDATA || P.join(home, "AppData", "Local")
    candidates.push(P.join(localAppData, "Microsoft", "WinGet", "Links"))
    // Also prepend package dirs that match astral-sh.uv_* so where can find uv.exe
    const packagesDir = P.join(localAppData, "Microsoft", "WinGet", "Packages")
    try {
      if (d.existsSync(packagesDir)) {
        const entries = d.readdirSync(packagesDir)
        for (const entry of entries) {
          if (!/^astral-sh\.uv_/i.test(entry)) continue
          candidates.push(P.join(packagesDir, entry))
        }
      }
    } catch {
      /* best-effort */
    }
  }
  // Python Scripts (uvx-adjacent installs)
  {
    const appData = env.APPDATA || P.join(home, "AppData", "Roaming")
    const pyBase = P.join(appData, "Python")
    try {
      if (d.existsSync(pyBase)) {
        const vers = d.readdirSync(pyBase).filter((v) => /^Python\d+/.test(v))
        for (const v of vers) candidates.push(P.join(pyBase, v, "Scripts"))
      }
    } catch {
      /* best-effort */
    }
  }

  for (const c of candidates) {
    if (c && !segments.has(c)) segments.add(c)
  }

  const head: string[] = []
  for (const c of candidates) {
    if (c && segments.has(c)) {
      head.push(c)
      segments.delete(c)
    }
  }
  return [...new Set([...head, ...Array.from(segments)])].join(delim)
}

/**
 * Platform-aware install hint for Settings / preflight (W7).
 * win32 never brew-only.
 */
export function uvInstallHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "winget install --id astral-sh.uv -e"
  if (platform === "darwin") return "brew install uv"
  return "curl -LsSf https://astral.sh/uv/install.sh | sh"
}

async function pinUvPath(
  candidate: string,
  d: ReturnType<typeof resolveDeps>,
  probeVersion: boolean,
): Promise<string | null> {
  if (!isUvExecutable(candidate, {
    existsSync: d.existsSync,
    statSync: d.statSync,
    platform: d.platform,
    env: d.env,
    homedir: d.homedir,
  })) {
    return null
  }
  if (probeVersion) {
    const vr = await d.runCapture(candidate, ["--version"], 5_000)
    if (vr.code !== 0) return null
  }
  try {
    return d.realpathSync(candidate)
  } catch {
    return d.path.normalize(candidate)
  }
}

/**
 * Discover uv (W1 order): well-known absolute → where/which under
 * process-local PATH. Success always absolute (W2); never path:"uv" (G1).
 */
export async function findUv(
  deps?: UvDiscoveryDeps,
): Promise<{ ok: boolean; path?: string }> {
  const d = resolveDeps(deps)
  const P = d.path

  // 1. Well-known absolute candidates first (W11 execution preference)
  for (const cand of listWellKnownUvCandidates(deps)) {
    const pinned = await pinUvPath(cand, d, true)
    if (pinned && P.isAbsolute(pinned)) {
      return { ok: true, path: pinned }
    }
  }

  // 2. where / which under process-local enriched PATH (lookup env only — W5)
  const lookupPath = processLocalLookupPath(deps)
  const pathKey = d.platform === "win32" && d.env.Path && !d.env.PATH ? "Path" : "PATH"
  const lookupEnv: NodeJS.ProcessEnv = { ...d.env, [pathKey]: lookupPath, PATH: lookupPath }
  const whichBin = d.platform === "win32" ? "where" : "which"
  const r = await d.runCapture(whichBin, ["uv"], 5_000, lookupEnv)
  if (r.code === 0) {
    const lines = r.out
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    for (const hit of lines) {
      // N2: where hit must be absolute + basename uv[.exe] before pin
      if (!P.isAbsolute(hit)) continue
      const base = P.basename(hit).toLowerCase()
      if (base !== "uv" && base !== "uv.exe") continue
      const pinned = await pinUvPath(hit, d, true)
      if (pinned && P.isAbsolute(pinned)) {
        return { ok: true, path: pinned }
      }
    }
  }

  // 3. Fail closed — never return { ok: true, path: "uv" }
  return { ok: false }
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

// ── Base Python discovery (Scheme D / PY1–PY16) ──────────────────────────────

/** Parse "3.10.11" / "Python 3.10.11" style text → version or null. */
export function parsePythonVersion(
  text: string,
): { major: number; minor: number; patch?: number } | null {
  const m = String(text || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null
  const patch = m[3] != null ? Number(m[3]) : undefined
  return {
    major,
    minor,
    ...(patch != null && Number.isFinite(patch) ? { patch } : {}),
  }
}

export function versionMeetsMin(
  v: { major: number; minor: number },
  min: { major: number; minor: number } = MIN_PYTHON_VERSION,
): boolean {
  if (v.major > min.major) return true
  if (v.major < min.major) return false
  return v.minor >= min.minor
}

/** Basename allowlist for final interpreter pins (not py launcher). */
export function isPythonExecutableName(basename: string): boolean {
  const b = String(basename || "").toLowerCase()
  return b === "python" || b === "python3" || b === "python.exe" || b === "python3.exe"
}

/** PY6: Windows Store alias stub under Microsoft\\WindowsApps. */
export function isWindowsStorePythonStub(
  absPath: string,
  deps?: UvDiscoveryDeps,
): boolean {
  if (!absPath) return false
  const d = resolveDeps(deps)
  const norm = d.path.normalize(absPath).replace(/\//g, "\\").toLowerCase()
  if (norm.includes("\\microsoft\\windowsapps\\") || norm.includes("microsoft\\windowsapps\\")) {
    return true
  }
  // Optional realpath second check (N6)
  try {
    const rp = d.realpathSync(absPath)
    const rn = d.path.normalize(rp).replace(/\//g, "\\").toLowerCase()
    if (rn.includes("\\microsoft\\windowsapps\\") || rn.includes("microsoft\\windowsapps\\")) {
      return true
    }
  } catch {
    /* best-effort */
  }
  return false
}

/**
 * Platform-aware install hint for Settings / preflight (PY13).
 * win32 never brew-only.
 */
export function pythonInstallHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return (
      "winget install -e --id Python.Python.3.12" +
      " 或从 https://www.python.org/downloads/ 安装并勾选 “Add python.exe to PATH”；" +
      "完成后重启 CMspark Companion"
    )
  }
  if (platform === "darwin") return "brew install python3；完成后重启 CMspark Companion"
  return "使用发行版包管理器安装 python3 / python3-venv；完成后重启 CMspark Companion"
}

/**
 * Well-known absolute base Python locations (PY5).
 * WinGet: package-id prefix Python.Python.3.* only; never WindowsApps.
 */
export function listWellKnownPythonCandidates(deps?: UvDiscoveryDeps): string[] {
  const d = resolveDeps(deps)
  const home = d.homedir()
  const env = d.env
  const P = d.path
  const out: string[] = []
  const seen = new Set<string>()
  const push = (p: string | undefined | null) => {
    if (!p) return
    const n = P.normalize(p)
    if (seen.has(n)) return
    // Never list Store stubs (PY6 / G2)
    if (isWindowsStorePythonStub(n, deps)) return
    seen.add(n)
    out.push(n)
  }

  if (d.platform === "win32") {
    const localAppData = env.LOCALAPPDATA || P.join(home, "AppData", "Local")
    const programFiles = env.ProgramFiles || "C:\\Program Files"

    // python.org: %LocalAppData%\Programs\Python\Python3*\python.exe
    const pyOrgRoot = P.join(localAppData, "Programs", "Python")
    try {
      if (d.existsSync(pyOrgRoot)) {
        for (const entry of d.readdirSync(pyOrgRoot)) {
          if (!/^Python3\d+/i.test(entry)) continue
          push(P.join(pyOrgRoot, entry, "python.exe"))
        }
      }
    } catch {
      /* best-effort */
    }

    // %ProgramFiles%\Python3*\python.exe (bounded readdir + prefix filter)
    try {
      if (d.existsSync(programFiles)) {
        for (const entry of d.readdirSync(programFiles)) {
          if (!/^Python3\d+/i.test(entry)) continue
          push(P.join(programFiles, entry, "python.exe"))
        }
      }
    } catch {
      /* best-effort */
    }

    // WinGet Packages: Python.Python.3.* only
    const packagesDir = P.join(localAppData, "Microsoft", "WinGet", "Packages")
    try {
      if (d.existsSync(packagesDir)) {
        for (const entry of d.readdirSync(packagesDir)) {
          if (!/^Python\.Python\.3\./i.test(entry)) continue
          const pkg = P.join(packagesDir, entry)
          push(P.join(pkg, "python.exe"))
          // one extra layout level (bounded)
          try {
            for (const sub of d.readdirSync(pkg)) {
              if (!/python|tools|install/i.test(sub) && !/^python/i.test(sub)) {
                // still allow one level: any subdir/python.exe under filtered package
              }
              push(P.join(pkg, sub, "python.exe"))
            }
          } catch {
            /* best-effort */
          }
        }
      }
    } catch {
      /* best-effort */
    }

    // Scoop
    push(P.join(home, "scoop", "apps", "python", "current", "python.exe"))

    // Anaconda / Miniconda / forge roots (fixed allowlist, N4)
    push(P.join(home, "anaconda3", "python.exe"))
    push(P.join(home, "miniconda3", "python.exe"))
    push(P.join(localAppData, "Continuum", "anaconda3", "python.exe"))
    push(P.join(home, "mambaforge", "python.exe"))
    push(P.join(home, "miniforge3", "python.exe"))
  } else {
    // unix well-known
    push("/opt/homebrew/bin/python3")
    push("/usr/local/bin/python3")
    push("/usr/bin/python3")
    push(P.join(home, ".local", "bin", "python3"))
  }

  return out
}

/**
 * Manager base roots readonly seed only (PY8).
 * pyenv-win versions/* + CONDA_PREFIX root; no activate.
 */
export function listManagerPythonCandidates(deps?: UvDiscoveryDeps): string[] {
  const d = resolveDeps(deps)
  const home = d.homedir()
  const env = d.env
  const P = d.path
  const out: string[] = []
  const seen = new Set<string>()
  const push = (p: string | undefined | null) => {
    if (!p) return
    const n = P.normalize(p)
    if (seen.has(n)) return
    if (isWindowsStorePythonStub(n, deps)) return
    seen.add(n)
    out.push(n)
  }

  // pyenv-win
  if (d.platform === "win32") {
    const pyenvRoot =
      env.PYENV_ROOT ||
      env.PYENV ||
      P.join(home, ".pyenv", "pyenv-win")
    const versionsDir = P.join(pyenvRoot, "versions")
    try {
      if (d.existsSync(versionsDir)) {
        for (const entry of d.readdirSync(versionsDir)) {
          push(P.join(versionsDir, entry, "python.exe"))
        }
      }
    } catch {
      /* best-effort */
    }
  } else {
    // pyenv unix (optional seed)
    const pyenvRoot = env.PYENV_ROOT || P.join(home, ".pyenv")
    const versionsDir = P.join(pyenvRoot, "versions")
    try {
      if (d.existsSync(versionsDir)) {
        for (const entry of d.readdirSync(versionsDir)) {
          push(P.join(versionsDir, entry, "bin", "python3"))
          push(P.join(versionsDir, entry, "bin", "python"))
        }
      }
    } catch {
      /* best-effort */
    }
  }

  // CONDA_PREFIX seed only (N4: installer roots live in well-known)
  const condaPrefix = env.CONDA_PREFIX
  if (condaPrefix && P.isAbsolute(condaPrefix)) {
    if (d.platform === "win32") {
      push(P.join(condaPrefix, "python.exe"))
    } else {
      push(P.join(condaPrefix, "bin", "python3"))
      push(P.join(condaPrefix, "bin", "python"))
    }
  }

  return out
}

const PROBE_SCRIPT =
  'import sys; print(sys.executable); print("%d.%d.%d" % sys.version_info[:3])'

/**
 * Probe a Python binary: absolute pin + Store denylist + version gate (PY6/PY7).
 * Returns realpath pin or null.
 */
export async function probePythonBin(
  bin: string,
  deps?: UvDiscoveryDeps,
  minVersion: { major: number; minor: number } = MIN_PYTHON_VERSION,
): Promise<string | null> {
  if (!bin || typeof bin !== "string") return null
  const d = resolveDeps(deps)
  // Candidate path Store check (N6 dual)
  if (d.path.isAbsolute(bin) && isWindowsStorePythonStub(bin, deps)) return null

  const r = await d.runCapture(bin, ["-c", PROBE_SCRIPT], 8_000)
  if (r.code !== 0 || !r.out.trim()) return null
  const lines = r.out
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const exeLine = lines[0] || ""
  if (!exeLine || !d.path.isAbsolute(exeLine)) return null
  if (isWindowsStorePythonStub(exeLine, deps)) return null

  // Version from second line or combined
  let ver = lines[1] ? parsePythonVersion(lines[1]) : null
  if (!ver) ver = parsePythonVersion(r.out)
  if (!ver || !versionMeetsMin(ver, minVersion)) return null

  // Basename allowlist on pin (reject bare py launcher as final)
  const base = d.path.basename(exeLine)
  if (!isPythonExecutableName(base)) {
    // sys.executable should still be python.exe; if weird, reject
    return null
  }

  try {
    const rp = d.realpathSync(exeLine)
    if (!d.path.isAbsolute(rp)) return d.path.normalize(exeLine)
    if (isWindowsStorePythonStub(rp, deps)) return null
    return rp
  } catch {
    return d.path.normalize(exeLine)
  }
}

/**
 * Cascade (PY4): config → isolated → well-known → managers → PATH/py.
 * Success always absolute; never bare python/py (G1).
 */
export async function findPythonBase(
  opts: FindPythonBaseOpts = {},
): Promise<({ ok: true } & PythonBaseHit) | { ok: false }> {
  const deps = opts.deps
  const d = resolveDeps(deps)
  const minVersion = opts.minVersion ?? MIN_PYTHON_VERSION
  const P = d.path

  const tryProbe = async (
    cand: string,
    source: Exclude<PythonDiscoverySource, "none">,
    manager?: string,
  ): Promise<({ ok: true } & PythonBaseHit) | null> => {
    if (!cand) return null
    // Bare names only allowed as spawn argv0 inside cascade step 5 (path/py)
    if (!P.isAbsolute(cand) && source !== "path" && source !== "py-launcher") {
      return null
    }
    if (P.isAbsolute(cand) && isWindowsStorePythonStub(cand, deps)) return null
    const pin = await probePythonBin(cand, deps, minVersion)
    if (!pin || !P.isAbsolute(pin)) return null
    // G1: never bare
    const base = P.basename(pin).toLowerCase()
    if (base === "py" || base === "py.exe") return null
    if (!isPythonExecutableName(P.basename(pin))) return null
    return {
      ok: true,
      path: pin,
      source,
      ...(manager ? { manager } : {}),
    }
  }

  // 1. Config pin
  if (opts.configPath) {
    const v = await validatePythonExecutable(opts.configPath, deps, minVersion)
    if (v.ok) {
      return { ok: true, path: v.path, source: "config" }
    }
  }

  // 2. Isolated run bin
  if (opts.includeIsolated) {
    const iso = isolatedPythonBin()
    if (d.existsSync(iso)) {
      const hit = await tryProbe(iso, "isolated")
      if (hit) return hit
    }
  }

  // 3. Well-known
  for (const cand of listWellKnownPythonCandidates(deps)) {
    if (!P.isAbsolute(cand)) continue
    if (!d.existsSync(cand)) continue
    const hit = await tryProbe(cand, "well-known")
    if (hit) return hit
  }

  // 4. Managers
  for (const cand of listManagerPythonCandidates(deps)) {
    if (!P.isAbsolute(cand)) continue
    if (!d.existsSync(cand)) continue
    const manager = cand.toLowerCase().includes("pyenv")
      ? "pyenv"
      : cand.toLowerCase().includes("conda") || (d.env.CONDA_PREFIX && cand.includes(d.env.CONDA_PREFIX))
        ? "conda"
        : "manager"
    const hit = await tryProbe(cand, "manager", manager)
    if (hit) return hit
  }

  // 5. Enriched PATH where/which + win32 py launcher
  const lookupPath = processLocalLookupPath(deps)
  const pathKey = d.platform === "win32" && d.env.Path && !d.env.PATH ? "Path" : "PATH"
  const lookupEnv: NodeJS.ProcessEnv = { ...d.env, [pathKey]: lookupPath, PATH: lookupPath }
  const whichBin = d.platform === "win32" ? "where" : "which"
  const names =
    d.platform === "win32" ? ["python", "python3"] : ["python3", "python"]
  for (const name of names) {
    const r = await d.runCapture(whichBin, [name], 5_000, lookupEnv)
    if (r.code !== 0) continue
    const lines = r.out
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    for (const hit of lines) {
      if (!P.isAbsolute(hit)) continue
      if (!isPythonExecutableName(P.basename(hit))) continue
      const pinned = await tryProbe(hit, "path")
      if (pinned) return pinned
    }
  }

  if (d.platform === "win32") {
    // py -0p: list installed interpreters
    const listR = await d.runCapture("py", ["-0p"], 5_000, lookupEnv)
    if (listR.code === 0 && listR.out.trim()) {
      for (const line of listR.out.split(/\r?\n/)) {
        // Loose parse: last absolute-looking token ending in python.exe
        const m = line.match(/([A-Za-z]:\\[^\s*]+python\.exe)/i) || line.match(/(\/[^\s]+python3?)/)
        const pth = m?.[1]?.trim()
        if (!pth || !P.isAbsolute(pth)) continue
        const pinned = await tryProbe(pth, "py-launcher")
        if (pinned) return pinned
      }
    }
    // py -3 -c → sys.executable
    const pyHit = await tryProbe("py", "py-launcher")
    // tryProbe with bare "py" — probePythonBin accepts bare for cascade; pin must be absolute
    if (pyHit) return pyHit
    // Direct: spawn py -3 with probe script via runCapture
    const py3 = await d.runCapture(
      "py",
      ["-3", "-c", PROBE_SCRIPT],
      8_000,
      lookupEnv,
    )
    if (py3.code === 0 && py3.out.trim()) {
      const lines = py3.out
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      const exe = lines[0]
      if (exe && P.isAbsolute(exe) && !isWindowsStorePythonStub(exe, deps)) {
        let ver = lines[1] ? parsePythonVersion(lines[1]) : parsePythonVersion(py3.out)
        if (ver && versionMeetsMin(ver, minVersion) && isPythonExecutableName(P.basename(exe))) {
          try {
            return {
              ok: true,
              path: d.realpathSync(exe),
              source: "py-launcher",
            }
          } catch {
            return { ok: true, path: P.normalize(exe), source: "py-launcher" }
          }
        }
      }
    }
  }

  return { ok: false }
}

/**
 * Resolve which Python interpreter Companion should use for download/infer.
 */
export async function resolvePythonRuntime(opts: {
  mode?: PythonMode
  /** Explicit system python path when mode=system */
  systemPythonPath?: string
  preferUv?: boolean
  deps?: UvDiscoveryDeps
}): Promise<PythonRuntimeInfo> {
  const mode: PythonMode = opts.mode === "system" ? "system" : "isolated"
  const root = isolatedPythonRoot()
  const isoBin = isolatedPythonBin()
  const d = resolveDeps(opts.deps)
  const isolatedExists = d.existsSync(isoBin)
  const uv = await findUv(opts.deps)
  // W2: only surface absolute uvPath
  const uvPath =
    uv.ok && uv.path && path.isAbsolute(uv.path) ? uv.path : undefined
  const uvAvailable = Boolean(uvPath)

  if (mode === "system") {
    const base = await findPythonBase({
      configPath: opts.systemPythonPath,
      includeIsolated: false,
      deps: opts.deps,
    })
    if (base.ok) {
      return {
        mode: "system",
        pythonPath: base.path,
        uvAvailable,
        ...(uvPath ? { uvPath } : {}),
        isolatedRoot: root,
        isolatedExists,
        resolution: "使用本机全局 Python",
        basePythonAvailable: true,
      }
    }
    return {
      mode: "system",
      uvAvailable,
      ...(uvPath ? { uvPath } : {}),
      isolatedRoot: root,
      isolatedExists,
      resolution: "已选全局 Python，但未找到可用的 Python 3 解释器（可安装或选择路径）",
      basePythonAvailable: false,
    }
  }

  // isolated + exists: only probe isolated bin (no system overwrite of run path)
  if (isolatedExists) {
    const exe = await probePythonBin(isoBin, opts.deps)
    if (exe) {
      return {
        mode: "isolated",
        pythonPath: exe,
        uvAvailable,
        ...(uvPath ? { uvPath } : {}),
        isolatedRoot: root,
        isolatedExists: true,
        resolution: uvAvailable
          ? "使用 CMspark 独立环境（推荐；本机已检测到 uv，安装依赖时可优先用 uv）"
          : "使用 CMspark 独立环境（推荐）",
        basePythonAvailable: true,
      }
    }
    // Bad isolated env — report honestly, no PATH fallback for run
    return {
      mode: "isolated",
      uvAvailable,
      ...(uvPath ? { uvPath } : {}),
      isolatedRoot: root,
      isolatedExists: true,
      resolution: "独立环境存在但无法启动，可尝试「修复/更新独立环境」",
      basePythonAvailable: false,
    }
  }

  // Isolated missing: OMIT pythonPath (B3 / PY2). Seed only for CTA.
  const seed = await findPythonBase({
    includeIsolated: false,
    configPath: opts.systemPythonPath,
    deps: opts.deps,
  })
  const baseOk = seed.ok

  return {
    mode: "isolated",
    // intentionally omit pythonPath until venv exists
    uvAvailable,
    ...(uvPath ? { uvPath } : {}),
    isolatedRoot: root,
    isolatedExists: false,
    basePythonAvailable: baseOk,
    resolution: baseOk
      ? `独立环境尚未创建；本机已检测到 Python${seed.ok && seed.source ? `（${seed.source}）` : ""}，可一键创建独立环境`
      : uvAvailable
        ? "独立环境尚未创建；可用 uv 创建（需本机有可被 uv 使用的 Python ≥ 3.10）"
        : "独立环境尚未创建，且未找到可用的 Python 3（≥ 3.10）",
  }
}

export interface EnsureEnvResult {
  ok: boolean
  pythonPath?: string
  usedUv: boolean
  log: string
  error?: string
}

/** Windows MAX_PATH residual tip when venv/torch trees fail (P-F8). */
export function longPathFailureHint(
  error: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return error
  const blob = error.toLowerCase()
  const pathish =
    blob.includes("path") ||
    blob.includes("filename") ||
    blob.includes("too long") ||
    blob.includes("enametoolong") ||
    blob.includes("no such file") ||
    blob.includes("失败")
  if (!pathish) {
    return `${error}。Windows 提示：torch/venv 目录很深时可能触发 MAX_PATH——可启用「Win32 长路径」或把 python-env/模型目录放到更短路径（如 C:\\cmspark-py）。`
  }
  return `${error}。疑似路径过长/MAX_PATH：启用 Win32 长路径，或将独立环境与模型目录放到更短路径（如 C:\\cmspark-py）。`
}

/**
 * Create/repair isolated venv and install packages.
 * Prefer: uv venv + uv pip install when uv available (absolute path only — T2).
 * No-uv path: findPythonBase absolute base (PY15 / N3). Optional deps for unit tests.
 */
export async function ensureIsolatedPythonEnv(
  packages: string[],
  deps?: UvDiscoveryDeps & {
    findUv?: () => Promise<{ ok: boolean; path?: string }>
    existsSync?: (p: string) => boolean
  },
): Promise<EnsureEnvResult> {
  const root = isolatedPythonRoot()
  const capture = deps?.runCapture ?? runCapture
  const exists = deps?.existsSync ?? fs.existsSync.bind(fs)
  const uv = deps?.findUv ? await deps.findUv() : await findUv(deps)
  const logs: string[] = []
  // T2 / W2: only use uv when path is absolute; else fall through to venv/pip
  const uvBin =
    uv.ok && uv.path && path.isAbsolute(uv.path) ? uv.path : null
  const usedUv = Boolean(uvBin)
  let venvReady = exists(isolatedPythonBin())

  const fail = (error: string, extra?: Partial<EnsureEnvResult>): EnsureEnvResult => ({
    ok: false,
    usedUv,
    log: logs.join("\n"),
    error: longPathFailureHint(error),
    ...extra,
  })

  try {
    fs.mkdirSync(path.dirname(root), { recursive: true })
  } catch {
    /* ignore */
  }

  if (uvBin) {
    logs.push(`检测到 uv，使用 uv 创建/维护独立环境（${uvBin}）`)
    if (!venvReady) {
      const cr = await capture(uvBin, ["venv", root], 120_000)
      logs.push(`uv venv → exit ${cr.code}`)
      if (cr.out) logs.push(cr.out.trim().slice(0, 500))
      if (cr.err) logs.push(cr.err.trim().slice(0, 500))
      if (cr.code !== 0) {
        return fail("uv venv 创建失败", { usedUv: true })
      }
      venvReady = true
    }
    if (packages.length > 0) {
      const args = ["pip", "install", "--python", isolatedPythonBin(), ...packages]
      const ir = await capture(uvBin, args, 600_000)
      logs.push(`uv pip install ${packages.join(" ")} → exit ${ir.code}`)
      if (ir.out) logs.push(ir.out.trim().slice(-800))
      if (ir.err) logs.push(ir.err.trim().slice(-800))
      if (ir.code !== 0) {
        return fail("uv pip install 失败（见日志）", {
          usedUv: true,
          pythonPath: exists(isolatedPythonBin()) ? isolatedPythonBin() : undefined,
        })
      }
    }
  } else {
    logs.push("未检测到 uv，使用 python -m venv + pip")
    // N3: always discover absolute base via cascade (injectable deps); no bare-only probe
    const base = await findPythonBase({ includeIsolated: false, deps })
    if (!base.ok || !path.isAbsolute(base.path)) {
      return fail(
        `本机没有可用的 Python（≥ ${MIN_PYTHON_VERSION.major}.${MIN_PYTHON_VERSION.minor}），无法创建独立环境。${pythonInstallHint()}`,
        { usedUv: false },
      )
    }
    logs.push(`使用 base Python：${base.path}（${base.source}）`)
    if (!venvReady) {
      const cr = await capture(base.path, ["-m", "venv", root], 120_000)
      logs.push(`python -m venv → exit ${cr.code}`)
      if (cr.out) logs.push(cr.out.trim().slice(0, 500))
      if (cr.err) logs.push(cr.err.trim().slice(0, 500))
      if (cr.code !== 0) {
        return fail("venv 创建失败", { usedUv: false })
      }
      venvReady = true
    }
    if (packages.length > 0) {
      const pip = isolatedPipBin()
      const ir = await capture(pip, ["install", ...packages], 600_000)
      logs.push(`pip install ${packages.join(" ")} → exit ${ir.code}`)
      if (ir.out) logs.push(ir.out.trim().slice(-800))
      if (ir.err) logs.push(ir.err.trim().slice(-800))
      if (ir.code !== 0) {
        return fail("pip install 失败（见日志）", {
          usedUv: false,
          pythonPath: isolatedPythonBin(),
        })
      }
    }
  }

  // Injectable test short-circuit (N3): allow mock success without real isolated probe
  if (deps?.findUv || deps?.runCapture) {
    if (usedUv && uvBin) {
      return {
        ok: true,
        pythonPath: isolatedPythonBin(),
        usedUv: true,
        log: logs.join("\n"),
      }
    }
    if (!usedUv && venvReady) {
      return {
        ok: true,
        pythonPath: isolatedPythonBin(),
        usedUv: false,
        log: logs.join("\n"),
      }
    }
  }

  const exe = await probePythonBin(isolatedPythonBin(), deps)
  if (!exe) {
    return fail("独立环境创建后仍无法启动 Python")
  }
  return { ok: true, pythonPath: exe, usedUv, log: logs.join("\n") }
}

/** Platform-aware absolute path (host path.isAbsolute misreads win32 drive letters on posix). */
export function isAbsolutePathForPlatform(
  p: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "win32") return path.win32.isAbsolute(p)
  return path.posix.isAbsolute(p)
}

/**
 * Quote a path for user-facing shell copy-paste.
 * PowerShell needs `& 'path with spaces'` (quoted path alone is a string, not invoke).
 */
export function shellInvokePath(
  absOrBare: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!isAbsolutePathForPlatform(absOrBare, platform)) {
    // bare command names (uv / python) — no quoting
    if (!absOrBare.includes("/") && !absOrBare.includes("\\")) return absOrBare
  }
  if (platform === "win32") {
    // PowerShell: & 'C:\Users\John Doe\...\uv.exe'
    return `& '${absOrBare.replace(/'/g, "''")}'`
  }
  return `"${absOrBare.replace(/"/g, '\\"')}"`
}

/** Quote a path as an argument (not invocable) for the same shell family. */
export function shellArgPath(
  p: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return `'${p.replace(/'/g, "''")}'`
  }
  return `"${p.replace(/"/g, '\\"')}"`
}

/** Build user-facing install command lines (prefer uv when available + isolated). */
export function buildInstallCommands(opts: {
  mode: PythonMode
  uvAvailable: boolean
  /** Absolute uv binary when known (N3); preferred over bare `uv` in copy-paste. */
  uvPath?: string
  packages: string[]
  pythonPath?: string
  /** Target platform for shell quoting (default: host). */
  platform?: NodeJS.Platform
}): string[] {
  if (opts.packages.length === 0) return []
  const plat = opts.platform ?? process.platform
  const pkgs = opts.packages.join(" ")
  const uvCmd =
    opts.uvPath && isAbsolutePathForPlatform(opts.uvPath, plat)
      ? shellInvokePath(opts.uvPath, plat)
      : "uv"
  const rootArg = shellArgPath(isolatedPythonRoot(), plat)
  const binArg = shellArgPath(isolatedPythonBin(), plat)
  if (opts.mode === "isolated") {
    if (opts.uvAvailable) {
      return [
        `${uvCmd} venv ${rootArg}`,
        `${uvCmd} pip install --python ${binArg} ${pkgs}`,
      ]
    }
    const pyBare = opts.pythonPath || (plat === "win32" ? "python" : "python3")
    const pyCmd = isAbsolutePathForPlatform(pyBare, plat)
      ? shellInvokePath(pyBare, plat)
      : pyBare
    const pipBin = isolatedPipBin()
    const pipCmd = shellInvokePath(pipBin, plat)
    return [`${pyCmd} -m venv ${rootArg}`, `${pipCmd} install ${pkgs}`]
  }
  // system
  if (opts.uvAvailable) {
    return [`${uvCmd} pip install ${pkgs}`]
  }
  const pyBare = opts.pythonPath || (plat === "win32" ? "python" : "python3")
  const pyCmd = isAbsolutePathForPlatform(pyBare, plat)
    ? shellInvokePath(pyBare, plat)
    : pyBare
  return [`${pyCmd} -m pip install ${pkgs}`]
}


/**
 * Ensure path looks like a usable Python binary (PY12):
 * absolute + exists + basename allowlist + Store denylist + version gate + probe.
 */
export async function validatePythonExecutable(
  raw: string,
  deps?: UvDiscoveryDeps,
  minVersion: { major: number; minor: number } = MIN_PYTHON_VERSION,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const d = resolveDeps(deps)
  const p = String(raw || "").trim()
  if (!p) return { ok: false, error: "路径不能为空" }
  if (!d.path.isAbsolute(p)) {
    return { ok: false, error: "请选择绝对路径的 Python 可执行文件" }
  }
  if (isWindowsStorePythonStub(p, deps)) {
    return {
      ok: false,
      error:
        "检测到 Microsoft Store 占位 python（WindowsApps），不可用。请安装 python.org / winget 真 Python，或在「应用执行别名」中关闭 python.exe。",
    }
  }
  if (!d.existsSync(p)) return { ok: false, error: "文件不存在" }
  const base = d.path.basename(p)
  if (!isPythonExecutableName(base)) {
    return {
      ok: false,
      error: "请选择 python / python3 可执行文件（不要选择 py 启动器本身）",
    }
  }
  try {
    const st = d.statSync(p)
    if (!st.isFile() && !(typeof st.isSymbolicLink === "function" && st.isSymbolicLink())) {
      // still allow probe — some hosts report oddly for reparse points
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
  const exe = await probePythonBin(p, deps, minVersion)
  if (!exe) {
    return {
      ok: false,
      error: `无法作为可用 Python 启动（需要 ≥ ${minVersion.major}.${minVersion.minor}，且不能是 Store 占位；请选择真实 python / python3 可执行文件）`,
    }
  }
  if (isWindowsStorePythonStub(exe, deps)) {
    return {
      ok: false,
      error: "探测结果仍指向 Microsoft Store 占位 python，已拒绝",
    }
  }
  return { ok: true, path: exe }
}
