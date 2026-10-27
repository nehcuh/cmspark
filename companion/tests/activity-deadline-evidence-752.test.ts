import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseExtractedCandidates } from '../src/activity/adapters'
import { ActivityStore } from '../src/activity/store'
import type { ActivitySource } from '../src/activity/types'

const source = (ocr: string): ActivitySource => ({ id: 'owned', origin: 'foreground', captured_at: '2026-10-28T00:00:00.000Z', app_id: 'owned.app', app_name: 'Owned', window_title: '', ocr_text: ocr, sha256: 'a'.repeat(64), bytes: 1 })
const parsed = (ocr: string, quote: string, due: string, messageTime = '') => parseExtractedCandidates(JSON.stringify({ candidates: [{ title: '提交报告', quote, message_time: messageTime, due_at: due }] }), source(ocr))[0]

test('752 candidate deadline needs unambiguous absolute evidence in its own quote', () => {
  const proposed = '2026-10-29T10:00:00.000Z'
  const relative = parsed('明天提交报告', '明天提交报告', proposed)
  assert.equal(relative.due_at, null); assert.equal(relative.evidence.quote, '明天提交报告')
  assert.equal(parsed('昨天 10:00\n明天提交报告', '明天提交报告', proposed, '昨天 10:00').due_at, null)
  assert.equal(parsed('截止 2026-10-29T18:00:00+08:00\n明天提交报告', '明天提交报告', proposed).due_at, null)
  const absolute = '截止 2026-10-29T18:00:00+08:00'
  assert.equal(parsed(absolute, absolute, proposed).due_at, proposed)
  for (const quote of ['deadline: 2026-10-29T10:00:00Z', 'Due by 2026-10-29T18:00:00+08:00']) assert.equal(parsed(quote, quote, proposed).due_at, proposed)
  assert.equal(parsed('截至 2026-10-29T18:00:00+08:00', '截至 2026-10-29T18:00:00+08:00', proposed).due_at, null)
  assert.equal(parsed('due2026-10-29T10:00:00Z', 'due2026-10-29T10:00:00Z', proposed).due_at, null)
  const imported = { ...source(absolute), origin: 'manual_import' as const }
  assert.equal(parseExtractedCandidates(JSON.stringify({ candidates: [{ title: '提交报告', quote: absolute, due_at: proposed }] }), imported)[0].due_at, null)
  assert.equal(parsed(absolute, absolute, '2026-10-29T11:00:00.000Z').due_at, null)
  for (const quote of ['截止 2026-10-29T18:00:00 提交', '截止 2026-10-29 提交', '截止 2026-10-29T18:00:00+08:00，另一个时间 2026-10-30', '截止 2026-10-29T18:00:00+08:00，另一个时间 2026年10月30日', '截止 2026-02-30T18:00:00+08:00', '不是截止 2026-10-29T18:00:00+08:00，报告时间待定', '如果批准，截止 2026-10-29T18:00:00+08:00', 'A 截止 2026-10-29T18:00:00+08:00；B 明天提交', '明天开会；截止 2026-10-29T18:00:00+08:00']) assert.equal(parsed(quote, quote, proposed).due_at, null)
  assert.equal(parsed('不是截止 2026-10-29T18:00:00+08:00', absolute, proposed).due_at, null, 'a model-selected substring cannot omit context')
  assert.equal(parsed('截止 2026-10-29T18:00:00+08:00', '不存在的原文', proposed), undefined)
})

