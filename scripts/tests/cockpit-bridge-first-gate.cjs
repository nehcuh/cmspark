// GHA Windows only. Setup precedes (and never extends) the controller's 45s lease.
'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process')
const supply = require('./cockpit-bridge-browser-supply.cjs')
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
async function run(file, args, cwd, env, label) {
  const output = fs.openSync(path.join(raw, String(++sequence) + '-' + label + '.stdout'), 'wx')
  const error = fs.openSync(path.join(raw, String(sequence) + '-' + label + '.stderr'), 'wx')
  try {
    await new Promise((resolve, reject) => {
      const child = cp.spawn(file, args, { cwd, env, windowsHide: true, stdio: ['ignore', output, error] })
      child.once('error', reject)
      child.once('close', (code, signal) => code === 0 && signal === null ? resolve() : reject(Error('COCKPIT_BRIDGE_GATE_' + label + '_FAILED')))
    })
  } finally { fs.closeSync(output); fs.closeSync(error) }
}
async function main() {
  const archive = path.join(root, 'chrome-win64.zip'), unpacked = path.join(root, 'browser')
  await supply.download(pin, archive)
  const chrome = await supply.extract(archive, unpacked, pin)
  // This smoke job has no frontend install from the separate build job. Build
  // this exact checkout after all original canonical/legacy/native steps.
  stage = 'extension-build'
  const extension = path.join(repo, 'chrome-extension')
  await run(process.execPath, [npm, 'ci', '--registry=https://registry.npmjs.org/', '--no-audit', '--no-fund'], extension, npmEnv, 'npm-ci')
  await run(process.execPath, [npm, 'run', 'build'], extension, npmEnv, 'extension-build')
  const tsc = physical(path.join(extension, 'node_modules/typescript/bin/tsc'), false)
  await run(process.execPath, [tsc, '-p', 'tsconfig.test.json'], extension, npmEnv, 'extension-test-compile')
  const bundle = physical(path.join(extension, 'build/chrome-mv3-prod'), true)
  stage = 'registration-framing'
  const scratch = path.join(root, 'registration-scratch'); fs.mkdirSync(scratch)
  await run(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'cockpit-bridge-registration.ps1'), '-TestRoot', scratch], repo, childEnv, 'registration-framing')
  const receipts = fs.readdirSync(scratch, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith('cockpit-bridge-'))
    .map(e => path.join(scratch, e.name, 'framing-producer.json')).filter(file => fs.existsSync(file))
  assert.equal(receipts.length, 1)
  stage = 'document-receipt'
  await run(process.execPath, ['-r', preload, path.join(__dirname, 'cockpit-bridge-document-receipt.cjs'), path.join(extension, '.test-dist'), receipts[0]], repo, childEnv, 'document-receipt')
  // Controller owns a separate live install, builds/runs Job CPU once, then
  // launches owned Chrome. Do not pre-run Job CPU or bypass its STOP checks.
  stage = 'first-identity'
  await run(process.execPath, ['-r', preload, path.join(__dirname, 'cockpit-bridge-real-first.cjs'), chrome, pin.executableSHA256, bundle, compiled], repo, childEnv, 'first-identity')
  fs.writeFileSync(path.join(root, 'gate-summary.json'), JSON.stringify({ version: 1, stage: 'first-identity-complete', masking: 'NOT_IMPLEMENTED' }) + '\n', { flag: 'wx' })
  process.stdout.write('COCKPIT_BRIDGE_FIRST_IDENTITY_COMPLETE\n')
}
main().catch(() => { process.stderr.write('COCKPIT_BRIDGE_FIRST_IDENTITY_INCOMPLETE ' + stage + '\n'); process.exitCode = 1 })
