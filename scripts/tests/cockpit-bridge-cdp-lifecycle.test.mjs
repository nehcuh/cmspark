import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

// Actual controller class and abort helper, not a second CDP implementation.
// The owned EventTarget is an inert protocol seam; no socket/Chrome/native runs.
const controller = fs.readFileSync(new URL('./cockpit-bridge-real-first.cjs', import.meta.url), 'utf8')
const evidence = { callback: (_, f) => f, check: (_, f) => f(), wait: async (_, f) => f() }
function actualClass(eol = '\n') {
  const text = controller.replaceAll('\r\n', '\n').replaceAll('\n', eol)
  const begin = text.indexOf('function aborted(signal, action) {'), end = text.indexOf('async function endpoint(', begin)
  assert.ok(begin > 0 && end > begin)
  assert.equal(text.indexOf('function aborted(signal, action) {', begin + 1), -1)
  assert.equal(text.indexOf('class Cdp {', text.indexOf('class Cdp {') + 1), -1)
  return vm.runInNewContext(text.slice(begin, end) + '\n;Cdp', { evidence, assert }, { filename: 'actual-cockpit-cdp.cjs' })
}
class OwnedWire extends EventTarget {
  constructor(hold = false) { super(); this.closed = false; this.hold = hold; this.commands = [] }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
  send(text) {
    const command = JSON.parse(text); this.commands.push(command)
    if (!this.hold) queueMicrotask(() => {
      if (!this.closed) this.message({ id: command.id, result: command.method === 'Target.getTargets' ? { targetInfos: [] } : {} })
    })
  }
  close() { if (!this.closed) { this.closed = true; this.dispatchEvent(new Event('close')) } }
}
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
function observe(promise) {
  const state = { settled: false, value: undefined, error: null }
  state.done = promise.then(value => { state.settled = true; state.value = value }, error => { state.settled = true; state.error = error })
  return state
}
async function fixture(eol, action, hold = false) {
  const wire = new OwnedWire(hold), abort = new AbortController(), Cdp = actualClass(eol), cdp = new Cdp(wire, abort.signal)
  const watches = [], watch = promise => { const value = observe(promise); watches.push(value); return value }
  try { await action({ wire, abort, cdp, watch }) }
  finally { abort.abort(Error('OWNED_CDP_CLEANUP')); await Promise.all(watches.map(x => x.done)); wire.close() }
}
function closed(state) {
  assert.equal(state.settled, true, 'transport terminal must settle event wait without waiting for outer timeout')
  assert.equal(state.error?.message, 'COCKPIT_BRIDGE_CDP_CLOSED')
}

for (const eol of ['\n', '\r\n']) {
  const label = eol === '\n' ? 'LF' : 'CRLF'
  test(`actual CDP target waiter closes after acknowledged empty snapshot (${label})`, () => fixture(eol, async ({ wire, cdp, watch }) => {
    const state = watch(cdp.target(() => false)); await flush()
    assert.equal(state.settled, false); assert.deepEqual(wire.commands.map(x => x.method), ['Target.getTargets'])
    wire.close(); await flush(); closed(state)
  }))
  test(`actual CDP context waiter closes after Runtime.enable acknowledgement (${label})`, () => fixture(eol, async ({ wire, cdp, watch }) => {
    const state = watch(cdp.defaultContext('owned-session', 'owned-origin')); await flush()
    assert.equal(state.settled, false); assert.deepEqual(wire.commands.map(x => x.method), ['Runtime.enable'])
    wire.close(); await flush(); closed(state)
  }))
}
for (const operation of ['target', 'context']) test(`actual CDP ${operation} refuses already closed wire without another command`, () => fixture('\n', async ({ wire, cdp, watch }) => {
  wire.close(); const count = wire.commands.length
  const state = watch(operation === 'target' ? cdp.target(() => false) : cdp.defaultContext('owned-session', 'owned-origin'))
  await flush(); closed(state); assert.equal(wire.commands.length, count)
}))
test('actual CDP pending command still rejects on close', () => fixture('\n', async ({ wire, cdp, watch }) => {
  const state = watch(cdp.command('Target.getTargets')); await flush(); assert.equal(state.settled, false)
  wire.close(); await flush(); closed(state)
}, true))
test('actual CDP all concurrent event and command waits settle on close', () => fixture('\n', async ({ wire, cdp, watch }) => {
  const target = watch(cdp.target(() => false)), context = watch(cdp.defaultContext('owned-session', 'owned-origin'))
  await flush(); wire.hold = true; const command = watch(cdp.command('Target.getTargets')); await flush()
  assert.equal(target.settled || context.settled || command.settled, false)
  wire.close(); await flush(); for (const state of [target, context, command]) closed(state)
}))
test('actual CDP original abort reason still wins for event waiters', () => fixture('\n', async ({ abort, cdp, watch }) => {
  const target = watch(cdp.target(() => false)), context = watch(cdp.defaultContext('owned-session', 'owned-origin')), reason = Error('OWNED_ORIGINAL_ABORT')
  await flush(); abort.abort(reason); await flush()
  for (const state of [target, context]) { assert.equal(state.settled, true); assert.equal(state.error, reason) }
}))
test('actual CDP still accepts matching target snapshot and keeps resolved result on later close', () => fixture('\n', async ({ wire, cdp, watch }) => {
  wire.hold = true; const target = watch(cdp.target(info => info.type === 'page')); await flush()
  const command = wire.commands.at(-1), info = { targetId: 'owned-target', type: 'page', title: '', url: 'about:blank', attached: false }
  wire.message({ id: command.id, result: { targetInfos: [info] } }); await flush()
  assert.equal(target.settled, true); assert.equal(target.error, null); assert.equal(target.value.targetId, info.targetId)
  wire.close(); await flush(); assert.equal(target.error, null)
}))
test('actual CDP still accepts matching default context and refuses foreign context event', () => fixture('\n', async ({ wire, cdp, watch }) => {
  const context = watch(cdp.defaultContext('owned-session', 'owned-origin')); await flush()
  wire.message({ method: 'Runtime.executionContextCreated', sessionId: 'foreign-session', params: { context: { id: 7, origin: 'owned-origin', auxData: { isDefault: true } } } }); await flush(); assert.equal(context.settled, false)
  wire.message({ method: 'Runtime.executionContextCreated', sessionId: 'owned-session', params: { context: { id: 8, origin: 'owned-origin', auxData: { isDefault: true } } } }); await flush()
  assert.equal(context.settled, true); assert.equal(context.error, null); assert.equal(context.value, 8)
  wire.close(); await flush(); assert.equal(context.error, null)
}))
test('actual CDP snapshot command rejection still clears event wait', () => fixture('\n', async ({ wire, cdp, watch }) => {
  wire.hold = true; const target = watch(cdp.target(() => false)); await flush()
  wire.message({ id: wire.commands.at(-1).id, error: { code: -32000, message: 'owned refusal' } }); await flush()
  assert.equal(target.settled, true); assert.equal(target.error?.message, 'COCKPIT_BRIDGE_CDP_REJECTED')
}))
test('actual CDP malformed wire data refuses wait and ignores late matching event', () => fixture('\n', async ({ wire, cdp, watch }) => {
  const target = watch(cdp.target(() => true)); await flush()
  wire.dispatchEvent(new MessageEvent('message', { data: '{' })); await flush(); closed(target)
  wire.message({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'late-target', type: 'page', title: '', url: 'about:blank', attached: false } } }); await flush()
  closed(target); assert.equal(target.value, undefined)
}))
