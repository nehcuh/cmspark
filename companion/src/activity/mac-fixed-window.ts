import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolveIntegrityHostBin } from '../host-use/darwin/host-integrity'
import { resolveHostBinary } from '../host-use/darwin/host-bin'
import { ActivityError } from './types'
import { validatePng } from './image'

interface Reply { status: string; app_id?: string; app_name?: string; title?: string; window_id?: number; image?: string; display?: string; logical_width?: number; logical_height?: number }

const skipReasons: Record<string, string> = {
  locked: '已锁屏或桌面会话不可用', secureInput: '安全输入已开启', permission: '缺少辅助功能权限',
  notVisible: '窗口已最小化、隐藏或不在当前桌面', occluded: '窗口被其它窗口遮挡', spanning: '窗口未完整位于同一显示器',
  geometry: '无法核实窗口的可见边界', changed: '截图期间窗口已变化，请重新检查或选窗', too_large: '窗口截图超过尺寸限制，请缩小后重新校准',
}
/** Each helper retains the original system picker filter until unbound or the parent exits. */
export async function pickMacWindow(appId: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const child = spawn(resolveIntegrityHostBin(resolveHostBinary()), ['activity-window-picker', '--bundle-id', appId], { stdio: ['pipe', 'pipe', 'ignore'] })
  const lines = createInterface({ input: child.stdout })
  let closed = false
  let receive: ((value?: Reply) => void) | undefined
  function close() { closed = true; child.kill(); receive?.() }
  child.on('error', close)
  child.stdin.on('error', close)
  child.on('close', () => { closed = true; receive?.(); lines.close() })
  lines.on('line', line => {
    try { receive?.(JSON.parse(line)) } catch { close() }
  })
  function next(timeout: number): Promise<Reply> {
    if (closed) return Promise.reject(new ActivityError('WINDOW_CLOSED', '窗口绑定已结束，请重新选择窗口'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(close, timeout)
      receive = value => {
        clearTimeout(timer)
        receive = undefined
        if (value) resolve(value)
        else reject(new ActivityError('WINDOW_CLOSED', '窗口绑定已结束或超时，请重新选择窗口'))
      }
    })
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    const selected = await next(85_000)
    if (selected.status !== 'selected' || selected.app_id !== appId || !selected.title || selected.title.length > 500 || !Number.isSafeInteger(selected.window_id))
      throw new ActivityError('WINDOW_NOT_SELECTED', '未选中指定应用的窗口，请重新选择')
    return {
      title: selected.title, appName: selected.app_name || appId, identity: appId + '/' + selected.window_id,
      close,
      async frame(signal: AbortSignal) {
        signal.throwIfAborted()
        const pending = next(15_000)
        if (!closed) child.stdin.write('capture\n')
        const result = await pending
        signal.throwIfAborted()
        if (result.status === 'closed') { close(); throw new ActivityError('WINDOW_CLOSED', '所选窗口已关闭，请重新选择窗口') }
        if (Object.hasOwn(skipReasons, result.status)) throw new ActivityError('WINDOW_NOT_VISIBLE', skipReasons[result.status])
        if (result.status !== 'frame' || !result.title || !result.image || !result.display)
          throw new ActivityError('WINDOW_CAPTURE_FAILED', '固定窗口截图不可用，请检查窗口尺寸、权限或重新选窗')
        const image = Buffer.from(result.image, 'base64')
        validatePng(image)
        if (!result.logical_width || !result.logical_height || !Number.isSafeInteger(result.logical_width) || !Number.isSafeInteger(result.logical_height))
          throw new ActivityError('WINDOW_CAPTURE_FAILED', '未能核实固定窗口的逻辑尺寸')
        return { title: result.title, display: result.display, image, logicalSize: { width: result.logical_width, height: result.logical_height } }
      },
    }
  } catch (e) { close(); throw e }
  finally { signal.removeEventListener('abort', close) }
}
