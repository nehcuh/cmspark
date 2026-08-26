// MCP namespaced + meta tool dispatch (executeMcpTool / executeMcpMetaTool).
// Extracted from server.ts (C10 Phase E2 mechanical split) — zero behavior change.
// Runtime deps (threadManager, securityConfirmations, broadcast) injected via bindMcpDispatchRuntime.
//
// FREEZE: NEW MCP dispatch policy / capability-gate algebra lives HERE.
// Do NOT re-inflate server.ts createToolExecutor with MCP executor bodies.
// L2 browser/extension gates → tool/*; companion tools → tool/companion-dispatch.ts.

import { WebSocket } from "ws"
import { getConfig } from "../config"
import { logger } from "../logger"
import {
  classifyMcpCall,
  mergeCapabilities,
  CRITICAL_MCP_CAPABILITIES,
  CRITICAL_MCP_META_TOOLS,
} from "../security"
import { isFullAutonomyCruise } from "../tool/l2-admission"
import type { SecurityConfirmationManager } from "../security-confirmation"
import type { ThreadManager } from "../threads/thread-manager"
import { getMcpManager } from "./manager"
import { getMcpConfirmCache } from "./confirm-cache"
import {
  resolveMcpConfirmTarget,
  MCP_OVERLAY_CONFIRM_NOTICE,
  MCP_OVERLAY_CONFIRM_UNAVAILABLE,
} from "./confirm-target"
import {
  fanOutConfirmRequest,
  pickExtensionWsFromAuth,
  resolveConfirmBinding,
  type ConfirmPeerAuth,
} from "./confirm-fanout"
import { ensureExtensionPeerForOverlayConfirm } from "../ws/extension-peer"

/**
 * Audit item 8: tool-name patterns that signal destructive operations. Matching
 * tools bypass the server's trust_level and always require per-call confirmation
 * (manual mode). The patterns cover the common verbs across filesystem / shell /
 * git / database MCP servers; the regex is intentionally permissive on prefixes
 * (e.g. "write_file", "delete_record", "exec_query", "rm_path") to err on the
 * side of caution.
 */
export const DESTRUCTIVE_MCP_TOOL_PATTERN =
  /\b(write|delete|exec|commit|rm|remove|shell|curl|wget|spawn|fork|kill|drop|truncate|wipe|destroy)\b/i

export type McpDispatchRuntime = {
  getThreadManager: () => ThreadManager | null | undefined
  securityConfirmations: SecurityConfirmationManager
  broadcastToClients: (data: any) => void
  pickExtensionWs?: () => WebSocket | null
  getWsSurface?: (ws: WebSocket) => string | undefined
  getClients?: () => Iterable<WebSocket>
  wsAuthGet?: (ws: WebSocket) => ConfirmPeerAuth | undefined
}

let _rt: McpDispatchRuntime | null = null

export function bindMcpDispatchRuntime(rt: McpDispatchRuntime | null): void {
  _rt = rt
}

function requireRt(): McpDispatchRuntime {
  if (!_rt) {
    throw new Error(
      "mcp-dispatch runtime not bound — call bindMcpDispatchRuntime after initServices",
    )
  }
  return _rt
}

/**
 * Overlay cannot confirm (N5). Fail closed without an extension peer
 * (UNAVAILABLE copy). When the panel is up, bind originWs to the extension
 * and fan out Allow/Deny like L2 — overlay gets mcp.confirm.pending only.
 * Overlay with no peer: attachChromeOnly + waitForExtensionPeer; timeout
 * stays UNAVAILABLE (never approved).
 */
export async function confirmChannel(originatingWs: WebSocket): Promise<
  | { originWs: WebSocket; send: (data: unknown) => void }
  | { error: string }
