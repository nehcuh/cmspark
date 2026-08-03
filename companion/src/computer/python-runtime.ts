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
  // W2: only surface absolute uvPath
  const uvPath =
    uv.ok && uv.path && path.isAbsolute(uv.path) ? uv.path : undefined
  const uvAvailable = Boolean(uvPath)

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
          uvAvailable,
          ...(uvPath ? { uvPath } : {}),
          isolatedRoot: root,
          isolatedExists,
          resolution: "使用本机全局 Python",
        }
      }
    }
    return {
      mode: "system",
      uvAvailable,
      ...(uvPath ? { uvPath } : {}),
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
        uvAvailable,
        ...(uvPath ? { uvPath } : {}),
        isolatedRoot: root,
        isolatedExists: true,
        resolution: uvAvailable
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
    uvAvailable,
    ...(uvPath ? { uvPath } : {}),
    isolatedRoot: root,
    isolatedExists: false,
    resolution: basePy
      ? "独立环境尚未创建；本机有 Python，可一键创建独立环境"
      : uvAvailable
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
 * Optional deps: inject findUv/runCapture for unit tests.
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
    if (!exists(isolatedPythonBin())) {
      const cr = await capture(uvBin, ["venv", root], 120_000)
      logs.push(`uv venv → exit ${cr.code}`)
      if (cr.out) logs.push(cr.out.trim().slice(0, 500))
      if (cr.err) logs.push(cr.err.trim().slice(0, 500))
      if (cr.code !== 0) {
        return fail("uv venv 创建失败", { usedUv: true })
      }
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
    // When deps injected for unit tests without real python, short-circuit
    if (deps?.findUv || deps?.runCapture) {
      return fail("本机没有可用的 Python，无法创建独立环境", { usedUv: false })
    }
    const basePy =
      (await probePythonBin("python3")) ||
      (await probePythonBin("python")) ||
      (process.platform === "win32" ? await probePythonBin("py") : null)
    if (!basePy) {
      return fail("本机没有可用的 Python，无法创建独立环境", { usedUv: false })
    }
    if (!exists(isolatedPythonBin())) {
      const cr = await capture(basePy, ["-m", "venv", root], 120_000)
      logs.push(`python -m venv → exit ${cr.code}`)
      if (cr.code !== 0) {
        return fail("venv 创建失败", { usedUv: false })
      }
    }
    if (packages.length > 0) {
      const pip = isolatedPipBin()
      const ir = await capture(pip, ["install", ...packages], 600_000)
      logs.push(`pip install ${packages.join(" ")} → exit ${ir.code}`)
      if (ir.code !== 0) {
        return fail("pip install 失败（见日志）", {
          usedUv: false,
          pythonPath: isolatedPythonBin(),
        })
      }
    }
  }

  // After uv path: if test injects and isolated bin "exists", skip real python probe
  if (deps?.findUv || deps?.runCapture) {
    if (usedUv && uvBin) {
      return {
        ok: true,
        pythonPath: isolatedPythonBin(),
        usedUv: true,
        log: logs.join("\n"),
      }
    }
  }

  const exe = await probePythonBin(isolatedPythonBin())
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
