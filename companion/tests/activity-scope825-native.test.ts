import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { withSurface650 } from './fixtures/native-surface-650'
import { buildScope825, scope825Receipt } from './helpers/activity-scope825-native'
import { WindowsPassiveRecorder } from '../src/activity/platform'
import { ActivityService } from '../src/activity/service'
import { DEFAULT_ACTIVITY_CONFIG, type ActivityChatProfile, type ActivityPreview, type ActivityRect } from '../src/activity/types'
import { activityModelTarget } from '../src/activity/model-config'
import { runPs, resolveWinScript } from '../src/host-use/win/powershell'
import { decodePngToRgba } from '../src/computer/png-decode'

const enabled = process.env.CMSPARK_ACTIVITY_NATIVE_758 === '1'
test('scope825 real Windows two-column chat gates local title, crops sidebar, keeps embedded image, and supports owned independent windows', { skip: process.platform !== 'win32' || !enabled, timeout: 180000 }, t => withSurface650(t, async (owned, lease) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope825-owned-')), root = path.join(dir, 'data')
  let child: ReturnType<typeof spawn> | undefined, ended = false, closed: Promise<void> | undefined, service: ActivityService | undefined
  try {
    const binary = await buildScope825(dir, owned.signal)
    child = spawn(binary, [dir], { windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr!.resume(); child.on('error', () => {})
    closed = new Promise<void>(resolve => child!.once('close', () => { ended = true; resolve() })); lease.retain()
    const ready = await scope825Receipt(path.join(dir, 'ready.json'), child, owned.signal, 'initial')
    const probe = async () => JSON.parse(await runPs(resolveWinScript('activity-windows.ps1'), ['-Mode', 'Probe'])).window
    const before = await probe(); assert.equal(before.pid, child.pid); assert.equal(before.hwnd, ready.hwnd); assert.ok(before.window_class)
    fs.mkdirSync(root, { mode: 0o700 })
    const adapter = new WindowsPassiveRecorder(path.join(root, 'personal-activity'))
    let models = 0
    const colored = (bytes: Buffer, color: 'sidebar' | 'picture') => {
      const pixels = decodePngToRgba(bytes).rgba; let count = 0
      for (let n = 0; n < pixels.length; n += 4) if (color === 'sidebar' ? pixels[n] > 200 && pixels[n + 1] < 15 && pixels[n + 2] > 200 : pixels[n] < 15 && pixels[n + 1] > 25 && pixels[n + 1] < 55 && pixels[n + 2] > 200) count++
      return count
    }
    service = new ActivityService({ dataDir: root, platform: 'win32', recorder: adapter, extractImage: async (_source, image, _config, _root, signal) => {
      models++; assert.equal(colored(image, 'sidebar'), 0, 'the model receives no sidebar pixels'); assert.ok(colored(image, 'picture') > 50, 'embedded image remains inside permitted content')
      const transcript = await adapter.ocrImage(image, 'en-US', signal)
      assert.match(transcript, /SEND\s+REPORT/i); assert.match(transcript, /FRIDAY/i); assert.doesNotMatch(transcript, /SIDEBAR\s+PRIVATE/i)
      return { transcript, entries: [] }
    } })
    const base = { ...DEFAULT_ACTIVITY_CONFIG, enabled: true, allowed_apps: [before.app_id], extraction_mode: 'qwen' as const, image_ai_enabled: true, ocr_language: 'en-US' as const }
    const configuration = { ...base, image_ai_consent: activityModelTarget(base).id }
    service.store.configure(0, configuration)
    const previewReply = await service.handle({ type: 'activity.preview', id: 'owned-main-preview', app_id: before.app_id })
    assert.equal(previewReply.ok, true)
    const preview = previewReply.preview as ActivityPreview, original = Buffer.from(preview.image_data_url.split(',')[1], 'base64')
    assert.ok(colored(original, 'sidebar') > 100); assert.equal(service.state().sources.length, 0); assert.equal(models, 0)
    function makeProfile(receipt: any, native: any, frame: ActivityPreview): ActivityChatProfile {
      const [left, top] = native.geometry.split(',').map(Number)
      const rect = (value: any): ActivityRect => ({ x: Math.round(value.x - left), y: Math.round(value.y - top), width: Math.round(value.width), height: Math.round(value.height) })
      return { window_class: frame.window_class, width: frame.width, height: frame.height, content: rect(receipt.content), title: rect(receipt.title), allowed_titles: ['BETA GROUP'] }
    }
    const main = makeProfile(ready, before, preview)
    const titleReply = await service.handle({ type: 'activity.preview_ocr', image_base64: original.toString('base64'), rect: main.title, ocr_language: 'en-US' })
    assert.equal(titleReply.ok, true); assert.match(titleReply.recognized_title as string, /^ALPHA\s+GROUP$/i)
    async function scopes(profiles: ActivityChatProfile[]) {
      const reply = await service!.handle({ type: 'activity.configure', expected_revision: service!.state().revision, patch: { chat_scopes: [{ app_id: before.app_id, profiles }] } })
      assert.equal(reply.ok, true)
    }
    await scopes([main])
    assert.equal((await service.handle({ type: 'activity.scan' })).ok, true)
    assert.equal(service.state().runtime.status, 'scope_title_mismatch'); assert.equal(service.state().sources.length, 0); assert.equal(models, 0)
    main.allowed_titles = [String(titleReply.recognized_title)]; await scopes([main])
    assert.equal((await service.handle({ type: 'activity.scan' })).ok, true)
    assert.equal(service.state().runtime.status, 'ready_for_review'); assert.equal(models, 1); assert.equal(service.state().sources.length, 1)
    const source = service.state().sources[0]; assert.equal(source.conversation_title, titleReply.recognized_title)
    const saved = service.store.source(source.id).image_data_url!; assert.equal(colored(Buffer.from(saved.split(',')[1], 'base64'), 'sidebar'), 0)
    assert.equal((await probe()).hwnd, ready.hwnd, 'passive capture never changes foreground identity')
    async function control(command: 'resize' | 'popup') {
      const file = path.join(dir, 'control.json'); fs.writeFileSync(file + '.pending', JSON.stringify({ command }), { flag: 'wx' }); fs.renameSync(file + '.pending', file)
      const ack = await scope825Receipt(path.join(dir, 'ack.json'), child!, owned.signal, command); fs.unlinkSync(path.join(dir, 'ack.json')); return ack
    }
    await control('resize')
    assert.equal((await service.handle({ type: 'activity.scan' })).ok, true); assert.equal(service.state().runtime.status, 'scope_layout_changed'); assert.equal(models, 1)
    const popupReady = await control('popup'), popupNative = await probe()
    assert.equal(popupNative.hwnd, popupReady.hwnd); assert.equal(popupNative.pid, child.pid)
    const popupReply = await service.handle({ type: 'activity.preview', app_id: before.app_id }); assert.equal(popupReply.ok, true)
    const popup = popupReply.preview as ActivityPreview, independent = makeProfile(popupReady, popupNative, popup)
    const popupTitle = await service.handle({ type: 'activity.preview_ocr', image_base64: popup.image_data_url.split(',')[1], rect: independent.title, ocr_language: 'en-US' })
    assert.equal(popupTitle.ok, true); assert.match(popupTitle.recognized_title as string, /^ALPHA\s+GROUP$/i)
    independent.allowed_titles = [String(popupTitle.recognized_title)]; await scopes([main, independent])
    assert.equal((await service.handle({ type: 'activity.scan' })).ok, true); assert.equal(service.state().runtime.status, 'ready_for_review'); assert.equal(models, 2)
    assert.equal(fs.readdirSync(service.store.root).filter(name => name.startsWith('pending-')).length, 0)
    console.log(JSON.stringify({ capability: 'scope825', windowsNative: true, mainAndIndependent: true, sidebarDecoyRefused: true, localOcrAndCrop: true, modelSidebarAbsent: true, embeddedImagePreserved: true, resizeRefused: true, pendingCleaned: true }))
  } finally {
    await service?.stop()
    if (child && !ended) child.kill()
    if (closed) await closed
    try { t.diagnostic('D825_SCOPE_INITIAL ' + JSON.stringify(require(path.resolve('tests/helpers/activity-scope825-observation.cjs'))(dir))) } catch { /* Passive projection cannot skip cleanup or replace the primary failure. */ }
    fs.rmSync(dir, { recursive: true, force: true }); lease.settled()
  }
}))
