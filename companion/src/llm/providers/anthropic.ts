/**
 * Anthropic Messages LlmProvider — fetch + SSE (no @anthropic-ai/sdk).
 * Headers via headers.ts (L7 first-party deny, clean UA / claude_code_compat).
 */

import type { LlmConfig } from "../../config"
import { logger } from "../../logger"
import type {
  CanonicalStreamEvent,
  CompleteParams,
  CompleteResult,
  LlmProvider,
  StreamChatParams,
} from "../provider"
import {
  buildAnthropicRequestBody,
  resolveAnthropicMessagesUrl,
} from "./anthropic-convert"
import {
  buildRequestHeaders,
  headerNamesForLog,
  hostnameFromBaseUrl,
} from "./headers"

export class AnthropicProvider implements LlmProvider {
  private readonly config: LlmConfig

  constructor(config: LlmConfig) {
    this.config = config
  }

  private buildHeaders(): Record<string, string> {
    return buildRequestHeaders({
      baseUrl: this.config.base_url,
      protocol: "anthropic",
      apiKey: this.config.api_key || "",
      auth_style: this.config.auth_style,
      client_header_profile: this.config.client_header_profile,
      claude_code_compat_version: this.config.claude_code_compat_version,
      anthropic_version: this.config.anthropic_version,
      extra_headers: this.config.extra_headers,
    })
  }

  private logRequestMeta(url: string, headers: Record<string, string>): void {
    // Values never logged — only names + profile + host (L7 / §6)
    logger.info("llm.anthropic_request", {
      base_host: hostnameFromBaseUrl(this.config.base_url),
      profile: this.config.client_header_profile ?? "none",
      header_names: headerNamesForLog(headers),
      // path only, not full URL with query secrets
      path: (() => {
        try {
          return new URL(url).pathname
        } catch {
          return "/messages"
        }
      })(),
    })
  }

  async *streamChat(params: StreamChatParams): AsyncIterable<CanonicalStreamEvent> {
    const model = params.model ?? this.config.model_name
    const temperature = params.temperature ?? this.config.temperature
    const url = resolveAnthropicMessagesUrl(this.config.base_url)
    const headers = this.buildHeaders()
    this.logRequestMeta(url, headers)

    const body = buildAnthropicRequestBody({
      model,
      contextWindow: this.config.context_window,
      messages: params.messages,
      tools: params.tools,
      temperature,
      stream: true,
    })

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: params.signal,
    })

    if (!response.ok) {
      const errText = await safeReadText(response)
      throw new AnthropicHttpError(
        `Anthropic Messages HTTP ${response.status}: ${truncate(errText, 500)}`,
        response.status,
        errText,
      )
    }

    if (!response.body) {
      throw new Error("Anthropic stream response has no body")
    }

    yield* parseAnthropicSseStream(response.body, params.signal)
  }

  async complete(params: CompleteParams): Promise<CompleteResult> {
    const model = params.model ?? this.config.model_name
    const temperature = params.temperature ?? this.config.temperature
    const url = resolveAnthropicMessagesUrl(this.config.base_url)
    const headers = this.buildHeaders()
    this.logRequestMeta(url, headers)

    const body = buildAnthropicRequestBody({
      model,
      contextWindow: this.config.context_window,
      messages: params.messages,
      temperature,
      stream: false,
    })

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: params.signal,
    })

    if (!response.ok) {
      const errText = await safeReadText(response)
      throw new AnthropicHttpError(
        `Anthropic Messages HTTP ${response.status}: ${truncate(errText, 500)}`,
        response.status,
        errText,
      )
    }

    const json = (await response.json()) as AnthropicMessageResponse
    return mapAnthropicCompleteResponse(json)
  }
}

export class AnthropicHttpError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = "AnthropicHttpError"
    this.status = status
    this.body = body
  }
}

// ── Response types (minimal) ───────────────────────────────────────────────

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
}

interface AnthropicMessageResponse {
  content?: Array<{
    type: string
    text?: string
    thinking?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
  }>
  stop_reason?: string | null
  usage?: AnthropicUsage
}

export function mapAnthropicCompleteResponse(json: AnthropicMessageResponse): CompleteResult {
  let content = ""
  let reasoning = ""
  for (const block of json.content || []) {
    if (block.type === "text" && block.text) {
      content += block.text
    } else if (block.type === "thinking" && block.thinking) {
      reasoning += block.thinking
    }
  }
  const result: CompleteResult = {
    content: content.trim(),
    finish_reason: json.stop_reason ?? null,
  }
  if (reasoning) result.reasoning = reasoning
  if (json.usage) {
    const prompt = json.usage.input_tokens
    const completion = json.usage.output_tokens
    result.usage = {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens:
        prompt !== undefined || completion !== undefined
          ? (prompt ?? 0) + (completion ?? 0)
          : undefined,
    }
  }
  return result
}

// ── SSE parser ─────────────────────────────────────────────────────────────

/**
 * Parse Anthropic SSE byte stream into CanonicalStreamEvent.
 * Exported for fixture tests without network.
 */
