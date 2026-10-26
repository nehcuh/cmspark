import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { once } from 'node:events'
import dc from 'node:diagnostics_channel'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { officeTarget, verifyOfficeEngine, stageOfficeRuntime } from '../stage-office-runtime.mjs'
import { removeOfficeSmokeRuntime } from '../office-smoke-cleanup.mjs'
import './office-smoke-fonts-666.test.mjs'
import './office-staged-relocation.test.mjs'
const { createOfficeSmokeObserver, observeOfficeIntegrationParse } = createRequire(import.meta.url)('../office-smoke-observer.cjs')

test('Office target selects published Linux WASM and exact native architecture', () => {
  assert.equal(officeTarget('linux-arm64').engine, '@deepseek-ai/libreoffice-kit-wasm')
  assert.equal(officeTarget('windows-x64').engine, '@deepseek-ai/libreoffice-kit-win32-x64')
  assert.equal(officeTarget('macos-arm64').engine, '@deepseek-ai/libreoffice-kit-darwin-arm64')
  assert.throws(() => officeTarget('linux-ia32'), /Unsupported/)
})

test('Staging keeps dependency layout and matching optional payload; omissions fail closed', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'office graph '))
  const source = path.join(temporary, 'source')
  const destination = path.join(temporary, 'destination 中文')
  const engine = officeTarget('linux-arm64').engine
  const entry = '@deepseek-ai/libreoffice-kit'
  function pkg(name, data, files = {}) {
    const root = path.join(source, 'node_modules', name)
    fs.mkdirSync(root, {recursive:true})
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name,version:'0.1.5',...data}))
    for (const [name, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), {recursive:true})
      fs.writeFileSync(path.join(root, name), contents)
    }
    return root
  }
  try {
    fs.mkdirSync(source, {recursive:true})
    fs.writeFileSync(path.join(source, 'package.json'), '{}')
    pkg(entry, {dependencies:{'native-adapter':'1.0.0'},optionalDependencies:{[engine]:'0.1.5','@deepseek-ai/libreoffice-kit-win32-x64':'0.1.5'}},
      {'lib/index.js':'entry','lib/worker.js':'worker','lib/font-snapshot-worker.js':'fonts',LICENSE:'license',NOTICE:'notice'})
    pkg('native-adapter', {optionalDependencies:{'native-linux-arm64':'1.0.0','native-win32-x64':'1.0.0'}}, {LICENSE:'native license'})
    pkg('native-linux-arm64', {os:['linux'],cpu:['arm64']}, {'binary.node':'binary'})
    fs.writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({packages:{'node_modules/native-linux-arm64':{os:['linux'],cpu:['arm64']},'node_modules/native-win32-x64':{os:['win32'],cpu:['x64']}}}))
    const bytes = {'loader.js':'loader','engine.wasm':'wasm','engine.data':'data','metadata.json':'metadata','sources/recipe.json':'recipe','licenses/MPL.txt':'mpl'}
    const files = Object.fromEntries(Object.entries(bytes).map(([name, data]) => [name, createHash('sha256').update(data).digest('hex')]))
    const manifest = {schemaVersion:1,version:'0.1.5',platform:'wasm',status:'built',engine:{kind:'wasm',loader:'loader.js',wasm:'engine.wasm',data:'engine.data',metadata:'metadata.json'},files}
    pkg(engine, {os:['linux']}, {...bytes,'prebuilds.json':JSON.stringify(manifest)})
    const record = stageOfficeRuntime({source,destination,platform:'linux-arm64'})
    assert.equal(record.engine, engine)
    assert.ok(fs.existsSync(path.join(destination,'node_modules',entry,'lib/worker.js')))
    assert.ok(fs.existsSync(path.join(destination,'node_modules/native-linux-arm64/binary.node')))
    assert.ok(fs.existsSync(path.join(destination,'node_modules',engine,'licenses/MPL.txt')))
    assert.ok(!fs.existsSync(path.join(destination,'node_modules/native-win32-x64')))
    fs.rmSync(path.join(source,'node_modules/native-linux-arm64'), {recursive:true})
    assert.throws(() => stageOfficeRuntime({source,destination,platform:'linux-arm64'}), /Required matching.*missing/)
  } finally {fs.rmSync(temporary,{recursive:true,force:true})}
})

