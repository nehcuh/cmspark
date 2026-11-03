/** Real source/process controls; no native UI, SDK response fixture or config writes. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import * as ts from 'typescript'

const helper = path.resolve('tests/helpers/workspace-xctest-owned-705.ts')
const nativeFile = path.resolve('tests/desktop-native-thread-metadata-476.test.ts')
const plain = (value: any) => JSON.parse(JSON.stringify(value))
function actualResultOutput(owner: any) {
  const text = fs.readFileSync(nativeFile, 'utf8'), ast = ts.createSourceFile(nativeFile, text, ts.ScriptTarget.Latest, true)
  const matches: ts.ArrowFunction[] = []
  function visit(n: ts.Node) { if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'observeClosedXcodeResultOnce' && ts.isArrowFunction(n.arguments[0])) matches.push(n.arguments[0]); ts.forEachChild(n, visit) }
  visit(ast); assert.equal(matches.length, 1)
  const rows: string[] = [], code = ts.transpileModule('(' + matches[0].getText(ast) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return { rows, emit: vm.runInNewContext(code, { owner, Buffer, process: { stdout: { write(line: string) { rows.push(line) } } } }) }
}
function sourceOwner(now = () => performance.now(), spawnPort: typeof spawn = spawn, uid = process.getuid?.() ?? 0) {
  const source = fs.readFileSync(helper, 'utf8'), ast = ts.createSourceFile(helper, source, ts.ScriptTarget.Latest, true)
  const owner = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'OwnedWorkspaceUI705') as ts.ClassDeclaration
  assert.ok(owner)
  const names = new Set(['refused', 'result705Unknown', 'RESULT705_IDS', 'RESULT705_TYPES', 'RESULT705_SOURCES', 'result705Select', 'result705Project', 'result705AfterActualClose'])
  const selected = ast.statements.filter(n => ts.isFunctionDeclaration(n) ? names.has(n.name?.text ?? '') : ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.has(d.name.getText(ast)))).map(n => n.getText(ast))
  assert.equal(selected.length, names.size)
  const text = selected.join('\n') + '\nclass Actual {' + owner.members.filter(n => !ts.isConstructorDeclaration(n)).map(n => n.getText(ast)).join('\n') + '}\nglobalThis.Actual=Actual'
  // The Unix-only owner is exercised with the actual fixture UID on Windows too.
  const scope: any = { fs, path, createHash, spawn: spawnPort, performance: { now }, process: { getuid: () => uid, pid: process.pid }, Buffer, TextDecoder, URL, URLSearchParams, setTimeout, clearTimeout }
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope)
  return new scope.Actual()
}

test('826 owner timeline is same-clock once-only, bounded, inert and detached from authority', () => {
  let now = 100
  const owner = sourceOwner(() => now)
  now = 200; owner.note826(1); now = 600; owner.note826(1)
  owner.observeNativeExit826(0); owner.observeCompleteRejection826(); owner.note826(6)
  now = 100000; owner.note826(7, null, 'SIGTERM'); owner.observeRootRemoval826()
  const out = plain(owner.timeline826())
  assert.deepEqual(out.points.map((row: any[]) => row[0]), [1, 4, 5, 6, 7, 9])
  assert.deepEqual(out.points[0], [1, 0, false, 0]); assert.deepEqual(out.points.at(-1), [9, 240, true, 0])
  assert.equal(owner.xcodeClosed, false); assert.equal(owner.xcodeCode, null); assert.equal(owner.observerClosed, false)
  out.points[0][1] = 99; assert.equal(owner.timeline826().points[0][1], 0)
  for (const value of [NaN, Infinity, -1]) {
    let clock = 100; const fresh = sourceOwner(() => clock)
    clock = value; fresh.note826(2); assert.deepEqual(plain(fresh.timeline826()).points, [])
    clock = 200; fresh.note826(2); assert.deepEqual(plain(fresh.timeline826()).points, [], 'failed first observation is not replaced by a later attempt')
  }
  let throwing = false
  const bad = sourceOwner(() => { if (throwing) throw Error('owned-clock-refusal'); return 100 })
  throwing = true; assert.doesNotThrow(() => bad.note826(2)); assert.deepEqual(plain(bad.timeline826()).points, [])
})

test('826 actual exit event never substitutes for close and all original completion gates remain', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'owner826-')))
  try {
    for (const variant of ['success', 'observerBad', 'notQuiescent', 'xcodeBad']) {
      const children: any[] = [], controller = new AbortController()
      const port: any = () => { const child: any = new EventEmitter(); child.kill = () => true; children.push(child); return child }
      const owner = sourceOwner(() => 100, port), root = path.join(dir, variant); fs.mkdirSync(root)
      owner.scene = { root, nonce: 'owned', check() {}, read: () => undefined, write() {}, closure: (a: boolean, b: boolean) => a && b && variant !== 'notQuiescent' }
      owner.signal = controller.signal; owner.resultSourceRoot = path.resolve('tests/fixtures/workspace-ui-705')
      owner.start(); assert.equal(children.length, 2)
      let settled = false
      const done = owner.complete().then(() => { settled = true; return true }, () => { settled = true; return false })
      children[0].emit('close', variant === 'observerBad' ? 7 : 0, null)
      children[1].emit('exit', variant === 'xcodeBad' ? 7 : 0, null)
      await Promise.resolve()
      assert.equal(owner.xcodeClosed, false); assert.equal(owner.xcodeCode, null)
      if (variant !== 'observerBad') assert.equal(settled, false)
      children[1].emit('close', variant === 'xcodeBad' ? 7 : 0, null)
      if (variant === 'notQuiescent') controller.abort()
      assert.equal(await done, variant === 'success')
      assert.ok(owner.timeline826().points.some((row: any[]) => row[0] === 7))
      assert.ok(owner.timeline826().points.some((row: any[]) => row[0] === 8))
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('826 real query process facts distinguish existing rejections without inventing SDK data', async () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'query826-')))
  try {
    for (const mode of ['NONZERO', 'STDERR', 'SPAWN_ERROR', 'INVALID_RESULT', 'SIGNAL', 'OUT_LIMIT', 'ERR_LIMIT', 'STREAM_ERROR']) {
      const root = fs.mkdtempSync(path.join(parent, 'scene-')); fs.mkdirSync(path.join(root, 'Result.xcresult'))
      let calls = 0
      const port: any = (binary: string, args: string[], options: any) => {
        assert.equal(binary, '/usr/bin/xcrun'); assert.deepEqual(Array.from(args).slice(0, 4), ['xcresulttool', 'get', 'test-results', 'tests']); calls++
        const code = mode === 'NONZERO' ? 'process.exit(7)' : mode === 'STDERR' ? 'process.stderr.write("owned-refusal\\n")' : mode === 'OUT_LIMIT' ? 'process.stdout.write(Buffer.alloc(1048577,65))' : mode === 'ERR_LIMIT' ? 'process.stderr.write(Buffer.alloc(1048577,65))' : mode === 'SIGNAL' ? 'setInterval(()=>{},1000)' : mode === 'STREAM_ERROR' ? 'process.exit(0)' : 'process.stdout.write("{}")'
        const child = mode === 'SPAWN_ERROR' ? spawn(path.join(parent, 'known-missing-tool'), [], options) : spawn(process.execPath, ['-e', code], options)
        if (mode === 'SIGNAL') child.once('spawn', () => child.kill('SIGTERM'))
        if (mode === 'STREAM_ERROR') child.once('spawn', () => child.stdout!.destroy(Error('owned-stream-refusal')))
        return child
      }
      const owner = sourceOwner(() => performance.now(), port, fs.lstatSync(root).uid)
      owner.scene = { root, check() { assert.equal(fs.realpathSync(root), root) } }
      owner.xcodeClosed = true; owner.resultSourceRoot = path.resolve('tests/fixtures/workspace-ui-705')
      const value: any = await new Promise(resolve => owner.observeClosedXcodeResultOnce(resolve))
      assert.equal(calls, 1); assert.equal(value.nativePassClaim, false); assert.equal(Object.hasOwn(value, 'tool826'), false, 'original result object remains unchanged')
      assert.equal(value.reason, mode === 'INVALID_RESULT' ? 'INVALID_RESULT' : mode.endsWith('LIMIT') ? 'LIMIT' : 'TOOL_FAILURE')
      const facts = plain(owner.toolFacts826()); assert.equal(facts.length, 1); assert.equal(facts[0][0], 1)
      assert.equal(facts[0].length, 9)
      if (mode === 'NONZERO') { assert.equal(facts[0][1], false); assert.equal(facts[0][2], 7) }
      if (mode === 'STDERR') { assert.equal(facts[0][2], 0); assert.equal(facts[0][7], 14) }
      if (mode === 'SPAWN_ERROR' || mode === 'STREAM_ERROR') assert.equal(facts[0][1], true)
      if (mode === 'SIGNAL') assert.equal(facts[0][3], 1)
      if (mode === 'OUT_LIMIT') { assert.equal(facts[0][6], 1048577); assert.equal(facts[0][8], true) }
      if (mode === 'ERR_LIMIT') { assert.equal(facts[0][7], 1048577); assert.equal(facts[0][8], true) }
      assert.ok(Buffer.byteLength(JSON.stringify(facts)) < 256)
      if (mode === 'NONZERO') {
        const earlier = owner.timeline826(); owner.observeRootRemoval826()
        assert.equal(earlier.points.some((row: any[]) => row[0] === 9), false)
        const output = actualResultOutput(owner); output.emit(value)
        assert.equal(output.rows.length, 1)
        const result = JSON.parse(output.rows[0].slice('D705_XCRESULT_DETAILS_CLOSED '.length))
        assert.equal(result.reason, value.reason); assert.equal(result.nativePassClaim, false)
        assert.deepEqual(result.tool826, facts); assert.ok(result.timing826.points.some((row: any[]) => row[0] === 9))
        assert.ok(Buffer.byteLength(output.rows[0].slice('D705_XCRESULT_DETAILS_CLOSED '.length).trim()) <= 1024)
        owner.timeline826 = () => ({ schema: 1, points: ['OWNED_PRIVATE'.repeat(200)] })
        const oversized = actualResultOutput(owner); oversized.emit(value)
        assert.deepEqual(JSON.parse(oversized.rows[0].slice('D705_XCRESULT_DETAILS_CLOSED '.length)), plain(value))
        owner.toolFacts826 = () => { throw Error('OWNED_PRIVATE') }
        const refused = actualResultOutput(owner); refused.emit(value)
        assert.deepEqual(JSON.parse(refused.rows[0].slice('D705_XCRESULT_DETAILS_CLOSED '.length)), plain(value))
      }
    }
  } finally { fs.rmSync(parent, { recursive: true, force: true }) }
})

test('826 actual cleanup records removal only after successful rm and does not replace failure or settle order', async () => {
  const source = fs.readFileSync(nativeFile, 'utf8'), ast = ts.createSourceFile(nativeFile, source, ts.ScriptTarget.Latest, true)
  let block: ts.Block | undefined
  function visit(n: ts.Node) { if (ts.isTryStatement(n) && n.finallyBlock?.getText(ast).includes('D476_WORKSPACE_NATIVE_PHASE')) block = n.finallyBlock; ts.forEachChild(n, visit) }
  visit(ast); assert.ok(block)
  const start = block.statements.findIndex(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'uiClosed')); assert.ok(start >= 0)
  const body = block.statements.slice(start).map(n => n.getText(ast)).join('\n')
  for (const mode of ['success', 'sinkThrow', 'rmThrow', 'cleanupThrow']) {
    const trace: string[] = [], primary = Error('owned-primary')
    const run = vm.runInNewContext('(async()=>{try{throw primary}finally{' + body + '}})', {
      primary, primaryFailed: true, old: undefined, dir: 'owned', process: { env: {} }, t: { diagnostic() {} },
      uiOwner: { async cleanup() { trace.push('cleanup'); if (mode === 'cleanupThrow') throw Error('owned-lifetime-refusal') }, observeRootRemoval826() { trace.push('removed'); if (mode === 'sinkThrow') throw Error('owned-sink-refusal') } },
      fs: { rmSync() { trace.push('rm'); if (mode === 'rmThrow') throw Error('owned-rm-refusal') } }, surfaceLease: { settled() { trace.push('settled') } },
    })
    await assert.rejects(run(), (error: any) => mode === 'rmThrow' ? error.message === 'owned-rm-refusal' : error === primary)
    assert.deepEqual(trace, mode === 'cleanupThrow' ? ['cleanup'] : mode === 'rmThrow' ? ['cleanup', 'rm'] : ['cleanup', 'rm', 'removed', 'settled'])
  }
})

test('826 actual query fact producer keeps both stages once and projects only closed process facts', () => {
  const text = fs.readFileSync(helper, 'utf8'), ast = ts.createSourceFile(helper, text, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'result705AfterActualClose') as ts.FunctionDeclaration
  const declarations = fn.body!.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ['facts826', 'record826'].includes(d.name.getText(ast))))
  assert.equal(declarations.length, 2)
  const code = ts.transpileModule(declarations.map(n => n.getText(ast)).join('\n') + ';globalThis.record=record826;globalThis.facts=facts826', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const scope: any = {}; vm.runInNewContext(code, scope)
  scope.record(1, false, 0, null, true, true, 2, 0, false)
  scope.record(1, true, 7, 'SIGTERM', false, false, 99, 99, true)
  scope.record(2, true, -2, 'OWNED_PRIVATE_SIGNAL', false, true, Number.MAX_SAFE_INTEGER, NaN, true)
  const facts = plain(scope.facts)
  assert.deepEqual(facts, [[1, false, 0, 0, true, true, 2, 0, false], [2, true, -1, 3, false, true, 1048577, 1048577, true]])
  assert.equal(JSON.stringify(facts).includes('OWNED_PRIVATE'), false)
})

test('826 complete source inverse preserves raw LF/CRLF and refuses drift without refreshing old seals', () => {
  const { restoreObservation826 } = require(path.resolve('scripts/tests/observation-826-inverse.cjs'))
  for (const [kind, file] of [['helper', helper], ['native', nativeFile]]) for (const eol of ['\n', '\r\n']) {
    const raw = fs.readFileSync(file, 'utf8').replace(/\r?\n/g, eol), prior = restoreObservation826(kind, raw)
    assert.equal(prior.includes('/*OBS826_'), false); assert.equal(prior.includes('\r\n'), eol === '\r\n')
    for (const mutant of [raw + eol, raw + raw, raw.replace('/*OBS826_BEGIN*/', ''), raw.replace('/*OBS826_BEGIN*/', '/*OBS825_BEGIN*/')]) assert.throws(() => restoreObservation826(kind, mutant))
  }
})