> {
  const rt = requireRt()
  let ext = rt.pickExtensionWs?.() ?? null
  const originatingSurface = rt.getWsSurface?.(originatingWs)
  if (originatingSurface === "summoner") {
    const extOpen = ext != null && ext.readyState === WebSocket.OPEN
    if (!extOpen) {
      try {
        ext = await ensureExtensionPeerForOverlayConfirm({ existing: ext })
      } catch {
        return { error: MCP_OVERLAY_CONFIRM_UNAVAILABLE }
      }
    }
  }
  const decided = resolveMcpConfirmTarget({
    originatingSurface,
    originatingOpen: originatingWs.readyState === WebSocket.OPEN,
    extensionOpen: ext != null && ext.readyState === WebSocket.OPEN,
  })
  if ("error" in decided) return decided

  const wsAuthGet = rt.wsAuthGet ?? (() => undefined)
  const clients = new Set<WebSocket>(rt.getClients?.() ?? [])
  const extensionWs =
    ext != null && ext.readyState === WebSocket.OPEN
      ? ext
      : pickExtensionWsFromAuth(clients, wsAuthGet)
  const binding = resolveConfirmBinding({
    originatingWs,
    originatingSurface,
    isOutboundMcpCall: false,
    extensionWs,
  })

  // Overlay never becomes originWs. No extension → do not skip; fail closed.
  const originWs =
    originatingSurface === "summoner"
      ? binding.originWs
      : (binding.originWs ?? originatingWs)
  if (!originWs) {
    return { error: MCP_OVERLAY_CONFIRM_UNAVAILABLE }
  }
  clients.add(originWs)

  const send = (data: unknown) => {
    fanOutConfirmRequest({
      data,
      originatingWs,
      originatingSurface,
      isOutboundMcpCall: false,
      overlayNotice: binding.overlayNotice,
      clients,
      wsAuthGet,
      overlayNoticeMessage: decided.overlayNotice ?? MCP_OVERLAY_CONFIRM_NOTICE,
    })
  }
  return { originWs, send }
}

/**
 * Execute an MCP namespaced tool (mcp__<server>__<tool>). Enforces the per-server
 * trust_level policy: manual = always prompt, first-use = prompt once per session,
 * trusted = never prompt for non-critical. Critical caps (file-write/exec/…) still
 * force L2 unless full-autonomy cruise (三旗). Approval cache is session-scoped.
 */
