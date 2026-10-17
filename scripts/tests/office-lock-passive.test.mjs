// Pure CPU/inert-fs controls. The Windows fixture is parsed, never imported or run.
import test, { after, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import * as childProcess from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

let forbidden = 0
const deny = () => { forbidden++; throw new Error('Unexpected OS/network command in inert Office-lock controls') }
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) mock.method(childProcess.default, name, deny)
for (const module of [http, https]) for (const name of ['request', 'get']) mock.method(module, name, deny)
for (const name of ['connect', 'createConnection']) mock.method(net, name, deny)
mock.method(tls, 'connect', deny)
after(() => { assert.equal(forbidden, 0); mock.restoreAll() })

const ts = createRequire(new URL('../../companion/package.json', import.meta.url))('typescript')
const source = fs.readFileSync(new URL('./office-runtime-stage.test.mjs', import.meta.url), 'utf8')
const helperSource = fs.readFileSync(new URL('../office-smoke-cleanup.mjs', import.meta.url), 'utf8')
const ast = ts.createSourceFile('actual.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const loops = ast.statements.filter(n => ts.isForOfStatement(n) && n.getText(ast).includes('Windows owned executable lock'))
assert.equal(loops.length, 1)
const registration = loops[0].statement.expression
assert.ok(ts.isCallExpression(registration))
const actualCallback = registration.arguments[2].getText(ast)
const names = ['readOfficeLockDisposeReceipt', 'reportOfficeLock', 'officeLockNow']
const actualHelpers = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n')
const receiptConstant = ast.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'OFFICE_LOCK_DISPOSE_RECEIPT')).map(n => n.getText(ast)).join('\n')
const actualCleanup = helperSource.slice(helperSource.indexOf('export function')).replace('export function', 'function')

function receiptFs(data, fault) {
  const counts = { open: 0, read: 0, close: 0, capacity: 0 }
  return { counts, fs: {
    openSync() { counts.open++; if (fault === 'open' || data === undefined) throw Object.assign(new Error('owned IO fault'), { code: 'ENOENT' }); return 0 },
    readSync(fd, buffer, offset, length, position) {
      counts.read++; counts.capacity = length
      assert.equal(fd, 0); assert.equal(offset, 0); assert.equal(position, 0)
      if (fault === 'read') throw new Error('owned read fault')
      const bytes = Buffer.from(data); const n = Math.min(bytes.length, length); bytes.copy(buffer, 0, 0, n); return n
    },
    closeSync(fd) { counts.close++; assert.equal(fd, 0); if (fault === 'close') throw new Error('owned close fault') },
  } }
}

function actualRead(data, fault) {
  const owned = receiptFs(data, fault)
  const ctx = vm.createContext({ fs: owned.fs, Buffer })
  vm.runInContext(receiptConstant + '\n' + actualHelpers, ctx)
  assert.equal(typeof ctx.readOfficeLockDisposeReceipt, 'function', 'actual parent receipt observer is required')
  const result = ctx.readOfficeLockDisposeReceipt('/OWNED_INERT/receipt')
  return { result, counts: owned.counts }
}

for (const [name, data, expected] of [
  ['exact completion', 'DISPOSE_RETURNED_V1', 'DISPOSE_RETURNED'],
  ['missing', undefined, 'NOT_OBSERVED'], ['empty', '', 'NOT_OBSERVED'],
  ['partial', 'DISPOSE_RETURN', 'NOT_OBSERVED'], ['wrong enum', 'DISPOSE_FAILED_V1', 'NOT_OBSERVED'],
  ['extra LF', 'DISPOSE_RETURNED_V1\n', 'NOT_OBSERVED'],
  ['oversized', 'DISPOSE_RETURNED_V1' + 'x'.repeat(4096), 'NOT_OBSERVED'],
  ['high-bit malformed bytes', Buffer.from('DISPOSE_RETURNED_V1').map(byte => byte | 0x80), 'NOT_OBSERVED'],
]) test(`actual bounded receipt reader: ${name}`, () => {
  const { result, counts } = actualRead(data)
  assert.equal(result, expected)
  assert.equal(counts.open, 1)
  assert.equal(counts.read, data === undefined ? 0 : 1)
  assert.equal(counts.close, data === undefined ? 0 : 1)
  if (counts.read) assert.equal(counts.capacity, Buffer.byteLength('DISPOSE_RETURNED_V1') + 1)
})
for (const fault of ['open', 'read', 'close']) test(`actual receipt ${fault} failure remains NOT_OBSERVED`, () => {
  const { result, counts } = actualRead('DISPOSE_RETURNED_V1', fault)
  assert.equal(result, 'NOT_OBSERVED')
  assert.equal(counts.read, fault === 'open' ? 0 : 1)
  assert.equal(counts.close, fault === 'open' ? 0 : 1)
})

