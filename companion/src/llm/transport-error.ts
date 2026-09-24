/**
 * Socket / gateway closes that are safe to retry as the same request.
 * "Premature close" is undici's message when the peer drops a stream after
 * (or instead of) the SSE terminator. "Connection error." is the OpenAI SDK
 * wrapper around the same class of failure. These are not model errors.
 */
export function isTransientLlmTransportError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase()
  return (
    msg.includes("premature close") ||
    msg.includes("connection error") ||
    msg.includes("socket hang up") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("und_err") ||
    msg.includes("other side closed") ||
    msg.includes("fetch failed") ||
    msg.includes("request timed out") ||
    msg.includes("headers timeout") ||
    msg.includes("body timeout")
  )
}

/** Stream iterator died after the provider had already delivered a finish chunk. */
export function isBenignStreamTailClose(err: unknown): boolean {
  const e = err as { message?: unknown; cause?: { message?: unknown; code?: unknown } }
  const bits = [e?.message, e?.cause?.message, e?.cause?.code].filter(
    (x): x is string => typeof x === "string",
  )
  return bits.length > 0 && isTransientLlmTransportError(bits.join(" "))
}
