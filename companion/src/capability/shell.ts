// Shell capability — confirm_per_command one-shot exec (no free interactive PTY by default)
// Spec S10: default per-command confirmation via L2 security_token gate.
// #au4dch SH-A: windowsHide on win32 + optional onProgress for tool.progress tails.

import { spawn, type ChildProcess } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { getModule, requireModule } from "./modules"
import { appendCapabilityAudit } from "../packs/audit-log"
import { getUserEnvVars } from "../user-env"
import { hardenPath } from "../process-path"

const MAX_OUTPUT = 200_000
/** Default one-shot wall clock; killProcessTree on expiry (not just the shell parent). */
export const DEFAULT_TIMEOUT_MS = 60_000
/** Hard ceiling so LLM/tool params cannot hang the host forever. */
export const MAX_TIMEOUT_MS = 300_000
/** Max chars of each stream sent on each progress tick (WS payload hygiene). */
export const PROGRESS_TAIL_CHARS = 2_000
const PROGRESS_INTERVAL_MS = 750

// --- Active run registry (chat.abort / shell.exec.abort / signal) ---
// Keyed by tool_call_id when available; otherwise a synthetic run id.
type ShellRunEntry = {
  threadId: string | null
  kill: () => void
}
const activeShellRuns = new Map<string, ShellRunEntry>()

/** Test helper: clear registry between cases. */
export function _resetShellRunsForTests(): void {
  activeShellRuns.clear()
}

export function listActiveShellRunIds(): string[] {
  return [...activeShellRuns.keys()]
}

/**
 * Kill in-flight shell_exec for a thread (chat.abort / stop_thread).
 * Returns number of runs signalled.
 */
export function abortShellRunsForThread(threadId: string): number {
  if (!threadId) return 0
  let n = 0
  for (const [key, entry] of [...activeShellRuns.entries()]) {
    if (entry.threadId === threadId) {
      try {
        entry.kill()
      } catch {
        /* best-effort */
      }
      activeShellRuns.delete(key)
      n++
    }
  }
  return n
}

/** Kill one shell by tool_call_id / run key. */
export function abortShellRunById(runId: string): boolean {
  if (!runId) return false
  const entry = activeShellRuns.get(runId)
  if (!entry) return false
  try {
    entry.kill()
  } catch {
    /* best-effort */
  }
  activeShellRuns.delete(runId)
  return true
}

/** Panic: kill every in-flight shell_exec. */
export function abortAllShellRuns(): number {
  let n = 0
  for (const [key, entry] of [...activeShellRuns.entries()]) {
    try {
      entry.kill()
    } catch {
      /* best-effort */
    }
    activeShellRuns.delete(key)
    n++
  }
  return n
}

/**
 * Kill the shell child and its descendants.
 * - POSIX: requires spawn({ detached: true }) so pid is process-group leader;
 *   `process.kill(-pid)` SIGKILLs the whole group (shell + sleep/pipeline kids).
 * - win32: `taskkill /T /F` process tree (detached not required).
 * Bare `child.kill("SIGKILL")` alone leaves grandchildren alive under shell:true.
 */
export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid == null || pid <= 0) return
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      })
    } catch {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      child.kill("SIGKILL")
    } catch {
      /* ignore */
    }
  }
}

/** Clamp optional timeoutMs into [1000, MAX_TIMEOUT_MS]; default DEFAULT_TIMEOUT_MS. */
export function resolveShellTimeoutMs(raw?: number | null): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS
  const n = Math.floor(raw)
  return Math.min(MAX_TIMEOUT_MS, Math.max(1000, n))
}

/**
 * Child env for shell_exec (ADR-019).
 * Merge order: process.env → user_env → harden PATH → force CMSPARK_SHELL
 * (cannot be overridden by user). PATH harden drops file-in-PATH segments that
 * cause `spawn ENOTDIR` and restores /usr/bin:/bin for GUI/packaged launches.
 */
export function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...getUserEnvVars(),
    CMSPARK_SHELL: "1",
  }
  env.PATH = hardenPath({ pathEnv: env.PATH })
  return env
}