export async function* parseAnthropicSseStream(
  body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<CanonicalStreamEvent> {
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  /** Anthropic content-block index → tool-call index among tool_use only. */
  const toolIndexByBlock = new Map<number, number>()
  let nextToolIndex = 0
  let finishReason: string | null | undefined
  let emittedUsage = false

  const processEvent = function* (
    eventName: string | undefined,
    data: string,
  ): Generator<CanonicalStreamEvent> {
    if (!data || data === "[DONE]") return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }

    const type = (parsed.type as string) || eventName || ""

    if (type === "content_block_start") {
      const index = typeof parsed.index === "number" ? parsed.index : 0
      const block = parsed.content_block as
        | { type?: string; id?: string; name?: string; text?: string; thinking?: string }
        | undefined
      if (!block) return
      if (block.type === "tool_use") {
        const toolIdx = nextToolIndex++
        toolIndexByBlock.set(index, toolIdx)
        yield {
          type: "tool_call_delta",
          index: toolIdx,
          id: block.id,
          name: block.name,
        }
      } else if (block.type === "thinking" && block.thinking) {
        yield { type: "reasoning", text: block.thinking }
      }
      // text block start usually has empty text — ignore
      return
    }

    if (type === "content_block_delta") {
      const index = typeof parsed.index === "number" ? parsed.index : 0
      const delta = parsed.delta as
        | {
            type?: string
            text?: string
            partial_json?: string
            thinking?: string
          }
        | undefined
      if (!delta) return

      if (delta.type === "text_delta" && delta.text) {
        yield { type: "token", text: delta.text }
        return
      }
      if (delta.type === "input_json_delta" && delta.partial_json != null) {
        const toolIdx = toolIndexByBlock.has(index)
          ? toolIndexByBlock.get(index)!
          : (() => {
              const t = nextToolIndex++
              toolIndexByBlock.set(index, t)
              return t
            })()
        yield {
          type: "tool_call_delta",
          index: toolIdx,
          arguments: delta.partial_json,
        }
        return
      }
      if (
        (delta.type === "thinking_delta" || delta.type === "thinking") &&
        delta.thinking
      ) {
        yield { type: "reasoning", text: delta.thinking }
        return
      }
      // Some gateways emit plain thinking field without type
      if (delta.thinking && !delta.text && !delta.partial_json) {
        yield { type: "reasoning", text: delta.thinking }
      }
      return
    }

    if (type === "message_delta") {
      const delta = parsed.delta as { stop_reason?: string | null } | undefined
      if (delta?.stop_reason) finishReason = delta.stop_reason
      const usage = parsed.usage as AnthropicUsage | undefined
      if (usage && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
        emittedUsage = true
        const prompt = usage.input_tokens
        const completion = usage.output_tokens
        yield {
          type: "usage",
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens:
            prompt !== undefined || completion !== undefined
              ? (prompt ?? 0) + (completion ?? 0)
              : undefined,
        }
      }
      return
    }

    if (type === "message_start") {
      const message = parsed.message as { usage?: AnthropicUsage } | undefined
      const usage = message?.usage
      if (usage && usage.input_tokens !== undefined && !emittedUsage) {
        // Input tokens often only on message_start; final total on message_delta
        yield {
          type: "usage",
          prompt_tokens: usage.input_tokens,
          completion_tokens: usage.output_tokens,
          total_tokens:
            usage.input_tokens + (usage.output_tokens !== undefined ? usage.output_tokens : 0),
        }
      }
      return
    }

    if (type === "message_stop" || type === "error") {
      // done emitted after stream ends
      if (type === "error") {
        const err = parsed.error as { message?: string } | undefined
        throw new Error(err?.message || "Anthropic SSE error event")
      }
    }
  }

  const feed = async function* (): AsyncGenerator<string> {
    if (isReadableStream(body)) {
      const reader = body.getReader()
      try {
        while (true) {
          if (signal?.aborted) {
            const err = new Error("aborted")
            err.name = "AbortError"
            throw err
          }
          const { done, value } = await reader.read()
          if (done) break
          if (value) yield decoder.decode(value, { stream: true })
        }
        yield decoder.decode()
      } finally {
        try {
          reader.releaseLock()
        } catch {
          /* ignore */
        }
      }
    } else {
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        if (signal?.aborted) {
          const err = new Error("aborted")
          err.name = "AbortError"
          throw err
        }
        yield decoder.decode(chunk, { stream: true })
      }
      yield decoder.decode()
    }
  }

  let currentEvent: string | undefined
  let dataLines: string[] = []

  const flushEvent = function* (): Generator<CanonicalStreamEvent> {
    if (dataLines.length === 0 && currentEvent === undefined) return
    const data = dataLines.join("\n")
    dataLines = []
    const name = currentEvent
    currentEvent = undefined
    yield* processEvent(name, data)
  }

  for await (const text of feed()) {
    buffer += text
    let nl: number
    while ((nl = buffer.indexOf("\n")) >= 0) {
      let line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.endsWith("\r")) line = line.slice(0, -1)

      if (line === "") {
        // event boundary
        yield* flushEvent()
        continue
      }
      if (line.startsWith(":") || line.startsWith(" ")) {
        // comment / ignore
        continue
      }
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim()
        continue
      }
      if (line.startsWith("data:")) {
        // Spec: optional single space after colon
        let payload = line.slice(5)
        if (payload.startsWith(" ")) payload = payload.slice(1)
        dataLines.push(payload)
        continue
      }
      // ignore id: retry: etc.
    }
  }

  // trailing event without final blank line
  if (buffer.length > 0) {
    let line = buffer
    if (line.endsWith("\r")) line = line.slice(0, -1)
    if (line.startsWith("data:")) {
      let payload = line.slice(5)
      if (payload.startsWith(" ")) payload = payload.slice(1)
      dataLines.push(payload)
    } else if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim()
    }
  }
  yield* flushEvent()

  yield { type: "done", finish_reason: finishReason ?? null }
}

function isReadableStream(x: unknown): x is ReadableStream<Uint8Array> {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as ReadableStream<Uint8Array>).getReader === "function"
  )
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ""
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + "…"
}

/** Test helper: encode SSE fixture string as a ReadableStream. */
export function sseStringToStream(sse: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(sse)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    },
  })
}
