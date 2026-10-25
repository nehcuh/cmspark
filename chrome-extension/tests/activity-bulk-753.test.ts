import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import * as activity from '../src/sidepanel/components/personal-workspace/activity-request'
import { createActivityFixture } from './helpers/activity-bulk-753'

const turn = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

/** Execute the actual hook and actual requestActivity with controlled React/transport. */
async function harness() {
  const fixture = await createActivityFixture(), listeners = new Set<(message: any) => void>(), sent: any[] = []
  const previousChrome = (globalThis as any).chrome, previousDocument = (globalThis as any).document
  const emit = (message: any) => { for (const listener of [...listeners]) listener(message) }
  ;(globalThis as any).chrome = { runtime: { onMessage: { addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn) },
    sendMessage: (message: any) => { sent.push(message); return Promise.resolve({ ok: true }) } } }
  ;(globalThis as any).document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} }
  const cells: any[] = [], effects: any[] = [], queue: Array<() => void> = []
  let cursor = 0, effectCursor = 0, connected = true, revision = 0, current: any
  const react: any = {
    useState(initial: any) { const slot = cursor++; if (!(slot in cells)) cells[slot] = typeof initial === 'function' ? initial() : initial; return [cells[slot], (value: any) => { cells[slot] = typeof value === 'function' ? value(cells[slot]) : value }] },
    useRef(initial: any) { const slot = cursor++; if (!(slot in cells)) cells[slot] = { current: initial }; return cells[slot] },
    useCallback(fn: any, deps: any[]) { const slot = cursor++, old = cells[slot]; if (!old || deps.length !== old.deps.length || deps.some((v, i) => v !== old.deps[i])) cells[slot] = { deps, fn }; return cells[slot].fn },
    useEffect(effect: () => any, deps: any[]) { const slot = effectCursor++, old = effects[slot]; if (!old || deps.length !== old.deps.length || deps.some((v, i) => v !== old.deps[i])) { const next = { deps, cleanup: undefined as any }; effects[slot] = next; queue.push(() => { old?.cleanup?.(); next.cleanup = effect() }) } },
  }
  const exports: any = {}, filename = process.env.ACTIVITY_753_OLD_HOOK || path.resolve(process.cwd(), 'src/sidepanel/components/personal-workspace/useActivity.ts')
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: (id: string) => { if (id === 'react') return react; if (id === './activity-request') return activity; assert.fail('unexpected hook dependency ' + id) },
    chrome: (globalThis as any).chrome, document: (globalThis as any).document, AbortController, setInterval: () => 1, clearInterval() {},
  }, { timeout: 1000, filename })
  const flushEffects = () => { while (queue.length) queue.shift()!() }
  const render = (nextConnected = connected, nextRevision = revision, flush = true) => {
    connected = nextConnected; revision = nextRevision; cursor = 0; effectCursor = 0
    current = exports.useActivity(connected, revision); if (flush) flushEffects(); return current
  }
  const respond = async (index: number, transform: (reply: any) => any = value => value) => {
    assert.ok(sent[index], `missing actual request ${index}`)
    const { require_connected, ...request } = sent[index]
    assert.equal(require_connected, true)
    const reply = await fixture.handle(request); emit(transform(reply)); await turn(); return reply
  }
  const selected = (items = fixture.todos, kind = 'todo') => items.map((item: any) => ({ kind, id: item.id, revision: item.revision, title: item.title }))
  const close = () => { flushEffects(); for (const entry of effects) entry?.cleanup?.(); listeners.clear(); fixture.dispose(); (globalThis as any).chrome = previousChrome; (globalThis as any).document = previousDocument }
  try { render(); await respond(0); render(); assert.equal(current.snapshot.todos.length, 3) }
  catch (error) { close(); throw error }
  return { fixture, sent, emit, respond, render, selected, close, flushEffects, hook: () => current, listenerCount: () => listeners.size }
}

