type TaggedThread = { user_tags?: string[]; digest?: { tags?: string[] } | null }

export function threadTags(thread: TaggedThread): string[] {
  return [...new Set([...(thread.user_tags || []), ...(thread.digest?.tags || [])]
    .filter(tag => typeof tag === "string" && tag.trim()).map(tag => tag.trim().toLowerCase()))]
}

/** A derived AI view; never writes or overrides a user's manual folder. */
export function aiThreadGroup(thread: TaggedThread): string | null {
  return thread.digest?.tags?.find(tag => typeof tag === "string" && tag.trim())?.trim().toLowerCase() || null
}

/** Wait for the server's persisted response, not the service worker transport ACK. */
export function saveThreadMetadata(threadId: string, updates: { user_tags: string[]; topic_folder: string | null }, signal: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("已取消等待")); return }
    const id = `thread-metadata-${crypto.randomUUID()}`
    let timer: ReturnType<typeof setTimeout>
    let settled = false
    const finish = (error?: Error, thread?: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      chrome.runtime.onMessage.removeListener(receive)
      signal.removeEventListener("abort", cancel)
      if (error) reject(error)
      else resolve(thread)
    }
    const cancel = () => finish(new Error("已取消等待；已发送的保存可能仍会完成"))
    const receive = (message: any) => {
      if (message?.id !== id) return
      if (message.type === "thread.updated" && message.thread?.id === threadId) {
        const actualTags = threadTags({ user_tags: message.thread.user_tags }).sort()
        const wantedTags = threadTags({ user_tags: updates.user_tags }).sort()
        if (JSON.stringify(actualTags) !== JSON.stringify(wantedTags) || (message.thread.topic_folder || null) !== updates.topic_folder) {
          finish(new Error("服务端未确认所提交的分类，请确认 Companion 已更新后重试"))
        } else finish(undefined, message.thread)
      }
      else if (message.type === "error") finish(new Error(message.error || "保存失败"))
    }
    chrome.runtime.onMessage.addListener(receive)
    signal.addEventListener("abort", cancel, { once: true })
    timer = setTimeout(() => finish(new Error("尚未收到保存确认，请检查连接后重试")), 15_000)
    chrome.runtime.sendMessage({ type: "thread.update", id, thread_id: threadId, updates, require_connected: true }).then(response => {
      if (response?.ok === false) finish(new Error(response.error || "连接不可用"))
    }).catch(error => finish(new Error(error?.message || "发送失败")))
  })
}
