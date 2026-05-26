// Companion server — WebSocket server, message routing, tool execution bridge

import { WebSocketServer, WebSocket } from "ws"
import { execSync } from "child_process"
import os from "os"
import { URL } from "url"
import { getConfig } from "./config"
import { handleMessage } from "./message-router"
import { ThreadManager } from "./threads/thread-manager"
import { SkillEngine } from "./skills/skill-engine"
import { HistoryStore } from "./history/store"
import { checkHighRiskExecution, highRiskExecutionDeniedError, isTrustedDomain } from "./security"
import { SecurityConfirmationManager } from "./security-confirmation"

const PORT = 23401
const TOOL_EXECUTION_TIMEOUT_MS = 15000

function getDomainFromUrl(urlString: string): string {
  try {
    const parsed = new URL(urlString)
    return parsed.hostname
  } catch {
    return ""
  }
}

let wss: WebSocketServer
let clients: Set<WebSocket> = new Set()

// Core services — initialized on first connection
let threadManager: ThreadManager
let skillEngine: SkillEngine
let historyStore: HistoryStore

// Pending tool execution promises: toolCallId → { resolve, reject, timer }
const pendingToolCalls = new Map<string, {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: NodeJS.Timeout
}>()

const securityConfirmations = new SecurityConfirmationManager()

function initServices() {
  threadManager = new ThreadManager()
  skillEngine = new SkillEngine()
  historyStore = new HistoryStore()
}

function createToolExecutor(ws: WebSocket) {
  return async (toolCallId: string, toolName: string, params: any): Promise<{ success: boolean; data?: any; error?: string }> => {
    let finalParams = params || {}

    // Security Pre-flight Checks (P0 - Cookie Trust Domains Gate)
    const COOKIE_TOOLS = ["get_cookies", "set_cookie", "delete_cookie", "list_all_cookies"]
    if (COOKIE_TOOLS.includes(toolName)) {
      let isSafe = false
      let targetDomain = ""

      if (toolName === "get_cookies") {
        targetDomain = finalParams.domain || ""
        isSafe = isTrustedDomain(targetDomain)
      } else if (toolName === "set_cookie") {
        targetDomain = finalParams.domain || ""
        if (!targetDomain && finalParams.url) {
          targetDomain = getDomainFromUrl(finalParams.url)
        }
        isSafe = isTrustedDomain(targetDomain)
      } else if (toolName === "delete_cookie") {
        targetDomain = finalParams.domain || ""
        if (!targetDomain && finalParams.url) {
          targetDomain = getDomainFromUrl(finalParams.url)
        }
        isSafe = isTrustedDomain(targetDomain)
      } else if (toolName === "list_all_cookies") {
        // list_all_cookies is global; only safe if "*" is in trusted domains
        isSafe = isTrustedDomain("*")
        targetDomain = "Global / All Domains"
      }

      if (!isSafe) {
        return {
          success: false,
          error: `Security Block: Access to cookie for domain "${targetDomain || "unknown"}" is blocked. This domain is not in the trusted_domains list. Please configure trusted domains in settings.`,
        }
      }
    }

    if ((toolName === "evaluate" || toolName === "osascript_eval") && !finalParams.security_confirmed) {
      const code = String(finalParams.code || finalParams.expression || "")
      const safety = checkHighRiskExecution(toolName, code)
      if (safety.blocked) {
        if (ws.readyState !== WebSocket.OPEN) {
          return {
            success: false,
            error: highRiskExecutionDeniedError(toolName, safety.dangerousApis, "unavailable"),
            data: { dangerous_apis_found: safety.dangerousApis },
          }
        }
        const decision = await securityConfirmations.request(
          (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(data))
            }
          },
          { toolName, dangerousApis: safety.dangerousApis, code },
        )
        if (!decision.approved) {
          const reason = decision.reason === "approved" ? "unavailable" : decision.reason
          return {
            success: false,
            error: highRiskExecutionDeniedError(toolName, safety.dangerousApis, reason),
            data: { dangerous_apis_found: safety.dangerousApis },
          }
        }
        finalParams = { ...finalParams, security_confirmed: true }
      }
    }

    // Companion-side tools (executed locally, not forwarded to extension)
    const COMPANION_TOOLS = ["osascript_eval"]
    if (COMPANION_TOOLS.includes(toolName)) {
      try {
        return await executeCompanionTool(toolName, finalParams)
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }

    // Send tool execution command to extension
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingToolCalls.delete(toolCallId)
        resolve({ success: false, error: `Tool execution timeout (${TOOL_EXECUTION_TIMEOUT_MS}ms): ${toolName}` })
      }, TOOL_EXECUTION_TIMEOUT_MS)

      pendingToolCalls.set(toolCallId, { resolve, reject, timer })

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "tool.execute",
          tool_call_id: toolCallId,
          tool_name: toolName,
          params: finalParams,
        }))
      } else {
        clearTimeout(timer)
        pendingToolCalls.delete(toolCallId)
        resolve({ success: false, error: "WebSocket not connected" })
      }
    })
  }
}

