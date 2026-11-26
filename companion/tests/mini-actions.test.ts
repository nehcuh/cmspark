import './helpers/require-isolated-config-825'
import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { getConfig, saveConfig } from '../src/config'
import { activityModelTarget } from '../src/activity/model-config'
import { DEFAULT_ACTIVITY_CONFIG } from '../src/activity/types'
import { openMiniAction } from '../src/mini/actions'
import { MiniCaptureHandoff, miniPanelOwner } from '../src/mini/capture-handoff'
import { miniPanelRequest } from '../src/mini/panel-request'
import { handleUiOpenSidepanel, handleUiOpenSidepanelResult } from '../src/message-router/handlers/ui-open-sidepanel'
import type { SkillEngine } from '../src/skills/skill-engine'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYz0AAAAASUVORK5CYII='
const doc = { id: 'brief', title: 'Release', name: 'brief', type: 'domain_knowledge' as const, tags: ['launch'], description: '验收说明', body: '实际正文', char_count: 4, builtin: false, truncated: false, related: [] }
const knowledge: Pick<SkillEngine, 'getKnowledge' | 'listKnowledge'> = { listKnowledge: () => [doc], getKnowledge: id => id === doc.id ? doc : undefined }
const panel = { panelId: 'selected-profile', surface: 'panel', origin: 'chrome-extension://selected', isCurrentSession: () => true }

test('desk region goes through the real tray command and only the elected extension can claim the exact PNG', async () => {
  let frame: Record<string, unknown> = {}
  const session = {
    surface: 'tray', origin: 'cmspark-tray://local', broadcast: () => assert.fail('must not broadcast the region'),
    miniPanel: () => ({ id: panel.panelId, send: (f: Record<string, unknown>) => {
      frame = f
      assert.equal(frame.destination, 'mini_todo')
      assert.equal(frame.image_base64, undefined)
      handleUiOpenSidepanelResult({ ...f, ok: true }, panel)
    } }),
  }
  await openMiniAction({ sendAppRequest: async (type, body) => {
    assert.equal(type, 'ui.open_sidepanel')
    return handleUiOpenSidepanel(body!, session)
  } }, 'todo', Buffer.from(png, 'base64'))
  const claim = { op: 'claim', action: 'todo', ticket: frame.ticket }
  assert.equal((await miniPanelRequest(claim, { ...panel, panelId: 'other' }, knowledge)).ok, false)
  assert.equal((await miniPanelRequest(claim, { ...panel, surface: 'tray' }, knowledge)).ok, false)
  const accepted = await miniPanelRequest(claim, panel, knowledge)
  assert.ok('image_base64' in accepted)
  assert.equal(accepted.image_base64, png)
  assert.equal((await miniPanelRequest(claim, panel, knowledge)).ok, false)
})

test('Mini meetings open in the elected browser without capturing a PNG', async () => {
  const open = (meetingOpened?: boolean) => handleUiOpenSidepanel({ destination: 'mini_meeting' }, {
    surface: 'tray', origin: 'cmspark-tray://local', broadcast: () => assert.fail('must target the elected browser'),
    miniPanel: () => ({ id: panel.panelId, send: frame => {
      assert.equal(frame.destination, 'mini_meeting')
      assert.equal(frame.ticket, undefined)
      handleUiOpenSidepanelResult({ id: frame.id, ok: true, destination: frame.destination, meeting_opened: meetingOpened }, panel)
    } }),
  })
  assert.deepEqual(await open(true), { type: 'ui.open_sidepanel.opened', destination: 'mini_meeting' })
  const oldExtensionReply = await open()
  assert.equal(oldExtensionReply.type, 'error')
  assert.match(String(oldExtensionReply.error), /更新 Chrome 扩展/)
})

test('invalid/expired screenshots and incompatible extension results fail honestly', async () => {
  const handoff = new MiniCaptureHandoff(5)
  assert.throws(() => handoff.stage('ocr', 'broken!', panel.panelId))
  const ticket = handoff.stage('ask', png, panel.panelId)
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.throws(() => handoff.claim('ask', ticket, panel.panelId))
  const reply = await handleUiOpenSidepanel({ destination: 'mini_search' }, {
    surface: 'tray', origin: 'cmspark-tray://local', broadcast: () => assert.fail(),
    miniPanel: () => ({ id: panel.panelId, send: frame => { handleUiOpenSidepanelResult({ id: frame.id, ok: true }, panel) } }),
  })
  assert.equal(reply.type, 'error')
})

