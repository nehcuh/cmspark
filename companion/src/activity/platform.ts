import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveWinScript, runPs, type PsRunner } from '../host-use/win/powershell'
import { MacPassiveRecorder, type CapturedWindow, type RecorderAdapter } from './adapters'
import { ActivityError, PROTECTED_APPS, type ActivityApp, type ActivityConfig } from './types'

const exec = promisify(execFile)
import { languageOf, validatePng, withPendingImage, type LocalLanguage } from './image'
export const platformSupport = (platform: string = process.platform, env = process.env) => {
  if (platform === 'darwin' || platform === 'win32') return { supported: true, capture_mode: 'automatic' as const, platform_note: platform === 'win32' ? 'Windows：需普通交互桌面及已安装的本地 OCR 语言；不会抬起窗口。' : 'macOS：需屏幕录制和辅助功能授权。' }
  if (platform === 'linux' && /^(?:unix\/?)?:[0-9]{1,5}(?:\.[0-9]{1,3})?$/.test(env.DISPLAY || '') && env.XDG_SESSION_TYPE === 'x11' && !env.WAYLAND_DISPLAY) return { supported: true, capture_mode: 'automatic' as const, platform_note: 'Linux 本地 X11：需 Python3、libX11/libXss/libXRes、Tesseract 和可核实的桌面锁屏服务；未知状态不采集。' }
  return { supported: false, capture_mode: 'manual-only' as const, platform_note: platform === 'linux' ? 'Wayland、无 X11 桌面或会话类型不明：无法核实全局前台应用，不进行后台采集。可主动导入 PNG 截图并在本机 OCR。' : '当前平台不支持自动采集；可用的本地 OCR 取决于系统。' }
}

