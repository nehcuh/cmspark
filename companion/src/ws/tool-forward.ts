// Extension tool-forward plumbing: pending map, dispatch, result correlation, default forward path.
// Extracted from server.ts (C10 Phase G mechanical split) — zero behavior change.
//
// FREEZE: pendingToolCalls / handleToolResult / dispatchToExtension / forwardToolToExtension
// and timeout constants live HERE. Do NOT re-inflate createToolExecutor with the
// extension-forward Promise block.
// tabUrlCache: ws/tab-url-cache.ts (shared). ThreadManager via bindToolForwardRuntime.
// applyConnectionCloseGracePeriod (ws/lifecycle) uses pendingToolCalls from here.
// L2/cookie/URL/image gates → tool/*; companion → companion-dispatch; MCP → mcp/dispatch.

import { WebSocket } from "ws"
import { logger } from "../logger"
import type { ThreadManager } from "../threads/thread-manager"

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

/** Exported for integration tests (audit item 6). Production reads the const directly. */
export const TOOL_EXECUTION_TIMEOUT_MS = 15000
/** browser_download may wait up to 120s; companion WS timeout must not undercut extension. */
export const BROWSER_DOWNLOAD_MAX_TIMEOUT_MS = 120_000

export function resolveToolDispatchTimeoutMs(toolName: string, params?: any): number {
  if (toolName === "browser_download") {
    const t = typeof params?.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.floor(params.timeoutMs)
      : 60_000
    return Math.min(BROWSER_DOWNLOAD_MAX_TIMEOUT_MS + 5_000, Math.max(TOOL_EXECUTION_TIMEOUT_MS, t + 5_000))
  }
  return TOOL_EXECUTION_TIMEOUT_MS
}

// ---------------------------------------------------------------------------
// Runtime bind (server-local tabUrlCache + ThreadManager)
// ---------------------------------------------------------------------------

export type ToolForwardRuntime = {
  getTabUrlCache: () => Map<number, string>
  refreshTabUrlCache: (tabs: any[]) => void
  getThreadManager: () => ThreadManager | null | undefined
}

let _rt: ToolForwardRuntime | null = null

export function bindToolForwardRuntime(rt: ToolForwardRuntime): void {
  _rt = rt
}

function requireRt(): ToolForwardRuntime {
  if (!_rt) {
    throw new Error(
      "tool-forward runtime not bound — call bindToolForwardRuntime after tabUrlCache exists",
    )
  }
  return _rt
}

// ---------------------------------------------------------------------------
// Pending map + reject helpers
// ---------------------------------------------------------------------------

export type PendingToolCall = {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: NodeJS.Timeout
  /** ADR-015: bind ownership for worker-cancel + lease expiry drain */
  thread_id?: string
  tabId?: number
  tool_name?: string
  /**
   * SEC-E: socket that received tool.execute. Close grace and tool.result
   * acceptance are scoped to this peer so tray reconnect cannot kill extension tools.
   */
  originWs?: WebSocket
}

// Pending tool execution promises: toolCallId → { resolve, reject, timer }
// Exported for integration tests (audit item 6) so tests can inspect timer cleanup
// and double-resolution behavior. Production code uses the Map directly.
export const pendingToolCalls = new Map<string, PendingToolCall>()

/** Snapshot DTO: names/ids only — never args, originWs, or confirm nonce. */
export function listPendingToolsForThread(
  threadId: string,
): Array<{ tool_call_id: string; tool_name: string; status: "running" }> {
  const out: Array<{ tool_call_id: string; tool_name: string; status: "running" }> = []
  if (!threadId) return out
  for (const [id, pending] of pendingToolCalls) {
    if (pending.thread_id !== threadId) continue
    out.push({
      tool_call_id: id,
      tool_name: pending.tool_name || "",
      status: "running",
    })
  }
  return out
}

/** Reject in-flight extension tools owned by a thread (worker-cancel / lease drain). */
export function rejectPendingForThread(
  threadId: string,
  reason: string,
  tabIdFilter?: number,
): number {
  let n = 0
  for (const [id, pending] of [...pendingToolCalls.entries()]) {
    if (pending.thread_id !== threadId) continue
    if (tabIdFilter != null && pending.tabId !== tabIdFilter) continue
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
    pending.resolve({ success: false, error: reason })
    n++
  }
  return n
}

export function hasPendingForTab(tabId: number, holderThreadId: string): boolean {
  for (const pending of pendingToolCalls.values()) {
    if (pending.thread_id === holderThreadId && pending.tabId === tabId) return true
  }
  return false
}

export function rejectPendingForTab(
  tabId: number,
  holderThreadId: string,
  reason: string,
): number {
  return rejectPendingForThread(holderThreadId, reason, tabId)
}

