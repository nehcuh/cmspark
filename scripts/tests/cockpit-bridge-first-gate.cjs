// GHA Windows only. Setup precedes (and never extends) the controller's 45s lease.
'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process')
const supply = require('./cockpit-bridge-browser-supply.cjs')
const firstEvidence = require('./cockpit-bridge-first-evidence.cjs')
assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64')
assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_OS, 'Windows')
// A pin is mandatory before network, npm, registration or any child process.
const pin = supply.selectPin(require('./cockpit-bridge-browser-admission.cjs'))
const repo = path.resolve(__dirname, '../..'), root = process.env.CMSPARK_TEST_RUN_DIR
function physical(input, directory) {
  assert.ok(typeof input === 'string' && path.isAbsolute(input))
  const stat = fs.lstatSync(input); assert.ok(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()))
  assert.equal(fs.realpathSync.native(input).toLowerCase(), path.resolve(input).toLowerCase())
  return fs.realpathSync.native(input)
}
physical(root, true); assert.ok(path.basename(root).startsWith('cmspark-test-run-'))
const compiled = physical(path.join(repo, 'companion/.test-dist/src'), true)
const childEnv = require('./cockpit-bridge-child-env.cjs')(process.env, {
  root, data: physical(process.env.CMSPARK_DATA_DIR, true), temp: physical(process.env.TEMP, true), compiled,
})
const nodeDirectory = path.dirname(physical(process.execPath, false))
const npm = physical(path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'), false)
const powershell = physical(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), false)
const preload = physical(path.join(repo, 'companion/scripts/test-data-dir.cjs'), false)
const raw = path.join(root, 'setup-raw'); fs.mkdirSync(raw)
const config = path.join(root, 'npm-config'); fs.mkdirSync(config)
const userconfig = path.join(config, 'user.npmrc'), globalconfig = path.join(config, 'global.npmrc'), cache = path.join(config, 'cache')
fs.writeFileSync(userconfig, '', { flag: 'wx' }); fs.writeFileSync(globalconfig, '', { flag: 'wx' }); fs.mkdirSync(cache)
const npmEnv = { ...childEnv, PATH: nodeDirectory + path.delimiter + childEnv.PATH,
  npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig,
  npm_config_cache: cache, npm_config_registry: 'https://registry.npmjs.org/' }
