import * as path from 'node:path'
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ActivityError } from './types'
const exec = promisify(execFile)
export type ToastExecutor = (file: string, args: string[], options: { timeout: number; windowsHide: boolean; maxBuffer: number }) => Promise<unknown>

export function resolveWindowsToast(architecture = process.arch): string {
  const name = architecture === 'ia32' ? 'snoretoast-x86.exe' : 'snoretoast-x64.exe'
  // SEA's embedder require cannot resolve filesystem packages. Both official
  // packagers stage this fixed resource beside the executable / bundled JS.
  for (const root of [path.dirname(process.execPath), __dirname]) {
    const file = path.join(root, 'activity-bin', name)
    if (fs.existsSync(file)) return file
  }
  const localRequire = createRequire(__filename)
  return path.join(path.dirname(localRequire.resolve('node-notifier/package.json')), 'vendor', 'snoreToast', name)
}
/** The package callback suppresses several spawn failures. Observe the actual child instead. */
export async function submitWindowsReminder(run: ToastExecutor = exec, binary = resolveWindowsToast()): Promise<void> {
  try {
    await run(binary, ['-t', 'CMspark 待办提醒', '-m', '有待办需要处理或反馈，请打开 CMspark 待办查看。', '-silent'], { timeout: 10000, windowsHide: true, maxBuffer: 4096 })
  } catch (error) {
    const value = error as { code?: unknown; killed?: boolean; signal?: string }
    // SnoreToast's documented hidden/dismissed/expired/action exit codes prove submission,
    // never that a human read or completed the task. ENOENT/-1 are NOT success.
    if (typeof value.code === 'number' && value.code >= 1 && value.code <= 5) return
    if (value.killed || value.signal || value.code === 'ETIMEDOUT') throw new ActivityError('NOTIFICATION_UNKNOWN', '系统通知回执未知，请在待办面板核对')
    throw new ActivityError('NOTIFICATION_FAILED', 'Windows 系统通知提交失败，请检查通知设置及完整安装包')
  }
}
