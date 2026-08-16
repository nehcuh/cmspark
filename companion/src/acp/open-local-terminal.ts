// Mode C: open host terminal + interactive coding agent (best-effort).
// Not a PTY in the Side Panel — real Terminal.app / OS terminal window.
// Fail-soft: never throws into session start; returns { ok, detail }.
//
// Levels (product Mode C):
//   L1 — open terminal and exec interactive agent (default attempt)
//   L0 — open terminal + cd + banner only (command already copied / pasteable)
// L2 (same ACP session) is DEFER.

import { execFile, spawn } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { promisify } from "util"
import { logger } from "../logger"
import {
  acpSpawnUsesCmdHost,
  resolveAcpSpawn,
  resolveWindowsAgentCommand,
  writeExclusiveUtf8,
  scheduleUnlink,
} from "./win-spawn"

const execFileAsync = promisify(execFile)

/**
 * User preference for which host terminal to open (Mode C).
 * - `auto` / empty → platform default (macOS Terminal.app; Linux $TERMINAL / common)
 * - Known ids: Terminal | iTerm | Warp | Alacritty | Kitty | Ghostty
 * - Or absolute path to a .app bundle / binary
 */
export type LocalTerminalAppPref = string

export type OpenLocalTerminalOpts = {
  /** Absolute path to agent binary (e.g. /opt/homebrew/bin/claude) */
  command: string
  /** Bound workspace realpath */
  cwd: string
  /** Short goal for echo banner only (not full prompt injection) */
  goalHint?: string
  agentLabel?: string
  /**
   * Agent id (claude / pi / gemini / codex…) for interactive argv conventions.
   * Without this we still pass prompt as a single trailing arg (most CLIs).
   */
  agentId?: string
  /**
   * Full task prompt from the browser (same intent as side-panel bridge).
   * Written to a temp file and passed into the interactive agent so Terminal
   * does not open an empty TUI while the banner only echoes a short goal.
   */
  prompt?: string
  /**
   * When L1 (interactive exec) fails to open a terminal, still try L0:
   * open terminal with cd + banner only (no agent exec). Default true.
   */
  l0Degrade?: boolean
  /**
   * Preferred terminal app (config.coding_handoff.local_terminal_app).
   * See LocalTerminalAppPref.
   */
  terminalApp?: LocalTerminalAppPref
}

export type OpenLocalTerminalResult = {
  ok: boolean
  platform: string
  detail: string
  /** Shell one-liner that was launched or offered for paste */
  commandLine?: string
  /** Which open level succeeded when ok (L1 interactive / L0 banner-only) */
  level?: "L1" | "L0"
}

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * POSIX-safe single-quote for embedding a string in a shell script.
 * 'foo'bar' → 'foo'\''bar'
 */
export function shellSingleQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/**
 * Quote a Windows path for cmd.exe (double-quotes; escape internal ").
 * Safe for `cd /d "..."` and bare command tokens with spaces.
 */
export function windowsQuotePath(p: string): string {
  const s = String(p)
  // cmd.exe: " is escaped by doubling inside a double-quoted string
  return `"${s.replace(/"/g, '""')}"`
}

/**
 * After realpath (or as given), command must be an absolute filesystem path.
 * Rejects relative paths, empty, and bare names (PATH lookup is not allowed).
 * Returns null when ok, or an error reason string.
 */
export function rejectNonAbsoluteCommand(command: string): string | null {
  if (!command || typeof command !== "string" || !command.trim()) {
    return "agent command missing"
  }
  const trimmed = command.trim()
  if (!path.isAbsolute(trimmed)) {
    return "agent command must be an absolute path (relative/PATH names rejected)"
  }
  return null
}

/**
 * Resolve command via realpath when possible, then require absolute path.
 * Returns { ok, absolute } or { ok: false, reason }.
 */
export function resolveAbsoluteCommand(
  command: string,
  realpathFn: (p: string) => string = (p) => fs.realpathSync(p),
): { ok: true; absolute: string } | { ok: false; reason: string } {
  const pre = rejectNonAbsoluteCommand(command)
  if (pre) return { ok: false, reason: pre }
  let absolute = command.trim()
  try {
    absolute = realpathFn(absolute)
  } catch {
    // Keep original absolute path if realpath fails (file may still be exec via PATH-less spawn)
  }
  const post = rejectNonAbsoluteCommand(absolute)
  if (post) return { ok: false, reason: post }
  return { ok: true, absolute }
}

