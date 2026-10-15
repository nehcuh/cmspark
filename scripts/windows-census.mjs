// #650 CI-only launcher: npm owns compilation/discovery/execution; this observes it.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { relativeFile } from './windows-census-reporter.mjs'
import { sealEvidence } from './windows-census-evidence.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const envKeys = ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'LANG', 'HOME', 'RUNNER_TRACKING_ID']
// libuv's Windows required_vars fills these from the parent even when omitted.
// Admit the same finite OS names explicitly so the helper can validate its CLI
// environment without accepting arbitrary inherited keys or logging values.
const windowsRequiredEnvKeys = ['LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN', 'USERNAME']
export function childEnvironment(input, workspace, temp) {
  const env = {}
  for (const key of process.platform === 'win32' ? [...envKeys, ...windowsRequiredEnvKeys] : envKeys) {
    const actual = Object.keys(input).find(k => k.toLowerCase() === key.toLowerCase())
    if (actual && typeof input[actual] === 'string') env[key] = input[actual]
  }
  return { ...env, CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', RUNNER_TEMP: temp, GITHUB_WORKSPACE: workspace,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(temp, 'empty.gitconfig') }
}
// Root-approved R4: isolate ambient Git sources; local credential admission stays strict.
// Validation never reads or hashes possible credential bytes.
export function prepareOwnedGitConfig(owned) {
  const file = path.join(owned, 'empty.gitconfig')
  try {
    const directory = fs.lstatSync(owned, { bigint: true })
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error('invalid directory')
    const fd = fs.openSync(file, 'wx', 0o600)
    let opened
    try { opened = fs.fstatSync(fd, { bigint: true }) } finally { fs.closeSync(fd) }
    const same = (a, b) => a.dev === b.dev && a.ino === b.ino
    const initial = fs.lstatSync(file, { bigint: true })
    if (!same(opened, initial)) throw Error('replaced input')
    const validate = () => {
      try {
        const dir = fs.lstatSync(owned, { bigint: true }), current = fs.lstatSync(file, { bigint: true })
        if (!dir.isDirectory() || dir.isSymbolicLink() || !same(dir, directory) ||
          !current.isFile() || current.isSymbolicLink() || current.nlink !== 1n || current.size !== 0n ||
          !same(current, initial) || current.mtimeNs !== initial.mtimeNs || current.ctimeNs !== initial.ctimeNs ||
          (process.platform !== 'win32' && (current.mode & 0o077n) !== 0n)) throw Error('changed input')
      } catch { throw Error('CENSUS_OWNED_GIT_CONFIG_INVALID') }
    }
    validate()
    return { file, validate }
  } catch { throw Error('CENSUS_OWNED_GIT_CONFIG_INVALID') }
}
function command(command, args, cwd, env) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  if (r.error || r.status !== 0) throw Error('CENSUS_METADATA_COMMAND_FAILED')
  return r.stdout
}
export function rejectCheckoutCredentials(text) {
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const split = line.search(/\s/)
    const key = (split < 0 ? line : line.slice(0, split)).toLowerCase()
    const value = split < 0 ? '' : line.slice(split).trim()
    if ((key.startsWith('credential.') || key.endsWith('extraheader')) && value) throw Error('CENSUS_CHECKOUT_CREDENTIALS_PRESENT')
    if (/^remote\..*\.url$/.test(key)) {
      try {
        const url = new URL(value)
        if (url.username || url.password || url.search || url.hash) throw Error('CENSUS_CHECKOUT_CREDENTIALS_PRESENT')
        if (!['https:', 'file:'].includes(url.protocol)) throw Error('CENSUS_CHECKOUT_CREDENTIALS_PRESENT')
      } catch { throw Error('CENSUS_CHECKOUT_CREDENTIALS_PRESENT') }
    }
  }
}
export function inventory(root, names) {
  return names.map(file => {
    if (!relativeFile(root, path.join(root, file))) throw Error('CENSUS_SOURCE_PATH_INVALID')
    const full = path.join(root, file)
    const stat = fs.lstatSync(full)
    return { file, bytes: stat.isSymbolicLink() ? Buffer.byteLength(fs.readlinkSync(full)) : stat.size,
      sha256: hash(stat.isSymbolicLink() ? fs.readlinkSync(full) : fs.readFileSync(full)) }
  })
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.isFile()) out.push(p)
  }
  return out
}
export function discover(companion) {
  return walk(path.join(companion, '.test-dist', 'tests')).filter(f => f.endsWith('.test.js')).map(file => ({
    file: relativeFile(companion, fs.realpathSync(file)),
    source: relativeFile(companion, file).replace(/^\.test-dist\//, '').replace(/\.js$/, '.ts'),
    sha256: hash(fs.readFileSync(file)), excluded: path.basename(file).startsWith('_'),
    stage: path.basename(file) === 'settings-web.test.js' ? 'settings' : 'main',
  }))
}
export function scheduledBatches(companion, discovery, execPath = process.execPath) {
  const preload = path.join(companion, 'scripts', 'test-data-dir.cjs')
  const grouped = []
  for (const stage of ['main', 'settings']) {
    const fixed = ['--require', preload, '--test', ...(stage === 'settings' && Number(process.versions.node.split('.')[0]) >= 22 ? ['--experimental-test-isolation=none'] : [])]
    let batch = []
    for (const row of discovery.filter(x => !x.excluded && x.stage === stage)) {
      const chars = execPath.length + 2 + fixed.reduce((n, x) => n + x.length + 1, 0) + [...batch, row.file].reduce((n, x) => n + path.join(companion, x).length + 1, 0)
      if (batch.length && chars > 32000) { grouped.push({ stage, files: batch }); batch = [] }
      batch.push(row.file)
    }
    if (batch.length) grouped.push({ stage, files: batch })
  }
  return grouped
}
export async function capture(commandPath, args, { cwd, env, raw, name }, io = fsp) {
  const targets = ['stdout', 'stderr'].map(kind => ({ kind, file: path.join(raw, name + '.' + kind), handle: null, observed_bytes: 0, persisted_bytes: 0, gap_bytes: 0, error: false }))
  // Admit no process until both exclusive destinations exist. Never read/overwrite an old capture.
  try {
    for (const target of targets) target.handle = await io.open(target.file, 'wx', 0o600)
  } catch {
    await Promise.all(targets.map(t => t.handle?.close().catch(() => {})))
    return { name, code: null, signal: null, spawn_error: null, capture_error: true, files: [] }
  }
  const child = spawn(commandPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let spawnError = null
  const close = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal: ['SIGTERM', 'SIGKILL', 'SIGABRT'].includes(signal) ? signal : signal ? 'UNCLASSIFIED' : null })))
  child.on('error', error => { spawnError = ['ENOENT', 'EACCES', 'EPERM'].includes(error.code) ? error.code : 'UNCLASSIFIED' })
  async function consume(stream, target) {
    try {
      for await (const chunk of stream) {
        target.observed_bytes += chunk.length
        if (target.error) { target.gap_bytes += chunk.length; continue }
        try { await target.handle.writeFile(chunk); target.persisted_bytes += chunk.length }
        catch { target.error = true; target.gap_bytes += chunk.length }
      }
    } catch { target.error = true }
    finally { try { await target.handle.close() } catch { target.error = true } }
  }
  // A failed sink never destroys an inherited pipe or kills npm alone. Latch the
  // loss, drain both pipes to EOF, and wait for the original process to close.
  // Original test/job deadlines still apply; lost bytes can never count as full raw.
  const drained = Promise.all([consume(child.stdout, targets[0]), consume(child.stderr, targets[1])])
  const exit = await close
  await drained
  const files = []
  for (const target of targets) {
    const h = createHash('sha256'); let bytes = 0
    for await (const chunk of fs.createReadStream(target.file)) { h.update(chunk); bytes += chunk.length }
    if (bytes !== target.observed_bytes) target.error = true
    files.push({ kind: target.kind, bytes, observed_bytes: target.observed_bytes, persisted_bytes: bytes, gap_bytes: Math.max(0, target.observed_bytes - bytes), complete: !target.error, sha256: h.digest('hex') })
  }
  return { name, pid: child.pid ?? null, ...exit, spawn_error: spawnError, capture_error: targets.some(t => t.error), files }
}
export function stageSucceeded(stage) { return stage.code === 0 && !stage.signal && !stage.spawn_error && !stage.capture_error }
// A start is only STARTED_UNSETTLED, never evidence of spawn or closed raw.
// Publish no child data: these eight fixed transitions locate an incomplete run.
export function createStageProgress(write, emit = line => fs.writeFileSync(1, line)) {
  const names = ['install', 'build', 'stage', 'tests']
  let sequence = 0, pending = null, failed = false
  function record(name, state, stage) {
    if (failed) throw Error('CENSUS_PROGRESS_WRITE_FAILED')
    if (sequence >= 8 || name !== names[Math.floor(sequence / 2)] ||
      (state === 'start' ? pending !== null || sequence % 2 !== 0 :
        state !== 'end' || pending !== name || sequence % 2 !== 1 || stage?.name !== name)) {
      throw Error('CENSUS_PROGRESS_INVALID')
    }
    const value = { version: 1, sequence, stage: name, state,
      ...(state === 'end' ? { outcome: stageSucceeded(stage) ? 'PASS' : 'FAIL' } : {}) }
    try {
      write(`progress-${name}-${state}.json`, value)
      emit(`CENSUS_650_PROGRESS ${JSON.stringify(value)}\n`)
    } catch { failed = true; throw Error('CENSUS_PROGRESS_WRITE_FAILED') }
    pending = state === 'start' ? name : null
    sequence++
  }
  return { start: name => record(name, 'start'), end: stage => record(stage?.name, 'end', stage) }
}
export async function captureStage(commandPath, args, options, progress, io = fsp) {
  progress.start(options.name)
  const stage = await capture(commandPath, args, options, io)
  progress.end(stage)
  return stage
}
export async function tapBlocks(file) {
  const blocks = []; let current = null
  for await (const line of createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
    if (line === 'TAP version 13') { current = {}; blocks.push(current) }
    const m = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line)
    if (current && m) current[m[1]] = Number(m[2])
  }
  return blocks
}
export async function reconcile({ companion, receipts, rawFile, discovery, execution }) {
  if (execution.capture_error || execution.spawn_error || execution.signal) throw Error('CENSUS_CAPTURE_INCOMPLETE')
  const batches = scheduledBatches(companion, discovery), docs = []
  for (const file of fs.readdirSync(receipts).sort()) {
    if (!/^events-\d+-[0-9a-f-]{36}\.jsonl$/.test(file)) throw Error('CENSUS_RECEIPT_NAME_INVALID')
    const rows = []
    for await (const line of createInterface({ input: fs.createReadStream(path.join(receipts, file)), crlfDelay: Infinity })) rows.push(JSON.parse(line))
    if (rows[0]?.kind !== 'begin' || rows.at(-1)?.kind !== 'end') throw Error('CENSUS_RECEIPT_INCOMPLETE')
    const events = rows.slice(1, -1)
    if (rows.at(-1).events !== events.length || events.some((r, i) => r.kind !== 'event' || r.seq !== i)) throw Error('CENSUS_EVENT_SEQUENCE_INVALID')
    docs.push({ begin: rows[0], events, receipt: file })
  }
  const groups = new Map()
  for (const doc of docs) {
    if (doc.begin.outside_argv || !Array.isArray(doc.begin.test_argv)) continue
    const index = batches.findIndex(b => JSON.stringify(b.files) === JSON.stringify(doc.begin.test_argv))
    if (index < 0) continue // Actual auxiliary Node runs are not canonical discovery batches.
    const group = groups.get(doc.begin.ppid) ?? []; group.push({ ...doc, index }); groups.set(doc.begin.ppid, group)
  }
  const candidates = [...groups.values()].filter(g => g.some(d => d.index === 0))
  if (candidates.length !== 1) throw Error('CENSUS_CANONICAL_PARENT_UNRESOLVED')
  const selected = candidates[0].sort((a, b) => a.index - b.index)
  if (new Set(selected.map(d => d.index)).size !== selected.length) throw Error('CENSUS_DUPLICATE_BATCH')
  const blocks = await tapBlocks(rawFile)
  if (blocks.length !== selected.length) throw Error('CENSUS_TAP_BLOCK_COUNT_MISMATCH')
  const summaries = [], files = [], skips = [], cases = []
  const knownFiles = new Set(walk(path.join(companion, '.test-dist')).map(f => relativeFile(companion, f)))
  const safeHash = value => value === null || value === undefined ? null : /^[a-f0-9]{64}$/.test(value) ? value : (() => { throw Error('CENSUS_METADATA_INVALID') })()
  const safeNumber = value => value === null || value === undefined ? null : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : (() => { throw Error('CENSUS_METADATA_INVALID') })()
  let mainFailed = false
  for (const [position, doc] of selected.entries()) {
    const batch = batches[doc.index]
    if (doc.index !== position) throw Error('CENSUS_MISSING_BATCH')
    const totals = doc.events.filter(e => e.type === 'test:summary' && e.file === null && e.counts)
    if (totals.length !== 1) throw Error('CENSUS_SUMMARY_MISSING')
    const counts = Object.fromEntries(['cancelled', 'failed', 'passed', 'skipped', 'suites', 'tests', 'todo', 'topLevel'].map(key => [key, safeNumber(totals[0].counts[key])]))
    if (typeof totals[0].success !== 'boolean') throw Error('CENSUS_METADATA_INVALID')
    for (const [tapKey, nodeKey] of Object.entries({ tests: 'tests', suites: 'suites', pass: 'passed', fail: 'failed', cancelled: 'cancelled', skipped: 'skipped', todo: 'todo' })) {
      if (blocks[position][tapKey] !== counts[nodeKey]) throw Error('CENSUS_TAP_SUMMARY_MISMATCH')
    }
    if (batch.stage === 'settings' && mainFailed) throw Error('CENSUS_SETTINGS_AFTER_FAILURE')
    mainFailed ||= batch.stage === 'main' && (counts.failed > 0 || counts.cancelled > 0 || totals[0].success === false)
    summaries.push({ stage: batch.stage, batch: doc.index, counts, success: totals[0].success ?? null, receipt: doc.receipt })
    for (const file of batch.files) {
      const evidence = doc.events.filter(e => e.file === file && ['test:summary', 'test:pass', 'test:fail'].includes(e.type))
      if (!evidence.length) throw Error('CENSUS_FILE_UNACCOUNTED')
      files.push({ file, stage: batch.stage, state: evidence.some(e => e.type === 'test:fail' && !e.todo && !e.skip) ? 'failed' : 'emitted_completed', source_evidence: evidence.length })
    }
    for (const event of doc.events.filter(e => ['test:pass', 'test:fail'].includes(e.type))) {
      if (!event.file || !knownFiles.has(event.file)) throw Error('CENSUS_CASE_SOURCE_UNRESOLVED')
      if ([event.skip, event.todo, event.suite].some(v => typeof v !== 'boolean')) throw Error('CENSUS_METADATA_INVALID')
      cases.push({ file: event.file, line: safeNumber(event.line), column: safeNumber(event.column), nesting: safeNumber(event.nesting), testNumber: safeNumber(event.testNumber), duration_ms: safeNumber(event.duration_ms), name_hash: safeHash(event.name_hash), outcome: event.skip ? 'SKIP' : event.todo ? 'TODO' : event.type === 'test:fail' ? 'FAIL' : 'PASS', suite: event.suite })
    }
    for (const event of doc.events.filter(e => ['test:pass', 'test:fail'].includes(e.type) && (e.skip || e.todo))) {
      skips.push({ file: event.file, line: event.line, column: event.column, name_hash: event.name_hash, skip: event.skip, todo: event.todo, reason_hash: safeHash(event.skip_reason_hash ?? event.todo_reason_hash), oracle: 'UNCLASSIFIED_SOURCE_GUARD' })
    }
    if (doc.events.some(e => e.outside_source && ['test:pass', 'test:fail'].includes(e.type))) throw Error('CENSUS_EVENT_SOURCE_OUTSIDE')
  }
  const missing = batches.slice(selected.length)
  if (missing.some(b => b.stage !== 'settings') || (missing.length && !mainFailed) || (execution.code === 0 && mainFailed)) throw Error('CENSUS_EXECUTION_INCOMPLETE')
  for (const batch of missing) for (const file of batch.files) files.push({ file, stage: batch.stage, state: 'not_run_because_main_failed' })
  return { complete: missing.length === 0, execution_complete: true, canonical_batches: summaries, files, skips, cases,
    auxiliary_reporting_children: docs.length - selected.length, tests_exit: execution.code,
    outcome: execution.code === 0 && !mainFailed && !missing.length ? 'PASS' : 'FAIL' }
}
function safeError(error) {
  return typeof error?.message === 'string' && /^CENSUS_[A-Z_]+$/.test(error.message) ? error.message : 'CENSUS_UNCLASSIFIED_FAILURE'
}
export async function main() {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Windows' || process.argv.length !== 2) throw Error('CENSUS_OWNED_WINDOWS_CI_REQUIRED')
  const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
  const companion = path.join(root, 'companion')
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-census-650-'))
  fs.chmodSync(owned, 0o700)
  const raw = path.join(owned, 'raw'), receipts = path.join(owned, 'receipts'), publicDir = path.join(owned, 'public')
  for (const dir of [raw, receipts, publicDir]) fs.mkdirSync(dir, { mode: 0o700 })
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `public_dir=${publicDir}\n`)
  const write = (file, data) => fs.writeFileSync(path.join(publicDir, file), JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const progress = createStageProgress(write)
  const env = childEnvironment(process.env, root, owned), stages = []
  const namespace = randomUUID()
  let evidenceIdentity = null
  let result = { outcome: 'INCOMPLETE', error_code: null, stages, raw_publish: 'RESTRICTED_LOCAL_ONLY_UNREVIEWED', raw_durability: 'HOSTED_EPHEMERAL_NOT_GUARANTEED' }
  try {
    const gitConfig = prepareOwnedGitConfig(owned)
    gitConfig.validate()
    const credentials = spawnSync('git', ['config', '--get-regexp', '^(http\\..*extraheader|http\\.extraheader|credential\\..*|remote\\..*\\.url)$'], { cwd: root, env, encoding: 'utf8', windowsHide: true })
    if (credentials.error || ![0, 1].includes(credentials.status)) throw Error('CENSUS_CHECKOUT_CONFIG_FAILED')
    gitConfig.validate()
    rejectCheckoutCredentials(credentials.stdout)
    const names = command('git', ['ls-files', '-z'], root, env).split('\0').filter(Boolean)
    const before = inventory(root, names)
    write('source-before.json', before)
    const npmPath = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (!fs.existsSync(npmPath)) throw Error('CENSUS_NPM_CLI_MISSING')
    const inputs = ['package-lock.json', 'companion/package-lock.json', 'chrome-extension/package-lock.json', 'companion/package.json', 'chrome-extension/package.json', 'companion/scripts/run-tests.mjs', 'companion/scripts/test-data-dir.cjs', 'companion/tsconfig.test.json', 'scripts/windows-census-install.mjs']
    const nodeVersion = process.version, npmVersion = command(process.execPath, [npmPath, '--version'], root, env).trim(), gitVersion = command('git', ['--version'], root, env).trim()
    if (!/^\d+\.\d+\.\d+$/.test(npmVersion) || !/^git version [\d.a-zA-Z.() -]+$/.test(gitVersion)) throw Error('CENSUS_TOOL_VERSION_INVALID')
    evidenceIdentity = { head: command('git', ['rev-parse', 'HEAD'], root, env).trim(), tree: command('git', ['rev-parse', 'HEAD^{tree}'], root, env).trim(), run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, namespace }
    write('identity.json', { ...evidenceIdentity, node: nodeVersion, npm: npmVersion, git: gitVersion, platform: process.platform, arch: process.arch, os_release: os.release(), started_utc: new Date().toISOString(), allowed_env_keys: Object.keys(env).sort(), inputs: inventory(root, inputs) })
    for (const [name, args] of [['install', ['ci']], ['build', ['run', 'build']], ['stage', ['run', 'stage:win-scripts']], ['tests', ['test']]]) {
      gitConfig.validate()
      const childEnv = name === 'tests' ? { ...env, CMSPARK_CENSUS_DIR: receipts, NODE_OPTIONS: `--test-reporter=${JSON.stringify(pathToFileURL(path.join(root, 'scripts', 'windows-census-reporter.mjs')).href)}` } : env
      const invocation = name === 'install' ? [path.join(root, 'scripts', 'windows-census-install.mjs')] : [npmPath, ...args]
      const stage = await captureStage(process.execPath, invocation, { cwd: companion, env: childEnv, raw, name }, progress)
      stages.push({ ...stage, argv: name === 'install' ? ['node', '../scripts/windows-census-install.mjs'] : ['node', 'npm-cli.js', ...args], cwd: 'companion' })
      gitConfig.validate()
      if (!stageSucceeded(stage)) { result = { ...result, outcome: 'FAIL', error_code: 'CENSUS_STAGE_FAILED' }; break }
    }
    const tests = stages.find(s => s.name === 'tests')
    const discovery = discover(companion)
    write('discovery.json', discovery)
    if (tests && !tests.capture_error && !tests.spawn_error) {
      const accounting = await reconcile({ companion, receipts, rawFile: path.join(raw, 'tests.stdout'), discovery, execution: tests })
      write('accounting.json', accounting)
      result = { ...result, outcome: accounting.outcome, complete: accounting.complete }
      // Only reconstructed finite projections are public; original receipts/TAP stay private.
    }
    const after = inventory(root, names)
    write('source-after.json', after)
    if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('CENSUS_SOURCE_DRIFT')
  } catch (error) { result = { ...result, outcome: 'INCOMPLETE', error_code: safeError(error) } }
  try {
    if (!evidenceIdentity) throw Error('CENSUS_EVIDENCE_IDENTITY_UNAVAILABLE')
    const evidence = await sealEvidence({ owned, publicDir, identity: evidenceIdentity, result })
    result = { ...result, evidence, outcome: evidence.status.outcome, raw_publish: 'SEALED_CIPHERTEXT_ONLY', raw_durability: 'UPLOAD_AND_ROOT_RECOVERY_PENDING' }
  } catch (error) { result = { ...result, outcome: 'INCOMPLETE', evidence_error: safeError(error) } }
  write('result.json', result)
  console.log(`CENSUS_650 outcome=${result.outcome} stages=${stages.length} raw=plaintext_not_uploaded`)
  return result.outcome === 'PASS' ? 0 : 1
}
let directEntry = false
try { directEntry = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) } catch { /* import-only/non-file argv must stay inert */ }
if (directEntry) {
  main().then(code => { process.exitCode = code }, error => { console.error(safeError(error)); process.exitCode = 1 })
}
