import { workspaceSenderAllowed } from './workspace-sender'

const ticketPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i

/** Only an opaque, one-use ticket belongs in a window URL. */
export function miniPagePath(destination: unknown, ticket: unknown): string | undefined {
  if (destination === 'mini_search') return 'tabs/mini.html?view=search'
  if (destination === 'mini_meeting') return 'tabs/workspace.html?view=meeting'
  if (!['mini_todo', 'mini_capture', 'mini_ask', 'mini_ocr'].includes(String(destination))) return undefined
  if (typeof ticket !== 'string' || !ticketPattern.test(ticket)) throw new Error('截图编号无效')
  if (destination === 'mini_todo') return 'tabs/workspace.html?view=todos&capture=todo#todos/capture/mini/' + ticket
  return 'tabs/mini.html?view=' + String(destination).slice(5) + '#' + ticket
}

type Reply = (result: any) => void
export function createMiniRelay() {
  const pending = new Map<string, Reply>()
  return {
    attach(port: chrome.runtime.Port, send: (frame: any) => boolean) {
      let used = false
      let retire: (() => void) | undefined
      port.onDisconnect.addListener(() => { retire?.() })
      port.onMessage.addListener(message => {
        if (used) return
        used = true
        this.request(message, port.sender, result => { try { port.postMessage(result) } catch { /* document closed */ } }, send, release => { retire = release })
      })
    },
    request(message: any, sender: chrome.runtime.MessageSender | undefined, reply: Reply, send: (frame: any) => boolean, onPending?: (release: () => void) => void) {
      const path = sender?.url?.split(/[?#]/)[0]
      const importing = message?.type === 'activity.import'
      const allowed = importing ? workspaceSenderAllowed(sender, chrome.runtime.id) : message?.type === 'mini.request' && (
        path === chrome.runtime.getURL('tabs/mini.html') ||
        (path === chrome.runtime.getURL('tabs/workspace.html') && message.op === 'claim' && message.action === 'todo'))
      if (sender?.id !== chrome.runtime.id || (sender.frameId !== undefined && sender.frameId !== 0) || !allowed) {
        reply({ ok: false, error: '请从快速操作窗口发起请求' })
        return false
      }
      const id = 'mini-' + crypto.randomUUID()
      const timeout = importing ? 720_000 : message.op === 'ask' ? 305_000 : 55_000
      const timer = setTimeout(() => finish({ ok: false, error: 'Companion 响应超时' }), timeout)
      function release() {
        clearTimeout(timer)
        pending.delete(id)
      }
      function finish(result: any) {
        release()
        reply(result)
      }
      pending.set(id, finish)
      onPending?.(release)
      if (!send({ ...message, id, type: importing ? 'activity.import' : 'mini.request' })) finish({ ok: false, error: 'Companion 未连接' })
      return true
    },
    receive(frame: any) {
      // Never forward a screenshot or document through chrome.runtime.sendMessage.
      const finish = pending.get(frame?.id)
      if (finish && (frame.type === 'mini.result' || frame.type === 'activity.result' || frame.type === 'error')) finish(frame)
      return frame.type === 'mini.result' || (typeof frame.id === 'string' && frame.id.startsWith('mini-'))
    },
    disconnect() {
      for (const finish of pending.values()) finish({ ok: false, error: 'Companion 连接已断开' })
    },
  }
}
