import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createMiniRelay, miniPagePath } from '../src/background/mini-actions'
import { MINI_PRIVATE_PORT, requestMini } from '../src/utils/mini-request'
import { requestActivity } from '../src/sidepanel/components/personal-workspace/activity-request'

test('each quick action opens its intended page and only region actions require a ticket', () => {
  const ticket = '93d60098-db73-4ffe-b4ae-e504fbab63a8'
  assert.equal(miniPagePath('mini_search', undefined), 'tabs/mini.html?view=search')
  for (const action of ['ask', 'ocr', 'capture']) {
    assert.equal(miniPagePath('mini_' + action, ticket), 'tabs/mini.html?view=' + action + '#' + ticket)
    let invalid = false
    try { miniPagePath('mini_' + action, 'not-a-ticket') } catch { invalid = true }
    assert.equal(invalid, true)
  }
  assert.equal(miniPagePath('mini_todo', ticket), 'tabs/workspace.html?view=todos&capture=todo#todos/capture/mini/' + ticket)
  assert.equal(miniPagePath('screenshot_todo', undefined), undefined)
})

test('private results go back to the requesting extension page and never get forwarded as broadcasts', () => {
  const runtime = { id: 'test', getURL: (path: string) => 'chrome-extension://test/' + path }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime } })
  try {
    const relay = createMiniRelay()
    const replies: any[] = [], outbound: any[] = []
    const request = (url: string, op: string, action = 'ask', frameId = 0) => relay.request({ type: 'mini.request', op, action }, { id: 'test', url, frameId }, r => replies.push(r), f => { outbound.push(f); return true })
    assert.equal(request('https://outside.test', 'claim'), false)
    assert.equal(request(runtime.getURL('tabs/workspace.html'), 'ask'), false)
    assert.equal(request(runtime.getURL('tabs/mini.html'), 'ask', 'ask', 1), false)
    assert.equal(outbound.length, 0)
    assert.equal(request(runtime.getURL('tabs/mini.html?view=ask'), 'claim'), true)
    const result = { type: 'mini.result', id: outbound[0].id, ok: true, image_base64: 'test-png' }
    assert.equal(relay.receive(result), true)
    assert.deepEqual(replies.at(-1), result)
    assert.equal(relay.receive(result), true)
    assert.equal(replies.length, 4)
    assert.equal(request(runtime.getURL('tabs/workspace.html?view=todos'), 'claim', 'todo'), true)
    relay.disconnect()
    assert.equal(replies.at(-1).ok, false)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'chrome', previous)
    else Reflect.deleteProperty(globalThis, 'chrome')
  }
})

test('Mini PNG and confirmed todo import use only a dedicated request port in both directions', async () => {
  const recorded = JSON.parse(fs.readFileSync('../companion/tests/fixtures/activity-752.json', 'utf8')).state
  const relay = createMiniRelay()
  function events() {
    const listeners = new Set<(value?: any) => void>()
    return {
      addListener: (fn: (value?: any) => void) => listeners.add(fn),
      removeListener: (fn: (value?: any) => void) => listeners.delete(fn),
      emit: (value?: any) => { for (const fn of listeners) fn(value) },
    }
  }
  const frames: any[] = []
  let page = 'tabs/mini.html'
  const runtime = {
    id: 'test', getURL: (part: string) => 'chrome-extension://test/' + part,
    sendMessage: () => assert.fail('private image must not enter runtime messaging'),
    connect({ name }: { name: string }) {
      assert.equal(name, MINI_PRIVATE_PORT)
      const upstream = events(), downstream = events(), closed = events()
      const server = { sender: { id: 'test', url: runtime.getURL(page), frameId: 0 }, onDisconnect: closed, onMessage: upstream, postMessage: downstream.emit }
      relay.attach(server as unknown as chrome.runtime.Port, frame => {
        frames.push(frame)
        const result = frame.type === 'activity.import' ? { ...recorded, source_id: 'saved' } : { type: 'mini.result', ok: true, text: 'recognized' }
        queueMicrotask(() => assert.equal(relay.receive({ ...result, id: frame.id }), true))
        return true
      })
      return { onMessage: downstream, onDisconnect: closed, disconnect: () => closed.emit(), postMessage: upstream.emit }
    },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime } })
  try {
    assert.equal((await requestMini('ocr', { image_base64: 'selected' })).text, 'recognized')
    page = 'tabs/workspace.html'
    const saved = await requestActivity('activity.import', { image_base64: 'selected', expected_model_target: 'confirmed' })
    assert.equal(saved.source_id, 'saved')
    assert.deepEqual(frames.map(f => [f.type, f.image_base64]), [['mini.request', 'selected'], ['activity.import', 'selected']])
  } finally {
    if (previous) Object.defineProperty(globalThis, 'chrome', previous)
    else Reflect.deleteProperty(globalThis, 'chrome')
  }
})
