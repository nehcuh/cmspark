import { forwardWorkspaceRequest, workspaceSenderAllowed } from "./workspace-sender"

type Client = {
  getState(): string
  send(message: object): boolean
  desktopBrowserConnectionCurrent(): () => boolean
}
export const MEETING_VISUAL_PORT = "cmspark-meeting-visual"

export function createMeetingVisualRelay() {
  const jobs = new Map<string, { port: chrome.runtime.Port; meetingId: string }>()
  function forward(message: any, sender: chrome.runtime.MessageSender | undefined, extensionId: string, client: Client) {
    if (!sender?.documentId || message.type === "meeting.visual.execute") {
      return { ok: false, error: "画面任务需要已连接的会议页面" }
    }
    return forwardWorkspaceRequest({ ...message, owner_id: sender.documentId }, sender, extensionId, client)
  }
  function attach(port: chrome.runtime.Port, extensionId: string, client: Client) {
    const sender = port.sender
    if (!workspaceSenderAllowed(sender, extensionId) || !sender?.documentId) { port.disconnect(); return }
    const current = client.desktopBrowserConnectionCurrent()
    let submitted = false, closed = false
    let cancel: (() => void) | undefined
    port.onDisconnect.addListener(() => { closed = true; cancel?.() })
    port.onMessage.addListener(message => {
      if (closed || submitted) return
      submitted = true
      if (!current() || message?.type !== "meeting.visual.execute" || typeof message.id !== "string" || jobs.has(message.id)) {
        port.disconnect()
        return
      }
      const { id, meeting_id, consent_token } = message
      jobs.set(id, { port, meetingId: meeting_id })
      cancel = () => {
        if (jobs.get(id)?.port !== port) return
        jobs.delete(id)
        if (current()) forward({type:"meeting.visual.cancel", v:1, id:crypto.randomUUID(), meeting_id, consent_token},sender,extensionId,client)
      }
      const sent = forwardWorkspaceRequest({ ...message, owner_id: sender.documentId }, sender, extensionId, client)
      if (!sent.ok) { jobs.delete(id); port.disconnect() }
    })
  }
  function receive(message: any) {
    const job = jobs.get(message?.id)
    if (!job || !(message.type === "meeting.visual.finished" && message.meeting_id === job.meetingId ||
      message.type === "meeting.error" || message.type === "error")) return false
    jobs.delete(message.id)
    try { job.port.postMessage(message) } catch { /* page already closed */ }
    return true
  }
  function disconnect() {
    for (const job of jobs.values()) { try { job.port.disconnect() } catch { /* closed */ } }
    jobs.clear()
  }
  return { forward, attach, receive, disconnect }
}
