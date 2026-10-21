import { DATA_DIR } from '../config'
import { ActivityStore } from './store'
import { MacPassiveRecorder, extractActivity, submitReminder, type RecorderAdapter, type ExtractedCandidate } from './adapters'
import { ActivityError, COVERAGE, type ActivityApp, type ActivityRuntime, type ActivitySource, type ActivityWireState, type PersonalTodo } from './types'
import { validateActivityMessage } from './validation'
export interface ActivityDependencies {
  dataDir: string
  platform?: string
  now?: () => number
  recorder?: RecorderAdapter
  extract?: (source: ActivitySource, signal: AbortSignal) => Promise<ExtractedCandidate[]>
  notify?: (todo: PersonalTodo) => Promise<void>
}
export class ActivityService {
  readonly store: ActivityStore
  private runtime: ActivityRuntime
  private now: () => number
  private recorder: RecorderAdapter
  private extract: NonNullable<ActivityDependencies['extract']>
  private notify: NonNullable<ActivityDependencies['notify']>
  private timer: NodeJS.Timeout | null = null
  private pending: Promise<void> | null = null
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
    this.runtime = { platform, supported: platform === 'darwin', running: false, scanning: false, last_scan_at: null, last_success_at: null, status: 'stopped', error: null, coverage: COVERAGE }
    this.now = deps.now ?? Date.now
    this.recorder = deps.recorder ?? new MacPassiveRecorder(this.store.root)
    this.extract = deps.extract ?? extractActivity
    this.notify = deps.notify ?? submitReminder
  }
  state(): ActivityWireState { const state = this.store.state(); return { ...state, sources: state.sources.map(({ ocr_text: _privateText, ...source }) => source), runtime: { ...this.runtime } } }
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
    await Promise.allSettled([this.pending, this.reminders, this.appListing])
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
    if (this.pending || !config.enabled || !this.runtime.supported || this.now() - this.lastPoll < config.interval_ms) return
    await this.scan()
  }
  private async listApps(): Promise<ActivityApp[]> {
    if (!this.runtime.supported || !this.recorder.listApps) throw new ActivityError('UNSUPPORTED_PLATFORM', '当前运行应用选择仅支持 macOS')
    if (!this.appListing) this.appListing = this.recorder.listApps(this.abort.signal).finally(() => { this.appListing = null })
    return this.appListing
  }
  async scan(requestCurrent: () => boolean = () => true): Promise<void> {
    if (this.pending) throw new ActivityError('BUSY', '上一轮采集尚未完成')
    const config = this.store.config()
    if (!config.enabled) throw new ActivityError('RECORDING_DISABLED', '请先选择应用并明确开启记录')
    if (!this.runtime.supported) throw new ActivityError('UNSUPPORTED_PLATFORM', '当前活动截图仅支持 macOS')
    if (!config.allowed_apps.length) throw new ActivityError('NO_ALLOWED_APPS', '请先设置采集应用白名单')
    const epoch = this.generation, signal = this.abort.signal
    this.lastPoll = this.now(); this.runtime.scanning = true; this.runtime.status = 'scanning'; this.runtime.error = null
    this.runtime.last_scan_at = new Date(this.now()).toISOString()
    const current = (): boolean => epoch === this.generation && !signal.aborted && requestCurrent()
    this.pending = (async () => {
      try {
        this.store.prune(this.now())
        const capture = await this.recorder.capture(config, signal)
        if (!current() || !capture) { if (current()) this.runtime.status = 'no_visible_allowed_window'; return }
        const source = this.store.addSource({ app_id: capture.app_id, app_name: capture.app_name, window_title: capture.window_title, ocr_text: capture.ocr_text, captured_at: new Date(this.now()).toISOString() }, capture.image)
        if (!current()) return
        this.runtime.last_success_at = new Date(this.now()).toISOString()
        this.runtime.status = source ? 'captured' : 'unchanged'
        if (source && config.ocr_ai_enabled && source.ocr_text.trim()) {
          const entries = await this.extract(source, signal)
          if (!current()) return
          this.store.addCandidates(source, entries)
          this.runtime.status = 'ready_for_review'
        }
        if (current()) this.store.prune(this.now())
      } catch (error) {
        if (current()) { this.runtime.status = 'error'; this.runtime.error = error instanceof ActivityError ? error.message : '本轮采集或语义抽取失败，已保存的记录仍可查看'; throw error instanceof ActivityError ? error : new ActivityError('CAPTURE_OR_EXTRACTION_FAILED', this.runtime.error) }
      } finally { this.runtime.scanning = false }
    })().finally(() => { this.pending = null })
    await this.pending
  }
  async analyze(sourceId: string, requestCurrent: () => boolean = () => true): Promise<void> {
    if (this.pending) throw new ActivityError('BUSY', '上一轮采集或抽取尚未完成')
    if (!this.store.config().ocr_ai_enabled) throw new ActivityError('SEMANTIC_CONSENT_REQUIRED', '请先明确允许将 OCR 文本发送给已配置的语义模型')
    const epoch = this.generation, signal = this.abort.signal
    const source = this.store.sourceMetadata(sourceId)
    this.pending = (async () => {
      const entries = await this.extract(source, signal)
      if (epoch !== this.generation || signal.aborted || !requestCurrent()) throw new ActivityError('CANCELLED', '设置或来源已变化，此次抽取已取消')
      this.store.addCandidates(source, entries)
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
        case 'activity.configure': this.store.configure(Number(message.expected_revision), message.patch); this.fence(); this.maintain(); break
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
    } catch (error) { return { type: 'activity.result', id, ok: false, error_code: error instanceof ActivityError ? error.code : 'ACTIVITY_FAILED', error: error instanceof ActivityError ? error.message : '活动请求失败，请刷新后重试' } }
  }
}
let singleton: ActivityService | undefined
export function getActivityService(): ActivityService { return singleton ??= new ActivityService({ dataDir: DATA_DIR }) }
export async function handleActivityMessage(message: Record<string, unknown>, context?: { service?: ActivityService; current?: () => boolean }): Promise<Record<string, unknown>> { return (context?.service ?? getActivityService()).handle(message, context?.current) }
