// LLM adapter — OpenAI-compatible chat completions with tool calling

import OpenAI from "openai"
import type { ThreadManager } from "../threads/thread-manager"
import type { SkillEngine } from "../skills/skill-engine"
import type { HistoryStore } from "../history/store"
import { getToolDefinitions } from "../bridge/tool-definitions"
import { classifyError } from "../security"

interface ChatCreateParams {
  threadId: string
  message: string
  skillIds: string[]
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
  executeTool: (toolCallId: string, toolName: string, params: any) => Promise<{ success: boolean; data?: any; error?: string }>
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
  const { threadId, message, skillIds, config, threadManager, skillEngine, historyStore, sendToExtension, executeTool, signal, skipUserMessage } = params

  // Create user message (skip for regenerate)
  if (!skipUserMessage) {
    threadManager.addMessage(threadId, { thread_id: threadId, role: "user", content: message })
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
8. osascript_eval is macOS-ONLY and will FAIL on Windows/Linux. On non-macOS systems, NEVER call osascript_eval — always use get_page_text or evaluate instead.`
  const skillPrompt = skillEngine.buildSystemPrompt(threadId)
  const systemPrompt = [basePrompt, skillPrompt].filter(Boolean).join("\n\n")

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

  const tools = getToolDefinitions()

  // Tool calling loop
  let round = 0
  let continuousFailures = 0

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
      threadManager.addMessage(threadId, savedMsg)

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
        sendToExtension({ type: "chat.done", thread_id: threadId })
        // Best-effort auto-alias: generate a short title if thread has no alias yet
        autoAliasThread({ threadId, threadManager, config, sendToExtension })
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
        } catch { /* ignore parse errors */ }

        const startTime = Date.now()

        try {
          const result = await executeTool(tc.id, toolName, {
            ...params,
            tabId: params.tabId ?? threadManager.get(threadId)?.pinned_tabs?.[0],
          })

          const durationMs = Date.now() - startTime

          // Record to history
          historyStore.record({
            thread_id: threadId,
            tool_name: toolName,
            params: JSON.stringify(params),
            result_summary: result.success
              ? JSON.stringify(result.data || {}).substring(0, 500)
              : "",
            error: result.error || null,
            success: result.success ? 1 : 0,
            duration_ms: durationMs,
            created_at: new Date().toISOString(),
          })

          // Send tool result to extension for UI display
          sendToExtension({
            type: "tool.result",
            tool_call_id: tc.id,
            tool_name: toolName,
            result,
          })

          threadManager.addMessage(threadId, createToolResultMessage(threadId, tc, result, params))

          if (!result.success) {
            // L1 Stale detection: match error against site_knowledge entries
            try {
              const activeSkills = skillEngine.getActiveForThread(threadId)
              for (const skill of activeSkills) {
                if (skill.type !== "site_knowledge" || !skill.entries) continue
                for (const entry of skill.entries) {
                  if (entry.stale) continue
                  // Match: extract selectors/IDs from entry content and check if they appear in error
                  const entryTerms = extractKeyTerms(entry.content)
                  const match = entryTerms.some(t => t.length > 2 && result.error!.includes(t))
                  if (match) {
                    skillEngine.markEntryStale(skill.name, entry.id, result.error!.substring(0, 80))
                  }
                }
              }
            } catch { /* best-effort stale detection */ }
            const errorLevel = classifyError(result.error || "", { toolName })
            if (errorLevel === "security") {
              shouldStop = true
              sendToExtension({
                type: "chat.error",
                thread_id: threadId,
                error: `安全阻断: ${result.error}`,
              })
              break
            }
            if (errorLevel === "non_recoverable") {
              shouldStop = true
              sendToExtension({
                type: "chat.error",
                thread_id: threadId,
                error: `不可恢复错误: ${result.error}`,
              })
              break
            }
            // Recoverable errors — feed back to LLM for retry
          }

          // Truncate huge tool results to protect context window
          const MAX_RESULT_CHARS = 8000
          let resultContent = JSON.stringify(result)
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

      sendToExtension({
        type: "chat.error",
        thread_id: threadId,
        error: errorMsg,
      })

      // Auth errors and structural errors are fatal — stop immediately
      if (isAuthError) {
        sendToExtension({
          type: "chat.error",
          thread_id: threadId,
          error: "API Key 无效，请在设置中配置正确的 API Key。",
        })
        return
      }
      if (isStructuralError) {
        sendToExtension({
          type: "chat.error",
          thread_id: threadId,
          error: "消息结构错误，已停止。请重试。",
        })
        return
      }

      continuousFailures++
      if (continuousFailures >= CONTINUOUS_FAILURE_LIMIT) {
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

/** Best-effort auto-naming: when a thread has no alias, summarize the first exchange into a short title. */
async function autoAliasThread(params: {
  threadId: string
  threadManager: ThreadManager
  config: ChatCreateParams["config"]
  sendToExtension: (data: any) => void
}) {
  const { threadId, threadManager, config, sendToExtension } = params
  try {
    const thread = threadManager.get(threadId)
    if (!thread || thread.alias) return

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
