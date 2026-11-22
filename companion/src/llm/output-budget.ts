import type { LlmConfig } from "../config"
import { calculateChatOutputBudget } from "./chat-output-policy"
import { modelSpec } from "./reasoning-effort"

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
  return modelSpec(config.protocol, config.base_url, model)
}

export function chatOutputBudget(localWindow: number, config: ModelConfig) {
  return calculateChatOutputBudget(localWindow, providerModelLimits(config), normalizeSavedChatOutputLimit(config.max_tokens), config.reasoning_effort)
}
