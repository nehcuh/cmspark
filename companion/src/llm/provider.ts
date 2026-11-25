/**
 * LLM Provider abstraction (Anthropic protocol P0 / NODE2).
 *
 * Internal canonical model stays OpenAI chat/tool shape (L1).
 * Wire transport is protocol-specific (openai SDK vs Anthropic Messages fetch+SSE).
 * Adapter / extract / title consume CanonicalStreamEvent / complete only (Node3).
 */

import type { LiveResponseItem, liveResponseItems } from "./providers/openai-responses"
import type { LiveAnthropicBlock, liveAnthropicBlocks } from "./providers/anthropic-convert"
import type { LlmConfig } from "../config"
import { OpenAIProvider } from "./providers/openai"
import { AnthropicProvider } from "./providers/anthropic"

// ── Canonical message / tool shapes (OpenAI-compatible, internal) ──────────

export interface CanonicalToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

/** OpenAI-style tool definition used inside the companion. */
export interface CanonicalToolDefinition {
  type: "function"
  function: {
    name: string
    description: string
    parameters: {
      type: string
      properties?: Record<string, unknown>
      required?: string[]
      [key: string]: unknown
    }
  }
}

export type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; width?: number; height?: number }

export type CanonicalChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | UserContentPart[] }
  | {
      role: "assistant"
      content?: string | null
      tool_calls?: CanonicalToolCall[]
      /** DeepSeek / thinking — internal only; dropped on Anthropic wire (M7). */
      reasoning_content?: string
      [liveResponseItems]?: LiveResponseItem[]
      [liveAnthropicBlocks]?: LiveAnthropicBlock[]
    }
  | {
      role: "tool"
      tool_call_id: string
      content: string
      /** Optional function name; shrink fail-closed prefers this over sibling lookup. */
      name?: string
    }

// ── Stream events (adapter consumes these) ─────────────────────────────────

/**
 * Unified stream events from any provider.
 * Design §4: token | tool_call_delta | reasoning | usage | done
 */
export type CanonicalStreamEvent =
  | { type: "token"; text: string }
  | {
      type: "tool_call_delta"
      /** 0-based index among tool calls in this response (OpenAI-style). */
      index: number
      id?: string
      name?: string
      /** Incremental arguments JSON fragment. */
      arguments?: string
    }
  | { type: "reasoning"; text: string; replace?: boolean }
  | ({ type: "usage" } & CompleteUsage)
  | { type: "done"; finish_reason?: string | null; liveBlocks?: LiveAnthropicBlock[]; responseItems?: LiveResponseItem[] }

export interface StreamChatParams {
  reasoning_effort?: LlmConfig["reasoning_effort"]
  /** Opaque per-thread key, shared by tool rounds, retries and later turns. */
  promptCacheKey?: string
  messages: CanonicalChatMessage[]
  tools?: CanonicalToolDefinition[]
  temperature?: number
  /** Override model from config for this call. */
  model?: string
  signal?: AbortSignal
  /**
   * Chat output cap. Anthropic always sends a cap (config.llm.max_tokens /
   * computeMaxTokens). OpenAI sends only when this is a positive number.
   */
  max_tokens?: number
}

export interface CompleteParams {
  messages: CanonicalChatMessage[]
  temperature?: number
  model?: string
  signal?: AbortSignal
  /** Keep consent-scoped requests on the configured destination. */
  rejectRedirects?: boolean
  /** Revalidate consent after asynchronous endpoint checks, immediately before dispatch. */
  beforeSend?: () => void
  /** Optional output cap override; falls back to config.llm.max_tokens. */
  max_tokens?: number
  reasoning_effort?: "none"
}

export interface CompleteUsage {
  /** Omitted when the provider did not report cache reads. */
  cached_input_tokens?: number
  cache_creation_input_tokens?: number
  /** Total input, including cache reads and writes. */
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  reasoning_tokens?: number
}

export interface CompleteResult {
  content: string
  usage?: CompleteUsage
  /** Optional reasoning / thinking text (Anthropic thinking or DeepSeek). */
  reasoning?: string
  finish_reason?: string | null
}

export interface LlmProvider {
  /**
   * Streaming chat with optional tools.
   * Yields CanonicalStreamEvent until `done` (or throws on error / abort).
   */
  streamChat(params: StreamChatParams): AsyncIterable<CanonicalStreamEvent>

  /**
   * Non-streaming completion (titles, structured extract).
   * Tools are not supported on this path in P0.
   */
  complete(params: CompleteParams): Promise<CompleteResult>
}

/**
 * Factory: protocol from llm config (default "openai").
 * Adapter / extract / title consume this (Node3 production wiring).
 */
export function createProvider(llmConfig: LlmConfig): LlmProvider {
  const protocol = llmConfig.protocol ?? "openai"
  if (protocol === "anthropic") {
    return new AnthropicProvider(llmConfig)
  }
  return new OpenAIProvider(llmConfig)
}
