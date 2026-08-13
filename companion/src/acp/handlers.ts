// ACP WS handlers — list / cancel / UI-start with origin-bound L2 confirm.

import { getConfig } from "../config"
import { logger } from "../logger"
import type {
  SecurityConfirmationDecision,
  SecurityConfirmationDetails,
} from "../security-confirmation"
import { getAcpManager } from "./manager"

export interface AcpHandlerContext {
  requestConfirmation?: (
    details: SecurityConfirmationDetails,
  ) => Promise<SecurityConfirmationDecision>
  broadcast?: (data: any) => void
  /** Active thread from side panel when available */
  threadId?: string
  getWorkspaceRoot?: (threadId: string) => string | null | undefined
}

let broadcastHooked = false

/** Wire manager live events → WS broadcast (idempotent). */
export function ensureAcpBroadcast(broadcast: (data: any) => void): void {
  if (broadcastHooked) return
  broadcastHooked = true
  getAcpManager().onEvent((ev) => {
    try {
      broadcast(ev)
    } catch {
      /* ignore */
    }
  })
}

export async function handleAcpWsMessage(
  type: string,
  msg: Record<string, unknown>,
  ctx: AcpHandlerContext,
): Promise<any> {
  const mgr = getAcpManager()
  if (ctx.broadcast) ensureAcpBroadcast(ctx.broadcast)

  if (type === "acp.list" || type === "acp.rediscover") {
    const cfg = getConfig()
    const force = type === "acp.rediscover"
    if (force) {
      const { _resetDiscoverCache, discoverCodingAgents } = await import("./discover")
      _resetDiscoverCache()
      discoverCodingAgents(true)
    }
    return {
      type: "acp.list",
      enabled: !!cfg.acp?.enabled,
      agents: mgr.listAgents(),
      auto_suggest: cfg.coding_handoff?.auto_suggest !== false,
    }
  }

  if (type === "acp.session.cancel") {
    const sid = String(msg.session_id || "")
    if (!sid) return { type: "error", error: "session_id required" }
    const r = mgr.cancel(sid)
    if (!r.ok) return { type: "error", error: r.error }
    return { type: "acp.session.cancel.ack", session_id: sid }
  }

  if (type === "acp.ui_start") {
    // Side Panel user gesture: propose + L2 confirm + start, with live events.
    const cfg = getConfig()
    if (!cfg.acp?.enabled) {
      return { type: "error", error: "acp: feature disabled — enable in 设置 → 编程助手" }
    }
    const threadId = String(msg.thread_id || ctx.threadId || "")
    if (!threadId) return { type: "error", error: "thread_id required" }
    const agentId = String(msg.agent_id || "")
    const goal = String(msg.goal || "").trim()
    if (!agentId) return { type: "error", error: "agent_id required" }
    if (!goal) return { type: "error", error: "goal required" }

    const workspaceRoot =
      (typeof msg.workspace_root === "string" && msg.workspace_root) ||
      ctx.getWorkspaceRoot?.(threadId) ||
      null

    const proposed = mgr.propose({
      threadId,
      agentId,
      goal,
      workspaceRoot,
    })
    if (!proposed.ok) return { type: "error", error: proposed.error }

    const session = proposed.session
    if (!ctx.requestConfirmation) {
      mgr.cancel(session.session_id)
      return { type: "error", error: "acp.ui_start requires confirmation channel" }
    }

    const label = mgr.listAgents().find((a) => a.id === agentId)?.display_name || agentId
    const decision = await ctx.requestConfirmation({
      toolName: "acp_start_session",
      dangerousApis: ["acp_start_session"],
      code: `启动编程助手「${label}」只读审查\n仓库: ${session.workspace_root}\n任务: ${goal.slice(0, 200)}\nsession=${session.session_id}`,
      riskLevel: "high",
      autoConfirmEligible: false,
      criticalApis: ["acp_start_session"],
    })

    if (!decision?.approved) {
      mgr.cancel(session.session_id)
      return {
        type: "acp.ui_start.denied",
        session_id: session.session_id,
        error: "user_denied",
      }
    }

    // Fire-and-forget start so WS reply is immediate; progress via acp.session.event
    void mgr.start(session.session_id).then((r) => {
      if (!r.ok) {
        logger.warn("acp.ui_start_failed", { session_id: session.session_id, err: r.error })
      }
    })

    return {
      type: "acp.ui_start.accepted",
      session_id: session.session_id,
      agent_id: agentId,
      thread_id: threadId,
      state: "running",
    }
  }

  return null
}