test('Engine integrity gate detects corruption, missing resources and wrong versions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office manifest '))
  const target = officeTarget('linux-arm64')
  try {
    const files = {}
    for (const name of ['loader.js', 'engine.wasm', 'engine.data', 'metadata.json', 'sources/recipe.json', 'licenses/MPL.txt']) {
      const file = path.join(root, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, name)
      files[name] = createHash('sha256').update(name).digest('hex')
    }
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: target.engine, version: '0.1.5' }))
    const manifest = {schemaVersion:1,version:'0.1.5',platform:'wasm',status:'built',engine:{kind:'wasm',loader:'loader.js',wasm:'engine.wasm',data:'engine.data',metadata:'metadata.json'},files}
    const save = () => fs.writeFileSync(path.join(root, 'prebuilds.json'), JSON.stringify(manifest))
    save()
    verifyOfficeEngine(root, target.engine, target)
    fs.appendFileSync(path.join(root, 'engine.wasm'), 'corruption')
    assert.throws(() => verifyOfficeEngine(root, target.engine, target), /integrity mismatch/)
    fs.writeFileSync(path.join(root, 'engine.wasm'), 'engine.wasm')
    manifest.version = '0.1.4'; save()
    assert.throws(() => verifyOfficeEngine(root, target.engine, target), /manifest mismatch/)
    manifest.version = '0.1.5'; save()
    fs.rmSync(path.join(root, 'licenses'), { recursive: true })
    assert.throws(() => verifyOfficeEngine(root, target.engine, target), /ENOENT|missing/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('Owned Office cleanup removes nested files without swallowing a conversion failure', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'office cleanup '))
  const failure = new Error('owned conversion failure')
  try {
    fs.mkdirSync(path.join(directory, 'nested'))
    fs.writeFileSync(path.join(directory, 'nested', 'fixture.txt'), 'owned')
    assert.throws(() => {
      try { throw failure } finally { removeOfficeSmokeRuntime(directory) }
    }, error => error === failure)
    assert.equal(fs.existsSync(directory), false)
    removeOfficeSmokeRuntime(directory)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

const OFFICE_LOCK_DISPOSE_RECEIPT = 'DISPOSE_RETURNED_V1'

// A single bounded observation, never a wait for the handle to unlock. Absence,
// partial bytes or IO failure says only NOT_OBSERVED, not that Dispose did not run.
function readOfficeLockDisposeReceipt(file) {
  let fd, observed = 'NOT_OBSERVED'
  try {
    fd = fs.openSync(file, 'r')
    const bytes = Buffer.alloc(Buffer.byteLength(OFFICE_LOCK_DISPOSE_RECEIPT) + 1)
    const size = fs.readSync(fd, bytes, 0, bytes.length, 0)
    if (size === bytes.length - 1 && bytes.subarray(0, size).equals(Buffer.from(OFFICE_LOCK_DISPOSE_RECEIPT, 'ascii'))) observed = 'DISPOSE_RETURNED'
  } catch { /* observation unavailable */ }
  finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch { observed = 'NOT_OBSERVED' }
  }
  return observed
}

function officeLockNow() {
  try { const now = performance.now(); return Number.isFinite(now) ? now : null } catch { return null }
}

function reportOfficeLock(t, release, stage, started, error, receipt = 'NOT_OBSERVED') {
  try {
    if (!['holder-ready', 'lock-proved', 'release-signaled', 'helper-enter', 'helper-return', 'helper-expected-refusal', 'helper-failure', 'body-failure', 'finally-enter', 'finally-close', 'finally-return'].includes(stage)) return
    const now = officeLockNow(), elapsed = now !== null && started !== null ? Math.max(0, Math.round(now - started)) : null
    const observedCode = error?.code
    const code = error === undefined ? 'NONE' : ['EBUSY', 'ERR_ASSERTION', 'ENOENT', 'EACCES', 'EPERM'].includes(observedCode) ? observedCode : 'OTHER'
    t.diagnostic(JSON.stringify({ schema: 'office-lock-passive-v1', case: release ? 'transient' : 'persistent', stage,
      elapsed_ms: Number.isSafeInteger(elapsed) ? elapsed : null, code,
      dispose_receipt: receipt === 'DISPOSE_RETURNED' ? receipt : 'NOT_OBSERVED' }))
  } catch { /* diagnostics must not replace a body or finally result */ }
}

