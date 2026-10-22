import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { test } from 'node:test'
const require = createRequire(import.meta.url)
const helperPath = new URL('./cockpit-bridge-prepared-build.cjs', import.meta.url)
const sourceNames = ['companion/src/computer/native/cockpit-bridge-host.cs', 'scripts/tests/cockpit-bridge-chrome-job.cs', 'scripts/tests/cockpit-bridge-chrome-job-cpu.cs', 'scripts/build-cockpit-native-bridge.ps1', 'scripts/tests/build-cockpit-bridge-job.ps1']
function fixture(fsForHelper = fs) {
  const outer = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-prepared-build-')))
  const root = path.join(outer, 'run'), repo = path.join(outer, 'repo')
  fs.mkdirSync(root); fs.mkdirSync(repo)
  for (const name of sourceNames) { const file = path.join(repo, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'synthetic fixed source: ' + name) }
  let tick = 0, timeout, cleared = false
  const module = { exports: {} }
  // Actual complete helper, with a virtual monotonic clock/timer only. No
  // process, compiler, transport or native DI exists in the helper.
  const script = fs.readFileSync(helperPath, 'utf8')
  vm.runInThisContext('(function(require,module,exports,performance,setTimeout,clearTimeout){' + script + '\n})', { filename: helperPath.pathname })(
    id => id === 'node:fs' ? fsForHelper : require(id), module, module.exports, { now: () => tick },
    (fn, delay) => { assert.equal(delay, 120000); timeout = fn; return 1 },
    id => { assert.equal(id, 1); cleared = true },
  )
  const writes = []
  async function runBuild(kind, out) {
    writes.push(kind)
    if (kind === 'host') {
      const body = Buffer.from('owned inert host bytes')
      fs.writeFileSync(path.join(out, 'cmspark-cockpit-bridge.exe'), body)
      fs.writeFileSync(path.join(out, 'cmspark-cockpit-bridge.sha256'), crypto.createHash('sha256').update(body).digest('hex') + '\n')
    } else {
      assert.equal(kind, 'job')
      fs.writeFileSync(path.join(out, 'cockpit-chrome-job.exe'), 'owned inert job bytes')
      fs.writeFileSync(path.join(out, 'cockpit-chrome-job-cpu.exe'), 'owned inert cpu bytes')
    }
    return { closed: true, code: 0, signal: null }
  }
  const f = { outer, root, sourceRepo: repo, ...module.exports, runBuild, verifyFiles: async phase => { assert.ok(['prepare', 'stage'].includes(phase)) }, writes, expire() { tick = 120000; timeout() }, advance(t) { tick = t }, get cleared() { return cleared } }
  f.cleanup = () => fs.rmSync(outer, { recursive: true, force: false })
  f.targets = () => { const install = path.join(root, 'bridge-install-0123456789abcdef'), jobBuild = path.join(root, 'job-build'); fs.mkdirSync(install); fs.mkdirSync(path.join(install, 'bin')); fs.mkdirSync(jobBuild); return { install, jobBuild } }
  return f
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function withFixture(fn) { const f = fixture(); try { return await fn(f) } finally { f.cleanup() } }
test('fixed closed builds hand off exact three inert binaries and original digest', () => withFixture(async f => {
  const receipt = await f.prepare(f), targets = f.targets(), result = await f.stage({ ...f, ...targets, ...receipt, expectedNonce: receipt.nonce })
  assert.deepEqual(f.writes, ['host', 'job']); assert.equal(f.cleared, true)
  assert.equal(fs.readFileSync(result.host, 'utf8'), 'owned inert host bytes')
  assert.equal(fs.readFileSync(result.job, 'utf8'), 'owned inert job bytes')
  assert.equal(fs.readFileSync(result.cpu, 'utf8'), 'owned inert cpu bytes')
  assert.match(fs.readFileSync(result.digest, 'utf8'), /^[a-f0-9]{64}\n$/)
}))
test('both fixed builds are started concurrently but one pending close prevents admission', () => withFixture(async f => {
  const gate = deferred(); let settled = false
  const pending = f.prepare({ ...f, runBuild: async (kind, out) => { const receipt = await f.runBuild(kind, out); if (kind === 'job') await gate.promise; return receipt } }).finally(() => { settled = true })
  await Promise.resolve(); await Promise.resolve(); assert.deepEqual(f.writes, ['host', 'job']); assert.equal(settled, false)
  assert.equal(fs.existsSync(path.join(f.root, 'prepared-build/manifest.json')), false)
  gate.resolve(); await pending
}))
test('host-first original reason is retained and failed sibling is actually joined', () => withFixture(async f => {
  const gate = deferred(), host = Error('original-host'), job = Error('original-job'); let joined = false
  const pending = f.prepare({ ...f, runBuild: async kind => { if (kind === 'host') throw host; await gate.promise; joined = true; throw job } })
  await Promise.resolve(); await Promise.resolve(); assert.equal(joined, false); gate.resolve()
  await assert.rejects(pending, e => e === host); assert.equal(joined, true)
  assert.equal(fs.existsSync(path.join(f.root, 'prepared-build/manifest.json')), false)
}))
test('deadline latches even when both late builds succeed and still drains their closes', () => withFixture(async f => {
  const gate = deferred(); let settled = false
  const pending = f.prepare({ ...f, runBuild: async (kind, out) => { const receipt = await f.runBuild(kind, out); await gate.promise; return receipt } }).finally(() => { settled = true })
  await Promise.resolve(); await Promise.resolve(); f.expire(); await Promise.resolve(); assert.equal(settled, false)
  gate.resolve(); await assert.rejects(pending, /COCKPIT_BUILD_PREPARATION_TIMEOUT/)
  assert.equal(fs.existsSync(path.join(f.root, 'prepared-build/manifest.json')), false)
}))
test('elapsed monotonic deadline refuses even before timer callback runs', () => withFixture(async f => {
  await assert.rejects(f.prepare({ ...f, runBuild: async (kind, out) => { const receipt = await f.runBuild(kind, out); f.advance(120000); return receipt } }), /TIMEOUT/)
}))
test('abort latches without inventing a child close or admitting a later success', () => withFixture(async f => {
  const gate = deferred(), ac = new AbortController(), reason = Error('explicit-abort'); let settled = false
  const pending = f.prepare({ ...f, signal: ac.signal, runBuild: async (kind, out) => { const receipt = await f.runBuild(kind, out); await gate.promise; return receipt } }).finally(() => { settled = true })
  await Promise.resolve(); await Promise.resolve(); ac.abort(reason); assert.equal(settled, false); gate.resolve()
  await assert.rejects(pending, e => e === reason); assert.equal(fs.existsSync(path.join(f.root, 'prepared-build/manifest.json')), false)
}))
test('partial output and an unclosed receipt are each denied', async () => {
  await withFixture(async f => { await assert.rejects(f.prepare({ ...f, runBuild: async kind => ({ closed: kind === 'host', code: 0, signal: null }) })); assert.equal(fs.existsSync(path.join(f.root, 'prepared-build/manifest.json')), false) })
  await withFixture(async f => { await assert.rejects(f.prepare({ ...f, runBuild: async () => ({ closed: true, code: 0, signal: null }) })); assert.equal(fs.existsSync(path.join(f.root, 'prepared-build/manifest.json')), false) })
})
test('nonzero signal and malformed completion receipt are not success', async () => {
  for (const receipt of [{ closed: true, code: 1, signal: null }, { closed: true, code: 0, signal: 'SIGTERM' }, { closed: true, code: 0, signal: null, fake: true }]) await withFixture(async f => assert.rejects(f.prepare({ ...f, runBuild: async () => receipt })))
})
test('source mutation during builds refuses manifest', () => withFixture(async f => {
  await assert.rejects(f.prepare({ ...f, runBuild: async (kind, out) => { const value = await f.runBuild(kind, out); if (kind === 'host') fs.appendFileSync(path.join(f.sourceRepo, sourceNames[0]), ' changed'); return value } }))
}))
test('source mutation after preparation is rejected before runtime copy', () => withFixture(async f => {
  const receipt = await f.prepare(f), target = f.targets(); fs.appendFileSync(path.join(f.sourceRepo, sourceNames[4]), ' changed')
  await assert.rejects(f.stage({ ...f, ...target, ...receipt, expectedNonce: receipt.nonce })); assert.deepEqual(fs.readdirSync(path.join(target.install, 'bin')), [])
}))
test('output hash replacement and digest mismatch cannot be staged', async () => {
  for (const name of ['cmspark-cockpit-bridge.exe', 'cmspark-cockpit-bridge.sha256']) await withFixture(async f => {
    const receipt = await f.prepare(f), target = f.targets(); fs.writeFileSync(path.join(receipt.prepared, 'host', name), 'replacement')
    await assert.rejects(f.stage({ ...f, ...target, ...receipt, expectedNonce: receipt.nonce }))
  })
})
test('manifest tamper, wrong nonce and a different root are rejected', async () => {
  await withFixture(async f => { const receipt = await f.prepare(f), target = f.targets(); fs.appendFileSync(path.join(receipt.prepared, 'manifest.json'), ' '); await assert.rejects(f.stage({ ...f, ...target, ...receipt, expectedNonce: receipt.nonce })) })
  await withFixture(async f => { const receipt = await f.prepare(f), target = f.targets(); await assert.rejects(f.stage({ ...f, ...target, ...receipt, expectedNonce: '0'.repeat(32) })) })
  await withFixture(async f => { const receipt = await f.prepare(f), target = f.targets(); const other = path.join(f.outer, 'other'); fs.mkdirSync(other); await assert.rejects(f.stage({ ...f, ...target, ...receipt, expectedNonce: receipt.nonce, root: other })) })
})
test('required verifier is awaited with original descriptors retained and rejection closes every descriptor', async () => {
  const open = new Set(), facade = Object.create(fs)
  facade.openSync = (...args) => { const fd = fs.openSync(...args); open.add(fd); return fd }
  facade.closeSync = fd => { open.delete(fd); return fs.closeSync(fd) }
  const f = fixture(facade), reason = Error('native-attribute-refused')
  try {
    await assert.rejects(f.prepare({ ...f, verifyFiles: async phase => { assert.equal(phase, 'prepare'); assert.equal(open.size, 9); await Promise.resolve(); assert.equal(open.size, 9); throw reason } }), e => e === reason)
    assert.equal(open.size, 0); assert.equal(fs.existsSync(path.join(f.root, 'prepared-build/manifest.json')), false)
  } finally { f.cleanup() }
})
test('the verifier cannot replace an owned source or output unnoticed during its await', async () => {
  await withFixture(async f => assert.rejects(f.prepare({ ...f, verifyFiles: async () => { const file = path.join(f.root, 'prepared-build/host/cmspark-cockpit-bridge.exe'); const bytes = fs.readFileSync(file); fs.renameSync(file, file + '.old'); fs.writeFileSync(file, bytes) } })))
  await withFixture(async f => { const receipt = await f.prepare(f), target = f.targets(); await assert.rejects(f.stage({ ...f, ...target, expectedNonce: receipt.nonce, verifyFiles: async () => { fs.appendFileSync(path.join(f.sourceRepo, sourceNames[0]), ' changed') } })); assert.deepEqual(fs.readdirSync(path.join(target.install, 'bin')), []) })
})
test('deadline and abort during native attribute query still refuse a completed late handoff', async () => {
  await withFixture(async f => { await assert.rejects(f.prepare({ ...f, verifyFiles: async () => f.expire() }), /TIMEOUT/); assert.equal(fs.existsSync(path.join(f.root, 'prepared-build/manifest.json')), false) })
  await withFixture(async f => { const ac = new AbortController(), reason = Error('query-abort'); await assert.rejects(f.prepare({ ...f, signal: ac.signal, verifyFiles: async () => ac.abort(reason) }), e => e === reason) })
})
test('stage native attribute refusal is original failure and performs no copy', () => withFixture(async f => {
  const receipt = await f.prepare(f), target = f.targets(), reason = Error('stage-native-refused')
  await assert.rejects(f.stage({ ...f, ...target, expectedNonce: receipt.nonce, verifyFiles: async phase => { assert.equal(phase, 'stage'); throw reason } }), e => e === reason)
  assert.deepEqual(fs.readdirSync(path.join(target.install, 'bin')), []); assert.deepEqual(fs.readdirSync(target.jobBuild), [])
}))
test('one descriptor-close error drains the other descriptors and never replaces the original refusal', async () => {
  for (const phase of ['prepare', 'stage', 'successful-prepare']) {
    const opened = new Set(), facade = Object.create(fs), primary = Error('original-refusal'), cleanup = Error('close-fault'); let fault = false
    facade.openSync = (...args) => { const fd = fs.openSync(...args); opened.add(fd); return fd }
    facade.closeSync = fd => { fs.closeSync(fd); opened.delete(fd); if (fault) { fault = false; throw cleanup } }
    const f = fixture(facade)
    try {
      if (phase === 'prepare') {
        await assert.rejects(f.prepare({ ...f, runBuild: async () => { fault = true; throw primary } }), e => e === primary)
      } else if (phase === 'stage') {
        const receipt = await f.prepare(f), target = f.targets()
        await assert.rejects(f.stage({ ...f, ...target, expectedNonce: receipt.nonce, verifyFiles: async () => { fault = true; throw primary } }), e => e === primary)
      } else {
        await assert.rejects(f.prepare({ ...f, verifyFiles: async () => { fault = true } }), e => e === cleanup)
      }
      assert.equal(opened.size, 0)
    } finally { for (const fd of opened) fs.closeSync(fd); f.cleanup() }
  }
})
test('foreign destination and preexisting target contents are rejected', async () => {
  await withFixture(async f => { const receipt = await f.prepare(f), target = f.targets(); await assert.rejects(f.stage({ ...f, ...target, ...receipt, expectedNonce: receipt.nonce, jobBuild: f.outer })) })
  await withFixture(async f => { const receipt = await f.prepare(f), target = f.targets(); fs.writeFileSync(path.join(target.install, 'bin/foreign'), 'keep'); await assert.rejects(f.stage({ ...f, ...target, ...receipt, expectedNonce: receipt.nonce })); assert.equal(fs.readFileSync(path.join(target.install, 'bin/foreign'), 'utf8'), 'keep') })
})
test('same bytes at a replaced inode and symbolic links do not retain admission', async () => {
  await withFixture(async f => { const receipt = await f.prepare(f), target = f.targets(), file = path.join(receipt.prepared, 'job/cockpit-chrome-job.exe'); const bytes = fs.readFileSync(file); fs.renameSync(file, file + '.old'); fs.writeFileSync(file, bytes); await assert.rejects(f.stage({ ...f, ...target, ...receipt, expectedNonce: receipt.nonce })) })
  let linked = ''
  const facade = Object.create(fs); facade.lstatSync = (name, ...args) => { const stat = fs.lstatSync(name, ...args); if (String(name) === linked) return new Proxy(stat, { get(target, key) { if (key === 'isSymbolicLink') return () => true; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } }); return stat }
  const f = fixture(facade)
  try { const receipt = await f.prepare(f), target = f.targets(); linked = path.join(receipt.prepared, 'job/cockpit-chrome-job.exe'); await assert.rejects(f.stage({ ...f, ...target, ...receipt, expectedNonce: receipt.nonce })) } finally { f.cleanup() }
})

test('oversized manifest is refused before reading any body bytes', async () => {
  for (const growth of ['before-stat', 'during-open']) {
    const facade = Object.create(fs), manifests = new Set(); let readBytes = 0, growOnOpen = false
    facade.openSync = (name, ...args) => {
      const manifest = path.basename(String(name)) === 'manifest.json'
      if (manifest && growOnOpen) { growOnOpen = false; fs.writeFileSync(name, Buffer.alloc(65536, 120)) }
      const fd = fs.openSync(name, ...args); if (manifest) manifests.add(fd); return fd
    }
    facade.readSync = (fd, ...args) => { const n = fs.readSync(fd, ...args); if (manifests.has(fd)) readBytes += n; return n }
    facade.closeSync = fd => { manifests.delete(fd); return fs.closeSync(fd) }
    const f = fixture(facade)
    try {
      const receipt = await f.prepare(f), target = f.targets()
      if (growth === 'before-stat') fs.writeFileSync(path.join(receipt.prepared, 'manifest.json'), Buffer.alloc(65536, 120))
      else growOnOpen = true
      readBytes = 0
      await assert.rejects(f.stage({ ...f, ...target, expectedNonce: receipt.nonce }))
      assert.equal(readBytes, 0, '16KiB admission and opened identity precede the first body read')
      assert.deepEqual(fs.readdirSync(path.join(target.install, 'bin')), [])
    } finally { f.cleanup() }
  }
})
test('writer close may finalise timestamps but cannot replace inode or change copied bytes', async () => {
  for (const fault of ['timestamps', 'replace', 'bytes']) {
    const facade = Object.create(fs), targets = new Map(); let injected = false
    facade.openSync = (name, flags, ...args) => { const fd = fs.openSync(name, flags, ...args); if (typeof flags === 'string' && flags.includes('w') && /[\\/]bin[\\/]/.test(String(name))) targets.set(fd, String(name)); return fd }
    facade.closeSync = fd => {
      const name = targets.get(fd); targets.delete(fd); fs.closeSync(fd)
      if (name && !injected) {
        injected = true
        if (fault === 'timestamps') { const now = new Date(Date.now() + 1000); fs.utimesSync(name, now, now) }
        else if (fault === 'replace') { const bytes = fs.readFileSync(name); fs.renameSync(name, name + '.old'); fs.writeFileSync(name, bytes) }
        else fs.appendFileSync(name, 'changed')
      }
    }
    const f = fixture(facade)
    try {
      const receipt = await f.prepare(f), target = f.targets()
      const operation = f.stage({ ...f, ...target, expectedNonce: receipt.nonce })
      if (fault === 'timestamps') { const result = await operation; assert.equal(fs.readFileSync(result.host, 'utf8'), 'owned inert host bytes') }
      else await assert.rejects(operation)
      assert.equal(injected, true)
    } finally { f.cleanup() }
  }
})