// ---------------------------------------------------------------------------
// handleToolResult
// ---------------------------------------------------------------------------

// Exported for integration tests (audit item 6).
export function handleToolResult(msg: any, fromWs?: WebSocket) {
  const { tool_call_id, result, error } = msg
  const pending = pendingToolCalls.get(tool_call_id)
  if (!pending) return
  // SEC-E: only the dispatch peer may resolve (prevents other loopback peers spoofing results)
  if (fromWs && pending.originWs && pending.originWs !== fromWs) {
    logger.warn("tool.result_origin_mismatch", {
      tool_call_id,
      tool_name: pending.tool_name,
    })
    return
  }
  clearTimeout(pending.timer)
  pendingToolCalls.delete(tool_call_id)
  if (error) {
    pending.resolve({ success: false, error: error.message || String(error) })
  } else {
    pending.resolve(result)
  }
}

// ---------------------------------------------------------------------------
// dispatchToExtension (image-fetch phase1/phase2; no post-processing / logToolFinish)
// ---------------------------------------------------------------------------

/**
 * Dispatch a single tool execution to the extension and await its result via
 * the `pendingToolCalls` / `handleToolResult` correlation (same plumbing the
 * default forward branch uses). Factored out so the analyze_image two-phase
 * gate (§6.1) can issue a phase-1 resolve and a phase-2 fetch without
 * duplicating the send/timeout/pending-map dance. Resolves to a tool-result
 * object `{ success, data?, error? }`; never rejects (timeouts and send
 * failures are returned as `{ success: false, error }`).
 *
 * Uses fixed TOOL_EXECUTION_TIMEOUT_MS (not resolveToolDispatchTimeoutMs) —
 * callers (image-fetch) are not browser_download.
 */
export function dispatchToExtension(
  toolCallId: string,
  toolName: string,
  params: any,
  ws: WebSocket,
): Promise<{ success: boolean; data?: any; error?: string }> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: { success: boolean; data?: any; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pendingToolCalls.delete(toolCallId)
      resolve(result)
    }
    const timer = setTimeout(() => {
      const result = { success: false, error: `Tool execution timeout (${TOOL_EXECUTION_TIMEOUT_MS}ms): ${toolName}` }
      logger.warn("tool.timeout", { tool_call_id: toolCallId, tool_name: toolName, timeout_ms: TOOL_EXECUTION_TIMEOUT_MS })
      finish(result)
    }, TOOL_EXECUTION_TIMEOUT_MS)
    pendingToolCalls.set(toolCallId, {
      resolve: finish as any,
      reject: finish as any,
      timer,
      tool_name: toolName,
      originWs: ws,
    })
    if (ws.readyState !== WebSocket.OPEN) {
      const result = { success: false, error: "WebSocket not connected" }
      logger.warn("tool.dispatch_failed", { tool_call_id: toolCallId, tool_name: toolName, error: result.error })
      finish(result)
      return
    }
    try {
      ws.send(JSON.stringify({ type: "tool.execute", tool_call_id: toolCallId, tool_name: toolName, params }))
    } catch (err: any) {
      const result = { success: false, error: `WebSocket send failed: ${err.message || String(err)}` }
      logger.error("tool.dispatch_failed", { tool_call_id: toolCallId, tool_name: toolName, error: err.message || String(err) })
      finish(result)
    }
  })
}

// ---------------------------------------------------------------------------
// Default extension forward (createToolExecutor terminal path)
// ---------------------------------------------------------------------------

export type ForwardToolToExtensionCtx = {
  toolCallId: string
  toolName: string
  finalParams: Record<string, any>
  ws: WebSocket
  actingThreadId?: string
  startedAt: number
  logToolFinish: (id: string, name: string, startedAt: number, result: any) => void
}

/**
 * Default path: send tool.execute to extension, await tool.result, then run
 * tabUrlCache / lease post-processing (list_tabs, navigate, create_tab, close_tab).
 * logToolFinish is per-call; tabUrlCache + ThreadManager come from bindToolForwardRuntime.
 */