test('two paired Chrome profiles cannot receive an ambiguous private desktop capture', async () => {
  assert.equal(miniPanelOwner([]), undefined)
  const first = { id: 'first', send: () => assert.fail('must not deliver to an arbitrary profile') }
  assert.equal(miniPanelOwner([first]), first)
  const result = await handleUiOpenSidepanel({ destination: 'mini_capture', image_base64: png }, {
    surface: 'tray', origin: 'cmspark-tray://local', broadcast: () => assert.fail('must not broadcast PNG'),
    miniPanel: () => miniPanelOwner([first, { ...first, id: 'second' }]),
  })
  assert.equal(result.error_code, 'MINI_PANEL_AMBIGUOUS')
  assert.match(String(result.error), /多个 Chrome 配置文件/)
})

test('quick search uses the knowledge index and reads a result by its durable ID', async () => {
  const found = await miniPanelRequest({ op: 'search', query: 'launch' }, panel, knowledge)
  assert.ok('hits' in found)
  assert.deepEqual(found.hits?.map(hit => hit.id), ['brief'])
  const read = await miniPanelRequest({ op: 'read', doc_id: 'brief' }, panel, knowledge)
  assert.ok('doc' in read)
  assert.equal(read.doc?.body, doc.body)
})

test('screenshot Q&A requires renewed target confirmation and sends the same PNG to the newly selected model', async () => {
  const original = structuredClone(getConfig())
  const receipts: { model: string; image: string }[] = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    const image = body.messages[0].content.find((part: any) => part.type === 'image_url')
    receipts.push({ model: body.model, image: image.image_url.url })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'receipt from ' + body.model } }] }))
  })
  try {
    await once(server.listen(0, '127.0.0.1'), 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const base = 'http://127.0.0.1:' + address.port + '/v1'
    const vision = { ...original.vision!, enabled: true, reuse_main_model: true, base_url: base, model_name: 'separate-vl', api_key: 'local' }
    saveConfig({ llm: { ...original.llm, model_name: 'gpt-4o', api_key: 'local', base_url: base }, vision }, { llmKey: true, visionKey: true })
    const refreshed = await miniPanelRequest({ op: 'target' }, panel, knowledge)
    assert.ok(refreshed.ok && 'target' in refreshed && refreshed.target && !refreshed.target.unavailable)
    assert.equal(receipts.length, 0)
    const target = refreshed.target.id
    const args = { op: 'ask', question: '读出截图文字', image_base64: png, expected_target: target }
    const first = await miniPanelRequest(args, panel, knowledge)
    assert.equal(first.ok, true)
    const inFlight = miniPanelRequest({ ...args, question: '等待端点核验时切换模型' }, panel, knowledge)
    saveConfig({ vision: { ...vision, reuse_main_model: false } })
    assert.equal((await inFlight).ok, false)
    const changed = await miniPanelRequest(args, panel, knowledge)
    assert.ok(!changed.ok && 'target' in changed && changed.target)
    assert.equal(receipts.length, 1)
    const retried = await miniPanelRequest({ ...args, expected_target: changed.target.id }, panel, knowledge)
    assert.ok(retried.ok && 'text' in retried)
    assert.equal(retried.text, 'receipt from separate-vl')
    const image = 'data:image/png;base64,' + png
    assert.deepEqual(receipts, [{ model: 'gpt-4o', image }, { model: 'separate-vl', image }])
  } finally {
    saveConfig({ vision: original.vision, llm: original.llm }, { llmKey: true, visionKey: true })
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('consent-bound screenshot requests stop on a provider redirect for both supported protocols', async () => {
  const original = structuredClone(getConfig())
  let confirmedRequests = 0, redirectedRequests = 0
  const location = createServer((request, response) => {
    redirectedRequests++
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
  })
  const gateway = createServer((request, response) => {
    confirmedRequests++
    request.resume()
    const address = location.address()
    assert.ok(address && typeof address === 'object')
    response.writeHead(307, { location: 'http://127.0.0.1:' + address.port + '/changed' }).end()
  })
  try {
    await Promise.all([once(location.listen(0, '127.0.0.1'), 'listening'), once(gateway.listen(0, '127.0.0.1'), 'listening')])
    const address = gateway.address()
    assert.ok(address && typeof address === 'object')
    for (const protocol of ['openai', 'anthropic'] as const) {
      saveConfig({ vision: { ...original.vision!, enabled: true, reuse_main_model: false, base_url: 'http://127.0.0.1:' + address.port + '/v1',
        model_name: 'receipt-' + protocol, api_key: 'loopback', protocol } }, { visionKey: true })
      const target = activityModelTarget({ ...DEFAULT_ACTIVITY_CONFIG, extraction_mode: 'vision' })
      const result = await miniPanelRequest({ op: 'ask', question: '已确认目标', image_base64: png, expected_target: target.id }, panel, knowledge)
      assert.equal(result.ok, false)
    }
    assert.equal(confirmedRequests, 2)
    assert.equal(redirectedRequests, 0)
  } finally {
    saveConfig({ vision: original.vision, llm: original.llm }, { llmKey: true, visionKey: true })
    await Promise.all([gateway, location].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  }
})
