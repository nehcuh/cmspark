import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ActivityService } from '../src/activity/service'
import { ActivityStore } from '../src/activity/store'
import { ActivityError, DEFAULT_ACTIVITY_CONFIG, type ActivityChatProfile } from '../src/activity/types'
import { imageSize, scopeLocalFrame } from '../src/activity/chat-scope'
import { validateConfig } from '../src/activity/validation'
import { parseExtractedCandidates, type RecorderAdapter } from '../src/activity/adapters'
import { parseActivityImage } from '../src/activity/model-extract'
import { recognitionTarget } from '../src/activity/model-config'
import { decodePngToRgba } from '../src/computer/png-decode'
import { scope825Png } from './helpers/activity-scope825-image'

const app = 'com.example.OwnedChat'
const profile: ActivityChatProfile = { window_class: 'owned', width: 80, height: 60, logical_width: 80, logical_height: 60,
  content: { x: 20, y: 0, width: 60, height: 60 }, title: { x: 22, y: 2, width: 30, height: 10 }, allowed_titles: ['项目组'] }
const config = { ...DEFAULT_ACTIVITY_CONFIG, enabled: true, allowed_apps: [app], chat_scopes: [{ app_id: app, profiles: [profile] }] }
const png = scope825Png(80, 60)
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-activity-900-'))
const sourceInput = { app_id: app, app_name: '测试聊天', window_title: '聊天', captured_at: new Date().toISOString(), ocr_text: '测试消息' }
const turn = () => new Promise<void>(resolve => setImmediate(resolve))

