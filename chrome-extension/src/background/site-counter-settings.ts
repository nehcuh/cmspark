import { getActiveTabContext } from "./active-tab-hostname"
import { workspaceSenderAllowed } from "./workspace-sender"

let selection: { threadId: string } | undefined
/** Mirrors only accepted outbound thread.select; Companion owns the real gate. */
export function noteSiteCounterUiSelection(threadId: unknown): void {
  selection = typeof threadId === "string" && threadId ? { threadId } : undefined
}
export function isSiteCounterSettingsSender(sender?: chrome.runtime.MessageSender): boolean {
  if (!workspaceSenderAllowed(sender, chrome.runtime.id)) return false
  try {
    const url = new URL(sender?.url || "")
    return (!sender?.tab || url.pathname === "/tabs/workspace.html")
      && !url.username && !url.password && !url.port
  } catch { return false }
}
export async function forwardSiteCounterSettings(
  message: any, sender: chrome.runtime.MessageSender | undefined,
  client: { getState(): string; send(message: object): boolean },
  readContext = getActiveTabContext,
): Promise<{ ok: boolean; id?: string; context_tab_id?: number }> {
  const chosen = selection, reset = message?.type === "site.counter.reset"
  const allowed = new Set(["type","id","source","thread_id",...(reset ? ["target_key","user_gesture"] : [])])
  if (!isSiteCounterSettingsSender(sender) || client.getState() !== "connected" || !chosen || message?.thread_id !== chosen.threadId
    || (message?.type !== "site.counter.status" && !reset) || Object.keys(message).some(k => !allowed.has(k)) || message.source !== "settings"
    || typeof message.id !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(message.id)
    || (reset && (message.user_gesture !== true || typeof message.target_key !== "string" || !/^[a-f0-9]{64}$/.test(message.target_key)))) return { ok: false }
  try {
    const context = await readContext()
    if (!context || selection !== chosen || client.getState() !== "connected") return { ok: false, id: message.id }
    const sent = client.send({ type: message.type, id: message.id, source: "settings", thread_id: chosen.threadId,
      context_tab_id: context.context_tab_id, ...(reset ? { target_key: message.target_key, user_gesture: true } : {}) })
    return { ok: sent, id: message.id, ...(sent ? { context_tab_id: context.context_tab_id } : {}) }
  } catch { return { ok: false, id: message.id } }
}
