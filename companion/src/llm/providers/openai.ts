/**
 * OpenAI-compatible LlmProvider (SDK wrap).
 * Mirrors adapter.ts stream + complete patterns. Sends max_tokens only when a
 * positive number is supplied (StreamChatParams/CompleteParams.max_tokens or
 * config.llm.max_tokens on the complete path). Anthropic always sends a cap.
 */

import OpenAI from "openai"
import type { LlmConfig } from "../../config"
import type {
  CanonicalChatMessage,
  CanonicalStreamEvent,
  CompleteParams,
  CompleteResult,
  CompleteUsage,
  LlmProvider,
  StreamChatParams,
} from "../provider"
import { throwIfLlmEndpointBlocked } from "../../security"
import { isBenignStreamTailClose } from "../transport-error"
import { cleanCompanionUserAgent } from "./headers"
import { streamOpenAIResponses } from "./openai-responses"
import { reasoningParams, reasoningWireEffort } from "../reasoning-effort"
import { LLM_MAX_TOKENS_DEFAULT } from "./anthropic-convert"
import { providerModelLimits } from "../output-budget"

type ChatUsage = OpenAI.Completions.CompletionUsage & {
  prompt_cache_hit_tokens?: number
  prompt_tokens_details?: { cache_write_tokens?: number }
  magpie_cache_unknown?: boolean
}

function chatUsage(u: ChatUsage): CompleteUsage {
  const cached = u.magpie_cache_unknown ? undefined : u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens
  const written = u.magpie_cache_unknown ? undefined : u.prompt_tokens_details?.cache_write_tokens
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: u.total_tokens,
    reasoning_tokens: u.completion_tokens_details?.reasoning_tokens,
    ...(typeof cached === "number" ? { cached_input_tokens: cached } : {}),
    ...(typeof written === "number" ? { cache_creation_input_tokens: written } : {}),
  }
}

export class OpenAIProvider implements LlmProvider {
  private readonly client: OpenAI
  private readonly config: LlmConfig

  constructor(config: LlmConfig) {
    this.config = config
    this.client = new OpenAI({
      baseURL: config.base_url,
      apiKey: config.api_key || "sk-placeholder",
      timeout: 120000,
      maxRetries: 0,
      defaultHeaders: {
        "User-Agent": cleanCompanionUserAgent(),
      },
    })
  }

  async *streamChat(params: StreamChatParams): AsyncIterable<CanonicalStreamEvent> {
    await throwIfLlmEndpointBlocked(this.config.base_url)
    const model = params.model ?? this.config.model_name
    const temperature = params.temperature ?? this.config.temperature
    const spec = providerModelLimits(this.config, model)
    const support = spec?.support ?? "unsupported"
    const effort = params.reasoning_effort ?? this.config.reasoning_effort
    if (spec?.responsesForTools && params.tools?.length) {
      yield* streamOpenAIResponses(this.client, model, reasoningWireEffort(support, effort), { ...params,
        max_tokens: params.max_tokens && Math.min(params.max_tokens, spec.output ?? Infinity) })
      return
    }
    const messages = toWireMessages(params.messages)
    const tools = params.tools as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined

    const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      ...(spec?.provider === "MiniMax" ? { reasoning_split: true } : {}),
      messages,
      ...((spec?.provider === "OpenAI" && support !== "unsupported") || spec?.provider === "Kimi" || spec?.provider === "MiniMax" ? {} : { temperature }),
      stream: true,
      stream_options: { include_usage: true },
    }
    Object.assign(createParams, reasoningParams(support, effort, "openai"))
    if (typeof params.max_tokens === "number" && params.max_tokens > 0) {
      const limit = Math.min(params.max_tokens, spec?.output ?? Infinity)
      if (spec?.provider === "OpenAI" || support === "kimi" || spec?.provider === "MiniMax") createParams.max_completion_tokens = limit
      else createParams.max_tokens = limit
    }
    if (tools && tools.length > 0) {
      createParams.tools = tools
      createParams.tool_choice = "auto"
    }

    const stream = await this.client.chat.completions.create(createParams, {
      signal: params.signal,
      ...(spec?.provider === "Grok" && params.promptCacheKey ? { headers: { "x-grok-conv-id": params.promptCacheKey } } : {}),
    })

