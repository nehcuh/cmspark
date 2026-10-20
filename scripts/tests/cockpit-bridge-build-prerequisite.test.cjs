'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
const path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto')
const source = fs.readFileSync(path.join(__dirname, 'cockpit-bridge-build-prerequisite.cjs'), 'utf8')
const builder = fs.readFileSync(path.join(__dirname, '../build-cockpit-native-bridge.ps1'), 'utf8')
const names = ['binary', 'digest'].map(name => {
  const match = builder.match(new RegExp('\\$' + name + " = Join-Path \\$directory.FullName '([^']+)'"))
  assert.ok(match); return match[1]
})
function actual(fault = 'none') {
  const win = path.win32, root = 'C:\\owned\\cmspark-cockpit-build-one', files = new Map(), handles = new Map()
  let ino = 1, fd = 20, launches = 0, removed = false, closed = 0
  const stdout = [], stderr = [], calls = []
  function put(name, bytes, kind = 'file') { files.set(name, { bytes: Buffer.from(bytes), kind, ino: ino++, dev: 1, mtimeMs: 1, nlink: 1 }) }
  function stat(name) {
    const row = files.get(name); assert.ok(row, name)
    return { ...row, size: row.bytes.length, isFile: () => row.kind === 'file', isDirectory: () => row.kind === 'dir', isSymbolicLink: () => row.kind === 'link' }
  }
  put(root, '', 'dir')
  const io = {
    mkdtempSync: prefix => { assert.equal(prefix, 'C:\\owned\\cmspark-cockpit-build-'); return root },
    realpathSync: { native: name => name }, lstatSync: stat,
    mkdirSync: name => { assert.ok(name.startsWith(root + '\\')); put(name, '', 'dir') },
    openSync: (name, mode) => { assert.equal(mode, 'r'); stat(name); handles.set(++fd, name); return fd },
    fstatSync: n => stat(handles.get(n)), closeSync: n => { assert.ok(handles.delete(n)); closed++ },
    readSync: (n, buffer, offset, length, position) => {
      const name = handles.get(n), row = files.get(name)
      if (fault === 'changed-binary' && name.endsWith('.exe')) row.mtimeMs++
      if (fault === 'grown-digest' && name.endsWith('.sha256') && position === 0) row.bytes = Buffer.concat([row.bytes, Buffer.from('x')])
      if (fault === 'zero-read' && name.endsWith('.exe')) return 0
      const count = Math.min(length, Math.max(0, row.bytes.length - position)); row.bytes.copy(buffer, offset, position, position + count); return count
    },
    rmSync: (name, options) => { assert.equal(name, root); assert.equal(options.recursive, true); assert.equal(options.force, false); removed = true },
  }
  const spawnSync = (file, args, options) => {
    launches++; calls.push({ file, args: Array.from(args), options })
    const binary = win.join(root, 'bin', names[0]), digest = win.join(root, 'bin', names[1]), bytes = Buffer.from('inert compiler-output fixture; never executed')
    if (fault !== 'missing-binary') put(binary, bytes, fault === 'binary-link' ? 'link' : 'file')
    if (fault !== 'missing-digest') put(digest, crypto.createHash('sha256').update(bytes).digest('hex') + '\n', fault === 'digest-link' ? 'link' : 'file')
    if (fault === 'binary-hardlink') files.get(binary).nlink = 2
    if (fault === 'wrong-digest') files.get(digest).bytes = Buffer.from('0'.repeat(64) + '\n')
    if (fault === 'root-replaced') files.get(root).ino++
    return fault === 'spawn-error' ? { error: Error('inert spawn refusal'), status: null, signal: null }
      : { status: fault === 'compiler-failed' ? 1 : fault === 'unclosed-child' ? null : 0, signal: fault === 'unclosed-child' ? 'SIGTERM' : null }
  }
  const childEnv = require('./cockpit-bridge-child-env.cjs')
  const proc = { platform: fault === 'wrong-platform' ? 'linux' : 'win32', arch: 'x64',
    env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', SystemRoot: 'C:\\Windows', PROVIDER_KEY: 'inert-denied', HOME: 'inert-denied' },
    stdout: { write: x => stdout.push(x) }, stderr: { write: x => stderr.push(x) }, exitCode: undefined }
  const mod = { exports: {} }, imports = { 'node:assert/strict': assert, 'node:fs': io, 'node:path': win,
    'node:os': { tmpdir: () => 'C:\\owned' }, 'node:child_process': { spawnSync }, 'node:crypto': crypto,
    './cockpit-bridge-child-env.cjs': childEnv }
  const req = name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name] }; req.main = mod
  vm.runInNewContext(source, { require: req, module: mod, __dirname: 'C:\\repo\\scripts\\tests', process: proc, Buffer }, { timeout: 1000 })
  assert.equal(handles.size, 0)
  return { proc, stdout, stderr, calls, launches, removed, closed }
}
test('actual build prerequisite runs only the fixed PS5.1 builder and validates its owned output', () => {
  const r = actual(); assert.equal(r.proc.exitCode, undefined); assert.equal(r.launches, 1); assert.equal(r.removed, true)
  assert.deepEqual(r.stdout, ['COCKPIT_BRIDGE_FIXED_BUILD_COMPLETE\n']); assert.deepEqual(r.stderr, [])
  const c = r.calls[0]; assert.equal(c.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.deepEqual(c.args, ['-NoProfile', '-NonInteractive', '-File', 'C:\\repo\\scripts\\build-cockpit-native-bridge.ps1', '-OutputDirectory', 'C:\\owned\\cmspark-cockpit-build-one\\bin'])
  assert.equal(c.options.stdio, 'inherit'); assert.equal(c.options.windowsHide, true); assert.equal(c.options.cwd, 'C:\\repo')
  for (const k of ['HOME', 'USERPROFILE', 'PROVIDER_KEY', 'HTTPS_PROXY', 'NODE_OPTIONS']) assert.equal(k in c.options.env, false)
  assert.equal(r.closed, 2)
})
for (const fault of ['compiler-failed', 'missing-binary', 'missing-digest', 'wrong-digest', 'binary-link', 'digest-link', 'binary-hardlink', 'changed-binary', 'grown-digest', 'zero-read']) test('actual build prerequisite refuses ' + fault, () => {
  const r = actual(fault); assert.equal(r.proc.exitCode, 1); assert.equal(r.launches, 1); assert.equal(r.removed, false)
  assert.deepEqual(r.stdout, []); assert.deepEqual(r.stderr, ['COCKPIT_BRIDGE_FIXED_BUILD_REFUSED\n'])
})
for (const fault of ['unclosed-child', 'spawn-error', 'root-replaced']) test('actual build prerequisite retains uncertain ownership/liveness: ' + fault, () => {
  const r = actual(fault); assert.equal(r.proc.exitCode, 1); assert.equal(r.launches, 1); assert.equal(r.removed, false)
})
test('actual build prerequisite refuses non-Windows before allocating or launching', () => {
  const r = actual('wrong-platform'); assert.equal(r.proc.exitCode, 1); assert.equal(r.launches, 0); assert.equal(r.removed, false)
})
test('actual Windows workflow requires fixed builder before canonical and keeps scalar selection first', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n')
  const command = 'node scripts/tests/cockpit-bridge-build-prerequisite.cjs'
  assert.equal(workflow.split(command).length, 2)
  const at = workflow.indexOf(command)
  assert.ok(at > workflow.indexOf('& scripts/tests/cockpit-bridge-node-selection.test.ps1'))
  assert.ok(at < workflow.indexOf('Native Windows read-only Registry discovery (#644)'))
  assert.ok(at < workflow.indexOf('Complete Windows Companion census (#650)'))
  assert.ok(workflow.slice(at).startsWith(command + '\n          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n'))
})
