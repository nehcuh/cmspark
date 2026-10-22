// Same-run build-only handoff. No process launch, compiler or native execution.
'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const LIMIT = 120000, MANIFEST_LIMIT = 16384
const SOURCES = Object.freeze([
  'companion/src/computer/native/cockpit-bridge-host.cs',
  'scripts/tests/cockpit-bridge-chrome-job.cs',
  'scripts/tests/cockpit-bridge-chrome-job-cpu.cs',
  'scripts/build-cockpit-native-bridge.ps1',
  'scripts/tests/build-cockpit-bridge-job.ps1',
])
const OUTPUTS = Object.freeze(['host/cmspark-cockpit-bridge.exe', 'host/cmspark-cockpit-bridge.sha256', 'job/cockpit-chrome-job.exe', 'job/cockpit-chrome-job-cpu.exe'])
const STAT = ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
function same(a, b) { for (const k of STAT) assert.equal(a[k], b[k], 'COCKPIT_BUILD_IDENTITY_CHANGED') }
function record(s) { return Object.fromEntries(STAT.map(k => [k, String(s[k])])) }
function physical(p) { return fs.realpathSync.native(p) }
function equalPath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b }
function directory(p) {
  const a = fs.lstatSync(p, { bigint: true }); assert.ok(a.isDirectory() && !a.isSymbolicLink() && a.ino > 0n)
  assert.ok(equalPath(physical(p), path.resolve(p)), 'COCKPIT_BUILD_DIRECTORY_ALIAS')
  return { dev: String(a.dev), ino: String(a.ino), mode: String(a.mode) }
}
function roots(root, sourceRepo) {
  root = physical(root); sourceRepo = physical(sourceRepo)
  assert.ok(path.isAbsolute(root) && path.isAbsolute(sourceRepo) && root !== sourceRepo)
  return { root, sourceRepo, rootId: directory(root) }
}
function pin(p, maximumBytes) {
  const before = fs.lstatSync(p, { bigint: true })
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.ino > 0n && before.size > 0n)
  if (maximumBytes !== undefined) assert.ok(before.size <= BigInt(maximumBytes), 'COCKPIT_BUILD_FILE_LIMIT')
  assert.ok(equalPath(physical(p), path.resolve(p)), 'COCKPIT_BUILD_FILE_ALIAS')
  const fd = fs.openSync(p, 'r'), buffer = Buffer.alloc(65536)
  const check = () => {
    const after = fs.lstatSync(p, { bigint: true }); assert.ok(after.isFile() && !after.isSymbolicLink() && after.nlink === 1n)
    same(record(before), record(after)); same(record(before), record(fs.fstatSync(fd, { bigint: true })))
    assert.ok(equalPath(physical(p), path.resolve(p)))
  }
  const scan = consume => {
    check(); const hash = crypto.createHash('sha256')
    let at = 0
    while (BigInt(at) < before.size) {
      const n = fs.readSync(fd, buffer, 0, Number(before.size - BigInt(at) < 65536n ? before.size - BigInt(at) : 65536n), at)
      assert.ok(n > 0); const bytes = buffer.subarray(0, n); hash.update(bytes); if (consume) consume(bytes); at += n
    }
    assert.equal(fs.readSync(fd, buffer, 0, 1, at), 0); check()
    return hash.digest('hex')
  }
  try {
    same(record(before), record(fs.fstatSync(fd, { bigint: true })))
    const entry = { stat: record(before), sha256: scan() }
    return { entry, close: () => fs.closeSync(fd), verify: () => assert.equal(scan(), entry.sha256), copy: consume => assert.equal(scan(consume), entry.sha256) }
  } catch (e) { try { fs.closeSync(fd) } catch { /* preserve refusal */ } throw e }
}
function read(p, consume) {
  const opened = pin(p); let failed = false
  try { if (consume) opened.copy(consume); return opened.entry }
  catch (e) { failed = true; throw e }
  finally { try { opened.close() } catch (e) { if (!failed) throw e } }
}
function exactKeys(value, keys) { assert.ok(value && typeof value === 'object' && !Array.isArray(value)); assert.deepEqual(Object.keys(value).sort(), [...keys].sort()) }
function validEntry(value) {
  exactKeys(value, ['stat', 'sha256']); exactKeys(value.stat, STAT)
  for (const k of STAT) assert.match(value.stat[k], /^[0-9]{1,40}$/)
  assert.match(value.sha256, /^[0-9a-f]{64}$/)
}
function retain(base, names, held) {
  return Object.fromEntries(names.map(name => { const opened = pin(path.join(base, name)); held.push(opened); return [name, opened] }))
}
function entries(pins) { return Object.fromEntries(Object.entries(pins).map(([name, opened]) => [name, opened.entry])) }
function digest(pins) {
  const pieces = []; assert.equal(pins[OUTPUTS[1]].entry.stat.size, '65')
  pins[OUTPUTS[1]].copy(bytes => pieces.push(Buffer.from(bytes)))
  assert.equal(Buffer.concat(pieces).toString('utf8'), pins[OUTPUTS[0]].entry.sha256 + '\n', 'COCKPIT_BUILD_DIGEST')
}
function verify(held) { for (const opened of held) opened.verify() }
function release(held) {
  let failed = false, reason
  for (const opened of held) { try { opened.close() } catch (e) { if (!failed) { failed = true; reason = e } } }
  return { failed, reason }
}
function structure(prepared, manifest) {
  assert.deepEqual(fs.readdirSync(prepared).sort(), manifest ? ['host', 'job', 'manifest.json'] : ['host', 'job'])
  assert.deepEqual(fs.readdirSync(path.join(prepared, 'host')).sort(), ['cmspark-cockpit-bridge.exe', 'cmspark-cockpit-bridge.sha256'])
  assert.deepEqual(fs.readdirSync(path.join(prepared, 'job')).sort(), ['cockpit-chrome-job-cpu.exe', 'cockpit-chrome-job.exe'])
}
async function prepare({ root, sourceRepo, runBuild, verifyFiles, signal }) {
  assert.equal(typeof runBuild, 'function'); assert.equal(typeof verifyFiles, 'function')
  const r = roots(root, sourceRepo), prepared = path.join(r.root, 'prepared-build')
  const held = []
  const started = performance.now(), nonce = crypto.randomBytes(16).toString('hex')
  let expired = false, cancelled = Boolean(signal?.aborted), failed = false
  const onAbort = () => { cancelled = true }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => { expired = true }, LIMIT)
  try {
    if (cancelled) throw signal.reason
    fs.mkdirSync(prepared); fs.mkdirSync(path.join(prepared, 'host')); fs.mkdirSync(path.join(prepared, 'job'))
    const dirs = { prepared: directory(prepared), host: directory(path.join(prepared, 'host')), job: directory(path.join(prepared, 'job')) }
    const sourcePins = retain(r.sourceRepo, SOURCES, held), before = entries(sourcePins)
    // runBuild is the parent's two fixed PS calls. Settlement MUST follow actual
    // close; rejection must also join. This helper never kills a PS/compiler.
    const builds = await Promise.allSettled([
      Promise.resolve().then(() => runBuild('host', path.join(prepared, 'host'))),
      Promise.resolve().then(() => runBuild('job', path.join(prepared, 'job'))),
    ])
    // Keep the original host-first failure, including when timeout/abort raced.
    for (const build of builds) if (build.status === 'rejected') throw build.reason
    if (expired || performance.now() - started >= LIMIT) throw Error('COCKPIT_BUILD_PREPARATION_TIMEOUT')
    if (cancelled) throw signal.reason
    for (const build of builds) {
      exactKeys(build.value, ['closed', 'code', 'signal'])
      assert.equal(build.value.closed, true); assert.equal(build.value.code, 0); assert.equal(build.value.signal, null)
    }
    assert.deepEqual(directory(r.root), r.rootId)
    for (const [key, name] of [['prepared', ''], ['host', 'host'], ['job', 'job']]) assert.deepEqual(directory(path.join(prepared, name)), dirs[key])
    structure(prepared, false)
    const outputPins = retain(prepared, OUTPUTS, held), outputs = entries(outputPins); digest(outputPins)
    // Native callback checks FileAttributes on exactly these names. Retain the
    // same read-only FDs across that await; no unbound reopen supplies bytes.
    await verifyFiles('prepare'); verify(held); structure(prepared, false)
    assert.deepEqual(directory(r.root), r.rootId)
    for (const [key, name] of [['prepared', ''], ['host', 'host'], ['job', 'job']]) assert.deepEqual(directory(path.join(prepared, name)), dirs[key])
    const manifest = { version: 1, nonce, root: r.rootId, directories: dirs, sources: before, outputs, closes: ['host', 'job'] }
    const json = JSON.stringify(manifest) + '\n'; assert.ok(Buffer.byteLength(json) <= MANIFEST_LIMIT)
    // The deadline admits the completed handoff, never a late successful build.
    if (expired || performance.now() - started >= LIMIT) throw Error('COCKPIT_BUILD_PREPARATION_TIMEOUT')
    if (cancelled) throw signal.reason
    const file = path.join(prepared, 'manifest.json'), fd = fs.openSync(file, 'wx', 0o600)
    try { fs.writeFileSync(fd, json); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    const receipt = { nonce, prepared }
    read(file)
    if (expired || performance.now() - started >= LIMIT) throw Error('COCKPIT_BUILD_PREPARATION_TIMEOUT')
    if (cancelled) throw signal.reason
    return receipt
  } catch (e) { failed = true; throw e }
  finally {
    const cleanup = release(held); clearTimeout(timer); signal?.removeEventListener('abort', onAbort)
    if (!failed && cleanup.failed) throw cleanup.reason
  }
}
async function stage({ root, sourceRepo, install, jobBuild, expectedNonce, verifyFiles }) {
  assert.equal(typeof verifyFiles, 'function')
  const r = roots(root, sourceRepo), prepared = path.join(r.root, 'prepared-build')
  assert.match(expectedNonce, /^[0-9a-f]{32}$/)
  const held = []; let failed = false
  try {
  const manifestPin = pin(path.join(prepared, 'manifest.json'), MANIFEST_LIMIT); held.push(manifestPin)
  assert.ok(BigInt(manifestPin.entry.stat.size) <= BigInt(MANIFEST_LIMIT))
  const pieces = []; manifestPin.copy(bytes => pieces.push(Buffer.from(bytes)))
  const saved = { value: Buffer.concat(pieces).toString('utf8') }
  const m = JSON.parse(saved.value)
  assert.equal(saved.value, JSON.stringify(m) + '\n')
  exactKeys(m, ['version', 'nonce', 'root', 'directories', 'sources', 'outputs', 'closes'])
  assert.equal(m.version, 1); assert.equal(m.nonce, expectedNonce); assert.deepEqual(m.root, r.rootId)
  exactKeys(m.directories, ['prepared', 'host', 'job'])
  for (const [key, name] of [['prepared', ''], ['host', 'host'], ['job', 'job']]) assert.deepEqual(directory(path.join(prepared, name)), m.directories[key])
  assert.deepEqual(m.closes, ['host', 'job']); exactKeys(m.sources, SOURCES); exactKeys(m.outputs, OUTPUTS)
  for (const x of [...Object.values(m.sources), ...Object.values(m.outputs)]) validEntry(x)
  const sourcePins = retain(r.sourceRepo, SOURCES, held), outputPins = retain(prepared, OUTPUTS, held)
  assert.deepEqual(entries(sourcePins), m.sources); assert.deepEqual(entries(outputPins), m.outputs); digest(outputPins)
  install = path.resolve(install); jobBuild = path.resolve(jobBuild)
  assert.equal(path.dirname(install), r.root); assert.match(path.basename(install), /^bridge-install-[0-9a-f]{16}$/)
  assert.equal(jobBuild, path.join(r.root, 'job-build'))
  const bin = path.join(install, 'bin'), installId = directory(install), binId = directory(bin), jobId = directory(jobBuild)
  const checkDirectories = () => {
    assert.deepEqual(directory(r.root), r.rootId)
    for (const [key, name] of [['prepared', ''], ['host', 'host'], ['job', 'job']]) assert.deepEqual(directory(path.join(prepared, name)), m.directories[key])
    assert.deepEqual(directory(install), installId); assert.deepEqual(directory(bin), binId); assert.deepEqual(directory(jobBuild), jobId)
    structure(prepared, true)
  }
  assert.deepEqual(fs.readdirSync(bin), []); assert.deepEqual(fs.readdirSync(jobBuild), [])
  await verifyFiles('stage'); verify(held); checkDirectories()
  const targets = [path.join(bin, 'cmspark-cockpit-bridge.exe'), path.join(bin, 'cmspark-cockpit-bridge.sha256'), path.join(jobBuild, 'cockpit-chrome-job.exe'), path.join(jobBuild, 'cockpit-chrome-job-cpu.exe')]
  const copied = []
  for (const [i, name] of OUTPUTS.entries()) {
    checkDirectories()
    const fd = fs.openSync(targets[i], 'wx', 0o600); let copyFailed = false
    try {
      const opened = fs.fstatSync(fd, { bigint: true })
      assert.ok(opened.isFile() && opened.nlink === 1n && opened.size === 0n)
      outputPins[name].copy(bytes => { let at = 0; while (at < bytes.length) { const n = fs.writeSync(fd, bytes, at, bytes.length - at); assert.ok(n > 0); at += n } })
      fs.fsyncSync(fd)
      const end = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(targets[i], { bigint: true })
      assert.ok(named.isFile() && !named.isSymbolicLink() && named.nlink === 1n)
      for (const key of ['dev', 'ino', 'mode', 'nlink']) assert.equal(end[key], opened[key])
      same(record(end), record(named))
      copied.push({ stat: record(end), sha256: m.outputs[name].sha256 })
    } catch (e) { copyFailed = true; throw e }
    finally { try { fs.closeSync(fd) } catch (e) { if (!copyFailed) throw e } }
    // Windows only guarantees final write timestamps after the writer closes.
    // Keep the original file ID/mode/link/size and full content hash binding;
    // adopt times only from the new read-only FD after that exact close.
    const closed = read(targets[i])
    for (const key of ['dev', 'ino', 'mode', 'nlink', 'size']) assert.equal(closed.stat[key], copied[i].stat[key])
    assert.equal(closed.sha256, copied[i].sha256)
    copied[i] = closed
  }
  checkDirectories()
  for (const [i, target] of targets.entries()) assert.deepEqual(read(target), copied[i])
  verify(held)
  return { host: targets[0], digest: targets[1], job: targets[2], cpu: targets[3] }
  } catch (e) { failed = true; throw e }
  finally { const cleanup = release(held); if (!failed && cleanup.failed) throw cleanup.reason }
}
module.exports = { prepare, stage }