test('#753 actual service confirms serial handling only after each persistence reply and holds the shared writer', async () => {
  const f = await harness()
  try {
    const original = f.fixture.state(), items = f.selected(), pending = f.hook().mutateBulk('handling_done', items, () => true)
    assert.equal(f.sent.length, 2); assert.equal(f.sent[1].todo_id, items[0].id)
    assert.equal(await f.hook().mutate('todo.update', { todo_id: items[1].id, expected_revision: 0, patch: { title: 'foreign' } }, 'wrong'), false)
    await f.hook().refresh(); assert.equal(f.sent.length, 2)
    await turn(); assert.equal(f.sent.length, 2, 'transport ACK must not send the next item')
    f.emit({ type: 'activity.result', id: 'foreign-request', ok: true, state: f.fixture.state() }); await turn(); assert.equal(f.sent.length, 2)
    for (let index = 0; index < items.length; index++) {
      assert.equal(f.sent[index + 1].todo_id, items[index].id)
      assert.equal(f.sent[index + 1].expected_revision, items[index].revision)
      assert.deepEqual(plain(f.sent[index + 1].patch), { handling_status: 'done' })
      await f.respond(index + 1)
    }
    const results = await pending
    assert.deepEqual(plain(results.map((item: any) => item.status)), ['confirmed', 'confirmed', 'confirmed'])
    for (const before of original.todos) {
      const after = f.fixture.state().todos.find((item: any) => item.id === before.id)
      assert.equal(after.revision, before.revision + 1); assert.equal(after.handling_status, 'done'); assert.equal(after.feedback_status, 'pending')
      for (const key of ['evidence', 'reminder', 'remind_at', 'due_at', 'feedback_to', 'title', 'owner']) assert.deepEqual(after[key], before[key])
    }
    assert.equal(f.sent.length, 4); assert.equal(f.render().busy, false)
  } finally { f.close() }
})

test('#753 feedback and dismiss use real independent mutations and never create tasks or send notifications', async () => {
  for (const action of ['feedback_done', 'dismiss']) {
    const f = await harness()
    try {
      const original = f.fixture.state(), candidate = action === 'dismiss', items = f.selected(candidate ? f.fixture.candidates : f.fixture.todos, candidate ? 'candidate' : 'todo')
      const pending = f.hook().mutateBulk(action, items, () => true)
      for (let index = 0; index < items.length; index++) await f.respond(index + 1)
      assert.equal((await pending).every((item: any) => item.status === 'confirmed'), true)
      const state = f.fixture.state(); assert.equal(state.todos.length, original.todos.length); assert.deepEqual(state.sources, original.sources)
      if (candidate) { assert.deepEqual(state.todos, original.todos); assert.ok(state.candidates.every((item: any) => item.status === 'dismissed' && item.owner === '')) }
      else for (const item of state.todos) { assert.equal(item.feedback_status, 'done'); assert.equal(item.handling_status, 'open'); assert.deepEqual(item.reminder, original.todos.find((old: any) => old.id === item.id).reminder) }
      assert.ok(f.sent.slice(1).every(message => candidate ? message.type === 'todo.dismiss' && !('patch' in message) : message.type === 'todo.update' && JSON.stringify(message.patch) === '{"feedback_status":"done"}'))
    } finally { f.close() }
  }
})

test('#753 first real revision conflict preserves prior confirmation and stops all later identities', async () => {
  const f = await harness()
  try {
    const items = f.selected(), pending = f.hook().mutateBulk('handling_done', items, () => true)
    await f.respond(1)
    assert.equal(f.sent.length, 3, 'second request is already sent against the original frozen revision')
    const conflict = await f.fixture.handle({ type: 'todo.update', id: 'actual-other-editor', todo_id: items[1].id, expected_revision: items[1].revision, patch: { title: 'Changed by another editor' } })
    assert.equal(conflict.ok, true)
    const rejected = await f.respond(2); assert.equal(rejected.ok, false); assert.equal(rejected.error_code, 'REVISION_CONFLICT')
    const results = await pending
    assert.deepEqual(plain(results.map((item: any) => item.status)), ['confirmed', 'unconfirmed', 'not_sent'])
    assert.equal(f.sent.length, 3); assert.equal(f.fixture.state().todos.find((item: any) => item.id === items[2].id).handling_status, 'open')
  } finally { f.close() }
})

test('#753 stale selection refuses before any write and never rebases to a fresh item revision', async () => {
  const f = await harness()
  try {
    const items = f.selected(), changed = await f.fixture.handle({ type: 'todo.update', id: 'other-editor', todo_id: items[0].id, expected_revision: items[0].revision, patch: { title: 'New title' } })
    assert.equal(changed.ok, true)
    const refreshing = f.hook().refresh(); await f.respond(1); await refreshing; f.render()
    const results = await f.hook().mutateBulk('handling_done', items, () => true)
    assert.ok(results.every((item: any) => item.status === 'not_sent')); assert.equal(f.sent.length, 2)
  } finally { f.close() }
})

