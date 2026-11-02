// One explicit counterfactual measurement. Never a replacement for MCP's 20s gate.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceHash = '113c2a7302f2a00af52fdc3299f33bccc1409201f95ba60c08333eb8c2c6bbd8'
const sha = value => createHash('sha256').update(value).digest('hex')
const registration = '(0, node_test_1.default)("#476 actual native MCP form + OS-only confirmation approves update/add and denies update", { skip: !["darwin", "win32"].includes(process.platform), timeout: 20000 }, async (t) => {'
const changed = registration.replace('timeout: 20000', 'timeout: 60000')

export function deriveMcpLatencyProbe826(source, compiled) {
  if (sha(source.replace(/\r\n/g, '\n')) !== sourceHash || compiled.split(registration).length !== 2 || compiled.includes(changed)) throw Error('MCP826_PROBE_SOURCE_DRIFT')
  if (compiled.split('const snapshotDeadline825 = Date.now() + 20000;').length !== 2) throw Error('MCP826_PROBE_SNAPSHOT_DRIFT')
  const derived = compiled.replace(registration, changed)
  if (derived.replace(changed, registration) !== compiled) throw Error('MCP826_PROBE_INVERSE')
  return derived
}

export function withTemporaryProbe826(canonical, derived, execute) {
  const file = path.join(path.dirname(canonical), 'desktop-native-mcp-latency-826.test.js')
  // A pre-existing file is never adopted or deleted.
  const fd = fs.openSync(file, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, derived)
    fs.closeSync(fd)
  } catch (error) {
    try { fs.closeSync(fd) } catch {}
    fs.unlinkSync(file)
    throw error
  }
  try { return execute(file) } finally { fs.unlinkSync(file) }
}

export function runMcpLatencyProbe826() {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.CMSPARK_MCP_LATENCY_PROBE_826 !== '1') throw Error('MCP826_PROBE_EXPLICIT_WINDOWS_CI_REQUIRED')
  const sourceFile = path.join(root, 'tests/desktop-native-mcp-476.test.ts')
  const canonical = path.join(root, '.test-dist/tests/desktop-native-mcp-476.test.js')
  const source = fs.readFileSync(sourceFile, 'utf8'), compiled = fs.readFileSync(canonical, 'utf8')
  const sourceBytes = fs.readFileSync(sourceFile), compiledBytes = fs.readFileSync(canonical)
  const derived = deriveMcpLatencyProbe826(source, compiled)
  console.log('MCP_LATENCY_PROBE_826 NON_ACCEPTANCE registrationMs=60000 canonicalMs=20000 snapshotDeadlineMs=20000')
  let status = 1
  try {
    status = withTemporaryProbe826(canonical, derived, file => {
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-tests.mjs'), file], { cwd: root, env: process.env, stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.signal) throw Error('MCP826_PROBE_RUNNER_SIGNAL_' + result.signal)
      return result.status ?? 1
    })
  } finally {
    if (!fs.readFileSync(sourceFile).equals(sourceBytes) || !fs.readFileSync(canonical).equals(compiledBytes)) throw Error('MCP826_PROBE_CANONICAL_CHANGED')
  }
  return status
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runMcpLatencyProbe826()
