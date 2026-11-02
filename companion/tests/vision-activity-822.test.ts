import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { analyzeImage } from '../src/llm/vision-pipeline'
import { getConfig, saveConfig } from '../src/config'
import { ActivityService } from '../src/activity/service'
import { activityModelTarget } from '../src/activity/model-config'
import { parseActivityImage, extractActivityImage } from '../src/activity/model-extract'
import { QwenVlSession } from '../src/computer/qwen-vl-session'
import { validateActivityMessage } from '../src/activity/validation'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const IMAGE = { base64: PNG, width: 1, height: 1, url: '', title: 'owned fixture' }

test('Anthropic vision sends image blocks with its auth; prompt changes cannot reuse cached descriptions', async () => {
  const previous = globalThis.fetch
  const bodies: any[] = [], requests: any[] = []
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), headers: init?.headers })
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ content: [{ type: 'text', text: `result-${bodies.length}` }], stop_reason: 'end_turn' }), { status: 200 })
  }
  try {
    const config = { enabled: true, base_url: 'https://vision.example/v1', protocol: 'anthropic' as const, api_key: 'owned-test-key', model_name: 'claude-owned-test', timeout_ms: 1000, max_tokens: 4000, cache_ttl_seconds: 60, fallback: 'error' as const }
    assert.equal((await analyzeImage(IMAGE, config, 'Describe')).description, 'result-1')
    assert.equal((await analyzeImage(IMAGE, config, 'Extract tasks')).description, 'result-2')
    assert.equal((await analyzeImage(IMAGE, config, 'Extract tasks')).cached, true)
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url, 'https://vision.example/v1/messages')
    assert.equal(requests[0].headers['x-api-key'], 'owned-test-key')
    assert.equal(requests[0].headers.Authorization, undefined)
    assert.deepEqual(bodies[0].messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } })
    assert.equal(bodies[1].messages[0].content[1].text, 'Extract tasks')
    assert.equal(bodies[1].max_tokens, 4000)
  } finally { globalThis.fetch = previous }
})