test('#753 valid-shaped but wrong persistence postcondition is unconfirmed and stops', async () => {
  for (const wrong of ['revision', 'status', 'identity']) {
    const f = await harness()
    try {
      const items = f.selected(), pending = f.hook().mutateBulk('handling_done', items, () => true)
      await f.respond(1, reply => {
        const item = reply.state.todos.find((todo: any) => todo.id === items[0].id)
        if (wrong === 'revision') item.revision++
        if (wrong === 'status') item.handling_status = 'open'
        if (wrong === 'identity') reply.state.todos = reply.state.todos.filter((todo: any) => todo.id !== items[0].id)
        return reply
      })
      assert.deepEqual(plain((await pending).map((item: any) => item.status)), ['unconfirmed', 'not_sent', 'not_sent'])
      assert.equal(f.sent.length, 2)
    } finally { f.close() }
  }
})

test('#753 disconnect invalidates ordinary mutate synchronously before React render', async () => {
  const f = await harness()
  try {
    const item = f.fixture.todos[0]
    f.emit({ type: 'thread.mutation.connection', state: 'disconnected' })
    const pending = f.hook().mutate('todo.update', { todo_id: item.id, expected_revision: item.revision, patch: { handling_status: 'done' } }, 'saved')
    // If the old source sends, settle its actual receipt so the counterexample exits naturally.
    if (f.sent.length > 1) await f.respond(1)
    assert.equal(await pending, false); assert.equal(f.sent.length, 1)
    assert.equal(f.fixture.state().todos.find((todo: any) => todo.id === item.id).handling_status, 'open')
  } finally { f.close() }
})

test('#753 disconnected or changed view cancels continuation without claiming rollback of a transmitted write', async () => {
  for (const change of ['disconnected', 'connecting', 'view', 'unmount']) {
    const f = await harness()
    try {
      let visible = true
      const items = f.selected(), pending = f.hook().mutateBulk('handling_done', items, () => visible)
      // The real service may already persist although its reply is not yet delivered.
      const { require_connected: _connected, ...request } = f.sent[1], reply = await f.fixture.handle(request)
      if (change === 'view') visible = false
      else if (change === 'unmount') f.close()
      else f.emit({ type: 'thread.mutation.connection', state: change })
      if (change !== 'unmount') f.emit(reply)
      const results = await pending
      assert.deepEqual(plain(results.map((item: any) => item.status)), ['unconfirmed', 'not_sent', 'not_sent'])
      assert.equal(f.sent.length, 2)
      if (change !== 'unmount') assert.equal(f.fixture.state().todos.find((todo: any) => todo.id === items[0].id).handling_status, 'done')
    } finally { if (change !== 'unmount') f.close() }
  }
})

test('#753 reconnect ABA requires a fresh real baseline and ignores late old-owner receipts', async () => {
  const f = await harness()
  try {
    const oldItems = f.selected(), pending = f.hook().mutateBulk('handling_done', oldItems, () => true)
    f.emit({ type: 'thread.mutation.connection', state: 'disconnected' })
    f.render(true, 1, false) // Real reducer's retained revision models batched disconnect+connected.
    f.flushEffects(); await pending; await turn()
    // The old shared writer can delay refresh until its own finally; explicitly refresh once released.
    const refresh = f.render().refresh(); const baseline = f.sent.findIndex((message, index) => index > 1 && message.type === 'activity.state')
    assert.ok(baseline > 1)
    const { require_connected: _connected, ...request } = f.sent[1]
    f.emit(await f.fixture.handle(request)); await turn()
    const before = f.sent.length
    assert.equal(await f.hook().mutate('todo.update', { todo_id: oldItems[1].id, expected_revision: oldItems[1].revision, patch: { handling_status: 'done' } }, 'wrong'), false)
    assert.equal(f.sent.length, before)
    await f.respond(baseline); await refresh; f.render()
    const items = f.selected(f.hook().snapshot.todos), second = f.hook().mutateBulk('feedback_done', items, () => true)
    for (let index = 0; index < items.length; index++) await f.respond(before + index)
    assert.ok((await second).every((item: any) => item.status === 'confirmed'))
  } finally { f.close() }
})

test('#753 duplicate, mixed-kind, invalid action and reentrant batch are refused without extra writes', async () => {
  const f = await harness()
  try {
    const items = f.selected()
    for (const [action, selected] of [['handling_done', [items[0], items[0]]], ['dismiss', items], ['confirm', items], ['handling_done', [{ ...items[0], revision: -1 }]]] as any[]) {
      assert.ok((await f.hook().mutateBulk(action, selected, () => true)).every((item: any) => item.status === 'not_sent'))
      assert.equal(f.sent.length, 1)
    }
    const first = f.hook().mutateBulk('handling_done', [items[0]], () => true)
    const second = await f.hook().mutateBulk('handling_done', [items[1]], () => true)
    assert.equal(second[0].status, 'not_sent'); assert.equal(f.sent.length, 2)
    await f.respond(1); assert.equal((await first)[0].status, 'confirmed')
  } finally { f.close() }
})