async function runActual(release, { helperError, cleanupError, diagnosticFault = false, clockFault = false, receipt = 'DISPOSE_RETURNED_V1' } = {}) {
  const events = [], records = [], observed = receiptFs(receipt)
  let exists = true, aliveChecks = 0, closeQueued = false, script
  const ownedPath = '/OWNED_INERT/office-lock', directory = path.join(ownedPath, 'runtime')
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 42; child.exitCode = null
  const fakeFs = { ...observed.fs,
    mkdtempSync() { return ownedPath }, mkdirSync() {},
    writeFileSync(name, value, options) {
      if (path.basename(name) === 'release') {
        events.push('signal')
        if (!closeQueued) { closeQueued = true; queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0) }) }
      }
    },
    rmSync(name, options) {
      if (name === ownedPath) { events.push('final-remove'); if (cleanupError) throw cleanupError; exists = false; return }
      assert.equal(name, directory)
      if (options.maxRetries !== undefined) {
        events.push('bounded-remove'); assert.equal(options.maxRetries, 3); assert.equal(options.retryDelay, 100)
        if (helperError) throw helperError
        if (release) { exists = false; return }
      } else events.push('immediate-remove')
      throw Object.assign(new Error('owned locked fixture'), { code: 'EBUSY' })
    }, existsSync() { return exists },
  }
  const ctx = vm.createContext({ fs: fakeFs, Buffer, assert, path, release,
    os: { tmpdir: () => '/OWNED_INERT' }, randomUUID: () => '00000000-0000-4000-8000-000000000001',
    performance: { now: () => { if (clockFault) throw new Error('owned clock fault'); return 7 } },
    process: { env: {}, kill(pid, signal) { assert.equal(pid, 42); assert.equal(signal, 0); aliveChecks++ } },
    spawn(command, args, options) {
      assert.equal(command, 'powershell.exe'); script = args.at(-1); events.push('spawn-inert')
      assert.equal(options.cwd, ownedPath)
      if (names.every(name => actualHelpers.includes(`function ${name}(`))) {
        assert.equal(options.env.CMSPARK_TEST_OFFICE_RECEIPT, path.join(ownedPath, 'dispose-00000000-0000-4000-8000-000000000001.receipt'))
        assert.notEqual(path.dirname(options.env.CMSPARK_TEST_OFFICE_RECEIPT), directory)
      }
      queueMicrotask(() => child.stdout.emit('data', Buffer.from('ready\n')))
      return child
    },
  })
  vm.runInContext(receiptConstant + '\n' + actualHelpers + '\n' + actualCleanup, ctx)
  const callback = vm.runInContext('(' + actualCallback + ')', ctx)
  let error
  try { await callback({ diagnostic(value) { if (diagnosticFault) throw new Error('owned logger fault'); records.push(JSON.parse(value)) } }) } catch (e) { error = e }
  return { error, events, records, observed: observed.counts, aliveChecks, script }
}

test('actual positive callback keeps original signal immediately before bounded cleanup and adds passive evidence', async () => {
  const r = await runActual(true)
  assert.equal(r.error, undefined)
  assert.deepEqual(r.events, ['spawn-inert', 'immediate-remove', 'signal', 'bounded-remove', 'signal', 'final-remove'])
  assert.deepEqual(r.records.map(v => v.stage), ['holder-ready', 'lock-proved', 'release-signaled', 'helper-enter', 'helper-return', 'finally-enter', 'finally-close', 'finally-return'])
  assert.equal(r.observed.read, 1)
  assert.equal(r.records.find(v => v.stage === 'finally-enter').dispose_receipt, 'DISPOSE_RETURNED')
  for (const v of r.records) {
    assert.deepEqual(Object.keys(v), ['schema', 'case', 'stage', 'elapsed_ms', 'code', 'dispose_receipt'])
    assert.equal(v.case, 'transient'); assert.equal(v.elapsed_ms, 0)
    assert.doesNotMatch(JSON.stringify(v), /OWNED_INERT|pid|path|env|stack|message/)
  }
})

