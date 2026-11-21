/** Context overflow / truncated-length classification for compact+retry-once. */

export function isContextOverflowError(msg: string): boolean {
  const s = String(msg || "")
  return /context.?length|maximum context|prompt is too long|input is too long|context_length_exceeded|(?:input|prompt) token count exceeds|context[ _-]window|exceeds? the (model'?s? )?context/i.test(
    s,
  )
}

export type GenerationLimit = "output_budget" | "context_window" | "length"

export function classifyGenerationLimit(
  finishReason?: unknown,
  evidence?: { officialOpenAI?: boolean; sentTokens?: number; completionTokens?: number },
): GenerationLimit | undefined {
  const reason = typeof finishReason === "string" ? finishReason.toLowerCase() : undefined
  if (reason === "model_context_window_exceeded" || reason === "context_length_exceeded") return "context_window"
  if (reason === "max_tokens" || reason === "max_output_tokens") return "output_budget"
  if (reason !== "length") return undefined
  const { officialOpenAI, sentTokens, completionTokens } = evidence ?? {}
  if (officialOpenAI || (
    typeof sentTokens === "number" && sentTokens > 0 &&
    typeof completionTokens === "number" && Number.isSafeInteger(completionTokens) && completionTokens >= sentTokens
  )) return "output_budget"
  return "length"
}

export function isLengthStop(finishReason?: string | null): boolean {
  return classifyGenerationLimit(finishReason) !== undefined
}

export function isTruncatedToolBatch(
  finishReason: string | null | undefined,
  hasToolCalls: boolean,
): boolean {
  return isLengthStop(finishReason) && hasToolCalls
}

/**
 * #430: 服务商内容风控拒绝（确定性——同 payload 重发必挂）。
 * 命中即不得走 recoverable 盲重试（adapter 5 次风暴会 <1s 烧光熔断预算）。
 *
 * 评审加固（grok M-1）：必须钉 400——「5xx + content-filter 字样的网关文案」
 * 是瞬时故障，不得被拐进风控路径（那会把可重试错误变成删数据 + 一次致命）。
 */
export const CONTENT_RISK_ERROR_PATTERNS: RegExp[] = [
  /content\s+exists\s+risk/i, // DeepSeek
  /data[_\s-]inspection[_\s-]failed/i, // Aliyun DashScope
  /content management policy/i, // Azure OpenAI 已知整句
  /content_filter/, // OpenAI 系错误码形态（下划线，不匹普通空格文案）
]

export function isContentRiskError(msg: string): boolean {
  const s = String(msg || "")
  return /\b400\b/.test(s) && CONTENT_RISK_ERROR_PATTERNS.some((p) => p.test(s))
}