/**
 * Shell metacharacters that enable chaining/injection under spawn(..., { shell: true }).
 * Used only when modules.shell.policy === "allowlist" (P1a structure tighten).
 * P1b may move to shell:false + file/args; residual $VAR expansion remains until then.
 */
const SHELL_ALLOWLIST_METACHAR_RE = /[;|&`$()<>\n\r]/

/** True if command contains shell metacharacters banned under allowlist policy. */
export function hasShellAllowlistMetachar(command: string): boolean {
  return SHELL_ALLOWLIST_METACHAR_RE.test(command)
}

/**
 * Shell families get a DEDICATED deny set — never the interpreter -e rule:
 * `bash -e` is legitimate errexit and `bash -eu script.sh` must stay allowed.
 * - posix (sh/bash/zsh): deny `-c` (incl. clusters like `-lc`/`-ec`)
 * - pwsh (pwsh/powershell): deny any unique prefix of Command / EncodedCommand
 *   in `-` / `--` / `/` flag styles (`-c`, `-com`, `/c`, `-e`, `-enc`, …,
 *   incl. `=` glued forms)
 * - deno (deno/bun): deny `eval` subcommand, `-e`/`--eval`, `-p`/`--print`
 * - cmd (cmd/cmd.exe): deny `/c`, `/k` (case-insensitive — cmd flags are)
 * Basenames are normalized (path + trailing `.exe` stripped) before lookup.
 *
 * DESIGN BOUNDARY (accepted residual, grok review W1c): flag denial is
 * defense-in-depth only. A bare interpreter/shell allowlist entry inherently
 * allows running arbitrary scripts via POSITIONAL arguments —
 * `powershell Get-Date` (implicit -Command) is the same class as
 * `bash evil.sh`. Operators who allowlist a bare shell accept that.
 *
 * CLASS BOUNDARY (W1d + W1e): flag-variant enumeration (W1d) plus
 * quote/join fail-closed (W1e: POSIX adjacent-quote join, intra-token
 * empty quotes, unquoted `\`-escape on flag compare, tokenize-null deny).
 * When L2 is skipped (enterprise auto-approve / session trust) the matcher
 * IS the last line for exec-flags on a bare allowlisted interpreter.
 * GTFOBins / positional `bash evil.sh`, `$VAR` under shell:true, win32
 * cmd grammar, and `[c]` pathname glob remain declared residuals.
 */
type ShellDenyKind = "posix" | "pwsh" | "deno" | "cmd"
const SHELL_FAMILY_DENY: Record<string, ShellDenyKind> = {
  sh: "posix",
  bash: "posix",
  zsh: "posix",
  pwsh: "pwsh",
  powershell: "pwsh",
  deno: "deno",
  bun: "deno",
  cmd: "cmd",
}

function shellDenyKind(argv0: string): ShellDenyKind | null {
  return SHELL_FAMILY_DENY[interpreterBasename(argv0)] ?? null
}

/**
 * Flag-compare only (not argv rewrite). Drop `'`/`"`; unquoted `\` consumes
 * the next char so `-\c` matches `-c`. Tokenizer already POSIX-joins adjacent
 * quoted spans (`"-"c` → `-c`); this is belt for leftover quote/`\` in a token.
 * Do not apply to path tokens in tokenizeSimpleArgv (Windows `C:\Users` must stay).
 */
function normalizeShellTokenForFlagMatch(token: string): string {
  let out = ""
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === "\\" && i + 1 < token.length) {
      out += token[++i]
      continue
    }
    if (c === "'" || c === '"') continue
    out += c
  }
  return out
}

function tokenIsDeniedShellFlag(kind: ShellDenyKind, token: string): boolean {
  token = normalizeShellTokenForFlagMatch(token)
  if (kind === "posix") {
    if (token === "-c") return true
    // Clustered shorts containing c (`-lc`, `-ec`, `-xc`) all execute a command.
    if (/^-[A-Za-z]{2,}$/.test(token) && token.includes("c")) return true
    return false
  }
  if (kind === "pwsh") {
    // PowerShell flags are case-insensitive, accept `-` / `--` / `/` prefixes
    // (WinPS 5.1 takes `/c`, `/Command`, `/com`…), and resolve any UNIQUE
    // PREFIX: `-com` = -Command, `-e`/`-enc` = -EncodedCommand. Deny any flag
    // whose name is a prefix of "command" / "encodedcommand" (incl. `=` glued
    // forms like `-c=Get-Date`). pwsh-only — posix `-e` (errexit) semantics
    // differ and must NOT be caught by this rule.
    // Path args are safe: `/tmp/x.ps1` has `/` after the name, so the `(?:=|$)`
    // boundary below does not match.
    const t = token.toLowerCase()
    const m = /^(?:--?|\/)([a-z]+)(?:=|$)/.exec(t)
    if (!m) return false
    // `-ec` is the conventional EncodedCommand shorthand but NOT a string
    // prefix of "encodedcommand" — deny it explicitly (all prefix styles).
    if (m[1] === "ec") return true
    return "command".startsWith(m[1]) || "encodedcommand".startsWith(m[1])
  }
  if (kind === "cmd") {
    // cmd.exe flags are case-insensitive; /c and /k both execute a command.
    // Exact match only — positional args like `cmd script.bat` stay allowed
    // (declared positional boundary above). cmd does not accept `-c`.
    const t = token.toLowerCase()
    return t === "/c" || t === "/k"
  }
  // deno/bun: `eval` subcommand, `-e`/`--eval`, and bun's print-eval `-p`/`--print`.
  return (
    token === "eval" ||
    token === "-e" ||
    token === "--eval" ||
    token.startsWith("--eval=") ||
    token === "-p" ||
    token === "--print" ||
    token.startsWith("--print=")
  )
}

function argvHasDeniedShellFlags(kind: ShellDenyKind, argv: string[]): boolean {
  for (let i = 1; i < argv.length; i++) {
    if (tokenIsDeniedShellFlag(kind, argv[i])) return true
  }
  return false
}

const INTERPRETER_BASENAMES = new Set([
  "python",
  "python3",
  "node",
  "nodejs",
  "ruby",
  "perl",
  "php",
  "lua",
  "osascript",
])

function interpreterBasename(argv0: string): string {
  const base = String(argv0).split(/[/\\]/).pop() || String(argv0)
  // Strip a trailing .exe so `bash.exe` / `powershell.exe` allowlist entries
  // still hit the shell-family / interpreter deny sets. Non-family lookups
  // (`grep.exe` → `grep`) are unaffected — `grep` is in neither set.
  return base.toLowerCase().replace(/\.exe$/, "")
}

function isKnownInterpreter(argv0: string): boolean {
  const b = interpreterBasename(argv0)
  if (INTERPRETER_BASENAMES.has(b)) return true
  if (/^python\d+(\.\d+)*$/.test(b)) return true
  return false
}

/**
 * Interpreter exec-flag denial. The generic rules (-c/-e/--command/--eval,
 * clustered shorts) apply to every known interpreter; `base` (normalized
 * basename of argv0) scopes interpreter-SPECIFIC flags so legit lookalikes
 * on other interpreters are not caught:
 * - node/nodejs: `-p`/`--print` (print-eval, mirrors deno/bun)
 * - perl: `-E` (uppercase -e; the generic -e is lowercase-only)
 * - php: `-r` (run code), `-R`/`-B` (per-line callbacks) — ruby's legit
 *   `-r` (require) is unaffected because the check is php-scoped.
 */
function tokenIsDeniedInterpreterFlag(token: string, clustered: boolean, base?: string): boolean {
  token = normalizeShellTokenForFlagMatch(token)
  if (token === "-c" || token === "-e" || token === "--command" || token === "--eval") return true
  if (token.startsWith("--command=") || token.startsWith("--eval=")) return true
  if (/^-c./.test(token)) return true
  if (/^-e./.test(token) && !token.startsWith("--")) return true
  if (clustered && /^-[A-Za-z]{2,}$/.test(token) && /[ce]/i.test(token)) return true
  if (base === "node" || base === "nodejs") {
    if (token === "-p" || token === "--print" || token.startsWith("--print=")) return true
  }
  if (base === "perl") {
    if (token === "-E") return true
  }
  if (base === "php") {
    if (token === "-r" || token === "-R" || token === "-B") return true
  }
  return false
}

function argvHasDeniedInterpreterFlags(argv: string[]): boolean {
  if (argv.length < 2) return false
  const base = interpreterBasename(argv[0])
  for (let i = 1; i < argv.length; i++) {
    if (tokenIsDeniedInterpreterFlag(argv[i], true, base)) return true
  }
  return false
}

/**
 * P1 SEC-07 + Batch C C3: allowlist match as argv template, not naive prefix.
 * Deny exec flags on parsed argv (quoted `python3 '-c'`). Clustered shorts
 * (-ic) only for known interpreters / shell families so `grep -ic` / `wc -c`
 * stay allowed. Shells use their own flag set — `bash -e` (errexit) is legal.
 * W1e: unparseable argv (tokenize null) is deny — no whitespace fallback allow.
 */
export function commandMatchesAllowlistEntry(command: string, entry: string): boolean {
  const cmd = command.trim()
  const ent = entry.trim()
  if (!cmd || !ent) return false
  if (cmd === ent) return true
  if (!cmd.startsWith(ent + " ")) return false
  if (/\s/.test(ent)) return true

  const tokens = tokenizeSimpleArgv(cmd)
  if (!tokens) return false
  let i = 0
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++
  const rest = tokens.slice(i)
  if (rest.length >= 2 && isKnownInterpreter(rest[0]) && argvHasDeniedInterpreterFlags(rest)) {
    return false
  }
  const kind = rest.length >= 2 ? shellDenyKind(rest[0]) : null
  if (kind && argvHasDeniedShellFlags(kind, rest)) {
    return false
  }
  return true
}

export function commandAllowedByPolicy(command: string): { ok: true } | { ok: false; error: string } {
  const mod = getModule("shell")
  if (!mod) return { ok: false, error: "shell module missing" }
  const policy = mod.policy || "confirm_per_command"
  if (policy === "allowlist") {
    // Reject metachar bypasses before prefix match (e.g. "echo ok; rm …")
    if (hasShellAllowlistMetachar(command)) {
      return {
        ok: false,
        error:
          "shell policy=allowlist rejects shell metacharacters (;|&`$()<> newlines); use a single allowlisted command or policy=confirm_per_command",
      }
    }
    const list = mod.allowlist_commands || []
    if (list.length === 0) {
      return { ok: false, error: "shell policy=allowlist but allowlist_commands is empty" }
    }
    const ok = list.some((entry) => commandMatchesAllowlistEntry(command, entry))
    if (!ok) {
      return {
        ok: false,
        error:
          "command not in allowlist_commands (argv template match; bare interpreters/shells reject exec flags)",
      }
    }
  }
  // confirm_per_command / confirm_session: allow at this layer; L2 gate still required
  return { ok: true }
}

