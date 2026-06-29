// One-shot (non-streaming) structured LLM extraction helper.
//
// Consolidates the `new OpenAI()` → `chat.completions.create` pattern duplicated
// across skill-craft.ts / adapter.generateThreadTitle / skill-engine rerank etc.
// Callers bring their own system prompt + parser; this just returns the raw text.

import OpenAI from "openai"

export interface LlmExtractConfig {
  base_url: string
  api_key: string
  model_name: string
  temperature: number
}

export async function llmExtract(params: {
  systemPrompt: string
  userContent: string
  config: LlmExtractConfig
  /** Cap temperature for deterministic extraction (default 0.3, like skill-craft). */
  temperatureCap?: number
  /** Request timeout ms (default 60s). */
  timeout?: number
}): Promise<string> {
  const { systemPrompt, userContent, config, temperatureCap = 0.3, timeout = 60000 } = params
  const client = new OpenAI({
    baseURL: config.base_url,
    apiKey: config.api_key || "sk-placeholder",
    timeout,
    maxRetries: 0,
  })
  const response = await client.chat.completions.create({
    model: config.model_name,
    temperature: Math.min(config.temperature, temperatureCap),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  })
  return response.choices[0]?.message?.content?.trim() || ""
}
