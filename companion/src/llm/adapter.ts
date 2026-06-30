// LLM adapter — OpenAI-compatible chat completions with tool calling

import OpenAI from "openai"
import type { ThreadManager } from "../threads/thread-manager"
import type { SkillEngine } from "../skills/skill-engine"
import type { HistoryStore } from "../history/store"
import { getToolDefinitions, getMcpMetaToolDefinitions, ToolDefinition } from "../bridge/tool-definitions"
import { tryParseToolArgs } from "../bridge/tool-schemas"
import { classifyError } from "../security"
import { logger } from "../logger"
import { analyzeImage } from "./vision-pipeline"
import { getConfig } from "../config"
import { getMcpManager } from "../mcp"

// Jailbreak patterns to detect in LLM output
const JAILBREAK_OUTPUT_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous\s+)?instructions?/i,
  /system\s*prompt\s*override/i,
  /new\s+role\s*:\s*you\s+are\s+now/i,
  /you\s+are\s+now\s+(?:in\s+)?\w+\s+mode/i,
  /DAN\s*mode/i,
  /jailbreak/i,
  /developer\s*:\s*new\s+instructions?/i,
  /disregard\s+(?:all\s+)?(?:previous\s+)?instructions?/i,
  /forget\s+(?:all\s+)?(?:previous\s+)?(?:instructions?|prompts?)/i,
  /忽略\s+(?:以上|前面|之前)\s*(?:所有\s*)?指令/,
  /系统\s*提示\s*覆盖/,
  /新\s*角色\s*：\s*你现在是/,
]

function detectJailbreakInOutput(text: string): string[] {
  const found: string[] = []
  for (const pattern of JAILBREAK_OUTPUT_PATTERNS) {
    if (pattern.test(text)) {
      found.push(pattern.source)
    }
  }
  return found
}

interface ChatCreateParams {
  threadId: string
  message: string
  skillIds: string[]
  knowledgeIds?: string[]
  fileContents?: Array<{ filename: string; content: string }>
  config: {
    base_url: string
    api_key: string
    model_name: string
    temperature: number
    context_window: number
  }
  threadManager: ThreadManager
  skillEngine: SkillEngine
  historyStore: HistoryStore
  sendToExtension: (data: any) => void
  executeTool: (toolCallId: string, toolName: string, params: any, signal?: AbortSignal) => Promise<{ success: boolean; data?: any; error?: string }>
  signal?: AbortSignal
  skipUserMessage?: boolean
}

const MAX_TOOL_CALL_ROUNDS = 100

/** Extract key terms (selectors, IDs, URLs) from a site_knowledge entry for matching. */
function extractKeyTerms(content: string): string[] {
  const terms: string[] = []
  const selectorRe = /[#.]?[a-zA-Z][a-zA-Z0-9_-]*/g
  const attrRe = /\[([^\]]+)\]/g
  const urlRe = /[a-zA-Z0-9.-]+\.(com|cn|org|net|io|dev|localhost)(\/[^\s]*)?/g
  let m
  while ((m = selectorRe.exec(content)) !== null) terms.push(m[0])
  while ((m = attrRe.exec(content)) !== null) terms.push(m[1])
  while ((m = urlRe.exec(content)) !== null) terms.push(m[0])
  return [...new Set(terms)]
}
const CONTINUOUS_FAILURE_LIMIT = 5
const MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3

interface ToolExecutionResult {
  success: boolean
  data?: any
  error?: string
}

export function createToolResultMessage(threadId: string, toolCall: any, result: ToolExecutionResult, params: any = {}) {
  return {
    thread_id: threadId,
    role: "tool" as const,
    content: JSON.stringify(result),
    tool_calls: [{
      id: toolCall.id,
      tool_name: toolCall.function?.name || toolCall.name,
      params,
      result,
    }],
  }
}

