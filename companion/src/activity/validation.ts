import { ActivityError, PROTECTED_APPS } from './types'
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
export function checkObject(v: unknown, allowed: string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) throw new ActivityError('INVALID_REQUEST', '请求包含未知字段或非法对象')
}
export function text(v: unknown, max: number, required = false): string {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw new ActivityError('INVALID_REQUEST', '文本字段无效')
  return v.trim()
}
export function iso(v: unknown): string | null {
  if (v === null) return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) throw new ActivityError('INVALID_REQUEST', '时间须包含时区且是有效日期')
  const [year, month, day, hour, minute, second] = v.slice(0, 19).split(/[-T:]/).map(Number)
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) throw new ActivityError('INVALID_REQUEST', '日期或时间不存在')
  return new Date(v).toISOString()
}
export function validateConfig(patch: unknown): Record<string, unknown> {
  checkObject(patch, ['enabled', 'allowed_apps', 'interval_ms', 'ocr_ai_enabled', 'retention_days', 'max_storage_mb'])
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'enabled' || key === 'ocr_ai_enabled') { if (typeof value !== 'boolean') throw new ActivityError('INVALID_REQUEST', '开关必须是布尔值') }
    else if (key === 'allowed_apps') {
      if (!Array.isArray(value) || value.length > 20 || value.some(app => typeof app !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/.test(app) || PROTECTED_APPS.test(app))) throw new ActivityError('INVALID_REQUEST', '应用白名单无效或包含敏感应用')
    } else {
      const limits: Record<string, [number, number]> = { interval_ms: [5_000, 600_000], retention_days: [1, 90], max_storage_mb: [16, 10240] }
      const [min, max] = limits[key]
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new ActivityError('INVALID_REQUEST', '采集参数超出范围')
    }
  }
  return patch
}
const taskKeys = ['title', 'owner', 'due_at', 'remind_at', 'feedback_to', 'feedback_required', 'kind', 'handling_status', 'feedback_status']
export function validateTask(patch: unknown, confirm = false): Record<string, unknown> {
  checkObject(patch, taskKeys)
  for (const [k, v] of Object.entries(patch)) {
    if (['title', 'owner', 'feedback_to'].includes(k)) text(v, k === 'title' ? 300 : 200, k !== 'feedback_to')
    else if (k === 'due_at' || k === 'remind_at') iso(v)
    else if (k === 'feedback_required') { if (typeof v !== 'boolean') throw new ActivityError('INVALID_REQUEST', '反馈标识无效') }
    else if (k === 'kind' && !['own', 'supervise'].includes(String(v))) throw new ActivityError('INVALID_REQUEST', '事项类型无效')
    else if (k === 'handling_status' && !['open', 'done'].includes(String(v))) throw new ActivityError('INVALID_REQUEST', '处理状态无效')
    else if (k === 'feedback_status' && !['pending', 'done', 'not_required'].includes(String(v))) throw new ActivityError('INVALID_REQUEST', '反馈状态无效')
  }
  if (confirm) { text(patch.title, 300, true); text(patch.owner, 200, true) }
  return patch
}
export function validateActivityMessage(message: unknown): boolean {
  try {
    if (!object(message) || typeof message.type !== 'string') return false
    const base = ['type', 'id']
    const extras: Record<string, string[]> = {
      'activity.state': [], 'activity.apps': [], 'activity.configure': ['expected_revision', 'patch'], 'activity.scan': [],
      'activity.analyze': ['source_id'], 'activity.source': ['source_id'], 'activity.delete': ['source_id'],
      'todo.create': ['source_id', 'expected_revision', 'task'], 'todo.confirm': ['candidate_id', 'expected_revision', 'task'], 'todo.update': ['todo_id', 'expected_revision', 'patch'], 'todo.dismiss': ['candidate_id', 'expected_revision'],
    }
    if (!Object.hasOwn(extras, message.type)) return false
    checkObject(message, [...base, ...extras[message.type]])
    if (message.id !== undefined) text(message.id, 128, true)
    if ('expected_revision' in message && (!Number.isSafeInteger(message.expected_revision) || Number(message.expected_revision) < 0)) return false
    if (['activity.configure', 'todo.create', 'todo.confirm', 'todo.update', 'todo.dismiss'].includes(message.type) && !('expected_revision' in message)) return false
    if (message.type === 'activity.configure') validateConfig(message.patch)
    if ((message.type === 'todo.confirm' || message.type === 'todo.create')) validateTask(message.task, true)
    if (message.type === 'todo.update') validateTask(message.patch)
    for (const k of ['source_id', 'candidate_id', 'todo_id']) if (message[k] !== undefined && !/^[a-f0-9-]{36}$/.test(String(message[k]))) return false
    if ((message.type === 'activity.source' || message.type === 'activity.analyze' || message.type === 'todo.create') && !message.source_id) return false
    if ((message.type === 'todo.confirm' || message.type === 'todo.dismiss') && !message.candidate_id) return false
    if (message.type === 'todo.update' && !message.todo_id) return false
    return true
  } catch { return false }
}
