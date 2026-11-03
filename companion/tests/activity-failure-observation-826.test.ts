/** Actual source consumers with controlled IO/SDK leaves; no Windows native claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import ts from 'typescript'

const apps = fs.readFileSync(path.resolve('tests/activity-apps-825.test.ts'), 'utf8')
const gui = fs.readFileSync(path.resolve('tests/fixtures/activity-apps-windows-825.cs'), 'utf8')
const scope = fs.readFileSync(path.resolve('tests/fixtures/activity-scope825-windows.cs'), 'utf8')
const require826 = createRequire(__filename)
const project = require826(path.resolve('tests/helpers/activity-apps825-observation.cjs'))
const one = (text: string, pattern: RegExp): string => {
  const matches = [...text.matchAll(pattern)]; assert.equal(matches.length, 1, 'one actual source boundary'); return matches[0][1]
}
const transpile = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function parts(text: string) {
  const file = ts.createSourceFile('actual-apps.ts', text, ts.ScriptTarget.Latest, true)
  const functions = file.statements.filter(ts.isFunctionDeclaration).filter(node => node.name?.text === 'receipt825')
  assert.equal(functions.length, 1)
  const variables: ts.VariableDeclaration[] = []
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['appsReceiptStages826', 'launch'].includes(node.name.text)) variables.push(node); ts.forEachChild(node, visit) }
  visit(file)
  const variable = (name: string) => { const rows = variables.filter(node => node.name.getText(file) === name); assert.equal(rows.length, 1); assert.ok(rows[0].initializer); return rows[0].initializer!.getText(file) }
  return { receipt: functions[0].getText(file), stages: variable('appsReceiptStages826'), launch: variable('launch') }
}
function receiptHarness(text = apps, pathApi = path) {
  const source = parts(text), events: string[] = [], timers: Array<() => void> = [], files = new Map<string, string>(), child: any = new EventEmitter(), controller = new AbortController()
  const directory = pathApi.resolve('owned-826'), readyFile = pathApi.join(directory, 'ready.json'), failureFile = pathApi.join(directory, 'failure.json')
  child.pid = 42; child.stderr = new EventEmitter()
  const context: any = { Promise, Error, Set, path: pathApi, assert, directory, binary: pathApi.join(directory, 'fixture.exe'), owned: { signal: controller.signal }, sequence: 0, ended: true,
    lease: { retain() { events.push('retain') } },
    spawn: (_binary: string, args: string[]) => { files.set(pathApi.join(args[0], 'ready.json'), JSON.stringify({ pid: 42, hwnd: args[1] === 'gui' ? 17 : 0 })); return child },
    fs: {
      existsSync: (file: string) => files.has(file), readFileSync: (file: string) => files.get(file),
      watch: () => ({ close() { events.push('watch.close') } }), mkdirSync() {},
      writeFileSync: (file: string, value: string) => files.set(file, value),
      renameSync: (from: string, to: string) => { const value = files.get(from)!; files.delete(from); files.set(to, value); const control = JSON.parse(value); files.set(pathApi.join(pathApi.dirname(to), `response-${control.sequence}.json`), JSON.stringify({ pid: 42, command: control.command })) },
    },
    setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 10000); timers.push(callback); return timers.length },
    clearTimeout: () => events.push('clearTimeout'),
  }
  vm.createContext(context)
  vm.runInContext(transpile(`const appsReceiptStages826 = ${source.stages};${source.receipt};globalThis.launch = ${source.launch};`), context)
  return { context, events, timers, files, child, controller, directory, readyFile, failureFile, start: (stage: string) => context.receipt825(readyFile, child, controller.signal, stage) as Promise<any> }
}

test('826 actual receipt timeout projects only six closed stages with the original timer and final check', async () => {
  const expected = ['gui-ready', 'headless-ready', 'snapshot', 'minimize', 'hide', 'quit']
  assert.deepEqual([...vm.runInNewContext(parts(apps).stages)], expected)
  for (const stage of [...expected, 'PRIVATE_NEVER_PROJECT']) {
    const h = receiptHarness(), promise = h.start(stage); h.timers[0]()
    await assert.rejects(promise, (error: any) => error.message === 'OWNED_APPS_FIXTURE_NOT_READY_' + (expected.includes(stage) ? stage : 'UNKNOWN'))
    assert.deepEqual(h.events, ['clearTimeout', 'watch.close']); assert.equal(h.child.listenerCount('close'), 0)
  }
  const h = receiptHarness(), promise = h.start('gui-ready')
  h.files.set(h.readyFile, '{"pid":42}'); h.timers[0]()
  assert.deepEqual(JSON.parse(JSON.stringify(await promise)), { pid: 42 }, 'the original deadline check still accepts an existing ready receipt')
})

test('826 actual launch and response callsites feed the real receipt function with GUI/headless and fixed command stages', async () => {
  for (const pathApi of [path.posix, path.win32]) for (const mode of ['gui', 'headless']) {
    const h = receiptHarness(apps, pathApi), stages: string[] = []
    const actual = h.context.receipt825
    h.context.receipt825 = (...args: any[]) => { stages.push(args[3]); return actual(...args) }
    const launched = await h.context.launch(mode)
    assert.equal(launched.ready.pid, 42); assert.equal(launched.ready.hwnd, mode === 'gui' ? 17 : 0)
    for (const command of ['snapshot', 'minimize', 'hide', 'quit']) assert.equal((await launched.control(command)).command, command)
    assert.deepEqual(stages, [mode + '-ready', 'snapshot', 'minimize', 'hide', 'quit'])
    assert.equal(h.timers.length, 5); assert.equal(h.child.listenerCount('close'), 1, 'only original launch lifetime listener remains')
  }
})

test('826 actual receipt retains failure priority, parse/close/abort behavior and listener cleanup', async () => {
  for (const pathApi of [path.posix, path.win32]) {
    const fail = receiptHarness(apps, pathApi); fail.files.set(fail.failureFile, '{"type":"OWNED_ERROR"}'); fail.files.set(fail.readyFile, '{"pid":42}')
    await assert.rejects(fail.start('gui-ready'), /OWNED_APPS_FIXTURE_FAILED/)
    const malformed = receiptHarness(apps, pathApi); malformed.files.set(malformed.readyFile, '{'); await assert.rejects(malformed.start('gui-ready'), (error: any) => error.name === 'SyntaxError')
    const closed = receiptHarness(apps, pathApi), closedResult = closed.start('gui-ready'); closed.child.emit('close'); await assert.rejects(closedResult, /OWNED_APPS_FIXTURE_CLOSED/)
    const aborted = receiptHarness(apps, pathApi), primary = Error('owned-abort'), abortedResult = aborted.start('gui-ready'); aborted.controller.abort(primary); await assert.rejects(abortedResult, (error: unknown) => error === primary)
    for (const h of [fail, malformed, closed, aborted]) { assert.deepEqual(h.events, ['clearTimeout', 'watch.close']); assert.equal(h.child.listenerCount('close'), 0) }
  }
})

function observer(text = gui) {
  const body = one(text, /static void Observe\(string phase\) \{([\s\S]*?)\r?\n  \}/g)
  const payload = 'new { phase = phase, sameSta = Thread.CurrentThread.ManagedThreadId == MainThread }'
  assert.equal(body.split(payload).length, 2)
  const seen = new Set<string>(), written: Array<{ file: string; value: any }> = [], context: any = {
    Observed: { Add: (phase: string) => { if (seen.has(phase)) return false; seen.add(phase); return true } },
    Thread: { CurrentThread: { ManagedThreadId: 7 } }, MainThread: 7,
    Record: (file: string, value: any) => written.push({ file, value: JSON.parse(JSON.stringify(value)) }),
  }
  const observe = vm.runInNewContext('(function(phase){' + body.replace(payload, '({ phase: phase, sameSta: Thread.CurrentThread.ManagedThreadId == MainThread })') + '})', context)
  return { context, written, observe }
}

test('826 actual Apps first-once producer feeds only its closed six-point reader and rejects foreign or malformed data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apps825-observation-'))
  const expected = ['MAIN_ENTER', 'RUN_ENTER', 'SOURCE_INITIALIZED', 'LOADED', 'CONTENT_RENDERED', 'READY_WRITTEN']
  try {
    assert.equal(project(dir).status, 'UNKNOWN')
    const h = observer()
    h.context.Record = (file: string, value: any) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value))
    for (const phase of expected) { h.observe(phase); h.observe(phase) }
    assert.deepEqual(Object.keys(project(dir).points).sort(), [...expected].sort())
    for (const phase of expected) assert.equal(project(dir).points[phase], true)
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file))
    h.context.Observed = { Add: () => true }; h.context.Thread.CurrentThread.ManagedThreadId = 8
    h.observe('MAIN_ENTER'); assert.equal(project(dir).points.MAIN_ENTER, false)
    fs.unlinkSync(path.join(dir, 'apps-initial-MAIN_ENTER.json'))
    for (const bad of ['{', '{"phase":"MAIN_ENTER","sameSta":"true"}', '{"phase":"MAIN_ENTER","sameSta":true,"private":"PRIVATE_NEVER_PROJECT"}', '{"phase":"OTHER","sameSta":true}']) {
      fs.writeFileSync(path.join(dir, 'apps-initial-MAIN_ENTER.json'), bad)
      assert.equal(project(dir).status, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(project(dir)), /PRIVATE_NEVER_PROJECT/)
    }
    fs.unlinkSync(path.join(dir, 'apps-initial-MAIN_ENTER.json'))
    fs.writeFileSync(path.join(dir, 'apps-initial-UNADMITTED.json'), '{"phase":"UNADMITTED","sameSta":true}')
    fs.writeFileSync(path.join(dir, 'apps-initial-MAIN_ENTER.json.pending'), '{"phase":"MAIN_ENTER","sameSta":true}')
    assert.equal(project(dir).status, 'UNKNOWN')
    let attempts = 0; const broken = observer(); broken.context.Record = () => { attempts++; throw Error('owned-observation-refused') }
    for (const phase of expected) { broken.observe(phase); broken.observe(phase) }
    assert.equal(attempts, 6)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('826 actual Apps finally projects both fixed folders only after close and preserves primary errors through projection faults', async () => {
  const body = one(apps, /  \} finally \{(\r?\n    if \(child && !ended\) child.kill\(\)[\s\S]*?lease.settled\(\)\r?\n)  \}/g)
  for (const pathApi of [path.posix, path.win32]) for (const throwing of [false, true]) {
    const calls: string[] = [], primary = Error('owned-primary')
    const directory = pathApi.resolve('owned-826'), guiPath = 'project:' + pathApi.join(directory, 'gui'), headlessPath = 'project:' + pathApi.join(directory, 'headless')
    const run = vm.runInNewContext('(async()=>{try{throw primary}finally{' + body + '}})', {
      primary, child: { kill: () => calls.push('kill') }, ended: false,
      closed: { then: (resolve: () => void) => { calls.push('closed'); resolve() } }, directory, path: pathApi,
      require: (file: string) => { assert.equal(file, pathApi.resolve('tests/helpers/activity-apps825-observation.cjs')); return (folder: string) => { calls.push('project:' + folder); if (throwing) throw Error('owned-project-failed'); return { status: 'UNKNOWN', points: {} } } },
      t: { diagnostic: (line: string) => { calls.push('diagnostic'); assert.match(line, /^D825_APPS_INITIAL /) } },
      fs: { rmSync: () => calls.push('remove') }, lease: { settled: () => calls.push('settled') },
    })
    await assert.rejects(run(), (error: unknown) => error === primary)
    assert.deepEqual(calls, throwing ? ['kill', 'closed', guiPath, 'remove', 'settled'] : ['kill', 'closed', guiPath, headlessPath, 'diagnostic', 'remove', 'settled'])
  }
})

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
function inverse(text: string, kind: 'scope' | 'gui' | 'apps') {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const replace = (before: string, after: string) => { before = before.replace(/\n/g, eol); after = after.replace(/\n/g, eol); assert.equal(text.split(before).length, 2, before); text = text.replace(before, after) }
  if (kind === 'scope') {
    const mapper = one(text, /(  static string SetupInputReason\(string message\) \{[\s\S]*?\r?\n  \}\r?\n)/g)
    text = text.replace(mapper, '')
    replace('} catch (Exception error) {\n          if (window == InitialWindow) Observe("INPUT_REFUSED");', '} catch {\n          if (window == InitialWindow) Observe("INPUT_REFUSED");')
    replace('new { type = "OWNED_SCOPE825_INPUT_SETUP_FAILED", reason = SetupInputReason(error.Message) }', 'new { type = "OWNED_SCOPE825_INPUT_SETUP_FAILED" }')
  } else if (kind === 'gui') {
    const fields = one(text, /(  static int MainThread;[\s\S]*?\r?\n  \}\r?\n)  \[DllImport/g)
    text = text.replace(fields, '')
    for (const line of ['    MainThread = Thread.CurrentThread.ManagedThreadId; Observe("MAIN_ENTER");\n', '      Window.SourceInitialized += delegate { Observe("SOURCE_INITIALIZED"); };\n', '      Window.Loaded += delegate { Observe("LOADED"); };\n', '        Observe("CONTENT_RENDERED");\n', '        Observe("READY_WRITTEN");\n']) replace(line, '')
    replace('try { Observe("RUN_ENTER"); return app.Run(Window); }', 'try { return app.Run(Window); }')
  } else {
    // Restore the fixture-only builder/projection change before the original d94 seal.
    replace("}, async t => {\n", "}, async () => {\n")
    replace("  $fixtureList825=New-Object 'System.Collections.Generic.List[object]'\n", "  $script:fixtureRows=@()\n")
    replace("    $fixtureList825.Add([pscustomobject]@{Id=$index+1;SessionId=825;Path=[IO.Path]::Combine($Root,'fake-'+$index+'.exe');ProcessName=$name})\n", "    $script:fixtureRows += [pscustomobject]@{Id=$index+1;SessionId=825;Path=[IO.Path]::Combine($Root,'fake-'+$index+'.exe');ProcessName=$name}\n")
    replace("  $fixtureList825.Add([pscustomobject]@{Id=5000;SessionId=826;Path=[IO.Path]::Combine($Root,'foreign.exe');ProcessName='Foreign'})\n  $fixtureList825.Add([pscustomobject]@{Id=5001;SessionId=825;Path=[IO.Path]::Combine($Root,'keepass.exe');ProcessName='Protected'})\n  $fixtureList825.Add([pscustomobject]@{Id=5002;SessionId=825;Path='';ProcessName='Unresolved'})\n  $fixtureList825.Add([pscustomobject]@{Id=5003;SessionId=825;Path=$fixtureList825[0].Path;ProcessName=$fixtureList825[0].ProcessName})\n  $script:fixtureRows=$fixtureList825.ToArray()\n", "  $script:fixtureRows += [pscustomobject]@{Id=5000;SessionId=826;Path=[IO.Path]::Combine($Root,'foreign.exe');ProcessName='Foreign'}\n  $script:fixtureRows += [pscustomobject]@{Id=5001;SessionId=825;Path=[IO.Path]::Combine($Root,'keepass.exe');ProcessName='Protected'}\n  $script:fixtureRows += [pscustomobject]@{Id=5002;SessionId=825;Path='';ProcessName='Unresolved'}\n  $script:fixtureRows += [pscustomobject]@{Id=5003;SessionId=825;Path=$script:fixtureRows[0].Path;ProcessName=$script:fixtureRows[0].ProcessName}\n")
    replace("    let stdout: string\n    try { stdout = await runPs(script, ['-Root', directory]) }\n    catch (error: any) {\n      try { t.diagnostic('D825_PRODUCER_PROCESS ' + JSON.stringify({\n        code: Number.isSafeInteger(error?.code) ? error.code : null,\n        killed: typeof error?.killed === 'boolean' ? error.killed : null,\n        signal: error?.signal === 'SIGTERM' || error?.signal === 'SIGKILL' ? error.signal : null,\n      })) } catch { /* Keep the original invocation failure. */ }\n      throw error\n    }\n    const outputs = JSON.parse(stdout)\n", "    const outputs = JSON.parse(await runPs(script, ['-Root', directory]))\n")
    replace("const appsReceiptStages826 = new Set(['gui-ready', 'headless-ready', 'snapshot', 'minimize', 'hide', 'quit'])\n", '')
    replace('signal: AbortSignal, stage: string): Promise<any>', 'signal: AbortSignal): Promise<any>')
    replace("Error('OWNED_APPS_FIXTURE_NOT_READY_' + (appsReceiptStages826.has(stage) ? stage : 'UNKNOWN'))", "Error('OWNED_APPS_FIXTURE_NOT_READY')")
    replace("receipt825(path.join(root, 'ready.json'), child, owned.signal, mode === 'gui' ? 'gui-ready' : 'headless-ready')", "receipt825(path.join(root, 'ready.json'), child, owned.signal)")
    replace('receipt825(path.join(root, `response-${id}.json`), child!, owned.signal, command)', 'receipt825(path.join(root, `response-${id}.json`), child!, owned.signal)')
    const projection = one(text, /(    try \{ t.diagnostic\('D825_APPS_INITIAL '[^\n]+\r?\n)/g); text = text.replace(projection, '')
  }
  return text
}