/**
 * Pure pre-L2 / pre-exec scope check for shell_exec (Plan A/B G2).
 */
export function checkShellScope(command: string): { ok: true } | { ok: false; error: string } {
  const gate = requireModule("shell")
  if (!gate.ok) return gate
  const cmd = (command || "").trim()
  if (!cmd) return { ok: false, error: "command required" }
  if (cmd.length > 8000) return { ok: false, error: "command too long" }
  return commandAllowedByPolicy(cmd)
}

/**
 * C7 multi-adv: absolute effective cwd for shell_exec — same value for L2 token
 * bind, preview, and execute. Prefer params.cwd, then working_directory, then
 * workspaceRoot, then process.cwd(); always path.resolve.
 */
export function normalizeShellCwd(
  params: { cwd?: unknown; working_directory?: unknown },
  workspaceRoot?: string | null,
): string {
  const raw =
    (typeof params?.cwd === "string" && params.cwd.trim()
      ? params.cwd.trim()
      : null) ||
    (typeof params?.working_directory === "string" && params.working_directory.trim()
      ? params.working_directory.trim()
      : null) ||
    (typeof workspaceRoot === "string" && workspaceRoot.trim()
      ? workspaceRoot.trim()
      : null) ||
    process.cwd()
  return path.resolve(String(raw))
}

