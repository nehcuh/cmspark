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
