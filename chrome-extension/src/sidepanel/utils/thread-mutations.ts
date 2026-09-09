export type ThreadMutationMode = "trash" | "hard" | "restore" | "empty"
export type ThreadMutationResult = { ok: string[]; failed: Array<{ id: string; reason: string }> }

const REQUEST_PREFIX = "thread-mutation:"
export function isManagedThreadMutationReply(message: { id?: unknown }): boolean {
  return typeof message.id === "string" && message.id.startsWith(REQUEST_PREFIX)
}

type Runtime = Pick<typeof chrome.runtime, "onMessage" | "sendMessage" | "lastError">
type BatchResult = ThreadMutationResult & { stop?: boolean; reason?: string }
type RequestMode = ThreadMutationMode | "probe"

/** Only a complete, correlated server result can confirm durable changes. */
function parseResult(message: any, ids: string[], mode: RequestMode): ThreadMutationResult | null {
  if (mode === "probe") {
    return message.type === "thread.batch_delete.capabilities" && message.only_empty === true
      ? { ok: [], failed: [] } : null
  }
  if (message.type !== (mode === "restore" ? "thread.restored" : "thread.batch_deleted")) return null
  if (mode !== "restore" && message.mode !== (mode === "empty" ? "hard" : mode)) return null
  const ok = mode === "restore" ? message.restored : message.ok
  const failed = message.failed
  if (!Array.isArray(ok) || !Array.isArray(failed)) return null
  const expected = new Set(ids)
  const seen = new Set<string>()
  for (const id of ok) {
    if (typeof id !== "string" || !expected.has(id) || seen.has(id)) return null
    seen.add(id)
  }
  for (const item of failed) {
    if (!item || typeof item.id !== "string" || !expected.has(item.id) || seen.has(item.id)
      || typeof item.reason !== "string" || !item.reason) return null
    seen.add(item.id)
  }
  if (seen.size !== expected.size) return null
  const count = mode === "restore" ? message.restored_count : message.deleted_count
  if (count !== ok.length) return null
  if (mode !== "restore" && (!Array.isArray(message.deleted_ids)
    || message.deleted_ids.length !== ok.length
    || message.deleted_ids.some((id: unknown, i: number) => id !== ok[i]))) return null
  return { ok: [...ok], failed: failed.map(({ id, reason }: { id: string; reason: string }) => ({ id, reason })) }
}

/** Injecting the runtime/timeout keeps transport races testable without a browser or daemon. */
export function createThreadMutator(runtime: Runtime, timeoutMs = 30_000) {
  function batch(ids: string[], mode: RequestMode, signal: AbortSignal): Promise<BatchResult> {
    if (signal.aborted) return Promise.resolve({ ok: [], failed: ids.map(id => ({ id, reason: "not_sent" })), stop: true, reason: "not_sent" })
    const requestId = REQUEST_PREFIX + crypto.randomUUID()
    return new Promise(resolve => {
      let settled = false
      let attempted = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: BatchResult) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        runtime.onMessage.removeListener(onMessage)
        signal.removeEventListener("abort", onAbort)
        resolve(result)
      }
      const stop = (reason: string) => finish({ ok: [], failed: ids.map(id => ({ id, reason })), stop: true, reason })
      const onAbort = () => stop(attempted ? "unknown_aborted" : "not_sent")
      const onMessage = (message: any) => {
        if (message?.type === "thread.mutation.connection" && message.state !== "connected") {
          stop(attempted ? "unknown_disconnected" : "not_sent")
          return
        }
        if (message?.id !== requestId) return
        // A handler error can follow a partial mutation: do not say nothing changed.
        if (message.type === "error") { stop("unknown_server_error"); return }
        const result = parseResult(message, ids, mode)
        if (result) finish(result)
        else stop("unknown_invalid_response")
      }
      runtime.onMessage.addListener(onMessage)
      signal.addEventListener("abort", onAbort, { once: true })
      if (signal.aborted) { onAbort(); return }
      timer = setTimeout(() => stop("unknown_timeout"), timeoutMs)
      attempted = true
      try {
        runtime.sendMessage({
          type: mode === "restore" ? "thread.restore" : "thread.batch_delete",
          id: requestId,
          thread_ids: ids,
          ...(mode === "restore" || mode === "probe" ? {} : { mode: mode === "empty" ? "hard" : mode }),
          ...(mode === "empty" ? { only_empty: true } : {}),
          ...(mode === "probe" ? { probe: "only_empty" } : {}),
          require_connected: true,
        }, (ack: any) => {
          const transportError = runtime.lastError
          if (settled) return
          if (transportError || ack?.id !== requestId || typeof ack?.ok !== "boolean") {
            stop("unknown_transport")
          } else if (!ack.ok) {
            stop("not_sent")
          }
          // ok=true only acknowledges transport; keep waiting for the server.
        })
      } catch {
        stop("unknown_transport")
      }
    })
  }

  return async (rawIds: string[], mode: ThreadMutationMode, signal: AbortSignal): Promise<ThreadMutationResult> => {
    const ids = [...new Set(rawIds.filter(id => typeof id === "string" && id.length > 0))]
    const result: ThreadMutationResult = { ok: [], failed: [] }
    if (ids.length === 0) return result
    // Also cover the microtask gap between a reply and the next batch/probe.
    // A capability checked on one connection must not authorize another one.
    let connectionLost = false
    const onConnection = (message: any) => {
      if (message?.type === "thread.mutation.connection" && message.state !== "connected") connectionLost = true
    }
    runtime.onMessage.addListener(onConnection)
    try {
      if (mode === "empty") {
        // An old Companion rejects the empty target list before doing any work.
        // Probe every invocation, never reuse capability across reconnections.
        const probe = await batch([], "probe", signal)
        if (probe.stop) {
          const reason = ["unknown_server_error", "unknown_invalid_response", "unknown_timeout"].includes(probe.reason || "")
            ? "not_sent_unsupported" : "not_sent"
          return { ok: [], failed: ids.map(id => ({ id, reason })) }
        }
      }
      for (let offset = 0; offset < ids.length; offset += 50) {
        if (connectionLost) {
          result.failed.push(...ids.slice(offset).map(id => ({ id, reason: "not_sent" })))
          break
        }
        const next = await batch(ids.slice(offset, offset + 50), mode, signal)
        result.ok.push(...next.ok)
        result.failed.push(...next.failed)
        if (next.stop) {
          result.failed.push(...ids.slice(offset + 50).map(id => ({ id, reason: "not_sent" })))
          break
        }
      }
      return result
    } finally {
      runtime.onMessage.removeListener(onConnection)
    }
  }
}

export function mutateThreads(ids: string[], mode: ThreadMutationMode, signal: AbortSignal): Promise<ThreadMutationResult> {
  return createThreadMutator(chrome.runtime)(ids, mode, signal)
}