export async function executeMcpTool(
  toolName: string,
  params: any,
  sessionId: string,
  ws: WebSocket,
  startedAt: number,
  signal?: AbortSignal,
): Promise<{ success: boolean; data?: any; error?: string }> {
  void startedAt // retained for call-site parity with pre-split createToolExecutor
  const { getThreadManager, securityConfirmations, broadcastToClients } = requireRt()
  const manager = getMcpManager()
  const route = manager.resolveToolName(toolName)
  if (!route) {
    return { success: false, error: `MCP tool ${toolName} not found (server may be disconnected)` }
  }

  // Manual MCP selection must gate dispatch (not only LLM catalog filtering).
  try {
    const actingTid =
      typeof (params as any)?.__thread_id === "string"
        ? String((params as any).__thread_id)
        : sessionId
    const thr = actingTid ? getThreadManager()?.get(actingTid) : null
    const mode = thr?.mcp_selection_mode || "auto"
    if (mode === "manual") {
      const active = new Set(thr?.active_mcp_server_ids || [])
      if (!active.has(route.serverName)) {
        return {
          success: false,
          error: `MCP server "${route.serverName}" is not in this thread's active selection (mcp_selection_mode=manual)`,
        }
      }
    }
  } catch {
    /* unexpected thread lookup — fail closed below only when mode is known */
  }

  const configuredTrustLevel = manager.getTrustLevel(route.serverName) ?? "first-use"
  // Audit item 8: destructive-looking tool names ALWAYS require per-call confirmation,
  // regardless of the server's configured trust_level. A first-use approval for a
  // filesystem-write tool shouldn't auto-apply to the next 10 write/delete calls —
  // that's exactly the prompt-injection amplification path the audit flagged.
  const isDestructiveName = DESTRUCTIVE_MCP_TOOL_PATTERN.test(route.toolName)
  const trustLevel = isDestructiveName ? "manual" : configuredTrustLevel
  if (isDestructiveName && configuredTrustLevel !== "manual") {
    logger.warn("mcp.destructive_force_manual", {
      server: route.serverName, tool: route.toolName,
      configured: configuredTrustLevel, effective: "manual",
    })
  }

  const cache = getMcpConfirmCache()
  const cacheKey = { sessionId, serverName: route.serverName, toolName: route.toolName }

  const needsConfirm =
    trustLevel === "manual" ||
    (trustLevel === "first-use" && !cache.isApproved(cacheKey))

  // §6.3 MCP_CAPABILITY_GATE (follow-up C): capability classification that
  // survives trusted/first-use-cache/god-mode — mirror of §6.2. Even a `trusted`
  // server or a first-use-cached tool must confirm when the call touches a
  // critical capability (file-write/exec/network-egress/db-mutate/unknown).
  // god-mode / trust_level bypass the UI prompt, not this capability boundary
  // (same invariant as §6.1.5/§6.2). Without this, a `trusted` filesystem
  // server's `save_file` (name evades DESTRUCTIVE_MCP_TOOL_PATTERN) or a
  // `fetch_data` tool called with an attacker URL would execute zero-confirmation.
  //
  // Phase 2-B: merge the server's user-declared `security_capabilities`
  // (primary source) with classifyMcpCall inference (defense-in-depth) via
  // mergeCapabilities. Fail-safe union (Option C, kimi-approved): a positively-
  // inferred critical capability can NEVER be suppressed by a declaration; a
  // declaration only escalates or resolves the "unknown" sentinel.
  const declaredCaps = manager.getServerConfig(route.serverName)?.security_capabilities
  const mcpMerged = mergeCapabilities(classifyMcpCall(route.toolName, params), declaredCaps)
  const mcpCaps = mcpMerged.capabilities
  const forceMcpConfirm = mcpCaps.some(c => CRITICAL_MCP_CAPABILITIES.has(c))
  // Full autonomy cruise (三旗: auto_approve_dangerous + enterprise + allow_all_schemes)
  // — same algebra as shell_exec / §6.2 forceConfirm waive. God-mode or enterprise
  // alone still force critical MCP confirms (including file-write). Product: user
  // opted into max residual risk; do not keep a second silent deny path for MCP writes.
  // Reuse pure helper — do NOT re-inline the three-flag AND.
  const userFullAutonomyCruise = isFullAutonomyCruise(getConfig().security)
  // kimi suggestion: make the trust grant auditable. When a declaration RESOLVED
  // an "unknown" (inference found nothing, user vouched), warn so it's traceable.
  if (mcpMerged.declaredResolvedUnknown) {
    logger.warn("mcp.declared_resolved_unknown", {
      server: route.serverName,
      tool: route.toolName,
      declared: declaredCaps,
      trust_level: trustLevel,
    })
  }

  if ((needsConfirm || forceMcpConfirm) && userFullAutonomyCruise) {
    logger.info("mcp.confirm.waived", {
      server: route.serverName,
      tool: route.toolName,
      trust_level: trustLevel,
      session: sessionId,
      capabilities: mcpCaps,
      declared_capabilities: declaredCaps ?? [],
      force_confirm_would_have: forceMcpConfirm,
      needs_confirm_would_have: needsConfirm,
      reason: "full_autonomy_cruise",
    })
  } else if (needsConfirm || forceMcpConfirm) {
    const channel = await confirmChannel(ws)
    if ("error" in channel) {
      return { success: false, error: `Security Block: ${channel.error}` }
    }
    const securityConfig = getConfig().security
    logger.info("mcp.confirm.requested", {
      server: route.serverName,
      tool: route.toolName,
      trust_level: trustLevel,
      session: sessionId,
      capabilities: mcpCaps,
      declared_capabilities: declaredCaps ?? [],
      force_confirm: forceMcpConfirm,
    })
    const decision = await securityConfirmations.request(
      channel.send,
      {
        toolName,
        dangerousApis: mcpCaps,
        code: safeJsonStringify(params, 1200),
        riskLevel: "medium",
        ...(forceMcpConfirm ? { criticalApis: mcpCaps, riskLevel: "high" as const, autoConfirmEligible: false } : {}),
      },
      // Overlay chat retargets origin to the extension WS (N5). Panel stays self-origin.
      { originWs: channel.originWs },
    )
    if (!decision.approved) {
      const reason = decision.reason === "approved" ? "unavailable" : decision.reason
      if (forceMcpConfirm) {
        logger.warn("security.mcp_critical_denied", {
          server: route.serverName,
          tool: route.toolName,
          capabilities: mcpCaps,
          declared_capabilities: declaredCaps ?? [],
          god_mode_active: securityConfig.allow_all_schemes === true,
          auto_approve_active: securityConfig.auto_approve_dangerous === true,
          trust_level: trustLevel,
          reason,
        })
      }
      return {
        success: false,
        error: `Security Block: MCP tool ${route.serverName}/${route.toolName} ${reason} by user`,
      }
    }
    // Only cache first-use approvals for NON-critical calls. Critical calls
    // (forceMcpConfirm) confirm every time — args can change between calls, and
    // a cached approval must not auto-apply to a later destructive invocation
    // (mirror of DESTRUCTIVE_MCP_TOOL_PATTERN → manual).
    if (trustLevel === "first-use" && !forceMcpConfirm) {
      cache.approve(cacheKey)
    }
    logger.info("mcp.confirm.approved", { server: route.serverName, tool: route.toolName })
    if (forceMcpConfirm) {
      logger.warn("security.mcp_critical_confirmed", {
        server: route.serverName,
        tool: route.toolName,
        capabilities: mcpCaps,
        declared_capabilities: declaredCaps ?? [],
        god_mode_active: securityConfig.allow_all_schemes === true,
        auto_approve_active: securityConfig.auto_approve_dangerous === true,
        trust_level: trustLevel,
      })
    }
  } else if (trustLevel === "first-use") {
    // Audit item 8: count this invocation against the per-tool approval's call cap.
    // When the cap (default 10) is hit, the next isApproved() returns false and
    // the user is re-prompted. recordCall is a no-op for bulk-trust / manual paths.
    // (forceMcpConfirm is false here — critical calls never reach this branch.)
    cache.recordCall(cacheKey)
  }

  const callStartedAt = Date.now()
  const runOnce = async (): Promise<{ success: boolean; data?: any; error?: string; rawErr?: string }> => {
    try {
      const result = await manager.callTool(route, params || {}, signal)
      if (result?.isError) {
        const errMsg = extractMcpError(result)
        return {
          success: false,
          rawErr: errMsg,
          error: enhanceMcpError(
            `MCP ${route.serverName}/${route.toolName} returned error: ${errMsg}`,
            route,
            params,
          ),
        }
      }
      return { success: true, data: result?.content ?? result }
    } catch (err: any) {
      const rawErr = err?.message || String(err)
      return { success: false, rawErr, error: enhanceMcpError(rawErr, route, params) }
    }
  }

  let outcome = await runOnce()

  // P2: access denied under home → L2 offer to add allow-dir, then one retry
  if (!outcome.success && outcome.rawErr) {
    const expanded = await tryExpandFilesystemAllowDirOnDenial({
      route,
      params,
      rawErr: outcome.rawErr,
      toolName,
      ws,
    })
    if (expanded.retried) {
      if (expanded.ok) {
        outcome = await runOnce()
      } else if (expanded.error) {
        outcome = {
          success: false,
          error: enhanceMcpError(expanded.error, route, params),
        }
      }
    }
  }

  broadcastToClients({
    type: "mcp.tool_call_finished",
    serverName: route.serverName,
    toolName: route.toolName,
    namespacedName: toolName,
    durationMs: Date.now() - callStartedAt,
    success: !!outcome.success,
    ...(outcome.success ? {} : { error: outcome.error }),
  })
  if (outcome.success) return { success: true, data: outcome.data }
  return { success: false, error: outcome.error || "MCP call failed" }
}

