const SELECT_ID_PREFIX = "thread-select:"

/** The service worker also talks to Companion versions that only echo the request id. */
export function threadHistoryRequest(threadId: string) {
  return { type: "thread.select", thread_id: threadId, id: SELECT_ID_PREFIX + threadId }
}

export function threadHistoryFailure(
  message: { id?: unknown; request_type?: unknown; family?: unknown; thread_id?: unknown; error?: unknown },
): { threadId: string; retryable: boolean; uncorrelated?: true } | null {
  const text = typeof message.error === "string" ? message.error : ""
  const missing = /^Thread not found: (.+)$/i.exec(text)
  if (message.request_type === "thread.select" && typeof message.thread_id === "string" && message.thread_id) {
    return { threadId: message.thread_id, retryable: !!missing }
  }
  if (typeof message.id === "string" && message.id.startsWith(SELECT_ID_PREFIX)) {
    const threadId = message.id.slice(SELECT_ID_PREFIX.length)
    return threadId ? { threadId, retryable: !!missing } : null
  }

  // Older reads and mutations can return the same untagged text. The reducer
  // can use the named owner only when its current history is still loading.
  if (missing && !message.id && !message.request_type && !message.family) {
    return { threadId: missing[1]!, retryable: true, uncorrelated: true }
  }
  return null
}