interface WinWindow { hwnd: number; pid: number; started: string; app_id: string; app_name: string; exe: string; title: string; geometry: string; safe: boolean }
function winWindow(value: any): value is WinWindow {
  return !!value && Number.isSafeInteger(value.hwnd) && value.hwnd > 0 && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.started === 'string' && /^win\.[a-f0-9]{64}$/.test(value.app_id) && typeof value.app_name === 'string' && typeof value.exe === 'string' && typeof value.title === 'string' && typeof value.geometry === 'string' && value.safe === true && !PROTECTED_APPS.test(value.exe + ' ' + value.app_name)
}
export class WindowsPassiveRecorder implements RecorderAdapter {
  constructor(private root: string, private run: PsRunner = runPs, private resolve = resolveWinScript) {}
  private async call(name: string, args: string[], signal: AbortSignal): Promise<any> {
    signal.throwIfAborted()
    try { const value = JSON.parse(await this.run(this.resolve(name), args)); signal.throwIfAborted(); return value }
    catch (error) {
      if (signal.aborted) throw error
      const stderr = String((error as any)?.stderr || '')
      throw new ActivityError('WINDOWS_CAPTURE_UNAVAILABLE', /OCRLANGMISSING/.test(stderr) ? '本机未安装所选 Windows OCR 语言包，请在系统语言设置中安装或选择其他语言' : 'Windows 采集或 OCR 不可用：请核对普通交互桌面、窗口权限及本地 OCR 语言')
    }
  }
  async listApps(signal: AbortSignal): Promise<ActivityApp[]> {
    const value = await this.call('activity-windows.ps1', ['-Mode', 'Apps'], signal)
    if (value.ok !== true || !Array.isArray(value.windows) || value.windows.length > 4096) throw new ActivityError('APP_LIST_FAILED', '无法读取 Windows 应用列表')
    const apps = new Map<string, ActivityApp>()
    for (const row of value.windows) if (winWindow(row) && apps.size < 200) apps.set(row.app_id, { app_id: row.app_id, app_name: row.app_name.slice(0, 200) })
    return [...apps.values()]
  }
  async ocrImage(image: Buffer, language: LocalLanguage, signal: AbortSignal): Promise<string> {
    validatePng(image)
    return withPendingImage(this.root, image, file => this.ocr(file, language, signal))
  }
  private async ocr(file: string, language: LocalLanguage, signal: AbortSignal): Promise<string> {
    const result = await this.call('computer-ocr.ps1', ['-ImagePath', file, '-Language', language], signal)
    if (result.ok !== true || !Array.isArray(result.words)) throw new ActivityError('OCR_FAILED', 'Windows 本地 OCR 未返回可靠结果')
    return result.words.filter((word: any) => typeof word.text === 'string').map((word: any) => word.text).join('\n').slice(0, 24000)
  }
  async capture(config: ActivityConfig, signal: AbortSignal): Promise<CapturedWindow | null> {
    const before = await this.call('activity-windows.ps1', ['-Mode', 'Probe'], signal)
    if (before.ok !== true || !winWindow(before.window) || !config.allowed_apps.includes(before.window.app_id)) return null
    const window: WinWindow = before.window
    return withPendingImage(this.root, null, async file => {
      const security = await this.call('computer-probe.ps1', ['-Hwnd', String(window.hwnd)], signal)
      if (security.desktop !== 'Default' || security.pid !== window.pid || !Number.isInteger(security.ownIl) || !Number.isInteger(security.targetIl) || security.ownIl < 0 || security.targetIl < 0 || security.ownIl < security.targetIl) throw new ActivityError('PERMISSION_REQUIRED', '安全桌面或窗口权限不可验证，已跳过采集')
      const captured = await this.call('computer-capture.ps1', ['-Hwnd', String(window.hwnd), '-OutPath', file, '-Passive', '-AllowFallback'], signal)
      if (captured.ok !== true || captured.restoredFromIconic !== false || !['ok', 'partial'].includes(captured.observation_quality) || !Array.isArray(captured.occludedBy) || captured.occludedBy.length !== 0) throw new ActivityError('CAPTURE_FAILED', 'Windows 被动截图失败')
      const after = await this.call('activity-windows.ps1', ['-Mode', 'Probe'], signal)
      if (!winWindow(after.window) || ['hwnd', 'pid', 'started', 'app_id', 'exe', 'title', 'geometry'].some(key => (window as any)[key] !== after.window[key])) return null
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new ActivityError('CAPTURE_FAILED', '截图文件不可读取')
      const image = fs.readFileSync(file); validatePng(image)
      return { app_id: window.app_id, app_name: window.app_name, window_title: window.title.slice(0, 500), image, ocr_text: await this.ocr(file, languageOf(config), signal) }
    })
  }
}

