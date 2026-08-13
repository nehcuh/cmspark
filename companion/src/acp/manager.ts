// ACP session manager — Phase B read-only review (default off).
// Spawns configured stdio agent with a single prompt; collects stdout as handback.
// Full JSON-RPC ACP dialect can be swapped in later without changing tool surface.

import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import * as fs from "fs"
import { getConfig } from "../config"
import { logger } from "../logger"
import type { AcpSessionRecord, AcpPolicyProfile } from "./types"
import { resolveAcpWorkspaceRoot } from "./workspace-bind"
import { frameAcpHandback } from "./handback"
import { markAcpHandbackSeen } from "./taint"

function newSessionId(): string {
  return `acp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export class AcpManager {
  private sessions = new Map<string, AcpSessionRecord>()
  private processes = new Map<string, ChildProcessWithoutNullStreams>()
  private runningCount = 0

  listAgents(): Array<{
    id: string
    display_name: string
    enabled: boolean
    profile: string
    command: string
  }> {
    const cfg = getConfig()
    const acp = cfg.acp
    if (!acp?.enabled) return []
    return Object.entries(acp.servers || {}).map(([id, s]) => ({
      id,
      display_name: s.display_name,
      enabled: s.enabled && !!s.command,
      profile: s.policy.profile,
      command: s.command,
    }))
  }

  getSession(sessionId: string): AcpSessionRecord | undefined {
    return this.sessions.get(sessionId)
  }

  listSessionsForThread(threadId: string): AcpSessionRecord[] {
    return [...this.sessions.values()].filter((s) => s.thread_id === threadId)
  }

  /**
   * Create an offered session (does not spawn). Caller must confirm then start.
   */
  propose(opts: {
    threadId: string
    agentId: string
    goal: string
    workspaceRoot?: string | null
  }): { ok: true; session: AcpSessionRecord } | { ok: false; error: string } {
    const cfg = getConfig()
    if (!cfg.acp?.enabled) {
      return { ok: false, error: "acp: feature disabled (config.acp.enabled=false)" }
    }
    const server = cfg.acp.servers[opts.agentId]
    if (!server || !server.enabled || !server.command) {
      return { ok: false, error: `acp: unknown or disabled agent "${opts.agentId}"` }
    }
    if (server.policy.profile !== "review_readonly" && !server.policy.allow_write) {
      // Phase B only ships review_readonly by default
    }
    if (this.runningCount >= 1) {
      return { ok: false, error: "ACP_SESSION_BUSY: only one ACP session at a time (Phase B)" }
    }
    for (const s of this.sessions.values()) {
      if (s.thread_id === opts.threadId && (s.state === "running" || s.state === "offered")) {
        return { ok: false, error: "ACP_SESSION_BUSY: thread already has an ACP session" }
      }
    }
    const ws = resolveAcpWorkspaceRoot(opts.workspaceRoot)
    if (!ws.ok) return { ok: false, error: ws.error }

    const profile: AcpPolicyProfile =
      server.policy.profile === "review_readonly" ? "review_readonly" : "review_readonly"

    const session: AcpSessionRecord = {
      session_id: newSessionId(),
      thread_id: opts.threadId,
      agent_id: opts.agentId,
      state: "offered",
      workspace_root: ws.root,
      profile,
      goal: String(opts.goal || "").slice(0, 8000),
      created_at: new Date().toISOString(),
      partial: false,
    }
    this.sessions.set(session.session_id, session)
    logger.info("acp.offer", { session_id: session.session_id, agent: opts.agentId })
    return { ok: true, session }
  }

  /**
   * Start after user confirm. Spawns child with review prompt; non-interactive best-effort.
   */
  async start(sessionId: string): Promise<
    | { ok: true; session: AcpSessionRecord }
    | { ok: false; error: string }
  > {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, error: "acp: unknown session" }
    if (session.state !== "offered" && session.state !== "confirmed") {
      return { ok: false, error: `acp: cannot start from state ${session.state}` }
    }
    const cfg = getConfig()
    if (!cfg.acp?.enabled) return { ok: false, error: "acp: feature disabled" }
    const server = cfg.acp.servers[session.agent_id]
    if (!server?.command) return { ok: false, error: "acp: agent config missing" }

    session.state = "confirmed"
    this.runningCount++
    session.state = "running"

    const prompt = [
      "You are running under CMspark 编程接力 (read-only review session).",
      "Do NOT modify files, run package installs, or git push.",
      `Workspace: ${session.workspace_root}`,
      "",
      "Task:",
      session.goal,
      "",
      "Return a structured code review: findings (severity), files of interest, residual risks.",
    ].join("\n")

    // Prefer writing prompt to a temp file under workspace for agents that read files;
    // also pass via stdin for CLI tools that accept stdin.
    const promptPath = `${session.workspace_root}/.cmspark-acp-review-prompt.md`
    try {
      fs.writeFileSync(promptPath, prompt, { encoding: "utf8", mode: 0o600 })
    } catch (e: any) {
      this.runningCount = Math.max(0, this.runningCount - 1)
      session.state = "closed"
      session.error = `cannot write prompt file: ${e?.message || e}`
      return { ok: false, error: session.error }
    }

    const args = [...(server.args || [])]
    // Generic: many agents accept a prompt file path as last arg if args empty
    if (args.length === 0) {
      args.push(promptPath)
    }

    return await new Promise((resolve) => {
      let stdout = ""
      let stderr = ""
      const maxOut = server.policy.max_handback_chars ?? 48_000
      const timeoutMs = server.policy.session_timeout_ms ?? 15 * 60_000

      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(server.command, args, {
          cwd: session.workspace_root,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            USERPROFILE: process.env.USERPROFILE,
            LANG: process.env.LANG,
            ...(server.env || {}),
            // Never inject Companion API keys / CMSPARK secrets
            CMSPARK_ACP_SESSION: session.session_id,
            CMSPARK_ACP_MODE: "review_readonly",
          },
          stdio: ["pipe", "pipe", "pipe"],
        })
      } catch (e: any) {
        this.runningCount = Math.max(0, this.runningCount - 1)
        session.state = "closed"
        const errMsg = e?.message || String(e)
        session.error = errMsg
        resolve({ ok: false, error: errMsg })
        return
      }

      session.pid = child.pid
      this.processes.set(sessionId, child)

      try {
        child.stdin.write(prompt)
        child.stdin.end()
      } catch {
        /* some CLIs ignore stdin */
      }

      const timer = setTimeout(() => {
        session.partial = true
        try {
          child.kill("SIGTERM")
        } catch {
          /* */
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL")
          } catch {
            /* */
          }
        }, 2000)
      }, timeoutMs)

      child.stdout.on("data", (buf: Buffer) => {
        stdout += buf.toString("utf8")
        if (stdout.length > maxOut * 2) stdout = stdout.slice(-maxOut)
      })
      child.stderr.on("data", (buf: Buffer) => {
        stderr += buf.toString("utf8")
        if (stderr.length > 8000) stderr = stderr.slice(-8000)
      })

      child.on("error", (err) => {
        clearTimeout(timer)
        this.runningCount = Math.max(0, this.runningCount - 1)
        this.processes.delete(sessionId)
        session.state = "closed"
        const msg = err?.message || String(err)
        session.error = msg
        logger.warn("acp.spawn_error", { session_id: sessionId, err: msg })
        resolve({ ok: false, error: msg })
      })

      child.on("close", (code) => {
        clearTimeout(timer)
        this.runningCount = Math.max(0, this.runningCount - 1)
        this.processes.delete(sessionId)
        const body =
          stdout.trim() ||
          stderr.trim() ||
          `(agent exited code=${code} with no output; prompt at ${promptPath})`
        session.handback_text = frameAcpHandback({
          agentId: session.agent_id,
          sessionId: session.session_id,
          profile: session.profile,
          partial: session.partial || code !== 0,
          body,
          maxChars: maxOut,
        })
        session.state = "handback"
        markAcpHandbackSeen(session.thread_id)
        // move to closed after handback is collected
        session.state = "closed"
        try {
          fs.unlinkSync(promptPath)
        } catch {
          /* best-effort */
        }
        logger.info("acp.session_ended", {
          session_id: sessionId,
          code,
          handback_len: session.handback_text?.length,
        })
        resolve({ ok: true, session })
      })
    })
  }

  cancel(sessionId: string): { ok: true } | { ok: false; error: string } {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, error: "acp: unknown session" }
    const child = this.processes.get(sessionId)
    if (child) {
      try {
        child.kill("SIGTERM")
      } catch {
        /* */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL")
        } catch {
          /* */
        }
      }, 1500)
    }
    if (session.state === "offered") {
      session.state = "closed"
      session.error = "cancelled"
    }
    return { ok: true }
  }

  shutdown(): void {
    for (const id of [...this.processes.keys()]) {
      this.cancel(id)
    }
  }
}

let singleton: AcpManager | null = null

export function getAcpManager(): AcpManager {
  if (!singleton) singleton = new AcpManager()
  return singleton
}

export function _resetAcpManagerForTests(): void {
  singleton?.shutdown()
  singleton = null
}
