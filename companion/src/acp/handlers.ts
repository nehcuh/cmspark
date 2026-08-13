// ACP WS handlers — list / cancel / UI-start / followup / adopt / apply.

import { getConfig, saveConfig } from "../config"
import { logger } from "../logger"
import type {
  SecurityConfirmationDecision,
  SecurityConfirmationDetails,
} from "../security-confirmation"
import { getAcpManager } from "./manager"
import { discoverCodingAgents, _resetDiscoverCache } from "./discover"

export interface AcpHandlerContext {
  requestConfirmation?: (
    details: SecurityConfirmationDetails,
  ) => Promise<SecurityConfirmationDecision>
  broadcast?: (data: any) => void
  threadId?: string
  getWorkspaceRoot?: (threadId: string) => string | null | undefined
  /** Return agent_role for thread if known (refuse worker). */
  getAgentRole?: (threadId: string) => string | undefined
}

let broadcastHooked = false

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

async function confirmOrDeny(
  ctx: AcpHandlerContext,
  details: SecurityConfirmationDetails,
): Promise<boolean> {
  if (!ctx.requestConfirmation) return false
  const decision = await ctx.requestConfirmation(details)
  return !!decision?.approved
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
    if (type === "acp.rediscover") {
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

  if (type === "acp.adopt_discovered") {
    // Persist discovered agents into config.acp.servers (user gesture from settings)
    const cfg = getConfig()
    if (!cfg.acp) {
      return { type: "error", error: "acp config missing" }
    }
    const ids = Array.isArray(msg.agent_ids)
      ? msg.agent_ids.map(String)
      : discoverCodingAgents(true).map((d) => d.id)
    const discovered = discoverCodingAgents(true)
    const servers = { ...(cfg.acp.servers || {}) }
    let added = 0
    for (const d of discovered) {
      if (ids.length && !ids.includes(d.id)) continue
      if (servers[d.id]?.command) continue
      servers[d.id] = {
        enabled: true,
        display_name: d.display_name,
        transport: "stdio",
        command: d.command,
        args: [],
        policy: {
          profile: "review_readonly",
          allow_write: false,
          allow_exec: false,
        },
      }
      added++
    }
    saveConfig({
      acp: {
        ...cfg.acp,
        enabled: cfg.acp.enabled === true ? true : cfg.acp.enabled,
        servers,
      },
    })
    logger.info("acp.adopt_discovered", { added, total: Object.keys(servers).length })
    return {
      type: "acp.list",
      enabled: !!getConfig().acp?.enabled,
      agents: mgr.listAgents(),
      adopted: added,
    }
  }

  if (type === "acp.session.cancel") {
    const sid = String(msg.session_id || "")
    if (!sid) return { type: "error", error: "session_id required" }
    const r = mgr.cancel(sid)
    if (!r.ok) return { type: "error", error: r.error }
    return { type: "acp.session.cancel.ack", session_id: sid }
  }

  if (type === "acp.ui_start" || type === "acp.session.followup") {
    const cfg = getConfig()
    if (!cfg.acp?.enabled) {
      return { type: "error", error: "acp: feature disabled — enable in 设置 → 编程助手" }
    }
    const mode =
      msg.mode === "propose_diff" ? "propose_diff" : "review_readonly"

    let proposed:
      | { ok: true; session: import("./types").AcpSessionRecord }
      | { ok: false; error: string }

    if (type === "acp.session.followup") {
      const parentId = String(msg.session_id || msg.parent_session_id || "")
      const goal = String(msg.goal || "").trim()
      if (!parentId || !goal) {
        return { type: "error", error: "session_id and goal required for followup" }
      }
      const parent = mgr.getSession(parentId)
      // inherit parent mode unless UI overrides with msg.mode
      const followMode =
        msg.mode === "propose_diff" || msg.mode === "review_readonly"
          ? (msg.mode as "review_readonly" | "propose_diff")
          : parent?.mode || "review_readonly"
      proposed = mgr.followup({
        parentSessionId: parentId,
        goal,
        mode: followMode,
      })
    } else {
      const threadId = String(msg.thread_id || ctx.threadId || "")
      if (!threadId) return { type: "error", error: "thread_id required" }
      if (ctx.getAgentRole?.(threadId) === "worker") {
        return { type: "error", error: "acp: worker threads cannot start ACP sessions" }
      }
      const agentId = String(msg.agent_id || "")
      const goal = String(msg.goal || "").trim()
      if (!agentId) return { type: "error", error: "agent_id required" }
      if (!goal) return { type: "error", error: "goal required" }
      const workspaceRoot =
        (typeof msg.workspace_root === "string" && msg.workspace_root) ||
        ctx.getWorkspaceRoot?.(threadId) ||
        null
      proposed = mgr.propose({
        threadId,
        agentId,
        goal,
        workspaceRoot,
        mode: mode as "review_readonly" | "propose_diff",
      })
    }

    if (!proposed.ok) return { type: "error", error: proposed.error }
    const session = proposed.session

    const label =
      mgr.listAgents().find((a) => a.id === session.agent_id)?.display_name ||
      session.agent_id
    const effectiveMode = session.mode || mode
    const modeLabel =
      effectiveMode === "propose_diff" ? "起草修改(propose-diff)" : "审查"
    const approved = await confirmOrDeny(ctx, {
      toolName: "acp_start_session",
      dangerousApis: ["acp_start_session"],
      code: `启动编程助手「${label}」${modeLabel}\n仓库: ${session.workspace_root}\n任务: ${session.goal.slice(0, 200)}\nsession=${session.session_id}`,
      riskLevel: "high",
      autoConfirmEligible: false,
      criticalApis: ["acp_start_session"],
    })

    if (!approved) {
      mgr.cancel(session.session_id)
      return {
        type: "acp.ui_start.denied",
        session_id: session.session_id,
        error: "user_denied",
      }
    }

    void mgr.start(session.session_id).then((r) => {
      if (!r.ok) {
        logger.warn("acp.ui_start_failed", { session_id: session.session_id, err: r.error })
      }
    })

    return {
      type: "acp.ui_start.accepted",
      session_id: session.session_id,
      agent_id: session.agent_id,
      thread_id: session.thread_id,
      mode: effectiveMode,
      state: "running",
    }
  }

  if (type === "acp.apply_diff") {
    const sid = String(msg.session_id || "")
    if (!sid) return { type: "error", error: "session_id required" }
    const session = mgr.getSession(sid)
    if (!session) return { type: "error", error: "unknown session" }
    if (session.mode !== "propose_diff") {
      return { type: "error", error: "session is not propose_diff" }
    }
    const paths = Array.isArray(msg.paths) ? msg.paths.map(String) : undefined
    const approved = await confirmOrDeny(ctx, {
      toolName: "acp_apply_diff",
      dangerousApis: ["acp_apply_diff"],
      code: `应用编程接力 diff 到工作区\nsession=${sid}\n仓库: ${session.workspace_root}\nfiles=${(paths || session.pending_diffs?.map((d) => d.relPath) || []).slice(0, 20).join(", ")}`,
      riskLevel: "high",
      autoConfirmEligible: false,
      criticalApis: ["acp_apply_diff"],
    })
    if (!approved) {
      return { type: "acp.apply_diff.denied", session_id: sid, error: "user_denied" }
    }
    const r = mgr.applyPendingDiffs(sid, {
      paths,
      allowDelete: msg.allow_delete === true,
    })
    if (ctx.broadcast) {
      ctx.broadcast({
        type: "acp.apply_diff.result",
        session_id: sid,
        thread_id: session.thread_id,
        ...r,
      })
    }
    return { type: "acp.apply_diff.result", session_id: sid, thread_id: session.thread_id, ...r }
  }

  return null
}