/**
 * When MCP filesystem denies a path under the user home, ask the user (L2) whether
 * to add that directory to the server's allowlist, then hot-reload + signal retry.
 */
export async function tryExpandFilesystemAllowDirOnDenial(opts: {
  route: { serverName: string; toolName: string }
  params: any
  rawErr: string
  toolName: string
  ws: WebSocket
}): Promise<{ retried: boolean; ok?: boolean; error?: string }> {
  const { securityConfirmations } = requireRt()
  const { canOfferAllowDirExpand, addFilesystemAllowDir } = await import("./allow-dir-expand")

  // Pre-check filesystem server + path BEFORE L2 (Pi nit: no misleading prompt)
  const pre = canOfferAllowDirExpand({
    serverName: opts.route.serverName,
    rawErr: opts.rawErr,
    params: opts.params,
  })
  if (!pre.offer) {
    // Not applicable — leave original error; do not claim we retried
    return { retried: false }
  }

  // Three-flag cruise = path risk accepted: auto-add allow-dir without L2.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isCruisePathRiskAccepted } = require("../security/cruise-path") as typeof import("../security/cruise-path")
  if (isCruisePathRiskAccepted()) {
    const added = await addFilesystemAllowDir(opts.route.serverName, pre.dir)
    if (!added.ok) {
      return {
        retried: true,
        ok: false,
        error: `Failed to expand allow-dir under cruise: ${added.error}. Underlying: ${opts.rawErr}`,
      }
    }
    logger.warn("mcp.allow_dir.cruise_auto_added", {
      server: opts.route.serverName,
      dir: pre.dir,
      reason: "full_autonomy_cruise",
    })
    return { retried: true, ok: true }
  }

  const channel = await confirmChannel(opts.ws)
  if ("error" in channel) {
    return {
      retried: true,
      ok: false,
      error:
        `MCP path denied (${pre.dir}); ${channel.error} Underlying: ${opts.rawErr}`,
    }
  }

  logger.info("mcp.allow_dir.propose", {
    server: opts.route.serverName,
    tool: opts.route.toolName,
    dir: pre.dir,
  })

  const decision = await securityConfirmations.request(
    channel.send,
    {
      toolName: opts.toolName,
      dangerousApis: ["mcp-allow-dir-expand"],
      code:
        `允许 MCP filesystem 访问目录：\n${pre.dir}\n\n` +
        `仅把该目录加入 allowlist（可在主目录内或之外；不会放开整盘/系统目录）。拒绝则保持当前配置。`,
      riskLevel: "medium",
      autoConfirmEligible: false,
      criticalApis: ["mcp-allow-dir-expand"],
    },
    { originWs: channel.originWs },
  )

  if (!decision.approved) {
    logger.info("mcp.allow_dir.denied", { dir: pre.dir, reason: decision.reason })
    return {
      retried: true,
      ok: false,
      error:
        `User declined adding MCP allow-dir ${pre.dir}. Access denied. Underlying: ${opts.rawErr}`,
    }
  }

  const added = await addFilesystemAllowDir(opts.route.serverName, pre.dir)
  if (!added.ok) {
    return {
      retried: true,
      ok: false,
      error: `Failed to expand allow-dir: ${added.error}. Underlying: ${opts.rawErr}`,
    }
  }
  logger.info("mcp.allow_dir.added", { server: opts.route.serverName, dir: pre.dir })
  return { retried: true, ok: true }
}

