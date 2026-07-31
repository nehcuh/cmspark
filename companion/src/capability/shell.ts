// Shell capability — confirm_per_command one-shot exec (no free interactive PTY by default)
// Spec S10: default per-command confirmation via L2 security_token gate.
// #au4dch SH-A: windowsHide on win32 + optional onProgress for tool.progress tails.

import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { getModule, requireModule } from "./modules"
import { appendCapabilityAudit } from "../packs/audit-log"
import { getUserEnvVars } from "../user-env"

const MAX_OUTPUT = 200_000
const DEFAULT_TIMEOUT_MS = 60_000
/** Max chars of each stream sent on each progress tick (WS payload hygiene). */
export const PROGRESS_TAIL_CHARS = 2_000
const PROGRESS_INTERVAL_MS = 750

/**
 * Child env for shell_exec (ADR-019).
 * Merge order: process.env → user_env → force CMSPARK_SHELL (cannot be overridden by user).
 */
export function buildChildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...getUserEnvVars(),
    CMSPARK_SHELL: "1",
  }
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
 * Options for Node spawn of shell_exec children.
 * windowsHide: true on win32 so approved one-shots do not flash an empty console
 * (#au4dch black-window pain). Harmless no-op on non-win platforms.
 */
export function shellSpawnOptions(cwd: string, env: NodeJS.ProcessEnv): {
  shell: true
  cwd: string
  env: NodeJS.ProcessEnv
  windowsHide: boolean
} {
  return {
    shell: true,
    cwd,
    env,
    windowsHide: true,
  }
}

export async function shellExec(opts: {
  command: string
  cwd?: string | null
  threadId?: string
  timeoutMs?: number
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

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const started = Date.now()

  return new Promise((resolve) => {
    // Use shell: true for one-shot; confirmation already happened at L2
    const child = spawn(command, shellSpawnOptions(cwd, buildChildEnv()))

    let stdout = ""
    let stderr = ""
    let killed = false
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

    const timer = setTimeout(() => {
      killed = true
      try {
        child.kill("SIGKILL")
      } catch {
        /* ignore */
      }
    }, timeoutMs)

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

    const cleanupProgress = () => {
      if (progressTimer) clearInterval(progressTimer)
    }

    child.on("error", (err) => {
      clearTimeout(timer)
      cleanupProgress()
      appendCapabilityAudit({
        type: "shell.command",
        thread_id: opts.threadId,
        cmd_len: command.length,
        at: new Date().toISOString(),
        error: err.message,
      })
      resolve({ success: false, error: err.message })
    })

    child.on("close", (code, signal) => {
      clearTimeout(timer)
      cleanupProgress()
      emitProgress(true)
      const exitCode = killed ? -1 : code ?? -1
      appendCapabilityAudit({
        type: "shell.command",
        thread_id: opts.threadId,
        cmd_len: command.length,
        exit_code: exitCode,
        at: new Date().toISOString(),
      })
      resolve({
        success: true,
        data: {
          exit_code: exitCode,
          signal: signal || null,
          timed_out: killed,
          duration_ms: Date.now() - started,
          cwd,
          stdout: stdout.slice(0, MAX_OUTPUT),
          stderr: stderr.slice(0, MAX_OUTPUT),
          truncated: stdout.length >= MAX_OUTPUT || stderr.length >= MAX_OUTPUT,
          note: "Command body not stored in audit log (default). Output shown to agent only.",
        },
      })
    })
  })
}
