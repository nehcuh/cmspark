import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { stageFilesystemRuntime } from '../stage-filesystem-runtime.mjs'
import { existingPayloadControl, destinationAdmissionControl } from './fixtures/filesystem-staging-794.mjs'

const ENTRY = '@modelcontextprotocol/server-filesystem'
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-filesystem-stage-'))
  const source = path.join(root, 'source'), destination = path.join(root, 'staged')
  fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true })
  function pkg(name, metadata = {}, parent = source, files = {}) {
    const directory = path.join(parent, 'node_modules', name)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...metadata }))
    for (const [relative, body] of Object.entries(files)) {
      const file = path.join(directory, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body)
    }
    return directory
  }
  const entry = (dependencies = {}) => pkg(ENTRY, { dependencies }, source, { 'dist/index.js': '// controlled inert package entry\n' })
  return { root, source, destination, pkg, entry, stage: () => stageFilesystemRuntime({ source, destination }), dispose: () => fs.rmSync(root, { recursive: true, force: true }) }
}
function owned(fn) { const f = fixture(); try { return fn(f) } finally { f.dispose() } }

test('filesystem staging reads the named root manifest despite an exported type-only package.json', () => owned(f => {
  f.entry({ '@owned/sdk': '1.0.0' })
  const sdk = f.pkg('@owned/sdk', { exports: { './*': { require: './dist/cjs/*' } }, dependencies: { 'owned-validator': '1.0.0' } }, f.source, { 'dist/cjs/package.json': '{"type":"commonjs"}\n' })
  f.pkg('owned-validator', {}, f.source, { 'index.js': '// validator bytes\n' })
  const resolved = createRequire(path.join(f.source, 'package.json')).resolve('@owned/sdk/package.json')
  assert.equal(resolved, path.join(sdk, 'dist/cjs/package.json'))
  assert.deepEqual(JSON.parse(fs.readFileSync(resolved, 'utf8')), { type: 'commonjs' })
  const result = f.stage()
  assert.deepEqual(result.packages.map(p => p.name), [ENTRY, '@owned/sdk', 'owned-validator'])
  assert.equal(fs.readFileSync(path.join(f.destination, 'node_modules/owned-validator/index.js'), 'utf8'), '// validator bytes\n')
}))

test('filesystem staging preserves different hoisted and nested dependency versions at their resolution locations', () => owned(f => {
  const app = f.entry({ 'owned-colour': '1', 'owned-consumer': '1' })
  f.pkg('owned-colour', { version: '1.0.0' })
  const consumer = f.pkg('owned-consumer', { dependencies: { 'owned-colour': '2' } })
  f.pkg('owned-colour', { version: '2.0.0' }, consumer)
  const result = f.stage()
  assert.equal(result.packages.length, 4)
  for (const [relative, version] of [['owned-colour', '1.0.0'], ['owned-consumer/node_modules/owned-colour', '2.0.0']]) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.destination, 'node_modules', relative, 'package.json'), 'utf8')).version, version)
  }
  assert.equal(fs.readFileSync(path.join(app, 'package.json'), 'utf8').includes('owned-consumer'), true)
}))

test('filesystem staging supports packages whose exports hide both the main entry and package.json', () => owned(f => {
  f.entry({ 'owned-hidden': '1' })
  f.pkg('owned-hidden', { exports: { './public': './public.js' }, dependencies: { 'owned-leaf': '1' } }, f.source, { 'public.js': '// not executed\n' })
  f.pkg('owned-leaf')
  assert.throws(() => createRequire(path.join(f.source, 'package.json')).resolve('owned-hidden/package.json'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
  assert.equal(f.stage().packages.some(p => p.name === 'owned-leaf'), true)
}))

test('filesystem staging rejects missing required dependencies and never borrows a package outside source node_modules', () => owned(f => {
  f.entry({ 'owned-missing': '1' })
  f.pkg('owned-missing', {}, f.root)
  assert.throws(f.stage, /Required filesystem dependency is missing: owned-missing/)
  assert.equal(fs.existsSync(path.join(f.destination, 'node_modules/owned-missing')), false)
}))

test('filesystem staging includes required peers and installed optional dependencies, but permits absent optional packages', () => owned(f => {
  f.entry({ 'owned-peer-user': '1' })
  f.pkg('owned-peer-user', { peerDependencies: { 'owned-peer': '1', 'owned-optional-peer': '1' }, peerDependenciesMeta: { 'owned-optional-peer': { optional: true } }, optionalDependencies: { 'owned-optional': '1', 'owned-absent': '1' } })
  f.pkg('owned-peer'); f.pkg('owned-optional')
  const names = f.stage().packages.map(p => p.name)
  assert.equal(names.includes('owned-peer'), true); assert.equal(names.includes('owned-optional'), true)
  assert.equal(names.includes('owned-optional-peer'), false); assert.equal(names.includes('owned-absent'), false)
}))

test('filesystem staging fails closed for identity drift, malformed metadata and missing required peer', () => {
  owned(f => { f.entry({ 'owned-wrong': '1' }); f.pkg('owned-wrong', { name: 'other-package' }); assert.throws(f.stage, /identity mismatch/) })
  owned(f => { f.entry({ 'owned-malformed': '1' }); const p = f.pkg('owned-malformed'); fs.writeFileSync(path.join(p, 'package.json'), '{'); assert.throws(f.stage, SyntaxError) })
  owned(f => { f.entry({ 'owned-peer-user': '1' }); f.pkg('owned-peer-user', { peerDependencies: { 'owned-required-peer': '1' } }); assert.throws(f.stage, /Required filesystem dependency is missing/) })
})

test('filesystem staging rejects source and output symlink escapes without modifying the external owned target', () => {
  owned(f => { f.entry({ 'owned-linked': '1' }); const target = f.pkg('owned-linked', {}, f.root); fs.symlinkSync(target, path.join(f.source, 'node_modules/owned-linked'), 'junction'); assert.throws(f.stage, /regular directory/) })
  owned(f => { const p = f.entry(); const outside = path.join(f.root, 'outside.txt'); fs.writeFileSync(outside, 'unchanged'); fs.symlinkSync(outside, path.join(p, 'linked.txt')); assert.throws(f.stage, /symlinks/); assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged') })
  owned(f => { f.entry(); const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside); fs.mkdirSync(path.join(f.destination, 'node_modules'), { recursive: true }); fs.symlinkSync(outside, path.join(f.destination, 'node_modules/@modelcontextprotocol'), 'junction'); assert.throws(f.stage, /regular/); assert.deepEqual(fs.readdirSync(outside), []) })
})

test('filesystem staging rejects overlapping source and preserves an entry missing failure', () => {
  owned(f => { f.entry(); const output = path.join(f.source, 'new-staging'); assert.throws(() => stageFilesystemRuntime({ source: f.source, destination: output }), /overlap/); assert.equal(fs.existsSync(output), false) })
  owned(f => { f.pkg(ENTRY); assert.throws(f.stage, { code: 'ENOENT' }) })
})

test('filesystem staging preserves earlier component nested modules and rejects conflicting payloads', () => existingPayloadControl(stageFilesystemRuntime))

test('filesystem staging rejects symlink ancestor overlap before writing and creates normal missing destinations', () => destinationAdmissionControl(stageFilesystemRuntime))
