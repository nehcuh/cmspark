// Remote-only STOP gate. Actual candidate extension + Chrome + fixed native host.
// No mask, synthetic auth receipt, host argv fallback, download or local execution.
'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const cp = require('node:child_process'), { randomBytes } = require('node:crypto'), { test } = require('node:test')
assert.equal(process.platform, 'win32'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_OS, 'Windows')
const [chromeInput, chromeSHA256, extensionInput, compiledInput] = process.argv.slice(2)
function physical(input, directory) {
  assert.ok(typeof input === 'string' && path.isAbsolute(input))
  const s = fs.lstatSync(input); assert.ok(!s.isSymbolicLink() && (directory ? s.isDirectory() : s.isFile()))
  assert.equal(fs.realpathSync.native(input).toLowerCase(), path.resolve(input).toLowerCase())
  return fs.realpathSync.native(input)
}
assert.match(chromeSHA256, /^[0-9a-f]{64}$/)
const admission = require('./cockpit-bridge-browser-admission.cjs')
const admitted = admission.version === 1 && admission.builds.find(build =>
  build.kind === 'chrome-for-testing' && build.platform === 'win64' && /^[0-9]+(?:\.[0-9]+){3}$/.test(build.version) &&
  build.source === `https://storage.googleapis.com/chrome-for-testing-public/${build.version}/win64/chrome-win64.zip` &&
  /^[0-9a-f]{64}$/.test(build.archiveSHA256) && build.executableSHA256 === chromeSHA256)
assert.ok(admitted, 'COCKPIT_BRIDGE_BROWSER_SUPPLY_NOT_READY') // before any spawn/registration

