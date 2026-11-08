import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MacPassiveRecorder } from '../src/activity/adapters'
import { LinuxPassiveRecorder } from '../src/activity/platform'
import { ActivityService } from '../src/activity/service'
import { DEFAULT_ACTIVITY_CONFIG, type ActivityPreview } from '../src/activity/types'
import { ActivityScopeSkip, imageSize } from '../src/activity/chat-scope'
import { decodePngToRgba } from '../src/computer/png-decode'
import { scope825Png } from './helpers/activity-scope825-image'

const content = { x: 20, y: 0, width: 60, height: 60 }
const title = { x: 25, y: 2, width: 40, height: 8 }
const png = scope825Png(80, 60, (x, y) => x < 20 ? [220, 0, 220, 255] : x > 40 && y > 30 ? [0, 40, 220, 255] : [255, 255, 255, 255])

function fixture(t: TestContext, platform: 'darwin' | 'linux') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-chat-scope-'))
  const root = path.join(dir, 'personal-activity')
  fs.mkdirSync(root)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const appId = platform === 'darwin' ? 'com.example.OwnedChat' : 'linux.' + 'a'.repeat(64)
  const window = { windowId: 42, pid: 42, bundleId: appId, ownerName: 'Owned Chat', name: 'Owned Window', layer: 0 }
  let recognized = 'ALPHA GROUP'
  const ocrSizes: Array<{ width: number; height: number }> = []
  const readOcr = (file: string) => {
    const size = imageSize(fs.readFileSync(file))
    ocrSizes.push(size)
    return size.width === title.width ? recognized : 'CHAT BODY'
  }
  const recorder = platform === 'darwin' ? new MacPassiveRecorder(root, 'darwin', {
    resolve: () => 'owned-host',
    run: async (_bin, args) => {
      if (args[0] === 'security-check') return JSON.stringify({ ok: true, axTrusted: true, secureInput: false })
      if (args[0] === 'window-list') return JSON.stringify({ ok: true, foregroundWindowId: window.windowId, windows: [window] })
      if (args[0] === 'screenshot') fs.writeFileSync(args[args.indexOf('--output') + 1], png)
      else if (args[0] === 'ocr') return JSON.stringify({ ok: true, words: [{ text: readOcr(args[args.indexOf('--image') + 1]) }] })
      else throw Error('unexpected native command')
      return JSON.stringify({ ok: true })
    },
  }) : new LinuxPassiveRecorder(root, async (bin, args) => {
    if (bin === '/usr/bin/tesseract') return readOcr(args[0])
    assert.equal(args[2], 'capture')
    fs.writeFileSync(args[3], png)
    return JSON.stringify({ ok: true, window: { window: 42, app_id: appId, app_name: window.ownerName, title: window.name } })
  }, () => 'owned-linux-recorder')
  return { dir, root, recorder, appId, ocrSizes,
    changeTitle: (value: string) => { recognized = value },
    changeLayout: (value: string) => { window.name = value },
  }
}

for (const platform of ['darwin', 'linux'] as const) {
  test(`${platform} configured scope cannot fall back to an entire app window`, async t => {
    const { recorder, appId, ocrSizes } = fixture(t, platform)
    await assert.rejects(recorder.capture({ ...DEFAULT_ACTIVITY_CONFIG, allowed_apps: [appId],
      chat_scopes: [{ app_id: appId, profiles: [] }] }, new AbortController().signal),
    error => error instanceof ActivityScopeSkip && error.status === 'scope_uncalibrated')
    assert.deepEqual(ocrSizes, [])
  })

  test(`${platform} work center preview, scope save and scan only retain an exact matching conversation`, async t => {
    const f = fixture(t, platform)
    if (platform === 'linux') {
      const previous = { DISPLAY: process.env.DISPLAY, XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY }
      process.env.DISPLAY = ':91'
      process.env.XDG_SESSION_TYPE = 'x11'
      delete process.env.WAYLAND_DISPLAY
      t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value })
    }
    let models = 0
    const service = new ActivityService({ dataDir: f.dir, platform, recorder: f.recorder, extract: async source => {
      models++
      assert.equal(source.ocr_text, 'CHAT BODY')
      assert.equal(source.conversation_title, 'ALPHA GROUP')
      return []
    } })
    const preview = await service.handle({ type: 'activity.preview', app_id: f.appId })
    assert.equal(preview.ok, true, JSON.stringify({ code: preview.code, error: preview.error }))
    assert.deepEqual(f.ocrSizes, [])
    const p = preview.preview as ActivityPreview
    const checked = await service.handle({ type: 'activity.preview_ocr', image_base64: p.image_data_url.split(',')[1], rect: title, ocr_language: 'en-US' })
    assert.equal(checked.recognized_title, 'ALPHA GROUP')
    const saved = await service.handle({ type: 'activity.configure', expected_revision: service.state().revision, patch: {
      enabled: true, allowed_apps: [f.appId], ocr_language: 'en-US', ocr_ai_enabled: true,
      chat_scopes: [{ app_id: f.appId, profiles: [{ window_class: p.window_class, width: p.width, height: p.height, content, title, allowed_titles: [checked.recognized_title] }] }],
    } })
    assert.equal(saved.ok, true, String(saved.error))
    f.changeTitle('ALPHA GROUP 2')
    await service.scan()
    assert.equal(service.state().runtime.status, 'scope_title_mismatch')
    assert.equal(service.state().sources.length, 0)
    assert.equal(models, 0)
    assert.deepEqual(f.ocrSizes, [{ width: 40, height: 8 }, { width: 40, height: 8 }])

    f.changeTitle('')
    await service.scan()
    assert.equal(service.state().runtime.status, 'scope_unreadable')
    f.changeLayout('Different Window')
    await service.scan()
    assert.equal(service.state().runtime.status, 'scope_layout_changed')
    assert.equal(service.state().sources.length, 0)
    assert.equal(models, 0)

    f.changeLayout('Owned Window')
    f.changeTitle('ALPHA GROUP')
    await service.scan()
    const [source] = service.state().sources
    assert.ok(source)
    assert.equal(models, 1)
    const imageUrl = service.store.source(source.id).image_data_url!
    const crop = decodePngToRgba(Buffer.from(imageUrl.split(',')[1], 'base64'))
    assert.deepEqual({ width: crop.width, height: crop.height }, { width: 60, height: 60 })
    assert.deepEqual(Array.from(crop.rgba.slice(0, 4)), [255, 255, 255, 255])
    assert.deepEqual(Array.from(crop.rgba.slice(-4)), [0, 40, 220, 255])
    assert.equal(fs.readdirSync(f.root).some(file => file.startsWith('pending-')), false)
  })
}
