import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

// Exercise the generated production probe. The kit outlet is inert here;
// relocated native conversion remains a separate mandatory CI check.
const source = fs.readFileSync(new URL('../smoke-office-runtime.mjs', import.meta.url), 'utf8')
const probe = source.match(/fs\.writeFileSync\(probe, `([\s\S]*?)`\)/)?.[1]
assert.ok(probe, 'the complete generated probe must be present')

async function runProbe(platform, mode = 'success') {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'office fonts 666 '))
  const processFixture = { platform, execPath: path.join(owned, 'inert-node'), exitCode: 0 }
  const state = { created: 0, converted: 0, disposed: 0, phases: [], errors: [], options: null }
  const budgets = { timeoutMs: 30000, maxInputBytes: 10485760, maxOutputBytes: 33554432, fontMetadataCacheDirectory: false }
  const kit = {
    ENGINE_VERSION: '0.1.5',
    async createConverter(options) {
      state.created++
      state.options = options
      // Values cross a VM realm: compare serialized data, not prototypes.
      const expected = platform === 'linux' ? budgets : { ...budgets, fontDirectories: [path.join(owned, 'smoke-fonts')] }
      assert.deepEqual(JSON.parse(JSON.stringify(options)), expected)
      if (platform !== 'linux') {
        const directory = options.fontDirectories[0]
        assert.equal(fs.statSync(directory).isDirectory(), true)
        assert.deepEqual(fs.readdirSync(directory), [])
      }
      return {
        backend: mode === 'wrong-backend' ? 'wasm' : platform === 'linux' ? 'wasm' : 'native',
        async convert(request) {
          state.converted++
          assert.deepEqual(JSON.parse(JSON.stringify(request)), { inputPath: path.join(owned, 'input.doc'), outputPath: path.join(owned, 'output.txt') })
          if (mode === 'conversion-failure') throw new Error('OWNED_CONVERSION_FAILURE')
          fs.writeFileSync(request.outputPath, mode === 'missing-cjk' ? 'Office preview' : 'Office preview 中文文档')
        },
        async dispose() { state.disposed++ },
      }
    },
  }
  const filesystem = Object.create(fs)
  filesystem.mkdirSync = (...args) => {
    if (mode === 'directory-failure') throw Object.assign(new Error('OWNED_FONT_DIRECTORY_FAILURE'), { code: 'EACCES' })
    return fs.mkdirSync(...args)
  }
  const modules = {
    'node:assert/strict': assert, 'node:fs': filesystem, 'node:path': path,
    'node:module': { createRequire: () => name => { assert.equal(name, '@deepseek-ai/libreoffice-kit'); return kit } },
    './office-smoke-observer.cjs': { createOfficeSmokeObserver: () => ({
      phase: value => state.phases.push(value),
      finish: () => ({ events: [], schema: 'owned-inert-observer', status: 'complete' }),
    }) },
  }
  try {
    await vm.runInNewContext(probe, {
      require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name] },
      process: processFixture,
      console: { log() {}, error(value) { if (typeof value !== 'string' || !value.startsWith('{')) state.errors.push(String(value)) } },
    }, { timeout: 1000 })
    return { ...state, exitCode: processFixture.exitCode, outputExists: fs.existsSync(path.join(owned, 'output.txt')) }
  } finally { fs.rmSync(owned, { recursive: true, force: true }) }
}

for (const platform of ['win32', 'darwin']) test(`${platform} native TXT relocation probe uses only its owned empty font catalog`, async () => {
  const result = await runProbe(platform)
  assert.equal(result.exitCode, 0, result.errors.join('\n'))
  assert.equal(result.created, 1)
  assert.equal(result.converted, 1)
  assert.equal(result.disposed, 1)
  assert.equal(result.outputExists, true)
  assert.ok(result.phases.includes('assertions-pass'))
})

test('Linux WASM probe retains its default usable font discovery', async () => {
  const result = await runProbe('linux')
  assert.equal(result.exitCode, 0, result.errors.join('\n'))
  assert.equal(Object.hasOwn(result.options, 'fontDirectories'), false)
  assert.equal(result.disposed, 1)
})

test('Owned native font-directory setup failure never starts conversion', async () => {
  const result = await runProbe('win32', 'directory-failure')
  assert.equal(result.exitCode, 1)
  assert.equal(result.created, 0)
  assert.equal(result.converted, 0)
  assert.ok(result.errors.some(value => value.includes('OWNED_FONT_DIRECTORY_FAILURE')))
})

test('Native converter failure stays a failure and still disposes', async () => {
  const result = await runProbe('win32', 'conversion-failure')
  assert.equal(result.exitCode, 1)
  assert.equal(result.converted, 1)
  assert.equal(result.disposed, 1)
  assert.equal(result.outputExists, false)
  assert.ok(result.errors.some(value => value.includes('OWNED_CONVERSION_FAILURE')))
})

test('The original Chinese output assertion still rejects incomplete native output', async () => {
  const result = await runProbe('darwin', 'missing-cjk')
  assert.equal(result.exitCode, 1)
  assert.equal(result.converted, 1)
  assert.equal(result.disposed, 1)
  assert.equal(result.phases.includes('assertions-pass'), false)
})

test('A native-platform probe cannot replace real native execution with WASM', async () => {
  const result = await runProbe('win32', 'wrong-backend')
  assert.equal(result.exitCode, 1)
  assert.equal(result.converted, 0)
  assert.equal(result.disposed, 1)
})

test('Linux WASM conversion failure remains visible and disposes', async () => {
  const result = await runProbe('linux', 'conversion-failure')
  assert.equal(result.exitCode, 1)
  assert.equal(result.disposed, 1)
  assert.ok(result.errors.some(value => value.includes('OWNED_CONVERSION_FAILURE')))
})