export function buildBannerLines(opts: {
  cwd: string
  command: string
  agentLabel?: string
  goalHint?: string
}): string[] {
  const label =
    (opts.agentLabel || path.basename(opts.command) || "agent").replace(/'/g, "")
  const hint = (opts.goalHint || "").replace(/[\r\n]+/g, " ").slice(0, 120).replace(/'/g, "")
  return [
    `cd ${shellSingleQuote(opts.cwd)} || exit 1`,
    `echo ''`,
    `echo '════════════════════════════════════════'`,
    `echo ' CMspark 编程接力 · 本机交互窗口'`,
    `echo ' 侧栏另有监视会话（桥接）—— 不是同一会话'`,
    `echo ' Agent: ${label}'`,
    hint ? `echo ' 任务: ${hint}'` : `echo ''`,
    `echo '════════════════════════════════════════'`,
    `echo ''`,
  ]
}

/**
 * Build the shell fragment that exec's the interactive agent with the task.
 * Prefer reading prompt from a temp file (handles newlines / quotes / length).
 *
 * Conventions (interactive, NOT -p print mode):
 * - claude: `claude [prompt]`  (first user message)
 * - pi:     `pi [messages…]`
 * - others: trailing prompt arg when present
 */
export function buildInteractiveExecFragment(opts: {
  command: string
  agentId?: string
  /** Absolute path to UTF-8 prompt file (preferred) */
  promptFile?: string
  /** Inline prompt only when no file (short goals) */
  prompt?: string
}): string {
  const cmd = shellSingleQuote(opts.command)
  const id = (opts.agentId || "").toLowerCase()
  const hasFile = !!(opts.promptFile && opts.promptFile.trim())
  const inline = (opts.prompt || "").trim()

  if (!hasFile && !inline) {
    // No task payload — same as bare exec (legacy)
    return `exec ${cmd}`
  }

  // Read file into $CMSPARK_TASK so we don't rely on ARG_MAX for huge packages,
  // then pass as a single argv. Trailing newline stripped by $(cat) is OK.
  if (hasFile) {
    const fileQ = shellSingleQuote(opts.promptFile!.trim())
    // shellcheck: intentional word-split disable via quoted expansion
    const load = `CMSPARK_TASK=$(cat ${fileQ})`
    // Claude / Pi / generic: first message = task
    if (id === "codex") {
      // codex often wants `codex` interactive; pass via exec with prompt if supported
      return `${load} && exec ${cmd} "\${CMSPARK_TASK}"`
    }
    return `${load} && exec ${cmd} "\${CMSPARK_TASK}"`
  }

  return `exec ${cmd} ${shellSingleQuote(inline)}`
}

/** L1: banner + exec interactive agent with task prompt (not -p bridge). */
export function buildInteractiveScript(
  opts: OpenLocalTerminalOpts & {
    command: string
    cwd: string
    promptFile?: string
  },
): string {
  const lines = [
    ...buildBannerLines(opts),
    buildInteractiveExecFragment({
      command: opts.command,
      agentId: opts.agentId,
      promptFile: opts.promptFile,
      prompt: opts.prompt,
    }),
  ]
  return lines.join(" && ")
}

/**
 * L0 degrade: banner only + paste hint (no agent exec).
 * User still gets a terminal in the workspace; commandLine is for manual paste.
 */
export function buildL0DegradeScript(opts: {
  cwd: string
  command: string
  agentLabel?: string
  goalHint?: string
  /** When set, echo a paste-friendly one-liner that includes the task file */
  promptFile?: string
  agentId?: string
}): string {
  const lines = [
    ...buildBannerLines(opts),
    `echo '（L0 降级：未自动启动 Agent。请粘贴下方命令或从剪贴板运行）'`,
  ]
  if (opts.promptFile) {
    lines.push(
      `echo ${shellSingleQuote(
        buildInteractiveExecFragment({
          command: opts.command,
          agentId: opts.agentId,
          promptFile: opts.promptFile,
        }),
      )}`,
    )
  } else {
    lines.push(`echo ${shellSingleQuote(opts.command)}`)
  }
  return lines.join(" && ")
}

/** `start "title"` line: every token quoted (R7 — TEMP paths with `&` must not split). */
export function buildWindowsStartCommandLine(psArgs: string[]): string {
  return `start "CMspark" ${["powershell.exe", ...psArgs].map(windowsQuotePath).join(" ")}`
}

/**
 * Windows paste-friendly one-liner.
 * Without promptFile: cmd `cd /d && command`.
 * With promptFile: PowerShell cd + Get-Content -LiteralPath + & agent $task
 * (no raw interpolation of the file body).
 */
export function buildWindowsCommandLine(
  cwd: string,
  command: string,
  opts?: { promptFile?: string; extraArgs?: string[] },
): string {
  const pf = opts?.promptFile?.trim()
  if (pf) {
    const tokens = [command, ...(opts?.extraArgs || [])].map(quotePowerShellLiteral)
    return [
      `Set-Location -LiteralPath ${quotePowerShellLiteral(cwd)}`,
      `$task = Get-Content -LiteralPath ${quotePowerShellLiteral(pf)} -Raw -Encoding utf8`,
      `& ${tokens.join(" ")} $task`,
    ].join("; ")
  }
  return `cd /d ${windowsQuotePath(cwd)} && ${windowsQuotePath(command)}`
}

/** L1 only when the resolved spawn target is an unwrapped PE or node+script — never cmd.exe. */
export function modeCWindowsLevelForSpec(spec: { command: string }): "L1" | "L0" {
  return acpSpawnUsesCmdHost(spec) ? "L0" : "L1"
}

/** PowerShell single-quoted literal (`'` → `''`). */
export function quotePowerShellLiteral(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`
}

/**
 * Mode C L1/L0 PowerShell script: cd workspace, print banner, optionally exec agent.
 * Paths go through -LiteralPath / single-quoted literals — no interpolation.
 */
export function buildWindowsModeCScript(opts: {
  cwd: string
  command: string
  extraArgs?: string[]
  agentLabel?: string
  goalHint?: string
  promptFile?: string
  l0?: boolean
}): string {
  const label = (opts.agentLabel || path.basename(opts.command) || "agent").replace(/'/g, "")
  const hint = (opts.goalHint || "").replace(/[\r\n]+/g, " ").slice(0, 120).replace(/'/g, "")
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath ${quotePowerShellLiteral(opts.cwd)}`,
    "Write-Host ''",
    "Write-Host '════════════════════════════════════════'",
    "Write-Host ' CMspark 编程接力 · 本机交互窗口'",
    "Write-Host ' 侧栏另有监视会话（桥接）—— 不是同一会话'",
    `Write-Host ' Agent: ${label}'`,
    hint ? `Write-Host ' 任务: ${hint}'` : "Write-Host ''",
    "Write-Host '════════════════════════════════════════'",
    "Write-Host ''",
  ]
  if (opts.l0) {
    lines.push("Write-Host '（L0 降级：未自动启动 Agent。请粘贴下方命令或从剪贴板运行）'")
    const paste = opts.promptFile
      ? buildWindowsCommandLine(opts.cwd, opts.command, {
          promptFile: opts.promptFile,
          extraArgs: opts.extraArgs,
        })
      : [opts.command, ...(opts.extraArgs || [])].join(" ")
    lines.push(`Write-Host ${quotePowerShellLiteral(paste)}`)
    return lines.join("\r\n")
  }
  const tokens = [opts.command, ...(opts.extraArgs || [])].map(quotePowerShellLiteral)
  if (opts.promptFile) {
    lines.push(
      `$task = Get-Content -LiteralPath ${quotePowerShellLiteral(opts.promptFile)} -Raw -Encoding utf8`,
    )
    lines.push(`& ${tokens.join(" ")} $task`)
  } else {
    lines.push(`& ${tokens.join(" ")}`)
  }
  return lines.join("\r\n")
}

export type WinTermStat = { isFile(): boolean; size: number }

function winPathBasename(p: string): string {
  const norm = String(p || "").replace(/\//g, "\\")
  const i = norm.lastIndexOf("\\")
  return i >= 0 ? norm.slice(i + 1) : norm
}

function isWindowsAppsAliasPath(p: string): boolean {
  const norm = String(p || "").replace(/\//g, "\\").toLowerCase()
  return (
    norm.includes("\\microsoft\\windowsapps\\") ||
    norm.endsWith("\\microsoft\\windowsapps")
  )
}

/**
 * Real Windows Terminal PE only.
 * Never accepts bare `wt.exe` (PATH / App Execution Alias).
 * Never accepts Microsoft\WindowsApps\wt.exe (0-byte alias).
 * Success = exists + isFile + size > 0 + not under Microsoft\WindowsApps.
 */
export function isRealWindowsTerminalExe(
  filePath: string,
  deps?: { stat?: (p: string) => WinTermStat },
): boolean {
  const p = String(filePath || "").trim()
  if (!p) return false
  if (p.toLowerCase() === "wt.exe") return false
  if (!/[\\/]/.test(p)) return false
  if (winPathBasename(p).toLowerCase() !== "wt.exe") return false
  if (isWindowsAppsAliasPath(p)) return false
  try {
    const st = deps?.stat ? deps.stat(p) : fs.statSync(p)
    return !!(st && typeof st.isFile === "function" && st.isFile() && st.size > 0)
  } catch {
    return false
  }
}

function defaultWindowsTerminalCandidates(): string[] {
  const home = os.homedir()
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
  const pf = process.env.ProgramFiles || "C:\\Program Files"
  return [
    path.join(local, "Microsoft", "WindowsApps", "wt.exe"),
    path.join(home, "AppData", "Local", "Microsoft", "WindowsApps", "wt.exe"),
    path.join(pf, "Windows Terminal", "wt.exe"),
    path.join(local, "Microsoft", "Windows Terminal", "wt.exe"),
    path.join(home, "scoop", "apps", "windows-terminal", "current", "wt.exe"),
  ]
}

/** Locate a real wt.exe PE. Never returns bare `wt.exe` or a WindowsApps alias. */
export function findWindowsTerminalExe(deps?: {
  candidates?: string[]
  stat?: (p: string) => WinTermStat
}): string | null {
  const list = deps?.candidates ?? defaultWindowsTerminalCandidates()
  for (const c of list) {
    if (c && isRealWindowsTerminalExe(c, deps)) return c
  }
  return null
}

const WT_OBSERVE_MS = 300
const START_CONFIRM_MS = 2500

/**
 * Detached Windows spawn with honesty:
 * - reject on `error`
 * - if earlyExitIsFailure (wt): reject on close/exit inside the observe window;
 *   still-running after the window is success. 80ms-without-error is NOT success.
 * - if launcher (cmd /c start): wait for exit 0 (start is expected to exit);
 *   reject on error / non-zero / timeout without confirmation.
 */
function spawnDetachedWin(
  command: string,
  args: string[],
  opts?: { earlyExitIsFailure?: boolean },
): Promise<void> {
  const earlyExitIsFailure = opts?.earlyExitIsFailure === true
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (err?: Error) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve()
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      })
    } catch (e: any) {
      settle(e instanceof Error ? e : new Error(String(e)))
      return
    }

    child.once("error", (err) => settle(err))
    const onGone = (code: number | null) => {
      if (earlyExitIsFailure) {
        settle(new Error(`process exited immediately (code ${code})`))
        return
      }
      if (code != null && code !== 0) {
        settle(new Error(`process exited with code ${code}`))
        return
      }
      settle()
    }
    child.once("exit", onGone)
    child.once("close", onGone)
    child.unref()

    const waitMs = earlyExitIsFailure ? WT_OBSERVE_MS : START_CONFIRM_MS
    setTimeout(() => {
      if (settled) return
      if (earlyExitIsFailure) {
        if (child.exitCode != null || child.signalCode != null) {
          settle(new Error("process exited immediately"))
        } else {
          settle()
        }
        return
      }
      settle(new Error("process did not confirm launch"))
    }, waitMs)
  })
}

