// Focused inert controls. The caller supplies the actual normally-emitted
// observer and original normal-JS AST projection, not a replacement producer.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { confirmationDiagnostic, publicConfirmationDiagnostic, confirmationRoleForNameHash, localDiagnostic, publicLocalDiagnostic, terminalDiagnostic } from '../../windows-census-reporter.mjs'
import { confirmationCases772 } from './native-confirmation-census-772.mjs'

const CF = 'D476_NATIVE_CONFIRMATION_PHASE ', LOCAL = 'D476_LOCAL_NATIVE_PHASE '
const clone = value => JSON.parse(JSON.stringify(value))
const digest = value => createHash('sha256').update(value).digest('hex')

export function createConfirmationContracts772({ createConfirmationObservation772: create, nativeFrame, actualLocal }) {
  assert.equal(typeof create, 'function'); assert.equal(typeof nativeFrame, 'function'); assert.equal(typeof actualLocal.create, 'function')
  const controls = [], add = (name, run) => { controls.push({ name, run }) }
  function produce(role = 'LOCAL', moment = 'ABORT') {
    let time = 1000
    const messages = [], observation = create(role, () => time, message => messages.push(message))
    observation.server(2, 1); observation.server(1, 1)
    observation.native(nativeFrame(role, 3, 1, 240, false))
    time = 1750; observation.server(2, 1); observation.server(1, 2)
    observation.native(nativeFrame(role, 3, 1, 0, true))
    observation.native(nativeFrame(role, 2, 2, 0, true))
    observation.emit(moment); observation.emit(moment === 'ABORT' ? 'FINALLY' : 'ABORT')
    assert.equal(messages.length, 1)
    return { observation, message: messages[0], snapshot: observation.snapshot(moment) }
  }

  add('772 real confirmation producer preserves per-request first observations and independent clock order', () => {
    for (const { role, title } of confirmationCases772) for (const moment of ['ABORT', 'FINALLY']) {
      const actual = produce(role, moment)
      assert.deepEqual(actual.snapshot.server, [[2, 1, 0], [1, 1, 0], [1, 2, 3]])
      assert.deepEqual(actual.snapshot.native, [[3, 1, 240, false], [2, 2, 0, true]])
      assert.equal(actual.snapshot.malformed, false)
      const finite = confirmationDiagnostic(actual.message)
      assert.equal(finite.status, 'OBSERVED'); assert.deepEqual(finite.snapshot, actual.snapshot)
      assert.deepEqual(publicConfirmationDiagnostic(finite), finite)
      assert.equal(confirmationRoleForNameHash(digest(title)), role)
      assert.equal(terminalDiagnostic(actual.message), null)
    }
    assert.equal(confirmationRoleForNameHash(digest('not either actual native registration')), null)
  })

  add('772 real confirmation producer bounds observations and contains malformed inputs and sink failure', () => {
    let time = 1000
    const messages = [], observation = create('LOCAL', () => time, text => messages.push(text))
    time = 61001
    for (let round = 1; round <= 8; round++) for (let point = 1; point <= 5; point++) observation.server(point, round)
    for (let round = 1; round <= 8; round++) for (let point = 1; point <= 128; point++) observation.native(nativeFrame('LOCAL', point, round, 240, point % 2 === 0))
    const actual = observation.snapshot('FINALLY')
    assert.equal(actual.server.length, 40); assert.equal(actual.native.length, 1024)
    assert.equal(actual.server.every(row => row[2] === 240), true)
    assert.equal(actual.malformed, false)
    observation.server(1, 9); observation.native(nativeFrame('TERMINAL', 1, 1, 0, false))
    observation.emit('FINALLY')
    assert.equal(confirmationDiagnostic(messages[0]).snapshot.malformed, true)
    assert.ok(Buffer.byteLength(messages[0]) <= 32768)
    for (const badClock of [() => NaN, () => { throw Error('not published') }]) {
      const bad = create('LOCAL', badClock, () => {}); bad.server(1, 1)
      assert.equal(bad.snapshot('ABORT').malformed, true)
    }
    let attempts = 0
    const broken = create('LOCAL', () => 1000, () => { attempts++; throw Error('not published') })
    assert.doesNotThrow(() => { broken.emit('ABORT'); broken.emit('FINALLY') }); assert.equal(attempts, 1)
  })

  add('772 confirmation parser rejects negative mutants of real producer output and noncanonical bytes', () => {
    const actual = produce(), mutations = [
      snapshot => { snapshot.extra = 'PRIVATE_DO_NOT_PUBLISH' },
      snapshot => { snapshot.role = 'WORKSPACE' }, snapshot => { snapshot.moment = 'OPEN' },
      snapshot => { snapshot.server[0][0] = 0 }, snapshot => { snapshot.server[0][0] = 6 },
      snapshot => { snapshot.server[0][1] = 0 }, snapshot => { snapshot.server[0][1] = 9 },
      snapshot => { snapshot.native[0][0] = 129 }, snapshot => { snapshot.native[0][2] = 241 },
      snapshot => { snapshot.native[0][3] = 1 }, snapshot => { snapshot.native[0].pop() },
      snapshot => { snapshot.server.push([...snapshot.server[0]]) },
      snapshot => { snapshot.native.push([...snapshot.native[0]]) },
      snapshot => { snapshot.malformed = 'false' },
    ]
    for (const mutate of mutations) {
      const changed = clone(actual.snapshot); mutate(changed)
      assert.deepEqual(confirmationDiagnostic(CF + JSON.stringify(changed)), { status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT' })
    }
    for (const changed of [CF + ' ' + JSON.stringify(actual.snapshot), actual.message.replace('"schema":1', '"schema":1,"schema":1'), actual.message.replace('"schema":1', '"schema":1.0')]) assert.equal(confirmationDiagnostic(changed).status, 'UNKNOWN')
    assert.deepEqual(confirmationDiagnostic(CF + 'x'.repeat(32769)), { status: 'UNKNOWN', reason: 'OVERSIZE' })
    assert.equal(confirmationDiagnostic(LOCAL + JSON.stringify(actual.snapshot)), null)
  })

  add('772 public confirmation boundary refuses proxies accessors symbols holes and inherited serialization', () => {
    const actual = confirmationDiagnostic(produce().message)
    let touched = 0
    const proxy = new Proxy(actual, { ownKeys() { touched++; throw Error('private') } })
    const revoked = Proxy.revocable({}, {}); revoked.revoke()
    for (const value of [proxy, revoked.proxy]) assert.throws(() => publicConfirmationDiagnostic(value), { message: 'CENSUS_METADATA_INVALID' })
    const getter = clone(actual); Object.defineProperty(getter.snapshot, 'native', { get() { touched++; throw Error('private') } })
    assert.throws(() => publicConfirmationDiagnostic(getter), { message: 'CENSUS_METADATA_INVALID' })
    const symbol = clone(actual); symbol.snapshot[Symbol('private')] = true
    assert.throws(() => publicConfirmationDiagnostic(symbol), { message: 'CENSUS_METADATA_INVALID' })
    const hole = clone(actual); delete hole.snapshot.native[0][1]
    assert.throws(() => publicConfirmationDiagnostic(hole), { message: 'CENSUS_METADATA_INVALID' })
    const inherited = clone(actual); Object.setPrototypeOf(inherited.snapshot, { toJSON() { touched++; throw Error('private') } })
    assert.deepEqual(publicConfirmationDiagnostic(inherited), actual)
    assert.equal(touched, 0)
  })

  add('772 existing Local marker uses actual normal-emitted helpers and original payload constructor', () => {
    const local = actualLocal.create()
    local.dataObservation.renderer()
    local.dataObservation.frame({ type: 'terminal.data', b64: Buffer.from('PRIVATE_LOCAL_BYTES').toString('base64') })
    local.localProgress.runtime(); local.localProgress.attempt(); local.localProgress.handle()
    local.localProgress.incoming({ type: 'desktop.agent.start' })
    local.localProgress.outgoing(JSON.stringify({ type: 'desktop.confirmation.request', purpose: 'local-work', request_method: 'desktop.agent.start', confirmation_id: 'PRIVATE_CONFIRMATION_ID' }))
    local.localProgress.incoming({ type: 'desktop.confirmation.decision', purpose: 'local-work', confirmation_id: 'PRIVATE_CONFIRMATION_ID', approved: false })
    const message = local.marker({ first: ['D476_LOCAL_FIRST_W_8'], focus: 'D476_LOCAL_FOCUS_FOREGROUND_MISMATCH', activation: 'D476_LOCAL_ACTIVATE_1_2', receiptIndexes: [0, 1] })
    const finite = localDiagnostic(message)
    assert.equal(finite.status, 'OBSERVED'); assert.deepEqual(publicLocalDiagnostic(finite), finite)
    assert.equal(finite.snapshot.localProgress.protocolAttempts, 1)
    assert.equal(finite.snapshot.localProgress.protocolHandles, 1)
    assert.equal(finite.snapshot.localProgress.agentConfirmations, 1)
    assert.equal(finite.snapshot.localProgress.agentDecisions, 1)
    assert.equal(finite.snapshot.localData.terminalDataBytes, Buffer.byteLength('PRIVATE_LOCAL_BYTES'))
    assert.equal(finite.snapshot.localFirstSite.W, 8)
    assert.equal(finite.snapshot.localFocusResult, 'FOREGROUND_MISMATCH')
    assert.equal(finite.snapshot.localActivation.foreground, 'OTHER')
    assert.equal(finite.snapshot.receiptMask, 3)
    assert.equal(JSON.stringify(finite).includes('PRIVATE_'), false)
    assert.equal(confirmationDiagnostic(message), null); assert.equal(terminalDiagnostic(message), null)
    assert.equal(actualLocal.proof.wholeNativeModuleExecuted, false)
  })

  add('772 Local public parser rejects malformed counter enum and accessor mutants without leaking source strings', () => {
    const actual = localDiagnostic(actualLocal.create().marker())
    assert.equal(actual.status, 'OBSERVED')
    for (const mutate of [
      snapshot => { snapshot.extra = 'PRIVATE' }, snapshot => { snapshot.localFirstSite.W = 14 },
      snapshot => { snapshot.localFocusResult = 'PRIVATE' }, snapshot => { snapshot.localActivation = { requested: true, foreground: 'PRIVATE' } },
      snapshot => { snapshot.localProgress.protocolAttempts = 65536 }, snapshot => { snapshot.localData.terminalDataBytes = 16777217 },
      snapshot => { snapshot.localData.rendererFirstData = 1 }, snapshot => { snapshot.receiptMask = 256 },
    ]) { const changed = clone(actual.snapshot); mutate(changed); assert.deepEqual(localDiagnostic(LOCAL + JSON.stringify(changed)), { status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT' }) }
    let touched = 0
    const getter = clone(actual); Object.defineProperty(getter.snapshot, 'localProgress', { get() { touched++; throw Error('PRIVATE') } })
    assert.throws(() => publicLocalDiagnostic(getter), { message: 'CENSUS_METADATA_INVALID' }); assert.equal(touched, 0)
    assert.deepEqual(localDiagnostic(LOCAL + 'x'.repeat(4097)), { status: 'UNKNOWN', reason: 'OVERSIZE' })
    assert.equal(JSON.stringify(actual).includes('PRIVATE'), false)
  })
  return controls
}