/**
 * Wrap a raw MCP error message with an actionable hint for the LLM. The LLM
 * has no signal whether to retry (transient), narrow the request (too much
 * data), or skip the tool entirely without these hints — bare "MCP call failed:
 * MCP timeout" leaves it to guess, and the default guess is identical retry.
 *
 * Exported for unit tests (audit item 18).
 */
export function enhanceMcpError(
  rawErr: string,
  route: { serverName: string; toolName: string },
  params: any,
): string {
  const ctx = `MCP ${route.serverName}/${route.toolName}`
  // Timeout — the server may be slow / busy / hung. Suggest retry + narrowing.
  if (/MCP timeout/i.test(rawErr)) {
    const argHint = params && typeof params === "object" && Object.keys(params).length > 0
      ? " or try smaller/simpler arguments"
      : ""
    return `MCP call to ${ctx} timed out. The server may be slow, busy, or hung. You can retry once${argHint}, or skip this tool and continue. Underlying error: ${rawErr}`
  }
  // Abort (chat.abort fired or external cancellation)
  if (/MCP call aborted/i.test(rawErr)) {
    return `MCP call to ${ctx} was cancelled (likely because the user clicked stop or a new chat replaced this one). Do not retry automatically; wait for the user's next instruction.`
  }
  // Server not connected / disconnected mid-call — usually transient (restart
  // in progress, or applyConfig diff triggered a stop+start).
  if (/not connected|Connection Closed|disconnect|EPIPE|ECONNRESET/i.test(rawErr)) {
    return `MCP server ${route.serverName} is unavailable right now (status: disconnected / restarting). Wait a moment and retry, or pick a different tool. Underlying error: ${rawErr}`
  }
  // Server-not-found — config issue, not transient.
  if (/MCP server .* not found/i.test(rawErr)) {
    return `${rawErr} This usually means the server was removed from the config or has not finished starting yet. Check the MCP panel and retry.`
  }
  // Capability-gating error — caller is asking for something the server doesn't support.
  if (/does not advertise/i.test(rawErr)) {
    return `${rawErr} Use a different tool that the server actually exposes.`
  }
  // Official filesystem server: create nested path without parents (thread 6zhrh6).
  // Keep tokens "parent directory" / "does not exist" for classifyError recoverability.
  // Write-like tools get mkdir guidance; read tools get "path missing / list parent" (Pi nit 5).
  if (/parent directory does not exist/i.test(rawErr) || /ENOENT/i.test(rawErr)) {
    const pathHint =
      params && typeof params === "object"
        ? String((params as any).path || (params as any).parent || "")
        : ""
    const pathPart = pathHint ? ` (path: ${pathHint})` : ""
    const writeLike = /write|create|mkdir|move|copy|edit|append|delete|remove|unlink|rename|put|save/i.test(
      route.toolName || "",
    )
    if (writeLike || /parent directory does not exist/i.test(rawErr)) {
      return (
        `MCP filesystem path missing parent${pathPart}. ` +
        `parent directory does not exist — call ensure_project_dir first, or create_directory ` +
        `on each missing segment under an allowed root, then retry the write. ` +
        `Do not invent paths outside MCP allow-dirs. Underlying: ${rawErr}`
      )
    }
    return (
      `MCP filesystem path not found${pathPart}. ` +
      `List the parent directory or correct the path, then retry. Underlying: ${rawErr}`
    )
  }
  // Path outside allowlist — user may need MCP panel allow-dir (not god-mode).
  if (
    /access denied|not allowed|outside|allowed director/i.test(rawErr) ||
    /path.*not.*within/i.test(rawErr)
  ) {
    return (
      `MCP ${route.serverName} denied path access (not in allowlist or roots). ` +
      `Ask the user to open Side Panel → MCP → edit filesystem server → add the parent directory ` +
      `to allow paths (or use a path under already-allowed roots such as home). ` +
      `Default mode does not auto-expand MCP allow-dirs; three-flag cruise auto-adds allowed dirs. Underlying: ${rawErr}`
    )
  }
  // Fallback — keep the original but prefix with context so the LLM knows which
  // server/tool produced it (multi-server setups would otherwise be ambiguous).
  return `MCP call to ${ctx} failed: ${rawErr}`
}

