// terminal.* WS handler (spec §4/§5). Panel-only. L2 on open never skipped by cruise.

import { getConfig } from "../config"
import type { ThreadManager } from "../threads/thread-manager"
import { resolveTerminalStartCwd } from "./cwd"
import {
  ackPty,
  closePty,
  pausePty,
  resizePty,
  resumePty,
  spawnPtySession,
  writePtyInput,
  ptyHostPlatform,
} from "./session"

type Services = { threadManager: ThreadManager }
type Session = {
  sendToExtension: (data: unknown) => void
  requestConfirmation?: (details: {
    toolName: string
    dangerousApis: string[]
    code: string
  }) => Promise<{ approved: boolean }>
  surface?: string
}

function clampSize(n: unknown, fallback: number, max: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(1, Math.floor(n)))
}

function deny(error: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { type: "error", error, ...extra }
}

export async function handleTerminalMessage(
  type: string,
  rest: Record<string, unknown>,
  services: Services,
  session: Session | undefined,
  _stampedSurface: string | undefined,
): Promise<Record<string, unknown>> {
  const id = typeof rest.id === "string" ? rest.id.trim() : ""
  const surface = session?.surface

  if (surface !== "panel") {
    return deny("terminal.* is panel-only (Side Panel / extension tab)", {
      error_code: surface === "summoner" ? "SUMMONER_ACL" : "TERMINAL_SURFACE",
    })
  }

  if (type === "terminal.open") {
    if (!id) return deny("terminal.open requires id")
    if (rest.user_gesture !== true) {
      return deny("terminal.open requires user_gesture:true")
    }
    if (getConfig().embedded_terminal?.enabled !== true) {
      return deny("embedded_terminal_disabled")
    }
    if (ptyHostPlatform() !== "darwin") {
      return {
        type: "terminal.closed",
        id,
        code: "unsupported",
        signal: 0,
        error: "内嵌终端仅支持 macOS（darwin）；Windows/Linux 另票。",
      }
    }

    const threadId = typeof rest.thread_id === "string" ? rest.thread_id.trim() : ""
    let workspaceRoot: string | null = null
    if (threadId) {
      const thr = services.threadManager.get(threadId)
      if (!thr) return deny(`Thread not found: ${threadId}`)
      if (thr.execution_policy === "plan_readonly") {
        return deny("PLAN_READONLY: terminal.open denied for this thread")
      }
      workspaceRoot = typeof thr.workspace_root === "string" ? thr.workspace_root : null
    }

    const cwdRes = resolveTerminalStartCwd({
      requested: typeof rest.cwd === "string" ? rest.cwd : undefined,
      workspaceRoot,
    })
    if (!cwdRes.ok) return deny(cwdRes.error)

    if (!session?.requestConfirmation) {
      return deny("terminal.open requires an origin-bound confirmation channel")
    }
    const decision = await session.requestConfirmation({
      toolName: "terminal.open",
      dangerousApis: ["pty", "shell"],
      code: `open PTY cwd=${cwdRes.cwd}`,
    })
    if (!decision.approved) {
      return {
        type: "terminal.closed",
        id,
        code: "denied",
        signal: 0,
      }
    }

    const send = (frame: Record<string, unknown>) => {
      try {
        session.sendToExtension(frame)
      } catch {
        /* ignore */
      }
    }
    const spawned = spawnPtySession({
      id,
      cols: clampSize(rest.cols, 80, 500),
      rows: clampSize(rest.rows, 24, 200),
      cwd: cwdRes.cwd,
      threadId: threadId || undefined,
      send,
    })
    if (!spawned.ok) {
      if (spawned.code === "unsupported") {
        return {
          type: "terminal.closed",
          id,
          code: "unsupported",
          signal: 0,
          error: spawned.error,
        }
      }
      return deny(spawned.error)
    }
    return { type: "terminal.opened", id, pid: spawned.pid, platform: "darwin" }
  }

  if (!id) return deny(`${type} requires id`)

  if (type === "terminal.input") {
    if (typeof rest.b64 !== "string") return deny("terminal.input requires b64")
    const r = writePtyInput(id, rest.b64)
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  if (type === "terminal.resize") {
    const r = resizePty(id, clampSize(rest.cols, 80, 500), clampSize(rest.rows, 24, 200))
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  if (type === "terminal.ack") {
    if (typeof rest.seq !== "number" || !Number.isFinite(rest.seq)) {
      return deny("terminal.ack requires seq")
    }
    const r = ackPty(id, Math.floor(rest.seq))
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  if (type === "terminal.pause") {
    const r = pausePty(id)
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  if (type === "terminal.resume") {
    const r = resumePty(id)
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  if (type === "terminal.close") {
    const r = closePty(id)
    return r.ok ? { type: "terminal.ok", id } : deny(r.error)
  }
  return deny(`Unhandled terminal type: ${type}`)
}
