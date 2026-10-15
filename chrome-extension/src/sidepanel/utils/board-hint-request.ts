/** Hint persistence replies are management traffic, never chat failures. */
const PREFIX = "board-hint:"
export function isBoardHintReply(message: { type?: unknown; family?: unknown; request_type?: unknown; id?: unknown }): boolean {
  return (message.type === "error" || message.type === "board.add_hint_result") &&
    (message.family === "board" && message.request_type === "board.add_hint" ||
      typeof message.id === "string" && message.id.startsWith(PREFIX))
}

type Runtime = Pick<typeof chrome.runtime, "sendMessage" | "onMessage" | "lastError">
type HintReply = { ok: true } | { ok: false; error: string }

/** One request-local subscription; a forwarding ACK never proves persistence. */
export function submitBoardHint(runtime: Runtime, threadId: string, text: string, signal: AbortSignal): Promise<HintReply> {
  const id = PREFIX + crypto.randomUUID()
  return new Promise(resolve => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (reply: HintReply) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try { runtime.onMessage.removeListener(receive) } catch { /* extension context may have gone away */ }
      signal.removeEventListener("abort", abort)
      resolve(reply)
    }
    const unknown = () => finish({ ok: false, error: "Hint 提交结果未知，请刷新任务板核实；草稿已保留。" })
    const abort = () => unknown()
    const receive = (message: any) => {
      if (message?.type === "thread.mutation.connection" && message.state !== "connected") { unknown(); return }
      if (message?.id !== id || message.thread_id !== threadId || !isBoardHintReply(message)) return
      if (message.type === "board.add_hint_result") finish({ ok: true })
      else finish({ ok: false, error: typeof message.error === "string" && message.error ? message.error : "Hint 提交失败，草稿已保留。" })
    }
    if (signal.aborted) { unknown(); return }
    try {
      runtime.onMessage.addListener(receive)
      signal.addEventListener("abort", abort, { once: true })
      // Same local UI waiting bound as thread mutations. Expiry says unknown;
      // it does not cancel the server mutation or authorize an automatic retry.
      timer = setTimeout(unknown, 30_000)
      runtime.sendMessage({ type: "board.add_hint", id, thread_id: threadId, text, require_connected: true }, (ack: any) => {
        if (settled) return // a canonical server reply may precede this ACK
        if (runtime.lastError || ack?.ok !== true) {
          finish({ ok: false, error: "Hint 未确认送达，请检查连接并刷新任务板核实；草稿已保留。" })
        }
      })
    } catch { unknown() }
  })
}
