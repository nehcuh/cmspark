import { randomUUID } from 'node:crypto'
import { DATA_DIR } from '../config'
import { ActivityStore } from './store'
import { extractActivity, submitReminder, type RecorderAdapter, type FixedWindowSession, type CapturedWindow } from './adapters'
import { ActivityError, COVERAGE, type ActivityApp, type ActivityRecognition, type ActivityRuntime, type ActivitySource, type ActivityWireState, type PersonalTodo, type ActivityPreview, type ActivityRect } from './types'
import { createRecorder, platformSupport } from './platform'
import { languageOf, validatePng, type LocalLanguage } from './image'
import { ActivityScopeSkip, imageSize } from './chat-scope'
import { activityModelTarget, hasActivityImageConsent, recognitionTarget } from './model-config'
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
  private modelTail: Promise<void> | null = null
  private jobs = new Map<string, Promise<void>>()
  private calibrationPending: Promise<void> | null = null
  private automaticScan: { controller: AbortController | null; settled: Promise<unknown> } | null = null
  private reminders: Promise<void> | null = null
  private appListing: Promise<ActivityApp[]> | null = null
  private windows = new Map<string, FixedWindowSession>()
  private nextWindow = 0
  private generation = 0
  private abort = new AbortController()
  private modelAbort = new AbortController()
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
    this.runtime.fixed_window_supported = !!this.recorder.fixedWindowSupported
    this.runtime.fixed_window_status = {}
    this.extract = deps.extract ?? extractActivity
    this.extractImage = deps.extractImage
    this.notify = deps.notify ?? submitReminder
  }
  state(): ActivityWireState {
    const state = this.store.stateMetadata(), config = this.store.config(), target = activityModelTarget(config)
    state.config.image_ai_enabled = hasActivityImageConsent(config)
    const targets = (["ocr", "vision", "dedicated", "qwen"] as const).map(mode => [mode, activityModelTarget({ ...config, extraction_mode: mode })] as const)
    return { ...state, runtime: { ...this.runtime, fixed_window_status: { ...this.runtime.fixed_window_status }, ...(config.fixed_windows?.length ? { coverage: '仅记录已固定、完整可见且通过允许对话核对的窗口。失焦后仍会检查，最小化、遮挡和锁屏时暂停。' } : {}), model_target: target.label, model_target_id: target.id, model_targets: Object.fromEntries(targets.map(([mode, value]) => [mode, value.label])), model_target_ids: Object.fromEntries(targets.map(([mode, value]) => [mode, value.id])) } }
  }
  private canExtract(): boolean {
    const config = this.store.config()
    return (config.extraction_mode || 'ocr') === 'ocr' ? config.ocr_ai_enabled : hasActivityImageConsent(config)
  }
  private async extractSource(source: ActivitySource, signal: AbortSignal, current: () => boolean, localOnly: boolean): Promise<void> {
    const config = this.store.config(), target = activityModelTarget(config).id
    const imageMode = (config.extraction_mode || 'ocr') !== 'ocr'
    if (!localOnly && !this.canExtract()) throw new ActivityError(imageMode ? 'IMAGE_CONSENT_REQUIRED' : 'SEMANTIC_CONSENT_REQUIRED', '请核对处理目标并允许所选模型处理聊天内容')
    if (!imageMode) {
      if (!source.ocr_text.trim()) {
        if (!this.recorder.ocrImage) throw new ActivityError('OCR_UNAVAILABLE', '这张截图没有可用的本机识别文字')
        const data = this.store.source(source.id).image_data_url!
        const text = await this.recorder.ocrImage(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'), languageOf(config), signal)
        if (!current()) throw new ActivityError('CANCELLED', '识别已取消')
        if (!text.trim()) throw new ActivityError('OCR_EMPTY', '本机 OCR 未读到文字，可核对截图或调整识别语言后重试')
        source = this.store.saveVisualTranscript(source, text)
      }
      if (!current()) throw new ActivityError('CANCELLED', '处理目标或来源已变化')
      if (localOnly) {
        this.store.setRecognition(source.id, { status: 'saved', reason: '本机文字识别已完成，可授权模型抽取待办' })
        return
      }
      const entries = await this.extract(source, signal, config.extraction_prompt)
      if (!current() || signal.aborted) throw new ActivityError('CANCELLED', '设置或来源已变化，此次抽取已取消')
      this.store.addCandidates(source, entries, new Date(this.now()).toISOString())
      return
    }
    const data = this.store.source(source.id).image_data_url
    if (!data) throw new ActivityError('NOT_FOUND', '来源截图已清理')
    const extract = this.extractImage ?? (await import('./model-extract')).extractActivityImage
    if (!current()) throw new ActivityError('CANCELLED', '处理目标或来源已变化')
    this.store.sourceMetadata(source.id)
    const result = await extract(source, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'), config, this.store.root, signal, transcript => {
      if (!current()) throw new ActivityError('CANCELLED', '本次识别已取消')
      source = this.store.saveVisualTranscript(source, transcript)
    })
    if (!current() || signal.aborted || activityModelTarget(this.store.config()).id !== target || !this.canExtract()) throw new ActivityError('CANCELLED', '处理目标或来源已变化，此次抽取已取消')
    const updated = this.store.saveVisualTranscript(source, result.transcript)
    this.store.addCandidates(updated, result.entries, new Date(this.now()).toISOString())
  }
  private initialRecognition(automatic: boolean, extract: boolean, hasText: boolean): ActivityRecognition {
    const config = this.store.config()
    if ((config.extraction_mode || 'ocr') === 'ocr' && !hasText)
      return { status: 'saved', reason: '本机 OCR 未读到文字，可调整语言后重试' }
    if (!this.canExtract()) return { status: 'saved', reason: '等待授权所选模型处理聊天内容' }
    if (!extract) return { status: 'saved', reason: '文字已保存在本机，可手动抽取待办' }
    return { status: 'queued', target: recognitionTarget(config), automatic }
  }

  private recognize(sourceId: string, target: string, requestCurrent: () => boolean): Promise<void> {
    const existing = this.jobs.get(sourceId)
    if (existing) return existing
    const signal = this.modelAbort.signal
    const localOnly = target === 'local-ocr'
    const current = () => !signal.aborted && requestCurrent() && (localOnly
      ? (this.store.config().extraction_mode || 'ocr') === 'ocr'
      : this.canExtract() && recognitionTarget(this.store.config()) === target)
    const work = async () => {
      let started = false
      try {
        if (!current()) throw new ActivityError('CANCELLED', '设置、处理目标或来源已变化，请核对后重试')
        const source = this.store.sourceMetadata(sourceId)
        const receipt = source.recognition
        if (receipt?.status !== 'queued' || receipt.target !== target) throw new ActivityError('CANCELLED', '此项识别已取消')
        this.store.setRecognition(sourceId, { ...receipt, status: 'running' })
        started = true
        await this.extractSource(source, signal, current, localOnly)
      } catch (error) {
        const failure = error instanceof ActivityError ? error : new ActivityError('EXTRACTION_FAILED', '识别失败，请核对模型服务、输出格式后重试')
        // Unclaimed automatic work survives a clean shutdown. In-flight delivery is ambiguous.
        if (!this.stopping || started) this.store.setRecognition(sourceId, { status: 'failed', code: failure.code, reason: failure.message, completed_at: new Date(this.now()).toISOString() })
        throw failure
      }
    }
    const job = this.modelTail ? this.modelTail.then(work, work) : work()
    const done = job.finally(() => {
      this.jobs.delete(sourceId)
      if (this.modelTail === done) this.modelTail = null
    })
    this.jobs.set(sourceId, done)
    this.modelTail = done
    // Automatic requests have no waiting UI. Their failure is durable on the source.
    void done.catch(() => {})
    return done
  }

  private resumeRecognition(): void {
    for (const id of this.store.unfinishedRecognition()) {
      const source = this.store.sourceMetadata(id), receipt = source.recognition
      const config = this.store.config()
      if (receipt?.status === 'queued' && receipt.automatic && config.enabled && config.allowed_apps.includes(source.app_id)) {
        void this.recognize(id, receipt.target, () => true)
      } else {
        this.store.setRecognition(id, { status: 'failed', code: 'INTERRUPTED', reason: '上次识别已中断，请重试', completed_at: new Date(this.now()).toISOString() })
      }
    }
  }
  start(): void {
    if (this.timer) return
    this.stopping = false; this.runtime.running = true; this.runtime.status = 'idle'; this.lastMaintenance = null
    this.maintain()
    this.resumeRecognition()
    this.timer = setInterval(() => { void this.tick().catch(() => { this.runtime.error ??= '后台活动服务失败，请重试'; this.runtime.status = 'error' }) }, 1000)
    this.timer.unref()
    void this.tick().catch(() => { this.runtime.status = 'error'; this.runtime.error ??= '后台活动服务失败，请重试' })
  }
  private fence(cancelRecognition = true): void {
    this.generation++
    this.abort.abort()
    this.abort = new AbortController()
    if (cancelRecognition) {
      this.modelAbort.abort()
      this.modelAbort = new AbortController()
    }
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    for (const session of this.windows.values()) session.close()
    this.windows.clear()
    this.timer = null; this.stopping = true; this.runtime.running = false; this.fence()
    await Promise.allSettled([this.pending, this.calibrationPending, this.reminders, this.appListing, this.modelTail])
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
    const generation = this.generation
    const checks = Math.max(1, config.fixed_windows?.filter(w => !w.paused).length || 0)
    for (let i = 0; i < checks; i++) {
      if (generation !== this.generation || !this.runtime.running || this.calibrationPending) break
      await this.runScan(() => true, true)
    }
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
  private async bindWindow(appId: string, bindingId: string | undefined, current: () => boolean): Promise<void> {
    if (!this.recorder.fixedWindowSupported || !this.recorder.pickWindow) throw new ActivityError('UNSUPPORTED_PLATFORM', '此设备不支持系统固定选窗')
    const config = this.store.config(), bindings = config.fixed_windows || []
    if (!config.allowed_apps.includes(appId) || !config.chat_scopes?.some(scope => scope.app_id === appId && scope.profiles.length))
      throw new ActivityError('SCOPE_REQUIRED', '请先保存此应用的允许对话与消息区域')
    if (bindingId ? !bindings.some(w => w.id === bindingId && w.app_id === appId) : bindings.length >= 8)
      throw new ActivityError('INVALID_REQUEST', '窗口绑定已变化或已达 8 个上限')
    let selected: FixedWindowSession | undefined
    try {
      await this.calibration(current, async signal => { selected = await this.recorder.pickWindow!(appId, signal) })
      if (!selected || !current() || JSON.stringify(config) !== JSON.stringify(this.store.config())) throw new ActivityError('CANCELLED', '选窗期间设置已变化，请重新选择')
      if ([...this.windows].some(([id, win]) => id !== bindingId && win.identity === selected!.identity)) throw new ActivityError('DUPLICATE_WINDOW', '此窗口已经固定')
      const id = bindingId || randomUUID()
      this.store.configure(this.store.revision(), { fixed_windows: [...bindings.filter(w => w.id !== id), { id, app_id: appId, title: selected.title }] })
      this.windows.get(id)?.close()
      this.windows.set(id, selected)
      selected = undefined
      this.runtime.fixed_window_status![id] = { status: '已绑定' }
      this.fence()
    } finally { selected?.close() }
  }
  private pauseWindow(id: string, paused: boolean): void {
    const windows = this.store.config().fixed_windows || []
    if (!windows.some(w => w.id === id)) throw new ActivityError('NOT_FOUND', '固定窗口已移除')
    this.store.configure(this.store.revision(), { fixed_windows: windows.map(w => w.id === id ? { ...w, paused } : w) })
    this.fence()
  }
  private unbindWindow(id: string): void {
    const bindings = this.store.config().fixed_windows || []
    if (!bindings.some(window => window.id === id)) throw new ActivityError('NOT_FOUND', '固定窗口已移除')
    const remaining = bindings.filter(window => window.id !== id)
    // Returning to the broader foreground mode requires a separate explicit start.
    this.store.configure(this.store.revision(), { fixed_windows: remaining, ...(!remaining.length ? { enabled: false } : {}) })
    this.fence()
    this.windows.get(id)?.close()
    this.windows.delete(id)
    delete this.runtime.fixed_window_status![id]
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
      return { app_id: frame.app_id, app_name: frame.app_name, window_title: frame.window_title, window_class: frame.window_class, ...(frame.logical_width && frame.logical_height ? { logical_width: frame.logical_width, logical_height: frame.logical_height } : {}), ...size, image_data_url: 'data:image/png;base64,' + frame.image.toString('base64') }
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
    let recognition: Promise<void> | undefined
    const windows = (config.fixed_windows || []).filter(w => !w.paused)
    if (config.fixed_windows?.length && !windows.length) {
      this.runtime.status = 'fixed_windows_paused'
      this.runtime.scanning = false
      return
    }
    const binding = windows.length ? windows[this.nextWindow++ % windows.length] : undefined
    this.pending = (async () => {
      try {
        this.store.prune(this.now())
        const captureSignal = controller ? AbortSignal.any([signal, controller.signal]) : signal
        // Title OCR still gates the captured region. Body OCR reads the saved region on the worker.
        const deferBodyOcr = (config.extraction_mode || 'ocr') === 'ocr' && !!this.recorder.ocrImage
        const captureConfig = deferBodyOcr ? { ...config, extraction_mode: 'vision' as const } : config
        let capturing: Promise<CapturedWindow | null>
        if (binding) {
          this.runtime.fixed_window_status![binding.id] = { ...this.runtime.fixed_window_status![binding.id], status: '检查中', last_checked_at: this.runtime.last_scan_at! }
          const session = this.windows.get(binding.id)
          if (!session) throw new ActivityError('WINDOW_CLOSED', '请重新选择固定窗口')
          if (!config.allowed_apps.includes(binding.app_id) || !config.chat_scopes?.some(scope => scope.app_id === binding.app_id && scope.profiles.length))
            throw new ActivityError('SCOPE_REQUIRED', '请重新核对并保存此窗口的应用授权与聊天范围')
          capturing = session.capture(captureConfig, captureSignal)
        } else capturing = this.recorder.capture(captureConfig, captureSignal)
        const automaticScan = controller ? { controller, settled: capturing } : null
        this.automaticScan = automaticScan
        const capture = await capturing
        if (controller?.signal.aborted) return
        if (this.automaticScan) this.automaticScan.controller = null
        if (!current() || !capture) { if (current()) this.runtime.status = 'no_visible_allowed_window'; return }
        if (binding && (capture.app_id !== binding.app_id || !capture.conversation_title)) throw new ActivityError('SCOPE_REQUIRED', '固定窗口身份或聊天范围未能核实')
        const receipt: ActivityRecognition = deferBodyOcr && !capture.ocr_text.trim()
          ? { status: 'queued', target: this.canExtract() ? recognitionTarget(config) : 'local-ocr', automatic }
          : this.initialRecognition(automatic, true, !!capture.ocr_text.trim())
        const source = this.store.addSource({ recognition: receipt, ...(binding ? { binding_id: binding.id } : {}), app_id: capture.app_id, app_name: capture.app_name, window_title: capture.window_title, ...(capture.conversation_title ? { conversation_title: capture.conversation_title } : {}), origin: binding ? 'fixed_window' : 'foreground', ocr_text: capture.ocr_text, captured_at: new Date(this.now()).toISOString() }, capture.image)
        if (!current()) return
        if (binding) {
          const previous = this.runtime.fixed_window_status![binding.id]
          this.runtime.fixed_window_status![binding.id] = { ...previous, status: source ? '已保存' : '画面重复', reason: undefined, display: capture.display, ...(source ? { last_saved_at: source.captured_at } : {}) }
        }
        if (source) this.runtime.last_success_at = source.captured_at
        this.runtime.status = source ? 'captured' : 'unchanged'
        if (source && receipt.status === 'queued') recognition = this.recognize(source.id, receipt.target, requestCurrent)
        if (current()) this.store.prune(this.now())
      } catch (error) {
        if (controller?.signal.aborted) return
        if (binding && current()) {
          const reason = error instanceof ActivityError ? error.message : '窗口检查失败，请重新测试'
          this.runtime.fixed_window_status![binding.id] = { ...this.runtime.fixed_window_status![binding.id], status: '已跳过', reason }
          if (error instanceof ActivityError && error.code === 'WINDOW_CLOSED') {
            this.windows.get(binding.id)?.close()
            this.windows.delete(binding.id)
          }
          this.runtime.status = 'fixed_window_skipped'; this.runtime.scope_note = reason
          return
        }
        if (current() && error instanceof ActivityScopeSkip) { this.runtime.status = error.status; this.runtime.scope_note = error.message; this.runtime.error = null; return }
        if (current()) { this.runtime.status = 'error'; this.runtime.error = error instanceof ActivityError ? error.message : '本轮采集或语义抽取失败，已保存的记录仍可查看'; throw error instanceof ActivityError ? error : new ActivityError('CAPTURE_OR_EXTRACTION_FAILED', this.runtime.error) }
      } finally {
        this.runtime.scanning = false
        if (controller?.signal.aborted && this.runtime.status === 'scanning') this.runtime.status = 'idle'
      }
    })().finally(() => { this.pending = null; this.automaticScan = null })
    await this.pending
    if (!automatic) await recognition
  }
  async analyze(sourceId: string, requestCurrent: () => boolean = () => true, queueOnly = false): Promise<void> {
    const source = this.store.sourceMetadata(sourceId)
    const localOnly = !this.canExtract() && (this.store.config().extraction_mode || 'ocr') === 'ocr' &&
      !source.ocr_text.trim() && !!this.recorder.ocrImage
    if (!localOnly && !this.canExtract()) throw new ActivityError('SEMANTIC_CONSENT_REQUIRED', '请先允许所选模型处理聊天内容')
    const job = this.jobs.get(sourceId)
    if (job) { if (!queueOnly) await job; return }
    const target = localOnly ? 'local-ocr' : recognitionTarget(this.store.config())
    this.store.setRecognition(sourceId, { status: 'queued', target })
    const result = this.recognize(sourceId, target, queueOnly ? () => true : requestCurrent)
    if (!queueOnly) await result
  }
  async importImage(encoded: string, requestCurrent: () => boolean): Promise<void> {
    if (this.pending || this.calibrationPending) throw new ActivityError('BUSY', '上一轮采集或 OCR 尚未完成')
    const imageMode = (this.store.config().extraction_mode || 'ocr') !== 'ocr'
    const image = Buffer.from(encoded, 'base64'); if (image.toString('base64') !== encoded) throw new ActivityError('INVALID_IMAGE', '截图编码无效'); validatePng(image)
    const epoch = this.generation, signal = this.abort.signal
    let recognition: Promise<void> | undefined
    this.pending = (async () => {
      let text = '', failure: ActivityError | undefined
      if (!imageMode) {
        try {
          if (!this.recorder.ocrImage) throw new ActivityError('OCR_UNAVAILABLE', '当前系统未提供本地截图 OCR')
          text = await this.recorder.ocrImage(image, languageOf(this.store.config()), signal)
          if (!text.trim()) throw new ActivityError('OCR_EMPTY', '本机 OCR 未读到文字，可核对原图或调整语言后重试')
        } catch (error) {
          failure = error instanceof ActivityError ? error : new ActivityError('OCR_FAILED', '本机 OCR 失败，请核对语言与识别服务后重试')
        }
      }
      if (epoch !== this.generation || signal.aborted || !requestCurrent()) throw new ActivityError('CANCELLED', '页面或设置已变化，导入已取消')
      this.store.prune(this.now())
      // Explicit import is not proof of foreground app identity or message time.
      const receipt: ActivityRecognition = failure
        ? { status: 'failed', code: failure.code, reason: failure.message, completed_at: new Date(this.now()).toISOString() }
        : this.initialRecognition(false, imageMode, !!text.trim())
      const source = this.store.addSource({ recognition: receipt, app_id: 'manual.screenshot', app_name: '用户导入截图（应用未核实）', window_title: '', origin: 'manual_import', captured_at: new Date(this.now()).toISOString(), ocr_text: text }, image)
      if (source && receipt.status === 'queued') recognition = this.recognize(source.id, receipt.target, requestCurrent)
      this.store.prune(this.now())
      if (failure) throw failure
    })().finally(() => { this.pending = null })
    await this.pending
    await recognition
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
        case 'activity.bind_window': await this.bindWindow(String(message.app_id), message.binding_id as string | undefined, current); break
        case 'activity.pause_window': this.pauseWindow(String(message.binding_id), message.paused === true); break
        case 'activity.unbind_window': this.unbindWindow(String(message.binding_id)); break
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
          const cancelRecognition = this.store.configure(Number(message.expected_revision), patch)
          this.fence(cancelRecognition)
          for (const binding of previous.fixed_windows || []) {
            if (!next.allowed_apps.includes(binding.app_id) || !next.chat_scopes?.some(s => s.app_id === binding.app_id && s.profiles.length)) {
              this.windows.get(binding.id)?.close()
              this.windows.delete(binding.id)
              this.runtime.fixed_window_status![binding.id] = { status: '需要重新授权并选窗' }
            }
          }
          this.maintain()
          break
        }
        case 'activity.import': await this.importImage(String(message.image_base64), current); break
        case 'activity.scan': await this.scan(current); break
        case 'activity.analyze': await this.analyze(String(message.source_id), current, message.queue_only === true); break
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
      const mayHaveSavedSource = message.type === 'activity.scan' || message.type === 'activity.import' || message.type === 'activity.analyze'
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