test('two explicitly picked, identically titled windows have independent sources and status; failed/restarted binding cannot record another window', async () => {
  const dir = temp()
  let next = 0, foreground = 0, closed = 0, hiding = false
  const recorder: RecorderAdapter = { fixedWindowSupported: true,
    capture: async () => { foreground++; return null },
    pickWindow: async () => {
      const id = ++next
      return { title: '聊天', identity: 'owned/' + id, close: () => { closed++ },
        capture: async () => {
          if (hiding && id === 1) throw new ActivityError('WINDOW_CLOSED', '窗口已关闭，请重新选择')
          return { ...sourceInput, conversation_title: '项目组', image: png, display: String(id) }
        } }
    } }
  const service = new ActivityService({ dataDir: dir, platform: 'darwin', recorder })
  try {
    assert.equal((await service.handle({ type: 'activity.bind_window', app_id: app })).error_code, 'SCOPE_REQUIRED')
    service.store.configure(0, config)
    assert.equal((await service.handle({ type: 'activity.configure', expected_revision: service.store.revision(), patch: { fixed_windows: [] } })).ok, false)
    for (let i = 0; i < 2; i++) assert.equal((await service.handle({ type: 'activity.bind_window', app_id: app })).ok, true)
    const bindings = service.store.config().fixed_windows!
    service.start(); await turn()
    assert.deepEqual(service.state().sources.map(s => s.binding_id), bindings.map(b => b.id).reverse())
    assert.deepEqual(bindings.map(b => service.state().runtime.fixed_window_status![b.id].display), ['1', '2'])
    for (const b of bindings) assert.equal((await service.handle({ type: 'activity.pause_window', binding_id: b.id, paused: true })).ok, true)
    await service.scan()
    assert.equal(service.state().runtime.status, 'fixed_windows_paused')
    for (const b of bindings) await service.handle({ type: 'activity.pause_window', binding_id: b.id, paused: false })
    hiding = true
    await service.scan()
    assert.match(service.state().runtime.fixed_window_status![bindings[0].id].reason!, /关闭/)
    assert.equal(closed, 1)
    await service.stop()
    const reopened = new ActivityService({ dataDir: dir, platform: 'darwin', recorder })
    try {
      await reopened.scan()
      assert.match(reopened.state().runtime.fixed_window_status![bindings[0].id].reason!, /重新选择/)
      assert.equal(reopened.state().sources.length, 2)
      for (const b of bindings) assert.equal((await reopened.handle({ type: 'activity.unbind_window', binding_id: b.id })).ok, true)
      assert.equal(reopened.state().config.enabled, false)
    } finally { await reopened.stop() }
    assert.equal(foreground, 0)
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('pure DPI change crops only the calibrated conversation and requires an exact title; changed geometry and legacy scopes fail closed', async () => {
  const signal = new AbortController().signal
  const image = scope825Png(160, 120, x => x < 40 ? [255, 0, 255, 255] : [0, 128, 0, 255])
  const logical = { width: 80, height: 60 }
  const readTitle = async (crop: Buffer) => { assert.deepEqual(imageSize(crop), { width: 60, height: 20 }); return '项目组' }
  validateConfig({ chat_scopes: config.chat_scopes })
  const crop = await scopeLocalFrame(config, app, 'owned', image, signal, readTitle, logical)
  assert.deepEqual(imageSize(crop.image), { width: 120, height: 120 })
  assert.ok(decodePngToRgba(crop.image).rgba.every((v, i) => v === [0, 128, 0, 255][i % 4]))
  await assert.rejects(scopeLocalFrame(config, app, 'owned', image, signal, async () => '另一个群', logical), /允许名单/)
  await assert.rejects(scopeLocalFrame(config, app, 'owned', image, signal, readTitle, { width: 160, height: 120 }), /布局/)
  const { logical_width, logical_height, ...legacy } = profile
  await assert.rejects(scopeLocalFrame({ ...config, chat_scopes: [{ app_id: app, profiles: [legacy] }] }, app, 'owned', image, signal, readTitle, logical), /布局/)
})

test('separate actions survive overlapping screenshots, adjacent deadlines stay literal, and different pinned conversations do not merge', () => {
  const dir = temp(), store = new ActivityStore(dir)
  try {
    const quote = '小林，核对清单，把差异发给我。', context = '小林：我来做，周五下班前给你。'
    const add = (id: string, text: string) => store.addSource({ ...sourceInput, binding_id: id, conversation_title: '项目组', ocr_text: text }, Buffer.from(text))!
    const first = add('one', quote + '\n' + context)
    const raw = JSON.stringify({ candidates: ['核对清单', '把差异发给我'].map(action => ({
      title: action, quote, action_quote: action, context_quote: context, owner: '小林', feedback_to: '我', feedback_required: true, deadline_text: '周五下班前', due_at: '2026-11-27T17:00:00Z' })) })
    for (const item of [first, add('one', '新消息\n' + first.ocr_text), add('two', first.ocr_text)]) {
      const entries = parseExtractedCandidates(raw, item)
      assert.equal(entries[0].evidence.context_quote, context)
      assert.equal(entries[0].evidence.deadline_text, '周五下班前')
      assert.equal(entries[0].due_at, null)
      assert.equal(entries[0].feedback_required, false)
      assert.equal(entries[1].feedback_to, '我')
      store.addCandidates(item, entries)
    }
    assert.equal(store.state().candidates.length, 4)
    assert.equal(store.state().todos.length, 0)
    const distant = parseExtractedCandidates(raw, { ...first, ocr_text: quote + '\n' + '其它消息'.repeat(70) + '\n' + context })
    assert.equal(distant[0].evidence.context_quote, undefined)
    assert.equal(distant[0].evidence.deadline_text, undefined)
    const retained = '清晰的聊天文字'
    assert.throws(() => parseActivityImage(JSON.stringify({ transcript: retained, candidates: {} }), first,
      text => store.saveVisualTranscript(first, text)), /候选结构/)
    assert.ok(store.source(first.id).ocr_text.includes(retained))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('restart resumes only unstarted authorized automatic work and makes ambiguous delivery retryable', async () => {
  const dir = temp(), seen: string[] = []
  const service = new ActivityService({ dataDir: dir, platform: 'darwin', recorder: { capture: async () => null }, extract: async s => { seen.push(s.id); return [] } })
  try {
    service.store.configure(0, { ...config, ocr_ai_enabled: true })
    const target = recognitionTarget(service.store.config())
    const add = (status: 'queued' | 'running', automatic: boolean, i: number) => service.store.addSource({
      ...sourceInput, ocr_text: '任务' + i, recognition: { status, automatic, target } }, Buffer.from('source' + i))!.id
    const one = add('queued', true, 1), ambiguous = add('running', true, 2), manual = add('queued', false, 3)
    service.start(); await turn()
    assert.deepEqual(seen, [one])
    for (const id of [ambiguous, manual]) {
      const receipt = service.store.sourceMetadata(id).recognition
      assert.ok(receipt?.status === 'failed' && receipt.code === 'INTERRUPTED')
    }
    await service.analyze(ambiguous)
    assert.deepEqual(seen, [one, ambiguous])
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('body OCR failure preserves the frame; local-only retry never contacts a model', async () => {
  const dir = temp()
  let calls = 0
  const service = new ActivityService({ dataDir: dir, platform: 'darwin', recorder: {
    capture: async supplied => { assert.equal(supplied.extraction_mode, 'vision'); return { ...sourceInput, image: png, ocr_text: '' } },
    ocrImage: async () => { if (!calls++) throw new ActivityError('OCR_FAILED', '本机 OCR 失败'); return '可核对消息' },
  }, extract: async () => assert.fail('no model consent') })
  try {
    service.store.configure(0, config)
    await assert.rejects(service.scan(), /OCR/)
    const item = service.state().sources[0]
    assert.equal(item.recognition?.status, 'failed')
    assert.equal((await service.handle({ type: 'activity.analyze', source_id: item.id, queue_only: true })).ok, true)
    await turn()
    assert.equal(service.store.source(item.id).ocr_text, '可核对消息')
    assert.equal(service.store.source(item.id).recognition?.status, 'saved')
    assert.equal(service.state().sources.length, 1)
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('recorded responses to synthetic chat images keep split actions and their feedback attached to the right window', () => {
  const dir = temp(), store = new ActivityStore(dir)
  try {
    const cases: Array<{ displayed: string[]; raw: string; binding: number; expectedNew: number }> =
      JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/activity-900-synthetic.json'), 'utf8'))
    for (const row of cases) {
      const before = store.state().candidates.length
      const source = store.addSource({ ...sourceInput, conversation_title: row.displayed[0], binding_id: String(row.binding), ocr_text: '' }, Buffer.from(row.displayed.join('\n')))!
      const result = parseActivityImage(row.raw, source)
      store.addCandidates(store.saveVisualTranscript(source, result.transcript), result.entries)
      assert.equal(store.state().candidates.length - before, row.expectedNew)
      for (const item of result.entries) {
        if (item.evidence.action_quote === '核对清单') assert.equal(item.feedback_required, false)
        if (item.evidence.action_quote === '把差异发给我') assert.equal(item.feedback_to, '小周')
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('OCR failure on an explicitly imported image returns its durable source and allows a local retry', async () => {
  const dir = temp()
  let calls = 0
  const service = new ActivityService({ dataDir: dir, platform: 'darwin', recorder: { capture: async () => null,
    ocrImage: async () => ++calls === 1 ? '' : '导入样图' }, extract: async () => assert.fail('local-only import') })
  try {
    const result = await service.handle({ type: 'activity.import', image_base64: png.toString('base64') })
    assert.equal(result.error_code, 'OCR_EMPTY')
    const item = service.state().sources[0]
    assert.equal(item.recognition?.status, 'failed')
    await service.analyze(item.id)
    assert.equal(service.store.source(item.id).ocr_text, '导入样图')
    assert.equal(service.state().sources.length, 1)
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('withdrawal stops delivery of the queued source and rejects late results of the running request', async () => {
  const dir = temp(), delivered: string[] = []
  let now = Date.now(), captures = 0, release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const service = new ActivityService({ dataDir: dir, platform: 'darwin', now: () => now, recorder: { capture: async () => ({
    ...sourceInput, ocr_text: '消息' + ++captures, image: Buffer.from(String(captures)) }) },
    extract: async source => { delivered.push(source.id); await hold; return [] } })
  try {
    service.store.configure(0, { ...config, ocr_ai_enabled: true, interval_ms: 3000 })
    service.start(); await turn()
    now += 3000; await service.tick()
    assert.deepEqual(service.state().sources.map(s => s.recognition?.status), ['queued', 'running'])
    await service.handle({ type: 'activity.configure', expected_revision: service.store.revision(), patch: { ocr_ai_enabled: false } })
    release(); await turn()
    assert.equal(delivered.length, 1)
    assert.ok(service.state().sources.every(s => s.recognition?.status === 'failed' && s.recognition.code === 'CANCELLED'))
    assert.equal(service.state().candidates.length, 0)
  } finally { release(); await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('retry after settings change queues behind a canceled OCR without letting the old result replace the receipt', async () => {
  const dir = temp()
  let release!: () => void, calls = 0
  const waiting = new Promise<void>(resolve => { release = resolve })
  const recorder: RecorderAdapter = {
    capture: async () => null,
    ocrImage: async () => {
      calls++
      if (calls === 1) { await waiting; throw new ActivityError('CANCELLED', '旧识别已取消') }
      return '重新识别后的内容'
    },
  }
  const service = new ActivityService({ dataDir: dir, platform: 'darwin', recorder })
  try {
    service.store.configure(0, config)
    const source = service.store.addSource({ ...sourceInput, ocr_text: '',
      recognition: { status: 'saved', reason: '等待识别' } }, png)!
    assert.equal((await service.handle({ type: 'activity.analyze', source_id: source.id, queue_only: true })).ok, true)
    await turn()
    assert.equal(calls, 1)
    assert.equal((await service.handle({ type: 'activity.configure', expected_revision: service.store.revision(),
      patch: { ocr_language: 'en-US' } })).ok, true)
    assert.equal((await service.handle({ type: 'activity.analyze', source_id: source.id, queue_only: true })).ok, true)
    assert.equal(service.store.sourceMetadata(source.id).recognition?.status, 'queued')
    release()
    for (let i = 0; i < 20 && calls < 2; i++) await turn()
    for (let i = 0; i < 20 && service.store.sourceMetadata(source.id).recognition?.status !== 'saved'; i++) await turn()
    assert.equal(calls, 2)
    assert.equal(service.store.source(source.id).ocr_text, '重新识别后的内容')
    assert.equal(service.store.sourceMetadata(source.id).recognition?.status, 'saved')
  } finally { release(); await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a legacy screenshot completion is refreshed once, then reused after restarting with the same model', async () => {
  const dir = temp(), store = new ActivityStore(dir)
  store.configure(0, { ocr_ai_enabled: true })
  const source = store.addSource({ ...sourceInput, app_id: 'manual.screenshot', window_title: '', origin: 'manual_import',
    recognition: { status: 'complete', completed_at: sourceInput.captured_at, candidates: 0 } }, png)!
  const requests: string[] = []
  const reopen = () => new ActivityService({ dataDir: dir, extract: async item => { requests.push(item.id); return [] } })
  let service = reopen()
  const intake = { type: 'activity.import', image_base64: png.toString('base64'), expected_model_target: 'ocr' }
  try {
    assert.equal((await service.handle(intake)).source_id, source.id)
    await turn()
    assert.deepEqual(requests, [source.id])
    assert.equal(service.store.sourceMetadata(source.id).recognition?.status, 'complete')
    await service.stop()
    service = reopen()
    assert.equal((await service.handle(intake)).source_id, source.id)
    await turn()
    assert.deepEqual(requests, [source.id])
    assert.equal(service.state().sources.length, 1)
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('desktop screenshot intake queues a specific source, retries a failed extraction and confirms editable fields', async () => {
  const dir = temp()
  const quote = '小陈整理报告，小林跟踪进度，发给小王。'
  let calls = 0
  const service = new ActivityService({ dataDir: dir, recorder: { capture: async () => null, ocrImage: async () => quote },
    extract: async source => {
      if (++calls === 1) throw new ActivityError('MODEL_FAILED', '测试模型暂时不可用')
      return parseExtractedCandidates(JSON.stringify({ candidates: [
        { title: '整理报告', owner: '小陈', tracker: '小林', feedback_to: '小王', quote },
        { title: '交付报告', owner: '小陈', tracker: '无依据的人', quote },
      ] }), source)
    } })
  try {
    const intake = { type: 'activity.import', image_base64: png.toString('base64'), expected_model_target: 'ocr' }
    assert.equal((await service.handle(intake)).ok, false)
    assert.equal(service.state().sources.length, 0)
    service.store.configure(0, { ocr_ai_enabled: true })
    assert.equal((await service.handle({ ...intake, expected_model_target: 'f'.repeat(64) })).ok, false)
    const reply = await service.handle(intake)
    assert.equal(reply.ok, true)
    const id = String(reply.source_id)
    for (let n = 0; n < 20 && service.store.sourceMetadata(id).recognition?.status !== 'failed'; n++) await turn()
    assert.equal(service.store.sourceMetadata(id).recognition?.status, 'failed')
    await turn() // The next user request arrives after the failed job releases the queue.
    await service.analyze(id)
    const repeated = await service.handle(intake)
    assert.equal(repeated.source_id, id)
    const state = service.state()
    assert.equal(calls, 2)
    assert.equal(state.sources.length, 1)
    assert.equal(state.todos.length, 0)
    assert.equal(state.candidates.length, 2)
    const draft = state.candidates.find(item => item.title === '整理报告')!
    assert.equal(draft.tracker, '小林')
    assert.equal(state.candidates.find(item => item.title === '交付报告')?.tracker, undefined)
    const task = { title: '整理周报', owner: '小陈', tracker: '小李', due_at: '2026-11-30T10:00:00.000Z' }
    const confirm = await service.handle({ type: 'todo.confirm', candidate_id: draft.id, expected_revision: draft.revision, task })
    assert.equal(confirm.ok, true)
    const saved = service.state().todos[0]
    assert.equal(saved.evidence.source_id, id)
    assert.equal(saved.feedback_to, '小王')
    assert.equal(saved.tracker, task.tracker)
    assert.equal(saved.due_at, task.due_at)
    assert.equal((await service.handle({ type: 'todo.update', todo_id: saved.id, expected_revision: saved.revision, patch: { tracker: '' } })).ok, true)
    assert.equal(service.state().todos[0].tracker, '')
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})
