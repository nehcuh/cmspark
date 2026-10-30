import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { desktopArchiveFixture } from '../desktop-mcp-fixture.mjs'
import { restoreObservation788 } from './observation-788-inverse.mjs'
import { createArchiveInitialGate476 } from '../../tests/fixtures/native-archive-initial-gate-476.ts'

const read = p => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const generated = eol => desktopArchiveFixture('cpp', read('src/desktop/native/DesktopHost.cpp').replace(/\r?\n/g, eol), read('tests/fixtures/desktop-476/native-acceptance.cpp'), read('tests/fixtures/desktop-476/archive-form.js'), read('tests/fixtures/desktop-476/archive-acceptance.cpp'))

test('actual archive producer preserves host and gate for LF and CRLF', () => {
  for (const eol of ['\n', '\r\n']) {
    const original = read('src/desktop/native/DesktopHost.cpp').replace(/\r?\n/g, eol)
    const built = generated(eol)
    assert.equal(built.inverse, original)
    const prior = restoreObservation788(built.source)
    assert.equal(prior.split('if(!IsWindowVisible(window)||GetForegroundWindow()!=window)return;').length, 2)
    assert.equal(prior.includes('D476_PRE_A_'), false)
    assert.equal(built.source.includes('D476_PRE_A_READY'), true)
    assert.equal(built.source.includes('D476_PRE_A_SAT'), true)
  }
})

test('actual producer emits only bounded ids consumed as positive evidence', () => {
  const source = generated('\n').source
  const anchor = 'void D476ArchiveInitialActivation788::note476(Desktop& h,unsigned code) noexcept {'
  assert.equal(source.split(anchor).length, 2)
  let body = source.split(anchor)[1].split('/*OBS788_END*/')[0].trim()
  assert.equal(body.endsWith('}'), true)
  body = body.slice(0, -1).replace(/([0-9]+)u\b/g, '$1').replace(/catch\(\.\.\.\)/g, 'catch').replace(/L"/g, '"').replace('D476Acceptance::emit', 'emit').replace('D476Acceptance::emit', 'emit').replace('static wchar_t const* ids[]={', 'const ids=[').replace('};++sent476', '];++sent476')
  const ids = []
  const context = { h: {}, seen476: 0, sent476: 0, saturated476: false, emit: (_h, id) => ids.push(id) }
  const run = code => { context.code = code; vm.runInNewContext(`(function(){${body}})()`, context, { timeout: 1000 }) }
  for (let code = 0; code <= 8; code++) { run(code); run(code) }
  assert.equal(ids.length, 8)
  assert.equal(ids.at(-1), 'D476_PRE_A_SAT')
  const observer = createArchiveInitialGate476()
  for (const id of ids) observer.observe(id)
  assert.deepEqual(observer.snapshot(), { schema: 1, readySeen: true, passSeen: false, hiddenSeen: true, saturatedSeen: true, firstRelation: 'NULL' })
  const pristine = createArchiveInitialGate476()
  let reads = 0
  const trap = Object.defineProperty({}, 'toString', { get() { reads++; throw Error('private') } })
  for (const value of [null, trap, 'D476_PRE_A_READY\n', 'D476_PRE_A_R6', 'D476_PRE_A_READY_PRIVATE', 'D476_PRE_A_R0'.repeat(8)]) pristine.observe(value)
  assert.equal(reads, 0)
  assert.deepEqual(pristine.snapshot(), { schema: 1, readySeen: false, passSeen: false, hiddenSeen: false, saturatedSeen: false, firstRelation: null })
  for (const [index, relation] of ['NULL', 'OWNED_MAIN', 'OWNED_CONFIRMATION', 'SAME_PROCESS_OTHER', 'OTHER_PROCESS', 'UNKNOWN'].entries()) {
    const item = createArchiveInitialGate476(); item.observe(`D476_PRE_A_R${index}`); item.observe('D476_PRE_A_R0')
    assert.equal(item.snapshot().firstRelation, relation)
  }
  const separate = createArchiveInitialGate476()
  for (const id of ['D476_PRE_A_READY', 'D476_PRE_A_PASS', 'D476_PRE_A_R4']) separate.observe(id)
  assert.deepEqual(separate.snapshot(), { schema: 1, readySeen: true, passSeen: true, hiddenSeen: false, saturatedSeen: false, firstRelation: 'OTHER_PROCESS' })
})

test('actual generated gate preserves short circuit and caught observation throws preserve its decision', () => {
  const source = generated('\n').source
  const start = source.indexOf('/*OBS788_BEGIN*/bool visible476=false;HWND foreground476=nullptr;')
  const end = source.indexOf('\n started=true;', start)
  assert.ok(start >= 0 && end > start)
  let gate = source.slice(start, end).replaceAll('/*OBS788_BEGIN*/', '').replaceAll('/*OBS788_END*/', '')
  gate = gate.replace('bool visible476', 'let visible476').replace('HWND foreground476', 'let foreground476').replace('nullptr', 'null').replace('D476ArchiveAcceptance::relation788', 'relation').replace(/([0-9]+)u\b/g, '$1').replace(/catch\(\.\.\.\)/g, 'catch')
  const run = (visible, foreground, observerFault = false) => {
    const notes = [], calls = { visible: 0, foreground: 0 }
    const window = {}, other = {}
    const context = { h: {}, window, IsWindowVisible: () => { calls.visible++; return visible }, GetForegroundWindow: () => { calls.foreground++; return foreground === 'own' ? window : other }, relation: () => 4, note476: (_h, code) => { if (observerFault) throw Error('observer'); notes.push(code) } }
    const decision = vm.runInNewContext(`(function(){${gate};return 'PASS'})()`, context, { timeout: 1000 })
    return { decision, calls, notes }
  }
  assert.deepEqual(run(false, 'other'), { decision: undefined, calls: { visible: 1, foreground: 0 }, notes: [1] })
  assert.deepEqual(run(true, 'other'), { decision: undefined, calls: { visible: 1, foreground: 1 }, notes: [6] })
  assert.deepEqual(run(true, 'own'), { decision: 'PASS', calls: { visible: 1, foreground: 1 }, notes: [] })
  assert.deepEqual(run(true, 'other', true), { decision: undefined, calls: { visible: 1, foreground: 1 }, notes: [] })
  const relation = read('tests/fixtures/desktop-476/archive-acceptance.cpp')
  assert.match(relation, /GetForegroundWindow\(\)!=observed\)return 5;/)
})
