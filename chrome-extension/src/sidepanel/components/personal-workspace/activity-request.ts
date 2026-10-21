/** Wire projection of Companion activity/types.ts; personal tasks never alias Agent Board records. */
export interface TaskEvidence { source_id: string; app_id: string; group: string; sender: string; message_time: string; quote: string }
export interface TodoCandidate { id: string; revision: number; created_at: string; title: string; owner: string; due_at: string | null; feedback_to: string; feedback_required: boolean; evidence: TaskEvidence; status: 'pending' | 'confirmed' | 'dismissed'; todo_id?: string }
export interface PersonalTodo { id: string; revision: number; created_at: string; updated_at: string; title: string; owner: string; due_at: string | null; remind_at: string | null; feedback_to: string; feedback_required: boolean; kind: 'own' | 'supervise'; handling_status: 'open' | 'done'; feedback_status: 'pending' | 'done' | 'not_required'; evidence: TaskEvidence; reminder: { status: 'none' | 'scheduled' | 'attempting' | 'submitted' | 'failed' | 'unknown'; attempted_at?: string; error?: string } }
export interface ActivityConfig { enabled: boolean; allowed_apps: string[]; interval_ms: number; ocr_ai_enabled: boolean; retention_days: number; max_storage_mb: number }
export interface ActivitySource { id: string; captured_at: string; app_id: string; app_name: string; window_title: string; ocr_text: string; sha256: string; bytes: number; deleted?: boolean }
export interface ActivitySnapshot { version: 1; revision: number; config: ActivityConfig; candidates: TodoCandidate[]; todos: PersonalTodo[]; sources: Array<Omit<ActivitySource, 'ocr_text'>>; runtime: { platform: string; supported: boolean; running: boolean; scanning: boolean; last_scan_at: string | null; last_success_at: string | null; status: string; error: string | null; coverage: string } }
export interface ActivityApp { app_id: string; app_name: string }
export interface ActivityReply { apps?: ActivityApp[]; type: 'activity.result'; id: string; ok: boolean; state?: ActivitySnapshot; source?: ActivitySource & { image_data_url: string | null }; error?: string; error_code?: string }

export function matchingActivityReply(message: ActivityReply, type: string, data: Record<string, unknown>): boolean {
  if (message.type !== 'activity.result' || message.ok !== true) return false
  if (type === 'activity.apps') return Array.isArray(message.apps) && message.apps.length <= 200 && message.apps.every(app => !!app && Object.keys(app).every(key => key === 'app_id' || key === 'app_name') && typeof app.app_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/.test(app.app_id) && typeof app.app_name === 'string' && app.app_name.length > 0 && app.app_name.length <= 200) && new Set(message.apps.map(app => app.app_id)).size === message.apps.length
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
      if (!message.ok) finish(new Error(message.error || '操作未确认，请刷新核实。'))
      else if (matchingActivityReply(message, type, data)) finish(undefined, message)
    }
    if (signal?.aborted) { cancel(); return }
    chrome.runtime.onMessage.addListener(receive)
    signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(() => finish(new Error('未收到后台确认，请刷新核实；不会自动重试更改。')), type === 'activity.scan' ? 120_000 : type === 'activity.analyze' ? 45_000 : 15_000)
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
  return { ...(candidate || current.due !== initial.due ? { due_at: datetimeISO(current.due) } : {}), ...(candidate || current.remind !== initial.remind ? { remind_at: datetimeISO(current.remind) } : {}) }
}