function handleToolResult(msg: any) {
  const { tool_call_id, result, error } = msg
  const pending = pendingToolCalls.get(tool_call_id)
  if (pending) {
    clearTimeout(pending.timer)
    pendingToolCalls.delete(tool_call_id)
    if (error) {
      pending.resolve({ success: false, error: error.message || String(error) })
    } else {
      pending.resolve(result)
    }
  }
}

// --- Companion-side tool executor (runs locally, not forwarded to extension) ---

async function executeCompanionTool(toolName: string, params: any): Promise<any> {
  switch (toolName) {
    case "osascript_eval": {
      const { url: pageUrl, expression: jsExpr } = params
      if (!pageUrl || !jsExpr) {
        return { success: false, error: "url and expression required" }
      }
      const safety = checkHighRiskExecution("osascript_eval", jsExpr)
      if (safety.blocked && !params.security_confirmed) {
        return {
          success: false,
          error: safety.error,
          data: { dangerous_apis_found: safety.dangerousApis },
        }
      }
      if (os.platform() !== "darwin") {
        return { success: false, error: "osascript_eval is macOS-only. Use get_page_text with tabId instead (cross-platform)." }
      }
      const escapedJs = jsExpr
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, " ")
      const script = `
        tell application "Google Chrome"
          repeat with w in windows
            repeat with t in tabs of w
              if URL of t contains "${pageUrl}" then
                set resultText to execute t javascript "${escapedJs}"
                return resultText
              end if
            end repeat
          end repeat
          return "TAB_NOT_FOUND"
        end tell
      `
      const output = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
        encoding: "utf-8",
        timeout: 10000,
      }).trim()
      if (output === "TAB_NOT_FOUND") {
        return { success: false, error: `Tab matching "${pageUrl}" not found in Chrome` }
      }
      return { success: true, data: { result: output } }
    }
    default:
      return { success: false, error: `Unknown companion tool: ${toolName}` }
  }
}

export async function startServer() {
  const config = getConfig()
  const port = config.port || PORT

  // Warn if no API key configured
  if (!config.llm.api_key || config.llm.api_key === "sk-placeholder") {
    console.warn("[cmspark-agent] ⚠️  No API key configured!")
    console.warn("[cmspark-agent]    Set DEEPSEEK_API_KEY environment variable or configure in the extension settings.")
    console.warn("[cmspark-agent]    Example: DEEPSEEK_API_KEY=sk-xxx npm start")
  } else {
    const masked = config.llm.api_key.slice(0, 5) + "***" + config.llm.api_key.slice(-4)
    console.log(`[cmspark-agent] Using API key: ${masked}`)
  }
  console.log(`[cmspark-agent] Model: ${config.llm.model_name} @ ${config.llm.base_url}`)

  wss = new WebSocketServer({ port, host: "127.0.0.1" })

  wss.on("listening", () => {
    console.log(`[cmspark-agent] Companion started on ws://127.0.0.1:${port}`)
  })

  wss.on("connection", (ws) => {
    if (clients.size === 0) {
      initServices()
    }
    clients.add(ws)
    console.log(`[cmspark-agent] Client connected (${clients.size} total)`)

    const executeTool = createToolExecutor(ws)

    // Ping/pong keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping()
      }
    }, 20000)

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString())

        // Intercept tool.result — these resolve pending promises
        if (msg.type === "tool.result") {
          handleToolResult(msg)
          return
        }

        if (msg.type === "security.confirmation.response") {
          securityConfirmations.respond(String(msg.confirmation_id || ""), msg.approved === true)
          return
        }

        const response = await handleMessage(
          msg,
          { threadManager, skillEngine, historyStore },
          {
            sendToExtension: (data: any) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(data))
              }
            },
            executeTool,
          },
        )

        if (response && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response))
        }
      } catch (e: any) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", error: e.message }))
        }
      }
    })

    ws.on("close", () => {
      clearInterval(pingInterval)
      clients.delete(ws)
      // Clean up pending tool calls for this connection
      for (const [id, pending] of pendingToolCalls) {
        clearTimeout(pending.timer)
        pending.resolve({ success: false, error: "WebSocket disconnected" })
      }
      pendingToolCalls.clear()
      securityConfirmations.rejectAll("disconnect")
      console.log(`[cmspark-agent] Client disconnected (${clients.size} remaining)`)
    })

    ws.on("pong", () => {
      // Heartbeat acknowledged
    })

    // Send initial state
    ws.send(JSON.stringify({ type: "connected" }))
  })

  wss.on("error", (err) => {
    console.error("[cmspark-agent] Server error:", err)
  })

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[cmspark-agent] Shutting down...")
    wss.close()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    wss.close()
    process.exit(0)
  })
}