    let streamedReasoning = ""
    let finishReason: string | null | undefined

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        const delta = choice?.delta as
          | (OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
              reasoning_content?: string
            })
          | undefined

        if ((chunk as { usage?: OpenAI.Completions.CompletionUsage }).usage) {
          const u = (chunk as { usage: OpenAI.Completions.CompletionUsage }).usage
          yield { type: "usage", ...chatUsage(u) }
        }

        if (delta?.content) {
          yield { type: "token", text: delta.content }
        }

        // A delta may legitimately repeat prior text. Only a full message is a snapshot.
        if (delta?.reasoning_content) {
          streamedReasoning += delta.reasoning_content
          yield { type: "reasoning", text: delta.reasoning_content }
        }
        const snapshot = (choice as { message?: { reasoning_content?: unknown } } | undefined)?.message?.reasoning_content
        if (typeof snapshot === "string" && snapshot !== streamedReasoning) {
          const replace = !snapshot.startsWith(streamedReasoning)
          const text = replace ? snapshot : snapshot.slice(streamedReasoning.length)
          streamedReasoning = snapshot
          yield { type: "reasoning", text, ...(replace ? { replace: true } : {}) }
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index === undefined) continue
            const ev: CanonicalStreamEvent = {
              type: "tool_call_delta",
              index: tc.index,
            }
            if (tc.id) ev.id = tc.id
            if (tc.function?.name) ev.name = tc.function.name
            if (tc.function?.arguments) ev.arguments = tc.function.arguments
            yield ev
          }
        }

        if (choice?.finish_reason) {
          finishReason = choice.finish_reason
        }
      }
    } catch (err) {
      // DeepSeek-class gateways often deliver finish_reason and then RST
      // the socket instead of `data: [DONE]`. The round is complete; throwing
      // here discards the tool calls and surfaces "Premature close".
      if (finishReason == null || !isBenignStreamTailClose(err)) throw err
    }

    yield { type: "done", finish_reason: finishReason ?? null }
  }

  async complete(params: CompleteParams): Promise<CompleteResult> {
    await throwIfLlmEndpointBlocked(this.config.base_url)
    const model = params.model ?? this.config.model_name
    const temperature = params.temperature ?? this.config.temperature
    const spec = providerModelLimits(this.config, model)
    const support = spec?.support ?? "unsupported"
    const effort = params.reasoning_effort ?? this.config.reasoning_effort
    const messages = toWireMessages(params.messages)

    const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      ...(spec?.provider === "MiniMax" ? { reasoning_split: true } : {}),
      ...((spec?.provider === "OpenAI" && support !== "unsupported") || spec?.provider === "Kimi" || spec?.provider === "MiniMax" ? {} : { temperature }),
      messages,
    }
    Object.assign(createParams, reasoningParams(support, effort, "openai"))
    // The explicit non-chat vision probe also serves legacy compatible gateways.
    if (params.reasoning_effort === "none" && !spec) Object.assign(createParams, { reasoning_effort: "none" })
    // Same policy as streamChat: send a cap only when explicitly requested.
    const completeMax = params.max_tokens ?? (this.config.max_tokens === 0 ? LLM_MAX_TOKENS_DEFAULT : this.config.max_tokens)
    if (typeof completeMax === "number" && completeMax > 0) {
      const limit = Math.min(completeMax, spec?.output ?? Infinity)
      if (spec?.provider === "OpenAI" || support === "kimi" || spec?.provider === "MiniMax") createParams.max_completion_tokens = limit
      else createParams.max_tokens = limit
    }

    const response = await this.client.chat.completions.create(createParams, {
      signal: params.signal,
      ...(params.rejectRedirects ? { fetchOptions: { redirect: "error" } } : {}),
    })

    if (!Array.isArray(response.choices)) {
      const error = (response as unknown as { error?: unknown }).error
      throw new Error(`Model endpoint returned an error: ${typeof error === "string" ? error : JSON.stringify(error ?? "missing choices")}`)
    }
    const choice = response.choices[0]
    const content = choice?.message?.content?.trim() || ""
    const reasoning = (choice?.message as { reasoning_content?: string } | undefined)
      ?.reasoning_content

    const result: CompleteResult = {
      content,
      finish_reason: choice?.finish_reason ?? null,
    }
    if (reasoning) {
      result.reasoning = reasoning
    }
    if (response.usage) result.usage = chatUsage(response.usage)
    return result
  }
}

/** Re-export for tests that need to type-narrow messages without pulling OpenAI types. */
export type { CanonicalChatMessage }

/**
 * Map canonical messages to OpenAI wire-safe params.
 * The tool variant's internal `name` (fail-closed shrink labeling) is not in
 * ChatCompletionToolMessageParam — strict OpenAI-compatible gateways 400 on it.
 */
function toWireMessages(
  messages: CanonicalChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      const { name: _internalName, ...wire } = m
      return wire
    }
    return m
  }) as OpenAI.Chat.Completions.ChatCompletionMessageParam[]
}
