/** Context overflow / truncated-length classification for compact+retry-once. */

export function isContextOverflowError(msg: string): boolean {
  const s = String(msg || "")
  return /context.?length|maximum context|too many tokens|prompt is too long|input is too long|context_length_exceeded|request_too_large|token limit|token count exceeds|context window|exceeds? the (model'?s? )?context/i.test(
    s,
  )
}

export function isLengthStop(finishReason?: string | null): boolean {
  const r = String(finishReason || "").toLowerCase()
  return r === "length" || r === "max_tokens" || r === "max_output_tokens"
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
 */
export const CONTENT_RISK_ERROR_PATTERNS: RegExp[] = [
  /content\s+exists\s+risk/i, // DeepSeek
  /data[_\s-]inspection[_\s-]failed/i, // Aliyun DashScope
  /content[_\s-](filter|management)/i, // Azure/OpenAI 系
]

export function isContentRiskError(msg: string): boolean {
  const s = String(msg || "")
  return CONTENT_RISK_ERROR_PATTERNS.some((p) => p.test(s))
}
