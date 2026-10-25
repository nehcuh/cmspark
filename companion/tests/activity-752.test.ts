import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ActivityStore } from '../src/activity/store'
import { ActivityService } from '../src/activity/service'
import { parseExtractedCandidates, MacPassiveRecorder } from '../src/activity/adapters'
import { validateActivityMessage } from '../src/activity/validation'
import { ActivityError, DEFAULT_ACTIVITY_CONFIG, type ActivitySource } from '../src/activity/types'
const NOW = Date.parse('2026-10-21T10:00:00Z')
const stamp = new Date(NOW).toISOString()
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-activity-test-'))
  return { dir, store: new ActivityStore(dir), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
function addSource(store: ActivityStore) {
  return store.addSource({ captured_at: stamp, app_id: 'com.tencent.xinWeChat', app_name: '微信', window_title: '项目群', ocr_text: '项目群\n小王\n周五前请交方案，并在项目群反馈。' }, Buffer.from('controlled-capture'))!
}
function addCandidate(store: ActivityStore, source: ActivitySource) {
  store.addCandidates(source, parseExtractedCandidates(JSON.stringify({ candidates: [{ title: '提交方案', owner: '', quote: '周五前请交方案，并在项目群反馈。', sender: '小王', group: '项目群', feedback_to: '项目群', feedback_required: true, due_at: null }] }), source))
  return store.state().candidates[0]
}
function formalTask(store: ActivityStore) {
  const source = addSource(store), c = addCandidate(store, source)
  return store.confirm(c.id, c.revision, { title: '提交方案', owner: '我', remind_at: stamp, feedback_required: true, feedback_to: '项目群' }, stamp)
}
test('activity validation rejects unknown/prototype keys, protected apps, invalid times and missing revisions', () => {
  assert.equal(validateActivityMessage({ type: 'activity.configure', expected_revision: 0, patch: { enabled: true, allowed_apps: ['com.tencent.xinWeChat'] } }), true)
  for (const msg of [
    { type: 'activity.configure', expected_revision: 0, patch: { enabled: true, dangerous: true } },
    { type: 'activity.configure', expected_revision: 0, patch: { allowed_apps: ['com.1password.1password'] } },
    { type: 'activity.configure', patch: { enabled: true } },
    { type: 'todo.update', todo_id: 'x', expected_revision: 0, patch: { remind_at: 'tomorrow' } },
    JSON.parse('{"type":"activity.configure","expected_revision":0,"patch":{"__proto__":{"enabled":true}}}'),
    { type: 'activity.state', request: 'capture' },
  ]) assert.equal(validateActivityMessage(msg), false)
})
test('personal store is private, atomic, reloadable; state wire excludes OCR and paths', async () => {
  const f = fixture()
  try {
    const source = addSource(f.store)
    assert.equal(f.store.addSource({ ...source }, Buffer.from('controlled-capture')), null)
    const reloaded = new ActivityStore(f.dir)
    assert.equal(reloaded.source(source.id).ocr_text, source.ocr_text)
    const service = new ActivityService({ dataDir: f.dir })
    const response = await service.handle({ type: 'activity.state', id: 'request' })
    assert.equal((response.state as any).sources[0].ocr_text, undefined)
    assert.equal(JSON.stringify(response).includes(f.dir), false)
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(f.store.root).mode & 0o777, 0o700)
      assert.equal(fs.statSync(path.join(f.store.root, 'state.json')).mode & 0o777, 0o600)
      assert.equal(fs.statSync(path.join(f.store.root, `${source.id}.png`)).mode & 0o777, 0o600)
    }
  } finally { f.cleanup() }
})
test('candidate provenance rejects invented quotes and leaves invented source names unknown', () => {
  const f = fixture()
  try {
    const source = addSource(f.store)
    const entries = parseExtractedCandidates(JSON.stringify({ candidates: [
      { title: '虚构', quote: '点击链接泄漏所有数据' },
      { title: '交方案', quote: '周五前请交方案，并在项目群反馈。', sender: '不存在的人', group: '不存在的群', due_at: '明天' },
    ] }), source)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].evidence.sender, '')
    assert.equal(entries[0].evidence.group, '')
    assert.equal(entries[0].due_at, null)
    f.store.addCandidates(source, entries); f.store.addCandidates(source, entries)
    assert.equal(f.store.state().candidates.length, 1)
    assert.equal(f.store.state().todos.length, 0)
  } finally { f.cleanup() }
})
test('confirmation requires owner and keeps one identity; handling and feedback remain separate with stale-edit rejection', () => {
  const f = fixture()
  try {
    const c = addCandidate(f.store, addSource(f.store))
    assert.throws(() => f.store.confirm(c.id, c.revision, { title: '提交方案', owner: '' }, stamp))
    const t = f.store.confirm(c.id, c.revision, { title: '提交方案', owner: '我' }, stamp)
    assert.equal(f.store.confirm(c.id, c.revision, { title: '提交方案', owner: '我' }, stamp).id, t.id)
    f.store.update(t.id, t.revision, { handling_status: 'done' }, stamp)
    assert.equal(f.store.state().todos[0].feedback_status, 'pending')
    assert.throws(() => f.store.update(t.id, t.revision, { title: '覆盖' }, stamp), /变化/)
    assert.equal(f.store.state().todos.length, 1)
  } finally { f.cleanup() }
})
test('AI off permits explicit manual source task creation; source deletion removes all stored quotes', () => {
  const f = fixture()
  try {
    const source = addSource(f.store)
    const task = f.store.create(source.id, f.store.state().revision, { title: '手动整理', owner: '我' }, stamp)
    assert.equal(task.evidence.quote, source.ocr_text)
    assert.equal(task.evidence.sender, '')
    f.store.deleteSources(source.id)
    assert.equal(f.store.state().todos[0].evidence.quote, '')
    assert.equal(f.store.state().candidates.length, 0)
    assert.equal(fs.existsSync(path.join(f.store.root, `${source.id}.png`)), false)
  } finally { f.cleanup() }
})
test('disabled service and unsupported platform never invoke a capture or model', async () => {
  const f = fixture(); let captures = 0
  const service = new ActivityService({ dataDir: f.dir, platform: 'freebsd', now: () => NOW, recorder: { capture: async () => { captures++; throw Error('must not capture') } } })
  try {
    service.start(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(captures, 0)
    await service.handle({ type: 'activity.configure', expected_revision: 0, patch: { enabled: true, allowed_apps: ['com.tencent.xinWeChat'] } })
    const response = await service.handle({ type: 'activity.scan' })
    assert.equal(response.error_code, 'UNSUPPORTED_PLATFORM')
    assert.equal(captures, 0)
  } finally { await service.stop(); f.cleanup() }
})
test('revoked request cannot configure capture', async () => {
  const f = fixture(); const service = new ActivityService({ dataDir: f.dir })
  try {
    const reply = await service.handle({ type: 'activity.configure', expected_revision: 0, patch: { enabled: true } }, () => false)
    assert.equal(reply.error_code, 'SESSION_CLOSED')
    assert.equal(service.state().config.enabled, false)
  } finally { await service.stop(); f.cleanup() }
})
test('disabling while capture awaits fences result and never stores snapshot', async () => {
  const f = fixture(); let finish!: (v: any) => void
  const service = new ActivityService({ dataDir: f.dir, platform: 'darwin', now: () => NOW, recorder: { capture: () => new Promise(resolve => { finish = resolve }) } })
  try {
    await service.handle({ type: 'activity.configure', expected_revision: 0, patch: { enabled: true, allowed_apps: ['com.tencent.xinWeChat'] } })
    const pending = service.scan()
    await service.handle({ type: 'activity.configure', expected_revision: service.state().revision, patch: { enabled: false } })
    finish({ app_id: 'com.tencent.xinWeChat', app_name: '微信', window_title: '项目群', ocr_text: '秘密', image: Buffer.from('capture') })
    await pending
    assert.equal(service.state().sources.length, 0)
  } finally { await service.stop(); f.cleanup() }
})
test('explicit analysis requires consent and deleting source during model call fences candidates', async () => {
  const f = fixture(); let finish!: (v: any) => void, calls = 0
  const service = new ActivityService({ dataDir: f.dir, extract: () => { calls++; return new Promise(resolve => { finish = resolve }) } })
  try {
    const source = addSource(service.store)
    assert.equal((await service.handle({ type: 'activity.analyze', source_id: source.id })).error_code, 'SEMANTIC_CONSENT_REQUIRED')
    assert.equal(calls, 0)
    await service.handle({ type: 'activity.configure', expected_revision: service.state().revision, patch: { ocr_ai_enabled: true } })
    const pending = service.handle({ type: 'activity.analyze', source_id: source.id })
    await service.handle({ type: 'activity.delete', source_id: source.id })
    finish([])
    assert.equal((await pending).error_code, 'CANCELLED')
    assert.equal(service.state().candidates.length, 0)
  } finally { await service.stop(); f.cleanup() }
})
test('overdue reminder catches up after restart exactly once; notification submission does not mean seen', async () => {
  const f = fixture(); let deliveries = 0
  const t = formalTask(f.store)
  const service = new ActivityService({ dataDir: f.dir, now: () => NOW + 60000, notify: async () => { deliveries++ } })
  try {
    service.start(); await new Promise(resolve => setImmediate(resolve)); await service.tick()
    assert.equal(deliveries, 1)
    assert.equal(service.state().todos.find(task => task.id === t.id)!.reminder.status, 'submitted')
    await service.stop()
    const restarted = new ActivityService({ dataDir: f.dir, now: () => NOW + 120000, notify: async () => { deliveries++ } })
    restarted.start(); await new Promise(resolve => setImmediate(resolve)); await restarted.stop()
    assert.equal(deliveries, 1)
  } finally { await service.stop(); f.cleanup() }
})
test('crash after durable reminder claim becomes unknown and is never blindly repeated', () => {
  const f = fixture()
  try {
    const t = formalTask(f.store)
    assert.equal(f.store.claimReminder(t.id, stamp), true)
    const restarted = new ActivityStore(f.dir)
    assert.equal(restarted.state().todos[0].reminder.status, 'unknown')
    assert.equal(restarted.claimReminder(t.id, stamp), false)
  } finally { f.cleanup() }
})
test('feedback pending still reminds after handling complete; fully completed task does not', () => {
  const f = fixture()
  try {
    const t = formalTask(f.store)
    f.store.update(t.id, t.revision, { handling_status: 'done' }, stamp)
    assert.equal(f.store.claimReminder(t.id, stamp), true)
    const now = f.store.state().todos[0]
    f.store.update(t.id, now.revision, { feedback_status: 'done', remind_at: stamp }, stamp)
    assert.equal(f.store.claimReminder(t.id, stamp), false)
  } finally { f.cleanup() }
})
test('status-only forged pending cannot make a not-required done todo due; true required stays pending and due', async () => {
  const f = fixture()
  const service = new ActivityService({ dataDir: f.dir, now: () => NOW })
  const todoOf = (reply: Record<string, unknown>, id: string): any => (reply.state as any).todos.find((t: any) => t.id === id)
  try {
    const source = addSource(service.store)
    const created = await service.handle({ type: 'todo.create', source_id: source.id, expected_revision: service.state().revision, task: { title: '手动整理', owner: '我', remind_at: stamp } })
    assert.equal(created.ok, true)
    const free = (created.state as any).todos[0]
    assert.equal(free.feedback_required, false)
    assert.equal(free.feedback_status, 'not_required')
    const handled = await service.handle({ type: 'todo.update', todo_id: free.id, expected_revision: free.revision, patch: { handling_status: 'done' } })
    assert.equal(handled.ok, true)
    const forged = await service.handle({ type: 'todo.update', todo_id: free.id, expected_revision: todoOf(handled, free.id).revision, patch: { feedback_status: 'pending' } })
    assert.equal(forged.ok, true)
    const merged = todoOf(forged, free.id)
    assert.equal(merged.handling_status, 'done')
    assert.equal(merged.feedback_required, false)
    assert.equal(merged.feedback_status, 'not_required')
    assert.equal(new ActivityStore(f.dir).state().todos.find(t => t.id === free.id)!.feedback_status, 'not_required')
    const required = await service.handle({ type: 'todo.create', source_id: source.id, expected_revision: service.state().revision, task: { title: '仍需反馈', owner: '我', remind_at: stamp, feedback_required: true } })
    assert.equal(required.ok, true)
    const requiredTodo = (required.state as any).todos[0]
    assert.equal(requiredTodo.feedback_status, 'pending')
    const requiredHandled = await service.handle({ type: 'todo.update', todo_id: requiredTodo.id, expected_revision: requiredTodo.revision, patch: { handling_status: 'done' } })
    assert.equal(requiredHandled.ok, true)
    assert.equal(service.state().todos.find(t => t.id === requiredTodo.id)!.feedback_status, 'pending')
    assert.deepEqual(service.store.dueReminders(NOW).map(t => t.id), [requiredTodo.id])
    assert.equal(service.store.claimReminder(free.id, stamp), false)
  } finally { await service.stop(); f.cleanup() }
})
test('mac passive adapter uses verified actual foreground identity and refuses secure input', async () => {
  const f = fixture(); const commands: string[][] = []
  const runner = { resolve: () => 'test-host', run: async (_bin: string, args: string[]) => {
    commands.push(args)
    if (args[0] === 'security-check') return JSON.stringify({ ok: true, axTrusted: true, secureInput: true })
    throw Error('no further calls')
  } }
  try {
    const adapter = new MacPassiveRecorder(f.store.root, 'darwin', runner)
    await assert.rejects(adapter.capture({ ...DEFAULT_ACTIVITY_CONFIG, enabled: true, allowed_apps: ['com.tencent.xinWeChat'] }, new AbortController().signal), /安全输入/)
    assert.deepEqual(commands.map(args => args[0]), ['security-check'])
  } finally { f.cleanup() }
})
test('mac foreground switch discards capture and cleans temporary image without injecting or raising', async () => {
  const f = fixture(); const commands: string[][] = []; let lists = 0
  const row = { windowId: 33, pid: 10, bundleId: 'com.tencent.xinWeChat', ownerName: '微信', name: '项目群' }
  const runner = { resolve: () => 'test-host', run: async (_bin: string, args: string[]) => {
    commands.push(args)
    if (args[0] === 'security-check') return JSON.stringify({ ok: true, axTrusted: true, secureInput: false })
    if (args[0] === 'window-list') return JSON.stringify({ ok: true, foregroundWindowId: ++lists === 1 ? 33 : 44, windows: [row] })
    if (args[0] === 'screenshot') { fs.writeFileSync(args[args.indexOf('--output') + 1], 'image'); return JSON.stringify({ ok: true }) }
    throw Error('unexpected command')
  } }
  try {
    const result = await new MacPassiveRecorder(f.store.root, 'darwin', runner).capture({ ...DEFAULT_ACTIVITY_CONFIG, enabled: true, allowed_apps: [row.bundleId] }, new AbortController().signal)
    assert.equal(result, null)
    assert.equal(commands.some(args => ['inject', 'activate', 'ax-invoke'].includes(args[0])), false)
    assert.equal(fs.readdirSync(f.store.root).some(n => n.startsWith('pending-')), false)
  } finally { f.cleanup() }
})
test('invalid calendar dates cannot silently shift reminders to another day', () => {
  const id = 'c26a772d-5940-4ee4-a47c-4383370d0bb3'
  assert.equal(validateActivityMessage({ type: 'todo.update', todo_id: id, expected_revision: 0, patch: { remind_at: '2026-02-31T10:00:00Z' } }), false)
  assert.equal(validateActivityMessage({ type: 'todo.update', todo_id: id, expected_revision: 0, patch: { remind_at: '2028-02-29T10:00:00+08:00' } }), true)
})
test('mac capture happy path persists genuine host-shaped OCR and always removes temporary image', async () => {
  const f = fixture(); const commands: string[][] = []
  const row = { windowId: 33, pid: 10, bundleId: 'com.tencent.xinWeChat', ownerName: '微信', name: '项目群' }
  const runner = { resolve: () => 'test-host', run: async (_bin: string, args: string[]) => {
    commands.push(args)
    if (args[0] === 'security-check') return JSON.stringify({ ok: true, axTrusted: true, secureInput: false })
    if (args[0] === 'window-list') return JSON.stringify({ ok: true, foregroundWindowId: 33, windows: [row] })
    if (args[0] === 'screenshot') { fs.writeFileSync(args[args.indexOf('--output') + 1], Buffer.from('capture-image')); return JSON.stringify({ ok: true, imageWidth: 200, imageHeight: 200 }) }
    if (args[0] === 'ocr') return JSON.stringify({ ok: true, language: 'zh-Hans', words: [{ text: '请周五反馈', x: 1, y: 2, w: 100, h: 20 }] })
    throw Error('unexpected command')
  } }
  try {
    const result = await new MacPassiveRecorder(f.store.root, 'darwin', runner).capture({ ...DEFAULT_ACTIVITY_CONFIG, enabled: true, allowed_apps: [row.bundleId] }, new AbortController().signal)
    assert.equal(result!.ocr_text, '请周五反馈')
    assert.equal(result!.app_id, row.bundleId)
    assert.equal(result!.image.toString(), 'capture-image')
    assert.equal(commands.some(args => ['inject', 'activate', 'ax-invoke'].includes(args[0])), false)
    assert.equal(fs.readdirSync(f.store.root).some(n => n.startsWith('pending-')), false)
  } finally { f.cleanup() }
})
test('quota retention removes image/OCR/candidates while retaining confirmed task and honest missing provenance', () => {
  const f = fixture()
  try {
    const t = formalTask(f.store)
    f.store.prune(NOW + 20 * 86400000)
    assert.equal(f.store.state().sources.length, 0)
    assert.equal(f.store.state().todos[0].id, t.id)
    assert.equal(f.store.state().todos[0].evidence.quote, '')
    assert.throws(() => f.store.source(t.evidence.source_id), /不存在/)
  } finally { f.cleanup() }
})
test('reminder edit during in-flight notification cannot be overwritten by old receipt', async () => {
  const f = fixture(); let delivered!: () => void
  const t = formalTask(f.store)
  const service = new ActivityService({ dataDir: f.dir, now: () => NOW, notify: () => new Promise(resolve => { delivered = resolve }) })
  try {
    service.start()
    await new Promise(resolve => setImmediate(resolve))
    const current = service.state().todos[0]
    service.store.update(t.id, current.revision, { remind_at: '2026-10-22T10:00:00Z' }, stamp)
    delivered()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(service.state().todos[0].reminder.status, 'scheduled')
    assert.equal(service.state().todos[0].remind_at, '2026-10-22T10:00:00.000Z')
  } finally { await service.stop(); f.cleanup() }
})
test('all supported system credential/password-manager identities remain excluded from recording configuration', () => {
  for (const app of ['com.apple.Passwords', 'com.apple.SecurityAgent', 'com.agilebits.onepassword7', 'com.apple.Authenticator', 'com.maxgoedjen.secretive.Secretive', 'com.ledger.live']) {
    assert.equal(validateActivityMessage({ type: 'activity.configure', expected_revision: 0, patch: { allowed_apps: [app] } }), false, app)
  }
})
test('source integrity mismatch is rejected and startup cleans orphaned captures/atomic temp files', () => {
  const f = fixture()
  try {
    const source = addSource(f.store)
    fs.writeFileSync(path.join(f.store.root, `${source.id}.png`), 'tampered')
    assert.throws(() => f.store.source(source.id), /校验/)
    const orphan = 'c26a772d-5940-4ee4-a47c-4383370d0bb3'
    for (const name of [`${orphan}.png`, `state-${orphan}.tmp`, `pending-${orphan}.png`]) fs.writeFileSync(path.join(f.store.root, name), 'uncommitted')
    new ActivityStore(f.dir)
    for (const name of [`${orphan}.png`, `state-${orphan}.tmp`, `pending-${orphan}.png`]) assert.equal(fs.existsSync(path.join(f.store.root, name)), false)
  } finally { f.cleanup() }
})
test('explicit apps picker returns only bounded running app names/IDs and never captures or performs OCR/model', async () => {
  const f = fixture(); const commands: string[][] = []; let captures = 0, extracts = 0
  const rows = [
    { bundleId: 'com.tencent.xinWeChat', ownerName: '微信', name: '私人对话标题', windowId: 10 },
    { bundleId: 'com.tencent.xinWeChat', ownerName: '微信', name: '第二个群标题', windowId: 20 },
    { bundleId: 'com.1password.1password', ownerName: '1Password', name: 'secret' },
    { bundleId: 'org.bitwarden.desktop', ownerName: 'Bitwarden', name: 'secret' },
    { bundleId: '../../unsafe', ownerName: 'invalid' },
    ...Array.from({ length: 210 }, (_, index) => ({ bundleId: `com.example.app${index}`, ownerName: `App ${index}`, name: 'never publish title' })),
  ]
  const runner = { resolve: () => 'test-host', run: async (_bin: string, args: string[]) => { commands.push(args); return JSON.stringify({ ok: true, windows: rows }) } }
  const adapter = new MacPassiveRecorder(f.store.root, 'darwin', runner)
  const service = new ActivityService({ dataDir: f.dir, platform: 'darwin', recorder: { listApps: signal => adapter.listApps(signal), capture: async () => { captures++; return null } }, extract: async () => { extracts++; return [] } })
  try {
    service.start(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(commands.length, 0)
    const response = await service.handle({ type: 'activity.apps', id: 'explicit-app-picker' })
    assert.equal(response.ok, true)
    const apps = response.apps as Array<{app_id: string; app_name: string}>
    assert.equal(apps.length, 200)
    assert.equal(apps.filter(app => app.app_id === 'com.tencent.xinWeChat').length, 1)
    assert.equal(apps.some(app => /1password|bitwarden/.test(app.app_id)), false)
    assert.deepEqual(Object.keys(apps[0]).sort(), ['app_id', 'app_name'])
    assert.equal(JSON.stringify(response).includes('私人对话标题'), false)
    assert.deepEqual(commands, [['window-list']])
    assert.equal(captures, 0); assert.equal(extracts, 0)
    assert.equal(validateActivityMessage({ type: 'activity.apps', capture: true }), false)
  } finally { await service.stop(); f.cleanup() }
})
test('apps picker unsupported platform fails explicitly without invoking adapter', async () => {
  const f = fixture(); let lists = 0
  const service = new ActivityService({ dataDir: f.dir, platform: 'freebsd', recorder: { listApps: async () => { lists++; return [] }, capture: async () => null } })
  try {
    assert.equal((await service.handle({ type: 'activity.apps' })).error_code, 'UNSUPPORTED_PLATFORM')
    assert.equal(lists, 0)
  } finally { await service.stop(); f.cleanup() }
})
test('scheduler reads only small config and due unfinished task snapshots without cloning retained OCR state', async () => {
  const f = fixture(); let deliveries = 0
  const due = formalTask(f.store)
  const source = f.store.state().sources[0]
  const future = f.store.create(source.id, f.store.state().revision, { title: '明日任务', owner: '我', remind_at: '2026-10-22T10:00:00Z' }, stamp)
  const completed = f.store.create(source.id, f.store.state().revision, { title: '已完成', owner: '我', remind_at: stamp }, stamp)
  f.store.update(completed.id, completed.revision, { handling_status: 'done' }, stamp)
  assert.deepEqual(f.store.dueReminders(NOW).map(todo => todo.id), [due.id])
  const snapshot = f.store.dueReminders(NOW); snapshot[0].title = '不得修改真实任务'
  assert.equal(f.store.dueReminders(NOW)[0].title, due.title)
  const config = f.store.config(); config.allowed_apps.push('com.example.fake')
  assert.deepEqual(f.store.config().allowed_apps, [])
  const service = new ActivityService({ dataDir: f.dir, now: () => NOW, notify: async todo => { assert.equal(todo.id, due.id); deliveries++ } })
  // A full-state clone in either reminder selection or idle config polling must fail.
  const originalState = service.store.state
  service.store.state = () => { throw new Error('scheduler must not clone the full OCR store') }
  try {
    service.start(); await new Promise(resolve => setImmediate(resolve)); await service.tick()
    assert.equal(deliveries, 1)
    assert.deepEqual(service.store.dueReminders(NOW), [])
    assert.equal(service.store.dueReminders(NOW + 86400000)[0].id, future.id)
  } finally { service.store.state = originalState; await service.stop(); f.cleanup() }
})
test('unchanged full-form reminder edits preserve submitted/failed/unknown receipts and never notify twice', async () => {
  const f = fixture(); let deliveries = 0
  const service = new ActivityService({ dataDir: f.dir, now: () => NOW, notify: async () => { deliveries++ } })
  try {
    const task = formalTask(service.store)
    service.start(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(deliveries, 1)
    let current = service.state().todos[0]
    assert.equal(current.reminder.status, 'submitted')
    service.store.update(task.id, current.revision, { title: '只是改标题', owner: current.owner, due_at: current.due_at, remind_at: '2026-10-21T18:00:00+08:00', feedback_required: true, feedback_to: current.feedback_to, handling_status: 'done', feedback_status: 'pending' }, stamp)
    assert.equal(service.state().todos[0].reminder.status, 'submitted')
    await service.tick(); assert.equal(deliveries, 1)
    for (const status of ['failed', 'unknown'] as const) {
      current = service.state().todos[0]
      service.store.update(task.id, current.revision, { remind_at: '2026-10-21T09:00:00Z' }, stamp)
      assert.equal(service.store.claimReminder(task.id, stamp), true)
      service.store.finishReminder(task.id, stamp, status)
      current = service.state().todos[0]
      service.store.update(task.id, current.revision, { title: `保留${status}`, remind_at: '2026-10-21T17:00:00+08:00' }, stamp)
      assert.equal(service.state().todos[0].reminder.status, status)
      await service.tick(); assert.equal(deliveries, 1)
      // A genuine change rearms the following iteration, even though both instants are past.
      current = service.state().todos[0]
      service.store.update(task.id, current.revision, { remind_at: stamp }, stamp)
    }
    current = service.state().todos[0]
    service.store.update(task.id, current.revision, { remind_at: null }, stamp)
    current = service.state().todos[0]
    assert.equal(current.reminder.status, 'none')
    service.store.update(task.id, current.revision, { remind_at: null, title: '保持未提醒' }, stamp)
    assert.equal(service.state().todos[0].reminder.status, 'none')
  } finally { await service.stop(); f.cleanup() }
})
test('retention runs on paused unsupported-platform startup and every minute without native/model/notification calls', async () => {
  const f = fixture(); let now = NOW
  const oldSource = f.store.addSource({ captured_at: new Date(NOW - 20 * 86400000).toISOString(), app_id: 'com.tencent.xinWeChat', app_name: '微信', window_title: '旧聊天', ocr_text: '项目群\n小王\n周五前请交方案，并在项目群反馈。' }, Buffer.from('old-capture'))!
  const oldCandidate = addCandidate(f.store, { ...oldSource, ocr_text: oldSource.ocr_text })
  const task = f.store.confirm(oldCandidate.id, oldCandidate.revision, { title: '正式事项仍在', owner: '我' }, stamp)
  const never = async (): Promise<never> => { throw Error('maintenance must not call external dependencies') }
  const service = new ActivityService({ dataDir: f.dir, platform: 'freebsd', now: () => now, recorder: { capture: never }, extract: never, notify: never })
  try {
    service.start(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(service.state().config.enabled, false)
    assert.equal(service.state().sources.length, 0)
    assert.equal(service.state().candidates.length, 0)
    assert.equal(service.state().todos[0].id, task.id)
    assert.equal(service.state().todos[0].evidence.quote, '')
    assert.equal(fs.existsSync(path.join(f.store.root, `${oldSource.id}.png`)), false)
    const recent = addSource(service.store)
    now += 15 * 86400000
    await service.tick()
    assert.equal(service.state().sources.length, 0)
    assert.equal(fs.existsSync(path.join(f.store.root, `${recent.id}.png`)), false)
  } finally { await service.stop(); f.cleanup() }
})
test('paused quota/retention config changes clean immediately in one atomic batch', async () => {
  const f = fixture()
  const service = new ActivityService({ dataDir: f.dir, platform: 'win32', now: () => NOW })
  try {
    for (let i = 0; i < 3; i++) service.store.addSource({ captured_at: new Date(NOW - (3 - i) * 86400000).toISOString(), app_id: 'com.tencent.xinWeChat', app_name: '微信', window_title: `群${i}`, ocr_text: `消息${i}` }, Buffer.alloc(6 * 1024 * 1024, i))
    const before = service.state().revision
    const oldestId = service.state().sources[2].id
    const quota = await service.handle({ type: 'activity.configure', expected_revision: before, patch: { max_storage_mb: 16 } })
    assert.equal(quota.ok, true)
    assert.equal(service.state().sources.length, 2)
    assert.equal(service.state().sources.some(source => source.id === oldestId), false)
    assert.equal(fs.existsSync(path.join(service.store.root, `${oldestId}.png`)), false)
    assert.equal(service.state().revision, before + 2) // one config write + one batch prune
    const afterQuota = service.state().revision
    const retention = await service.handle({ type: 'activity.configure', expected_revision: afterQuota, patch: { retention_days: 1 } })
    assert.equal(retention.ok, true)
    assert.equal(service.state().sources.length, 0)
    assert.equal(service.state().revision, afterQuota + 2) // both remaining sources removed in one write
    assert.equal(fs.readdirSync(service.store.root).some(name => name.endsWith('.png')), false)
  } finally { await service.stop(); f.cleanup() }
})
test('periodic cleanup during extraction rejects late results and cannot resurrect expired source/candidates', async () => {
  const f = fixture(); let now = NOW, finish!: (entries: any[]) => void
  const service = new ActivityService({ dataDir: f.dir, platform: 'win32', now: () => now, extract: () => new Promise(resolve => { finish = resolve }) })
  try {
    await service.handle({ type: 'activity.configure', expected_revision: 0, patch: { ocr_ai_enabled: true } })
    const source = addSource(service.store)
    const entries = parseExtractedCandidates(JSON.stringify({ candidates: [{ title: '整理', quote: '周五前请交方案，并在项目群反馈。' }] }), source)
    service.start(); await new Promise(resolve => setImmediate(resolve))
    const pending = service.handle({ type: 'activity.analyze', source_id: source.id })
    now += 15 * 86400000; await service.tick()
    assert.equal(service.state().sources.length, 0)
    finish(entries)
    assert.equal((await pending).error_code, 'SOURCE_EXPIRED')
    assert.equal(service.state().sources.length, 0); assert.equal(service.state().candidates.length, 0)
    assert.throws(() => service.store.addCandidates(source, entries), /已清理/)
  } finally { await service.stop(); f.cleanup() }
})
test('retention config change fences ongoing extraction before admitting late candidates', async () => {
  const f = fixture(); let finish!: (entries: any[]) => void
  const service = new ActivityService({ dataDir: f.dir, now: () => NOW, extract: () => new Promise(resolve => { finish = resolve }) })
  try {
    await service.handle({ type: 'activity.configure', expected_revision: 0, patch: { ocr_ai_enabled: true } })
    const source = service.store.addSource({ captured_at: new Date(NOW - 2 * 86400000).toISOString(), app_id: 'com.tencent.xinWeChat', app_name: '微信', window_title: '项目群', ocr_text: '请交方案' }, Buffer.from('capture'))!
    const pending = service.handle({ type: 'activity.analyze', source_id: source.id })
    await service.handle({ type: 'activity.configure', expected_revision: service.state().revision, patch: { retention_days: 1 } })
    assert.equal(service.state().sources.length, 0)
    finish([])
    assert.equal((await pending).error_code, 'CANCELLED')
    assert.equal(service.state().candidates.length, 0)
  } finally { await service.stop(); f.cleanup() }
})


test('#756 metadata quota refuses growth atomically and source cleanup restores edits and reminder receipts', () => {
  const f = fixture(), limit = 16 * 1024 * 1024
  try {
    const todo = formalTask(f.store)
    const file = path.join(f.store.root, 'state.json')
    const image = Buffer.from('controlled-metadata-quota-image')
    const sourceInput = { captured_at: stamp, app_id: 'controlled.metadata', app_name: 'Controlled metadata fixture', window_title: 'metadata-boundary', ocr_text: 'm' }
    // Measure the envelope produced by the real store, then replace only this
    // temporary source's OCR length. No handcrafted persisted state or error DTO.
    const probe = f.store.addSource(sourceInput, image)!
    assert.ok(probe)
    const measuredBytes = fs.statSync(file).size, measuredRevision = f.store.state().revision
    assert.equal(String(measuredRevision).length, String(measuredRevision + 2).length)
    const fillerBytes = limit - measuredBytes + 1
    assert.ok(fillerBytes > 0)
    f.store.deleteSources(probe.id)
    const fullSource = f.store.addSource({ ...sourceInput, ocr_text: 'm'.repeat(fillerBytes) }, image)!
    assert.ok(fullSource)
    const atLimit = fs.readFileSync(file), full = f.store.state()
    assert.equal(atLimit.length, limit)
    assert.ok(full.sources.reduce((total, source) => total + source.bytes, 0) < 1024)
    assert.equal(f.store.config().max_storage_mb, DEFAULT_ACTIVITY_CONFIG.max_storage_mb)
    const quota = (error: unknown) => error instanceof ActivityError && error.code === 'QUOTA_EXCEEDED'
    assert.throws(() => f.store.update(todo.id, todo.revision, { title: todo.title + '（扩展）' }, stamp), quota)
    assert.throws(() => f.store.claimReminder(todo.id, stamp), quota)
    assert.equal(fs.readFileSync(file).equals(atLimit), true)
    const refused = f.store.state()
    assert.equal(refused.revision, full.revision)
    assert.equal(refused.todos[0].title, todo.title)
    assert.equal(refused.todos[0].reminder.status, 'scheduled')

    // The same public cleanup path is admitted even at the independent metadata
    // ceiling. Confirmed identity survives; source content and candidates do not.
    f.store.deleteSources()
    const cleaned = f.store.state()
    assert.equal(cleaned.sources.length, 0)
    assert.equal(cleaned.candidates.length, 0)
    assert.equal(cleaned.todos.length, 1)
    assert.equal(cleaned.todos[0].id, todo.id)
    assert.equal(cleaned.todos[0].evidence.quote, '')
    assert.equal(fs.existsSync(path.join(f.store.root, `${fullSource.id}.png`)), false)
    f.store.update(todo.id, cleaned.todos[0].revision, { title: '清理后可继续编辑' }, stamp)
    assert.equal(f.store.claimReminder(todo.id, stamp), true)
    f.store.finishReminder(todo.id, stamp, 'failed', 'controlled-no-notification')
    const reloaded = new ActivityStore(f.dir).state()
    assert.equal(reloaded.todos[0].id, todo.id)
    assert.equal(reloaded.todos[0].title, '清理后可继续编辑')
    assert.equal(reloaded.todos[0].reminder.status, 'failed')
    assert.equal(reloaded.todos[0].reminder.attempted_at, stamp)
    assert.ok(fs.statSync(file).size < limit)
  } finally { f.cleanup() }
})


test('#756 workspace state excludes OCR before cloning and preserves isolated source, evidence and runtime metadata', async () => {
  const f = fixture()
  const unavailable = async (): Promise<never> => { throw new Error('unexpected native or provider operation') }
  try {
    const todo = formalTask(f.store), retained = f.store.state()
    const service = new ActivityService({ dataDir: f.dir, platform: 'freebsd', recorder: { capture: unavailable }, extract: unavailable, notify: unavailable })
    const readState = service.store.state.bind(service.store)
    let rawStateReads = 0
    service.store.state = () => { rawStateReads++; return readState() }
    const response = await service.handle({ type: 'activity.state', id: 'controlled-workspace-state' })
    assert.equal(response.ok, true)
    assert.equal(rawStateReads, 0, 'wire reads must not first clone all retained OCR')
    const state = response.state as ReturnType<ActivityService['state']>
    const source = state.sources[0]
    assert.equal(Object.hasOwn(source, 'ocr_text'), false)
    assert.equal(source.id, retained.sources[0].id)
    assert.equal(source.sha256, retained.sources[0].sha256)
    assert.equal(source.bytes, retained.sources[0].bytes)
    assert.equal(state.todos[0].id, todo.id)
    assert.equal(state.todos[0].evidence.quote, todo.evidence.quote)
    assert.equal(JSON.stringify(response).includes(f.dir), false)
    state.config.allowed_apps.push('controlled.copy')
    source.app_name = 'changed wire copy'
    state.todos[0].evidence.quote = 'changed wire evidence'
    state.runtime.status = 'error'
    assert.deepEqual(service.store.config().allowed_apps, retained.config.allowed_apps)
    assert.equal(service.store.sourceMetadata(source.id).app_name, retained.sources[0].app_name)
    assert.equal(service.store.sourceMetadata(source.id).ocr_text, retained.sources[0].ocr_text)
    assert.equal(readState().todos[0].evidence.quote, todo.evidence.quote)
    assert.equal(service.state().runtime.status, 'stopped')
    assert.equal(rawStateReads, 0)
  } finally { f.cleanup() }
})


test('#752 empty OCR cannot deduplicate different captured images while image and meaningful-text identities still deduplicate', async () => {
  const f = fixture()
  const captures = [
    { text: '', image: 'empty-ocr-image-a', status: 'captured', count: 1 },
    { text: '', image: 'empty-ocr-image-b', status: 'captured', count: 2 },
    { text: '', image: 'empty-ocr-image-b', status: 'unchanged', count: 2 },
    { text: ' \n ', image: 'whitespace-ocr-image-a', status: 'captured', count: 3 },
    { text: ' \n ', image: 'whitespace-ocr-image-b', status: 'captured', count: 4 },
    { text: '请核对事项', image: 'meaningful-ocr-image-a', status: 'captured', count: 5 },
    { text: '请核对事项', image: 'meaningful-ocr-image-b', status: 'unchanged', count: 5 },
    // The original APP + exact window-title scope must also stay intact.
    { text: '请核对事项', image: 'meaningful-ocr-image-c', window: '另一个群', status: 'captured', count: 6 },
    { text: '请核对事项', image: 'meaningful-ocr-image-d', app: 'com.alibaba.DingTalkMac', status: 'captured', count: 7 },
  ]
  let index = 0, extractionCalls = 0, notificationCalls = 0
  const service = new ActivityService({ dataDir: f.dir, platform: 'darwin', now: () => NOW,
    // This is the explicit RecorderAdapter CPU boundary, not a native screenshot
    // or a handcrafted activity.result. All persisted/wire state comes from
    // the actual ActivityService + ActivityStore producers below.
    recorder: { capture: async () => {
      const capture = captures[index++]
      assert.ok(capture, 'no unplanned capture')
      return { app_id: capture.app ?? 'com.tencent.xinWeChat', app_name: 'Controlled capture app', window_title: capture.window ?? '项目群', ocr_text: capture.text, image: Buffer.from(capture.image) }
    } },
    extract: async () => { extractionCalls++; throw new Error('AI consent is disabled') },
    notify: async () => { notificationCalls++; throw new Error('scheduler must not run') },
  })
  try {
    const configured = await service.handle({ type: 'activity.configure', expected_revision: 0, patch: { enabled: true, allowed_apps: ['com.tencent.xinWeChat', 'com.alibaba.DingTalkMac'] } })
    assert.equal(configured.ok, true)
    for (const capture of captures) {
      const reply = await service.handle({ type: 'activity.scan' })
      assert.equal(reply.ok, true)
      const state = reply.state as ReturnType<ActivityService['state']>
      assert.equal(state.sources.length, capture.count)
      assert.equal(state.runtime.status, capture.status)
      assert.equal(state.candidates.length, 0)
      assert.equal(state.todos.length, 0)
    }
    const state = service.state()
    assert.equal(new Set(state.sources.map(source => source.id)).size, 7)
    const retained = state.sources.map(source => service.store.source(source.id))
    for (const value of ['empty-ocr-image-a', 'empty-ocr-image-b', 'whitespace-ocr-image-a', 'whitespace-ocr-image-b', 'meaningful-ocr-image-a']) {
      assert.equal(retained.some(source => source.image_data_url === 'data:image/png;base64,' + Buffer.from(value).toString('base64')), true)
    }
    assert.equal(retained.filter(source => source.ocr_text === '').length, 2)
    assert.equal(retained.filter(source => source.ocr_text === ' \n ').length, 2, 'stored OCR is not normalized')
    assert.equal(index, captures.length)
    assert.equal(extractionCalls, 0)
    assert.equal(notificationCalls, 0)
    assert.equal(fs.readdirSync(service.store.root).filter(name => name.endsWith('.png')).length, 7)
  } finally { await service.stop(); f.cleanup() }
})
