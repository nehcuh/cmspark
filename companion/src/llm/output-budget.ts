import type { LlmConfig } from "../config"
import { calculateChatOutputBudget, normalizeSavedChatOutputLimit } from "./chat-output-policy"
import { modelSpec } from "./reasoning-effort"

export { CHAT_OUTPUT_LIMIT_MAX, isChatOutputLimit, normalizeSavedChatOutputLimit } from "./chat-output-policy"

type ModelConfig = Pick<LlmConfig, "protocol" | "base_url" | "model_name" | "reasoning_effort" | "max_tokens">

/** Only documented direct endpoints with exact supported model names. */
export function providerModelLimits(config: ModelConfig, model = config.model_name, effort = config.reasoning_effort) {
  return modelSpec(config.protocol, config.base_url, model, effort)
}

export function chatOutputBudget(localWindow: number, config: ModelConfig) {
  return calculateChatOutputBudget(localWindow, providerModelLimits(config), normalizeSavedChatOutputLimit(config.max_tokens), config.reasoning_effort)
}
