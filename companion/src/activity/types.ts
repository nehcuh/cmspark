/** Personal tasks are durable user-owned records, independent of Agent MissionBoard. */
export interface ActivityConfig {
  enabled: boolean
  allowed_apps: string[]
  interval_ms: number
  ocr_ai_enabled: boolean
  retention_days: number
  max_storage_mb: number
}
export interface ActivityApp { app_id: string; app_name: string }
export interface ActivitySource {
  id: string
  captured_at: string
  app_id: string
  app_name: string
  window_title: string
  ocr_text: string
  sha256: string
  bytes: number
  deleted?: boolean
}
export interface TaskEvidence {
  source_id: string
  app_id: string
  group: string
  sender: string
  message_time: string
  quote: string
}
export interface TodoCandidate {
  id: string
  revision: number
  created_at: string
  title: string
  owner: string
  due_at: string | null
  feedback_to: string
  feedback_required: boolean
  evidence: TaskEvidence
  status: 'pending' | 'confirmed' | 'dismissed'
  todo_id?: string
}
export interface PersonalTodo {
  id: string
  revision: number
  created_at: string
  updated_at: string
  title: string
  owner: string
  due_at: string | null
  remind_at: string | null
  feedback_to: string
  feedback_required: boolean
  kind: 'own' | 'supervise'
  handling_status: 'open' | 'done'
  feedback_status: 'pending' | 'done' | 'not_required'
  evidence: TaskEvidence
  reminder: { status: 'none' | 'scheduled' | 'attempting' | 'submitted' | 'failed' | 'unknown'; attempted_at?: string; error?: string }
}
export interface ActivityState {
  version: 1
  revision: number
  config: ActivityConfig
  sources: ActivitySource[]
  candidates: TodoCandidate[]
  todos: PersonalTodo[]
}
export interface ActivityRuntime {
  platform: string
  supported: boolean
  running: boolean
  scanning: boolean
  last_scan_at: string | null
  last_success_at: string | null
  status: string
  error: string | null
  coverage: string
}
export type ActivityWireState = Omit<ActivityState, 'sources'> & { sources: Array<Omit<ActivitySource, 'ocr_text'>>; runtime: ActivityRuntime }
export class ActivityError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ActivityError' }
}
export const DEFAULT_ACTIVITY_CONFIG: ActivityConfig = {
  enabled: false, allowed_apps: [], interval_ms: 30_000, ocr_ai_enabled: false,
  retention_days: 14, max_storage_mb: 512,
}
export const PROTECTED_APPS = /(?:keychainaccess|1password|onepassword|bitwarden|lastpass|keepass|dashlane|authy|authenticator|systempreferences|loginwindow|screenlock|securityagent|authorizationhost|passwords|wallet|metamask|ledger|exodus|secretive)/i
export const COVERAGE = '仅记录已授权且位于前台的应用窗口可见内容；不会切换聊天、滚动或读取未显示消息。提醒要求本机 Companion 运行；系统可能抑制通知。'