const chrome = physical(chromeInput, false), extension = physical(extensionInput, true), compiled = physical(compiledInput, true)
const root = physical(process.env.CMSPARK_TEST_RUN_DIR, true), data = physical(process.env.CMSPARK_DATA_DIR, true)
assert.ok(path.basename(root).startsWith('cmspark-test-run-'))
assert.ok(path.relative(root, data) && !path.relative(root, data).startsWith('..') && !path.isAbsolute(path.relative(root, data)))
const { withSurface650 } = require(path.resolve(compiled, '../tests/fixtures/native-surface-650.js'))
const sourceRepo = path.resolve(__dirname, '../..'), serverFile = path.join(sourceRepo, 'companion/tests/fixtures/cockpit-bridge-server-723.cjs')
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'))
assert.ok(manifest.permissions.includes('nativeMessaging') && manifest.background.service_worker)
assert.ok(/^[a-zA-Z0-9_./-]+$/.test(manifest.background.service_worker) && !manifest.background.service_worker.includes('..'))
const panel = manifest.side_panel?.default_path
assert.ok(typeof panel === 'string' && /^[a-zA-Z0-9_./-]+$/.test(panel) && !panel.includes('..'))
function aborted(signal, action) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    let cleanup = () => {}, settled = false
    const finish = (error, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', stop); cleanup(); error ? reject(error) : resolve(value) }
    const stop = () => finish(signal.reason)
    signal.addEventListener('abort', stop, { once: true })
    cleanup = action(value => finish(null, value), error => finish(error)) || (() => {})
    if (settled) cleanup(); else if (signal.aborted) stop()
  })
}
class Cdp {
  constructor(ws, signal) {
    this.ws = ws; this.signal = signal; this.sequence = 0; this.pending = new Map(); this.listeners = new Set(); this.failed = false
    const fail = () => { this.failed = true; for (const entry of this.pending.values()) entry.reject(Error('COCKPIT_BRIDGE_CDP_CLOSED')); this.pending.clear(); ws.close() }
    ws.addEventListener('message', event => {
      try {
        const value = JSON.parse(String(event.data))
        if (value.id) { const entry = this.pending.get(value.id); if (entry) { this.pending.delete(value.id); value.error ? entry.reject(Error('COCKPIT_BRIDGE_CDP_REJECTED')) : entry.resolve(value.result) } }
        else for (const listener of this.listeners) listener(value)
      } catch { fail() }
    })
    ws.addEventListener('close', fail)
  }
  async command(method, params = {}, sessionId) {
    this.signal.throwIfAborted(); assert.equal(this.failed, false, 'COCKPIT_BRIDGE_CDP_CLOSED'); const id = ++this.sequence
    return aborted(this.signal, (resolve, reject) => {
      this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      return () => this.pending.delete(id)
    })
  }
  async target(predicate) {
    return aborted(this.signal, (resolve, reject) => {
      const found = info => { if (predicate(info)) { this.listeners.delete(listener); resolve(info) } }
      const listener = event => { if (event.method === 'Target.targetCreated' || event.method === 'Target.targetInfoChanged') found(event.params.targetInfo) }
      this.listeners.add(listener)
      this.command('Target.getTargets').then(value => value.targetInfos.forEach(found), reject)
      return () => this.listeners.delete(listener)
    })
  }
  async defaultContext(session, origin) {
    return aborted(this.signal, (resolve, reject) => {
      const listener = event => { if (event.sessionId === session && event.method === 'Runtime.executionContextCreated' &&
        event.params.context.origin === origin && event.params.context.auxData?.isDefault === true) resolve(event.params.context.id) }
      this.listeners.add(listener); this.command('Runtime.enable', {}, session).catch(reject)
      return () => this.listeners.delete(listener)
    })
  }
  async evaluate(session, expression, contextId) {
    const result = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) }, session)
    if (result.exceptionDetails !== undefined) throw Error('COCKPIT_BRIDGE_EXTENSION_CALLBACK_FAILED')
    return result.result.value
  }
}
async function endpoint(profile, child, signal) {
  // Complete, validated same snapshot; no final-newline assumption or second read.
  return aborted(signal, (resolve, reject) => {
    const read = () => {
      try {
        const file = path.join(profile, 'DevToolsActivePort'), s = fs.lstatSync(file)
        assert.ok(s.isFile() && !s.isSymbolicLink() && s.size <= 512)
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
        if (lines.length < 2 || !/^[1-9][0-9]{0,4}$/.test(lines[0]) || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(lines[1])) return
        const port = Number(lines[0]); assert.ok(port <= 65535)
        resolve(`ws://127.0.0.1:${port}${lines[1]}`)
      } catch (e) { if (e.code !== 'ENOENT') { watcher.close(); reject(e) } }
    }
    const watcher = fs.watch(profile, read), died = () => { watcher.close(); reject(Error('COCKPIT_BRIDGE_CHROME_EXITED')) }
    child.once('close', died); read()
    return () => { watcher.close(); child.removeListener('close', died) }
  })
}
// Reuse the existing native-fixture outer 45s budget. The production bind stays 5s.
test('actual Chrome document native parent / actual authenticated WS first identity STOP gate', { timeout: 45000 }, async t => { const outerDeadline = Date.now() + 45000; return withSurface650(t, async (_, lease) => {
  lease.retain()
  const operatorFailed = new AbortController(), signal = AbortSignal.any([lease.signal, operatorFailed.signal]), children = [], closes = new WeakMap(), profile = path.join(root, 'bridge-chrome-' + randomBytes(8).toString('hex')), install = path.join(root, 'bridge-install-' + randomBytes(8).toString('hex'))
  fs.mkdirSync(profile); fs.mkdirSync(install); fs.mkdirSync(path.join(install, 'bin'))
  const childTemp = path.join(install, 'temp'); fs.mkdirSync(childTemp)
  const childEnvironment = require('./cockpit-bridge-child-env.cjs')(process.env, { root, data, temp: childTemp, compiled })
  let registered = false, cdp, chromeChild, server, verified = 0, observedId, cleanupObserved = false, primaryFailure = null
  const track = child => { children.push(child); closes.set(child, new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })); return child }
  const retainOutput = (child, label) => {
    const descriptors = [child.stdout, child.stderr].map((stream, index) => {
      const file = fs.openSync(path.join(root, label + (index ? '.stderr' : '.stdout')), 'wx', 0o600)
      stream.on('data', bytes => fs.writeSync(file, bytes)); return file
    })
    closes.get(child).finally(() => { for (const file of descriptors) fs.closeSync(file) }).catch(() => {})
  }
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const admitChild = () => { signal.throwIfAborted(); lease.checkpoint() }
  const runPs = async (script, args, cleanup = false) => {
    if (!cleanup) admitChild()
    const child = track(cp.spawn(powershell, ['-NoProfile', '-NonInteractive', '-File', script, ...args], { env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }))
    // Join the real close even if abort/error wins the ordinary result wait.
    const actuallyClosed = new Promise(resolve => child.once('close', resolve))
    const label = 'operator-' + children.length
    const streams = [child.stdout, child.stderr].map((stream, index) => {
      const file = fs.openSync(path.join(root, label + (index ? '.stderr' : '.stdout')), 'wx', 0o600)
      let size = 0; stream.on('data', bytes => { size += bytes.length; fs.writeSync(file, bytes); if (size > 1048576) child.kill() })
      return { file, stream }
    })
    try {
      const result = cleanup ? await closes.get(child) : await aborted(signal, (resolve, reject) => {
        closes.get(child).then(resolve, reject); return () => {}
      })
      assert.equal(result.code, 0, 'COCKPIT_BRIDGE_OWNED_INSTALL_REFUSED')
    } finally {
      if (!cleanup && signal.aborted && child.exitCode === null && child.signalCode === null) {
        try { child.kill() } catch { /* actual close remains mandatory; a kill request is not proof */ }
      }
      await actuallyClosed
      for (const entry of streams) fs.closeSync(entry.file)
    }
  }
  const messages = [], observers = new Set()
  const waitMessage = predicate => aborted(signal, (resolve, reject) => {
    const accept = value => { if (value?.type === 'failed') reject(Error('COCKPIT_BRIDGE_ACTUAL_SERVER_FAILED')); else if (predicate(value)) resolve(value) }
    observers.add(accept); for (const value of messages) accept(value)
    return () => observers.delete(accept)
  })
  try {
    await runPs(path.join(sourceRepo, 'scripts/build-cockpit-native-bridge.ps1'), ['-OutputDirectory', path.join(install, 'bin')])
    const secret = randomBytes(32).toString('hex')
    admitChild()
    server = track(cp.fork(serverFile, [], { env: childEnvironment, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }))
    server.on('message', value => { messages.push(value); if (value?.type === 'bridge-state' && value.state === 'verified') verified = value.count; for (const accept of observers) accept(value) })
    server.send({ type: 'init', secret })
    await waitMessage(value => value?.type === 'ready')
    const jobBuild = path.join(root, 'job-build'); fs.mkdirSync(jobBuild)
    await runPs(path.join(sourceRepo, 'scripts/tests/build-cockpit-bridge-job.ps1'), ['-OutputDirectory', jobBuild])
    admitChild()
    const cpu = track(cp.spawn(path.join(jobBuild, 'cockpit-chrome-job-cpu.exe'), [], { env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] }))
    retainOutput(cpu, 'job-cpu')
    let cpuReceipt = ''; cpu.stdout.on('data', bytes => { cpuReceipt += bytes; assert.ok(cpuReceipt.length <= 4096) });
    assert.equal((await closes.get(cpu)).code, 0, 'COCKPIT_BRIDGE_JOB_CPU_FAILED')
    const cpuValue = JSON.parse(cpuReceipt); assert.equal(cpuValue.kind, 'owned-chrome-job-controlled-cpu'); assert.equal(cpuValue.native, 'NOT_RUN'); assert.ok(cpuValue.passed > 0)
    admitChild()
    chromeChild = track(cp.spawn(path.join(jobBuild, 'cockpit-chrome-job.exe'), [root, chrome, chromeSHA256, extension, profile, lease.borrow().nonce, String(outerDeadline)], { env: childEnvironment, stdio: ['pipe', 'pipe', 'pipe'] }))
    chromeChild.stdin.on('error', () => {})
    retainOutput(chromeChild, 'job-native')
    let jobBuffer = '', jobStartedResolve, jobStartedReject
    const jobStarted = new Promise((resolve, reject) => { jobStartedResolve = resolve; jobStartedReject = reject })
    chromeChild.stdout.on('data', bytes => {
      jobBuffer += bytes; if (jobBuffer.length > 4096) { jobStartedReject(Error('COCKPIT_BRIDGE_JOB_OUTPUT_LIMIT')); return }
      try { let newline
      while ((newline = jobBuffer.indexOf('\n')) >= 0) {
        const value = JSON.parse(jobBuffer.slice(0, newline)); jobBuffer = jobBuffer.slice(newline + 1)
        if (value.kind === 'owned-chrome-job' && value.stage === 'started' && Object.keys(value).length === 2) jobStartedResolve()
        if (value.kind === 'owned-chrome-job' && value.cleanup === true && Object.keys(value).length === 2) cleanupObserved = true
      } } catch { operatorFailed.abort(Error('COCKPIT_BRIDGE_JOB_OUTPUT_INVALID')) }
    })
    closes.get(chromeChild).then(() => jobStartedReject(Error('COCKPIT_BRIDGE_JOB_START_FAILED')), jobStartedReject)
    await aborted(signal, (resolve, reject) => { jobStarted.then(resolve, reject); return () => {} })
    const address = await endpoint(profile, chromeChild, signal), ws = new WebSocket(address)
    await aborted(signal, (resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); return () => {} })
    cdp = new Cdp(ws, signal); await cdp.command('Target.setDiscoverTargets', { discover: true })
    const worker = await cdp.target(info => info.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\//.test(info.url) && new URL(info.url).pathname.slice(1) === manifest.background.service_worker)
    const sw = (await cdp.command('Target.attachToTarget', { targetId: worker.targetId, flatten: true })).sessionId
    await cdp.command('Runtime.enable', {}, sw)
    observedId = await cdp.evaluate(sw, 'chrome.runtime.id')
    assert.match(observedId, /^[a-p]{32}$/); assert.equal(new URL(worker.url).host, observedId)
    server.send({ type: 'observer-id', id: observedId }); await waitMessage(value => value?.type === 'observer-id-set')
    // Mark the attempt before awaiting: an interrupted helper may already own registry/files.
    registered = true
    await runPs(path.join(sourceRepo, 'scripts/register-cockpit-native-bridge.ps1'), ['-InstallRoot', install, '-ExtensionId', observedId])
    // Real service-worker Native Messaging has no native window parent: negative only.
    const negative = await cdp.evaluate(sw, `new Promise(resolve=>{const p=chrome.runtime.connectNative('com.cmspark.cockpit');let replied=false;p.onMessage.addListener(m=>{replied=true;resolve(m&&Object.keys(m).sort().join() === 'op,reason,v'&&m.v===1&&m.op==='unavailable'&&m.reason==='bridge_unavailable'?'unavailable':'INVALID');});p.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!replied)resolve('UNKNOWN');});p.postMessage({v:1,op:'bind',ownerNonce:'${randomBytes(16).toString('hex')}',challenge:'${randomBytes(32).toString('hex')}',documentId:'negative-service-worker',windowId:1});})`)
    assert.equal(negative, 'unavailable', 'COCKPIT_BRIDGE_PARENT_ZERO_NOT_PROVEN')
    const page = await cdp.command('Target.createTarget', { url: 'chrome-extension://' + observedId + '/' + panel })
    const ui = (await cdp.command('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId
    const uiContext = await cdp.defaultContext(ui, 'chrome-extension://' + observedId)
    const paired = await cdp.evaluate(ui, `new Promise(resolve=>{const h=m=>{if(m?.type==='thread.mutation.connection'&&m.state==='connected'){chrome.runtime.onMessage.removeListener(h);resolve(true);}};chrome.runtime.onMessage.addListener(h);chrome.runtime.sendMessage({type:'ws.setSecret',secret:${JSON.stringify(secret)}}).then(r=>{if(!r?.ok){chrome.runtime.onMessage.removeListener(h);resolve(false);return;}return chrome.runtime.sendMessage({type:'getStatus'}).then(s=>{if(s?.connectionState==='connected'){chrome.runtime.onMessage.removeListener(h);resolve(true);}});});})`, uiContext)
    assert.equal(paired, true)
    const positive = waitMessage(value => value?.type === 'bridge-state' && value.state === 'verified' && value.count === 1)
    const opened = await cdp.evaluate(ui, `chrome.runtime.sendMessage({type:'cockpit.open'}).then(r=>r?.ok===true)`, uiContext)
    assert.equal(opened, true); await positive; assert.equal(verified, 1)
    signal.throwIfAborted(); lease.checkpoint()
    t.diagnostic('actualDocumentNativeParent=PROVEN actualAuthenticatedWsVerified=1 parentZeroRefused=1 masking=NOT_IMPLEMENTED')
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    try { cdp?.ws.close() } catch {}
    let jobEmpty = false, cleanupFailure = null
    try {
      if (chromeChild) {
        // The wrapper terminates the entire job and consumes ACTIVE_PROCESS_ZERO;
        // do not kill only the launcher, Chrome root, or a numeric PID.
        if (chromeChild.exitCode === null && chromeChild.signalCode === null) chromeChild.stdin.end('cleanup\n', () => {})
        const result = await closes.get(chromeChild)
        jobEmpty = result.code === 0 && cleanupObserved
        assert.ok(jobEmpty, 'COCKPIT_BRIDGE_JOB_TREE_CLEANUP_UNPROVEN')
      } else jobEmpty = true // launch was never admitted
    } catch (error) { cleanupFailure = error }
    try {
      if (server) { if (server.exitCode === null && server.signalCode === null) server.kill(); await closes.get(server) }
    } catch (error) { cleanupFailure ??= error }
    try {
      if (registered) await runPs(path.join(sourceRepo, 'scripts/register-cockpit-native-bridge.ps1'), ['-InstallRoot', install, '-Unregister'], true)
    } catch (error) { cleanupFailure ??= error }
    if (jobEmpty && !cleanupFailure) lease.settled() // unknown cleanup keeps the desktop lease retained
    if (cleanupFailure) {
      if (primaryFailure) t.diagnostic('OWNED_BRIDGE_CLEANUP_UNPROVEN_PRIMARY_PRESERVED')
      else throw cleanupFailure
    }
  }
}) })