/**
 * Open a visible Windows console running the Mode C PowerShell script.
 * auto: prefer visible `start`+powershell; only try wt if a real PE was found.
 * wt launch fail/early-exit → fall through to start. start fail → throw (no fake success).
 */
export async function openWindowsWithPref(
  scriptPath: string,
  cwd: string,
  pref: string | undefined,
): Promise<{ appLabel: string }> {
  const n = normalizeLocalTerminalApp(pref).toLowerCase()
  const auto = n === "auto"
  const wantWt = n === "wt" || n === "windowsterminal" || n === "windows terminal"
  const wantStart = n === "cmd" || n === "powershell" || n === "conhost" || auto
  const psArgs = [
    "-NoExit",
    "-NoLogo",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
  ]
  const wt = findWindowsTerminalExe()

  const launchStart = async (): Promise<{ appLabel: string }> => {
    const comspec = process.env.ComSpec || "cmd.exe"
    const line = buildWindowsStartCommandLine(psArgs)
    await spawnDetachedWin(comspec, ["/d", "/s", "/c", line], { earlyExitIsFailure: false })
    return { appLabel: "Windows Console" }
  }

  const launchWt = async (): Promise<{ appLabel: string }> => {
    if (!wt) throw new Error("Windows Terminal (wt.exe) not found")
    await spawnDetachedWin(wt, ["-d", cwd, "--", "powershell.exe", ...psArgs], {
      earlyExitIsFailure: true,
    })
    return { appLabel: "Windows Terminal" }
  }

  if (auto) {
    try {
      return await launchStart()
    } catch (startErr) {
      if (wt) {
        try {
          return await launchWt()
        } catch {
          throw startErr instanceof Error ? startErr : new Error(String(startErr))
        }
      }
      throw startErr instanceof Error ? startErr : new Error(String(startErr))
    }
  }

  if (wantWt) {
    if (wt) {
      try {
        return await launchWt()
      } catch {
        /* fall through to start */
      }
    }
    try {
      return await launchStart()
    } catch {
      throw new Error(wt ? "Windows Terminal failed to launch" : "Windows Terminal (wt.exe) not found")
    }
  }

  if (wantStart) {
    return await launchStart()
  }
  throw new Error(`terminal pref "${pref}" is not supported on Windows (use auto / wt / cmd)`)
}

