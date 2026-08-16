// Run one ACP session over JSON-RPC stdio (true Client path).
// Falls back responsibility stays in manager when initialize fails.

import type { ChildProcessWithoutNullStreams } from "child_process"
import { spawnAcpChild } from "./win-spawn"
import { JsonRpcStdioClient, tryAcpInitialize } from "./jsonrpc-stdio"
import {
  capTimeline,
  parseSessionUpdate,
  timelineItem,
  type TimelineItem,
} from "./timeline"
import type { AcpSessionRecord } from "./types"
import { logger } from "../logger"

export type ProtocolSessionHooks = {
  onTimeline: (items: TimelineItem[], progress?: string) => void
  onPermission?: (req: {
    id: string | number
    title: string
    detail?: string
  }) => Promise<"allow" | "deny">
  onAgentSessionId?: (agentSessionId: string) => void
}

export type ProtocolSessionHandle = {
  child: ChildProcessWithoutNullStreams
  client: JsonRpcStdioClient
  agentSessionId: string | null
  transport: "acp"
  prompt: (text: string) => Promise<void>
  cancel: () => void
  kill: () => void
}

/**
 * Spawn agent and attempt ACP handshake + session/new.
 * Returns null if peer is not ACP (caller should use CLI bridge).
 */
export async function tryStartProtocolSession(opts: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string | undefined>
  session: AcpSessionRecord
  hooks: ProtocolSessionHooks
}): Promise<ProtocolSessionHandle | null> {
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawnAcpChild(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams
  } catch (e: any) {
    logger.warn("acp.protocol_spawn_failed", { err: e?.message || String(e) })
    return null
  }

  const client = new JsonRpcStdioClient(child)
  const timeline: TimelineItem[] = []
  const push = (items: TimelineItem[], progress?: string) => {
    for (const it of items) timeline.push(it)
    const capped = capTimeline(timeline)
    timeline.length = 0
    timeline.push(...capped)
    opts.hooks.onTimeline([...capped], progress)
  }

  client.on("notification", (method: string, params: unknown) => {
    if (method === "session/update" || method === "session/update_session") {
      const parsed = parseSessionUpdate(params)
      if (parsed.items.length) push(parsed.items, parsed.progress)
      return
    }
    push([timelineItem("status", `notify ${method}`)])
  })

  client.on("raw_line", (line: string) => {
    // During handshake noise, ignore; after session, treat as agent text
    push(
      [timelineItem("agent_message", line.slice(0, 200), { detail: line })],
      line.slice(-200),
    )
  })

  client.on("request", async (msg: { id?: string | number; method?: string; params?: unknown }) => {
    if (msg.method === "session/request_permission" || msg.method === "request_permission") {
      const p = (msg.params || {}) as Record<string, unknown>
      const title =
        (typeof p.title === "string" && p.title) ||
        (typeof p.toolName === "string" && p.toolName) ||
        "Agent 请求权限"
      const detail =
        typeof p.description === "string"
          ? p.description
          : typeof p.detail === "string"
            ? p.detail
            : JSON.stringify(p).slice(0, 500)
      push([timelineItem("permission", title, { detail, status: "pending" })])
      const decision = opts.hooks.onPermission
        ? await opts.hooks.onPermission({
            id: msg.id!,
            title,
            detail,
          })
        : "deny"
      if (msg.id != null) {
        if (decision === "allow") {
          // Prefer ACP-style outcome; agents may also accept { approved: true }
          client.respond(msg.id, {
            outcome: { outcome: "selected", optionId: "allow" },
            approved: true,
          })
        } else {
          client.respond(msg.id, {
            outcome: { outcome: "cancelled" },
            approved: false,
          })
        }
      }
      push([
        timelineItem("permission", `${title} → ${decision}`, {
          status: decision === "allow" ? "done" : "error",
        }),
      ])
      return
    }
    // Default deny unknown agent→client requests
    if (msg.id != null) {
      client.respondError(msg.id, -32601, `unsupported method ${msg.method}`)
    }
  })

  push([timelineItem("status", "ACP initialize…", { status: "running" })])
  const init = await tryAcpInitialize(client, 5000)
  if (!init.ok) {
    client.kill()
    return null
  }
  push([timelineItem("status", "ACP initialized", { status: "done" })])

  let agentSessionId: string | null = null
  try {
    const created = (await client.request(
      "session/new",
      {
        cwd: opts.cwd,
        mcpServers: [],
      },
      15_000,
    )) as Record<string, unknown>
    agentSessionId =
      (typeof created.sessionId === "string" && created.sessionId) ||
      (typeof created.session_id === "string" && created.session_id) ||
      null
    if (agentSessionId) opts.hooks.onAgentSessionId?.(agentSessionId)
    push([
      timelineItem("status", `session ${agentSessionId || "ok"}`, { status: "done" }),
    ])
  } catch (e: any) {
    logger.warn("acp.session_new_failed", { err: e?.message || String(e) })
    client.kill()
    return null
  }

  const prompt = async (text: string) => {
    if (!agentSessionId) throw new Error("no agent session")
    push([timelineItem("user_message", text.slice(0, 200), { detail: text })])
    await client.request(
      "session/prompt",
      {
        sessionId: agentSessionId,
        prompt: [{ type: "text", text }],
      },
      15 * 60_000,
    )
    push([timelineItem("status", "turn complete", { status: "done" })])
  }

  return {
    child,
    client,
    agentSessionId,
    transport: "acp",
    prompt,
    cancel: () => {
      if (agentSessionId) {
        try {
          client.notify("session/cancel", { sessionId: agentSessionId })
        } catch {
          /* */
        }
      }
      client.kill()
    },
    kill: () => client.kill(),
  }
}