export async function chatCreate(params: ChatCreateParams) {
  const { threadId, message, skillIds, knowledgeIds, fileContents, config, threadManager, skillEngine, historyStore, sendToExtension, executeTool, signal, skipUserMessage } = params

  // Create user message (skip for regenerate)
  if (!skipUserMessage) {
    let userContent = message
    if (fileContents?.length) {
      const estimateTokens = (text: string): number => {
        const chineseChars = (text.match(/[一-鿿㐀-䶿]/g) || []).length
        const otherChars = text.length - chineseChars
        return Math.ceil(chineseChars * 1.5 + otherChars / 4)
      }

      const MAX_FILE_TOKENS = Math.min(
        Math.floor(params.config.context_window * 0.4),
        50000,
      )

      const docTags: string[] = []
      let totalTokens = 0

      for (const file of fileContents) {
        const fileTokens = estimateTokens(file.content)

        if (totalTokens + fileTokens > MAX_FILE_TOKENS) {
          const remainingBudget = Math.max(0, MAX_FILE_TOKENS - totalTokens)
          const ratio = remainingBudget / fileTokens
          const truncateLen = Math.floor(file.content.length * ratio * 0.9)

          docTags.push(
            `<document filename="${file.filename}">\n${
              file.content.substring(0, truncateLen)
            }\n...(截断，原文约 ${fileTokens} tokens，取前 ${remainingBudget} tokens)\n</document>`
          )
          totalTokens += remainingBudget
          break
        }

        docTags.push(`<document filename="${file.filename}">\n${file.content}\n</document>`)
        totalTokens += fileTokens
      }

      userContent = `${message}\n\n${docTags.join("\n\n")}`
    }
    threadManager.addMessage(threadId, { thread_id: threadId, role: "user", content: userContent })
  }

  // Activate requested skills
  for (const skillId of skillIds) {
    try {
      skillEngine.activate(threadId, skillId)
    } catch { /* skill may not exist */ }
  }

  // Build system prompt
  const basePrompt = `You are a browser automation agent. You control a real Chrome browser.

CRITICAL RULES:
1. ALWAYS call list_tabs first to get real tab IDs. Chrome tab IDs are large numbers like 83161113 — NEVER use 1, 2, 3.
2. When operating on a page, use the actual tabId from list_tabs results.
3. For create_tab, always pass the full URL parameter.
4. Use navigate(tabId, url) to change a tab's URL — check list_tabs for existing tabs first.
5. Before calling screenshot or page tools, ensure the tab is on a real website (not chrome:// or about:blank).
6. Wait for pages to load before extracting content.
7. For reading page content: use get_page_text (preferred, cross-platform) or evaluate.
8. osascript_eval is macOS-ONLY and will FAIL on Windows/Linux. On non-macOS systems, NEVER call osascript_eval — always use get_page_text or evaluate instead.
9. When a page contains important visual content (product images, data charts, diagrams, maps, infographics), use analyze_image with a CSS selector to understand the image content rather than relying solely on alt text.
10. MCP servers expose namespaced tools as mcp__<server>__<tool> (e.g. mcp__filesystem__read_text_file, mcp__brave_search__brave_web_search). For file/search/local operations, use these namespaced tools directly. mcp_list_resources / mcp_read_resource / mcp_get_prompt are only available when a connected server explicitly advertises the resources/prompts capability; if they are not in the tool list, do not attempt to use them.`
  const skillPrompt = skillEngine.buildSystemPrompt(threadId, undefined, skillIds, knowledgeIds, message)

  // Inject safety-guard skills at the END of system prompt (highest priority)
  const safetyGuardContent = skillEngine.getSecuritySkills()
    .map(s => `## Safety Guard: ${s.name}\n${s.content}`)
    .join("\n\n")

  const systemPrompt = [basePrompt, skillPrompt, safetyGuardContent].filter(Boolean).join("\n\n")

  // Build messages array
  const history = threadManager.getMessages(threadId)
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt })
  }

  for (let i = 0; i < history.length; i++) {
    const msg = history[i]
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content })
    } else if (msg.role === "assistant") {
      const tcList = msg.tool_calls || []
      // Validate: if assistant has tool_calls, verify the next N messages are tool results
      // If not, strip the tool_calls to avoid structural errors
      let validToolCalls = true
      if (tcList.length > 0) {
        for (let j = 0; j < tcList.length; j++) {
          const nextMsg = history[i + 1 + j]
          if (!nextMsg || nextMsg.role !== "tool") {
            validToolCalls = false
            break
          }
        }
      }
      if (validToolCalls && tcList.length > 0) {
        messages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: tcList.map((tc: any) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.function?.name || tc.name, arguments: tc.function?.arguments || tc.arguments || "{}" },
          })),
        } as any)
      } else {
        // Strip broken tool_calls — treat as text-only assistant message
        messages.push({ role: "assistant", content: msg.content || "(tool call failed)" } as any)
      }
    } else if (msg.role === "tool" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(tc.result || {}),
        } as any)
      }
    }
  }

  // Ensure we don't exceed context window (rough estimate) with turn-safe compaction (P1)
  while (JSON.stringify(messages).length > params.config.context_window * 3 && messages.length > 2) {
    const idx = messages.findIndex(m => m.role !== "system")
    if (idx >= 0) {
      const oldest = messages[idx]
      // Safe guard against orphaning tool calls/results in OpenAI API schema
      if (oldest.role === "assistant" && oldest.tool_calls && oldest.tool_calls.length > 0) {
        let countToDelete = 1
        while (
          idx + countToDelete < messages.length &&
          messages[idx + countToDelete].role === "tool"
        ) {
          countToDelete++
        }
        messages.splice(idx, countToDelete)
      } else {
        messages.splice(idx, 1)
      }
    } else {
      break
    }
  }

  // Create OpenAI client
  const client = new OpenAI({
    baseURL: config.base_url,
    apiKey: config.api_key || "sk-placeholder",
    timeout: 120000,
    maxRetries: 0,
  })

  // Native tools + dynamically aggregated MCP tools (mcp__<server>__<tool>).
  // Audit item 7: honor per-thread MCP selection.
  //   "manual"  -> only tools from active_mcp_server_ids reach the LLM.
  //   "all"     -> expose every connected, enabled server.
  //   "auto"    -> legacy default; currently behaves like "all" (future: auto-select).
  // Mode is persisted via thread.update and validated in thread-manager.ts.
  const thread = threadManager.get(threadId)
  const mcpManager = getMcpManager()
  const mcpSelectionMode = thread?.mcp_selection_mode || "auto"
  const activeServerIds = new Set(thread?.active_mcp_server_ids || [])
  let mcpTools
  if (mcpSelectionMode === "manual") {
    mcpTools = mcpManager.getAggregatedToolsForServers(activeServerIds)
  } else {
    mcpTools = mcpManager.getAggregatedTools()
  }

  // Only expose MCP meta tools (resources/prompts) when at least one connected,
  // enabled, and (in manual mode) selected server advertises the capability.
  // This stops the LLM from calling mcp_list_resources on tools-only servers
  // like @modelcontextprotocol/server-filesystem or brave-search.
  const visibleServers = mcpManager.listServers().filter((s) => {
    if (s.connection.status !== "connected" || !s.enabled) return false
    if (mcpSelectionMode === "manual") return activeServerIds.has(s.name)
    return true
  })
  const metaCapabilities = visibleServers.reduce(
    (acc, s) => ({
      resources: acc.resources || s.capabilities.resources,
      prompts: acc.prompts || s.capabilities.prompts,
    }),
    { resources: false, prompts: false },
  )
  const mcpMetaTools = getMcpMetaToolDefinitions(metaCapabilities)
  const tools = [...getToolDefinitions(), ...mcpTools, ...mcpMetaTools]

  // Tool calling loop
  let round = 0
  let continuousFailures = 0
  const recoverableFailureCounts = new Map<string, number>()

  while (round < MAX_TOOL_CALL_ROUNDS) {
    round++

    try {
      const stream = await client.chat.completions.create({
        model: config.model_name,
        messages,
        temperature: config.temperature,
        tools,
        tool_choice: "auto",
        stream: true,
      }, { signal })

      let assistantContent = ""
      let reasoningContent = ""
      let toolCalls: any[] = []

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta as any

        if (delta?.content) {
          assistantContent += delta.content
          // Real-time jailbreak detection during streaming
          const jailbreakPatterns = detectJailbreakInOutput(assistantContent)
          if (jailbreakPatterns.length > 0) {
            logger.warn("llm.jailbreak_detected", {
              thread_id: threadId,
              patterns: jailbreakPatterns,
            })
            sendToExtension({
              type: "chat.error",
              thread_id: threadId,
              error: "安全阻断: 检测到越狱模式输出。对话已终止。",
            })
            return
          }
          sendToExtension({ type: "chat.token", thread_id: threadId, content: assistantContent })
        }

        // DeepSeek thinking mode: capture reasoning_content
        if (delta?.reasoning_content) {
          reasoningContent += delta.reasoning_content
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              if (!toolCalls[tc.index]) {
                toolCalls[tc.index] = { id: tc.id || "", type: "function", function: { name: "", arguments: "" } }
              }
              if (tc.id) toolCalls[tc.index].id = tc.id
              if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name
              if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments
            }
          }
        }
      }

      // Save assistant message
      const assistantMsg = toolCalls.filter(Boolean)
      const savedMsg = {
        thread_id: threadId,
        role: "assistant" as const,
        content: assistantContent,
        tool_calls: assistantMsg,
      }
      const savedAssistant = threadManager.addMessage(threadId, savedMsg)

      // Push assistant message with tool_calls and reasoning_content to messages array
      const assistantPushMsg: any = {
        role: "assistant",
        content: assistantContent || null,
      }
      if (reasoningContent) {
        assistantPushMsg.reasoning_content = reasoningContent
      }
      if (assistantMsg.length > 0) {
        assistantPushMsg.tool_calls = assistantMsg.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }))
      }
      messages.push(assistantPushMsg)

      // If no tool calls, we're done
      if (assistantMsg.length === 0) {
        // Echo the persisted assistant message id so the UI adopts it (instead of its own
        // client-generated id) — this keeps the UI's message id in sync with what the
        // companion stored, so anchor-based features (per-message export) work on the
        // just-received response without a thread reload.
        sendToExtension({ type: "chat.done", thread_id: threadId, message_id: savedAssistant.id })
        // Best-effort auto-alias: generate a short title if thread has no alias yet
        generateThreadTitle({ threadId, threadManager, config, sendToExtension })
        return
      }

      // Execute tool calls via extension (async — wait for results)
      const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
      let shouldStop = false

      for (const tc of assistantMsg) {
        const toolName = tc.function.name
        let params: any = {}
        try {
          params = JSON.parse(tc.function.arguments || "{}")
        } catch (parseErr: any) {
          logger.warn("llm.tool_parse_error", {
            tool_call_id: tc.id,
            tool_name: toolName,
            arguments: tc.function.arguments,
            error: parseErr.message,
          })
          const parseResult = {
            success: false,
            error: `Invalid JSON in tool arguments: ${parseErr.message}. Received: ${tc.function.arguments}`,
          }
          threadManager.addMessage(threadId, createToolResultMessage(threadId, tc, parseResult, {}))
          sendToExtension({
            type: "tool.result",
            tool_call_id: tc.id,
            tool_name: toolName,
            result: parseResult,
          })
          toolResults.push({
            role: "tool" as const,
            tool_call_id: tc.id,
            content: JSON.stringify(parseResult),
          })
          continue
        }

        // Audit item 4: validate the parsed args against the per-tool zod schema.
        // LLM-produced JSON crosses the runtime boundary untyped; a hallucinated
        // shape (tabId as string, url as number, fields as object) would otherwise
        // flow straight into executeTool / executeCompanionTool / MCP subprocess
        // / osascript. On validation failure, route to the same recovery path as
        // JSON.parse errors — return an error tool_result so the LLM can self-
        // correct on the next turn.
        const parsed = tryParseToolArgs(toolName, params)
        if (!parsed.ok) {
          logger.warn("llm.tool_arg_validation_failed", {
            tool_call_id: tc.id,
            tool_name: toolName,
            arguments: tc.function.arguments,
            error: parsed.error,
          })
          const validationResult = {
            success: false,
            error: parsed.error,
          }
          threadManager.addMessage(threadId, createToolResultMessage(threadId, tc, validationResult, {}))
          sendToExtension({
            type: "tool.result",
            tool_call_id: tc.id,
            tool_name: toolName,
            result: validationResult,
          })
          toolResults.push({
            role: "tool" as const,
            tool_call_id: tc.id,
            content: JSON.stringify(validationResult),
          })
          continue
        }
        params = parsed.args

        const startTime = Date.now()

        try {
          let toolResult = await executeTool(tc.id, toolName, {
            ...params,
            tabId: params.tabId ?? threadManager.get(threadId)?.pinned_tabs?.[0],
          }, signal)

          const durationMs = Date.now() - startTime

          // Record to history
          historyStore.record({
            thread_id: threadId,
            tool_name: toolName,
            params: JSON.stringify(params),
            result_summary: toolResult.success
              ? JSON.stringify(toolResult.data || {}).substring(0, 500)
              : "",
            error: toolResult.error || null,
            success: toolResult.success ? 1 : 0,
            duration_ms: durationMs,
            created_at: new Date().toISOString(),
          })

          // Send tool result to extension for UI display (before vision analysis so UI shows raw result)
          sendToExtension({
            type: "tool.result",
            tool_call_id: tc.id,
            tool_name: toolName,
            result: toolResult,
          })

          // Vision pipeline: intercept image-carrying tool results for local analysis
          const VISION_TOOLS = ["screenshot", "analyze_image"]
          if (VISION_TOOLS.includes(toolName) && toolResult.success && toolResult.data?.image_base64) {
            const config = getConfig()
            const visionEnabled = config.vision?.enabled
              // Thread-level override: vision_enabled can disable per-thread
              ?? (threadManager.get(threadId)?.config_override as any)?.vision_enabled

            if (visionEnabled && config.vision) {
              sendToExtension({ type: "tool.vision_start", tool_call_id: tc.id })

              try {
                const visionResult = await analyzeImage(
                  {
                    base64: toolResult.data.image_base64,
                    width: toolResult.data.width,
                    height: toolResult.data.height,
                    url: toolResult.data.url,
                    title: toolResult.data.title,
                  },
                  config.vision,
                  params.prompt, // custom prompt from analyze_image tool
                )

                // Replace base64 image with text description
                toolResult = {
                  success: true,
                  data: {
                    vision_description: visionResult.description,
                    vision_cached: visionResult.cached,
                    vision_model: visionResult.model_used,
                    vision_latency_ms: visionResult.latency_ms,
                    url: toolResult.data.url,
                    title: toolResult.data.title,
                    width: toolResult.data.width,
                    height: toolResult.data.height,
                    alt_text: toolResult.data.alt_text,
                    selector: toolResult.data.selector,
                    image_available: true,
                  },
                }

                sendToExtension({
                  type: "tool.vision_done",
                  tool_call_id: tc.id,
                  cached: visionResult.cached,
                  latency_ms: visionResult.latency_ms,
                })
              } catch (visionErr: any) {
                logger.warn("llm.vision_failed", {
                  tool_call_id: tc.id,
                  error: visionErr.message,
                  fallback: config.vision.fallback,
                })
                sendToExtension({
                  type: "tool.vision_done",
                  tool_call_id: tc.id,
                  error: visionErr.message,
                })

                if (config.vision.fallback === "metadata") {
                  toolResult = {
                    success: true,
                    data: {
                      vision_description: `Screenshot of "${toolResult.data.title}" (${toolResult.data.url}), ${toolResult.data.width}x${toolResult.data.height}px. (Vision model unavailable: ${visionErr.message})`,
                      url: toolResult.data.url,
                      title: toolResult.data.title,
                      width: toolResult.data.width,
                      height: toolResult.data.height,
                      image_available: true,
                    },
                  }
                }
                // "passthrough": keep original toolResult (base64 will be truncated at 8000 chars)
                // "error": keep original toolResult (LLM sees truncated base64)
              }
            }
          }

          threadManager.addMessage(threadId, createToolResultMessage(threadId, tc, toolResult, params))

          if (toolResult.success) {
            // Reset failure counters on success
            continuousFailures = 0
            recoverableFailureCounts.delete(toolName)
          } else {
            logger.warn("llm.tool_failed", {
              tool_call_id: tc.id,
              tool_name: toolName,
              error: toolResult.error,
              params,
            })

            // Auto-recovery for tabId hallucination (P0): inject available tabs into error
            const tabIdErrorPatterns = [
              "No tab with given id",
              "TAB_NOT_FOUND",
              "No active tab found",
              "tabId is required",
            ]
            const isTabIdError = tabIdErrorPatterns.some(p => toolResult.error?.includes(p))
            if (isTabIdError) {
              logger.info("llm.tabId_hallucination_detected", {
                tool_call_id: tc.id,
                tool_name: toolName,
                error: toolResult.error,
              })
              try {
                const tabsResult = await executeTool(`${tc.id}_recovery`, "list_tabs", {})
                if (tabsResult.success && Array.isArray(tabsResult.data)) {
                  const tabSummary = tabsResult.data.map((t: any) =>
                    `- tabId=${t.id}: ${t.title || "untitled"} (${t.url || "no url"})`
                  ).join("\n")
                  toolResult = {
                    success: false,
                    error: `${toolResult.error}\n\nAvailable tabs:\n${tabSummary}\n\nCRITICAL: Always call list_tabs first to get real tab IDs. Never guess tab IDs like 1, 2, 3.`,
                    data: { ...toolResult.data, recovery_tabs: tabsResult.data },
                  }
                  logger.info("llm.tabId_recovery_injected", {
                    tool_call_id: tc.id,
                    available_tabs: tabsResult.data.length,
                  })
                }
              } catch (recoveryErr: any) {
                logger.warn("llm.tabId_recovery_failed", {
                  tool_call_id: tc.id,
                  error: recoveryErr.message,
                })
              }
            }

            // L1 Stale detection: match error against site_knowledge entries
            try {
              const activeSkills = skillEngine.getActiveForThread(threadId)
              for (const skill of activeSkills) {
                if (skill.type !== "site_knowledge" || !skill.entries) continue
                for (const entry of skill.entries) {
                  if (entry.stale) continue
                  const entryTerms = extractKeyTerms(entry.content)
                  const match = entryTerms.some(t => t.length > 2 && toolResult.error!.includes(t))
                  if (match) {
                    skillEngine.markEntryStale(skill.name, entry.id, toolResult.error!.substring(0, 80))
                  }
                }
              }
            } catch { /* best-effort stale detection */ }

            const errorLevel = classifyError(toolResult.error || "", { toolName })
            logger.info("llm.error_classified", {
              tool_call_id: tc.id,
              tool_name: toolName,
              error_level: errorLevel,
              error: toolResult.error,
            })

            if (errorLevel === "security") {
              shouldStop = true
              sendToExtension({
                type: "chat.error",
                thread_id: threadId,
                error: `安全阻断: ${toolResult.error}`,
              })
              break
            }
            if (errorLevel === "non_recoverable") {
              shouldStop = true
              sendToExtension({
                type: "chat.error",
                thread_id: threadId,
                error: `不可恢复错误: ${toolResult.error}`,
              })
              break
            }

            // Recoverable errors — feed back to LLM for retry, with infinite-loop guard
            const failCount = (recoverableFailureCounts.get(toolName) || 0) + 1
            recoverableFailureCounts.set(toolName, failCount)
            if (failCount >= MAX_SAME_TOOL_RECOVERABLE_FAILURES) {
              logger.error("llm.recoverable_loop_detected", {
                tool_name: toolName,
                fail_count: failCount,
                threshold: MAX_SAME_TOOL_RECOVERABLE_FAILURES,
                last_error: toolResult.error,
              })
              shouldStop = true
              sendToExtension({
                type: "chat.error",
                thread_id: threadId,
                error: `工具 ${toolName} 连续 ${failCount} 次执行失败，已停止以防止无限循环。最后错误: ${toolResult.error}`,
              })
              break
            }
          }

          // Truncate huge tool results to protect context window
          const MAX_RESULT_CHARS = 8000
          let resultContent = JSON.stringify(toolResult)
          const originalLen = resultContent.length
          if (resultContent.length > MAX_RESULT_CHARS) {
            resultContent = resultContent.substring(0, MAX_RESULT_CHARS)
              + `...(truncated, original ${originalLen} chars)`
          }
          toolResults.push({
            role: "tool" as const,
            tool_call_id: tc.id,
            content: resultContent,
          })
        } catch (e: any) {
          logger.error("llm.tool_execution_exception", {
            tool_call_id: tc.id,
            tool_name: toolName,
            error: e.message || String(e),
            stack: e.stack,
          })
          const result = { success: false, error: e.message || String(e) }
          threadManager.addMessage(threadId, createToolResultMessage(threadId, tc, result, params))
          sendToExtension({
            type: "chat.error",
            thread_id: threadId,
            error: `Tool execution exception: ${result.error}`,
          })
          shouldStop = true
          break
        }
      }

      if (shouldStop) {
        // Remove the assistant message we pushed (no tool results to pair with it)
        messages.pop()
        // Add error as text-only assistant message instead
        sendToExtension({ type: "chat.done", thread_id: threadId })
        return
      }

      // Add tool results to messages for next LLM round
      messages.push(...toolResults)

    } catch (e: any) {
      if (e.name === "AbortError" || signal?.aborted) throw e

      const errorMsg = e.message || String(e)
      const isAuthError = errorMsg.includes("401") || errorMsg.includes("403") || errorMsg.includes("Incorrect API key")
      const isStructuralError = errorMsg.includes("400") && errorMsg.includes("tool")

      logger.error("llm.api_error", {
        error: errorMsg,
        is_auth_error: isAuthError,
        is_structural_error: isStructuralError,
        round,
        continuous_failures: continuousFailures,
      })

      sendToExtension({
        type: "chat.error",
        thread_id: threadId,
        error: errorMsg,
      })

      // Auth errors and structural errors are fatal — stop immediately
      if (isAuthError) {
        logger.error("llm.auth_error", { error: errorMsg })
        sendToExtension({
          type: "chat.error",
          thread_id: threadId,
          error: "API Key 无效，请在设置中配置正确的 API Key。",
        })
        return
      }
      if (isStructuralError) {
        logger.error("llm.structural_error", { error: errorMsg })
        sendToExtension({
          type: "chat.error",
          thread_id: threadId,
          error: "消息结构错误，已停止。请重试。",
        })
        return
      }

      continuousFailures++
      logger.warn("llm.recoverable_api_error", {
        error: errorMsg,
        continuous_failures: continuousFailures,
        limit: CONTINUOUS_FAILURE_LIMIT,
      })
      if (continuousFailures >= CONTINUOUS_FAILURE_LIMIT) {
        logger.error("llm.failure_limit_reached", {
          continuous_failures: continuousFailures,
          limit: CONTINUOUS_FAILURE_LIMIT,
        })
        sendToExtension({
          type: "chat.error",
          thread_id: threadId,
          error: `连续 ${CONTINUOUS_FAILURE_LIMIT} 次失败，已暂停。请检查配置或手动介入。`,
        })
        return
      }

      // Retry with error context
      messages.push({
        role: "user",
        content: `Error occurred: ${errorMsg}. Please try a different approach.`,
      } as any)
    }
  }

  sendToExtension({
    type: "chat.error",
    thread_id: threadId,
    error: `达到最大工具调用轮次 (${MAX_TOOL_CALL_ROUNDS})，已暂停。`,
  })
}