for (const release of [true, false]) test(`Windows owned executable lock ${release ? 'releases within cleanup budget' : 'remains a cleanup failure'}`, {
  skip: process.platform !== 'win32', timeout: 15_000,
}, async t => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'office lock '))
  const directory = path.join(owned, 'runtime')
  const releaseFile = path.join(owned, 'release')
  const receiptFile = path.join(owned, `dispose-${randomUUID()}.receipt`)
  fs.mkdirSync(directory)
  const runtime = path.join(directory, 'libreoffice-kit.exe')
  fs.writeFileSync(runtime, 'owned lock fixture; never executed')
  // A real exclusive Windows file handle gives a deterministic sharing lock,
  // independently of image-mapping deletion semantics. The signal stays outside
  // the directory being removed. No Office conversion or user process is faked.
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $handle = [IO.File]::Open($env:CMSPARK_TEST_OFFICE_LOCK, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    try {
      $clock = [Diagnostics.Stopwatch]::StartNew()
      [Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
      while (-not [IO.File]::Exists($env:CMSPARK_TEST_OFFICE_RELEASE)) {
        if ($clock.ElapsedMilliseconds -gt 10000) { throw 'Owned lock release timed out' }
        Start-Sleep -Milliseconds 10
      }
    } finally {
      $handle.Dispose()
      try {
        $receipt = [IO.File]::Open($env:CMSPARK_TEST_OFFICE_RECEIPT, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
          $bytes = [Text.Encoding]::ASCII.GetBytes('DISPOSE_RETURNED_V1')
          $receipt.Write($bytes, 0, $bytes.Length)
        } finally { $receipt.Dispose() }
      } catch { } # isolate receipt IO only; the original Dispose/holder error is not caught
    }
  `], { cwd: owned, env: { ...process.env, CMSPARK_TEST_OFFICE_LOCK: runtime, CMSPARK_TEST_OFFICE_RELEASE: releaseFile, CMSPARK_TEST_OFFICE_RECEIPT: receiptFile },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const closed = new Promise(resolve => child.once('close', resolve))
  const diagnosticStart = officeLockNow()
  let diagnosticPhase = 'body-failure'
  try {
    await new Promise((resolve, reject) => {
      let text = ''
      child.stdout.on('data', chunk => {
        text += chunk.toString().replace(/\r/g, '')
        if (text.includes('\n')) {
          if (text === 'ready\n') resolve()
          else reject(new Error('Unexpected owned lock readiness'))
        }
      })
      child.once('error', reject)
      child.once('exit', () => reject(new Error('Owned lock exited before readiness')))
    })
    reportOfficeLock(t, release, 'holder-ready', diagnosticStart)
    assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0)
    assert.throws(() => fs.rmSync(directory, { recursive: true, force: true }), { code: 'EBUSY' }, 'original immediate removal must observe the exclusive Windows handle')
    reportOfficeLock(t, release, 'lock-proved', diagnosticStart)
    if (release) {
      fs.writeFileSync(releaseFile, 'release', { flag: 'wx' })
      reportOfficeLock(t, release, 'release-signaled', diagnosticStart)
      diagnosticPhase = 'helper-failure'
      reportOfficeLock(t, release, 'helper-enter', diagnosticStart)
      removeOfficeSmokeRuntime(directory)
      diagnosticPhase = 'body-failure'
      reportOfficeLock(t, release, 'helper-return', diagnosticStart)
      assert.equal(fs.existsSync(directory), false)
    } else {
      diagnosticPhase = 'helper-failure'
      reportOfficeLock(t, release, 'helper-enter', diagnosticStart)
      assert.throws(() => removeOfficeSmokeRuntime(directory), { code: 'EBUSY' })
      diagnosticPhase = 'body-failure'
      reportOfficeLock(t, release, 'helper-expected-refusal', diagnosticStart)
      assert.equal(fs.existsSync(runtime), true, 'a persistent lock is not silently ignored')
      assert.doesNotThrow(() => process.kill(child.pid, 0), 'cleanup must not terminate the owned process')
    }
  } catch (error) {
    reportOfficeLock(t, release, diagnosticPhase, diagnosticStart, error)
    throw error
  } finally {
    // The only receipt read is here, before finally's release signal/close wait.
    // Synchronous rmSync may delay stream callbacks; no callback timestamp is used.
    const receipt = readOfficeLockDisposeReceipt(receiptFile)
    reportOfficeLock(t, release, 'finally-enter', diagnosticStart, undefined, receipt)
    // The object came directly from this spawn, never a discovered/user PID.
    if (child.exitCode === null) {
      fs.writeFileSync(releaseFile, 'release')
    }
    await closed
    reportOfficeLock(t, release, 'finally-close', diagnosticStart)
    fs.rmSync(owned, { recursive: true, force: true })
    reportOfficeLock(t, release, 'finally-return', diagnosticStart)
  }
})

// These are real owned Node lifetimes, not a claim to run Office on another OS.
const secret = 'OWNED_OBSERVER_PAYLOAD_MUST_NOT_APPEAR'
async function observedNodeOutcome(mode, observe) {
  const observer = observe ? createOfficeSmokeObserver() : null
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');
    parentPort.postMessage({ok:true,kind:'font-cache',fonts:['${secret}'],payload:'${secret}'});
    ${mode === 'failure' ? 'throw Error("owned failure")' : mode === 'cancel' ? 'setInterval(()=>{},1000)' : ''}`, {
    eval: true, execArgv: [], stdout: true, stderr: true, env: {},
  })
  worker.stdout.resume(); worker.stderr.resume()
  let error = false
  worker.on('error', () => { error = true })
  const workerExit = new Promise(resolve => worker.once('exit', resolve))
  const child = spawn(process.execPath, ['-e', `process.exit(${mode === 'failure' ? 7 : 0})`], { stdio: 'ignore', env: {}, windowsHide: true })
  const childExit = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({code, signal}))
  })
  if (mode === 'cancel') { await once(worker, 'online'); await worker.terminate() }
  try {
    const result = { workerCode: await workerExit, workerError: error, child: await childExit }
    return { result, evidence: observer?.finish() }
  } finally { observer?.finish() }
}

