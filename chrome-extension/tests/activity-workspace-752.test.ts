import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecentActivitySources } from '../src/sidepanel/components/personal-workspace/RecentActivitySources'
import { matchingActivityReply, requestActivity, dueToday, taskComplete, taskDatePatch, datetimeInput, datetimeISO } from '../src/sidepanel/components/personal-workspace/activity-request'

// Serialized from the actual injected ActivityService handler, not a hand-authored wire shape.
const recorded = JSON.parse(fs.readFileSync('../companion/tests/fixtures/activity-752.json', 'utf8'))
function runtime() {
  const listeners = new Set<(message: any) => void>()
  const sent: any[] = []
  ;(globalThis as any).chrome = { runtime: { onMessage: { addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn) }, sendMessage: (message: any) => { sent.push(message); return Promise.resolve({ ok: true }) } } }
  return { listeners, sent, emit: (message: any) => { for (const fn of listeners) fn(message) } }
}
test('actual handler state and exact source reply satisfy the workspace wire projection', () => {
  assert.equal(matchingActivityReply(recorded.state, 'activity.state', {}), true)
  assert.equal(matchingActivityReply(recorded.source, 'activity.source', { source_id: recorded.source.source.id }), true)
  assert.equal(matchingActivityReply(recorded.source, 'activity.source', { source_id: 'another-source' }), false)
  assert.equal(matchingActivityReply({ ...recorded.state, state: { ...recorded.state.state, revision: -1 } }, 'activity.state', {}), false)
  assert.equal(matchingActivityReply({ ...recorded.state, state: undefined }, 'todo.confirm', {}), false)
  assert.equal('ocr_text' in recorded.state.state.sources[0], false)
})
test('transport ACK, old request and wrong source cannot complete source lookup', async () => {
  const env = runtime(); let resolved = false
  const request = requestActivity('activity.source', { source_id: recorded.source.source.id }).then(value => { resolved = true; return value })
  await Promise.resolve(); assert.equal(resolved, false)
  env.emit({ ...recorded.source, id: 'old-request' })
  env.emit({ ...recorded.source, id: env.sent[0].id, source: { ...recorded.source.source, id: 'wrong-source' } })
  await Promise.resolve(); assert.equal(resolved, false)
  env.emit({ ...recorded.source, id: env.sent[0].id })
  assert.deepEqual((await request).source, recorded.source.source)
  assert.equal(env.listeners.size, 0)
})
test('abandoning source A rejects and removes its waiter; late A cannot fill source B', async () => {
  const env = runtime(), abort = new AbortController()
  const old = requestActivity('activity.source', { source_id: recorded.source.source.id }, abort.signal).then(() => null, error => error)
  abort.abort()
  assert.match((await old).message, /刷新核实/)
  assert.equal(env.listeners.size, 0)
  let resolved = false
  const current = requestActivity('activity.source', { source_id: recorded.source.source.id }).then(value => { resolved = true; return value })
  env.emit({ ...recorded.source, id: env.sent[0].id })
  await Promise.resolve(); assert.equal(resolved, false)
  env.emit({ ...recorded.source, id: env.sent[1].id })
  assert.equal((await current).source!.id, recorded.source.source.id)
  assert.equal(env.sent.length, 2); assert.equal(env.listeners.size, 0)
})
test('explicit backend failure preserves unknown outcome and never retries a mutation', async () => {
  const env = runtime()
  const waiting = requestActivity('todo.update', { todo_id: 'owned', expected_revision: 2, patch: {} }).then(() => null, error => error)
  env.emit({ type: 'activity.result', id: env.sent[0].id, ok: false, error: '事项已变化，请刷新核实' })
  assert.match((await waiting).message, /已变化/)
  assert.equal(env.sent.length, 1); assert.equal(env.listeners.size, 0)
})
test('Today excludes future and fully complete tasks while retaining handled-but-unreported obligations', () => {
  const existing = recorded.confirmed.state.todos[0]
  assert.ok(existing)
  const todo = { ...existing, due_at: '2026-10-21T09:00:00+08:00', handling_status: 'done' as const, feedback_status: 'pending' as const }
  const now = new Date('2026-10-21T10:00:00+08:00')
  assert.equal(taskComplete(todo), false)
  assert.equal(dueToday(todo, now), true)
  assert.equal(dueToday({ ...todo, feedback_status: 'done' }, now), false)
  assert.equal(dueToday({ ...todo, due_at: '2026-10-24T09:00:00+08:00' }, now), false)
  assert.equal(dueToday({ ...todo, due_at: null }, now), false)
})


