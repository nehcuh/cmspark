import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WindowsPassiveRecorder } from '../src/activity/platform'
import { DEFAULT_ACTIVITY_CONFIG, type ActivityConfig, type ActivityChatProfile, type ActivityRect } from '../src/activity/types'
import { ActivityScopeSkip, imageSize, profileForFrame, recognizedChatTitle } from '../src/activity/chat-scope'
import { validateActivityMessage, validateConfig } from '../src/activity/validation'
import { ActivityService } from '../src/activity/service'
import { ActivityStore } from '../src/activity/store'
import { activityModelTarget } from '../src/activity/model-config'
import { decodePngToRgba } from '../src/computer/png-decode'
import { scope825Png } from './helpers/activity-scope825-image'
import type { PsRunner } from '../src/host-use/win/powershell'

const id = 'win.' + 'a'.repeat(64)
const profile: ActivityChatProfile = { window_class: 'OwnedChatMain', width: 80, height: 60, content: { x: 20, y: 0, width: 60, height: 60 }, title: { x: 25, y: 2, width: 40, height: 8 }, allowed_titles: ['ALPHA GROUP'] }
const config = (): ActivityConfig => ({ ...DEFAULT_ACTIVITY_CONFIG, enabled: true, allowed_apps: [id], extraction_mode: 'vision', ocr_language: 'en-US', chat_scopes: [{ app_id: id, profiles: [structuredClone(profile)] }] })
const image = scope825Png(80, 60, (x, y) => x < 20 ? [220, 0, 220, 255] : x > 40 && y > 30 ? [0, 40, 220, 255] : [255, 255, 255, 255])
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'activity-scope825-'))
function nativeDouble(root: string, options: { title?: string; failOcr?: boolean; afterClass?: string; source?: Buffer; cropClamp?: boolean; abort?: AbortController } = {}) {
  const calls: Array<{ name: string; args: string[] }> = []; let probes = 0
  const window = { hwnd: 42, pid: 100, started: 'owned-start', app_id: id, app_name: 'Owned Chat', exe: 'c:\\owned\\chat.exe', title: 'Owned Main Window', window_class: 'OwnedChatMain', geometry: '0,0,80,60', safe: true }
  const run: PsRunner = async (name, args) => {
    calls.push({ name, args })
    if (name === 'activity-windows.ps1') return JSON.stringify({ ok: true, window: { ...window, window_class: probes++ && options.afterClass ? options.afterClass : window.window_class } })
    if (name === 'computer-probe.ps1') return JSON.stringify({ desktop: 'Default', pid: 100, ownIl: 8192, targetIl: 8192 })
    if (name === 'computer-capture.ps1') {
      const output = args[args.indexOf('-OutPath') + 1]
      if (args.includes('-CropOf')) {
        const input = decodePngToRgba(fs.readFileSync(args[args.indexOf('-CropOf') + 1]))
        const number = (key: string) => Number(args[args.indexOf(key) + 1])
        const x = number('-CropX'), y = number('-CropY'), width = number('-CropW') - (options.cropClamp ? 1 : 0), height = number('-CropH')
        fs.writeFileSync(output, scope825Png(width, height, (cx, cy) => Array.from(input.rgba.slice(((y + cy) * input.width + x + cx) * 4, ((y + cy) * input.width + x + cx) * 4 + 4))))
        return JSON.stringify({ ok: true, mode: 'crop' })
      }
      fs.writeFileSync(output, options.source || image)
      return JSON.stringify({ ok: true, restoredFromIconic: false, observation_quality: 'ok', occludedBy: [] })
    }
    if (name === 'computer-ocr.ps1') {
      if (options.failOcr) throw Error('owned OCR unavailable')
      const read = fs.readFileSync(args[args.indexOf('-ImagePath') + 1]), size = imageSize(read)
      assert.equal(size.width, profile.title.width, 'title OCR sees the title crop, never the whole frame')
      options.abort?.abort()
      return JSON.stringify({ ok: true, words: (options.title ?? 'ALPHA GROUP').split(' ').map(text => ({ text })) })
    }
    throw Error('UNEXPECTED_OWNED_NATIVE_CALL')
  }
  return { adapter: new WindowsPassiveRecorder(root, run, name => name), calls }
}

