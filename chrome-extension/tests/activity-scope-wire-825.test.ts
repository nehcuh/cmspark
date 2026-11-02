import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { matchingActivityReply, requestActivity } from '../src/sidepanel/components/personal-workspace/activity-request'
const recorded = JSON.parse(fs.readFileSync('../companion/tests/fixtures/activity-scope825.json', 'utf8'))

test('825 actual handler calibration replies pass dedicated matchers without a state payload', () => {
  const app_id = recorded.preview.preview.app_id
  assert.equal(matchingActivityReply(recorded.configured, 'activity.state', {}), true)
  assert.equal(matchingActivityReply(recorded.preview, 'activity.preview', { app_id }), true)
  assert.equal(matchingActivityReply(recorded.preview_ocr, 'activity.preview_ocr', {}), true)
  assert.equal('state' in recorded.preview, false)
  assert.equal(matchingActivityReply(recorded.preview, 'activity.preview', { app_id: 'win.' + 'b'.repeat(64) }), false)
  assert.equal(matchingActivityReply({ ...recorded.preview, preview: { ...recorded.preview.preview, image_data_url: 'data:image/svg+xml;base64,owned' } }, 'activity.preview', { app_id }), false)
  assert.equal(matchingActivityReply({ ...recorded.preview, preview: { ...recorded.preview.preview, width: 8193 } }, 'activity.preview', { app_id }), false)
  assert.equal(matchingActivityReply({ ...recorded.preview_ocr, recognized_title: 'x'.repeat(201) }, 'activity.preview_ocr', {}), false)
})

for (const [type, milliseconds, response] of [
  ['activity.preview', 90_000, recorded.preview], ['activity.preview_ocr', 45_000, recorded.preview_ocr],
] as const) test(`825 ${type} waits for its bounded native budget and clears the listener after real matching reply`, async () => {
  const listeners = new Set<(m: any) => void>(), sent: any[] = [], delays: number[] = [], cleared: unknown[] = []
  const previousChrome = (globalThis as any).chrome, previousSet = globalThis.setTimeout, previousClear = globalThis.clearTimeout
  ;(globalThis as any).chrome = { runtime: { onMessage: { addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn) }, sendMessage: (m: any) => { sent.push(m); return Promise.resolve({ ok: true }) } } }
  globalThis.setTimeout = ((_: any, ms: number) => { delays.push(ms); return 825 as any }) as any
  globalThis.clearTimeout = ((timer: any) => { cleared.push(timer) }) as any
  try {
    const request = requestActivity(type, type === 'activity.preview' ? { app_id: recorded.preview.preview.app_id } : {})
    assert.deepEqual(delays, [milliseconds]); assert.equal(listeners.size, 1)
    for (const listener of [...listeners]) listener({ ...response, id: sent[0].id })
    const result = await request; assert.equal(result.ok, true); assert.equal(listeners.size, 0); assert.deepEqual(cleared, [825])
  } finally { (globalThis as any).chrome = previousChrome; globalThis.setTimeout = previousSet; globalThis.clearTimeout = previousClear }
})

test('825 cancelled preview waiting removes its listener and ignores a late success', async () => {
  const listeners = new Set<(m: any) => void>(), sent: any[] = [], previous = (globalThis as any).chrome
  ;(globalThis as any).chrome = { runtime: { onMessage: { addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn) }, sendMessage: (m: any) => { sent.push(m); return Promise.resolve({ ok: true }) } } }
  try {
    const cancel = new AbortController(), pending = requestActivity('activity.preview', { app_id: recorded.preview.preview.app_id }, cancel.signal)
    cancel.abort(); let rejected = false; try { await pending } catch (error) { rejected = true; assert.match(String(error), /请求已停止/) }; assert.equal(rejected, true); assert.equal(listeners.size, 0)
    for (const listener of listeners) listener({ ...recorded.preview, id: sent[0].id })
    assert.equal(listeners.size, 0)
  } finally { (globalThis as any).chrome = previous }
})
