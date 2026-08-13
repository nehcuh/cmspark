// Shared ACP thread-id resolution so L2 gate and tool dispatch cannot diverge.

/**
 * Resolve the acting thread id for ACP propose / workspace bind.
 * Precedence: explicit actingThreadId → params.__thread_id → params._thread_id → "".
 */
export function resolveAcpThreadId(
  params: Record<string, unknown> | null | undefined,
  actingThreadId?: string | null,
): string {
  if (typeof actingThreadId === "string" && actingThreadId.trim()) {
    return actingThreadId.trim()
  }
  const p = params || {}
  if (typeof p.__thread_id === "string" && p.__thread_id.trim()) {
    return p.__thread_id.trim()
  }
  if (typeof p._thread_id === "string" && p._thread_id.trim()) {
    return p._thread_id.trim()
  }
  return ""
}