let sequence = 0, stage = 'supply'
// Failure evidence is observation only: no raw text, paths, errors or authority.
const STEP_LABELS = new Set(['npm-ci', 'extension-build', 'extension-test-compile', 'registration-framing', 'document-receipt', 'first-identity'])
const GATE_STAGES = new Set(['supply', 'extension-build', 'registration-framing', 'document-receipt', 'first-identity'])
const REGISTRATION_REASONS = new Set(['OTHER', 'COCKPIT_BRIDGE_REMOTE_ONLY', 'COCKPIT_BRIDGE_OWNED_ROOT_REQUIRED', 'COCKPIT_BRIDGE_FIXED_KEY_OCCUPIED', 'COCKPIT_BRIDGE_REGISTRATION_ASSERT', 'COCKPIT_BRIDGE_BUILD_PLATFORM', 'COCKPIT_BRIDGE_BUILD_PATH', 'COCKPIT_BRIDGE_BUILD_SOURCE', 'COCKPIT_BRIDGE_BUILD_COMPILER', 'COCKPIT_BRIDGE_BUILD_OUTPUT_EXISTS', 'COCKPIT_BRIDGE_BUILD_FAILED', 'COCKPIT_BRIDGE_EXACT_ID_REQUIRED', 'COCKPIT_BRIDGE_REGISTRATION_PLATFORM', 'COCKPIT_BRIDGE_REGISTRATION_ROOT', 'COCKPIT_BRIDGE_REGISTRATION_FILE', 'COCKPIT_BRIDGE_REGISTRATION_CONFLICT', 'COCKPIT_BRIDGE_REGISTRATION_NOT_OWNED', 'COCKPIT_BRIDGE_REGISTRATION_BINARY', 'COCKPIT_BRIDGE_REGISTRATION_EXPLICIT_UNBIND_REQUIRED', 'COCKPIT_BRIDGE_REGISTRATION_FAILED', 'COCKPIT_BRIDGE_REGISTRY_FIXTURE_OWNERSHIP_CHANGED', 'COCKPIT_BRIDGE_CHILD_NOT_CLOSED'])
let lastStep, firstFailure
function boundedEvidence(file) {
  let fd
  try {
    const before = fs.lstatSync(file)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !Number.isSafeInteger(before.size) || before.size < 0 || before.size > 2147483647) return { bytes: null, text: null }
    if (before.size > 65536) return { bytes: before.size, text: null }
    fd = fs.openSync(file, 'r')
    const opened = fs.fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || !opened.isFile() || opened.nlink !== 1) return { bytes: null, text: null }
    const buffer = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < buffer.length) {
      const read = fs.readSync(fd, buffer, length, buffer.length - length, length)
      if (read === 0) break
      length += read
    }
    const after = fs.lstatSync(file), end = fs.fstatSync(fd)
    if (length !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.nlink !== 1 || !after.isFile() || after.isSymbolicLink() || end.dev !== before.dev || end.ino !== before.ino || end.size !== before.size || end.mtimeMs !== before.mtimeMs || end.nlink !== 1 || !end.isFile()) return { bytes: null, text: null }
    const text = buffer.subarray(0, length).toString('utf8')
    return { bytes: before.size, text }
  } catch { return { bytes: null, text: null } }
  finally { if (fd !== undefined) try { fs.closeSync(fd) } catch { } }
}
function registrationEvidence(text) {
  if (typeof text !== 'string' || text.length > 65536) return null
  const prefix = 'COCKPIT_BRIDGE_REGISTRATION_FAILURE ', rows = text.split(/\r?\n/).filter(line => line.startsWith(prefix))
  if (rows.length !== 1) return null
  try {
    const body = rows[0].slice(prefix.length), value = JSON.parse(body)
    if (!value || Array.isArray(value) || Object.keys(value).join(',') !== 'v,role,line,column,check,hresult,reason' || JSON.stringify(value) !== body || value.v !== 1 || !['registration', 'build', 'registrar', 'unknown'].includes(value.role) || !REGISTRATION_REASONS.has(value.reason)) return null
    if (!['line', 'column', 'check'].every(k => Number.isInteger(value[k]) && value[k] >= 0 && value[k] <= 100000) || !Number.isInteger(value.hresult) || value.hresult < -2147483648 || value.hresult > 2147483647) return null
    return value
  } catch { return null }
}
function failureEvidence(kind, currentStage, step) {
  const output = step ? boundedEvidence(step.output) : { bytes: null, text: null }, error = step ? boundedEvidence(step.error) : { bytes: null, text: null }
  const body = [output.text, error.text].filter(x => typeof x === 'string').join('\n')
  const compiler = [...new Set([...body.matchAll(/\berror (CS[0-9]{4}):/g)].map(m => m[1]))].sort()
  const framing = [...body.matchAll(/COCKPIT_BRIDGE_FRAMING_FAILED checks=(0|[1-9][0-9]{0,4})(?=\r?$)/gm)]
  const state = step?.state
  let firstIdentity = null
  try { firstIdentity = firstEvidence.publicEvidence(state?.observation ?? null, output.text) } catch { }
  return { v: 1, stage: GATE_STAGES.has(currentStage) ? currentStage : 'unknown', kind: kind === 'child_refused' ? kind : 'controller_refused',
    step: STEP_LABELS.has(step?.label) ? step.label : 'none', closeObserved: state?.closed === true, spawnError: state?.spawnError === true,
    exitCode: Number.isInteger(state?.code) && state.code >= 0 && state.code <= 255 ? state.code : null,
    signal: state?.closed ? state.signal === null ? 'NONE' : ['SIGTERM', 'SIGKILL', 'SIGABRT'].includes(state.signal) ? state.signal : 'OTHER' : 'UNKNOWN',
    stdoutBytes: output.bytes, stderrBytes: error.bytes, detailsAvailable: output.text !== null && error.text !== null,
    registration: registrationEvidence(error.text), framingChecks: framing.length === 1 ? Number(framing[0][1]) : null,
    compilerCodes: compiler.slice(0, 8), compilerMore: compiler.length > 8, firstIdentity }
}
async function run(file, args, cwd, env, label, observe) {
  const output = fs.openSync(path.join(raw, String(++sequence) + '-' + label + '.stdout'), 'wx')
  const error = fs.openSync(path.join(raw, String(sequence) + '-' + label + '.stderr'), 'wx')
  try {
    await new Promise((resolve, reject) => {
      const child = cp.spawn(file, args, { cwd, env, windowsHide: true, stdio: label === 'first-identity' ? ['ignore', output, error, 'pipe'] : ['ignore', output, error] })
      let observation
      try { if (label === 'first-identity') observation = firstEvidence.capture(child.stdio?.[3]) } catch { }
      child.once('error', error => { try { observe?.('error', null, null) } catch { } reject(error) })
      child.once('close', (code, signal) => {
        let record = null
        try { if (observation) record = observation.finish(true) } catch { }
        try { if (observation) observe?.('close', code, signal, record); else observe?.('close', code, signal) } catch { }
        code === 0 && signal === null ? resolve() : reject(Error('COCKPIT_BRIDGE_GATE_' + label + '_FAILED'))
      })
    })
  } finally { fs.closeSync(output); fs.closeSync(error) }
}
async function runRecorded(file, args, cwd, env, label) {
  const n = sequence + 1, state = { closed: false, spawnError: false, code: null, signal: null }
  const step = { label, state, output: path.join(raw, n + '-' + label + '.stdout'), error: path.join(raw, n + '-' + label + '.stderr') }
  const observe = (event, code, signal, observation = null) => { if (event === 'error') state.spawnError = true; else if (event === 'close') { state.closed = true; state.code = code; state.signal = signal; state.observation = observation } }
  try { await run(file, args, cwd, env, label, observe); lastStep = step }
  catch (error) { if (!firstFailure) firstFailure = failureEvidence('child_refused', stage, step); throw error }
}
async function main() {
  const archive = path.join(root, 'chrome-win64.zip'), unpacked = path.join(root, 'browser')
  await supply.download(pin, archive)
  const chrome = await supply.extract(archive, unpacked, pin)
  // This smoke job has no frontend install from the separate build job. Build
  // this exact checkout after all original canonical/legacy/native steps.
  stage = 'extension-build'
  const extension = path.join(repo, 'chrome-extension')
  await runRecorded(process.execPath, [npm, 'ci', '--registry=https://registry.npmjs.org/', '--no-audit', '--no-fund'], extension, npmEnv, 'npm-ci')
  await runRecorded(process.execPath, [npm, 'run', 'build'], extension, npmEnv, 'extension-build')
  const tsc = physical(path.join(extension, 'node_modules/typescript/bin/tsc'), false)
  await runRecorded(process.execPath, [tsc, '-p', 'tsconfig.test.json'], extension, npmEnv, 'extension-test-compile')
  const bundle = physical(path.join(extension, 'build/chrome-mv3-prod'), true)
  stage = 'registration-framing'
  const scratch = path.join(root, 'registration-scratch'); fs.mkdirSync(scratch)
  await runRecorded(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'cockpit-bridge-registration.ps1'), '-TestRoot', scratch], repo, childEnv, 'registration-framing')
  const receipts = fs.readdirSync(scratch, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith('cockpit-bridge-'))
    .map(e => path.join(scratch, e.name, 'framing-producer.json')).filter(file => fs.existsSync(file))
  assert.equal(receipts.length, 1)
  stage = 'document-receipt'
  await runRecorded(process.execPath, ['-r', preload, path.join(__dirname, 'cockpit-bridge-document-receipt.cjs'), path.join(extension, '.test-dist'), receipts[0]], repo, childEnv, 'document-receipt')
  // Controller owns a separate live install, builds/runs Job CPU once, then
  // launches owned Chrome. Do not pre-run Job CPU or bypass its STOP checks.
  stage = 'first-identity'
  await runRecorded(process.execPath, ['-r', preload, path.join(__dirname, 'cockpit-bridge-real-first.cjs'), chrome, pin.executableSHA256, bundle, compiled], repo, childEnv, 'first-identity')
  fs.writeFileSync(path.join(root, 'gate-summary.json'), JSON.stringify({ version: 1, stage: 'first-identity-complete', masking: 'NOT_IMPLEMENTED' }) + '\n', { flag: 'wx' })
  process.stdout.write('COCKPIT_BRIDGE_FIRST_IDENTITY_COMPLETE\n')
}
main().catch(() => {
  const failure = firstFailure || failureEvidence('controller_refused', stage, lastStep)
  // Durable public finite evidence only. Diagnostic I/O never changes the gate.
  try { fs.writeFileSync(path.join(root, 'gate-summary.json'), JSON.stringify({ version: 1, stage: 'first-identity-incomplete', masking: 'NOT_IMPLEMENTED', firstFailure: failure }) + '\n', { flag: 'wx' }) } catch { }
  process.stderr.write('COCKPIT_BRIDGE_FIRST_IDENTITY_INCOMPLETE ' + stage + '\n')
  process.stderr.write('COCKPIT_BRIDGE_FIRST_FAILURE ' + JSON.stringify(failure) + '\n')
  process.exitCode = 1
})
