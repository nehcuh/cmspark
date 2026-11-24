import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getConfig, saveConfig } from '../src/config'
import { ActivityService } from '../src/activity/service'
import { activityImageCrop, scopeLocalFrame } from '../src/activity/chat-scope'
import { ActivityError, type ActivityChatProfile, type ActivityConfig } from '../src/activity/types'
import { scope825Png } from './helpers/activity-scope825-image'

const app = 'com.example.FixtureChat'
const profile: ActivityChatProfile = { window_class: 'owned', width: 80, height: 60,
  content: { x: 20, y: 0, width: 60, height: 60 }, title: { x: 25, y: 4, width: 20, height: 8 }, allowed_titles: ['自有测试群'] }
const scope = { enabled: true, allowed_apps: [app], chat_scopes: [{ app_id: app, profiles: [profile] }] }
const screenshot = (color: number) => scope825Png(80, 60, (x, y) => [x, y, color, 255])
const metadata = { app_id: app, app_name: 'fixture', window_title: 'Fixture main', ocr_text: '' }

async function configure(service: ActivityService, patch: Partial<ActivityConfig>, target?: string) {
  return service.handle({ type: 'activity.configure', expected_revision: service.store.revision(), patch, expected_model_target: target })
}

test('reused and dedicated vision read only the calibrated title with separate consent and exact matching', async () => {
  const original = getConfig().vision!, fetchBefore = globalThis.fetch
  const requests: Array<{ url: string; body: any }> = []
  let reply = '', frame = screenshot(1), local = ''
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: reply }) } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-title-900-'))
  let bodyCalls = 0
  const service = new ActivityService({ dataDir: dir, platform: 'darwin', recorder: {
    capture: async (config, signal) => ({ ...metadata, ...await scopeLocalFrame(config, app, 'owned', frame, signal, async () => {
      if (!local) throw new ActivityError('OCR_LANGUAGE_MISSING', 'test OCR unavailable')
      return local
    }) }),
  }, extractImage: async () => { bodyCalls++; return { transcript: '消息', entries: [] } } })
  try {
    saveConfig({ vision: { ...original, base_url: 'http://127.0.0.1:8821', model_name: 'reused-fixture', protocol: 'openai', cache_ttl_seconds: 0 } })
    const target = service.state().runtime.model_target_ids!.vision
    assert.equal((await configure(service, { ...scope, extraction_mode: 'vision', image_ai_enabled: true }, target)).ok, true)
    const scan = () => service.handle({ type: 'activity.scan' })
    assert.equal((await scan()).error_code, 'OCR_LANGUAGE_MISSING')
    assert.equal(requests.length, 0)
    assert.equal((await configure(service, { title_ai_enabled: true }, '0'.repeat(64))).error_code, 'MODEL_TARGET_CHANGED')
    assert.equal((await configure(service, { title_ai_enabled: true, image_ai_enabled: false }, target)).ok, true)
    for (const mode of ['vision', 'dedicated'] as const) {
      if (mode === 'dedicated') {
        assert.equal((await configure(service, { extraction_mode: mode, dedicated_vision: {
          base_url: 'http://127.0.0.1:8822', model_name: 'dedicated-fixture', protocol: 'openai', api_key: '',
        } })).ok, true)
        assert.equal(service.state().config.title_ai_enabled, false)
        assert.equal((await configure(service, { title_ai_enabled: true }, service.state().runtime.model_target_ids!.dedicated)).ok, true)
      }
      reply = '自有测试群二'
      frame = screenshot(requests.length + 10)
      await scan()
      assert.equal(service.state().runtime.status, 'scope_title_mismatch')
      const request = requests.at(-1)!
      assert.match(request.url, mode === 'vision' ? /:8821\// : /:8822\//)
      const parts = request.body.messages[0].content
      assert.equal(parts.filter((part: any) => part.type === 'image_url').length, 1)
      assert.equal(parts.find((part: any) => part.type === 'image_url').image_url.url,
        'data:image/png;base64,' + activityImageCrop(frame)(profile.title).toString('base64'))
      assert.ok(!JSON.stringify(request.body).includes(profile.allowed_titles[0]), 'model must transcribe without seeing allowed answers')
      reply = profile.allowed_titles[0]; frame = screenshot(requests.length + 80)
      assert.equal((await scan()).ok, true)
      const source = service.state().sources[0]
      assert.equal(source.conversation_title, reply)
      assert.equal(source.recognition?.status, 'saved')
      assert.equal(service.store.source(source.id).image_data_url, 'data:image/png;base64,' + activityImageCrop(frame)(profile.content).toString('base64'))
      assert.equal(service.state().sources.length, mode === 'vision' ? 1 : 2)
    }
    const before = requests.length
    local = profile.allowed_titles[0]; frame = screenshot(160); await scan()
    assert.equal(requests.length, before, 'a matching local title needs no remote title request')
    assert.equal(bodyCalls, 0, 'title consent alone never sends the body')
    assert.equal((await configure(service, { title_ai_consent: target })).ok, false)
    local = ''
    assert.equal((await configure(service, { chat_scopes: [{ app_id: app, profiles: [{ ...profile, title: profile.content }] }] })).ok, true)
    await scan()
    assert.equal(service.state().runtime.status, 'scope_unreadable')
    assert.equal(requests.length, before, 'an entire message region cannot be submitted as a title')
  } finally { globalThis.fetch = fetchBefore; saveConfig({ vision: original }); await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a pending title does not block new scans and revoking title consent discards an in-flight frame', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-title-delay-900-'))
  let finish!: (title: string) => void, localMatch = false, frameNo = 0, reads = 0, now = Date.now()
  const nextFrame = () => {
    frameNo++
    return scope825Png(80, 60, (x, y) => [x, y, y < 15 ? 0 : frameNo, 255])
  }
  const service = new ActivityService({ dataDir: dir, platform: 'darwin', now: () => now,
    readModelTitle: async () => new Promise(resolve => { reads++; finish = resolve }),
    recorder: { capture: async (config, signal) => ({ ...metadata, ...await scopeLocalFrame(config, app, 'owned', nextFrame(), signal, async () => localMatch ? profile.allowed_titles[0] : 'OCR错字') }) } })
  try {
    const target = service.state().runtime.model_target_ids!.vision
    assert.equal((await configure(service, { ...scope, extraction_mode: 'vision', title_ai_enabled: true }, target)).ok, true)
    const first = service.scan()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(service.state().runtime.status, 'scope_title_pending')
    assert.equal(service.state().sources.length, 0)
    assert.equal(fs.readdirSync(service.store.root).filter(file => file.endsWith('.png')).length, 0)
    now += 3000
    const second = service.scan()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(reads, 1, 'identical pending title crops share one model read')
    localMatch = true; now += 3000; await service.scan()
    assert.equal(service.state().sources.length, 1)
    finish(profile.allowed_titles[0]); await Promise.all([first, second])
    assert.deepEqual(service.state().sources.map(s => s.captured_at), [now, now - 3000, now - 6000].map(stamp => new Date(stamp).toISOString()))
    localMatch = false; now += 3000
    const pending = service.scan()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await configure(service, { title_ai_enabled: false })).ok, true)
    finish(profile.allowed_titles[0]); await pending
    assert.equal(service.state().sources.length, 3)
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})