for (const mode of ['success', 'failure', 'cancel']) test(`Office lifecycle observer preserves actual owned Node ${mode} outcome`, {timeout:15_000}, async () => {
  const baseline = await observedNodeOutcome(mode, false)
  const observed = await observedNodeOutcome(mode, true)
  assert.deepEqual(observed.result, baseline.result)
  assert.equal(observed.evidence.status, 'complete')
  assert.equal(observed.evidence.objects, 2)
  assert.ok(observed.evidence.events.some(event => event.role === 'worker' && event.event === 'online'))
  assert.ok(observed.evidence.events.some(event => event.role === 'child' && event.event === 'spawn'))
  assert.ok(observed.evidence.events.some(event => event.role === 'child' && event.event === 'close'))
  assert.equal(JSON.stringify(observed.evidence).includes(secret), false)
  assert.equal(Object.keys(observed.evidence.events[0]).join(','), 'elapsed_ms,role,object,event,message_kind,ok,has_snapshot,has_fonts,has_output,exit_code,signal')
  assert.equal(observed.evidence.events.some(event => Object.keys(event).some(key => /pid|path|env|args|payload|stream/i.test(key))), false)
  if (mode === 'failure') { assert.equal(observed.result.workerError, true); assert.equal(observed.result.child.code, 7) }
  if (mode === 'cancel') assert.equal(observed.result.workerCode, 1)
})

test('Office lifecycle object overflow is bounded and disclosed after actual nine workers', {timeout:15_000}, async () => {
  const observer = createOfficeSmokeObserver()
  try {
    const results = Array.from({length:9}, () => {
      const worker = new Worker('', {eval:true,execArgv:[],env:{}})
      return new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', resolve) })
    })
    assert.deepEqual(await Promise.all(results), Array(9).fill(0))
    const evidence = observer.finish()
    assert.equal(evidence.objects, 8)
    assert.equal(evidence.object_overflow, true)
    assert.equal(evidence.status, 'incomplete')
    assert.ok(evidence.events.length <= 64)
  } finally { observer.finish() }
})

