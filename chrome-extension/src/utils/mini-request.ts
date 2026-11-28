export type MiniTarget = { id: string; label: string; unavailable?: string }
export type MiniSearchHit = { kind: 'knowledge' | 'message'; id: string; title: string; snippet: string; folder?: string;
  message_id?: string; role?: 'user' | 'assistant'; created_at?: string }
type Highlight = { start: number; length: number }
export type MiniDoc = { title: string; body: string; truncated?: boolean; highlight?: Highlight;
  matched_field?: { label: string; body: string; highlight?: Highlight };
  role?: 'user' | 'assistant'; created_at?: string }
type MiniReply = { ok: boolean; error?: string; target?: MiniTarget; image_base64?: string; text?: string; model?: string; hits?: MiniSearchHit[]; has_more?: boolean; anchor?: string; stale?: boolean; doc?: MiniDoc }

export const MINI_PRIVATE_PORT = 'cmspark-mini-private-request'

/** One document owns both ends of the request lifetime; no screenshot enters runtime.onMessage. */
export function privateMiniRequest<T>(frame: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('请求已停止')); return }
    const port = chrome.runtime.connect({ name: MINI_PRIVATE_PORT })
    function cleanup() {
      port.onMessage.removeListener(receive)
      port.onDisconnect.removeListener(disconnected)
      signal?.removeEventListener('abort', cancel)
      port.disconnect()
    }
    function receive(reply: T) { cleanup(); resolve(reply) }
    function disconnected() {
      const detail = chrome.runtime.lastError?.message
      cleanup()
      reject(new Error(detail || '快速操作窗口与后台的连接已断开'))
    }
    function cancel() { cleanup(); reject(new Error('请求已停止')) }
    port.onMessage.addListener(receive)
    port.onDisconnect.addListener(disconnected)
    signal?.addEventListener('abort', cancel, { once: true })
    try { port.postMessage(frame) } catch (error) { cleanup(); reject(error) }
  })
}

export async function requestMini(op: 'claim' | 'target' | 'ocr' | 'ask' | 'search' | 'read', payload: Record<string, unknown>): Promise<MiniReply> {
  const result = await privateMiniRequest<MiniReply>({ ...payload, type: 'mini.request', op })
  if (!result) throw new Error('未收到快速操作响应，请检查 Companion 连接')
  return result
}
