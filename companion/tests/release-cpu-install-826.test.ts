/** Locked installer IO controls plus the current release host's real CPU binding load. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import yaml from 'js-yaml'
const repo = path.resolve('..'), ort = path.resolve('node_modules/onnxruntime-node'), scripts = path.join(ort, 'script')
const source = (name: string) => fs.readFileSync(path.join(scripts, name), 'utf8')
const metadata: any = require(path.join(scripts, 'install-metadata.js'))
const pkg: any = require(path.join(ort, 'package.json'))
function load(name: string, requires: any, processPort: any): any {
  const module = { exports: {} }
  const context = { module, exports: module.exports, require: requires, process: processPort, __dirname: scripts, console: { log() {}, warn() {} }, Set, Map, Date, Promise }
  vm.runInNewContext(source(name), context, { filename: path.join(scripts, name) })
  return module.exports
}
async function run(env: any, platform = 'linux', arch = 'x64', exists = false) {
  const state: any = { urls: [], copies: [], writes: [], manifests: [], packages: [], exists: 0, exit: null, pending: null, bootstrap: 0 }
  const STOP = {}, processPort = { env: { ...env }, argv: ['node', 'install'], exit(code: number) { state.exit = code; throw STOP } }
  const fsPort = {
    existsSync() { state.exists++; return exists },
    createWriteStream(dest: string) { state.writes.push(dest); const stream: any = new EventEmitter(); stream.close = () => {}; return stream },
    mkdirSync() {}, unlinkSync() {}, rmSync() {},
    copyFileSync(from: string, to: string) { state.copies.push({ from, to }) }
  }
  const httpsPort = { get(url: string, callback: any) {
    state.urls.push(url); const request = new EventEmitter()
    queueMicrotask(() => {
      const response: any = new EventEmitter(); response.statusCode = 200; response.headers = { 'content-type': 'application/json' }; response.setEncoding = () => {}
      response.pipe = (stream: any) => queueMicrotask(() => stream.emit('finish'))
      callback(response)
      if (url.endsWith('.nupkg')) return
      const body = state.urls.length === 1 ? { resources: [{ '@type': 'PackageBaseAddress/3.0.0', '@id': 'https://controlled.invalid/v3-flatcontainer/' }] } : { versions: metadata.packages['nuget:linux/x64:cuda12'].versions.map((row: any) => row.version.toLowerCase()) }
      response.emit('data', JSON.stringify(body)); response.emit('end')
    }); return request
  } }
  class ZipPort { getEntry(name: string) { return { name } } extractEntryTo() {} }
  const osPort = { platform: () => platform, arch: () => arch, tmpdir: () => '/owned/control' }
  const utils = load('install-utils.js', (name: string) => ({ fs: fsPort, https: httpsPort, child_process: { execFileSync() { throw Error('unexpected nvcc') } }, path, os: osPort, 'adm-zip': ZipPort })[name] ?? (() => { throw Error('unexpected require ' + name) })(), processPort)
  const actualInstallPackages = utils.installPackages
  const observedUtils = { ...utils, installPackages(packages: any, manifests: any, feeds: any) {
    state.manifests = Array.from(manifests, (row: any) => ({ filepath: row.filepath, pathInPackage: row.pathInPackage })); state.packages = [...packages].map((row: any) => row.name)
    state.pending = actualInstallPackages(packages, manifests, feeds); return state.pending
  } }
  try {
    load('install.js', (name: string) => ({ os: osPort, path, 'global-agent': { bootstrap() { state.bootstrap++ } }, './install-utils.js': observedUtils, './install-metadata.js': metadata, fs: fsPort })[name] ?? (() => { throw Error('unexpected require ' + name) })(), processPort)
  } catch (error) { if (error !== STOP) throw error }
  if (state.pending) await state.pending
  state.flag = utils.parseInstallFlag(); return state
}

test('826 actual locked installer: optional GPU default versus skip, CPU assets and speaker consumer', async () => {
  assert.equal(pkg.version, '1.29.0'); assert.equal(pkg.scripts.postinstall, 'node ./script/install')
  const lock = JSON.parse(fs.readFileSync(path.resolve('package-lock.json'), 'utf8'))
  assert.equal(lock.packages['node_modules/onnxruntime-node'].version, pkg.version)
  assert.deepEqual(metadata.requirements['linux/x64'], ['cuda12'])
  for (const row of ['win32/x64','win32/arm64','linux/arm64','darwin/x64','darwin/arm64']) assert.deepEqual(metadata.requirements[row], [])
  const normal = await run({})
  assert.equal(normal.flag, undefined); assert.equal(normal.bootstrap, 1); assert.equal(normal.exit, null)
  assert.deepEqual(normal.packages, ['Microsoft.ML.OnnxRuntime.Gpu.Linux'])
  assert.equal(normal.urls.length, 3); assert.equal(normal.urls[0], metadata.feeds.nuget.index); assert.ok(normal.urls[2].endsWith('.nupkg'))
  assert.deepEqual(normal.manifests.map((row: any) => path.basename(row.filepath)).sort(), ['libonnxruntime_providers_cuda.so', 'libonnxruntime_providers_shared.so', 'libonnxruntime_providers_tensorrt.so'])
  assert.deepEqual(normal.copies.map((row: any) => path.basename(row.to)).sort(), normal.manifests.map((row: any) => path.basename(row.filepath)).sort())
  assert.equal(normal.writes.length, 1)
  for (const platform of ['linux', 'darwin', 'win32']) for (const arch of ['x64', 'arm64']) {
    const skipped = await run({ ONNXRUNTIME_NODE_INSTALL: 'skip' }, platform, arch)
    assert.equal(skipped.flag, false); assert.equal(skipped.exit, 0); assert.equal(skipped.bootstrap, 1)
    assert.equal(skipped.urls.length, 0); assert.equal(skipped.manifests.length, 0); assert.equal(skipped.writes.length, 0); assert.equal(skipped.copies.length, 0); assert.equal(skipped.exists, 0)
  }
  const present = await run({}, 'linux', 'x64', true); assert.equal(present.exit, 0); assert.equal(present.urls.length, 0)
  for (const [platform, arch] of [['darwin', 'arm64'], ['win32', 'x64'], ['linux', 'x64']]) {
    const folder = path.join(ort, 'bin/napi-v6', platform, arch)
    const core = platform === 'win32' ? 'onnxruntime.dll' : platform === 'darwin' ? 'libonnxruntime.1.dylib' : 'libonnxruntime.so.1'
    for (const file of ['onnxruntime_binding.node', core]) { const stat = fs.statSync(path.join(folder, file)); assert.ok(stat.isFile() && stat.size > 0) }

  }
  const embed = fs.readFileSync(path.join(repo, 'companion/src/meeting/diarize-embed.ts'), 'utf8')
  assert.match(embed, /const p = ort\.InferenceSession\.create\(modelPath\)/)
  assert.doesNotMatch(embed, /executionProviders|cuda|tensorrt/i)
  const pack = fs.readFileSync(path.join(repo, 'scripts/package.sh'), 'utf8')
  assert.match(pack, /Linux builds run the speaker-embedding model on CPU/)
  const strip = pack.match(/strip_ort_optional_providers\(\) \{[\s\S]*?\n\}/)![0]
  assert.match(strip, /libonnxruntime_providers_cuda\.so/); assert.match(strip, /libonnxruntime_providers_tensorrt\.so/)
  assert.doesNotMatch(strip, /onnxruntime_binding|libonnxruntime\.so\.1/)

})
function requireCpuInstalls(workflow: any) {
  for (const job of ['preflight', 'package']) {
    const steps = workflow.jobs[job].steps.filter((step: any) => step.name === 'Install companion deps')
    assert.equal(steps.length, 1); assert.equal(steps[0].run, 'cd companion && npm ci'); assert.equal(steps[0].env?.ONNXRUNTIME_NODE_INSTALL, 'skip', job + ' keeps optional GPU installation disabled')
  }
}
const releaseHost = ['darwin/arm64', 'win32/x64', 'linux/x64'].includes(`${process.platform}/${process.arch}`)
test('826 bundled CPU native runtime loads on the actual supported release host', { skip: !releaseHost }, () => {
  // Actual binding DTO is SupportedBackend {name,bundled} in upstream
  // lib/binding.ts. This loads the addon, without a model or inference claim.
  const runtime = require('onnxruntime-node') as typeof import('onnxruntime-node')
  const backends = runtime.listSupportedBackends()
  assert.ok(Array.isArray(backends))
  assert.ok(backends.some(row => row.name === 'cpu' && row.bundled === true))
})
test('826 Release companion installs keep scripts, tests and audit; either missing skip fails', () => {
  const workflow: any = yaml.load(fs.readFileSync(path.resolve('../.github/workflows/release.yml'), 'utf8'))
  requireCpuInstalls(workflow)
  for (const missing of [['preflight'], ['package'], ['preflight', 'package']]) {
    const broken = structuredClone(workflow)
    for (const job of missing) delete broken.jobs[job].steps.find((step: any) => step.name === 'Install companion deps').env.ONNXRUNTIME_NODE_INSTALL
    assert.throws(() => requireCpuInstalls(broken), /optional GPU installation disabled/)
  }
  assert.equal(workflow.jobs.preflight.steps.find((step: any) => step.name === 'Run companion tests').run, 'cd companion && npm test')
  assert.equal(workflow.jobs.preflight.steps.find((step: any) => step.name === 'Supply-chain audit — companion (high+)').run, 'cd companion && npm audit --omit=dev --audit-level=high')
})