export async function forwardToolToExtension(ctx: ForwardToolToExtensionCtx): Promise<{
  success: boolean
  data?: any
  error?: string
}> {
  const {
    toolCallId,
    toolName,
    finalParams,
    ws,
    actingThreadId,
    startedAt,
    logToolFinish,
  } = ctx
  const { getTabUrlCache, refreshTabUrlCache, getThreadManager } = requireRt()

  return new Promise((resolve, reject) => {
    const finishAndResolve = (result: any) => {
      // Refresh tab URL cache when list_tabs returns, so the evaluate
      // whitelist gate can resolve tabId → hostname on the next call.
      if (toolName === "list_tabs" && result?.success && Array.isArray(result.data)) {
        refreshTabUrlCache(result.data)
        // ADR-015: surface lease holders so LLMs avoid TAB_LOCKED retry storms
        try {
          const { lockMetaForTab } = require("../orchestrator/tab-lease") as typeof import("../orchestrator/tab-lease")
          result.data = result.data.map((t: any) => {
            if (!t || typeof t.id !== "number") return t
            const meta = lockMetaForTab(t.id)
            return {
              ...t,
              locked_by_thread_id: meta.locked_by_thread_id,
              lease_state: meta.lease_state,
              lease_expires_at: meta.lease_expires_at,
            }
          })
        } catch {
          /* ignore enrichment failures */
        }
      }
      // Synchronize cache after LLM-initiated navigation. A successful
      // navigate/set_tab_url means the cached URL for this tabId is now stale;
      // updating it prevents a prompt-injection attack where a malicious page
      // (or attacker-controlled agent flow) navigates a whitelisted tab to an
      // attacker domain and the next evaluate({tabId}) is auto-approved
      // against the OLD (still-whitelisted) hostname.
      // NOTE: page-initiated navigation via window.location is a residual risk
      // requiring chrome.tabs.onUpdated subscription on the extension side.
      if (
        result?.success === true &&
        (toolName === "navigate" || toolName === "set_tab_url") &&
        typeof finalParams.tabId === "number" &&
        typeof finalParams.url === "string"
      ) {
        getTabUrlCache().set(finalParams.tabId, finalParams.url)
      }
      // Cache the new tab created by create_tab so the next evaluate({tabId})
      // can be domain-whitelisted without waiting for a fresh list_tabs.
      if (
        toolName === "create_tab" &&
        result?.success === true &&
        result.data &&
        typeof result.data.id === "number" &&
        typeof result.data.url === "string"
      ) {
        getTabUrlCache().set(result.data.id, result.data.url)
        // ADR-015: auto HARD-hold new tab for multi-agent creators only.
        // Normal single-agent create_tab must not consume the per-worker lease
        // budget (max 2) — AppSec / multi-tab browse open many tabs.
        if (actingThreadId) {
          try {
            const {
              autoHoldCreatedTab,
              anyTabLeaseHeld,
            } = require("../orchestrator/tab-lease") as typeof import("../orchestrator/tab-lease")
            const { isMultiAgentThread } = require("../orchestrator") as typeof import("../orchestrator")
            const th = getThreadManager()?.get(actingThreadId) as any
            if (isMultiAgentThread(th) || anyTabLeaseHeld()) {
              autoHoldCreatedTab(result.data.id, actingThreadId)
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (toolName === "close_tab" && result?.success === true && typeof finalParams.tabId === "number") {
        try {
          const { releaseTabLease } = require("../orchestrator/tab-lease") as typeof import("../orchestrator/tab-lease")
          releaseTabLease(finalParams.tabId, "close_tab", actingThreadId)
        } catch {
          /* ignore */
        }
      }
      logToolFinish(toolCallId, toolName, startedAt, result)
      resolve(result)
    }
    const dispatchTimeoutMs = resolveToolDispatchTimeoutMs(toolName, finalParams)
    const timer = setTimeout(() => {
      pendingToolCalls.delete(toolCallId)
      const result = { success: false, error: `Tool execution timeout (${dispatchTimeoutMs}ms): ${toolName}` }
      logger.warn("tool.timeout", { tool_call_id: toolCallId, tool_name: toolName, timeout_ms: dispatchTimeoutMs })
      finishAndResolve(result)
    }, dispatchTimeoutMs)

    pendingToolCalls.set(toolCallId, {
      resolve: finishAndResolve,
      reject,
      timer,
      thread_id: actingThreadId,
      tabId: typeof finalParams.tabId === "number" ? finalParams.tabId : undefined,
      tool_name: toolName,
      originWs: ws,
    })

    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: "tool.execute",
          tool_call_id: toolCallId,
          tool_name: toolName,
          params: finalParams,
        }))
      } catch (err: any) {
        clearTimeout(timer)
        pendingToolCalls.delete(toolCallId)
        const result = { success: false, error: `WebSocket send failed: ${err.message || String(err)}` }
        logger.error("tool.dispatch_failed", { tool_call_id: toolCallId, tool_name: toolName, error: err.message || String(err) })
        finishAndResolve(result)
      }
    } else {
      clearTimeout(timer)
      pendingToolCalls.delete(toolCallId)
      const result = { success: false, error: "WebSocket not connected" }
      logger.warn("tool.dispatch_failed", { tool_call_id: toolCallId, tool_name: toolName, error: result.error })
      finishAndResolve(result)
    }
  })
}
