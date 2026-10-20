import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { PassThrough, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
const file = path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-first-gate.cjs')
const text = fs.readFileSync(file, 'utf8'), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const functions = source.statements.filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'run')
assert.equal(functions.length, 1)
async function execute(code: number, signal: string | null) {
  const child = new EventEmitter(), calls: unknown[][] = [], closed: number[] = [], environment = Object.freeze({ ONLY_OWNED: 'yes' })
  const sandbox = { sequence: 0, raw: '/owned/raw', path,
    fs: { openSync: (...a: unknown[]) => { calls.push(['open', ...a]); return calls.length }, closeSync: (fd: number) => closed.push(fd) },
    cp: { spawn: (...a: unknown[]) => { calls.push(['spawn', ...a]); return child } },
  }
  const run = new vm.Script(`(${functions[0].getText(source)})`, { filename: file }).runInNewContext(sandbox)
  const promise = run('/fixed/node', ['/fixed/script'], '/owned/repo', environment, 'control')
  child.emit('exit', code, signal) // Actual run must keep waiting for stdio/close.
  assert.equal(closed.length, 0)
  child.emit('close', code, signal)
  let error: unknown; try { await promise } catch (value) { error = value }
  const spawn = calls.find(c => c[0] === 'spawn')!, options = spawn[3] as { env: unknown; cwd: string; stdio: unknown[] }
  assert.equal(options.env, environment); assert.equal(options.cwd, '/owned/repo'); assert.equal(options.stdio[0], 'ignore')
  assert.equal(closed.length, 2)
  return error
}
test('actual setup runner passes exact sanitized environment and waits for close', async () => { assert.equal(await execute(0, null), undefined) })
test('actual setup runner rejects natural failure and signal, retaining separate raw handles', async () => {
  assert.match(String(await execute(1, null)), /GATE_control_FAILED/)
  assert.match(String(await execute(0, 'SIGTERM')), /GATE_control_FAILED/)
})
test('whole actual gate refuses the empty source pin before filesystem, process, or network effects', () => {
  const actualSupply = require(path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-browser-supply.cjs'))
  let effects = 0
  const deny = new Proxy({}, { get() { effects++; throw Error('FORBIDDEN_EFFECT') } })
  const modules: Record<string, unknown> = { 'node:assert/strict': assert, 'node:fs': deny, 'node:path': path, 'node:child_process': deny,
    './cockpit-bridge-browser-supply.cjs': actualSupply, './cockpit-bridge-browser-admission.cjs': { version: 1, builds: [] } }
  assert.throws(() => new vm.Script(text, { filename: file }).runInNewContext({ require: (id: string) => { assert.ok(id in modules); return modules[id] }, process: { platform: 'win32', arch: 'x64', env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows' } } }), /SUPPLY_NOT_READY/)
  assert.equal(effects, 0)
})

const supplierFile = path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-browser-supply.cjs')
const supplierText = fs.readFileSync(supplierFile, 'utf8'), supplierAst = ts.createSourceFile(supplierFile, supplierText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const downloads = supplierAst.statements.filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'download')
assert.equal(downloads.length, 1)
async function httpControl(statusCode: number, length: string, expectedHash?: string, timeout = false) {
  const actual = require(supplierFile), bytes = Buffer.from('INERT_DOWNLOAD_BYTES'), root = fs.mkdtempSync(path.join(process.env.CMSPARK_TEST_RUN_DIR!, 'http-cpu-'))
  const pin = { kind: 'chrome-for-testing', platform: 'win64', version: '155.0.8059.84', source: 'https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.84/win64/chrome-win64.zip', archiveBytes: bytes.length, archiveSHA256: expectedHash ?? createHash('sha256').update(bytes).digest('hex'), executableSHA256: '0'.repeat(64) }
  let transfers = 0, scheduled: (() => void) | undefined, cleared = false
  const request = new EventEmitter() as EventEmitter & { destroy: (error?: Error) => void }
  request.destroy = (error?: Error) => { if (error) request.emit('error', error) }
  const response = Object.assign(new PassThrough(), { statusCode, headers: { 'content-length': length } })
  const sandbox = { fs, createHash, Transform, pipeline, selectPin: actual.selectPin, check: (value: unknown, reason: string) => { if (!value) throw Error('COCKPIT_BRIDGE_SUPPLY_' + reason) }, TRANSFER_MS: actual.TRANSFER_MS,
    setTimeout: (fn: () => void, ms: number) => { assert.equal(ms, 600000); scheduled = fn; return 1 }, clearTimeout: () => { cleared = true },
    https: { get(url: string, options: { agent: boolean; headers: unknown }, done: (response: unknown) => void) {
      transfers++; assert.equal(url, pin.source); assert.equal(options.agent, false)
      queueMicrotask(() => { if (timeout) scheduled!(); else { done(response); setImmediate(() => response.end(bytes)) } }); return request
    } },
  }
  const download = new vm.Script(`(${downloads[0].getText(supplierAst)})`, { filename: supplierFile }).runInNewContext(sandbox)
  const file = path.join(root, 'partial.zip'); let error: unknown
  try { await download(pin, file) } catch (value) { error = value }
  assert.equal(transfers, 1); assert.equal(cleared, true)
  return { error, file, bytes }
}
test('actual single-transfer producer accepts exact body and refuses redirect/length/hash mismatches', async () => {
  const good = await httpControl(200, '20'); assert.equal(good.error, undefined); assert.deepEqual(fs.readFileSync(good.file), good.bytes)
  assert.match(String((await httpControl(302, '20')).error), /SUPPLY_HTTP/)
  assert.match(String((await httpControl(200, '19')).error), /SUPPLY_HTTP/)
  assert.match(String((await httpControl(200, '20', '0'.repeat(64))).error), /ARCHIVE_HASH/)
})
test('actual independent transfer deadline destroys the sole request without retry', async () => {
  assert.match(String((await httpControl(200, '20', undefined, true)).error), /TRANSFER_DEADLINE/)
})

test('whole actual gate consumes the actual fixed source pin and preserves preparation/registration/controller order', async () => {
  const actualSupply = require(supplierFile), admission = require(path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-browser-admission.cjs'))
  const actualEnv = require(path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-child-env.cjs'))
  const pin = actualSupply.selectPin(admission), calls: { file: string; args: string[]; options: { env: Record<string, string>; cwd: string } }[] = [], stages: string[] = []
  const win = path.win32, repo = 'C:\\candidate', root = 'C:\\owned\\cmspark-test-run-controlled', output: string[] = []
  const modules: Record<string, unknown> = { 'node:assert/strict': assert, 'node:path': win,
    'node:fs': { lstatSync: () => ({ isSymbolicLink: () => false, isDirectory: () => true, isFile: () => true }), realpathSync: { native: (p: string) => win.resolve(p) },
      mkdirSync() {}, writeFileSync() {}, openSync: () => 1, closeSync() {}, readdirSync: () => [{ name: 'cockpit-bridge-controlled', isDirectory: () => true }], existsSync: () => true },
    'node:child_process': { spawn(file: string, args: string[], options: { env: Record<string, string>; cwd: string }) { calls.push({ file, args, options }); const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 0, null)); return child } },
    './cockpit-bridge-browser-supply.cjs': { selectPin: actualSupply.selectPin,
      async download(selected: unknown) { assert.deepEqual(selected, pin); stages.push('fixed-download') },
      async extract() { stages.push('verified-extract'); return 'C:\\owned\\chrome.exe' } },
    './cockpit-bridge-browser-admission.cjs': admission, './cockpit-bridge-child-env.cjs': actualEnv,
  }
  const sandbox = { require: (id: string) => { assert.ok(id in modules); return modules[id] }, __dirname: win.join(repo, 'scripts/tests'), process: { platform: 'win32', arch: 'x64', execPath: 'C:\\node\\node.exe', env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', SystemRoot: 'C:\\Windows', CMSPARK_TEST_RUN_DIR: root, CMSPARK_DATA_DIR: win.join(root, 'data'), TEMP: win.join(root, 'temp') }, stdout: { write: (s: string) => output.push(s) }, stderr: { write: (s: string) => output.push(s) }, exitCode: 0 } }
  await new vm.Script(text, { filename: file }).runInNewContext(sandbox)
  assert.equal(sandbox.process.exitCode, 0); assert.deepEqual(stages, ['fixed-download', 'verified-extract'])
  assert.equal(calls.length, 6)
  assert.deepEqual(Array.from(calls[0].args.slice(1)), ['ci', '--registry=https://registry.npmjs.org/', '--no-audit', '--no-fund'])
  assert.deepEqual(Array.from(calls[1].args.slice(1)), ['run', 'build']); assert.deepEqual(Array.from(calls[2].args.slice(1)), ['-p', 'tsconfig.test.json'])
  assert.ok(calls[3].args[3].endsWith('cockpit-bridge-registration.ps1'))
  assert.ok(calls[4].args[2].endsWith('cockpit-bridge-document-receipt.cjs'))
  assert.ok(calls[5].args[2].endsWith('cockpit-bridge-real-first.cjs')); assert.equal(calls[5].args.length, 7)
  assert.equal(calls[5].args[4], pin.executableSHA256); assert.ok(calls[5].args[6].endsWith('companion\\.test-dist\\src'))
  for (const call of calls) { assert.equal('HOME' in call.options.env, false); assert.equal('USERPROFILE' in call.options.env, false); assert.equal('NODE_OPTIONS' in call.options.env, false); assert.equal('HTTPS_PROXY' in call.options.env, false) }
  assert.deepEqual(output, ['COCKPIT_BRIDGE_FIRST_IDENTITY_COMPLETE\n'])
  // These are inert child close events, not a Windows/Chrome/native-positive receipt.
})
