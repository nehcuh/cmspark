// One explicit post-timeout experiment, never a replacement for canonical MCP20.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const sha = value => createHash('sha256').update(value).digest('hex')
const normalized = value => value.replace(/\r\n/g, '\n')
const sourceHash = '113c2a7302f2a00af52fdc3299f33bccc1409201f95ba60c08333eb8c2c6bbd8'
const compiledHash = '232cd51b43aac2016e72cbcac768ae4c642f2cc9727d452a9c9df87a1e9adf9e'
const deadline = '    const snapshotDeadline825 = Date.now() + 20000;'
const cleanup = '            manager.rejectAll("disconnect");'
const signal = '\n    const originalSignal826 = t.signal;'
const hook = `            try {
                if (originalSignal826.aborted && Date.now() >= snapshotDeadline825 && child && !settled && snapshot825?.binary) {
                    const result826 = await require(node_path_1.default.resolve('scripts/mcp-stack-capture-826.cjs')).collectMcpStacks826({
                        binary: snapshot825.binary, root: dir, parentPid: process.pid,
                        createdAfterMs: snapshotDeadline825 - 20000, createdBeforeMs: Date.now(),
                        outputRoot: process.env.CMSPARK_MCP_STACK_OUTPUT_826,
                    });
                    node_fs_1.default.writeFileSync(node_path_1.default.join(process.env.CMSPARK_MCP_STACK_OUTPUT_826, 'capture.json'), JSON.stringify(result826));
                }
            } catch { /* This experiment cannot replace the original failure or cleanup. */ }
`

export function deriveMcpStackProbe826(source, compiled) {
  if (sha(normalized(source)) !== sourceHash || sha(normalized(compiled)) !== compiledHash) throw Error('MCP826_STACK_SOURCE_DRIFT')
  const eol = compiled.includes('\r\n') ? '\r\n' : '\n'
  const insertSignal = signal.replace(/\n/g, eol), insertHook = hook.replace(/\n/g, eol)
  if (compiled.split(deadline).length !== 2 || compiled.split(cleanup).length !== 2) throw Error('MCP826_STACK_BOUNDARY')
  const derived = compiled.replace(deadline, deadline + insertSignal).replace(cleanup, insertHook + cleanup)
  if (derived.replace(insertHook, '').replace(insertSignal, '') !== compiled) throw Error('MCP826_STACK_INVERSE')
  return derived
}

export function withTemporaryStackProbe826(canonical, derived, execute) {
  const file = path.join(path.dirname(canonical), 'desktop-native-mcp-stack-826.test.js')
  const fd = fs.openSync(file, 'wx', 0o600)
  try { fs.writeFileSync(fd, derived); fs.closeSync(fd) } catch (error) {
    try { fs.closeSync(fd) } catch {}
    fs.unlinkSync(file); throw error
  }
  try { return execute(file) } finally { fs.unlinkSync(file) }
}

export function classifyMcpStackOutcome826(result) {
  if (result.error || result.signal || ![0, 1].includes(result.status)) return 'INCOMPLETE'
  const out = String(result.stdout)
  if (result.status === 0 && /^# pass 1\r?$/m.test(out) && /^# fail 0\r?$/m.test(out) && /^# cancelled 0\r?$/m.test(out)) return 'PASS'
  if (result.status === 1 && /failureType: 'testTimeoutFailure'/.test(out) && /test timed out after 20000ms/.test(out)) return 'TIMEOUT'
  return 'FAIL'
}

export async function runMcpStackProbe826() {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.CMSPARK_MCP_STACK_PROBE_826 !== '1') throw Error('MCP826_STACK_EXPLICIT_WINDOWS_CI_REQUIRED')
  const sourceFile = path.join(root, 'tests/desktop-native-mcp-476.test.ts')
  const canonical = path.join(root, '.test-dist/tests/desktop-native-mcp-476.test.js')
  const source = fs.readFileSync(sourceFile), compiled = fs.readFileSync(canonical)
  const derived = deriveMcpStackProbe826(source.toString(), compiled.toString())
  const outputRoot = path.join(process.env.RUNNER_TEMP, 'mcp-stack-probe-826')
  fs.mkdirSync(outputRoot, { mode: 0o700 })
  const write = (name, value) => fs.writeFileSync(path.join(outputRoot, name + '.json'), JSON.stringify(value), { flag: 'wx', mode: 0o600 })
  const { qualifyCdb826 } = require('./mcp-stack-capture-826.cjs')
  const qualification = await qualifyCdb826({ outputRoot })
  write('qualification', qualification)
  if (qualification.status !== 'OBSERVED') {
    write('run', { schema: 1, kind: 'NON_ACCEPTANCE', originalOutcome: 'NOT_RUN', qualification: qualification.status })
    return 1
  }
  console.log('MCP_STACK_PROBE_826 NON_ACCEPTANCE originalMs=20000 snapshotMs=20000 toolTimeoutsMs=3000+6000+6000 actualToolCloseRequired=true')
  let result
  try {
    result = withTemporaryStackProbe826(canonical, derived, file => spawnSync(process.execPath, [path.join(root, 'scripts/run-tests.mjs'), file], {
      cwd: root, env: { ...process.env, CMSPARK_MCP_STACK_OUTPUT_826: outputRoot }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    }))
    // Only the unchanged test's usual receipts/TAP; CDB output never reaches these streams.
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    write('run', {
      schema: 1, kind: 'NON_ACCEPTANCE', originalMs: 20000, snapshotMs: 20000,
      sourceSha256: sha(source), compiledSha256: sha(compiled), derivedSha256: sha(derived),
      originalOutcome: classifyMcpStackOutcome826(result), exit: Number.isInteger(result.status) ? result.status : null,
    })
  } finally {
    if (!fs.readFileSync(sourceFile).equals(source) || !fs.readFileSync(canonical).equals(compiled)) throw Error('MCP826_STACK_CANONICAL_CHANGED')
  }
  // A stack capture never changes the actual test's exit code into success.
  return result.error || result.signal ? 1 : result.status ?? 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMcpStackProbe826().then(code => { process.exitCode = code }, () => {
    console.error('MCP_STACK_PROBE_826 INCOMPLETE'); process.exitCode = 1
  })
}