test('scope825 config accepts explicit uncalibrated restrictions and rejects ambiguous or out-of-frame profiles', () => {
  assert.doesNotThrow(() => validateConfig({ chat_scopes: [{ app_id: id, profiles: [] }] }))
  assert.doesNotThrow(() => validateConfig({ chat_scopes: config().chat_scopes }))
  for (const change of [
    { profiles: [profile, profile] },
    { profiles: [{ ...profile, title: { x: 0, y: 0, width: 10, height: 10 } }] },
    { profiles: [{ ...profile, content: { x: 20, y: 0, width: 70, height: 60 } }] },
    { profiles: [{ ...profile, allowed_titles: [' ALPHA GROUP'] }] },
    { profiles: [{ ...profile, allowed_titles: [] }] },
  ]) assert.throws(() => validateConfig({ chat_scopes: [{ app_id: id, ...change }] }))
  assert.throws(() => validateConfig({ chat_scopes: [{ app_id: id, profiles: [] }, { app_id: id, profiles: [] }] }))
})
test('scope825 exact OCR projection is identical for preview and capture, without substring or whitespace rewriting', () => {
  assert.equal(recognizedChatTitle({ ok: true, words: [{ text: 'ALPHA' }, { text: 'GROUP' }] }), 'ALPHA GROUP')
  assert.equal(recognizedChatTitle({ ok: true, words: [{ text: ' ALPHA  GROUP ' }] }), 'ALPHA  GROUP')
  assert.throws(() => recognizedChatTitle({ ok: true, words: [{ text: 1 }] }))
  assert.equal(validateActivityMessage({ type: 'activity.preview', app_id: id }), true)
  assert.equal(validateActivityMessage({ type: 'activity.preview', app_id: 'linux.invalid' }), false)
  assert.equal(validateActivityMessage({ type: 'activity.preview_ocr', image_base64: image.toString('base64'), rect: profile.title, ocr_language: 'en-US' }), true)
  assert.equal(validateActivityMessage({ type: 'activity.preview_ocr', image_base64: image.toString('base64'), rect: profile.title, ocr_language: 'unknown' }), false)
})
test('scope825 one frozen frame is title-gated then content-cropped, excluding sidebar and preserving embedded image pixels', async () => {
  const root = fresh()
  try {
    const d = nativeDouble(root), result = await d.adapter.capture(config(), new AbortController().signal)
    assert.ok(result); assert.equal(result.conversation_title, 'ALPHA GROUP'); assert.equal(result.window_title, 'Owned Main Window')
    assert.deepEqual(imageSize(result.image), { width: 60, height: 60 })
    const pixels = decodePngToRgba(result.image).rgba
    assert.equal(Array.from({ length: pixels.length / 4 }, (_, n) => pixels[n * 4] === 220 && pixels[n * 4 + 2] === 220).some(Boolean), false)
    assert.ok(Array.from({ length: pixels.length / 4 }, (_, n) => pixels[n * 4 + 2] === 220 && pixels[n * 4] === 0).some(Boolean))
    assert.equal(d.calls.filter(call => call.name === 'computer-capture.ps1' && !call.args.includes('-CropOf')).length, 1)
    assert.equal(d.calls.filter(call => call.name === 'computer-capture.ps1' && call.args.includes('-CropOf')).length, 2)
    assert.deepEqual(fs.readdirSync(root), [])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
for (const title of ['BETA GROUP', 'ALPHA', 'ALPHA GROUP 2']) test(`scope825 refuses mismatched title ${JSON.stringify(title)} before any content crop`, async () => {
  const root = fresh()
  try { const d = nativeDouble(root, { title }); await assert.rejects(d.adapter.capture(config(), new AbortController().signal), error => error instanceof ActivityScopeSkip && error.status === 'scope_title_mismatch'); assert.equal(d.calls.filter(call => call.name === 'computer-capture.ps1' && call.args.includes('-CropOf')).length, 1); assert.deepEqual(fs.readdirSync(root), []) }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
})
test('scope825 uncalibrated, resized, different class and native crop/OCR faults refuse without retained temporary images', async () => {
  const root = fresh()
  try {
    const empty = config(); empty.chat_scopes![0].profiles = []
    const d = nativeDouble(root); await assert.rejects(d.adapter.capture(empty, new AbortController().signal), ActivityScopeSkip)
    assert.equal(d.calls.some(call => call.name === 'computer-capture.ps1'), false)
    assert.throws(() => profileForFrame(config(), id, 'OtherClass', image), ActivityScopeSkip)
    assert.throws(() => profileForFrame(config(), id, profile.window_class, scope825Png(81, 60)), ActivityScopeSkip)
    for (const options of [{ failOcr: true }, { cropClamp: true }, { title: '' }]) await assert.rejects(nativeDouble(root, options).adapter.capture(config(), new AbortController().signal), error => error instanceof ActivityScopeSkip && error.status === 'scope_unreadable')
    const changed = await nativeDouble(root, { afterClass: 'OtherClass' }).adapter.capture(config(), new AbortController().signal); assert.equal(changed, null)
    const abort = new AbortController(); await assert.rejects(nativeDouble(root, { abort }).adapter.capture(config(), abort.signal))
    assert.deepEqual(fs.readdirSync(root), [])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
test('scope825 readonly handlers bypass only old scope and never create sources or model requests', async () => {
  const root = fresh(); let captures = 0, titles = 0, models = 0
  const service = new ActivityService({ dataDir: root, platform: 'win32', recorder: {
    capture: async supplied => { captures++; assert.deepEqual(supplied.chat_scopes, []); assert.deepEqual(supplied.allowed_apps, [id]); assert.equal(supplied.extraction_mode, 'vision'); return { app_id: id, app_name: 'Owned', window_title: 'Owned Main', window_class: 'OwnedChatMain', image, ocr_text: '' } },
    ocrTitle: async (png, rect, language) => { titles++; assert.ok(png.equals(image)); assert.deepEqual(rect, profile.title); assert.equal(language, 'en-US'); return 'ALPHA GROUP' },
  }, extractImage: async () => { models++; throw Error('must not call AI') } })
  try {
    service.store.configure(0, { chat_scopes: [{ app_id: id, profiles: [] }] })
    const before = service.state().revision
    const preview = await service.handle({ type: 'activity.preview', id: 'preview', app_id: id })
    assert.equal(preview.ok, true); assert.equal((preview.preview as any).window_class, 'OwnedChatMain')
    const title = await service.handle({ type: 'activity.preview_ocr', id: 'ocr', image_base64: image.toString('base64'), rect: profile.title, ocr_language: 'en-US' })
    assert.equal(title.ok, true); assert.equal(title.recognized_title, 'ALPHA GROUP')
    assert.equal(captures, 1); assert.equal(titles, 1); assert.equal(models, 0); assert.equal(service.state().revision, before); assert.equal(service.state().sources.length, 0)
  } finally { await service.stop(); fs.rmSync(root, { recursive: true, force: true }) }
})
test('scope825 readonly calibration serializes with scan and rejects generation or session changes', async () => {
  for (const change of ['configure', 'disconnect'] as const) {
    const root = fresh(); let finish!: (value: any) => void, current = true
    const service = new ActivityService({ dataDir: root, platform: 'win32', recorder: { capture: () => new Promise(resolve => { finish = resolve }) } })
    try {
      const pending = service.handle({ type: 'activity.preview', app_id: id }, () => current)
      assert.equal((await service.handle({ type: 'activity.preview', app_id: id })).error_code, 'BUSY')
      if (change === 'configure') await service.handle({ type: 'activity.configure', expected_revision: service.state().revision, patch: { enabled: false } }); else current = false
      finish({ app_id: id, app_name: 'Owned', window_title: 'Owned', window_class: 'OwnedChatMain', image, ocr_text: '' })
      assert.equal((await pending).ok, false); assert.equal(service.state().sources.length, 0)
    } finally { await service.stop(); fs.rmSync(root, { recursive: true, force: true }) }
  }
})
test('manual preview takes priority over automatic capture without overlapping native reads', async () => {
  const root = fresh()
  let finish!: () => void, automaticSignal!: AbortSignal, captures = 0
  const frame = { app_id: id, app_name: 'Owned', window_title: 'Owned', window_class: 'OwnedChatMain', image, ocr_text: '' }
  const service = new ActivityService({ dataDir: root, platform: 'win32', recorder: {
    capture: async (_config, signal) => {
      if (++captures === 1) {
        automaticSignal = signal
        await new Promise<void>(resolve => { finish = resolve })
      }
      return frame
    },
  } })
  try {
    service.store.configure(0, config())
    service.start()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(captures, 1)
    const preview = service.handle({ type: 'activity.preview', app_id: id })
    assert.equal(automaticSignal.aborted, true)
    assert.equal(captures, 1)
    assert.equal((await service.handle({ type: 'activity.preview', app_id: id })).error_code, 'BUSY')
    finish()
    assert.equal((await preview).ok, true)
    assert.equal(captures, 2)
    assert.equal(service.state().sources.length, 0)
  } finally { finish?.(); await service.stop(); fs.rmSync(root, { recursive: true, force: true }) }
})
test('manual preview can capture while an automatic source is being analyzed', async () => {
  const root = fresh()
  let finish!: () => void, modelSignal!: AbortSignal
  const frame = { app_id: id, app_name: 'Owned', window_title: 'Owned', window_class: 'OwnedChatMain', image, ocr_text: 'Owned task' }
  const service = new ActivityService({ dataDir: root, platform: 'win32', recorder: { capture: async () => frame },
    extract: async (_source, signal) => {
      modelSignal = signal
      await new Promise<void>(resolve => { finish = resolve })
      return []
    },
  })
  try {
    service.store.configure(0, { ...config(), extraction_mode: 'ocr', ocr_ai_enabled: true })
    service.start()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.ok(modelSignal)
    assert.equal((await service.handle({ type: 'activity.preview', app_id: id })).ok, true)
    assert.equal(modelSignal.aborted, false)
    assert.equal(service.state().sources.length, 1)
    finish()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(service.state().runtime.status, 'ready_for_review')
  } finally { finish?.(); await service.stop(); fs.rmSync(root, { recursive: true, force: true }) }
})
test('scope825 refusal is a normal visible status and stores no source or model request', async () => {
  const root = fresh(); let models = 0
  const service = new ActivityService({ dataDir: root, platform: 'win32', recorder: { capture: async () => { throw new ActivityScopeSkip('scope_title_mismatch', 'Owned mismatch') } }, extractImage: async () => { models++; throw Error('must not call') } })
  try {
    service.store.configure(0, config())
    const result = await service.handle({ type: 'activity.scan' })
    assert.equal(result.ok, true); assert.equal(service.state().runtime.status, 'scope_title_mismatch'); assert.equal(service.state().runtime.scope_note, 'Owned mismatch'); assert.equal(service.state().runtime.last_success_at, null); assert.equal(service.state().sources.length, 0); assert.equal(models, 0)
  } finally { await service.stop(); fs.rmSync(root, { recursive: true, force: true }) }
})
test('scope825 real service persists and sends only the scoped adapter image to the model seam', async () => {
  const root = fresh(); let models = 0
  const storeRoot = path.join(root, 'personal-activity'); fs.mkdirSync(storeRoot)
  const d = nativeDouble(storeRoot)
  const service = new ActivityService({ dataDir: root, platform: 'win32', recorder: d.adapter, extractImage: async (source, pixels) => {
    models++; assert.equal(source.conversation_title, 'ALPHA GROUP'); assert.deepEqual(imageSize(pixels), { width: 60, height: 60 })
    const decoded = decodePngToRgba(pixels).rgba
    assert.equal(Array.from({ length: decoded.length / 4 }, (_, n) => decoded[n * 4] === 220 && decoded[n * 4 + 2] === 220).some(Boolean), false)
    return { transcript: 'SEND REPORT FRIDAY', entries: [] }
  } })
  try {
    const cfg = { ...config(), extraction_mode: 'qwen' as const, image_ai_enabled: true }
    service.store.configure(0, { ...cfg, image_ai_consent: activityModelTarget(cfg).id })
    assert.equal((await service.handle({ type: 'activity.scan' })).ok, true); assert.equal(models, 1)
    const source = service.store.source(service.state().sources[0].id)
    assert.equal(source.conversation_title, 'ALPHA GROUP')
    assert.deepEqual(imageSize(Buffer.from(source.image_data_url!.split(',')[1], 'base64')), { width: 60, height: 60 })
  } finally { await service.stop(); fs.rmSync(root, { recursive: true, force: true }) }
})
test('scope825 scope revocation during title recognition cannot store or send the old frame', async () => {
  const root = fresh(); let models = 0, resume!: () => void, entered!: () => void
  const arrived = new Promise<void>(resolve => { entered = resolve }), wait = new Promise<void>(resolve => { resume = resolve })
  const storeRoot = path.join(root, 'personal-activity'); fs.mkdirSync(storeRoot)
  const d = nativeDouble(storeRoot), ocr = d.adapter.ocrTitle.bind(d.adapter)
  d.adapter.ocrTitle = async (...args) => { const result = await ocr(...args); entered(); await wait; return result }
  const service = new ActivityService({ dataDir: root, platform: 'win32', recorder: d.adapter, extractImage: async () => { models++; throw Error('must not send revoked frame') } })
  try {
    const cfg = { ...config(), extraction_mode: 'qwen' as const, image_ai_enabled: true }
    service.store.configure(0, { ...cfg, image_ai_consent: activityModelTarget(cfg).id })
    const scanning = service.handle({ type: 'activity.scan' })
    await arrived
    assert.equal((await service.handle({ type: 'activity.configure', expected_revision: service.state().revision, patch: { allowed_apps: [] } })).ok, true)
    resume(); await scanning
    assert.equal(service.state().sources.length, 0); assert.equal(models, 0)
    assert.equal(fs.readdirSync(service.store.root).filter(name => name.startsWith('pending-')).length, 0)
  } finally { resume?.(); await service.stop(); fs.rmSync(root, { recursive: true, force: true }) }
})
test('scope825 deduplication keeps same-text different conversations as separate evidence', () => {
  const root = fresh()
  try {
    const store = new ActivityStore(root), base = { app_id: id, app_name: 'Owned', window_title: 'Same Main', captured_at: new Date().toISOString(), ocr_text: 'Same message' }
    assert.ok(store.addSource({ ...base, conversation_title: 'ALPHA GROUP' }, image))
    assert.ok(store.addSource({ ...base, conversation_title: 'BETA GROUP' }, image))
    assert.equal(store.addSource({ ...base, conversation_title: 'ALPHA GROUP' }, image), null)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
