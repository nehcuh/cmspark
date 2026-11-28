// Generated from companion/src/llm/chat-output-policy.ts by companion/scripts/generate-model-policy.mjs.
import { reasoningWireEffort, type modelSpec } from "./reasoning-effort"

export const LLM_MAX_TOKENS_DEFAULT = 32768
export const CONTEXT_WINDOW_TINY = 16000
export const CONTEXT_WINDOW_FLOOR = 128000

/** Floor only at request time. The user's stored window is preserved. */
export function effectiveContextWindow(disk: number) {
  const n = Number.isFinite(disk) ? Math.floor(disk) : disk
  if (!Number.isFinite(n) || n < CONTEXT_WINDOW_TINY) {
    return { disk: n, effective: CONTEXT_WINDOW_FLOOR, floored: true }
  }
  return { disk: n, effective: n, floored: false }
}

/** Used by the actual chat request and the settings draft preview. */
export function calculateChatOutputBudget(
  localWindow: number, spec: ReturnType<typeof modelSpec>, savedLimit: number | undefined, savedEffort: unknown,
) {
  const contextWindow = Math.min(localWindow, spec?.contextWindow ?? localWindow)
  const explicit = savedLimit || undefined
  const ceiling = Math.min(
    spec?.output ?? LLM_MAX_TOKENS_DEFAULT,
    Math.max(256, Math.floor(contextWindow / 2)),
    explicit ?? Infinity,
  )
  const support = spec?.support ?? "unsupported"
  const effort = reasoningWireEffort(support, savedEffort)
  let automatic = LLM_MAX_TOKENS_DEFAULT
  if (support === "deepseek" || support === "kimi") {
    if (effort === "max") automatic = 131072
    if (effort === "high") automatic = 65536
  } else if (effort === "high" || effort === "xhigh" || effort === "max") {
    automatic = 64000
  }
  return { contextWindow, preferred: Math.min(ceiling, explicit ?? automatic), ceiling, documented: spec?.output !== undefined }
}