test('image import goes directly to the selected extractor, binds consent, redacts keys, and keeps candidate evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-822-'))
  let calls = 0
  const service = new ActivityService({ dataDir: directory, recorder: { capture: async () => assert.fail('capture not requested'), ocrImage: async () => assert.fail('image mode must not require OCR') },
    extract: async () => assert.fail('image mode must not call main text LLM'),
    extractImage: async (source, image, config) => {
      calls++; assert.deepEqual(image, Buffer.from(PNG, 'base64')); assert.equal(config.dedicated_vision?.api_key, 'private-image-key')
      return parseActivityImage(JSON.stringify({ transcript: '项目群\n小王：请提交方案', candidates: [{ title: '提交方案', quote: '请提交方案', sender: '小王', group: '项目群' }, { title: '编造', quote: '截图里没有这句话' }] }), source)
    },
  })
  try {
    const configure = async (patch: object) => service.handle({ type: 'activity.configure', expected_revision: service.state().revision, patch })
    assert.equal((await configure({ extraction_mode: 'dedicated', dedicated_vision: { base_url: 'https://private.example/v1', model_name: 'private-vl', api_key: 'private-image-key', protocol: 'anthropic' }, image_ai_enabled: false, ocr_ai_enabled: true })).ok, true)
    assert.equal((await service.handle({ type: 'activity.import', image_base64: PNG })).ok, true)
    assert.equal(calls, 0, 'OCR consent cannot authorize images')
    assert.equal((await configure({ image_ai_enabled: true })).ok, true)
    const source = service.state().sources[0]
    assert.equal((await service.handle({ type: 'activity.analyze', source_id: source.id })).ok, true)
    assert.equal(calls, 1)
    assert.equal(service.state().candidates.length, 1)
    assert.equal(service.state().todos.length, 0)
    assert.ok(service.store.source(source.id).ocr_text.includes('请提交方案'))
    assert.equal(service.state().candidates[0].evidence.quote, '请提交方案')
    assert.equal(service.state().candidates[0].due_at, null)
    assert.equal(JSON.stringify(await service.handle({ type: 'activity.state' })).includes('private-image-key'), false)
    assert.equal(service.state().config.dedicated_vision?.api_key_set, true)
    assert.equal((await configure({ dedicated_vision: { base_url: 'https://other.example/v1', model_name: 'other-vl', api_key: '', protocol: 'openai' } })).ok, true)
    assert.equal(service.state().config.image_ai_enabled, false)
    assert.equal((await service.handle({ type: 'activity.analyze', source_id: source.id })).ok, false)
    assert.equal(service.store.config().dedicated_vision?.api_key, 'private-image-key', 'empty UI key preserves saved credential')
    assert.equal(validateActivityMessage({ type: 'activity.configure', expected_revision: 0, patch: { image_ai_consent: 'forged' } }), false)
  } finally { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('authorized Qwen import skips OCR and cloud text paths; changing reused global target expires consent', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-822-local-'))
  let calls = 0
  const service = new ActivityService({ dataDir: directory, recorder: { capture: async () => null }, extract: async () => assert.fail('cloud text path used'),
    extractImage: async (source, _image, config) => { calls++; assert.equal(config.extraction_mode, 'qwen'); return parseActivityImage('{"transcript":"请提交方案","candidates":[{"title":"交方案","quote":"请提交方案"}]}', source) },
  })
  try {
    let reply = await service.handle({ type: 'activity.configure', expected_revision: service.state().revision, expected_model_target: service.state().runtime.model_target_ids?.qwen, patch: { extraction_mode: 'qwen', image_ai_enabled: true } })
    assert.equal(reply.ok, true)
    reply = await service.handle({ type: 'activity.import', image_base64: PNG })
    assert.equal(reply.ok, true); assert.equal(calls, 1); assert.equal(service.state().candidates.length, 1)
    assert.equal((await service.handle({ type: 'activity.configure', expected_revision: service.state().revision, expected_model_target: service.state().runtime.model_target_ids?.vision, patch: { extraction_mode: 'vision', image_ai_enabled: true } })).ok, true)
    const before = activityModelTarget(service.store.config()).id
    const original = getConfig().vision!
    saveConfig({ vision: { ...original, model_name: 'changed-after-image-consent' } })
    assert.notEqual(activityModelTarget(service.store.config()).id, before)
    assert.equal(service.state().config.image_ai_enabled, false)
    assert.equal((await service.handle({ type: 'activity.analyze', source_id: service.state().sources[0].id })).ok, false)
  } finally { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('revoking image consent cancels the active result before transcript/candidate persistence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-822-cancel-'))
  let release!: () => void, started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const hold = new Promise<void>(resolve => { release = resolve })
  const service = new ActivityService({ dataDir: directory, recorder: { capture: async () => null }, extractImage: async source => {
    started(); await hold; return parseActivityImage('{"transcript":"请提交方案","candidates":[{"title":"交方案","quote":"请提交方案"}]}', source)
  } })
  try {
    await service.handle({ type: 'activity.configure', expected_revision: 0, expected_model_target: service.state().runtime.model_target_ids?.qwen, patch: { extraction_mode: 'qwen', image_ai_enabled: true } })
    const pending = service.handle({ type: 'activity.import', image_base64: PNG })
    await ready
    assert.equal((await service.handle({ type: 'activity.configure', expected_revision: service.state().revision, patch: { image_ai_enabled: false } })).ok, true)
    release()
    assert.equal((await pending).ok, false)
    assert.equal(service.state().candidates.length, 0)
    assert.equal(service.store.source(service.state().sources[0].id).ocr_text, '')
  } finally { release(); await service.stop(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('production Qwen extraction uses only its local session and cleans up the temporary image', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-822-worker-'))
  const previous = { prepare: QwenVlSession.prototype.prepare, analyze: QwenVlSession.prototype.analyze, dispose: QwenVlSession.prototype.dispose, fetch: globalThis.fetch }
  let imageFile = '', disposed = 0
  QwenVlSession.prototype.prepare = async () => {}
  QwenVlSession.prototype.analyze = async (file, prompt) => {
    imageFile = file; assert.deepEqual(fs.readFileSync(file), Buffer.from(PNG, 'base64'))
    assert.ok(prompt.includes('transcript'))
    return '{"transcript":"请提交方案","candidates":[{"title":"交方案","quote":"请提交方案"}]}'
  }
  QwenVlSession.prototype.dispose = async () => { disposed++ }
  globalThis.fetch = async () => assert.fail('local Qwen may not use a cloud provider')
  try {
    const config = { enabled: false, allowed_apps: [], interval_ms: 30000, ocr_ai_enabled: false, retention_days: 14, max_storage_mb: 512, extraction_mode: 'qwen' as const, image_ai_enabled: true, image_ai_consent: '' }
    config.image_ai_consent = activityModelTarget(config).id
    const result = await extractActivityImage({ id: 'owned', app_id: 'manual.screenshot', app_name: 'owned', origin: 'manual_import', window_title: '', captured_at: new Date().toISOString(), ocr_text: '', sha256: '', bytes: 0 }, Buffer.from(PNG, 'base64'), config, directory, new AbortController().signal)
    assert.equal(result.entries.length, 1); assert.equal(disposed, 1); assert.equal(fs.existsSync(imageFile), false)
  } finally {
    Object.assign(QwenVlSession.prototype, { prepare: previous.prepare, analyze: previous.analyze, dispose: previous.dispose })
    globalThis.fetch = previous.fetch; fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('an open consent form cannot authorize a globally changed vision endpoint', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-822-stale-target-'))
  const service = new ActivityService({ dataDir: directory })
  try {
    const state = service.state(), shownTarget = state.runtime.model_target_ids!.vision
    saveConfig({ vision: { ...getConfig().vision!, base_url: 'https://changed-with-form-open.example/v1' } })
    assert.equal(service.state().revision, state.revision, 'global config writes do not revise activity state')
    const reply = await service.handle({ type: 'activity.configure', expected_revision: state.revision, expected_model_target: shownTarget, patch: { extraction_mode: 'vision', image_ai_enabled: true, interval_ms: 60000 } })
    assert.equal(reply.ok, false); assert.equal(reply.error_code, 'MODEL_TARGET_CHANGED')
    assert.equal(service.state().config.image_ai_enabled, false)
    assert.equal((await service.handle({ type: 'activity.configure', expected_revision: state.revision, expected_model_target: service.state().runtime.model_target_ids!.vision, patch: { extraction_mode: 'vision', image_ai_enabled: true } })).ok, true)
  } finally { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }) }
})
