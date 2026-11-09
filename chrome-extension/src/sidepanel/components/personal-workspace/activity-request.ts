/** Wire projection of Companion activity/types.ts; personal tasks never alias Agent Board records. */
export interface TaskEvidence { source_id: string; app_id: string; group: string; sender: string; message_time: string; quote: string }
export interface TodoCandidate { id: string; revision: number; created_at: string; title: string; owner: string; due_at: string | null; feedback_to: string; feedback_required: boolean; evidence: TaskEvidence; status: 'pending' | 'confirmed' | 'dismissed'; todo_id?: string }
export interface PersonalTodo { id: string; revision: number; created_at: string; updated_at: string; title: string; owner: string; due_at: string | null; remind_at: string | null; feedback_to: string; feedback_required: boolean; kind: 'own' | 'supervise'; handling_status: 'open' | 'done'; feedback_status: 'pending' | 'done' | 'not_required'; evidence: TaskEvidence; reminder: { status: 'none' | 'scheduled' | 'attempting' | 'submitted' | 'failed' | 'unknown'; attempted_at?: string; error?: string } }
export interface ActivityVisionModel { base_url: string; model_name: string; api_key: string; api_key_set?: boolean; protocol?: 'openai' | 'anthropic' }
export interface ActivityRect { x: number; y: number; width: number; height: number }
export interface ActivityChatProfile { window_class: string; width: number; height: number; content: ActivityRect; title: ActivityRect; allowed_titles: string[] }
export interface ActivityChatScope { app_id: string; profiles: ActivityChatProfile[] }
export interface ActivityPreview { app_id: string; app_name: string; window_title: string; window_class: string; width: number; height: number; image_data_url: string }
export interface ActivityConfig { chat_scopes?: ActivityChatScope[]; extraction_mode?: 'ocr' | 'vision' | 'dedicated' | 'qwen'; extraction_prompt?: string; image_ai_enabled?: boolean; dedicated_vision?: ActivityVisionModel; ocr_language?: 'zh-Hans' | 'zh-Hant' | 'en-US'; enabled: boolean; allowed_apps: string[]; interval_ms: number; ocr_ai_enabled: boolean; retention_days: number; max_storage_mb: number }
export interface ActivitySource { id: string; captured_at: string; app_id: string; app_name: string; window_title: string; conversation_title?: string; ocr_text: string; sha256: string; bytes: number; origin?: 'foreground' | 'manual_import'; deleted?: boolean }
export interface ActivitySnapshot { version: 1; revision: number; config: ActivityConfig; candidates: TodoCandidate[]; todos: PersonalTodo[]; sources: Array<Omit<ActivitySource, 'ocr_text'>>; runtime: { capture_mode?: 'automatic' | 'manual-only'; platform_note?: string; platform: string; supported: boolean; chat_scope_supported?: boolean; running: boolean; scanning: boolean; last_scan_at: string | null; last_success_at: string | null; status: string; error: string | null; scope_note?: string | null; model_target_ids?: Record<string, string>; model_targets?: Record<string, string>; model_target?: string; model_target_id?: string; coverage: string } }
export interface ActivityApp { app_id: string; app_name: string; window_state?: 'visible' | 'minimized' | 'hidden' | 'none' }
export interface ActivityReply { preview?: ActivityPreview; recognized_title?: string; apps?: ActivityApp[]; type: 'activity.result'; id: string; ok: boolean; state?: ActivitySnapshot; source?: ActivitySource & { image_data_url: string | null }; error?: string; error_code?: string }

export class ActivityRequestError extends Error {
  constructor(message: string, readonly state?: ActivitySnapshot) { super(message) }
}