test('Office lifecycle event overflow retains the fixed64 bound and no arbitrary phase text', () => {
  const observer = createOfficeSmokeObserver()
  for (let i = 0; i < 100; i++) observer.phase('convert-start')
  observer.phase(secret)
  const evidence = observer.finish()
  assert.equal(evidence.events.length, 64)
  assert.equal(evidence.event_overflow, true)
  assert.equal(evidence.observer_failure, true)
  assert.equal(evidence.status, 'incomplete')
  assert.equal(JSON.stringify(evidence).includes(secret), false)
  assert.equal(observer.finish(), evidence)
})

test('Office lifecycle cleanup removes only its own observers and reports unfinished work', {timeout:15_000}, async () => {
  let siblingCalls = 0
  const sibling = () => { siblingCalls++ }
  dc.subscribe('worker_threads', sibling)
  const observer = createOfficeSmokeObserver()
  const worker = new Worker('setInterval(()=>{},1000)', {eval:true,execArgv:[],env:{}})
  const exited = new Promise(resolve => worker.once('exit', resolve))
  try {
    await once(worker, 'online')
    const siblingMessage = () => {}
    worker.on('message', siblingMessage)
    const evidence = observer.finish()
    assert.equal(evidence.status, 'incomplete')
    assert.equal(evidence.open_objects, 1)
    assert.equal(worker.listenerCount('message'), 1)
    assert.equal(worker.listeners('message')[0], siblingMessage)
    assert.equal(worker.listenerCount('exit'), 1, 'the original owned lifetime waiter remains')
    assert.equal(dc.hasSubscribers('worker_threads'), true, 'the sibling channel subscriber remains')
    assert.equal(siblingCalls, 1)
    assert.equal(evidence.events.some(event => event.event === 'exit'), false)
    await worker.terminate()
    await exited
    assert.equal(observer.finish(), evidence, 'post-cleanup events do not mutate the snapshot')
  } finally { observer.finish(); await worker.terminate(); await exited; dc.unsubscribe('worker_threads', sibling) }
})

test('Office observer subscriber faults are disclosed without throwing into the observed source', () => {
  const observer = createOfficeSmokeObserver()
  try {
    assert.doesNotThrow(() => dc.channel('worker_threads').publish({worker:{}}))
    const evidence = observer.finish()
    assert.equal(evidence.observer_failure, true)
    assert.equal(evidence.status, 'incomplete')
    assert.equal(evidence.objects, 0)
  } finally { observer.finish() }
})

test('Office evidence write failure does not change actual owned Node outcomes', {timeout:15_000}, async t => {
  const baseline = await observedNodeOutcome('success', false)
  t.mock.method(console, 'error', () => { throw new Error(secret) })
  try {
    const observed = await observedNodeOutcome('success', true)
    assert.deepEqual(observed.result, baseline.result)
    assert.equal(observed.evidence.observer_failure, true)
    assert.equal(observed.evidence.status, 'incomplete')
    assert.equal(JSON.stringify(observed.evidence).includes(secret), false)
  } finally { t.mock.restoreAll() }
})

test('Office phase events exist before finish and do not invent a complete summary on early exit', () => {
  const helper = fileURLToPath(new URL('../office-smoke-observer.cjs', import.meta.url))
  const child = spawnSync(process.execPath, ['-e', `
    const observer=require(${JSON.stringify(helper)}).createOfficeSmokeObserver();
    observer.phase('convert-start');
    process.stderr.write('',()=>process.exit(3));
  `], {encoding:'utf8',env:{},timeout:10_000})
  assert.equal(child.status, 3)
  assert.notEqual(child.stderr.trim(), '', 'phase records must already exist before finish')
  const records = child.stderr.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(records.length, 2)
  assert.ok(records.every(record => record.kind === 'event'))
  assert.deepEqual(records.map(record => record.event), ['observer-start','convert-start'])
  assert.equal(records.some(record => record.kind === 'summary'), false)
})

