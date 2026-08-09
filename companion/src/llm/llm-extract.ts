// One-shot (non-streaming) structured LLM extraction helper.
//
// Consolidates createProvider().complete for skill-craft / summary / vault profile etc.
// Callers bring their own system prompt + parser; this just returns the raw text.
// Vision stays on vision-pipeline (OpenAI-only, L10) — not routed here.

import type {
  LlmAuthStyle,
  LlmClientHeaderProfile,
  LlmConfig,
  LlmProtocol,
} from "../config"
import { createProvider } from "./provider"
import { stripLoneSurrogates } from "./text-sanitize"

export interface LlmExtractConfig {
  base_url: string
  api_key: string
  model_name: string
  temperature: number
  /** Optional; default openai. When callers pass full getConfig().llm these flow through. */
  protocol?: LlmProtocol
  auth_style?: LlmAuthStyle
  client_header_profile?: LlmClientHeaderProfile
  claude_code_compat_version?: string
  extra_headers?: Record<string, string>
  anthropic_version?: string
  context_window?: number
}

function toLlmConfig(config: LlmExtractConfig): LlmConfig {
  return {
    base_url: config.base_url,
    api_key: config.api_key,
    model_name: config.model_name,
    temperature: config.temperature,
    context_window: config.context_window ?? 100_000,
    protocol: config.protocol ?? "openai",
    auth_style: config.auth_style,
    client_header_profile: config.client_header_profile,
    claude_code_compat_version: config.claude_code_compat_version,
    extra_headers: config.extra_headers,
    anthropic_version: config.anthropic_version,
  }
}

export async function llmExtract(params: {
  systemPrompt: string
  userContent: string
  config: LlmExtractConfig
  /** Cap temperature for deterministic extraction (default 0.3, like skill-craft). */
  temperatureCap?: number
  /** Request timeout ms (default 60s). */
  timeout?: number
  /** Optional parent abort (chat.stop) — combined with timeout when available. */
  signal?: AbortSignal
}): Promise<string> {
  const {
    systemPrompt,
    userContent,
    config,
    temperatureCap = 0.3,
    timeout = 60000,
    signal: parentSignal,
  } = params
  const provider = createProvider(toLlmConfig(config))
  const timeoutSignal = AbortSignal.timeout(timeout)
  const signal =
    parentSignal && typeof (AbortSignal as any).any === "function"
      ? (AbortSignal as any).any([parentSignal, timeoutSignal])
      : parentSignal?.aborted
        ? parentSignal
        : timeoutSignal
  const result = await provider.complete({
    temperature: Math.min(config.temperature, temperatureCap),
    model: config.model_name,
    signal,
    messages: [
      { role: "system", content: systemPrompt },
      // Strip lone surrogates from user content — vault notes / thread text can contain them
      // (corrupt files or a slice() that split a surrogate pair), and they make strict server
      // JSON parsers reject the body as a malformed \u escape.
      { role: "user", content: stripLoneSurrogates(userContent) },
    ],
  })
  return result.content.trim() || ""
}