export function matchingActivityReply(message: ActivityReply, type: string, data: Record<string, unknown>): boolean {
  if (message.type !== 'activity.result' || message.ok !== true) return false
  if (type === 'activity.apps') return Array.isArray(message.apps) && message.apps.length <= 4096 && message.apps.every(app => !!app && Object.keys(app).every(key => key === 'app_id' || key === 'app_name' || key === 'window_state') && typeof app.app_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/.test(app.app_id) && typeof app.app_name === 'string' && app.app_name.length > 0 && app.app_name.length <= 200 && (app.window_state === undefined || ['visible', 'minimized', 'hidden', 'none'].includes(app.window_state))) && new Set(message.apps.map(app => app.app_id)).size === message.apps.length
  if (type === 'activity.preview') {
    const p = message.preview
    return !!p && p.app_id === data.app_id && typeof p.app_name === 'string' && p.app_name.length > 0 && p.app_name.length <= 200 && typeof p.window_title === 'string' && p.window_title.length <= 500 && typeof p.window_class === 'string' && p.window_class.length > 0 && p.window_class.length <= 256 && Number.isSafeInteger(p.width) && Number.isSafeInteger(p.height) && p.width > 0 && p.height > 0 && p.width <= 8192 && p.height <= 8192 && p.width * p.height <= 16_777_216 && typeof p.image_data_url === 'string' && p.image_data_url.length <= 8_388_630 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(p.image_data_url)
  }
  if (type === 'activity.preview_ocr') return typeof message.recognized_title === 'string' && message.recognized_title.length <= 200
  if (type === 'activity.source') return !!message.source && message.source.id === data.source_id && typeof message.source.ocr_text === 'string' && (message.source.image_data_url === null || typeof message.source.image_data_url === 'string')
  const state = message.state
  return !!state && state.version === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0 && !!state.config && typeof state.config.enabled === 'boolean' && Array.isArray(state.config.allowed_apps) && Array.isArray(state.candidates) && Array.isArray(state.todos) && Array.isArray(state.sources) && !!state.runtime && typeof state.runtime.coverage === 'string'
}

/** Backend persistence reply, rather than the service-worker transport ACK, owns success. */
export function requestActivity(type: string, data: Record<string, unknown> = {}, signal?: AbortSignal): Promise<ActivityReply> {
  return new Promise((resolve, reject) => {
    const id = `activity-${crypto.randomUUID()}`
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error, result?: ActivityReply) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      chrome.runtime.onMessage.removeListener(receive)
      signal?.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve(result!)
    }
    const cancel = () => finish(new Error('请求已停止；已发出的更改请刷新核实。'))
    const receive = (message: ActivityReply) => {
      if (message?.id !== id) return
      if (message.type !== 'activity.result') return
      if (!message.ok) {
        const hasSourceState = (type === 'activity.scan' || type === 'activity.import') &&
          matchingActivityReply({ ...message, ok: true }, type, data)
        finish(new ActivityRequestError(message.error || '操作未确认，请刷新核实。', hasSourceState ? message.state : undefined))
      }
      else if (matchingActivityReply(message, type, data)) finish(undefined, message)
    }
    if (signal?.aborted) { cancel(); return }
    chrome.runtime.onMessage.addListener(receive)
    signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(() => finish(new Error('未收到后台确认，请刷新核实；不会自动重试更改。')), type === 'activity.preview' ? 90_000 : type === 'activity.preview_ocr' ? 45_000 : type === 'activity.scan' || type === 'activity.import' || type === 'activity.analyze' ? 720_000 : 15_000)
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type, ...data, id, require_connected: true })).then(ack => {
        if (ack?.ok === false) finish(new Error(ack.error || 'Companion 未连接。'))
      }).catch(() => finish(new Error('连接中断，请刷新核实操作结果。')))
    } catch { finish(new Error('Companion 连接不可用。')) }
  })
}
export function taskComplete(todo: PersonalTodo): boolean { return todo.handling_status === 'done' && todo.feedback_status !== 'pending' }
export function dueToday(todo: PersonalTodo, now = new Date()): boolean {
  if (!todo.due_at || taskComplete(todo)) return false
  const due = new Date(todo.due_at)
  return Number.isFinite(due.getTime()) && due.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
}
export function formatTaskTime(value: string | null): string {
  if (!value) return '未设置'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间不可用'
}
export function datetimeInput(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
export function datetimeISO(value: string): string | null { return value ? new Date(value).toISOString() : null }

/** datetime-local displays minutes. Untouched controls must not rewrite stored seconds or receipts. */
export function taskDatePatch(candidate: boolean, initial: { due: string; remind: string }, current: { due: string; remind: string }): { due_at?: string | null; remind_at?: string | null } {
  return { ...(current.due !== initial.due ? { due_at: datetimeISO(current.due) } : {}), ...(candidate || current.remind !== initial.remind ? { remind_at: datetimeISO(current.remind) } : {}) }
}