test('The generated relocated probe preserves success, conversion failure and disposal with an inert kit seam', {timeout:15_000}, () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'office phase fixture '))
  try {
    const script = fs.readFileSync(new URL('../smoke-office-runtime.mjs', import.meta.url), 'utf8')
    const probeSource = script.match(/fs\.writeFileSync\(probe, `([\s\S]*?)`\)/)?.[1]
    assert.ok(probeSource, 'exercise the actual generated probe, not a copied approximation')
    const runtime = path.join(owned, process.platform === 'win32' ? 'node.exe' : 'node')
    fs.copyFileSync(process.execPath, runtime)
    if (process.platform !== 'win32') fs.chmodSync(runtime, 0o755)
    const probe = path.join(owned, 'probe.cjs')
    fs.writeFileSync(probe, probeSource)
    fs.copyFileSync(new URL('../office-smoke-observer.cjs', import.meta.url), path.join(owned,'office-smoke-observer.cjs'))
    const kit = path.join(owned, 'node_modules','@deepseek-ai','libreoffice-kit')
    fs.mkdirSync(kit, {recursive:true})
    fs.writeFileSync(path.join(kit,'package.json'), JSON.stringify({name:'@deepseek-ai/libreoffice-kit',version:'0.1.5',main:'index.cjs'}))
    fs.writeFileSync(path.join(kit,'index.cjs'), `
      const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
      const {Worker}=require('node:worker_threads'); const {spawn}=require('node:child_process');
      exports.ENGINE_VERSION='0.1.5';
      exports.createConverter=async options=>{
        const expected={timeoutMs:30000,maxInputBytes:10485760,maxOutputBytes:33554432,fontMetadataCacheDirectory:false};
        if(process.platform!=='linux')expected.fontDirectories=[path.join(path.dirname(process.execPath),'smoke-fonts')];
        assert.deepEqual(options,expected);
        return {backend:process.platform==='linux'?'wasm':'native',
          async convert(request){
            const worker=new Worker('require("node:worker_threads").parentPort.postMessage({ok:true,snapshot:{secret:"${secret}"}})',{eval:true,execArgv:[],env:{}});
            worker.on('message',()=>{});
            const done=new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',code=>code===0?resolve():reject(Error('Owned worker exit')))});
            const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore',env:{}});
            const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Owned child exit')))});
            await Promise.all([done,closed]);
            if(process.env.OWNED_OFFICE_PHASE_MODE==='failure')throw Error('OWNED_KIT_FAILURE');
            fs.writeFileSync(request.outputPath,'Office preview 中文文档');
          },
          async dispose(){fs.writeFileSync(path.join(path.dirname(process.execPath),'disposed'),'yes')}
        };
      };
    `)
    for (const mode of ['success','failure']) {
      const result = spawnSync(runtime, [probe], {cwd:owned,encoding:'utf8',env:{OWNED_OFFICE_PHASE_MODE:mode},timeout:10_000})
      assert.equal(result.error, undefined)
      assert.equal(result.status, mode === 'success' ? 0 : 1)
      assert.equal(fs.readFileSync(path.join(owned,'disposed'),'utf8'), 'yes')
      const records = result.stderr.split('\n').filter(line => line.startsWith('{"schema":')).map(line => JSON.parse(line))
      const events = records.filter(record => record.kind === 'event')
      const summary = records.filter(record => record.kind === 'summary')
      assert.equal(summary.length, 1)
      assert.equal(summary[0].status, 'complete')
      assert.equal(summary[0].objects, 2)
      assert.equal(summary[0].events, undefined, 'the final summary does not re-emit event records')
      assert.ok(events.some(event => event.event === 'convert-start'))
      assert.ok(events.some(event => event.event === 'dispose-settled'))
      assert.equal(events.some(event => event.event === 'assertions-pass'), mode === 'success')
      assert.equal(events.some(event => event.event === 'operation-failure'), mode === 'failure')
      assert.equal(JSON.stringify(records).includes(secret), false)
      assert.equal(records.length <= 65, true)
      fs.rmSync(path.join(owned,'disposed'))
      if (process.platform !== 'linux') fs.rmdirSync(path.join(owned,'smoke-fonts'))
    }
  } finally { removeOfficeSmokeRuntime(owned) }
})