/**
 * P1 SEC-08: when workspaceRoot is set, cwd must resolve inside it
 * (realpath containment). Returns error string or null if OK.
 */
export function assertShellCwdInWorkspace(
  cwd: string,
  workspaceRoot?: string | null,
): string | null {
  if (!workspaceRoot || !String(workspaceRoot).trim()) return null
  try {
    const rootReal = fs.realpathSync(path.resolve(workspaceRoot))
    let cwdReal: string
    try {
      cwdReal = fs.realpathSync(path.resolve(cwd))
    } catch {
      // Not yet existing — contain the resolved path string
      cwdReal = path.resolve(cwd)
    }
    const rel = path.relative(rootReal, cwdReal)
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return `cwd escapes workspace_root (${workspaceRoot})`
    }
    return null
  } catch (e: any) {
    return `cwd/workspace containment check failed: ${e?.message || e}`
  }
}

/** Last N characters of s (for progress tails). */
export function tailChars(s: string, n: number = PROGRESS_TAIL_CHARS): string {
  if (!s) return ""
  if (s.length <= n) return s
  return s.slice(s.length - n)
}

export type ShellProgress = {
  elapsed_ms: number
  stdout_tail: string
  stderr_tail: string
}

/**
 * Options for Node spawn of shell_exec children (legacy shell:true path).
 * windowsHide: true on win32 so approved one-shots do not flash an empty console
 * (#au4dch black-window pain). Harmless no-op on non-win platforms.
 * detached:true on POSIX so the child is a process-group leader and
 * killProcessTree can SIGKILL the whole tree (timeout / chat.abort).
 */
