// Tool executor — dispatches tool calls to the extension and handles results

import type { ThreadManager } from "../threads/thread-manager"
import type { SkillEngine } from "../skills/skill-engine"
import type { HistoryStore } from "../history/store"
import { checkHighRiskExecution, isTrustedDomain, classifyError, type ErrorLevel } from "../security"
import { summarizeMessage, summarizeToolParams, getDomainFromUrl, logToolFinish } from "./log-helpers"
import { logEvent } from "../logger"

const TOOL_EXECUTION_TIMEOUT_MS = 15000

function resolveAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool execution timeout after ${ms}ms`)), ms))
}

/**
 * Create a tool executor function bound to a specific WebSocket connection.
 * Returns an executeTool callback that sends tool.execute over WebSocket and
 * waits for the corresponding tool.result via a Promise bridge.
 */
export function createToolExecutor(
  ws: any,
  threadManager: ThreadManager,
  skillEngine: SkillEngine,
  historyStore: HistoryStore,
) {
  const pendingTools = new Map<string, { resolve: (v: any) => void; timer: NodeJS.Timeout }>()

  return (toolCallId: string, toolName: string, params: any): Promise<{ success: boolean; data?: any; error?: string }> => {
    return new Promise((resolve) => {
      // --- Security: cookie trust domain check ---
      if (toolName === "get_cookies" || toolName === "set_cookie" || toolName === "delete_cookie") {
        const domain = params.domain || getDomainFromUrl(params.url || "")
        if (!domain || !isTrustedDomain(domain)) {
          return resolve({ success: false, error: `Cookie security: domain "${domain}" not in trusted list` })
        }
      }
      if (toolName === "list_all_cookies") {
        const config = getRuntimeConfig()
        if (!isTrustedDomain("*")) {
          return resolve({ success: false, error: "Cookie security: list_all_cookies requires '*' in trusted domains" })
        }
      }
      // --- Security: evaluate / osascript pre-check ---
      if (toolName === "evaluate" || toolName === "osascript_eval") {
        const safety = checkHighRiskExecution(toolName, params.code || params.expression || "")
        if (safety.blocked) {
          return resolve({ success: false, error: safety.error!, data: { dangerous_apis_found: safety.dangerousApis } })
        }
      }

      const timer = setTimeout(() => {
        pendingTools.delete(toolCallId)
        resolve({ success: false, error: `Tool execution timeout after ${TOOL_EXECUTION_TIMEOUT_MS}ms` })
      }, TOOL_EXECUTION_TIMEOUT_MS)

      pendingTools.set(toolCallId, { resolve, timer })

      ws.send(JSON.stringify({ type: "tool.execute", tool_call_id: toolCallId, tool_name: toolName, params }))

      logEvent("info", "tool.start", {
        tool_call_id: toolCallId,
        tool_name: toolName,
        params: summarizeToolParams(params),
      })
    })
  }
}

// Runtime config helpers (used by server.ts to sync config changes)
let _runtimeConfig: { trusted_domains: string[] } = { trusted_domains: [] }
export function setRuntimeConfig(cfg: typeof _runtimeConfig) { _runtimeConfig = cfg }
export function getRuntimeConfig() { return _runtimeConfig }

/**
 * Handle a tool.result message coming back from the extension.
 */
export function handleToolResult(
  msg: any,
  pendingTools: Map<string, { resolve: (v: any) => void; timer: NodeJS.Timeout }>,
  threadManager: ThreadManager,
): boolean {
  const { tool_call_id, ...result } = msg
  const pending = pendingTools.get(tool_call_id)
  if (!pending) return false

  clearTimeout(pending.timer)
  pendingTools.delete(tool_call_id)
  pending.resolve(result)
  return true
}

/**
 * Execute companion-local tools (use_skill, osascript_eval without session).
 */
export async function executeCompanionTool(
  toolName: string,
  params: any,
  skillEngine: SkillEngine,
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (toolName === "use_skill") {
    const skillName = params.skill_name
    const content = skillEngine.loadContent(skillName)
    if (!content) {
      return { success: false, error: `Skill "${skillName}" not found` }
    }
    return { success: true, data: { skill_name: skillName, content, instruction: "Use the following skill instructions to guide your actions:" } }
  }

  if (toolName === "osascript_eval") {
    // osascript_eval with session executes via Extension; without session it's blocked at pre-check
    return { success: false, error: "osascript_eval requires an active WebSocket session" }
  }

  return { success: false, error: `Unknown companion tool: ${toolName}` }
}
