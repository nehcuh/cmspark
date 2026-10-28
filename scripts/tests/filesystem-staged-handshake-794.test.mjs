// Remote-CI-only real stdio acceptance, outside the package CPU gates.
// If discovered elsewhere, the explicit admission checks fail before any spawn.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { stageFilesystemRuntime } from '../stage-filesystem-runtime.mjs'

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'REMOTE_CI_ADMISSION_REQUIRED')
assert.equal(process.env.RUNNER_OS, 'Linux', 'REMOTE_LINUX_CI_REQUIRED')
assert.equal(process.env.CMSPARK_STAGED_FILESYSTEM_CI, '1', 'EXPLICIT_CI_ENTRY_REQUIRED')
assert.equal(process.platform, 'linux', 'LINUX_CI_REQUIRED')
assert.equal(process.versions.node, '22.23.4', 'PINNED_NODE_REQUIRED')
assert.ok(!process.env.NODE_PATH, 'GLOBAL_NODE_PATH_MUST_BE_ABSENT')

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = path.join(repo, 'companion')
const require = createRequire(path.join(source, 'package.json'))
// The workflow enters Node through env -i before bootstrap. Retain Node
// test-runner internals, but make all lazy config/logger paths suite-owned.
const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-staged-fs-suite-794-'))
for (const name of ['home', 'data', 'tmp', 'empty-path']) fs.mkdirSync(path.join(suiteRoot, name))
Object.assign(process.env, { HOME: path.join(suiteRoot, 'home'), CMSPARK_DATA_DIR: path.join(suiteRoot, 'data'),
  TMPDIR: path.join(suiteRoot, 'tmp'), PATH: path.join(suiteRoot, 'empty-path'), USER: 'owned-ci', LOGNAME: 'owned-ci',
  LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', CMSPARK_STAGED_FILESYSTEM_CI: '1' })
let allChildrenClosed = true
after(() => {
  if (!allChildrenClosed) throw new Error('SUITE_CHILD_CLOSE_UNCONFIRMED_RUNTIME_RETAINED')
  try { fs.rmSync(suiteRoot, { recursive: true, force: true }) } catch { throw new Error('OWNED_SUITE_REMOVE_FAILED') }
})
// Load the real SDK client and normally built product process owner. No fake
// framing, shadow child, ts.transpileModule or full daemon module is used.
const fence = fs.readFileSync(path.join(repo, 'scripts/tests/fixtures/filesystem-ci-network-fence-794.cjs'))
// Install before dependency imports; the child gets the same exact byte copy
// as its only preload, before loading the actual staged server entry.
require(path.join(repo, 'scripts/tests/fixtures/filesystem-ci-network-fence-794.cjs'))
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { ErrorCode } = require('@modelcontextprotocol/sdk/types.js')
const { OwnedStdioTransport } = require('./dist/mcp/stdio-transport.js')
const lock = JSON.parse(fs.readFileSync(path.join(source, 'package-lock.json'), 'utf8'))
const OUTPUT_LIMIT = 1024 * 1024, STDERR_LIMIT = 64 * 1024
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
let priorCaseFailed = false

class ObservedTransport extends OwnedStdioTransport {
  observation = { assigned: false, exited: false, closed: false, exitCode: null, signal: null, stdoutEOF: false, stderrEOF: false, stdoutBytes: 0, stderrBytes: 0, overflow: false }
  stderrPrefix = Buffer.alloc(0)
  async start() {
    const pending = super.start()
    // This version-bound passive observer reads the actual TS-private child
    // field emitted by the normal build. It does not substitute spawn or owner.
    const child = this.child
    if (child) {
      const observed = this.observation
      observed.assigned = true
      child.once('exit', (code, signal) => { observed.exited = true; observed.exitCode = code; observed.signal = signal })
      child.once('close', () => { observed.closed = true })
      child.stdout?.once('end', () => { observed.stdoutEOF = true })
      child.stderr?.once('end', () => { observed.stderrEOF = true })
      child.stdout?.on('data', bytes => {
        observed.stdoutBytes += bytes.length
        if (observed.stdoutBytes > OUTPUT_LIMIT) { observed.overflow = true; void this.close().catch(() => {}) }
      })
    }
    return pending
  }
}

function noAncestorModules(app) {
  for (let directory = path.dirname(app);; directory = path.dirname(directory)) {
    assert.equal(fs.existsSync(path.join(directory, 'node_modules')), false, 'STAGING_MUST_NOT_BORROW_ANCESTOR_MODULES')
    if (path.dirname(directory) === directory) break
  }
}

function inventory(root) {
  const files = new Map()
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name), stat = fs.lstatSync(file)
      assert.equal(stat.isSymbolicLink(), false, 'STAGED_LINK_FORBIDDEN')
      if (stat.isDirectory()) visit(file)
      else { assert.equal(stat.isFile(), true, 'STAGED_SPECIAL_FILE_FORBIDDEN'); files.set(path.relative(root, file), { bytes: stat.size, mode: stat.mode & 0o777, sha256: sha(fs.readFileSync(file)) }) }
    }
  }
  visit(root)
  return files
}

