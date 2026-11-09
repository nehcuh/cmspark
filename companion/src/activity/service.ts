import { DATA_DIR } from '../config'
import { ActivityStore } from './store'
import { extractActivity, submitReminder, type RecorderAdapter } from './adapters'
import { ActivityError, COVERAGE, type ActivityApp, type ActivityRuntime, type ActivitySource, type ActivityWireState, type PersonalTodo, type ActivityPreview, type ActivityRect } from './types'
import { createRecorder, platformSupport } from './platform'
import { languageOf, validatePng, type LocalLanguage } from './image'
import { ActivityScopeSkip, imageSize } from './chat-scope'
import { activityModelTarget, hasActivityImageConsent } from './model-config'
import type { extractActivityImage } from './model-extract'
import { validateActivityMessage } from './validation'
export interface ActivityDependencies {
  dataDir: string
  platform?: string
  now?: () => number
  recorder?: RecorderAdapter
  extract?: typeof extractActivity
  extractImage?: typeof extractActivityImage
  notify?: (todo: PersonalTodo) => Promise<void>
}
export class ActivityService {
  readonly store: ActivityStore
  private runtime: ActivityRuntime
  private now: () => number
  private recorder: RecorderAdapter
  private extract: NonNullable<ActivityDependencies['extract']>
  private extractImage?: typeof extractActivityImage
  private notify: NonNullable<ActivityDependencies['notify']>
  private timer: NodeJS.Timeout | null = null
  private pending: Promise<void> | null = null
  private calibrationPending: Promise<void> | null = null
  private automaticScan: { controller: AbortController | null; settled: Promise<unknown> } | null = null
  private reminders: Promise<void> | null = null
  private appListing: Promise<ActivityApp[]> | null = null
  private generation = 0
  private abort = new AbortController()
  private lastPoll = 0
  private lastMaintenance: number | null = null
  private stopping = false
  constructor(deps: ActivityDependencies) {
    this.store = new ActivityStore(deps.dataDir)
    const platform = deps.platform ?? process.platform
    const support = platformSupport(platform)
    this.runtime = { platform, ...support, chat_scope_supported: support.supported, running: false, scanning: false, last_scan_at: null, last_success_at: null, status: 'stopped', error: null, coverage: COVERAGE }
    this.now = deps.now ?? Date.now
    this.recorder = deps.recorder ?? createRecorder(this.store.root, platform)
    this.extract = deps.extract ?? extractActivity
    this.extractImage = deps.extractImage
    this.notify = deps.notify ?? submitReminder
  }
  state(): ActivityWireState {
    const state = this.store.stateMetadata(), config = this.store.config(), target = activityModelTarget(config)
    state.config.image_ai_enabled = hasActivityImageConsent(config)
    const targets = (["ocr", "vision", "dedicated", "qwen"] as const).map(mode => [mode, activityModelTarget({ ...config, extraction_mode: mode })] as const)
    return { ...state, runtime: { ...this.runtime, model_target: target.label, model_target_id: target.id, model_targets: Object.fromEntries(targets.map(([mode, value]) => [mode, value.label])), model_target_ids: Object.fromEntries(targets.map(([mode, value]) => [mode, value.id])) } }
  }
  private canExtract(): boolean {
    const config = this.store.config()
    return (config.extraction_mode || 'ocr') === 'ocr' ? config.ocr_ai_enabled : hasActivityImageConsent(config)
  }
  private async extractSource(source: ActivitySource, signal: AbortSignal, current: () => boolean): Promise<void> {
    const config = this.store.config(), target = activityModelTarget(config).id
    const imageMode = (config.extraction_mode || 'ocr') !== 'ocr'
    if (!this.canExtract()) throw new ActivityError(imageMode ? 'IMAGE_CONSENT_REQUIRED' : 'SEMANTIC_CONSENT_REQUIRED', '请核对处理目标并允许所选模型处理聊天内容')
    if (!imageMode) {
      const entries = await this.extract(source, signal, config.extraction_prompt)
      if (!current() || signal.aborted) throw new ActivityError('CANCELLED', '设置或来源已变化，此次抽取已取消')
      this.store.addCandidates(source, entries)
      return
    }
    const data = this.store.source(source.id).image_data_url
    if (!data) throw new ActivityError('NOT_FOUND', '来源截图已清理')
    const extract = this.extractImage ?? (await import('./model-extract')).extractActivityImage
    const result = await extract(source, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'), config, this.store.root, signal)
    if (!current() || signal.aborted || activityModelTarget(this.store.config()).id !== target || !this.canExtract()) throw new ActivityError('CANCELLED', '处理目标或来源已变化，此次抽取已取消')
    const updated = this.store.saveVisualTranscript(source, result.transcript)
    this.store.addCandidates(updated, result.entries)
  }
  start(): void {
    if (this.timer) return
    this.stopping = false; this.runtime.running = true; this.runtime.status = 'idle'; this.lastMaintenance = null
    this.timer = setInterval(() => { void this.tick().catch(() => { this.runtime.error ??= '后台活动服务失败，请重试'; this.runtime.status = 'error' }) }, 1000)
    this.timer.unref()
    void this.tick().catch(() => { this.runtime.status = 'error'; this.runtime.error ??= '后台活动服务失败，请重试' })
  }
  private fence(): void { this.generation++; this.abort.abort(); this.abort = new AbortController() }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null; this.stopping = true; this.runtime.running = false; this.fence()
    await Promise.allSettled([this.pending, this.calibrationPending, this.reminders, this.appListing])
    this.runtime.status = 'stopped'
  }
  private maintain(): void {
    this.store.prune(this.now())
    this.lastMaintenance = this.now()
  }
  async tick(): Promise<void> {
    if (!this.runtime.running) return
    if (this.lastMaintenance === null || this.now() - this.lastMaintenance >= 60_000 || this.now() < this.lastMaintenance) this.maintain()
    if (!this.reminders) {
      this.reminders = this.deliverReminders().finally(() => { this.reminders = null })
    }
    await this.reminders
    if (!this.runtime.running) return
    const config = this.store.config()
    if (this.pending || this.calibrationPending || !config.enabled || !this.runtime.supported || this.now() - this.lastPoll < config.interval_ms) return
    await this.runScan(() => true, true)
  }
  private async listApps(): Promise<ActivityApp[]> {
    if (!this.runtime.supported || !this.recorder.listApps) throw new ActivityError('UNSUPPORTED_PLATFORM', this.runtime.platform_note || '当前环境无法列出前台应用')
    if (!this.appListing) this.appListing = this.recorder.listApps(this.abort.signal).finally(() => { this.appListing = null })
    return this.appListing
  }
  private async calibration<T>(requestCurrent: () => boolean, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.runtime.chat_scope_supported) throw new ActivityError('UNSUPPORTED_PLATFORM', this.runtime.platform_note || '当前环境无法校准前台聊天区域')
    const automatic = this.automaticScan
    if (this.calibrationPending || (this.pending && !automatic)) throw new ActivityError('BUSY', '上一轮采集或校准尚未完成')
    const epoch = this.generation, signal = this.abort.signal
    const requireCurrent = () => {
      if (epoch !== this.generation || signal.aborted || !requestCurrent()) throw new ActivityError('CANCELLED', '页面或设置已变化，本次校准结果已丢弃')
    }
    let result!: T
    this.calibrationPending = (async () => {
      // Wait for the recorder to release its resources. A model that is
      // already processing a stored source can finish independently.
      if (automatic) await automatic.settled.catch(() => {})
      requireCurrent()
      result = await run(signal)
      requireCurrent()
    })().finally(() => { this.calibrationPending = null })
    automatic?.controller?.abort()
    await this.calibrationPending
    return result
  }
  async preview(appId: string, requestCurrent: () => boolean): Promise<ActivityPreview> {
    return this.calibration(requestCurrent, async signal => {
      // Explicit local preview only: bypass old ROIs to allow recalibration,
      // while the same recorder still enforces app identity and passive safety.
      const frame = await this.recorder.capture({ ...this.store.config(), allowed_apps: [appId], extraction_mode: 'vision', chat_scopes: [] }, signal)
      if (!frame || frame.app_id !== appId) throw new ActivityError('PREVIEW_WINDOW_UNAVAILABLE', '请切换到指定聊天应用的可见窗口后重新预览')
      if (typeof frame.window_class !== 'string' || !frame.window_class.trim() || frame.window_class.length > 256) throw new ActivityError('PREVIEW_WINDOW_UNAVAILABLE', '当前窗口类型无法核实，请刷新并重新预览')
      const size = imageSize(frame.image)
      if (frame.image.length > 6 * 1024 * 1024) throw new ActivityError('PREVIEW_TOO_LARGE', '预览超过 6 MiB；请缩小聊天窗口后重新校准')
      return { app_id: frame.app_id, app_name: frame.app_name, window_title: frame.window_title, window_class: frame.window_class, ...size, image_data_url: 'data:image/png;base64,' + frame.image.toString('base64') }
    })
  }
  async previewOcr(encoded: string, rect: ActivityRect, language: LocalLanguage, requestCurrent: () => boolean): Promise<string> {
    return this.calibration(requestCurrent, async signal => {
      if (!this.recorder.ocrTitle) throw new ActivityError('OCR_UNAVAILABLE', '当前系统未提供聊天标题本机 OCR')
      const image = Buffer.from(encoded, 'base64')
      if (image.length > 6 * 1024 * 1024 || image.toString('base64') !== encoded) throw new ActivityError('INVALID_IMAGE', '请提供不超过 6 MiB 的有效预览图片')
      validatePng(image)
      return this.recorder.ocrTitle(image, rect, language, signal)
    })
  }
  async scan(requestCurrent: () => boolean = () => true): Promise<void> {
    return this.runScan(requestCurrent, false)
  }
  private async runScan(requestCurrent: () => boolean, automatic: boolean): Promise<void> {
    if (this.pending || this.calibrationPending) throw new ActivityError('BUSY', '上一轮采集尚未完成')
    const config = this.store.config()
    if (!config.enabled) throw new ActivityError('RECORDING_DISABLED', '请先选择应用并明确开启记录')
    if (!this.runtime.supported) throw new ActivityError('UNSUPPORTED_PLATFORM', this.runtime.platform_note || '当前环境不支持自动采集')
    if (!config.allowed_apps.length) throw new ActivityError('NO_ALLOWED_APPS', '请先设置采集应用白名单')
    const epoch = this.generation, signal = this.abort.signal
    const controller = automatic ? new AbortController() : null
    this.lastPoll = this.now(); this.runtime.scanning = true; this.runtime.status = 'scanning'; this.runtime.error = null; this.runtime.scope_note = null
    this.runtime.last_scan_at = new Date(this.now()).toISOString()
    const current = (): boolean => epoch === this.generation && !signal.aborted && requestCurrent()
    this.pending = (async () => {
      try {
        this.store.prune(this.now())
        const capturing = this.recorder.capture(config, controller ? AbortSignal.any([signal, controller.signal]) : signal)
        const automaticScan = controller ? { controller, settled: capturing } : null
        this.automaticScan = automaticScan
        const capture = await capturing
        if (controller?.signal.aborted) return
        if (this.automaticScan) this.automaticScan.controller = null
        if (!current() || !capture) { if (current()) this.runtime.status = 'no_visible_allowed_window'; return }
        const source = this.store.addSource({ app_id: capture.app_id, app_name: capture.app_name, window_title: capture.window_title, ...(capture.conversation_title ? { conversation_title: capture.conversation_title } : {}), origin: 'foreground', ocr_text: capture.ocr_text, captured_at: new Date(this.now()).toISOString() }, capture.image)
        if (!current()) return
        this.runtime.last_success_at = new Date(this.now()).toISOString()
        this.runtime.status = source ? 'captured' : 'unchanged'
        if (source && this.canExtract() && ((config.extraction_mode || 'ocr') !== 'ocr' || source.ocr_text.trim())) {
          await this.extractSource(source, signal, current)
          if (!current()) return
          this.runtime.status = 'ready_for_review'
        }
        if (current()) this.store.prune(this.now())
      } catch (error) {
        if (controller?.signal.aborted) return
        if (current() && error instanceof ActivityScopeSkip) { this.runtime.status = error.status; this.runtime.scope_note = error.message; this.runtime.error = null; return }
        if (current()) { this.runtime.status = 'error'; this.runtime.error = error instanceof ActivityError ? error.message : '本轮采集或语义抽取失败，已保存的记录仍可查看'; throw error instanceof ActivityError ? error : new ActivityError('CAPTURE_OR_EXTRACTION_FAILED', this.runtime.error) }
      } finally {
        this.runtime.scanning = false
        if (controller?.signal.aborted && this.runtime.status === 'scanning') this.runtime.status = 'idle'
      }
    })().finally(() => { this.pending = null; this.automaticScan = null })
    await this.pending
  }
  async analyze(sourceId: string, requestCurrent: () => boolean = () => true): Promise<void> {
    if (this.pending || this.calibrationPending) throw new ActivityError('BUSY', '上一轮采集或抽取尚未完成')
    if (!this.canExtract()) throw new ActivityError('SEMANTIC_CONSENT_REQUIRED', '请先允许所选模型处理聊天内容')
    const epoch = this.generation, signal = this.abort.signal
    const source = this.store.sourceMetadata(sourceId)
    this.pending = (async () => {
      await this.extractSource(source, signal, () => epoch === this.generation && requestCurrent())
      if (epoch !== this.generation || signal.aborted || !requestCurrent()) throw new ActivityError('CANCELLED', '设置或来源已变化，此次抽取已取消')
    })().finally(() => { this.pending = null })
    await this.pending
  }
  async importImage(encoded: string, requestCurrent: () => boolean): Promise<void> {
    if (this.pending || this.calibrationPending) throw new ActivityError('BUSY', '上一轮采集或 OCR 尚未完成')
    const imageMode = (this.store.config().extraction_mode || 'ocr') !== 'ocr'
    if (!imageMode && !this.recorder.ocrImage) throw new ActivityError('OCR_UNAVAILABLE', '当前系统未提供本地截图 OCR')
    const image = Buffer.from(encoded, 'base64'); if (image.toString('base64') !== encoded) throw new ActivityError('INVALID_IMAGE', '截图编码无效'); validatePng(image)
    const epoch = this.generation, signal = this.abort.signal
    this.pending = (async () => {
      const text = imageMode ? '' : await this.recorder.ocrImage!(image, languageOf(this.store.config()), signal)
      if (epoch !== this.generation || signal.aborted || !requestCurrent()) throw new ActivityError('CANCELLED', '页面或设置已变化，导入已取消')
      this.store.prune(this.now())
      // Explicit import is not proof of foreground app identity or message time.
      const source = this.store.addSource({ app_id: 'manual.screenshot', app_name: '用户导入截图（应用未核实）', window_title: '', origin: 'manual_import', captured_at: new Date(this.now()).toISOString(), ocr_text: text }, image)
      if (source && imageMode && this.canExtract()) await this.extractSource(source, signal, () => epoch === this.generation && requestCurrent())
      this.store.prune(this.now())
    })().finally(() => { this.pending = null })
    await this.pending
  }
  private async deliverReminders(): Promise<void> {
    for (const todo of this.store.dueReminders(this.now())) {
      if (!this.runtime.running) return
      const at = new Date(this.now()).toISOString()
      if (!this.store.claimReminder(todo.id, at)) continue
      try { await this.notify(todo); this.store.finishReminder(todo.id, at, 'submitted') }
      catch (error) { this.store.finishReminder(todo.id, at, error instanceof ActivityError && error.code === 'NOTIFICATION_UNKNOWN' ? 'unknown' : 'failed', '系统通知未获得成功回执；请在待办面板核对') }
    }
  }
  async handle(message: Record<string, unknown>, current: () => boolean = () => true): Promise<Record<string, unknown>> {
    const id = message.id
    try {
      if (!validateActivityMessage(message)) throw new ActivityError('INVALID_REQUEST', '活动请求无效')
      if (!current()) throw new ActivityError('SESSION_CLOSED', '原请求连接已关闭')
      if (this.stopping && message.type !== 'activity.state' && message.type !== 'activity.source') throw new ActivityError('SERVICE_STOPPED', '后台服务已停止，请重新连接')
      const now = new Date(this.now()).toISOString()
      switch (message.type) {
        case 'activity.state': break
        case 'activity.apps': {
          const apps = await this.listApps()
          if (!current()) throw new ActivityError('SESSION_CLOSED', '原请求连接已关闭')
          return { type: 'activity.result', id, ok: true, apps }
        }
        case 'activity.preview': return { type: 'activity.result', id, ok: true, preview: await this.preview(String(message.app_id), current) }
        case 'activity.preview_ocr': return { type: 'activity.result', id, ok: true, recognized_title: await this.previewOcr(String(message.image_base64), message.rect as ActivityRect, message.ocr_language as LocalLanguage, current) }
        case 'activity.configure': {
          const patch = { ...(message.patch as Partial<import('./types').ActivityConfig>) }
          const previous = this.store.config()
          const next = { ...previous, ...patch, dedicated_vision: patch.dedicated_vision ? { ...previous.dedicated_vision, ...patch.dedicated_vision, api_key: patch.dedicated_vision.api_key || previous.dedicated_vision?.api_key || '' } : previous.dedicated_vision }
          const changed = activityModelTarget(next).id !== activityModelTarget(previous).id
          if (patch.image_ai_enabled === true) {
            const target = activityModelTarget(next).id
            if (next.extraction_mode !== 'dedicated' && message.expected_model_target !== target) throw new ActivityError('MODEL_TARGET_CHANGED', '图像处理目标已变化，请重新打开设置核对并授权')
            patch.image_ai_consent = target
          }
          else if (changed || patch.image_ai_enabled === false) { patch.image_ai_enabled = false; patch.image_ai_consent = '' }
          this.store.configure(Number(message.expected_revision), patch); this.fence(); this.maintain(); break
        }
        case 'activity.import': await this.importImage(String(message.image_base64), current); break
        case 'activity.scan': await this.scan(current); break
        case 'activity.analyze': await this.analyze(String(message.source_id), current); break
        case 'activity.source': return { type: 'activity.result', id, ok: true, source: this.store.source(String(message.source_id)) }
        case 'activity.delete': this.fence(); this.store.deleteSources(message.source_id as string | undefined); break
        case 'todo.create': this.store.create(String(message.source_id), Number(message.expected_revision), message.task, now); break
        case 'todo.confirm': this.store.confirm(String(message.candidate_id), Number(message.expected_revision), message.task, now); break
        case 'todo.update': this.store.update(String(message.todo_id), Number(message.expected_revision), message.patch, now); break
        case 'todo.dismiss': this.store.dismiss(String(message.candidate_id), Number(message.expected_revision)); break
      }
      if (!current()) throw new ActivityError('SESSION_CLOSED', '原请求连接已关闭')
      return { type: 'activity.result', id, ok: true, state: this.state() }
    } catch (error) {
      const mayHaveSavedSource = message.type === 'activity.scan' || message.type === 'activity.import'
      return {
        type: 'activity.result', id, ok: false,
        error_code: error instanceof ActivityError ? error.code : 'ACTIVITY_FAILED',
        error: error instanceof ActivityError ? error.message : '活动请求失败，请刷新后重试',
        ...(mayHaveSavedSource && current() ? { state: this.state() } : {}),
      }
    }
  }
}
let singleton: ActivityService | undefined
export function getActivityService(): ActivityService { return singleton ??= new ActivityService({ dataDir: DATA_DIR }) }
export async function handleActivityMessage(message: Record<string, unknown>, context?: { service?: ActivityService; current?: () => boolean }): Promise<Record<string, unknown>> { return (context?.service ?? getActivityService()).handle(message, context?.current) }