export function resolveLinuxRecorder(): string {
  for (const file of [path.join(__dirname, 'linux-recorder.py'), path.join(__dirname, 'activity/linux-recorder.py'), path.resolve(__dirname, '../../src/activity/linux-recorder.py'), path.resolve(__dirname, '../../../src/activity/linux-recorder.py')]) if (fs.existsSync(file)) return file
  throw new ActivityError('DEPENDENCY_MISSING', 'Linux 采集辅助文件未安装，请重新安装完整 Companion')
}
export type LinuxRunner = (executable: string, args: string[], signal: AbortSignal) => Promise<string>
export const runLinux: LinuxRunner = async (executable, args, signal) => {
  try {
    const { stdout } = await exec(executable, args, { timeout: 30_000, maxBuffer: 1024 * 1024, signal, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: process.env.HOME, DISPLAY: process.env.DISPLAY, XAUTHORITY: process.env.XAUTHORITY, XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }, encoding: 'utf8' })
    return stdout
  } catch (error) {
    if (signal.aborted) throw error
    const code = String((error as any)?.stderr || '').trim()
    if (code === 'SCREEN_LOCK_OR_SAVER') throw new ActivityError('DESKTOP_LOCKED', '屏幕已锁定或屏保开启，已跳过采集')
    if (code === 'LOCK_STATE_UNKNOWN') throw new ActivityError('LOCK_STATE_UNKNOWN', '无法核实桌面锁屏状态，已跳过采集；请在兼容桌面会话运行，或主动导入截图')
    if (/^(FOREGROUND_UNAVAILABLE|FOCUS_IDENTITY_UNAVAILABLE|WINDOW_OCCLUDED|WINDOW_NOT_VISIBLE|SOURCE_CHANGED|XRES_IDENTITY_UNAVAILABLE|FOREIGN_PROCESS|PROTECTED_APPLICATION|WINDOW_NOT_FULLY_VISIBLE|STACK_UNAVAILABLE|WINDOW_GONE)$/.test(code)) throw new ActivityError('SOURCE_UNVERIFIED', '当前窗口身份、前台焦点或可见范围无法核实，已跳过采集')
    if (executable === '/usr/bin/tesseract' && /Failed loading language|Error opening data file|Couldn't load any languages/.test(code)) throw new ActivityError('OCR_LANGUAGE_MISSING', '本机未安装所选 Tesseract OCR 语言包，请安装相应语言包或选择其他语言')
    throw new ActivityError('LINUX_CAPTURE_UNAVAILABLE', 'Linux 本地工具不可用或拒绝采集：需 X11、Python3、libX11/libXss/libXRes、Tesseract 及所选语言包；Wayland 请使用主动导入')
  }
}
export class LinuxPassiveRecorder implements RecorderAdapter {
  constructor(private root: string, private run: LinuxRunner = runLinux, private helper = resolveLinuxRecorder) {}
  async listApps(signal: AbortSignal): Promise<ActivityApp[]> {
    const value = JSON.parse(await this.run('/usr/bin/python3', ['-I', this.helper(), 'apps'], signal))
    if (value.ok !== true || !Array.isArray(value.apps) || value.apps.length > 200 || value.apps.some((a: any) => !/^linux\.[a-f0-9]{64}$/.test(a.app_id) || typeof a.app_name !== 'string' || !a.app_name.trim() || a.app_name.length > 200 || PROTECTED_APPS.test(a.app_name))) throw new ActivityError('APP_LIST_FAILED', 'Linux 应用身份不可验证')
    return value.apps.map((a: ActivityApp) => ({ app_id: a.app_id, app_name: a.app_name }))
  }
  async ocrImage(image: Buffer, language: LocalLanguage, signal: AbortSignal): Promise<string> {
    validatePng(image)
    return withPendingImage(this.root, image, file => this.ocr(file, language, signal))
  }
  private async ocr(file: string, language: LocalLanguage, signal: AbortSignal): Promise<string> {
    return (await this.run('/usr/bin/tesseract', [file, 'stdout', '-l', { 'zh-Hans': 'chi_sim+eng', 'zh-Hant': 'chi_tra+eng', 'en-US': 'eng' }[language], '--psm', '3'], signal)).trim().slice(0, 24000)
  }
  async capture(config: ActivityConfig, signal: AbortSignal): Promise<CapturedWindow | null> {
    return withPendingImage(this.root, null, async file => {
      const value = JSON.parse(await this.run('/usr/bin/python3', ['-I', this.helper(), 'capture', file, JSON.stringify(config.allowed_apps)], signal))
      if (value.ok !== true) throw new ActivityError('CAPTURE_FAILED', 'Linux 采集未获得成功回执')
      if (!value.window) return null
      const w = value.window
      if (!/^linux\.[a-f0-9]{64}$/.test(w.app_id) || !config.allowed_apps.includes(w.app_id) || typeof w.app_name !== 'string' || typeof w.title !== 'string' || PROTECTED_APPS.test(w.app_name)) throw new ActivityError('CAPTURE_FAILED', 'Linux 来源应用身份无效')
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new ActivityError('CAPTURE_FAILED', 'Linux 截图不可读取')
      const image = fs.readFileSync(file); validatePng(image)
      return { app_id: w.app_id, app_name: w.app_name.slice(0, 200), window_title: w.title.slice(0, 500), image, ocr_text: await this.ocr(file, languageOf(config), signal) }
    })
  }
}
export function createRecorder(root: string, platform: string = process.platform): RecorderAdapter {
  return platform === 'win32' ? new WindowsPassiveRecorder(root) : platform === 'linux' ? new LinuxPassiveRecorder(root) : new MacPassiveRecorder(root)
}
