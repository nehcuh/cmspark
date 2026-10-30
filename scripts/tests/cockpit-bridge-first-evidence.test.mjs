import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import os from 'node:os'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { restoreObservation788 } from '../../companion/scripts/tests/observation-788-inverse.mjs'
const require = createRequire(import.meta.url)
const api = require('./cockpit-bridge-first-evidence.cjs')
const sites = require('./cockpit-bridge-first-sites.cjs')
const self = fileURLToPath(import.meta.url)

if (process.argv[2] === '--producer') {
  const mode = process.argv[3]
  assert.ok(['pass', 'phases', 'assert', 'throw', 'spoof', 'timeout', 'async', 'target-callback', 'duplicate', 'partial', 'flood', 'missing', 'chunks'].includes(mode))
  let callback
  if (mode === 'async' || mode === 'target-callback') {
    // Execute the actual instrumented asynchronous CPU assertion callback.
    const ts = createRequire(new URL('../../companion/package.json', import.meta.url))('typescript')
    const source = fs.readFileSync(new URL('./cockpit-bridge-real-first.cjs', import.meta.url), 'utf8')
    const ast = ts.createSourceFile('actual-controller.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    function find(node) {
      if (mode === 'async' && ts.isCallExpression(node) && node.expression.getText(ast) === 'cpu.stdout.on' && node.arguments[0]?.text === 'data') callback = node.arguments[1].getText(ast)
      if (mode === 'target-callback' && ts.isCallExpression(node) && node.expression.getText(ast) === "this.command('Target.getTargets').then") callback = node.arguments[0].getText(ast)
      ts.forEachChild(node, find)
    }
    find(ast); assert.ok(callback)
  }
  const observer = api.createObserver()
  if (['duplicate', 'partial', 'flood', 'chunks'].includes(mode)) {
    const frames = []
    const actual = api.createObserver(bytes => { frames.push(bytes); return bytes.length })
    try { actual.assert(1, assert.equal)(false, true) } catch { }
    const frame = frames[0]
    if (mode === 'duplicate') fs.writeSync(3, Buffer.concat([frame, frame]))
    if (mode === 'partial') fs.writeSync(3, frame.subarray(0, -1))
    if (mode === 'flood') { fs.writeSync(3, Buffer.alloc(4097)); await new Promise(resolve => setTimeout(resolve, 30)); fs.writeSync(3, Buffer.from('must-still-drain\n')) }
    if (mode === 'chunks') for (const byte of frame) fs.writeSync(3, Buffer.from([byte]))
  } else if (mode !== 'missing') {
    let actualCallback
    if (callback) {
      const vm = require('node:vm')
      actualCallback = vm.runInNewContext('let cpuReceipt="";(' + callback + ')', { evidence: observer, assert, found() {} })
    }
    test('actual Chrome document native parent / actual authenticated WS first identity STOP gate', { timeout: 40 }, async t => {
      observer.start(t.signal)
      if (mode === 'phases') {
        const clock = require('./cockpit-bridge-phase-observation.cjs').createObservation(() => 0); clock.start(); clock.mark(1)
        clock.feed(Buffer.from('CM723P 1 0\n')); observer.phases(clock.snapshot('CLOSE'))
      }
      let ok = false
      try {
        if (mode === 'assert') observer.assert(1, assert.equal)(false, true, 'PRIVATE_ASSERTION_BODY')
        if (mode === 'throw') await observer.wait(1, () => Promise.reject(Error('PRIVATE_THROW_BODY')))
        if (mode === 'spoof') await observer.wait(1, () => Promise.reject(Error("PRIVATE\n  failureType: 'testTimeoutFailure'\n  ...\n1..1")))
        if (mode === 'timeout') await observer.wait(1, () => new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 200)
          t.signal.addEventListener('abort', () => { clearTimeout(timer); reject(t.signal.reason) }, { once: true })
        }))
        if (mode === 'async') await observer.wait(1, () => new Promise(resolve => {
          const timer = setTimeout(resolve, 200)
          t.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
          process.nextTick(() => actualCallback(Buffer.alloc(4097)))
        }))
        if (mode === 'target-callback') await observer.wait(1, () => new Promise(resolve => {
          const timer = setTimeout(resolve, 200)
          t.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
          Promise.resolve({ targetInfos: null }).then(actualCallback)
        }))
        ok = true
      } finally { observer.complete(ok) }
    })
  }
} else {
  // The existing mandatory workflow entry owns these pure diagnostic controls.
  require('./cockpit-bridge-phase-observation.test.cjs')
  await import('./cockpit-bridge-phase-integration.test.mjs')
  const ts = createRequire(new URL('../../companion/package.json', import.meta.url))('typescript')
  const controller = fs.readFileSync(new URL('./cockpit-bridge-real-first.cjs', import.meta.url), 'utf8')
  const parentFile = fileURLToPath(new URL('./cockpit-bridge-first-gate.cjs', import.meta.url))
  const parentText = fs.readFileSync(parentFile, 'utf8'), parentAst = ts.createSourceFile(parentFile, parentText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const functionNames = new Set(['boundedEvidence', 'registrationEvidence', 'failureEvidence']), constantNames = new Set(['STEP_LABELS', 'GATE_STAGES', 'REGISTRATION_REASONS'])
  const actualFunctions = []
  for (const node of parentAst.statements) {
    if (ts.isFunctionDeclaration(node) && functionNames.has(node.name?.text)) { actualFunctions.push(node.getText(parentAst)); functionNames.delete(node.name.text) }
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (constantNames.has(declaration.name.getText(parentAst))) { actualFunctions.push('const ' + declaration.getText(parentAst)); constantNames.delete(declaration.name.getText(parentAst)) }
  }
  assert.equal(functionNames.size, 0); assert.equal(constantNames.size, 0)
  const describe = vm.runInNewContext('(()=>{' + actualFunctions.join('\n') + ';return failureEvidence})()', { fs, Buffer, firstEvidence: api })
  function coverage(text) {
    const ast = ts.createSourceFile('actual-controller.cjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    assert.equal(ast.parseDiagnostics.length, 0)
    const positions = new Set(), uses = new Map(), awaits = [], assertions = [], buildJoins = [], methods = { await: ['wait'], assert: ['assert', 'check'], 'event-callback': ['callback'], 'promise-callback': ['callback'], 'named-event-callback': ['callback'], 'top-sync': ['sync'], 'outer-surface': ['surfaceWait'], 'prearmed-positive': ['arm'], 'physical-escape': ['refuse'], 'body-sync': ['sync'], 'main-escape': ['primary'], 'action-escape': ['primary'] }
    function walk(node, checked = false) {
      if (ts.isAwaitExpression(node)) {
        assert.ok(ts.isCallExpression(node.expression) && ['evidence.wait', 'evidence.surfaceWait'].includes(node.expression.expression.getText(ast)), 'every actual await keeps its observation boundary')
        awaits.push(node)
      }
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(ast)
        if (name === 'Promise.allSettled') buildJoins.push(node)
        assert.ok(!/^assert\./.test(name) || checked, 'no escaping original assertion loses its wrapper')
        if (/^evidence\.(wait|assert|check|callback|sync|surfaceWait|arm|refuse|fallback|primary)$/.test(name)) {
          const id = Number(node.arguments[0]?.getText(ast)); assert.ok(Object.hasOwn(sites.sites, id))
          // The outer fallback deliberately refers to its enclosing site87.
          if (name !== 'evidence.fallback') {
            assert.equal(positions.has(id), false); positions.add(id)
            const point = ast.getLineAndCharacterOfPosition(node.getStart(ast))
            assert.deepEqual(sites.sites[id], [point.line + 1, point.character + 1])
          }
          const list = uses.get(id) || []; list.push(name.slice(9)); uses.set(id, list)
          if (name === 'evidence.assert' || name === 'evidence.check') assertions.push(node)
        }
      }
      ts.forEachChild(node, child => walk(child, checked || (ts.isCallExpression(node) && node.expression.getText(ast) === 'evidence.check')))
    }
    walk(ast)
    assert.equal(positions.size, 92)
    // Human-approved split: compilers are mandatory in the parent's separate
    // 120s preparation. Runtime keeps45s, revalidates the same-run artifacts,
    // and observes the real metadata verifier close before any native child.
    assert.equal(buildJoins.length, 0)
    assert.ok(text.includes("require('./cockpit-bridge-prepared-build.cjs').stage({"))
    assert.ok(text.includes('root, sourceRepo, install, jobBuild, expectedNonce: preparedNonce'))
    assert.ok(text.includes("evidence.wait(36, () => runPs(path.join(sourceRepo, 'scripts/tests/cockpit-bridge-prepared-paths.ps1'), ['-Phase', phase]))"))
    assert.equal(text.includes("runPs(path.join(sourceRepo, 'scripts/build-cockpit-native-bridge.ps1')"), false)
    assert.equal(text.includes("runPs(path.join(sourceRepo, 'scripts/tests/build-cockpit-bridge-job.ps1')"), false)
    assert.equal(awaits.length, 28); assert.equal(assertions.length, 29)
    for (const [id, kind] of Object.entries(sites.kinds)) assert.ok(uses.get(Number(id))?.some(method => methods[kind]?.includes(method)), 'closed site must retain its actual source wrapper: ' + id)
    assert.ok(text.includes('const positive = evidence.arm(')); assert.ok(text.includes('const observationDone = evidence.dependency()'))
    assert.ok(text.includes('evidence.surface(1)')); assert.ok(text.includes('finally { evidence.surface(2) }'))
  }
  test('whole actual source keeps escaping/await/callback coverage with LF and CRLF', () => {
    assert.equal(sites.sourceSHA256, createHash('sha256').update(controller.replaceAll('\r\n', '\n')).digest('hex'))
    coverage(controller.replaceAll('\r\n', '\n')); coverage(controller.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'))
    const shared = fs.readFileSync(new URL('../../companion/tests/fixtures/native-surface-650.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
    assert.equal(createHash('sha256').update(shared).digest('hex'), '15b13cd023e6b95f53327bc6d18d89c1d72704177cb825d61dd2f6a42e11aee7')
    assert.equal(createHash('sha256').update(restoreObservation788(shared)).digest('hex'), 'bb4099db59ba888505c134f1771985712f0cb99f1a6f2bf56b86dff96b76e645')
  })
  test('actual coverage rejects omitted wrappers, prearmed observation and surface completion', () => {
    for (const mutation of [controller.replace('await evidence.wait(', 'await omittedWait('), controller.replace('evidence.check(1,', 'omittedCheck(1,'), controller.replace('evidence.callback(', 'omittedCallback('), controller.replace('evidence.wait(36,', 'omittedWait(36,'), controller.replace('expectedNonce: preparedNonce', 'expectedNonce: undefined'), controller.replace('evidence.arm(', 'omittedArm('), controller.replace('finally { evidence.surface(2) }', 'finally { void 0 }')]) assert.throws(() => coverage(mutation))
  })
  for (const [caseName, cpuReceipt, code] of [['malformed', '{', 'SYNC_REFUSED'], ['null', 'null', 'CHECK_REFUSED']]) test('actual CPU JSON parse or argument failure freezes before cleanup: ' + caseName, () => {
    const ast = ts.createSourceFile('actual-controller.cjs', controller, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    let statements
    function find(node) {
      if (ts.isTryStatement(node) && node.tryBlock.statements.some(statement => statement.getText(ast).startsWith('const cpuValue ='))) {
        const index = node.tryBlock.statements.findIndex(statement => statement.getText(ast).startsWith('const cpuValue ='))
        statements = node.tryBlock.statements.slice(index, index + 4).map(statement => statement.getText(ast)).join('\n')
      }
      ts.forEachChild(node, find)
    }
    find(ast); assert.ok(statements)
      const frames = [], observer = api.createObserver(bytes => { frames.push(bytes); return bytes.length }), signal = new AbortController()
      observer.start(signal.signal)
      let failed = false
      try { vm.runInNewContext(statements, { evidence: observer, assert, cpuReceipt }) } catch { failed = true }
      observer.cleanup(); observer.fallback(1, 'AWAIT_REFUSED'); observer.complete(false)
      const record = api.decode(Buffer.concat(frames))
      assert.equal(failed, true); assert.equal(record.first.code, code); assert.equal(record.completion.cleanupFirst, null)
      let actualSite
      function locate(node) {
        if (ts.isCallExpression(node) && node.expression.getText(ast) === (caseName === 'malformed' ? 'evidence.sync' : 'evidence.check') && Number(node.arguments[0]?.getText(ast)) === (caseName === 'malformed' ? 41 : 42)) actualSite = node
        ts.forEachChild(node, locate)
      }
      locate(ast); assert.ok(actualSite)
      const point = ast.getLineAndCharacterOfPosition(actualSite.getStart(ast))
      assert.deepEqual(sites.sites[record.first.site], [point.line + 1, point.character + 1])
  })
  test('default writer accepts actual Windows Stats pipe/socket modes and refuses other sinks', () => {
    // Execute installed Node's real predicates with their Windows binding;
    // these methods intentionally report false for FIFO/socket on Windows.
    const bindings = { ...fs.constants, S_IFBLK: fs.constants.S_IFBLK, S_IFSOCK: fs.constants.S_IFSOCK, isWindows: true }
    const methods = Object.fromEntries(['_checkModeProperty', 'isFIFO', 'isSocket'].map(name =>
      [name, vm.runInNewContext('(' + fs.Stats.prototype[name].toString() + ')', bindings)]))
    const helper = fs.readFileSync(new URL('./cockpit-bridge-first-evidence.cjs', import.meta.url), 'utf8')
    function observe(mode, behavior = 'write') {
      const stat = { mode, ...methods }, frames = [], calls = [], module = { exports: {} }
      vm.runInNewContext(helper, { module, Buffer, require(name) {
        if (name === './cockpit-bridge-first-sites.cjs') return sites
        if (name === './cockpit-bridge-phase-observation.cjs') return require(name)
        assert.equal(name, 'node:fs')
        return { constants: fs.constants,
          fstatSync(fd) { assert.equal(fd, 3); if (behavior === 'stat-throws') throw Error('STAT_REFUSED'); return stat },
          writeSync(fd, bytes) { assert.equal(fd, 3); calls.push(bytes.length)
            if (behavior === 'write-throws') throw Error('WRITE_REFUSED')
            if (behavior === 'short') return bytes.length - 1
            frames.push(Buffer.from(bytes)); return bytes.length },
        }
      } })
      const observer = module.exports.createObserver()
      observer.complete(true)
      return { stat, calls, record: api.decode(Buffer.concat(frames)) }
    }
    assert.equal(Number.isInteger(fs.constants.S_IFMT), true)
    assert.equal(Number.isInteger(fs.constants.S_IFIFO), true)
    // S_IFSOCK is conditionally exported by Node; do not invent it on Windows.
    const acceptedModes = [fs.constants.S_IFIFO]
    if (Number.isInteger(fs.constants.S_IFSOCK)) acceptedModes.push(fs.constants.S_IFSOCK)
    for (const mode of acceptedModes) {
      const result = observe(mode)
      assert.equal(result.stat.isFIFO(), false); assert.equal(result.stat.isSocket(), false)
      assert.equal(result.record.completion.ok, true); assert.equal(result.calls.length, 1)
    }
    for (const mode of [fs.constants.S_IFREG, fs.constants.S_IFCHR, 0, -1, 4096.5, undefined, NaN, '4096']) {
      const result = observe(mode); assert.equal(result.record, null); assert.equal(result.calls.length, 0)
    }
    for (const behavior of ['stat-throws', 'write-throws', 'short']) {
      const result = observe(fs.constants.S_IFIFO, behavior); assert.equal(result.record, null)
    }
  })
  async function produce(mode, broken = false) {
    const childArgs = []
    // Local inert harness may explicitly preload its own CPU-only deny guard.
    if (process.env.CMSPARK_EVIDENCE_CPU_GUARD) childArgs.push('-r', process.env.CMSPARK_EVIDENCE_CPU_GUARD)
    childArgs.push(self, '--producer', mode)
    const child = spawn(process.execPath, childArgs, { env: {
      PATH: path.dirname(process.execPath),
      ...(process.env.CMSPARK_EVIDENCE_CPU_GUARD ? { OWNED_EFFECTS_FILE: process.env.CMSPARK_EVIDENCE_CPU_EFFECTS + '-' + mode + (broken ? '-broken' : '') + '.json' } : {}),
    }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] })
    const captured = api.capture(child.stdio[3])
    let stdout = '', stderr = ''
    child.stdout.on('data', bytes => { stdout += bytes }); child.stderr.on('data', bytes => { stderr += bytes })
    if (broken) child.stdio[3].destroy()
    const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
    const record = captured.finish(true)
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-first-evidence-'))
    let actualParent
    try {
      const output = path.join(scratch, 'stdout'), error = path.join(scratch, 'stderr')
      fs.writeFileSync(output, stdout); fs.writeFileSync(error, stderr)
      actualParent = describe('child_refused', 'first-identity', { label: 'first-identity', output, error, state: { closed: true, spawnError: false, code: result.code, signal: result.signal, observation: record } })
    } finally { fs.rmSync(scratch, { recursive: true }) }
    return { ...result, record, actualParent, observationEOF: child.stdio[3].readableEnded, stdout, stderr }
  }
  test('actual fd3/Node:test preserves PASS, assertion, rejection, timeout and real async callback', async () => {
    const good = await produce('pass')
    assert.equal(good.code, 0); assert.equal(good.signal, null); assert.equal(good.record.first, null); assert.equal(good.record.interrupt, null); assert.equal(good.record.completion.ok, true)
    const phaseChild = await produce('phases')
    assert.equal(phaseChild.code, 0); assert.equal(phaseChild.record.completion.ok, true)
    assert.deepEqual(phaseChild.actualParent.firstIdentity.phases, { v: 1, phases: [[1, 0]], registrar: [[1, 0]], at: 'CLOSE' })
    for (const [mode, runner] of [['assert', 'CODE_FAILURE'], ['throw', 'CODE_FAILURE'], ['spoof', 'CODE_FAILURE'], ['timeout', 'TIMEOUT'], ['async', 'UNCAUGHT_EXCEPTION'], ['target-callback', 'UNHANDLED_REJECTION']]) {
      const result = await produce(mode)
      assert.equal(result.code, 1); assert.equal(result.signal, null)
      const projected = result.actualParent.firstIdentity
      assert.equal(result.actualParent.exitCode, 1); assert.equal(result.actualParent.closeObserved, true)
      assert.equal(projected.runner, runner)
      if (mode === 'timeout') assert.deepEqual(result.record.interrupt.pending, [1])
      else assert.ok(projected.first && projected.first.line > 0)
      assert.equal(/PRIVATE|stack|\/|\\/.test(JSON.stringify(projected)), false)
    }
  })
  test('actual pipe rejects missing/duplicate/partial/flood and accepts byte chunks', async () => {
    for (const mode of ['missing', 'duplicate', 'partial', 'flood']) {
      const result = await produce(mode); assert.equal(result.code, 0); assert.equal(result.record, null); assert.equal(result.observationEOF, true)
    }
    const chunked = await produce('chunks'); assert.equal(chunked.code, 0); assert.ok(chunked.record.first)
  })
  test('a broken diagnostic pipe cannot turn a passing original test into failure', async () => {
    const result = await produce('pass', true); assert.equal(result.code, 0)
  })
  test('first and interruption freeze independently; cleanup/sink cannot replace opaque original', async () => {
    let reads = 0
    const error = new Proxy({}, { get() { reads++; throw Error('FORBIDDEN') }, ownKeys() { reads++; throw Error('FORBIDDEN') } })
    const frames = [], o = api.createObserver(bytes => { frames.push(bytes); return bytes.length }), signal = new AbortController()
    o.start(signal.signal)
    let original
    try { await o.wait(1, () => Promise.reject(error)) } catch (value) { original = value }
    o.cleanup()
    let release; const pending = o.wait(2, () => new Promise(resolve => { release = resolve }))
    signal.abort(); release(); await pending
    try { o.assert(3, () => { throw error })() } catch (value) { assert.equal(value, error) }
    o.complete(false)
    assert.equal(original, error); assert.equal(reads, 0)
    const record = api.decode(Buffer.concat(frames))
    assert.equal(record.first.site, 1); assert.deepEqual(record.interrupt.pending, [2]); assert.equal(record.completion.cleanupFirst.site, 3)
    const broken = api.createObserver(() => { throw Error('SINK_ONLY') })
    try { broken.assert(1, () => { throw error })() } catch (value) { assert.equal(value, error) }
    assert.equal(reads, 0)
  })
  test('surface primary propagation is not a second cleanup refusal and keeps its caller', async () => {
    const frames = [], o = api.createObserver(bytes => { frames.push(bytes); return bytes.length }), signal = new AbortController(), primary = Error('OWNED_PRIMARY')
    o.start(signal.signal)
    const surfaceWait = o.surfaceWait ? o.surfaceWait.bind(o) : o.wait.bind(o)
    const fallback = o.fallback ? o.fallback.bind(o) : o.refuse.bind(o)
    let actual
    try { await surfaceWait(1, async () => {
      try { await o.wait(2, async () => { o.assert(3, () => { throw primary })() }) }
      finally { o.cleanup() }
    }) } catch (error) { fallback(1, 'AWAIT_REFUSED'); actual = error }
    o.complete(false)
    const record = api.decode(Buffer.concat(frames))
    assert.equal(actual, primary); assert.equal(record.first.site, 3); assert.equal(record.completion.cleanupFirst, null)
    assert.deepEqual(record.first.pending, [1, 2]); assert.equal(record.first.foreground, 2)
  })
  test('closed source schema rejects unknown/extra/noncanonical fields and false timeout text', () => {
    const frames = [], o = api.createObserver(bytes => { frames.push(bytes); return bytes.length })
    try { o.assert(1, assert.equal)(false, true) } catch { }
    const frame = frames[0].toString('ascii')
    for (const body of [frame.replace('"site":1', '"site":99999'), frame.replace('"v":1', '"v": 1'), frame.replace('"ASSERT_REFUSED"', '"PRIVATE"'), frame.replace('"kind":"first"', '"kind":"first","body":"PRIVATE"')]) assert.equal(api.decode(Buffer.from(body)), null)
    assert.equal(api.runnerOutcome("error: |\n    failureType: 'testTimeoutFailure'\n"), 'UNKNOWN')
    assert.match(sites.sourceSHA256, /^[a-f0-9]{64}$/)
  })
  test('actual parent keeps original close facts when diagnostic finish throws', async () => {
    const declaration = parentAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'run')
    assert.ok(declaration)
    for (const code of [0, 7]) {
      const child = Object.assign(new EventEmitter(), { stdio: [] }), events = [], closed = [], sink = Error('DIAGNOSTIC_ONLY')
      const run = vm.runInNewContext('(' + declaration.getText(parentAst) + ')', { sequence: 0, raw: '/owned', path,
        fs: { openSync() { return 9 }, closeSync(fd) { closed.push(fd) } }, cp: { spawn() { return child } },
        firstEvidence: { capture() { return { finish() { throw sink } } } } })
      const pending = run('/owned/node', [], '/owned', {}, 'first-identity', (...args) => events.push(args))
      child.emit('close', code, null)
      let outcome
      try { await pending } catch (error) { outcome = error }
      assert.equal(outcome === undefined, code === 0); assert.notEqual(outcome, sink)
      assert.deepEqual(events, [['close', code, null, null]]); assert.equal(closed.length, 2)
    }
  })
}
