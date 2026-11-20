import type { LlmConfig } from "../config"
import { LLM_MAX_TOKENS_DEFAULT } from "./providers/anthropic-convert"
import { reasoningSupport, reasoningWireEffort } from "./reasoning-effort"

export const CHAT_OUTPUT_LIMIT_MAX = 393216

export function isChatOutputLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= CHAT_OUTPUT_LIMIT_MAX
}

/** Read a persisted value, including explicit ceilings written by earlier versions. */
export function normalizeSavedChatOutputLimit(value: unknown): number | undefined {
  if (value === 0) return 0
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return undefined
  return Math.min(CHAT_OUTPUT_LIMIT_MAX, Math.floor(value))
}

type ModelConfig = Pick<LlmConfig, "protocol" | "base_url" | "model_name" | "reasoning_effort" | "max_tokens">

/** Only documented direct endpoints with exact supported model names. */
export function providerModelLimits(config: ModelConfig, model = config.model_name) {
  const support = reasoningSupport(config.protocol, config.base_url, model)
  switch (support) {
    case "openai": return { contextWindow: 400000, output: 128000 }
    case "deepseek": return { contextWindow: 1000000, output: CHAT_OUTPUT_LIMIT_MAX }
    case "anthropic-46":
    case "anthropic-47": return { contextWindow: 1000000, output: 128000 }
    default: return undefined
  }
}

export function chatOutputBudget(localWindow: number, config: ModelConfig) {
  const limits = providerModelLimits(config)
  const contextWindow = Math.min(localWindow, limits?.contextWindow ?? localWindow)
  const explicit = normalizeSavedChatOutputLimit(config.max_tokens) || undefined
  const ceiling = Math.min(
    limits?.output ?? LLM_MAX_TOKENS_DEFAULT,
    Math.max(256, Math.floor(contextWindow / 2)),
    explicit ?? Infinity,
  )
  const support = reasoningSupport(config.protocol, config.base_url, config.model_name)
  const effort = reasoningWireEffort(support, config.reasoning_effort)
  let automatic = LLM_MAX_TOKENS_DEFAULT
  if (support === "deepseek") {
    if (effort === "max") automatic = 131072
    if (effort === "high") automatic = 65536
  } else if (effort === "high" || effort === "xhigh" || effort === "max") {
    automatic = 64000
  }
  return { contextWindow, preferred: Math.min(ceiling, explicit ?? automatic), ceiling, documented: limits !== undefined }
}
