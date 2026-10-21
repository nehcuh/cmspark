import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import { ActivityError, DEFAULT_ACTIVITY_CONFIG, type ActivityConfig, type ActivityState, type ActivitySource, type PersonalTodo, type TodoCandidate, type TaskEvidence } from './types'
import { iso, validateConfig, validateTask } from './validation'
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const digest = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex')
export class ActivityStore {
  private value: ActivityState
  readonly root: string
  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'personal-activity')
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 })
    if (fs.lstatSync(this.root).isSymbolicLink()) throw new ActivityError('UNSAFE_STORAGE', '活动目录不能是符号链接')
    fs.chmodSync(this.root, 0o700)
    this.value = { version: 1, revision: 0, config: { ...DEFAULT_ACTIVITY_CONFIG, allowed_apps: [] }, sources: [], candidates: [], todos: [] }
    const file = path.join(this.root, 'state.json')
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new ActivityError('CORRUPT_STORAGE', '活动存储不可读')
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as ActivityState
      if (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || !Array.isArray(saved.sources) || !Array.isArray(saved.candidates) || !Array.isArray(saved.todos) || saved.sources.length > 2000 || saved.todos.length > 3000 || saved.candidates.length > 3000) throw new ActivityError('CORRUPT_STORAGE', '活动存储版本或结构无效')
      validateConfig(saved.config)
      this.value = saved
      // A crash between durable claim and callback cannot prove notification delivery.
      if (saved.todos.some(t => t.reminder.status === 'attempting')) this.mutate(s => { for (const t of s.todos) if (t.reminder.status === 'attempting') { t.reminder.status = 'unknown'; t.revision++ } })
    }
    // No pending capture survives startup. Such files were never committed provenance.
    for (const name of fs.readdirSync(this.root)) {
      const orphan = /^[a-f0-9-]{36}\.png$/.test(name) && !this.value.sources.some(s => `${s.id}.png` === name)
      if (/^pending-[a-f0-9-]+\.png$/.test(name) || /^state-[a-f0-9-]{36}\.tmp$/.test(name) || orphan) fs.rmSync(path.join(this.root, name), { force: true })
    }
  }
  state(): ActivityState { return clone(this.value) }
  /** Scheduler reads must not serialize retained screenshots' OCR every second. */
  config(): ActivityConfig { return clone(this.value.config) }
  dueReminders(now: number): PersonalTodo[] {
    return clone(this.value.todos.filter(todo =>
      todo.reminder.status === 'scheduled' && todo.remind_at !== null &&
      Date.parse(todo.remind_at) <= now &&
      (todo.handling_status !== 'done' || todo.feedback_status === 'pending'),
    ))
  }
  private mutate(action: (s: ActivityState) => void): void {
    const next = clone(this.value)
    action(next); next.revision++
    const bytes = JSON.stringify(next)
    if (Buffer.byteLength(bytes) > 16 * 1024 * 1024) throw new ActivityError('QUOTA_EXCEEDED', '活动元数据已达上限，请清理记录')
    const pending = path.join(this.root, `state-${randomUUID()}.tmp`)
    try {
      const fd = fs.openSync(pending, 'wx', 0o600)
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(pending, path.join(this.root, 'state.json'))
      this.value = next
    } finally { fs.rmSync(pending, { force: true }) }
  }
  configure(revision: number, patch: unknown): void {
    validateConfig(patch)
    if (revision !== this.value.revision) throw new ActivityError('REVISION_CONFLICT', '活动设置已变化，请刷新后重试')
    this.mutate(s => { Object.assign(s.config, patch); s.config.allowed_apps = [...new Set(s.config.allowed_apps)] })
  }
  addSource(input: Omit<ActivitySource, 'id' | 'bytes' | 'sha256'>, image: Buffer): ActivitySource | null {
    if (image.length === 0 || image.length > 16 * 1024 * 1024) throw new ActivityError('QUOTA_EXCEEDED', '截图大小不合适')
    const sha256 = digest(image)
    const same = this.value.sources.find(s => !s.deleted && s.app_id === input.app_id && s.window_title === input.window_title && (s.sha256 === sha256 || s.ocr_text === input.ocr_text))
    if (same) return null
    if (this.value.sources.length >= 2000) throw new ActivityError('QUOTA_EXCEEDED', '活动记录数已达上限')
    const source: ActivitySource = { ...input, id: randomUUID(), bytes: image.length, sha256 }
    const file = this.imagePath(source.id)
    fs.writeFileSync(file, image, { flag: 'wx', mode: 0o600 })
    try { this.mutate(s => { s.sources.unshift(source) }) } catch (e) { fs.rmSync(file, { force: true }); throw e }
    return clone(source)
  }
  addCandidates(source: ActivitySource, entries: Array<Omit<TodoCandidate, 'id' | 'revision' | 'created_at' | 'status'>>): void {
    const canonical = this.value.sources.find(s => s.id === source.id)
    if (!canonical || canonical.sha256 !== source.sha256 || canonical.ocr_text !== source.ocr_text) throw new ActivityError('SOURCE_EXPIRED', '来源已清理，本次抽取结果不再接纳')
    this.mutate(s => {
      for (const item of entries.slice(0, 12)) {
        if (s.candidates.length >= 3000) break
        // Dedupe across overlapping captures, but never across different group/sender anchors.
        const key = (e: TaskEvidence) => digest([e.app_id, e.group, e.sender, e.message_time, e.quote.replace(/\s+/g, '')].join('\n'))
        if (s.candidates.some(c => key(c.evidence) === key(item.evidence))) continue
        s.candidates.unshift({ ...item, id: randomUUID(), revision: 0, created_at: source.captured_at, status: 'pending' })
      }
    })
  }
  confirm(id: string, revision: number, task: unknown, now: string): PersonalTodo {
    const patch = validateTask(task, true)
    const candidate = this.value.candidates.find(c => c.id === id)
    if (!candidate) throw new ActivityError('NOT_FOUND', '候选已删除')
    // A repeated confirmation returns the original identity; it can never create two tasks.
    if (candidate.status === 'confirmed') return clone(this.value.todos.find(t => t.id === candidate.todo_id)!)
    if (candidate.status !== 'pending' || candidate.revision !== revision) throw new ActivityError('REVISION_CONFLICT', '候选已变化，请刷新')
    if (this.value.todos.length >= 3000) throw new ActivityError('QUOTA_EXCEEDED', '待办数已达上限')
    const feedback = typeof patch.feedback_required === 'boolean' ? patch.feedback_required : candidate.feedback_required
    const remind_at = patch.remind_at === undefined ? null : iso(patch.remind_at)
    const todo: PersonalTodo = {
      id: randomUUID(), revision: 0, created_at: now, updated_at: now,
      title: String(patch.title).trim(), owner: String(patch.owner).trim(), due_at: patch.due_at === undefined ? candidate.due_at : iso(patch.due_at), remind_at,
      feedback_to: typeof patch.feedback_to === 'string' ? patch.feedback_to.trim() : candidate.feedback_to, feedback_required: feedback,
      kind: patch.kind === 'supervise' ? 'supervise' : 'own', handling_status: 'open', feedback_status: feedback ? 'pending' : 'not_required', evidence: clone(candidate.evidence), reminder: { status: remind_at ? 'scheduled' : 'none' },
    }
    this.mutate(s => { s.todos.unshift(todo); const c = s.candidates.find(c => c.id === id)!; c.status = 'confirmed'; c.todo_id = todo.id; c.revision++ })
    return clone(todo)
  }
  create(sourceId: string, revision: number, input: unknown, now: string): PersonalTodo {
    const patch = validateTask(input, true)
    if (this.value.revision !== revision) throw new ActivityError('REVISION_CONFLICT', '活动记录已变化，请刷新')
    const source = this.value.sources.find(s => s.id === sourceId)
    if (!source) throw new ActivityError('NOT_FOUND', '来源已删除')
    if (this.value.todos.length >= 3000) throw new ActivityError('QUOTA_EXCEEDED', '待办数已达上限')
    const feedback = patch.feedback_required === true
    const remind_at = patch.remind_at === undefined ? null : iso(patch.remind_at)
    const todo: PersonalTodo = {
      id: randomUUID(), revision: 0, created_at: now, updated_at: now,
      title: String(patch.title).trim(), owner: String(patch.owner).trim(), due_at: patch.due_at === undefined ? null : iso(patch.due_at), remind_at,
      feedback_to: typeof patch.feedback_to === 'string' ? patch.feedback_to.trim() : '', feedback_required: feedback,
      kind: patch.kind === 'supervise' ? 'supervise' : 'own', handling_status: 'open', feedback_status: feedback ? 'pending' : 'not_required',
      evidence: { source_id: source.id, app_id: source.app_id, group: '', sender: '', message_time: '', quote: source.ocr_text.slice(0, 2000) },
      reminder: { status: remind_at ? 'scheduled' : 'none' },
    }
    this.mutate(s => { s.todos.unshift(todo) })
    return clone(todo)
  }
  update(id: string, revision: number, input: unknown, now: string): void {
    const patch = validateTask(input)
    const current = this.value.todos.find(t => t.id === id)
    if (!current) throw new ActivityError('NOT_FOUND', '待办不存在')
    if (current.revision !== revision) throw new ActivityError('REVISION_CONFLICT', '待办已变化，请刷新')
    this.mutate(s => {
      const t = s.todos.find(t => t.id === id)!
      const previousReminderAt = t.remind_at === null ? null : iso(t.remind_at)
      Object.assign(t, patch)
      if (patch.due_at !== undefined) t.due_at = iso(patch.due_at)
      if (patch.remind_at !== undefined) {
        t.remind_at = iso(patch.remind_at)
        // Full-form saves and equivalent timezone encodings are not a request to notify again.
        if (t.remind_at !== previousReminderAt) t.reminder = { status: t.remind_at ? 'scheduled' : 'none' }
      }
      if (patch.feedback_required === false) t.feedback_status = 'not_required'
      if (patch.feedback_required === true && t.feedback_status === 'not_required') t.feedback_status = 'pending'
      if (t.feedback_required && t.feedback_status === 'not_required') throw new ActivityError('INVALID_REQUEST', '需反馈事项不能设为无需反馈')
      t.updated_at = now; t.revision++
    })
  }
  dismiss(id: string, revision: number): void {
    this.mutate(s => { const c = s.candidates.find(c => c.id === id); if (!c) throw new ActivityError('NOT_FOUND', '候选不存在'); if (c.revision !== revision || c.status !== 'pending') throw new ActivityError('REVISION_CONFLICT', '候选已变化'); c.status = 'dismissed'; c.revision++ })
  }
  private imagePath(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new ActivityError('INVALID_REQUEST', '来源身份无效')
    return path.join(this.root, `${id}.png`)
  }
  sourceMetadata(id: string): ActivitySource {
    const source = this.value.sources.find(s => s.id === id)
    if (!source) throw new ActivityError('NOT_FOUND', '来源不存在')
    return clone(source)
  }
  source(id: string): ActivitySource & { image_data_url: string | null } {
    const source = this.sourceMetadata(id)
    let image_data_url: string | null = null
    const file = this.imagePath(id)
    if (!source.deleted && fs.existsSync(file)) {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new ActivityError('UNSAFE_STORAGE', '来源文件不可读')
      const image = fs.readFileSync(file)
      if (image.length !== source.bytes || digest(image) !== source.sha256) throw new ActivityError('CORRUPT_STORAGE', '来源截图校验失败')
      image_data_url = `data:image/png;base64,${image.toString('base64')}`
    }
    return { ...clone(source), image_data_url }
  }
  deleteSources(id?: string): void {
    this.deleteSourceIds(new Set(this.value.sources.filter(s => id === undefined || s.id === id).map(s => s.id)))
  }
  private deleteSourceIds(ids: Set<string>): void {
    if (!ids.size) return
    // One atomic state update, even when all 2,000 retained sources expire together.
    this.mutate(s => {
      s.sources = s.sources.filter(source => !ids.has(source.id))
      s.candidates = s.candidates.filter(c => !ids.has(c.evidence.source_id))
      for (const t of s.todos) if (ids.has(t.evidence.source_id)) { t.evidence.quote = ''; t.evidence.group = ''; t.evidence.sender = ''; t.evidence.message_time = ''; t.revision++ }
    })
    for (const sourceId of ids) fs.rmSync(this.imagePath(sourceId), { force: true })
  }
  prune(now: number): void {
    const s = this.value
    const cutoff = now - s.config.retention_days * 86400000
    let bytes = s.sources.reduce((n, source) => n + source.bytes, 0)
    let retained = s.sources.length
    const ids = new Set<string>()
    for (let index = s.sources.length - 1; index >= 0; index--) {
      const source = s.sources[index]
      if (Date.parse(source.captured_at) <= cutoff || bytes > s.config.max_storage_mb * 1024 * 1024 || retained >= 2000) {
        ids.add(source.id); bytes -= source.bytes; retained--
      }
    }
    this.deleteSourceIds(ids)
  }
  claimReminder(id: string, now: string): boolean {
    const t = this.value.todos.find(t => t.id === id)
    if (!t || t.reminder.status !== 'scheduled' || !t.remind_at || Date.parse(t.remind_at) > Date.parse(now) || (t.handling_status === 'done' && t.feedback_status !== 'pending')) return false
    this.mutate(s => { const target = s.todos.find(t => t.id === id)!; target.reminder = { status: 'attempting', attempted_at: now }; target.revision++ })
    return true
  }
  finishReminder(id: string, attemptedAt: string, status: 'submitted' | 'failed' | 'unknown', error?: string): void {
    this.mutate(s => { const t = s.todos.find(t => t.id === id); if (t?.reminder.status === 'attempting' && t.reminder.attempted_at === attemptedAt) { t.reminder.status = status; if (error) t.reminder.error = error; t.revision++ } })
  }
}
