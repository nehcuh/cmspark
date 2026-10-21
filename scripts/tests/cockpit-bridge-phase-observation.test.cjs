'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createObservation, validProjection } = require('./cockpit-bridge-phase-observation.cjs')
const token = (id, bucket, end = '\n') => Buffer.from(`CM723P ${id} ${bucket}${end}`)
const fixture = () => { let tick = 1000, calls = 0; const api = createObservation(() => { calls++; return tick }); return { api, set(value) { tick = value }, calls: () => calls } }
const projection = (phases = [[1, 0]], registrar = [[1, 0]], at = 'CLOSE') => ({ v: 1, phases, registrar, at })

test('start resets only the observational origin once and nine phases use 250ms buckets', () => {
  const f = fixture(); f.set(2000); f.api.start(); f.api.mark(1)
  f.set(2249); f.api.mark(2); const calls = f.calls(); f.api.start(); assert.equal(f.calls(), calls)
  for (let id = 3; id <= 9; id++) { f.set(2000 + (id - 2) * 250); f.api.mark(id) }
  const value = f.api.snapshot('CLOSE')
  assert.deepEqual(value, projection([[1, 0], [2, 0], [3, 1], [4, 2], [5, 3], [6, 4], [7, 5], [8, 6], [9, 7]], null))
  assert.equal(validProjection(value), true)
})
test('registrar accepts every byte split, split CRLF, both ordinary success variants and independent clock domains', () => {
  for (const success of ['COCKPIT_BRIDGE_REGISTERED', 'COCKPIT_BRIDGE_ALREADY_REGISTERED']) {
    const f = fixture(); f.api.start(); f.api.mark(1); let entries = 0
    const body = Buffer.concat(Array.from({ length: 8 }, (_, index) => token(index + 1, 170 + index, '\r\n')).concat(Buffer.from(success + '\r\n')))
    for (const byte of body) if (f.api.feed(Buffer.from([byte]))) entries++
    assert.equal(entries, 1)
    assert.deepEqual(f.api.snapshot('CLOSE'), projection([[1, 0]], Array.from({ length: 8 }, (_, index) => [index + 1, 170 + index])))
  }
})
test('ENTRY signal occurs once even if a later token in the same chunk makes registrar unavailable', () => {
  const f = fixture(); assert.equal(f.api.feed(Buffer.concat([token(1, 0), token(1, 0)])), true)
  assert.equal(f.api.feed(token(1, 0)), false); assert.equal(f.api.snapshot('CLOSE').registrar, null)
})
test('missing entry and any partial EOF are unavailable, including CR without LF', () => {
  for (const body of ['', 'COCKPIT_BRIDGE_REGISTERED\n', 'CM723P 1 0', 'CM723P 1 0\r', 'CM723P 1 0\nCM723P 2']) {
    const f = fixture(); f.api.feed(Buffer.from(body)); assert.equal(f.api.snapshot('CLOSE').registrar, null)
  }
})
test('malformed, nonASCII, duplicate and out-of-order registrar bytes cannot recover', () => {
  for (const body of [
    token(2, 0), token(9, 0), token(1, 181), Buffer.from('CM723P 01 0\n'), Buffer.from('CM723P 1 00\n'),
    Buffer.from('CM723P 1 -1\n'), Buffer.from('CM723P 1 1.0\n'), Buffer.from('CM723P 1 0 \n'),
    Buffer.from('CM723P 1 0\nCM723P 3 2\nCM723P 2 2\n'), Buffer.from('CM723P 1 4\nCM723P 2 3\n'),
    Buffer.from('CM723P 1 0\nCM723P 1 1\n'), Buffer.from('COCKPIT_BRIDGE_REGISTERED\nCOCKPIT_BRIDGE_REGISTERED\n'),
    Buffer.from('COCKPIT_BRIDGE_ALREADY_REGISTERED\nCOCKPIT_BRIDGE_REGISTERED\n'), Buffer.from([0xc3, 0xa9, 10]), Buffer.from([0, 10]),
    Buffer.from('\n'), Buffer.from('PRIVATE_TEST_BODY /test/path\n'), Buffer.from('COCKPIT_BRIDGE_REGISTERED \n'),
  ]) {
    const f = fixture(); f.api.start(); f.api.mark(1); f.api.feed(body)
    assert.equal(f.api.feed(token(1, 0)), false)
    assert.deepEqual(f.api.snapshot('UNKNOWN'), projection([[1, 0]], null, 'UNKNOWN'))
  }
})
test('oversize line/chunk/flood and nonBuffer input remain bounded and drain without throwing', () => {
  for (const body of [Buffer.alloc(65, 65), Buffer.alloc(1025, 65), Buffer.alloc(2 * 1024 * 1024, 65), null, 'CM723P 1 0\n', {}]) {
    const f = fixture(); assert.doesNotThrow(() => f.api.feed(body))
    for (let index = 0; index < 32; index++) assert.equal(f.api.feed(token(1, 0)), false)
    assert.equal(f.api.snapshot('CLOSE').registrar, null)
  }
})
test('all permitted registrar stages and success output remain below hard line/byte caps', () => {
  const f = fixture(), body = Buffer.concat(Array.from({ length: 8 }, (_, index) => token(index + 1, index)).concat(Buffer.from('COCKPIT_BRIDGE_REGISTERED\n')))
  assert.ok(body.length <= 1024); assert.ok(body.toString().split('\n').length - 1 <= 16)
  assert.equal(f.api.feed(body), true); assert.equal(f.api.snapshot('CLOSE').registrar.length, 8)
})
test('phase IDs are integer ordered, may omit later stages, and never revive after a bad mark', () => {
  for (const id of [0, 10, 1.5, '1', NaN, Infinity, null]) {
    const f = fixture(); f.api.start(); f.api.mark(id); f.api.mark(1); f.api.feed(token(1, 0))
    assert.deepEqual(f.api.snapshot('ABORT'), projection(null, [[1, 0]], 'ABORT'))
  }
  for (const ids of [[2], [1, 1], [1, 3, 2]]) { const f = fixture(); for (const id of ids) f.api.mark(id); assert.equal(f.api.snapshot('CLOSE').phases, null) }
  const f = fixture(); f.api.mark(1); f.api.mark(9); assert.deepEqual(f.api.snapshot('CLOSE').phases, [[1, 0], [9, 0]])
})
test('clock faults affect only phases, with no inspection of an opaque thrown object', () => {
  const opaque = new Proxy({}, { get() { assert.fail('clock error inspected') }, ownKeys() { assert.fail('clock error inspected') } })
  for (const value of [NaN, Infinity, -Infinity, '0', null, undefined]) {
    const api = createObservation(() => value); api.start(); api.mark(1); api.feed(token(1, 0))
    assert.deepEqual(api.snapshot('CLOSE'), projection(null, [[1, 0]]))
  }
  const api = createObservation(() => { throw opaque }); assert.doesNotThrow(() => { api.start(); api.mark(1) }); api.feed(token(1, 0))
  assert.deepEqual(api.snapshot('CLOSE'), projection(null, [[1, 0]]))
  for (const phase of ['start', 'mark']) {
    let bad = false; const api = createObservation(() => { if (bad) throw opaque; return 0 }); if (phase === 'mark') api.start(); bad = true
    api[phase](1); assert.equal(api.snapshot('CLOSE').phases, null)
  }
})
test('backward time and buckets outside0..180 invalidate phases without changing registrar', () => {
  for (const elapsed of [-1, 45250]) { const f = fixture(); f.api.start(); f.api.mark(1); f.set(1000 + elapsed); f.api.mark(2); f.api.feed(token(1, 0)); assert.deepEqual(f.api.snapshot('CLOSE'), projection(null, [[1, 0]])) }
  const f = fixture(); f.api.start(); f.api.mark(1); f.set(46249); f.api.mark(2); assert.deepEqual(f.api.snapshot('CLOSE').phases, [[1, 0], [2, 180]])
})
test('sinkFailure is registrar-only and cannot revoke an already latched snapshot', () => {
  const f = fixture(); f.api.start(); f.api.mark(1); f.api.feed(token(1, 0)); f.api.sinkFailure()
  const first = f.api.snapshot('ABORT'); assert.deepEqual(first, projection([[1, 0]], null, 'ABORT'))
  f.api.sinkFailure(); assert.strictEqual(f.api.snapshot('CLOSE'), first)
})
test('first abort/close wins forever; rows and outer projection are deeply frozen and private', () => {
  for (const at of ['ABORT', 'CLOSE']) {
    const f = fixture(); f.api.start(); f.api.mark(1); f.api.feed(token(1, 0)); const first = f.api.snapshot(at)
    assert.ok(Object.isFrozen(first) && Object.isFrozen(first.phases) && Object.isFrozen(first.phases[0]) && Object.isFrozen(first.registrar) && Object.isFrozen(first.registrar[0]))
    assert.throws(() => { first.phases[0][0] = 9 }, TypeError); assert.throws(() => first.registrar.push([2, 0]), TypeError)
    f.set(999999); f.api.start(); f.api.mark(2); f.api.feed(Buffer.from('PRIVATE_LATE_BODY\n')); f.api.sinkFailure()
    assert.strictEqual(f.api.snapshot(at === 'ABORT' ? 'CLOSE' : 'ABORT'), first)
    assert.deepEqual(first, projection([[1, 0]], [[1, 0]], at)); assert.equal(/PRIVATE|path|error|stack|hwnd|pid|key|token/i.test(JSON.stringify(first)), false)
  }
})
test('snapshot at validation normalizes untrusted values to the closed UNKNOWN enum', () => {
  for (const value of ['', 'PRIVATE_AT', null, {}, Symbol('private')]) { const api = createObservation(() => 0); const result = api.snapshot(value); assert.equal(result.at, 'UNKNOWN'); assert.equal(validProjection(result), true) }
})
test('validProjection enforces exact own data fields and closed nested arrays without invoking getters', () => {
  assert.equal(validProjection(projection(null, null, 'UNKNOWN')), true)
  assert.equal(validProjection(projection([[1, 0], [9, 180]], [[1, 0], [8, 180]])), true)
  const accessor = { v: 1, phases: null, registrar: null }; Object.defineProperty(accessor, 'at', { get() { assert.fail('projection getter invoked') } })
  assert.equal(validProjection(accessor), false)
  const extraSymbol = projection(); extraSymbol[Symbol('extra')] = 1
  for (const value of [null, [], {}, { ...projection(), v: 2 }, { ...projection(), extra: 1 }, { ...projection(), at: 'close' }, extraSymbol,
    projection([], null), projection([[2, 0]], null), projection([[1, 0], [1, 1]], null), projection([[1, 1], [2, 0]], null),
    projection([[1, 181]], null), projection([[1, -1]], null), projection([[1, 0.5]], null), projection([[1, 0, 1]], null),
    projection(null, [[2, 0]]), projection(null, [[1, 0], [9, 0]]), projection(null, [[1, 0], [2, -1]]),
    projection(Array.from({ length: 10 }, (_, index) => [index + 1, 0]), null), projection(null, Array.from({ length: 9 }, (_, index) => [index + 1, 0])),
  ]) assert.equal(validProjection(value), false)
  const row = [1, 0]; row.extra = 1; assert.equal(validProjection(projection([row], null)), false)
  const rows = [[1, 0]]; rows.extra = 1; assert.equal(validProjection(projection(rows, null)), false)
})
