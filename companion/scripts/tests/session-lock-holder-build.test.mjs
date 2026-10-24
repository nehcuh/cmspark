// Inert build/schedule/source controls only. Never compile or launch the C fixture.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { sessionLockHolderCompilePlan } from '../build-session-lock-holder-windows.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const runner = fs.readFileSync(path.join(root, 'scripts/run-tests.mjs'), 'utf8')
const holder = 'io-rename-windows-native.test.js'
const virtualRoot = '/owned/companion', run = '/owned/tmp/cmspark-test-run-session'
function exercise({ source = runner, platform = 'win32', files = [holder], requested = [], buildResult = { status: 0, signal: null } } = {}) {
  const calls = [], removed = [], env = { OWNED_INHERITED_VALUE: 'same' }
  const fakeFS = {
    existsSync(p) { return !p.endsWith('.test.js') || files.includes(path.posix.basename(p)) },
    realpathSync(p) { assert.ok(path.posix.isAbsolute(p)); return p },
    readdirSync(p) { assert.equal(p, virtualRoot + '/.test-dist/tests'); return files.map(name => ({ name, isDirectory: () => false, isFile: () => true })) },
    mkdtempSync(p) { assert.equal(p, '/owned/tmp/cmspark-test-run-'); return run },
    rmSync(p, options) { assert.equal(p, run); assert.deepEqual(options && JSON.parse(JSON.stringify(options)), { recursive: true, force: true }); removed.push(p) },
  }
  class Exit { constructor(code) { this.code = code } }
  let exit, failure
  const requireOwned = id => {
    if (id === 'node:fs') return fakeFS
    if (id === 'node:path') return path.posix
    if (id === 'node:os') return { tmpdir: () => '/owned/tmp' }
    if (id === 'node:url') return { fileURLToPath: () => virtualRoot + '/scripts/run-tests.mjs' }
    if (id === 'node:child_process') return { spawnSync(binary, args, options) {
      assert.equal(binary, '/owned/node'); assert.equal(options.cwd, virtualRoot); assert.equal(options.stdio, 'inherit')
      if (args[0] === virtualRoot + '/scripts/build-session-lock-holder-windows.mjs') {
        assert.deepEqual(Array.from(args), [virtualRoot + '/scripts/build-session-lock-holder-windows.mjs', run])
        assert.equal(options.env, env); calls.push({ kind: 'BUILD', args: Array.from(args) }); return buildResult
      }
      assert.equal(options.env.CMSPARK_TEST_RUN_DIR, run); assert.equal(options.env.OWNED_INHERITED_VALUE, 'same')
      assert.deepEqual(Array.from(args.slice(0, 3)), ['--require', virtualRoot + '/scripts/test-data-dir.cjs', '--test'])
      if (platform === 'win32') assert.equal(args[3], '--test-concurrency=1')
      calls.push({ kind: 'TEST', args: Array.from(args) }); return { status: 0, signal: null }
    } }
    throw new Error('UNDECLARED_RUNNER_IMPORT')
  }
  assert.equal(source.split('import.meta.url').length, 2)
  const js = ts.transpileModule(source.replace('import.meta.url', '"file:///owned/companion/scripts/run-tests.mjs"'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  try {
    vm.runInNewContext(js, { require: requireOwned, exports: {}, console: { error() {} }, process: {
      execPath: '/owned/node', argv: ['node', 'runner', ...requested], platform, versions: { node: '22.23.4' }, env,
      exit(code) { throw new Exit(code) },
    } })
  } catch (error) { if (error instanceof Exit) exit = error.code; else failure = error }
  return { calls, removed, exit, failure }
}
function prepared(trace) {
  assert.equal(trace.failure, undefined); assert.equal(trace.exit, 0)
  assert.deepEqual(trace.calls.map(c => c.kind), ['BUILD', 'TEST'])
  assert.equal(trace.calls[1].args.filter(a => a.endsWith('/' + holder)).length, 1)
  assert.deepEqual(trace.removed, [run])
}

test('session holder actual C compiler plan is kernel32-only and requires no desktop SDK input', () => {
  assert.deepEqual(sessionLockHolderCompilePlan({ cl: 'C:\\VS\\cl.exe', root: 'C:\\source', output: 'C:\\owned' }), [
    'C:\\VS\\cl.exe', ['/nologo', '/std:c11', '/W4', '/WX', '/MT', '/DUNICODE', '/D_UNICODE',
      'C:\\source\\tests\\fixtures\\session-save\\lock-holder.c', '/link', '/MACHINE:X64', 'kernel32.lib', '/OUT:C:\\owned\\session-lock-holder.exe'],
  ])
  const source = fs.readFileSync(path.join(root, 'scripts/build-session-lock-holder-windows.mjs'), 'utf8')
  assert.match(source, /import \{ desktopWindowsToolchain \} from "\.\/build-desktop-windows\.mjs"/)
  assert.doesNotMatch(source, /\b(?:fetch|download|prepareDesktopNodeHeaders|buildDesktopWindows)\s*\(/)
  assert.match(source, /fs\.constants\.COPYFILE_EXCL/)
})

test('session holder actual runner builds selected native file once before original Windows test scheduling', () => {
  prepared(exercise())
  prepared(exercise({ requested: ['.test-dist/tests/' + holder, '.test-dist/tests/' + holder] }))
  // Real old runner is obtained by the sole build-hook inverse, not a shadow scheduler.
  const from = runner.indexOf('  // Build once in the existing private run root'), to = runner.indexOf('  // Native input-desktop owners', from)
  assert.ok(from >= 0 && to > from)
  const before = runner.slice(0, from) + runner.slice(to)
  assert.doesNotMatch(before, /build-session-lock-holder-windows/)
  assert.throws(() => prepared(exercise({ source: before })), { code: 'ERR_ASSERTION' })
})

test('session holder actual runner does not build for unselected modules or POSIX', () => {
  for (const options of [
    { files: ['config.test.js'] },
    { files: [holder, 'config.test.js'], requested: ['.test-dist/tests/config.test.js'] },
    { platform: 'linux' },
  ]) {
    const trace = exercise(options)
    assert.equal(trace.failure, undefined); assert.equal(trace.exit, 0)
    assert.deepEqual(trace.calls.map(c => c.kind), ['TEST']); assert.deepEqual(trace.removed, [run])
  }
})

test('session holder actual runner refuses build failure before any testcase and cleans only its run root', () => {
  for (const buildResult of [{ status: 2, signal: null }, { status: null, signal: 'SIGTERM' }, { error: new Error('INERT_BUILD_ERROR'), status: null, signal: null }]) {
    const trace = exercise({ buildResult })
    assert.match(String(trace.failure?.message), /^SESSION_LOCK_HOLDER_PREPARATION_FAILED$/)
    assert.deepEqual(trace.calls.map(c => c.kind), ['BUILD']); assert.deepEqual(trace.removed, [run])
  }
})

test('session holder actual source authority keeps read sharing, readiness-after-open, close and original testcase suffix', () => {
  const c = fs.readFileSync(path.join(root, 'tests/fixtures/session-save/lock-holder.c'), 'utf8').replace(/\/\/[^\n]*/g, '')
  const authority = value => {
    assert.match(value, /int wmain\(int argc, wchar_t \*\*argv\)/)
    assert.match(value, /CreateFileW\(argv\[1\], GENERIC_READ,\s*FILE_SHARE_READ \| FILE_SHARE_WRITE, NULL, OPEN_EXISTING,\s*FILE_ATTRIBUTE_NORMAL, NULL\)/)
    assert.doesNotMatch(value, /FILE_SHARE_DELETE/)
    const opened = value.indexOf('if (held == INVALID_HANDLE_VALUE) return 2;'), announced = value.indexOf('WriteFile(output, ready,')
    assert.ok(opened >= 0 && announced > opened)
    assert.match(value, /static const char ready\[\] = "LOCKED\\r\\n"/)
    assert.match(value, /GetTickCount64\(\) - start > 10000/); assert.match(value, /Sleep\(1\)/)
    assert.match(value, /if \(!CloseHandle\(held\) && result == 0\) result = 6;\s*return result;/)
  }
  authority(c)
  for (const mutant of [c.replace('FILE_SHARE_READ | FILE_SHARE_WRITE', 'FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE'), c.replace('if (held == INVALID_HANDLE_VALUE) return 2;', ''), c.replace('!CloseHandle(held)', '!TRUE')]) {
    assert.throws(() => authority(mutant), { code: 'ERR_ASSERTION' })
  }
  const source = fs.readFileSync(path.join(root, 'tests/io-rename-windows-native.test.ts'), 'utf8')
  assert.match(source, /skip: process\.platform !== "win32", timeout: 15_000/)
  const start = source.indexOf('  let closed = false'); assert.ok(start >= 0)
  // Authenticated 117402 before-source suffix; only checkout CRLF pairs canonicalize to LF here.
  // This source-text oracle never normalizes runtime bytes, emitted JS, TAP or receipts.
  assert.equal(createHash('sha256').update(source.slice(start).replace(/\r\n/g, '\n')).digest('hex'), '4841d4d4d3bfcc890300854488a8b36bf423b29b146da7222fed29b3cbe4dc7e')
})