/** Execute mcp_list_resources / mcp_read_resource / mcp_get_prompt.
 *
 *  §6.3 Phase 2-A (follow-up C): this is a SEPARATE MCP dispatch path from
 *  executeMcpTool — the meta-tools are not namespaced (`isMcpNamespaced` is
 *  false), so Phase 1's capability gate never saw them. Historically this
 *  function had NO gate at all, so `mcp_read_resource({server, uri})` read
 *  arbitrary URIs (file:///etc/passwd, data:, http://…) on a trusted server
 *  zero-confirmation. Now: mcp_read_resource / mcp_get_prompt force-confirm
 *  (CRITICAL_MCP_META_TOOLS, never cached, god-mode-unaware — mirror of Phase 1);
 *  mcp_list_resources is gated purely by trust_level (D8-consistent). */
export async function executeMcpMetaTool(
  toolName: string,
  params: any,
  sessionId: string,
  ws: WebSocket,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { securityConfirmations } = requireRt()
  const manager = getMcpManager()
  const args = params || {}
  const serverName = String(args.server || "").trim()
  if (!serverName) return { success: false, error: "MCP server name is required" }

  const forceMetaConfirm = CRITICAL_MCP_META_TOOLS.has(toolName)
  const configuredTrustLevel = manager.getTrustLevel(serverName) ?? "first-use"
  const cache = getMcpConfirmCache()
  const cacheKey = { sessionId, serverName, toolName }
  const needsConfirm =
    forceMetaConfirm ||
    configuredTrustLevel === "manual" ||
    (configuredTrustLevel === "first-use" && !cache.isApproved(cacheKey))
  const securityConfigMeta = getConfig().security
  // Reuse pure helper — do NOT re-inline the three-flag AND.
  const userFullAutonomyCruiseMeta = isFullAutonomyCruise(securityConfigMeta)

  if (needsConfirm && userFullAutonomyCruiseMeta) {
    logger.info("mcp.meta.confirm.waived", {
      tool: toolName,
      server: serverName,
      trust_level: configuredTrustLevel,
      session: sessionId,
      force_confirm_would_have: forceMetaConfirm,
      reason: "full_autonomy_cruise",
    })
  } else if (needsConfirm) {
    const channel = await confirmChannel(ws)
    if ("error" in channel) {
      return { success: false, error: `Security Block: ${channel.error}` }
    }
    const securityConfig = securityConfigMeta
    // Capability label for the audit/UI (the meta-tool's operation kind).
    const metaCap = toolName === "mcp_read_resource" ? "resource-read" : "prompt-injection"
    logger.info("mcp.meta.confirm.requested", {
      tool: toolName, server: serverName, trust_level: configuredTrustLevel,
      session: sessionId, force_confirm: forceMetaConfirm,
    })
    const decision = await securityConfirmations.request(
      channel.send,
      {
        toolName,
        dangerousApis: forceMetaConfirm ? [metaCap] : [],
        code: safeJsonStringify(params, 1200),
        riskLevel: forceMetaConfirm ? "high" : "medium",
        ...(forceMetaConfirm ? { criticalApis: [metaCap], autoConfirmEligible: false } : {}),
      },
      { originWs: channel.originWs },
    )
    if (!decision.approved) {
      const reason = decision.reason === "approved" ? "unavailable" : decision.reason
      if (forceMetaConfirm) {
        logger.warn("security.mcp_meta_critical_denied", {
          tool: toolName, server: serverName,
          god_mode_active: securityConfig.allow_all_schemes === true,
          auto_approve_active: securityConfig.auto_approve_dangerous === true,
          trust_level: configuredTrustLevel, reason,
        })
      }
      return {
        success: false,
        error: `Security Block: MCP meta-tool ${toolName} (${serverName}) ${reason} by user`,
      }
    }
    // Only cache first-use approvals for NON-critical meta-tools (mcp_list_resources).
    // Critical meta-tools confirm every time (never cached).
    if (configuredTrustLevel === "first-use" && !forceMetaConfirm) {
      cache.approve(cacheKey)
    }
    if (forceMetaConfirm) {
      logger.warn("security.mcp_meta_critical_confirmed", {
        tool: toolName, server: serverName,
        god_mode_active: securityConfig.allow_all_schemes === true,
        auto_approve_active: securityConfig.auto_approve_dangerous === true,
        trust_level: configuredTrustLevel,
      })
    }
  } else if (configuredTrustLevel === "first-use") {
    cache.recordCall(cacheKey)
  }

  try {
    switch (toolName) {
      case "mcp_list_resources": {
        const resources = await manager.listResources(serverName)
        return { success: true, data: { server: serverName, resources } }
      }
      case "mcp_read_resource": {
        const uri = String(args.uri || "").trim()
        if (!uri) return { success: false, error: "Resource uri is required" }
        const result = await manager.readResource(serverName, uri)
        return { success: true, data: result }
      }
      case "mcp_get_prompt": {
        const name = String(args.name || "").trim()
        if (!name) return { success: false, error: "Prompt name is required" }
        const result = await manager.getPrompt(serverName, name, args.arguments)
        return { success: true, data: result }
      }
      default:
        return { success: false, error: `Unknown MCP meta tool: ${toolName}` }
    }
  } catch (err: any) {
    const rawErr = err.message || String(err)
    // Capability mismatch: give the LLM concrete guidance toward namespaced tools.
    if (/does not advertise/i.test(rawErr)) {
      const client = manager.listServers().find((s) => s.name === serverName)
      const toolNames = client?.tools.map((t) => `mcp__${serverName}__${t.name}`) ?? []
      const toolHint = toolNames.length > 0
        ? ` Available namespaced tools on this server: ${toolNames.join(", ")}.`
        : ""
      return {
        success: false,
        error: `${rawErr}${toolHint} Do not retry mcp_list_resources / mcp_read_resource / mcp_get_prompt against this server; use the namespaced tools instead.`,
      }
    }
    return { success: false, error: rawErr }
  }
}

export function safeJsonStringify(value: any, limit: number): string {
  try {
    const s = JSON.stringify(value ?? {})
    return s.length > limit ? s.slice(0, limit) + "…" : s
  } catch {
    return String(value)
  }
}

export function extractMcpError(result: any): string {
  if (!result) return "unknown error"
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item?.text) return String(item.text)
      if (typeof item === "string") return item
    }
  }
  return JSON.stringify(result).slice(0, 500)
}
