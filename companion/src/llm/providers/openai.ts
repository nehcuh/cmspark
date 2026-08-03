/**
 * OpenAI-compatible LlmProvider (SDK wrap).
 * Mirrors adapter.ts stream + complete patterns; does not send max_tokens (parity doc).
 */

import OpenAI from "openai"
import type { LlmConfig } from "../../config"
import type {
  CanonicalChatMessage,
  CanonicalStreamEvent,
  CompleteParams,
  CompleteResult,
  LlmProvider,
  StreamChatParams,
} from "../provider"
import { cleanCompanionUserAgent } from "./headers"

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
    const model = params.model ?? this.config.model_name
    const temperature = params.temperature ?? this.config.temperature
    const messages = params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    const tools = params.tools as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined

    const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      messages,
      temperature,
      stream: true,
      stream_options: { include_usage: true },
    }
    if (tools && tools.length > 0) {
      createParams.tools = tools
      createParams.tool_choice = "auto"
    }

    const stream = await this.client.chat.completions.create(createParams, {
      signal: params.signal,
    })

    let finishReason: string | null | undefined

    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      const delta = choice?.delta as
        | (OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
            reasoning_content?: string
          })
        | undefined

      if ((chunk as { usage?: OpenAI.Completions.CompletionUsage }).usage) {
        const u = (chunk as { usage: OpenAI.Completions.CompletionUsage }).usage
        yield {
          type: "usage",
          prompt_tokens: u.prompt_tokens,
          completion_tokens: u.completion_tokens,
          total_tokens: u.total_tokens,
          reasoning_tokens: (u as { completion_tokens_details?: { reasoning_tokens?: number } })
            .completion_tokens_details?.reasoning_tokens,
        }
      }

      if (delta?.content) {
        yield { type: "token", text: delta.content }
      }

      if (delta?.reasoning_content) {
        yield { type: "reasoning", text: delta.reasoning_content }
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

    yield { type: "done", finish_reason: finishReason ?? null }
  }

  async complete(params: CompleteParams): Promise<CompleteResult> {
    const model = params.model ?? this.config.model_name
    const temperature = params.temperature ?? this.config.temperature
    const messages = params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[]

    const response = await this.client.chat.completions.create(
      {
        model,
        temperature,
        messages,
      },
      { signal: params.signal },
    )

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
    if (response.usage) {
      result.usage = {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
        reasoning_tokens: (
          response.usage as { completion_tokens_details?: { reasoning_tokens?: number } }
        ).completion_tokens_details?.reasoning_tokens,
      }
    }
    return result
  }
}

/** Re-export for tests that need to type-narrow messages without pulling OpenAI types. */
export type { CanonicalChatMessage }
