import { ActivityError, PROTECTED_APPS } from './types'

export const WINDOWS_ACTIVITY_APP_LIMIT = 4096
export type WindowsActivityWindowState = 'visible' | 'minimized' | 'hidden' | 'none'
export interface WindowsActivityApp {
  app_id: string
  app_name: string
  window_state: WindowsActivityWindowState
}
const states: Record<WindowsActivityWindowState, number> = { none: 0, hidden: 1, minimized: 2, visible: 3 }
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0

/** Apps are process identities; no HWND or capture eligibility belongs in this DTO. */
export function decodeWindowsActivityApps(value: unknown): WindowsActivityApp[] {
  if (!value || typeof value !== 'object' || (value as any).ok !== true || !Array.isArray((value as any).apps)) {
    throw new ActivityError('APP_LIST_FAILED', '无法读取 Windows 运行进程列表')
  }
  const rows = (value as { apps: unknown[] }).apps
  if (rows.length > WINDOWS_ACTIVITY_APP_LIMIT) throw new ActivityError('APP_LIST_LIMIT_EXCEEDED', 'Windows 运行进程超过 4096 项，本次列表未更新；已有选择保留')
  const apps = new Map<string, WindowsActivityApp>()
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ActivityError('APP_LIST_FAILED', 'Windows 应用身份无效')
    const row = raw as Record<string, unknown>
    if (Object.keys(row).sort().join(',') !== 'app_id,app_name,window_state' ||
        typeof row.app_id !== 'string' || !/^win\.[a-f0-9]{64}$/.test(row.app_id) ||
        typeof row.app_name !== 'string' || !row.app_name.trim() || row.app_name.length > 200 ||
        typeof row.window_state !== 'string' || !Object.hasOwn(states, row.window_state)) {
      throw new ActivityError('APP_LIST_FAILED', 'Windows 应用身份或窗口状态无效')
    }
    if (PROTECTED_APPS.test(row.app_name)) continue
    const next: WindowsActivityApp = { app_id: row.app_id, app_name: row.app_name.trim(), window_state: row.window_state as WindowsActivityWindowState }
    const previous = apps.get(next.app_id)
    if (previous) {
      if (compare(next.app_name, previous.app_name) < 0) previous.app_name = next.app_name
      if (states[next.window_state] > states[previous.window_state]) previous.window_state = next.window_state
    } else apps.set(next.app_id, next)
  }
  return [...apps.values()].sort((a, b) => compare(a.app_name, b.app_name) || compare(a.app_id, b.app_id))
}