test('752 legacy pending dates are projected safely and explicit human dates remain usable', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-deadline-752-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = new ActivityStore(dir), s = store.addSource({ origin: 'foreground', captured_at: '2026-10-28T00:00:00.000Z', app_id: 'owned.app', app_name: 'Owned', window_title: '', ocr_text: '明天提交报告' }, Buffer.from('owned-image'))!
  const entry = parsed(s.ocr_text, s.ocr_text, '2026-10-29T10:00:00.000Z')
  // Simulate a stored pre-fix candidate through the real store producer.
  store.addCandidates(s, [{ ...entry, due_at: '2026-10-29T10:00:00.000Z', evidence: { ...entry.evidence, source_id: s.id } }])
  const pending = store.stateMetadata().candidates[0]; assert.equal(pending.due_at, null)
  assert.equal(store.state().candidates[0].due_at, '2026-10-29T10:00:00.000Z', 'projection does not rewrite stored user data')
  const confirmed = store.confirm(pending.id, pending.revision, { title: '提交报告', owner: '我' }, '2026-10-28T00:00:00.000Z')
  assert.equal(confirmed.due_at, null)
  store.update(confirmed.id, confirmed.revision, { due_at: '2026-10-30T10:00:00.000Z' }, '2026-10-28T00:00:00.000Z')
  assert.equal(store.state().todos[0].due_at, '2026-10-30T10:00:00.000Z')
  const another = store.addSource({ origin: 'foreground', captured_at: '2026-10-28T00:00:00.000Z', app_id: 'owned.other', app_name: 'Owned', window_title: '', ocr_text: '明天提交另一份报告' }, Buffer.from('other-owned-image'))!
  const next = parsed(another.ocr_text, another.ocr_text, '2026-10-29T10:00:00.000Z')
  store.addCandidates(another, [{ ...next, evidence: { ...next.evidence, source_id: another.id } }])
  const candidate = store.stateMetadata().candidates.find(item => item.status === 'pending')!
  const explicit = store.confirm(candidate.id, candidate.revision, { title: '另一份报告', owner: '我', due_at: '2026-10-31T10:00:00.000Z' }, '2026-10-28T00:00:00.000Z')
  assert.equal(explicit.due_at, '2026-10-31T10:00:00.000Z')
})

test('752 pending deadline requires retained matching source and literal quote', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-deadline-source-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = new ActivityStore(dir), quote = '截止 2026-10-29T18:00:00+08:00'
  const s = store.addSource({ origin: 'foreground', captured_at: '2026-10-28T00:00:00.000Z', app_id: 'owned.app', app_name: 'Owned', window_title: '', ocr_text: quote }, Buffer.from('owned-image'))!
  const entry = parsed(quote, quote, '2026-10-29T10:00:00.000Z')
  store.addCandidates(s, [{ ...entry, evidence: { ...entry.evidence, source_id: 'missing' } }])
  assert.equal(store.stateMetadata().candidates[0].due_at, null)
  const imported = store.addSource({ origin: 'manual_import', captured_at: '2026-10-28T00:00:00.000Z', app_id: 'owned.import', app_name: 'Owned', window_title: '', ocr_text: quote }, Buffer.from('owned-import'))!
  const importedEntry = parseExtractedCandidates(JSON.stringify({ candidates: [{ title: '提交报告', quote, due_at: '2026-10-29T10:00:00.000Z' }] }), imported)[0]
  store.addCandidates(imported, [{ ...importedEntry, due_at: '2026-10-29T10:00:00.000Z' }])
  assert.equal(store.stateMetadata().candidates.find(c => c.evidence.source_id === imported.id)!.due_at, null)
})

test('752 untouched evidenced deadline survives confirmation with seconds', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-deadline-seconds-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = new ActivityStore(dir), quote = '截止 2026-10-29T18:00:45+08:00'
  const s = store.addSource({ origin: 'foreground', captured_at: '2026-10-28T00:00:00.000Z', app_id: 'owned.app', app_name: 'Owned', window_title: '', ocr_text: quote }, Buffer.from('owned-image'))!
  const entry = parsed(quote, quote, '2026-10-29T10:00:45.000Z')
  store.addCandidates(s, [{ ...entry, evidence: { ...entry.evidence, source_id: s.id } }])
  const candidate = store.stateMetadata().candidates[0]
  assert.equal(candidate.due_at, '2026-10-29T10:00:45.000Z')
  const confirmed = store.confirm(candidate.id, candidate.revision, { title: '提交报告', owner: '我' }, '2026-10-28T00:00:00.000Z')
  assert.equal(confirmed.due_at, '2026-10-29T10:00:45.000Z')
})