/** Common typos / aliases → canonical preset id */
const LOCAL_TERMINAL_ALIASES: Record<string, string> = {
  ghotty: "Ghostty",
  ghosty: "Ghostty",
  ghost: "Ghostty",
  iterm2: "iTerm",
  "iterm 2": "iTerm",
  terminalapp: "Terminal",
  "terminal.app": "Terminal",
  wt: "wt",
  windowsterminal: "wt",
  "windows terminal": "wt",
  cmd: "cmd",
  conhost: "cmd",
  powershell: "cmd",
}

/**
 * Normalize user/config terminal preference. Rejects empty / metachar / oversize.
 * Returns `"auto"` for default platform behavior.
 */
export function normalizeLocalTerminalApp(raw: unknown): string {
  if (typeof raw !== "string") return "auto"
  let s = raw.trim()
  if (!s || s === "default" || s === "auto" || s === "system") return "auto"
  if (s.length > 512) return "auto"
  // No shell metacharacters — preference is an app id or absolute path only.
  if (/[;&|`$<>\n\r]/.test(s)) return "auto"
  const alias = LOCAL_TERMINAL_ALIASES[s.toLowerCase()]
  if (alias) return alias
  return s
}

/** Known macOS app display names for AppleScript / open -a. */
export const DARWIN_TERMINAL_PRESETS: Record<
  string,
  {
    appName: string
    /**
     * applescript-terminal — Terminal.app do script
     * applescript-iterm — iTerm write text
     * open-args-e — `open -na App.app --args -e bash -lc …` (Ghostty/Alacritty/Kitty on macOS)
     * open-only — activate app only (Warp; user pastes)
     */
    kind: "applescript-terminal" | "applescript-iterm" | "open-args-e" | "open-only"
  }
> = {
  terminal: { appName: "Terminal", kind: "applescript-terminal" },
  iterm: { appName: "iTerm", kind: "applescript-iterm" },
  iterm2: { appName: "iTerm", kind: "applescript-iterm" },
  warp: { appName: "Warp", kind: "open-only" },
  alacritty: { appName: "Alacritty", kind: "open-args-e" },
  kitty: { appName: "kitty", kind: "open-args-e" },
  ghostty: { appName: "Ghostty", kind: "open-args-e" },
}

/**
 * Pick a Linux terminal binary from env + common paths.
 * COLORTERM is intentionally ignored: it is a capability flag (truecolor),
 * not a terminal emulator path (e.g. often "truecolor").
 */
export function resolveLinuxTerminalBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.TERMINAL?.trim()
  if (fromEnv) return fromEnv
  // Do NOT use COLORTERM — not a binary name.
  if (fs.existsSync("/usr/bin/x-terminal-emulator")) return "x-terminal-emulator"
  if (fs.existsSync("/usr/bin/gnome-terminal")) return "gnome-terminal"
  if (fs.existsSync("/usr/bin/konsole")) return "konsole"
  if (fs.existsSync("/usr/bin/xfce4-terminal")) return "xfce4-terminal"
  if (fs.existsSync("/usr/bin/xterm")) return "xterm"
  return null
}

/**
 * Resolve Linux binary from user pref: absolute path, bare name on PATH-like
 * locations, or fall back to resolveLinuxTerminalBinary.
 */
export function resolveLinuxTerminalFromPref(
  pref: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): string | null {
  const n = normalizeLocalTerminalApp(pref)
  if (n !== "auto") {
    if (path.isAbsolute(n) && exists(n)) return n
    // Bare name: try common prefixes
    for (const base of ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/bin"]) {
      const cand = path.join(base, n)
      if (exists(cand)) return cand
    }
    // Allow env TERMINAL override when pref is a logical id that maps poorly
    if (env.TERMINAL?.trim()) return env.TERMINAL.trim()
  }
  return resolveLinuxTerminalBinary(env)
}

// ── Internals ───────────────────────────────────────────────────────────────

function isExecutableFile(p: string): boolean {
  try {
    const st = fs.statSync(p)
    if (!st.isFile()) return false
    fs.accessSync(p, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function darwinAppBundleExists(appName: string): boolean {
  const candidates = [
    `/Applications/${appName}.app`,
    path.join(os.homedir(), `Applications/${appName}.app`),
    `/System/Applications/${appName}.app`,
  ]
  // iTerm installs as iTerm.app
  if (appName === "iTerm") {
    candidates.unshift("/Applications/iTerm.app", path.join(os.homedir(), "Applications/iTerm.app"))
  }
  return candidates.some((p) => fs.existsSync(p))
}

/** Resolve macOS .app binary path for spawn-e terminals. */
export function resolveDarwinAppExecutable(appName: string): string | null {
  const bundles = [
    `/Applications/${appName}.app`,
    path.join(os.homedir(), `Applications/${appName}.app`),
  ]
  if (appName === "iTerm") {
    bundles.unshift("/Applications/iTerm.app")
  }
  // kitty lower-case folder sometimes
  if (appName === "kitty") {
    bundles.push("/Applications/kitty.app", path.join(os.homedir(), "Applications/kitty.app"))
  }
  for (const bundle of bundles) {
    if (!fs.existsSync(bundle)) continue
    const macOSDir = path.join(bundle, "Contents", "MacOS")
    try {
      const entries = fs.readdirSync(macOSDir)
      // Prefer executable named like the app
      const prefer = entries.find(
        (e) => e.toLowerCase() === appName.toLowerCase() || e === "stable" /* Warp */,
      )
      const name = prefer || entries[0]
      if (!name) continue
      const full = path.join(macOSDir, name)
      if (isExecutableFile(full)) return full
    } catch {
      /* next */
    }
  }
  return null
}

async function openDarwinTerminalApp(script: string): Promise<void> {
  const osa = `tell application "Terminal" to do script ${JSON.stringify(script)}`
  await execFileAsync("osascript", ["-e", osa], {
    timeout: 8000,
    maxBuffer: 64 * 1024,
  })
  try {
    await execFileAsync("osascript", ["-e", 'tell application "Terminal" to activate'], {
      timeout: 3000,
    })
  } catch {
    /* ignore activate failures */
  }
}

/**
 * iTerm2: create window and write the shell one-liner (runs interactively).
 * App name is "iTerm" on disk for modern iTerm2.
 */
async function openDarwinITerm(script: string): Promise<void> {
  // write text runs the command in the session shell
  const osa = [
    'tell application "iTerm"',
    "  create window with default profile",
    "  tell current session of current window",
    `    write text ${JSON.stringify(script)}`,
    "  end tell",
    "  activate",
    "end tell",
  ].join("\n")
  await execFileAsync("osascript", ["-e", osa], {
    timeout: 10000,
    maxBuffer: 64 * 1024,
  })
}

/**
 * Linux / non-macOS: spawn terminal binary with -e bash -lc.
 * On macOS Ghostty documents that launching the GUI via the CLI binary is
 * unsupported — use openDarwinAppWithArgsE instead.
 */
function openSpawnETerminal(bin: string, script: string): void {
  const child = spawn(bin, ["-e", "bash", "-lc", script], {
    detached: true,
    stdio: "ignore",
  })
  child.on("error", () => {
    /* fail-soft — caller may not await spawn errors */
  })
  child.unref()
}

/**
 * macOS GUI terminals that accept `-e` via LaunchServices:
 *   open -na "Ghostty.app" --args -e bash -lc '<script>'
 * Ghostty help: "On macOS, launching the terminal emulator from the CLI is not
 * supported… Use open -na Ghostty.app --args …"
 */
async function openDarwinAppWithArgsE(appName: string, script: string): Promise<void> {
  // Prefer .app bundle path so LaunchServices finds the right app
  let appRef = appName
  const bundle = `/Applications/${appName}.app`
  const homeBundle = path.join(os.homedir(), `Applications/${appName}.app`)
  if (fs.existsSync(bundle)) appRef = bundle
  else if (fs.existsSync(homeBundle)) appRef = homeBundle
  else if (appName === "iTerm" && fs.existsSync("/Applications/iTerm.app")) {
    appRef = "/Applications/iTerm.app"
  }

  await execFileAsync(
    "open",
    ["-na", appRef, "--args", "-e", "bash", "-lc", script],
    { timeout: 10000, maxBuffer: 64 * 1024 },
  )
}

/**
 * Warp: no stable "run this script" API across versions.
 * Best-effort: activate app; caller should surface pasteLine for the real task.
 */
async function openDarwinWarpOnly(): Promise<void> {
  await execFileAsync("open", ["-na", "Warp"], { timeout: 5000 })
}

/**
 * Open on macOS using user preference. Returns which app label was used.
 * Does NOT silently fall back to Terminal when a non-auto pref was set
 * and the app is missing — throws so Mode C can L0/paste instead of lying.
 */
export async function openDarwinWithPref(
  script: string,
  pref: string | undefined,
): Promise<{ appLabel: string; ranScript: boolean; fallback?: string }> {
  const n = normalizeLocalTerminalApp(pref)
  const key = n === "auto" ? "terminal" : n.toLowerCase()

  // Absolute .app or binary path
  if (n !== "auto" && path.isAbsolute(n)) {
    if (n.endsWith(".app") || n.includes(".app/")) {
      const appName = path.basename(n).replace(/\.app$/i, "")
      if (/^terminal$/i.test(appName)) {
        await openDarwinTerminalApp(script)
        return { appLabel: "Terminal", ranScript: true }
      }
      if (/^iterm/i.test(appName)) {
        await openDarwinITerm(script)
        return { appLabel: "iTerm", ranScript: true }
      }
      // Ghostty / Alacritty / Kitty / generic: open -na Bundle --args -e …
      await openDarwinAppWithArgsE(appName, script)
      return { appLabel: appName, ranScript: true }
    }
    if (isExecutableFile(n)) {
      // Direct binary (Linux-style); may not show GUI on macOS Ghostty CLI
      openSpawnETerminal(n, script)
      return { appLabel: path.basename(n), ranScript: true }
    }
    throw new Error(`terminal app not found: ${n}`)
  }

  const preset = DARWIN_TERMINAL_PRESETS[key]

  // auto → Terminal.app
  if (!preset && n === "auto") {
    await openDarwinTerminalApp(script)
    return { appLabel: "Terminal", ranScript: true }
  }

  // Unknown id: try open -na as app name (no silent Terminal fallback)
  if (!preset) {
    if (!darwinAppBundleExists(n) && !fs.existsSync(`/Applications/${n}.app`)) {
      throw new Error(
        `terminal app "${n}" not found under /Applications; install it or pick another in 设置 → 编程助手`,
      )
    }
    await openDarwinAppWithArgsE(n, script)
    return { appLabel: n, ranScript: true }
  }

  if (preset.kind === "applescript-terminal") {
    await openDarwinTerminalApp(script)
    return { appLabel: "Terminal", ranScript: true }
  }
  if (preset.kind === "applescript-iterm") {
    if (!darwinAppBundleExists("iTerm") && !darwinAppBundleExists("iTerm2")) {
      throw new Error("iTerm2 not installed under /Applications")
    }
    await openDarwinITerm(script)
    return { appLabel: "iTerm", ranScript: true }
  }
  if (preset.kind === "open-args-e") {
    if (!darwinAppBundleExists(preset.appName)) {
      throw new Error(
        `${preset.appName} not installed under /Applications (check 设置 → 本机终端应用)`,
      )
    }
    await openDarwinAppWithArgsE(preset.appName, script)
    return { appLabel: preset.appName, ranScript: true }
  }
  // open-only (Warp)
  if (!darwinAppBundleExists(preset.appName)) {
    throw new Error(`${preset.appName} not installed under /Applications`)
  }
  await openDarwinWarpOnly()
  return { appLabel: "Warp", ranScript: false }
}

function openLinuxTerminal(term: string, script: string): void {
  // Always pass program + args as separate argv (xterm/konsole/xfce4-terminal
  // -e expects that form; a single "bash -lc '…'" string fails).
  const args = term.includes("gnome-terminal")
    ? ["--", "bash", "-lc", script]
    : ["-e", "bash", "-lc", script]
  const child = spawn(term, args, { detached: true, stdio: "ignore" })
  child.on("error", () => {
    /* fail-soft */
  })
  child.unref()
}

/**
 * Best-effort open host terminal running interactive agent in workspace.
 * macOS: Terminal.app via osascript. Linux: $TERMINAL / x-terminal-emulator.
 * Windows: Windows Terminal (`wt`) or `start` + PowerShell -File (quoted literals).
 */
export async function openLocalTerminalForAgent(
  opts: OpenLocalTerminalOpts,
): Promise<OpenLocalTerminalResult> {
  const platform = process.platform
  const allowL0 = opts.l0Degrade !== false

  const resolved = resolveAbsoluteCommand(opts.command)
  if (!resolved.ok) {
    return { ok: false, platform, detail: resolved.reason }
  }
  let command = resolved.absolute
  if (platform === "win32") {
    command = resolveWindowsAgentCommand(command)
  }
  if (!isExecutableFile(command)) {
    return {
      ok: false,
      platform,
      detail: "agent command missing or not executable",
    }
  }

  let cwd = opts.cwd
  try {
    cwd = fs.realpathSync(opts.cwd)
  } catch {
    return { ok: false, platform, detail: "workspace path invalid" }
  }
  if (!path.isAbsolute(cwd)) {
    return { ok: false, platform, detail: "workspace path must be absolute" }
  }
  try {
    const st = fs.statSync(cwd)
    if (!st.isDirectory()) {
      return { ok: false, platform, detail: "workspace is not a directory" }
    }
  } catch {
    return { ok: false, platform, detail: "workspace not accessible" }
  }

  // Persist full task for interactive agent (Mode C must not open empty TUI).
  // R6: mkdtemp + exclusive create (wx); delayed unlink after the new window reads.
  let promptFile: string | undefined
  let modeCTempDir: string | undefined
  const modeCTempFiles: string[] = []
  const fullPrompt = typeof opts.prompt === "string" ? opts.prompt.trim() : ""
  if (fullPrompt) {
    try {
      modeCTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mode-c-"))
      promptFile = path.join(modeCTempDir, "task.md")
      writeExclusiveUtf8(promptFile, fullPrompt)
      modeCTempFiles.push(promptFile)
    } catch (e: any) {
      logger.warn("acp.open_local_terminal_prompt_file", {
        err: e?.message || String(e),
      })
      promptFile = undefined
    }
  }

  const scriptOpts = { ...opts, command, cwd, promptFile, prompt: fullPrompt || opts.prompt }
  const l1Script = buildInteractiveScript(scriptOpts)
  const pasteLine =
    platform === "win32"
      ? buildWindowsCommandLine(cwd, command, promptFile ? { promptFile } : undefined)
      : `cd ${shellSingleQuote(cwd)} && ${buildInteractiveExecFragment({
          command,
          agentId: opts.agentId,
          promptFile,
          prompt: fullPrompt || undefined,
        })}`

  const termPref = normalizeLocalTerminalApp(opts.terminalApp)

  try {
    if (platform === "darwin") {
      try {
        const opened = await openDarwinWithPref(l1Script, termPref)
        // Warp (open-only) cannot inject the script — degrade to L0 semantics
        // with app open + paste line so the user still gets the dual-process path.
        if (!opened.ranScript) {
          logger.info("acp.open_local_terminal", {
            platform,
            ok: true,
            level: "L0",
            app: opened.appLabel,
            cwd,
            reason: "app_open_only",
          })
          return {
            ok: true,
            platform,
            detail: `opened ${opened.appLabel} (paste task command — app has no script API)`,
            commandLine: pasteLine,
            level: "L0",
          }
        }
        logger.info("acp.open_local_terminal", {
          platform,
          ok: true,
          level: "L1",
          app: opened.appLabel,
          cwd,
          has_prompt: !!fullPrompt,
        })
        return {
          ok: true,
          platform,
          detail: fullPrompt
            ? `opened ${opened.appLabel} with interactive agent + task prompt`
            : `opened ${opened.appLabel} with interactive agent`,
          commandLine: l1Script,
          level: "L1",
        }
      } catch (e: any) {
        if (!allowL0) throw e
        const l0 = buildL0DegradeScript(scriptOpts)
        try {
          const opened = await openDarwinWithPref(l0, termPref)
          logger.info("acp.open_local_terminal", {
            platform,
            ok: true,
            level: "L0",
            app: opened.appLabel,
            cwd,
          })
          return {
            ok: true,
            platform,
            detail: `opened ${opened.appLabel} (L0 degrade: banner only; paste agent command)`,
            commandLine: pasteLine,
            level: "L0",
          }
        } catch (e2: any) {
          const msg = e2?.message || e?.message || String(e2)
          logger.warn("acp.open_local_terminal_failed", { err: msg, platform })
          return { ok: false, platform, detail: msg, commandLine: pasteLine }
        }
      }
    }

    if (platform === "linux") {
      const term = resolveLinuxTerminalFromPref(termPref)
      if (!term) {
        return {
          ok: false,
          platform,
          detail: "no terminal emulator found; paste command manually",
          commandLine: pasteLine,
        }
      }
      try {
        openLinuxTerminal(term, l1Script)
        logger.info("acp.open_local_terminal", {
          platform,
          ok: true,
          level: "L1",
          term,
          pref: termPref,
          cwd,
        })
        return {
          ok: true,
          platform,
          detail: `launched ${term}`,
          commandLine: l1Script,
          level: "L1",
        }
      } catch (e: any) {
        if (!allowL0) throw e
        const l0 = buildL0DegradeScript(scriptOpts)
        try {
          openLinuxTerminal(term, l0)
          logger.info("acp.open_local_terminal", { platform, ok: true, level: "L0", term, cwd })
          return {
            ok: true,
            platform,
            detail: `launched ${term} (L0 degrade: banner only; paste agent command)`,
            commandLine: pasteLine,
            level: "L0",
          }
        } catch (e2: any) {
          const msg = e2?.message || e?.message || String(e2)
          logger.warn("acp.open_local_terminal_failed", { err: msg, platform })
          return { ok: false, platform, detail: msg, commandLine: pasteLine }
        }
      }
    }

    if (platform === "win32") {
      const spec = resolveAcpSpawn(command, [])
      const cmdHost = acpSpawnUsesCmdHost(spec)
      const l1Allowed = modeCWindowsLevelForSpec(spec) === "L1"
      const writeModeCPs1 = (l0: boolean): string => {
        // L1 may only invoke an unwrapped PE or node+script (never cmd.exe /c … $task).
        const invokeUnwrapped = !l0 && l1Allowed && !cmdHost
        const body = buildWindowsModeCScript({
          cwd,
          command: invokeUnwrapped ? spec.command : command,
          extraArgs: invokeUnwrapped ? spec.args : [],
          agentLabel: opts.agentLabel,
          goalHint: opts.goalHint,
          promptFile,
          l0,
        })
        if (!modeCTempDir) {
          modeCTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mode-c-"))
        }
        const ps1 = path.join(modeCTempDir, l0 ? "l0.ps1" : "run.ps1")
        writeExclusiveUtf8(ps1, body)
        modeCTempFiles.push(ps1)
        return ps1
      }

      const returnL0 = (
        appLabel: string | undefined,
        detail: string,
        ok: boolean,
      ): OpenLocalTerminalResult => {
        if (ok && appLabel) {
          logger.info("acp.open_local_terminal", {
            platform,
            ok: true,
            level: "L0",
            app: appLabel,
            cwd,
          })
          return {
            ok: true,
            platform,
            detail,
            commandLine: pasteLine,
            level: "L0",
          }
        }
        logger.warn("acp.open_local_terminal_failed", { err: detail, platform })
        return { ok: false, platform, detail, commandLine: pasteLine }
      }

      // R4: cmd host cannot L1-exec `& cmd /d /s /c agent.cmd $task`. L0 only.
      if (!l1Allowed) {
        if (!allowL0) {
          return {
            ok: false,
            platform,
            detail: "agent is a cmd host; L1 exec refused",
            commandLine: pasteLine,
          }
        }
        try {
          const ps1 = writeModeCPs1(true)
          const opened = await openWindowsWithPref(ps1, cwd, termPref)
          return returnL0(
            opened.appLabel,
            `opened ${opened.appLabel} (L0: cmd host cannot L1-exec; paste agent command)`,
            true,
          )
        } catch (e: any) {
          return returnL0(undefined, e?.message || String(e), false)
        }
      }

      try {
        const ps1 = writeModeCPs1(false)
        const opened = await openWindowsWithPref(ps1, cwd, termPref)
        logger.info("acp.open_local_terminal", {
          platform,
          ok: true,
          level: "L1",
          app: opened.appLabel,
          cwd,
        })
        return {
          ok: true,
          platform,
          detail: `opened ${opened.appLabel} with interactive agent`,
          commandLine: pasteLine,
          level: "L1",
        }
      } catch (e: any) {
        if (!allowL0) throw e
        try {
          const ps1 = writeModeCPs1(true)
          const opened = await openWindowsWithPref(ps1, cwd, termPref)
          return returnL0(
            opened.appLabel,
            `opened ${opened.appLabel} (L0 degrade: banner only; paste agent command)`,
            true,
          )
        } catch (e2: any) {
          const msg = e2?.message || e?.message || String(e2)
          return returnL0(undefined, msg, false)
        }
      }
    }

    // other OS: fail-soft with safely quoted paste line
    return {
      ok: false,
      platform,
      detail: "open_local_terminal not automated on this OS; use pasted command",
      commandLine: pasteLine,
    }
  } catch (e: any) {
    const msg = e?.message || String(e)
    logger.warn("acp.open_local_terminal_failed", { err: msg, platform })
    return {
      ok: false,
      platform,
      detail: msg,
      commandLine: pasteLine,
    }
  } finally {
    scheduleUnlink(modeCTempFiles)
  }
}