export function shellSpawnOptions(cwd: string, env: NodeJS.ProcessEnv): {
  shell: true
  cwd: string
  env: NodeJS.ProcessEnv
  windowsHide: boolean
  detached: boolean
} {
  return {
    shell: true,
    cwd,
    env,
    windowsHide: true,
    // win32: taskkill /T walks the tree; detached not required and can orphan oddly.
    detached: process.platform !== "win32",
  }
}

/**
 * Tokenize a simple command. Returns null if metacharacters, wildcards, unclosed
 * quotes, or empty. Unlike tryParseSimpleArgv this keeps ENV= tokens so C3 can
 * strip them and still scan deny flags.
 *
 * W1e T-join: POSIX adjacent-quote concatenation — `"-"c` is one word `-c`,
 * `"foo""bar"` is `foobar`. Unquoted backslash is kept (Windows `C:\Users`);
 * flag-match `\`-consume lives in normalizeShellTokenForFlagMatch only.
 */
export function tokenizeSimpleArgv(command: string): string[] | null {
  const cmd = (command || "").trim()
  if (!cmd) return null
  if (hasShellAllowlistMetachar(cmd)) return null
  if (/[*?]/.test(cmd) || /\$\{/.test(cmd) || /\$[A-Za-z_]/.test(cmd)) return null

  const tokens: string[] = []
  let i = 0
  while (i < cmd.length) {
    while (i < cmd.length && /\s/.test(cmd[i])) i++
    if (i >= cmd.length) break
    let buf = ""
    while (i < cmd.length && !/\s/.test(cmd[i])) {
      const c = cmd[i]
      if (c === '"' || c === "'") {
        const quote = c
        i++
        while (i < cmd.length && cmd[i] !== quote) {
          if (
            cmd[i] === "\\" &&
            i + 1 < cmd.length &&
            (cmd[i + 1] === quote || cmd[i + 1] === "\\")
          ) {
            buf += cmd[i + 1]
            i += 2
            continue
          }
          buf += cmd[i]
          i++
        }
        if (i >= cmd.length) return null
        i++
      } else {
        buf += c
        i++
      }
    }
    tokens.push(buf)
  }
  if (tokens.length === 0) return null
  if (!tokens[0]) return null
  return tokens
}

/**
 * P1b: try parse a simple command into argv for spawn(..., { shell: false }).
 * Returns null if metacharacters present, empty, or unparseable.
 * Supports basic double/single quotes.
 * Backslash escapes only `\"`, `\'`, `\\` — never swallow path separators
 * (Windows `C:\Users\...` must stay intact; Pi N1 B2).
 */
export function tryParseSimpleArgv(command: string): string[] | null {
  const tokens = tokenizeSimpleArgv(command)
  if (!tokens) return null
  for (const t of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) return null
    if (t === "~" || t.startsWith("~/") || t.startsWith("~\\")) return null
  }
  return tokens
}