async function actualCase(t, missingAjv) {
  assert.equal(priorCaseFailed, false, 'PRIOR_CASE_FAILED_NO_SECOND_START')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-staged-fs-794-'))
  const app = path.join(root, 'app'), data = path.join(root, 'data'), home = path.join(root, 'home'), emptyPath = path.join(root, 'empty-path')
  let transport, client, closeConfirmed = false, primary, cleanupFailure
  let stage = 'STAGE', moduleMissing = false
  try {
    for (const directory of [app, data, home, emptyPath]) fs.mkdirSync(directory)
    noAncestorModules(app)
    const result = stageFilesystemRuntime({ source, destination: app })
    for (const item of result.packages) {
      assert.equal(lock.packages[item.path]?.version, item.version, 'STAGED_PACKAGE_MUST_MATCH_CURRENT_LOCK')
    }
    const entry = path.join(app, result.entry), node = path.join(app, 'node')
    const runtimeBytes = fs.readFileSync(process.execPath)
    fs.writeFileSync(node, runtimeBytes, { mode: 0o755 })
    assert.equal(sha(fs.readFileSync(node)), sha(runtimeBytes), 'COPIED_NODE_BYTES_DRIFT')
    const preload = path.join(app, 'test-only-network-fence.cjs')
    fs.writeFileSync(preload, fence)
    assert.equal(sha(fs.readFileSync(preload)), sha(fence), 'CHILD_FENCE_BYTES_DRIFT')
    const body = 'owned clean staged filesystem body\n', file = path.join(data, 'owned.txt')
    fs.writeFileSync(file, body)
    const validators = result.packages.filter(item => item.name === 'ajv')
    assert.equal(validators.length, 1, 'CURRENT_LOCK_EXPECTS_ONE_AJV_PACKAGE')
    const ajv = path.join(app, validators[0].path)
    assert.equal(JSON.parse(fs.readFileSync(path.join(ajv, 'package.json'), 'utf8')).name, 'ajv')
    const complete = inventory(app)
    if (missingAjv) fs.rmSync(ajv, { recursive: true })
    const frozen = inventory(app)
    const removedPrefix = path.relative(app, ajv) + path.sep
    let removedFiles = 0
    for (const [name, metadata] of complete) {
      if (missingAjv && name.startsWith(removedPrefix)) { assert.equal(frozen.has(name), false); removedFiles++ }
      else assert.deepEqual(frozen.get(name), metadata, 'ONLY_AJV_MAY_BE_REMOVED')
    }
    if (missingAjv) assert.ok(removedFiles > 0, 'REAL_AJV_FILES_MUST_BE_REMOVED')
    stage = 'CONNECT'
    t.signal.throwIfAborted()
    transport = new ObservedTransport({ command: node,
      args: ['--max-old-space-size=3072', '--permission', `--allow-fs-read=${root}`, '--no-addons', '--require', preload, entry, data],
      cwd: data, env: { HOME: home, USER: 'owned-ci', LOGNAME: 'owned-ci', PATH: emptyPath, TMPDIR: home, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, stderr: 'pipe' })
    transport.stderr.on('data', bytes => {
      transport.observation.stderrBytes += bytes.length
      const remaining = STDERR_LIMIT - transport.stderrPrefix.length
      if (remaining > 0) transport.stderrPrefix = Buffer.concat([transport.stderrPrefix, bytes.subarray(0, remaining)])
      if (transport.observation.stderrBytes > STDERR_LIMIT) { transport.observation.overflow = true; void transport.close().catch(() => {}) }
    })
    client = new Client({ name: 'owned-clean-stage-ci', version: '1.0.0' }, { capabilities: {} })
    const abort = () => { void transport.close().catch(() => {}) }
    t.signal.addEventListener('abort', abort, { once: true })
    try {
      if (missingAjv) {
        let rejected
        try { await client.connect(transport, { timeout: 20_000, signal: t.signal }) } catch (error) { rejected = error }
        assert.ok(rejected, 'MISSING_AJV_MUST_REJECT_INITIALIZATION')
        assert.notEqual(rejected?.code, ErrorCode.RequestTimeout, 'TIMEOUT_IS_NOT_A_MODULE_FAILURE')
      } else {
        await client.connect(transport, { timeout: 20_000, signal: t.signal })
        stage = 'TOOLS'
        const tools = await client.listTools(undefined, { timeout: 20_000, signal: t.signal })
        assert.equal(tools.tools.some(tool => tool.name === 'read_text_file'), true, 'REAL_READ_TEXT_TOOL_REQUIRED')
        stage = 'READ'
        const output = await client.callTool({ name: 'read_text_file', arguments: { path: file } }, undefined, { timeout: 20_000, signal: t.signal })
        assert.notEqual(output.isError, true, 'OWNED_READ_MUST_SUCCEED')
        assert.equal(output.content.some(block => block.type === 'text' && block.text === body), true, 'REAL_OWNED_BODY_REQUIRED')
      }
    } finally { t.signal.removeEventListener('abort', abort) }
    stage = 'CLOSE'
    await client.close()
    await transport.close()
    const observed = transport.observation
    assert.equal(observed.assigned && observed.exited && observed.closed && observed.stdoutEOF && observed.stderrEOF, true, 'ACTUAL_CHILD_AND_BOTH_PIPES_MUST_CLOSE')
    assert.equal(transport.pid, undefined, 'OWNER_MUST_RELEASE_ACTUAL_CHILD')
    closeConfirmed = true
    assert.equal(observed.overflow, false, 'CHILD_OUTPUT_LIMIT_EXCEEDED')
    assert.equal(t.signal.aborted, false, 'TEST_TIMEOUT_IS_NOT_ACCEPTANCE')
    if (missingAjv) {
      moduleMissing = /Error \[ERR_MODULE_NOT_FOUND\]: Cannot find package 'ajv' imported from /.test(transport.stderrPrefix.toString('utf8'))
      assert.equal(moduleMissing, true, 'REAL_AJV_IMPORT_FAILURE_REQUIRED')
      assert.equal(observed.exitCode, 1, 'REAL_MODULE_FAILURE_EXIT_REQUIRED')
      assert.equal(observed.signal, null, 'FORCED_KILL_IS_NOT_MODULE_FAILURE')
    }
    assert.deepEqual(inventory(app), frozen, 'SERVER_MUST_NOT_CHANGE_STAGED_INPUTS')
    stage = 'DONE'
  } catch {
    priorCaseFailed = true
    primary = new Error(`STAGED_FILESYSTEM_${missingAjv ? 'MISSING_AJV' : 'POSITIVE'}_${stage}_FAILED`)
  } finally {
    if (transport && !closeConfirmed) {
      try {
        await transport.close()
        const observed = transport.observation
        closeConfirmed = observed.assigned && observed.exited && observed.closed && observed.stdoutEOF && observed.stderrEOF && transport.pid === undefined
        if (!closeConfirmed) cleanupFailure = new Error('OWNED_CHILD_CLOSE_UNCONFIRMED')
      } catch { cleanupFailure = new Error('OWNED_CHILD_CLOSE_FAILED') }
    }
    if (transport && !closeConfirmed) allChildrenClosed = false
    if (!transport || closeConfirmed) {
      try { fs.rmSync(root, { recursive: true, force: true }) } catch { cleanupFailure ??= new Error('OWNED_FIXTURE_REMOVE_FAILED') }
    }
    if (transport) moduleMissing = /Error \[ERR_MODULE_NOT_FOUND\]: Cannot find package 'ajv' imported from /.test(transport.stderrPrefix.toString('utf8'))
    const observed = transport?.observation
    t.diagnostic(JSON.stringify({ schema: 1, role: missingAjv ? 'MISSING_AJV' : 'POSITIVE', stage,
      childAssigned: observed?.assigned ?? false, childClosed: observed?.closed ?? false,
      exitCode: Number.isInteger(observed?.exitCode) && observed.exitCode >= 0 && observed.exitCode <= 255 ? observed.exitCode : null,
      signal: observed?.signal == null ? 'NONE' : ['SIGKILL', 'SIGTERM'].includes(observed.signal) ? observed.signal : 'OTHER',
      stdoutEOF: observed?.stdoutEOF ?? false, stderrEOF: observed?.stderrEOF ?? false,
      stdoutBytes: Math.min(observed?.stdoutBytes ?? 0, OUTPUT_LIMIT + 65536), stderrBytes: Math.min(observed?.stderrBytes ?? 0, STDERR_LIMIT + 65536),
      overflow: observed?.overflow ?? false, moduleMissing, closeConfirmed }))
  }
  if (primary && cleanupFailure) throw new AggregateError([primary, cleanupFailure], 'STAGED_FILESYSTEM_BODY_AND_CLOSE_FAILED')
  if (cleanupFailure) { priorCaseFailed = true; throw cleanupFailure }
  if (primary) throw primary
}

test('796 clean staged official filesystem initializes, lists tools and reads an owned file', { timeout: 60_000, concurrency: false }, t => actualCase(t, false))
test('796 clean staged official filesystem rejects a removed ajv dependency and closes its child', { timeout: 60_000, concurrency: false }, t => actualCase(t, true))