test('actual helper error is rethrown as the SAME object with diagnostic faults isolated', async () => {
  const sentinel = Object.assign(new Error('OWNED_PRIMARY'), { code: 'EBUSY' })
  for (const diagnosticFault of [false, true]) {
    const r = await runActual(true, { helperError: sentinel, diagnosticFault })
    assert.equal(r.error, sentinel)
    assert.equal(r.events.at(-1), 'final-remove')
    if (!diagnosticFault) assert.ok(r.records.some(v => v.stage === 'helper-failure' && v.code === 'EBUSY'))
  }
})

test('actual success and finally cleanup errors survive logger faults unchanged', async () => {
  assert.equal((await runActual(true, { diagnosticFault: true })).error, undefined)
  const sentinel = new Error('OWNED_FINALLY')
  assert.equal((await runActual(true, { diagnosticFault: true, cleanupError: sentinel })).error, sentinel)
})

test('actual persistent negative retains EBUSY, file-presence and owned-alive assertions', async () => {
  const r = await runActual(false, { receipt: undefined })
  assert.equal(r.error, undefined); assert.equal(r.aliveChecks, 1)
  assert.ok(r.records.some(v => v.stage === 'helper-expected-refusal'))
  assert.equal(r.records.some(v => v.stage === 'release-signaled'), false)
})

test('actual PowerShell completion is after original Dispose, CreateNew once, and isolated only for receipt IO', async () => {
  const { script, error } = await runActual(true)
  assert.equal(error, undefined)
  assert.equal(script.split('$handle.Dispose()').length - 1, 1)
  assert.ok(script.indexOf('$handle.Dispose()') < script.indexOf('[IO.FileMode]::CreateNew'))
  assert.equal(script.split('[IO.FileMode]::CreateNew').length - 1, 1)
  assert.match(script, /GetBytes\('DISPOSE_RETURNED_V1'\)/)
  assert.match(script, /\} finally \{\s*\$handle\.Dispose\(\)\s*try \{/)
  assert.match(script, /Start-Sleep -Milliseconds 10/)
  assert.match(script, /ElapsedMilliseconds -gt 10000/)
})

test('actual clock failure cannot change success and produces no invented elapsed time', async () => {
  const r = await runActual(true, { clockFault: true })
  assert.equal(r.error, undefined)
  assert.ok(r.records.length > 0)
  assert.ok(r.records.every(record => record.elapsed_ms === null))
})

test('actual diagnostic code getter failure cannot replace the original helper error', async () => {
  const sentinel = new Error('OWNED_PRIMARY_GETTER')
  Object.defineProperty(sentinel, 'code', { get() { throw new Error('owned diagnostic getter fault') } })
  assert.equal((await runActual(true, { helperError: sentinel })).error, sentinel)
})

test('actual reporter admits only fixed stages, code enums and receipt enums', () => {
  const records = []
  const ctx = vm.createContext({ performance: { now: () => 7 } })
  vm.runInContext(actualHelpers, ctx)
  assert.equal(typeof ctx.reportOfficeLock, 'function')
  const t = { diagnostic(value) { records.push(JSON.parse(value)) } }
  ctx.reportOfficeLock(t, true, 'PRIVATE_UNEXPECTED_STAGE', 7, { code: 'PRIVATE_ERROR' }, 'PRIVATE_RECEIPT')
  assert.equal(records.length, 0)
  ctx.reportOfficeLock(t, true, 'helper-failure', 7, { code: 'PRIVATE_ERROR', message: 'PRIVATE_MESSAGE' }, 'PRIVATE_RECEIPT')
  assert.equal(records.length, 1)
  assert.equal(records[0].code, 'OTHER')
  assert.equal(records[0].dispose_receipt, 'NOT_OBSERVED')
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE/)
})


test('actual finite diagnostic snapshots a stateful code getter exactly once', () => {
  for (const [first, second, expected] of [
    ['EBUSY', 'OWNED_NONENUM_CODE_SENTINEL', 'EBUSY'],
    ['OWNED_NONENUM_CODE_SENTINEL', 'EBUSY', 'OTHER'],
  ]) {
    let reads = 0
    const error = Object.defineProperty({}, 'code', { get() { return ++reads === 1 ? first : second } })
    const records = []
    const ctx = vm.createContext({ performance: { now: () => 7 } })
    vm.runInContext(actualHelpers, ctx)
    ctx.reportOfficeLock({ diagnostic(value) { records.push(JSON.parse(value)) } }, true, 'helper-failure', 7, error)
    assert.equal(records.length, 1)
    assert.equal(reads, 1, 'the validated and emitted code must be the same observation')
    assert.equal(records[0].code, expected)
    assert.doesNotMatch(JSON.stringify(records), /OWNED_NONENUM_CODE_SENTINEL/)
  }
})
