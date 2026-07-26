// Shell capability — confirm_per_command one-shot exec (no free interactive PTY by default)
// Spec S10: default per-command confirmation via L2 security_token gate.

import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { getModule, requireModule } from "./modules"
import { appendCapabilityAudit } from "../packs/audit-log"

const MAX_OUTPUT = 200_000
const DEFAULT_TIMEOUT_MS = 60_000

export function commandAllowedByPolicy(command: string): { ok: true } | { ok: false; error: string } {
  const mod = getModule("shell")
  if (!mod) return { ok: false, error: "shell module missing" }
  const policy = mod.policy || "confirm_per_command"
  if (policy === "allowlist") {
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

export async function shellExec(opts: {
  command: string
  cwd?: string | null
  threadId?: string
  timeoutMs?: number
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
    const child = spawn(command, {
      shell: true,
      cwd,
      env: { ...process.env, CMSPARK_SHELL: "1" },
    })

    let stdout = ""
    let stderr = ""
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      try {
        child.kill("SIGKILL")
      } catch {
        /* ignore */
      }
    }, timeoutMs)

    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf-8")
    })
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf-8")
    })

    child.on("error", (err) => {
      clearTimeout(timer)
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
