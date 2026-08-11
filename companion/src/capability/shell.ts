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
    const ok = list.some((prefix) => command === prefix || command.startsWith(prefix + " "))
    if (!ok) return { ok: false, error: `command not in allowlist_commands` }
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
 * P1b: try parse a simple command into argv for spawn(..., { shell: false }).
 * Returns null if metacharacters present, empty, or unparseable.
 * Supports basic double/single quotes.
 * Backslash escapes only `\"`, `\'`, `\\` — never swallow path separators
 * (Windows `C:\Users\...` must stay intact; Pi N1 B2).
 */
export function tryParseSimpleArgv(command: string): string[] | null {
  const cmd = (command || "").trim()
  if (!cmd) return null
  if (hasShellAllowlistMetachar(cmd)) return null
  // Reject unquoted wildcards / env expansion residual for argv mode
  if (/[*?]/.test(cmd) || /\$\{/.test(cmd) || /\$[A-Za-z_]/.test(cmd)) return null

  const tokens: string[] = []
  let i = 0
  while (i < cmd.length) {
    while (i < cmd.length && /\s/.test(cmd[i])) i++
    if (i >= cmd.length) break
    const c = cmd[i]
    if (c === '"' || c === "'") {
      const quote = c
      i++
      let buf = ""
      while (i < cmd.length && cmd[i] !== quote) {
        // Only escape quote or backslash — leave Windows path backslashes alone
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
      if (i >= cmd.length) return null // unclosed quote
      i++ // closing quote
      tokens.push(buf)
    } else {
      let buf = ""
      while (i < cmd.length && !/\s/.test(cmd[i])) {
        buf += cmd[i]
        i++
      }
      tokens.push(buf)
    }
  }
  if (tokens.length === 0) return null
  // First token must look like a program name (no empty)
  if (!tokens[0]) return null
  // S41 multi-adv P0: ENV=value prefixes (FOO=1 cmd) and unquoted ~ need shell.
  // Under shell:false, spawn("FOO=1", …) is ENOENT and ~ is a literal path.
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
