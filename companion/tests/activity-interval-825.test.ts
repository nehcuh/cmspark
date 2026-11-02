import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ActivityService } from '../src/activity/service'
import { ActivityStore } from '../src/activity/store'
const app = 'win.' + 'a'.repeat(64)
const turn = () => new Promise<void>(resolve => setImmediate(resolve))

test('825 3-second interval saves through the real handler and reloads; shorter interval refuses', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity825-interval-'))
  const service = new ActivityService({ dataDir: dir, platform: 'win32', recorder: { capture: async () => null } })
  try {
    const bad = await service.handle({ type: 'activity.configure', expected_revision: 0, patch: { interval_ms: 2999 } })
    assert.equal(bad.ok, false)
    const good = await service.handle({ type: 'activity.configure', expected_revision: 0, patch: { interval_ms: 3000 } })
    assert.equal(good.ok, true)
    assert.equal(new ActivityStore(dir).config().interval_ms, 3000)
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('825 tick starts at 3000ms, not 2999ms, without changing the stored default', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity825-clock-'))
  let now = 100_000, captures = 0
  const service = new ActivityService({ dataDir: dir, platform: 'win32', now: () => now, recorder: { capture: async () => { captures++; return null } } })
  try {
    assert.equal(service.store.config().interval_ms, 30_000)
    service.store.configure(0, { enabled: true, allowed_apps: [app], interval_ms: 3000 })
    service.start(); await turn(); assert.equal(captures, 1)
    now += 2999; await service.tick(); assert.equal(captures, 1)
    now++; await service.tick(); assert.equal(captures, 2)
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('825 slow model remains single-flight and skipped ticks do not form a backlog', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity825-busy-'))
  let now = 100_000, captures = 0, extracts = 0, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const service = new ActivityService({ dataDir: dir, platform: 'win32', now: () => now,
    recorder: { capture: async () => ({ app_id: app, app_name: 'Owned Chat', window_title: 'Owned', ocr_text: `Send report ${++captures}`, image: Buffer.from(`owned-${captures}`) }) },
    extract: async () => { if (++extracts === 1) await held; return [] }, notify: async () => {} })
  try {
    service.store.configure(0, { enabled: true, allowed_apps: [app], interval_ms: 3000, ocr_ai_enabled: true })
    service.start(); await turn(); assert.equal(captures, 1); assert.equal(extracts, 1)
    for (const elapsed of [3000, 6000, 9000]) { now = 100_000 + elapsed; await service.tick(); assert.equal(captures, 1) }
    await assert.rejects(service.scan(), { code: 'BUSY' })
    release(); await turn(); await service.tick()
    assert.equal(captures, 2); assert.equal(extracts, 2)
    await service.tick(); assert.equal(captures, 2)
  } finally { release(); await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})
