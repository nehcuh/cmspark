'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const project = require('./activity-wpf-observation-758.cjs')

test('WPF projection admits only fixed phases and boolean thread identity', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-wpf-observation-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const write = (name, value) => fs.writeFileSync(path.join(dir, 'wpf-' + name + '.json'), value)
  write('RUN_ENTER', JSON.stringify({ phase: 'RUN_ENTER', sameSta: true }))
  write('LOADED', JSON.stringify({ phase: 'LOADED', sameSta: false }))
  write('SOURCE_INITIALIZED', '{')
  write('READY_WRITTEN', JSON.stringify({ phase: 'READY_WRITTEN', sameSta: true, private: 'NEVER_OUTPUT' }))
  write('TIMER_TICK', JSON.stringify({ phase: 'LOADED', sameSta: true }))
  write('CONTENT_RENDERED', JSON.stringify({ phase: 'CONTENT_RENDERED', sameSta: 'true' }))
  assert.deepEqual({ ...project(dir) }, { RUN_ENTER: true, LOADED: false })
  write('RUN_RETURN', JSON.stringify({ phase: 'RUN_RETURN', sameSta: true }))
  assert.deepEqual({ ...project(dir) }, { RUN_ENTER: true, LOADED: false, RUN_RETURN: true })
})

test('fixture and original controller bind the finite projection to real lifecycle and cleanup', () => {
  const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/activity-windows-758.cs'), 'utf8')
  const controller = fs.readFileSync(path.join(__dirname, '../activity-platform-native-758.test.ts'), 'utf8')
  for (const newline of ['\n', '\r\n']) {
    const source = fixture.replace(/\r?\n/g, newline)
    for (const phase of ['RUN_ENTER','SOURCE_INITIALIZED','LOADED','TIMER_TICK','CONTENT_RENDERED','READY_WRITTEN','RUN_RETURN']) {
      assert.equal(source.split(`Observe("${phase}")`).length - 1, 1, phase)
    }
    assert.ok(source.indexOf('Observe("RUN_ENTER")') < source.indexOf('app.Run(Window)'))
    assert.ok(source.indexOf('Observe("RUN_RETURN")') > source.indexOf('app.Run(Window)'))
    assert.ok(source.indexOf('Observe("READY_WRITTEN")') > source.indexOf('Record("ready.json"'))
    assert.match(source, /Thread\.CurrentThread\.ManagedThreadId == MainThread/)
  }
  const cleanup = controller.slice(controller.lastIndexOf('}finally{'))
  assert.ok(cleanup.indexOf('await closed') < cleanup.indexOf('D758_WPF_PHASE'))
  assert.ok(cleanup.indexOf('D758_WPF_PHASE') < cleanup.indexOf('fs.rmSync(dir'))
  assert.match(cleanup, /if\(win\)try\{.*\}catch\{\}/)
})

test('actual finally projects at CLOSE on success and failure without replacing the original result', async () => {
  const controller = fs.readFileSync(path.join(__dirname, '../activity-platform-native-758.test.ts'), 'utf8')
  const start = controller.lastIndexOf('}finally{')
  const finish = controller.indexOf('\n  }\n}))', start)
  assert.ok(start >= 0 && finish > start)
  const body = controller.slice(start + '}finally{'.length, finish)
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
  const run = new AsyncFunction('child','closed','fs','dir','lease','win','path','t','require','fail', `let ended=false; try { if(fail) throw new Error('ORIGINAL'); return 'OK' } finally { ${body} }`)
  for (const fail of [false,true]) for (const broken of [false,true]) {
    const calls = [], child = { kill(){calls.push('kill')} }, lease = { settled(){calls.push('settled')} }
    const testContext = { diagnostic(value){calls.push(value); if(broken) throw Error('DIAGNOSTIC_FAILED')} }
    const mockRequire = () => () => ({ RUN_ENTER: true })
    const promise = run(child, Promise.resolve(), { rmSync(){calls.push('remove')} }, '/owned', lease, true, path, testContext, mockRequire, fail)
    if (fail) await assert.rejects(promise, /ORIGINAL/); else assert.equal(await promise, 'OK')
    assert.deepEqual(calls, ['kill', 'D758_WPF_PHASE {"at":"CLOSE","phases":{"RUN_ENTER":true}}', 'remove', 'settled'])
  }
})
