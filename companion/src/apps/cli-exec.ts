// host_cli execution — argv-only execFile, env allowlist, output pipeline.
// L-CLI-3 / L-CLI-8: NEVER reuse capability/shell.ts buildChildEnv (secret leak).

import { execFile } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  buildCliArgv,
  CLI_TRUNCATE_CHARS,
  asCliManifest,
  type CliManifest,
  type HostCliParams,
} from "./cli-manifest"
import { basenameToVault, isLolbinPath, checkAddAllowed } from "./guards"
import type { AppEntry } from "./types"

/** Env keys allowed into CLI child (explicit allowlist only). */
const ENV_ALLOW = new Set([
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SystemRoot",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "ComSpec",
  "PATHEXT",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "TERM",
])

const ENV_DENY_RE = /^(CMSPARK_|DEEPSEEK_|OPENAI_|ANTHROPIC_|.*_(API_KEY|TOKEN|SECRET|PASSWORD))$/i

/** Platform-aware PATH when parent PATH/Path stripped empty (P-F6). */
export function defaultCliPathFallback(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows"
    return [
      `${root}\\System32`,
      root,
      `${root}\\System32\\Wbem`,
      `${root}\\System32\\WindowsPowerShell\\v1.0`,
    ].join(";")
  }
  return "/usr/bin:/bin:/usr/local/bin"
}

export function buildCliChildEnv(
  parent: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const k of Object.keys(parent)) {
    if (ENV_DENY_RE.test(k)) continue
    if (!ENV_ALLOW.has(k)) continue
    const v = parent[k]
    if (typeof v === "string") out[k] = v
  }
  // Minimal PATH fallback if stripped empty (win32 ≠ Unix defaults)
  if (!out.PATH && !out.Path) {
    out.PATH = parent.PATH || parent.Path || defaultCliPathFallback(platform, parent)
  }
  return out
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
}

export function truncateCliOutput(s: string, maxChars = CLI_TRUNCATE_CHARS): string {
  if (s.length <= maxChars) return s
  return s.slice(0, maxChars) + `\n…[truncated ${s.length - maxChars} chars]`
}

export interface CliExecResult {
  ok: boolean
  exit_code: number | null
  stdout: string
  stderr: string
  duration_ms: number
  risk: string
  error?: string
  timed_out?: boolean
}

export function resolveCliExePath(entry: AppEntry): { ok: true; path: string } | { ok: false; error: string } {
  const p = entry.exe?.path
  if (!p || typeof p !== "string") {
    return { ok: false, error: "cli entry missing exe.path" }
  }
  if (!path.isAbsolute(p)) {
    return { ok: false, error: "cli exe.path must be absolute" }
  }
  let real: string
  try {
    real = fs.realpathSync(p)
  } catch {
    return { ok: false, error: `cli exe not found: ${p}` }
  }
  if (isLolbinPath(real)) {
    return { ok: false, error: `cli exe is lolbin-blocked: ${path.basename(real)}` }
  }
  const vault = basenameToVault(real)
  if (vault) {
    return { ok: false, error: `cli exe is vault-blocked (${vault})` }
  }
  // Dual door with checkAddAllowed
  const verdict = checkAddAllowed(real, "cli")
  if (!verdict.allowed) {
    return { ok: false, error: `cli exec denied: ${verdict.detail}` }
  }
  return { ok: true, path: real }
}

export function prepareCliExecution(
  entry: AppEntry,
  params: HostCliParams,
):
  | { ok: true; exe: string; argv: string[]; risk: string; timeoutMs: number; maxOutputBytes: number }
  | { ok: false; error: string } {
  if (entry.kind !== "cli") {
    return { ok: false, error: "entry is not kind=cli" }
  }
  if (!entry.enabled) {
    return { ok: false, error: "cli entry is disabled" }
  }
  const man = asCliManifest(entry.cli_manifest)
  if (!man) {
    return { ok: false, error: "cli_manifest missing or invalid" }
  }
  const exeR = resolveCliExePath(entry)
  if (!exeR.ok) return exeR
  const built = buildCliArgv(man, params)
  if (!built.ok) return built
  return {
    ok: true,
    exe: exeR.path,
    argv: built.argv,
    risk: built.risk,
    timeoutMs: built.timeoutMs,
    maxOutputBytes: built.maxOutputBytes,
  }
}

export function runCliExecFile(
  exe: string,
  argv: string[],
  opts: { timeoutMs: number; maxOutputBytes: number; cwd?: string },
): Promise<CliExecResult> {
  const started = Date.now()
  const cwd = opts.cwd && path.isAbsolute(opts.cwd) ? opts.cwd : os.homedir()
  const env = buildCliChildEnv()
  return new Promise((resolve) => {
    execFile(
      exe,
      argv,
      {
        cwd,
        env,
        timeout: opts.timeoutMs,
        maxBuffer: opts.maxOutputBytes,
        windowsHide: true,
        shell: false,
      },
      (err, stdout, stderr) => {
        const duration_ms = Date.now() - started
        const out = truncateCliOutput(stripAnsi(String(stdout || "")))
        const errOut = truncateCliOutput(stripAnsi(String(stderr || "")))
        if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          resolve({
            ok: false,
            exit_code: null,
            stdout: out,
            stderr: errOut,
            duration_ms,
            risk: "",
            error: "timeout",
            timed_out: true,
          })
          return
        }
        const code =
          err && typeof (err as any).code === "number"
            ? (err as any).code
            : err
              ? 1
              : 0
        // execFile sets err.code to exit code number for non-zero exits
        let exit_code: number | null = 0
        if (err) {
          const c = (err as any).code
          if (typeof c === "number") exit_code = c
          else if (typeof c === "string" && c.startsWith("ERR_")) exit_code = null
          else exit_code = 1
        }
        resolve({
          ok: !err || exit_code === 0,
          exit_code,
          stdout: out,
          stderr: errOut,
          duration_ms,
          risk: "",
          error: err && exit_code !== 0 ? err.message : undefined,
        })
      },
    )
  })
}

/** Minimal safe preset for first ship (read-only style). */
export function echoCliManifest(): CliManifest {
  return {
    schema_version: 1,
    subcommands: [
      {
        name: "run",
        description: "Echo a single safe token (smoke / demo only)",
        risk: "read-only",
        positionals: [{ name: "token", required: true, value_regex: "^[A-Za-z0-9._-]{1,64}$", max_len: 64 }],
        timeout_ms: 5_000,
        max_output_bytes: 4096,
      },
    ],
    defaults: { timeout_ms: 5_000, max_output_bytes: 4096 },
  }
}