test('default Office parser observation preserves real owned lifecycle, value and rejection', { timeout: 10_000 }, async () => {
  const originalError = console.error, records = [], marker = 'OWNED_OFFICE_PRIVATE_MESSAGE_NEVER_LOG'
  const sibling = () => {}, value = Object.freeze({ success: true }), failure = new Error('OWNED_PARSE_ORIGINAL_FAILURE')
  dc.subscribe('worker_threads', sibling)
  console.error = line => { records.push(JSON.parse(line)) }
  try {
    let called = 0
    const result = await observeOfficeIntegrationParse(async () => {
      called++
      const worker = new Worker(`require('node:worker_threads').parentPort.postMessage(${JSON.stringify(marker)})`, { eval: true })
      const workerExit = once(worker, 'exit')
      const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { env: {}, stdio: 'ignore' })
      await Promise.all([workerExit, once(child, 'close')])
      return value
    })
    assert.equal(result, value); assert.equal(called, 1)
    const summary = records.filter(x => x.kind === 'summary')
    assert.equal(summary.length, 1); assert.equal(summary[0].scope, 'default-parser')
    assert.equal(summary[0].objects, 2); assert.equal(summary[0].open_objects, 0)
    assert.equal(summary[0].status, 'complete'); assert.equal(summary[0].events, undefined)
    assert.ok(records.some(x => x.role === 'worker' && x.event === 'first-message'))
    assert.ok(records.some(x => x.role === 'child' && x.event === 'close'))
    assert.equal(JSON.stringify(records).includes(marker), false)
    assert.equal(records.length <= 65, true)
    assert.equal(dc.hasSubscribers('worker_threads'), true, 'sibling subscriber must survive cleanup')
    await assert.rejects(observeOfficeIntegrationParse(async () => { throw failure }), e => e === failure)
    await assert.rejects(observeOfficeIntegrationParse(async () => { assert.fail('UNCHANGED_PARSE_ASSERTION') }), /UNCHANGED_PARSE_ASSERTION/)
    assert.equal(records.filter(x => x.kind === 'summary').length, 3)
  } finally { console.error = originalError; dc.unsubscribe('worker_threads', sibling) }
})

test('default Office parser observer output faults preserve success and original error', async () => {
  const originalError = console.error, value = Object.freeze({ success: true }), failure = new Error('OWNED_PARSE_REJECTION')
  console.error = () => { throw new Error('OWNED_DIAGNOSTIC_OUTPUT_FAILURE') }
  try {
    assert.equal(await observeOfficeIntegrationParse(async () => value), value)
    await assert.rejects(observeOfficeIntegrationParse(async () => { throw failure }), e => e === failure)
  } finally { console.error = originalError }
})


test('default Office observation selects only the immutable first DOC fixture', async () => {
  const ts = createRequire(new URL('../../companion/package.json', import.meta.url))('typescript')
  const vm = await import('node:vm')
  const source = fs.readFileSync(new URL('../../companion/tests/office-format-compatibility.test.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('office.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'parsed')
  assert.equal(declarations.length, 1)
  const code = ts.transpileModule(declarations[0].getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let observed = 0, calls = 0
  const context = vm.createContext({ assert,
    observeOfficeIntegrationParse: async operation => { observed++; return operation() },
    parseFile: async (bytes, filename, mimeType) => { calls++; return { success: true, filename, mimeType, fileSize: bytes.length } },
  })
  vm.runInContext(code, context)
  const bytes = Buffer.from('OWNED_PUBLIC_BYTES')
  for (const name of ['one-page.doc', 'other.doc', 'renamed.docx', 'one-sheet.xls', 'one-slide.ppt', 'WPS-export.pdf']) {
    const result = await context.parsed(bytes, name, 'owned/mime')
    assert.equal(result.filename, name); assert.equal(result.fileSize, bytes.length)
    assert.equal(result.mimeType, 'owned/mime')
  }
  assert.equal(calls, 6); assert.equal(observed, 1)
})
