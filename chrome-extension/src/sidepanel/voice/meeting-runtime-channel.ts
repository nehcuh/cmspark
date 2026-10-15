/** Correlated existing runtime/WS requests for one explicit meeting Begin. */
export function createMeetingRuntimeChannel(onStatus: (message: any) => void, onLost: () => void) {
  const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let closed = false, seq = 0
  const prefix = `meeting-pcm-${crypto.randomUUID()}`
  function rejectAll(code: string) { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(code)) }; pending.clear() }
  const listener = (message: any) => {
    if (closed || !message) return false
    if (message.type === "thread.mutation.connection" && message.state !== "connected") {
      closed = true; rejectAll("network_unknown"); onLost(); return false
    }
    if (typeof message.id === "string" && pending.has(message.id)) {
      const item = pending.get(message.id)!; pending.delete(message.id); clearTimeout(item.timer); item.resolve(message)
    }
    if (message.type === "meeting.capture.status" || (message.type === "voice.stt.partial" && message.queue_contract === 1)) onStatus(message)
    return false
  }
  chrome.runtime.onMessage.addListener(listener)
  return {
    request(message: Record<string, unknown>): Promise<any> {
      if (closed || pending.size >= 9) return Promise.reject(new Error("contract_unavailable"))
      const id = typeof message.id === "string" && message.type !== "meeting.start" ? message.id : `${prefix}-${++seq}`
      const frame = { v: 1, ...message, ...(message.type === "meeting.start" && message.id ? { meeting_id: message.id } : {}), id }
      return new Promise((resolve, reject) => {
        if (pending.has(id)) { reject(new Error("queue_protocol_error")); return }
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("network_unknown")) }, 5000)
        pending.set(id, { resolve, reject, timer })
        try {
          chrome.runtime.sendMessage(frame, (receipt: any) => {
            if (!pending.has(id)) return
            if (chrome.runtime.lastError || receipt?.ok !== true) {
              clearTimeout(timer); pending.delete(id); reject(new Error("contract_unavailable"))
            }
          })
        } catch { clearTimeout(timer); pending.delete(id); reject(new Error("contract_unavailable")) }
      })
    },
    get closed() { return closed },
    destroy() { closed = true; rejectAll("network_unknown"); chrome.runtime.onMessage.removeListener(listener) },
  }
}