test('826 full actual source inverse preserves d94 baseline statements across LF/CRLF without requiring old Git objects', () => {
  // Recorded SHA256 of the three genuine d94d5db5 baseline files, not a hand-written fixture.
  const rows: Array<['scope' | 'gui' | 'apps', string, string]> = [
    ['scope', scope, 'd92faa281083ee1b5805f080974017a094a3be717267b896142ec99ee1a96ae0'],
    ['gui', gui, 'af037de7ba27b23e88312bcebdd5d7ff3cfe998f0c1d506533448ec8f821fd12'],
    ['apps', apps, '95835e6694f4bdbe479a2cc473a4becd520d65f2f35a315a25947e59c7c24aad'],
  ]
  for (const [kind, text, expected] of rows) {
    const lf = text.replace(/\r\n/g, '\n'), baseline = inverse(lf, kind)
    assert.equal(sha(baseline), expected, kind)
    for (const eol of ['\n', '\r\n']) {
      const actual = inverse(lf.replace(/\n/g, eol), kind)
      assert.equal(actual, baseline.replace(/\n/g, eol), kind + ' byte-exact inverse')
      if (kind === 'apps') assert.equal(parts(lf.replace(/\n/g, eol)).receipt.replace(/\r\n/g, '\n'), parts(lf).receipt)
      if (kind === 'scope') {
        const mapper = one(lf.replace(/\n/g, eol), /static string SetupInputReason\(string message\) \{([\s\S]*?)\r?\n  \}/g)
        const classify = vm.runInNewContext('(message)=>{' + mapper + '}')
        assert.equal(classify('OWNED_SCOPE825_INPUT_SHORT'), 'SHORT'); assert.equal(classify('PRIVATE_NEVER_PROJECT'), 'UNKNOWN')
      }
      if (kind === 'gui') { const h = observer(lf.replace(/\n/g, eol)); h.observe('MAIN_ENTER'); assert.deepEqual(h.written, [{ file: 'apps-initial-MAIN_ENTER.json', value: { phase: 'MAIN_ENTER', sameSta: true } }]) }
    }
  }
  assert.match(apps, /timeout: 90_000/)
  assert.match(fs.readFileSync(path.resolve('tests/activity-scope825-native.test.ts'), 'utf8'), /timeout: 180000/)
})