/**
 * Whether to spawn with shell:false + argv (P1b).
 * - Non-win32: any successful parse (true PE binaries / #! scripts work with shell:false).
 * - win32: ONLY when program ends with `.exe` or `.com`.
 *   Node on Windows **cannot** spawn `.bat`/`.cmd` without shell (EINVAL);
 *   bare names (`npm`, `echo`) are cmd shims/builtins — must stay shell:true
 *   (Pi N1 B1 / N1b: do not treat .bat/.cmd or allowlist as argv-safe on win32).
 */
export function shouldUseArgvSpawn(
  argv: string[] | null,
  opts?: { platform?: NodeJS.Platform; policy?: string },
): boolean {
  if (!argv || argv.length === 0) return false
  const platform = opts?.platform ?? process.platform
  void opts?.policy
  const prog = argv[0]
  const base = prog.replace(/^["']|["']$/g, "")
  if (platform === "win32") {
    // Only PE/COM — never .bat/.cmd or bare PATH names (Node EINVAL/ENOENT)
    return /\.(exe|com)$/i.test(base)
  }
  // POSIX: avoid shell builtins that fail under shell:false (cd/export/source/…)
  const builtin = new Set([
    "cd",
    "export",
    "source",
    ".",
    "eval",
    "set",
    "unset",
    "alias",
    "ulimit",
    "umask",
    "read",
    "hash",
    "type",
    "builtin",
    "command",
    "declare",
    "local",
    "return",
    "shift",
    "wait",
    "exec",
  ])
  const leaf = base.includes("/") ? base.split("/").pop() || base : base
  if (builtin.has(leaf)) return false
  return true
}

export function shellSpawnArgvOptions(cwd: string, env: NodeJS.ProcessEnv): {
  shell: false
  cwd: string
  env: NodeJS.ProcessEnv
  windowsHide: boolean
  detached: boolean
} {
  return {
    shell: false,
    cwd,
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
  }
}

export async function shellExec(opts: {
  command: string
  cwd?: string | null
  threadId?: string
  timeoutMs?: number
  /**
   * chat.abort / supersede AbortSignal from the LLM loop.
   * When aborted, killProcessTree and resolve with aborted:true.
   */
  signal?: AbortSignal
  /**
   * Registry key (tool_call_id). Enables shell.exec.abort by id.
   * Auto-generated when omitted.
   */
  runKey?: string
  /** Optional live progress for Side Panel tool.progress (not audited). */
  onProgress?: (p: ShellProgress) => void
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const gate = requireModule("shell")
  if (!gate.ok) return { success: false, error: gate.error }

  const command = (opts.command || "").trim()
  if (!command) return { success: false, error: "command required" }
  if (command.length > 8000) return { success: false, error: "command too long" }

  const policyOk = commandAllowedByPolicy(command)
  if (!policyOk.ok) return { success: false, error: policyOk.error }

  // Already aborted before spawn (chat.stop during L2 wait, etc.)
  if (opts.signal?.aborted) {
    return {
      success: false,
      error: "shell_exec aborted before start",
      data: { aborted: true, timed_out: false, exit_code: -1 },
    }
  }

  let cwd = opts.cwd || process.cwd()
  if (opts.cwd) {
    try {
      cwd = fs.realpathSync(path.resolve(opts.cwd))
      if (!fs.statSync(cwd).isDirectory()) {
        return { success: false, error: "cwd is not a directory" }
      }
    } catch {
      return { success: false, error: `invalid cwd: ${opts.cwd}` }
    }
  }

  const timeoutMs = resolveShellTimeoutMs(opts.timeoutMs)
  const started = Date.now()
  const runKey =
    typeof opts.runKey === "string" && opts.runKey.length > 0
      ? opts.runKey
      : `shell-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const threadId = opts.threadId ? String(opts.threadId) : null

  return new Promise((resolve) => {
    // P1b: shell:false + argv when parseable AND safe on this platform (see shouldUseArgvSpawn).
    const env = buildChildEnv()
    const argv = tryParseSimpleArgv(command)
    const useArgv = shouldUseArgvSpawn(argv)
    const child = useArgv && argv
      ? spawn(argv[0], argv.slice(1), shellSpawnArgvOptions(cwd, env))
      : spawn(command, shellSpawnOptions(cwd, env))

    let stdout = ""
    let stderr = ""
    /** null | timeout | abort — distinguishes chat.stop vs wall-clock kill. */
    let killReason: null | "timeout" | "abort" = null
    let settled = false
    let lastProgressAt = 0

    const emitProgress = (force = false) => {
      if (!opts.onProgress) return
      const now = Date.now()
      if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
      lastProgressAt = now
      try {
        opts.onProgress({
          elapsed_ms: now - started,
          stdout_tail: tailChars(stdout),
          stderr_tail: tailChars(stderr),
        })
      } catch {
        /* UI best-effort */
      }
    }

    const doKill = (reason: "timeout" | "abort") => {
      if (settled) return
      if (killReason == null) killReason = reason
      killProcessTree(child)
    }

    activeShellRuns.set(runKey, {
      threadId,
      kill: () => doKill("abort"),
    })

    const onAbortSignal = () => doKill("abort")
    if (opts.signal) {
      if (opts.signal.aborted) {
        doKill("abort")
      } else {
        opts.signal.addEventListener("abort", onAbortSignal, { once: true })
      }
    }

    const timer = setTimeout(() => doKill("timeout"), timeoutMs)

    const progressTimer = opts.onProgress
      ? setInterval(() => emitProgress(true), PROGRESS_INTERVAL_MS)
      : null

    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf-8")
      emitProgress(false)
    })
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf-8")
      emitProgress(false)
    })

    const cleanup = () => {
      settled = true
      clearTimeout(timer)
      if (progressTimer) clearInterval(progressTimer)
      opts.signal?.removeEventListener("abort", onAbortSignal)
      activeShellRuns.delete(runKey)
    }

    child.on("error", (err) => {
      cleanup()
      appendCapabilityAudit({
        type: "shell.command",
        thread_id: opts.threadId,
        cmd_len: command.length,
        at: new Date().toISOString(),
        error: err.message,
      })
      resolve({
        success: false,
        error: err.message,
        data: {
          aborted: killReason === "abort",
          timed_out: killReason === "timeout",
        },
      })
    })

    child.on("close", (code, signalName) => {
      cleanup()
      emitProgress(true)
      const timed_out = killReason === "timeout"
      const aborted = killReason === "abort"
      const exitCode = killReason != null ? -1 : code ?? -1
      appendCapabilityAudit({
        type: "shell.command",
        thread_id: opts.threadId,
        cmd_len: command.length,
        exit_code: exitCode,
        at: new Date().toISOString(),
      })
      // Keep success:true on non-zero / timeout / abort so the agent can read
      // partial stdout (same contract as pre-fix timeout). UI flags failed via
      // timed_out / aborted / exit_code.
      resolve({
        success: true,
        data: {
          exit_code: exitCode,
          signal: signalName || null,
          timed_out,
          aborted,
          duration_ms: Date.now() - started,
          timeout_ms: timeoutMs,
          cwd,
          spawn_mode: useArgv ? "argv" : "shell",
          stdout: stdout.slice(0, MAX_OUTPUT),
          stderr: stderr.slice(0, MAX_OUTPUT),
          truncated: stdout.length >= MAX_OUTPUT || stderr.length >= MAX_OUTPUT,
          note: "Command body not stored in audit log (default). Output shown to agent only.",
        },
      })
    })
  })
}
