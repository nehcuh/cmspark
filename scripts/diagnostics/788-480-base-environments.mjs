// Diagnostic only. One exact #480 test per fresh Node process; no native
// source changes, mocked behavior, relaxed assertions, or longer case timeout.
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const emit = value => { try { const bytes = Buffer.from(value + '\n', 'utf8'); if (fs.writeSync(1, bytes) === bytes.length) return true } catch {} process.exitCode = 1; return false }
async function main() {
if (process.platform !== 'win32' || process.version !== 'v22.23.4' || process.argv.length !== 3) throw Error('PROBE_SCOPE_REFUSED')
const root = path.resolve(process.argv[2]), companion = path.join(root, 'companion')
const source = path.join(companion, 'tests/desktop-native-windows-480.test.ts')
const test = path.join(companion, '.test-dist/tests/desktop-native-windows-480.test.js')
const preload = path.join(companion, 'scripts/test-data-dir.cjs')
const admittedSourceHashes = new Set(['18407d5b952aa97b9ea837decbfefa71ea0a5125c2dfe49263115d586abf922c', 'fd592391311a8e0ae796cb8b1e2bc7153a000c76ebd5dfe783591a80d5f5195a'])
if (!admittedSourceHashes.has(createHash('sha256').update(fs.readFileSync(source)).digest('hex')) || !fs.statSync(test).isFile()) throw Error('SOURCE_OR_COMPILED_TEST_REFUSED')
const names = [
  "Windows real SYNCHRONIZE-only process handle API rejects extra rights, other objects and dead handles",
  "real Windows binding noninherited bootstrap and minimal parent handle authenticate native WebView2 and metadata",
  "actual Windows native parser refuses boolean and decoded duplicate fields before parent/WS use",
  "actual Windows native parser rejects invalid URL types and endpoints before ACK",
  "actual Windows launcher forwards OS environment only, excluding provider-like and WebView2 overrides",
  "actual Windows C bootstrap helper controlled syscall refusals preserve framing and one deadline",
  "actual Windows injected peer mismatch writes and duplicates zero then reaps its owned child",
  "actual Windows inheritance: sentinel checker positive and exact production sibling protected endpoints absent",
  "actual win32 native parent watcher releases owned lock only after issuer death",
  "actual Windows acceptance visual: real owned window/engine/lifecycle",
  "actual Windows acceptance hostile: real owned window/engine/lifecycle",
  "actual Windows acceptance reconnect: real owned window/engine/lifecycle",
  "actual Windows acceptance relaunch: real owned window/engine/lifecycle",
  "actual Windows acceptance inheritance: real owned window/engine/lifecycle"
]
if (names.length !== 14 || new Set(names).size !== 14) throw Error('CASE_LIST_REFUSED')
const { childEnvironment } = await import(pathToFileURL(path.join(root, 'scripts/windows-census.mjs')).href)
const filtered = childEnvironment(process.env, root, process.env.RUNNER_TEMP)
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function summary(text, key) {
  const values = [...text.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))].map(m => Number(m[1]))
  return values.length === 1 ? values[0] : null
}
outer: for (const [mode, baseEnv] of [['targeted', process.env], ['census-base', filtered]]) {
  for (let index = 0; index < names.length; index++) {
    const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-test-run-'))
    const env = { ...baseEnv, CMSPARK_TEST_RUN_DIR: owned }
    const args = ['--require', preload, '--test', '--test-concurrency=1', `--test-name-pattern=^${escapeRegex(names[index])}$`, test]
    // Capture in memory only. Never publish the test output, file paths, errors,
    // identity/bootstrap payloads, screenshots or stdout/stderr bytes.
    const result = spawnSync(process.execPath, args, { cwd: companion, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true })
    const counts = { tests: summary(result.stdout || '', 'tests'), pass: summary(result.stdout || '', 'pass'), fail: summary(result.stdout || '', 'fail'), skipped: summary(result.stdout || '', 'skipped') }
    const ok = !result.error && result.status === 0 && !result.signal && counts.tests === 1 && counts.pass === 1 && counts.fail === 0 && counts.skipped === 0 && (result.stdout || '').split(/\r?\n/).filter(line => line === `# Subtest: ${names[index]}`).length === 1
    const emitted = emit('DIAGNOSTIC_788_CASE ' + JSON.stringify({ mode, caseIndex: index + 1, outcome: ok ? 'PASS' : 'FAIL_OR_INCOMPLETE', exitCode: Number.isInteger(result.status) ? result.status : null, signal: result.signal ? 'SIGNAL' : null, counts }))
    if (!ok || !emitted) { process.exitCode = 1; break outer }
    // Retain temporary roots for the lifetime of this ephemeral GitHub runner;
    // no recursive deletion of a possibly replaced path is attempted.
  }
}

}
main().catch(() => { emit('DIAGNOSTIC_788_INCOMPLETE'); process.exitCode = 1 })