/** Best-effort auto-naming: summarize the first exchange into a short title. Set force=true to overwrite an existing alias. */
export async function generateThreadTitle(params: {
  threadId: string
  threadManager: ThreadManager
  config: ChatCreateParams["config"]
  sendToExtension: (data: any) => void
  force?: boolean
}) {
  const { threadId, threadManager, config, sendToExtension, force } = params
  try {
    const thread = threadManager.get(threadId)
    if (!thread) return
    if (thread.alias && !force) return

    const msgs = threadManager.getMessages(threadId)
    const hasUser = msgs.some(m => m.role === "user")
    const hasAssistant = msgs.some(m => m.role === "assistant")
    if (!hasUser || !hasAssistant) return

    // Take first few exchanges (up to 3 rounds) to keep the prompt short
    const previewMsgs = msgs
      .filter(m => m.role === "user" || m.role === "assistant")
      .slice(0, 6)
      .map(m => `${m.role === "user" ? "用户" : "AI"}: ${(m.content || "").substring(0, 180)}`)
      .join("\n")

    if (previewMsgs.length < 10) return

    const client = new OpenAI({
      baseURL: config.base_url,
      apiKey: config.api_key || "sk-placeholder",
      timeout: 8000,
      maxRetries: 0,
    })

    const response = await client.chat.completions.create({
      model: config.model_name,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: "根据以下对话内容，生成一个极其简短的标题（不超过10个字），直接输出标题文本，不要加任何解释、引号或前缀。",
        },
        { role: "user", content: previewMsgs },
      ],
    })

    let alias = response.choices[0]?.message?.content?.trim().replace(/[\n"'"]/g, "") || ""
    // Truncate and sanitize
    alias = alias.slice(0, 16)
    if (alias) {
      threadManager.update(threadId, { alias })
      sendToExtension({ type: "thread.updated", thread: threadManager.get(threadId) })
    }
  } catch {
    // Silently fail — alias generation is best-effort
  }
}
