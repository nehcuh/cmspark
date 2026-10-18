/** Trusted lifecycle injection: neither a renderer dispatcher nor a tray session. */
import type { WebSocket } from "ws"
import type { ThreadManager } from "../threads/thread-manager"
import type { SkillEngine } from "../skills/skill-engine"
import type { HistoryStore } from "../history/store"
import { handleMessage } from "../message-router"
import type { NativeDialogRuntime } from "./dialog"
export function createNativeDialogRuntime(opts: {
  ws: WebSocket; current(): boolean
  threads: ThreadManager; skills: SkillEngine; history: HistoryStore
  createExecutor(owner: { current(): boolean; unavailable(): void }): (id: string, name: string, params: any, signal?: AbortSignal, options?: any) => Promise<{ success: boolean; data?: any; error?: string }>
}): NativeDialogRuntime {
  return {
    async start(input) {
      const current = () => opts.current() && input.current()
      if (!current()) throw Error("DESKTOP_SESSION_STALE")
      // The real store snapshot must be readable before starting. Existing
      // persisted UUIDs refuse replay, rather than overwriting/duplicating rows.
      const snapshot = opts.threads.readDesktopDialog(input.threadId)
      if (snapshot.messages.some(row => row.id === input.messageId)) throw Error("DESKTOP_REQUEST_RECORDED")
      const executeTool = opts.createExecutor({ current, unavailable: () => input.event({ type: "desktop.chat.confirmation_unavailable", thread_id: input.threadId }) })
      const emit = (frame: Record<string, unknown>) => { if (current()) input.event(frame) }
      const result = await handleMessage({ type: "chat.create", thread_id: input.threadId, message: input.message, clientMessageId: input.messageId },
        { threadManager: opts.threads, skillEngine: opts.skills, historyStore: opts.history },
        { surface: "desktop", origin: "cmspark-desktop-native://local", originWs: opts.ws,
          nativeDialog: { current, messageId: input.messageId, started: input.started },
          isCurrentSession: current, appsOwnerCurrent: current,
          sendToExtension: emit, executeTool: async (...args) => {
            if (!current()) return { success: false, error: "DESKTOP_SESSION_STALE" }
            return executeTool(...args)
          },
        })
      if (result && typeof result === "object") emit(result.type === "error" ? { type: "chat.error", thread_id: input.threadId } : result)
    },
  }
}