test('explicit running-app reply uses the actual adapter projection and refuses duplicates or hidden window fields', () => {
  assert.equal(matchingActivityReply(recorded.apps, 'activity.apps', {}), true)
  assert.ok(recorded.apps.apps.every((app: any) => Object.keys(app).sort().join(',') === 'app_id,app_name'))
  assert.equal(matchingActivityReply({ ...recorded.apps, apps: [...recorded.apps.apps, recorded.apps.apps[0]] }, 'activity.apps', {}), false)
  assert.equal(matchingActivityReply({ ...recorded.apps, apps: [{ ...recorded.apps.apps[0], window_title: 'private' }] }, 'activity.apps', {}), false)
  assert.equal(matchingActivityReply({ ...recorded.apps, apps: [{ ...recorded.apps.apps[0], app_name: '' }] }, 'activity.apps', {}), false)
})


test('ordinary TaskEditor date patch leaves original sub-minute instants untouched; deliberate changes stay explicit', () => {
  const todo = { ...recorded.confirmed.state.todos[0], due_at: '2026-10-21T10:00:43.987Z', remind_at: '2026-10-21T09:00:12.345Z' }
  const initial = { due: datetimeInput(todo.due_at), remind: datetimeInput(todo.remind_at) }
  const untouched = taskDatePatch(false, initial, { ...initial })
  assert.deepEqual(untouched, {})
  assert.equal({ ...todo, ...untouched, title: 'updated title', handling_status: 'done' }.due_at, todo.due_at)
  assert.equal({ ...todo, ...untouched }.remind_at, todo.remind_at)
  assert.deepEqual(taskDatePatch(false, initial, { ...initial, remind: '' }), { remind_at: null })
  const changedDue = initial.due.slice(0, -2) + '01'
  assert.deepEqual(taskDatePatch(false, initial, { ...initial, due: changedDue }), { due_at: datetimeISO(changedDue) })
  assert.deepEqual(taskDatePatch(true, initial, { ...initial }), { due_at: datetimeISO(initial.due), remind_at: datetimeISO(initial.remind) })
})
test('actual recent-source component exposes newest source and its manual-review action beyond thirty captures', () => {
  const original = recorded.state.state.sources[0]
  const sources: any[] = []
  for (let index = 0; index < 31; index++) sources.unshift({ ...original, id: original.id.slice(0, 24) + String(index).padStart(12, '0'), window_title: `source-${index}`, captured_at: new Date(Date.parse(original.captured_at) + index * 1000).toISOString() })
  let selected = ''
  const props = { sources, onSelect: (id: string) => { selected = id } }
  const html = renderToStaticMarkup(createElement(RecentActivitySources, props))
  assert.equal((html.match(/data-source-id=/g) || []).length, 30)
  assert.ok(html.includes('source-30'))
  assert.equal(html.includes(' · source-0<'), false)
  assert.ok(html.indexOf(' · source-30<') < html.indexOf(' · source-29<'))
  const buttons: any[] = []
  function visit(node: any) { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === 'object') { if (node.props?.['data-source-id']) buttons.push(node); visit(node.props?.children) } }
  visit(RecentActivitySources(props))
  assert.equal(buttons[0].props['data-source-id'], sources[0].id)
  buttons[0].props.onClick()
  assert.equal(selected, sources[0].id)
  assert.equal(buttons.some(button => button.props['data-source-id'] === sources[30].id), false)
})
