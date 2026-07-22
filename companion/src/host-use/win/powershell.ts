// PowerShell invocation layer for the Windows HostAdapter — the ONLY place
// powershell.exe is spawned. Security contract (plan §D.10):
//   - execFile argv ONLY: "-NoProfile -NonInteractive -ExecutionPolicy Bypass
//     -File <script> ...args". No -Command, no string interpolation of
//     LLM-controlled values — they travel exclusively as argv elements.
//   - Scripts emit a single-line JSON document on stdout and exit 0; any
//     failure is a non-zero exit + stderr message.
//   - COM ProgID unregistered (0x80040154, e.g. New Outlook) is signalled via
//     the stderr prefix "CLASSNOTREG:<app-token>|<hint>" which rethrowPsError
//     maps to a typed WinAppNotAvailable.

import * as path from "path"
import * as fs from "fs"
import { promisify } from "util"
import { execFile } from "child_process"
import { WinAppNotAvailable } from "../types"

const execFileAsync = promisify(execFile)

export const PS_DEFAULT_TIMEOUT_MS = 15000
export const PS_HELLO_TIMEOUT_MS = 60000 // 60s for user to interact with Hello dialog (darwin parity)

/**
 * Resolve powershell.exe. Prefer the absolute System32 path:
 *   1. Robustness — the launcher environment may have a stripped PATH (e.g.
 *      Git Bash lacks WindowsPowerShell\v1.0; spawn then fails ENOENT).
 *   2. Security — an absolute path is immune to PATH-hijack (a malicious
 *      "powershell.exe" placed earlier in PATH).
 * Falls back to bare "powershell.exe" when the SystemRoot candidate is absent
 * (exotic layouts); the ENOENT then surfaces honestly at execFile time.
 */
export function resolvePowerShellExe(): string {
  const sysroot = process.env.SystemRoot || process.env.windir || "C:\\Windows"
  const candidate = path.join(
    sysroot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  )
  try {
    if (fs.existsSync(candidate)) return candidate
  } catch {
    // fall through to PATH lookup
  }
  return "powershell.exe"
}

export type PsRunner = (
  script: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<string>

/**
 * Resolve a .ps1 script path. Search order: staged (packaged layout) → dist
 * (npm dev mode) → src (tsx dev / repo checkout). CMSPARK_WIN_SCRIPTS is a
 * dev-only override for tests/spikes; disabled in production like
 * CMSPARK_HOST_BIN (an env-var attacker already owns the user, but don't make
 * it easy).
 */
export function resolveWinScript(name: string): string {
  if (process.env.CMSPARK_WIN_SCRIPTS) {
    if (process.env.NODE_ENV !== "production") {
      return path.join(process.env.CMSPARK_WIN_SCRIPTS, name)
    }
    throw new Error("host-use/win: CMSPARK_WIN_SCRIPTS override disabled in production")
  }
  const candidates = [
    // 0. SEA exe layout: scripts staged next to the executable itself
    //    (dist-package/cmspark-windows-x64/host-scripts-win/). process.execPath
    //    is deterministic for a SEA; __dirname semantics vary, so this comes first.
    path.resolve(path.dirname(process.execPath), "host-scripts-win", name),
    // 1. Packaged: scripts staged next to the bundled companion entry.
    path.resolve(__dirname, "../../host-scripts-win", name),
    // 2. npm dev mode: companion/dist/host-use/win/ → companion/dist/host-scripts-win/.
    path.resolve(__dirname, "../host-scripts-win", name),
    // 3a. tsx dev: running from src/host-use/win/.
    path.resolve(__dirname, "scripts", name),
    // 3b. .test-dist runs: .test-dist/src/host-use/win/ → companion/src/...
    path.resolve(__dirname, "../../../src/host-use/win/scripts", name),
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      // ignore — try next candidate
    }
  }
  // Fall back to the staged path (will ENOENT at execFile with a clear error
  // pointing at the missing script; better than a silent wrong path).
  return candidates[0]
}

/**
 * Default PsRunner. Spawns Windows PowerShell 5.1 (guaranteed on Win10/11 —
 * no pwsh dependency) with the hardened flag set. Resolves with stdout on
 * exit 0; rejects with the execFile error (carries .code exit code and
 * .stderr) otherwise.
 */
export const runPs: PsRunner = async (script, args, opts) => {
  const result = await execFileAsync(
    resolvePowerShellExe(),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    {
      encoding: "utf-8",
      timeout: opts?.timeoutMs ?? PS_DEFAULT_TIMEOUT_MS,
      // Y6 (WP3): execFile's default maxBuffer is 1MB — a dense full-window
      // OCR JSON (4K, CJK per-char words) can exceed it, and truncation
      // surfaces as a misleading JSON.parse crash. 16MB is bounded headroom;
      // a runaway script still dies at the timeout with a bounded buffer.
      maxBuffer: 16 * 1024 * 1024,
      // W8-windows: suppress the PowerShell console window on every ps1 call.
      // Without this, each spawn briefly shows a console window that:
      //   (a) is visible to the user (bad UX), and
      //   (b) steals the foreground — the post-injection foregroundHwnd()
      //       check then sees a PowerShell HWND instead of the target app,
      //       triggering a false-positive "foreground hijacked" task pause.
      windowsHide: true,
    },
  )
  return String(result.stdout)
}

/**
 * Parse the single-line JSON contract. Strict: the whole trimmed stdout must
 * be one JSON document — anything else means the script broke its contract.
 */
export function parsePsJson<T>(stdout: string, label: string): T {
  const trimmed = String(stdout).trim()
  try {
    return JSON.parse(trimmed) as T
  } catch (err) {
    throw new Error(`${label}: invalid JSON from powershell (${(err as Error).message})`)
  }
}

const CLASSNOTREG_PREFIX = "CLASSNOTREG:"

/**
 * Map a rejected runPs call to a typed error. CLASSNOTREG:<token>|<hint>
 * stderr → WinAppNotAvailable (typed New-Outlook/no-COM surface); any other
 * stderr → Error with the script's message preserved. Never swallows the
 * original error when no stderr is present.
 */
export function rethrowPsError(err: any, label: string): never {
  const stderr =
    err && typeof err === "object" && "stderr" in err && err.stderr
      ? String(err.stderr)
      : ""
  const classNotRegLine = stderr
    .split(/\r?\n/)
    .find((l) => l.startsWith(CLASSNOTREG_PREFIX))
  if (classNotRegLine) {
    const rest = classNotRegLine.slice(CLASSNOTREG_PREFIX.length)
    const sep = rest.indexOf("|")
    const token = (sep >= 0 ? rest.slice(0, sep) : rest).trim() || label
    const hint =
      (sep >= 0 ? rest.slice(sep + 1) : "").trim() ||
      "COM class not registered (0x80040154)"
    throw new WinAppNotAvailable(token, hint)
  }
  if (stderr.trim()) {
    throw new Error(`${label}: ${stderr.trim()}`)
  }
  throw err
}
