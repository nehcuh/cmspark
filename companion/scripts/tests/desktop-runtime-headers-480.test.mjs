import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DESKTOP_WINDOWS_INPUTS, prepareDesktopNodeHeaders, stageVerifiedRuntimeHeaders } from '../build-desktop-windows.mjs'

const names = ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h']
const officialPins = {
  'node_api.h': '2d4560831e525b47b060ec8a0864ab73993df9e20215ce9f0fe7b24cd31af32a',
  'node_api_types.h': '088766b3cf1f0cd9b292c361ad30f7a04e7cc6db35a20ca52c572c1adf9635e7',
  'js_native_api.h': '624b39a85f0fe332f7cc1eb537e98f0e119be8503c742265fef6bdd53893adc8',
  'js_native_api_types.h': 'c63d227f42878411e2a291ce81e0adf83ce57b81c0ea806740108b979b741156',
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-runtime-headers-'))
  t.after(() => fs.rmSync(root, { recursive: true }))
  const directory = path.join(root, 'input'), cache = path.join(root, 'cache')
  fs.mkdirSync(directory); fs.mkdirSync(cache)
  const contents = Object.fromEntries(names.map(name => [name, Buffer.from(`owned fixture: ${name}\n`)]))
  for (const name of names) fs.writeFileSync(path.join(directory, name), contents[name])
  const pins = Object.fromEntries(names.map(name => [name, hash(contents[name])]))
  return { root, directory, cache, contents, pins }
}
// Exact members of the independently verified Node 22.23.4 headers archive.
// A private runtime layout makes these integration controls independent of the
// machine's Node installation while exercising the actual production caller.
function ownedRuntime(root) {
  const base = path.join(root, 'runtime'), directory = path.join(base, 'include', 'node')
  fs.mkdirSync(directory, { recursive: true })
  for (const name of names) {
    const bytes = fs.readFileSync(new URL(`./fixtures/node-22.23.4-headers/${name}`, import.meta.url))
    assert.equal(hash(bytes), officialPins[name])
    fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' })
  }
  return path.join(base, 'bin', 'node')
}

test('validated runtime header set is staged using exactly the verified bytes', t => {
  const f = fixture(t), result = stageVerifiedRuntimeHeaders(f)
  assert.ok(result); assert.equal(path.dirname(result), f.cache)
  assert.deepEqual(fs.readdirSync(result).sort(), [...names].sort())
  for (const name of names) assert.deepEqual(fs.readFileSync(path.join(result, name)), f.contents[name])
  assert.equal(fs.existsSync(path.join(f.cache, `headers-${DESKTOP_WINDOWS_INPUTS.headers.sha256}`)), false)
})

test('an incomplete set falls back without publishing partial headers', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.directory, names[0]))
  assert.equal(stageVerifiedRuntimeHeaders(f), null)
  assert.deepEqual(fs.readdirSync(f.cache), [])
})

test('a modified runtime header is refused before staging', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.directory, names[0]), 'wrong')
  assert.throws(() => stageVerifiedRuntimeHeaders(f), /DESKTOP_SDK_RUNTIME_INTEGRITY/)
  assert.deepEqual(fs.readdirSync(f.cache), [])
})

test('missing input cannot hide a separate integrity failure', t => {
  const f = fixture(t)
  fs.unlinkSync(path.join(f.directory, names[0]))
  fs.writeFileSync(path.join(f.directory, names[1]), 'wrong')
  assert.throws(() => stageVerifiedRuntimeHeaders(f), /DESKTOP_SDK_RUNTIME_INTEGRITY/)
  assert.deepEqual(fs.readdirSync(f.cache), [])
})

test('pin set cannot introduce extra or path-traversal members', t => {
  const f = fixture(t)
  assert.throws(() => stageVerifiedRuntimeHeaders({ ...f, pins: { ...f.pins, '../outside': hash(Buffer.from('x')) } }), /DESKTOP_SDK_RUNTIME_PINS/)
  assert.deepEqual(fs.readdirSync(f.cache), [])
})

test('separate staging calls never replace each others outputs', t => {
  const f = fixture(t), first = stageVerifiedRuntimeHeaders(f), second = stageVerifiedRuntimeHeaders(f)
  assert.ok(first && second); assert.notEqual(first, second)
  for (const name of names) {
    assert.deepEqual(fs.readFileSync(path.join(first, name)), f.contents[name])
    assert.deepEqual(fs.readFileSync(path.join(second, name)), f.contents[name])
  }
})

test('symlink and hardlink inputs are refused without staging', t => {
  for (const kind of ['symlink', 'hardlink']) {
    const f = fixture(t), header = path.join(f.directory, names[0]), other = path.join(f.root, `other-${kind}`)
    fs.writeFileSync(other, f.contents[names[0]]); fs.unlinkSync(header)
    if (kind === 'symlink') fs.symlinkSync(other, header); else fs.linkSync(other, header)
    assert.throws(() => stageVerifiedRuntimeHeaders(f), /DESKTOP_SDK_RUNTIME_IDENTITY/)
    assert.deepEqual(fs.readdirSync(f.cache), [])
    assert.deepEqual(fs.readFileSync(other), f.contents[names[0]])
  }
})

test('copy uses the verified buffer even if the input path changes after reading', t => {
  const f = fixture(t), target = path.join(f.directory, names[0]), originalRead = fs.readSync
  let changed = false
  try {
    fs.readSync = function (...args) {
      const n = originalRead.apply(this, args)
      if (!changed && n > 0) { changed = true; fs.writeFileSync(target, Buffer.alloc(f.contents[names[0]].length, 120)) }
      return n
    }
    const result = stageVerifiedRuntimeHeaders(f)
    assert.equal(changed, true); assert.ok(result)
    assert.deepEqual(fs.readFileSync(path.join(result, names[0])), f.contents[names[0]])
  } finally { fs.readSync = originalRead }
})

test('corrupt existing archive cache is not bypassed by runtime preference', async t => {
  const f = fixture(t), dest = path.join(f.root, 'output'), cache = path.join(dest, '.desktop-sdk-build')
  fs.mkdirSync(cache, { recursive: true })
  fs.writeFileSync(path.join(cache, `headers-${DESKTOP_WINDOWS_INPUTS.headers.sha256}`), 'corrupt')
  const original = globalThis.fetch; let calls = 0
  try {
    globalThis.fetch = async () => { calls++; throw new Error('unexpected fetch') }
    await assert.rejects(() => prepareDesktopNodeHeaders({ dest, preferRuntimeHeaders: true }), /DESKTOP_SDK_INTEGRITY/)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = original }
})

test('actual macOS producer stages a controlled set of pinned headers without download', async t => {
  assert.equal(process.platform, 'darwin'); assert.equal(process.version, 'v22.23.4')
  const f = fixture(t), dest = path.join(f.root, 'output'), original = globalThis.fetch
  let calls = 0
  const descriptor = Object.getOwnPropertyDescriptor(process, 'execPath')
  try {
    Object.defineProperty(process, 'execPath', { ...descriptor, value: ownedRuntime(f.root) })
    globalThis.fetch = async () => { calls++; throw new Error('unexpected fetch') }
    const result = await prepareDesktopNodeHeaders({ dest, preferRuntimeHeaders: true })
    assert.deepEqual(fs.readdirSync(result).sort(), [...names].sort())
    for (const name of names) assert.equal(hash(fs.readFileSync(path.join(result, name))), officialPins[name])
    assert.equal(calls, 0)
  } finally { Object.defineProperty(process, 'execPath', descriptor); globalThis.fetch = original }
})

test('missing runtime headers use the original download path', async t => {
  assert.equal(process.platform, 'darwin'); assert.equal(process.version, 'v22.23.4')
  const f = fixture(t), dest = path.join(f.root, 'output'), originalFetch = globalThis.fetch
  const descriptor = Object.getOwnPropertyDescriptor(process, 'execPath'); let calls = 0
  const expected = new Error('owned fetch sentinel')
  try {
    Object.defineProperty(process, 'execPath', { ...descriptor, value: path.join(f.root, 'missing', 'bin', 'node') })
    globalThis.fetch = async url => { calls++; assert.equal(url, DESKTOP_WINDOWS_INPUTS.headers.url); throw expected }
    await assert.rejects(() => prepareDesktopNodeHeaders({ dest, preferRuntimeHeaders: true }), error => error === expected)
    assert.equal(calls, 1)
  } finally { Object.defineProperty(process, 'execPath', descriptor); globalThis.fetch = originalFetch }
})

test('archive appearing during runtime staging still receives original integrity check', async t => {
  assert.equal(process.platform, 'darwin'); assert.equal(process.version, 'v22.23.4')
  const f = fixture(t), dest = path.join(f.root, 'output')
  fs.mkdirSync(dest)
  const archive = path.join(fs.realpathSync(dest), '.desktop-sdk-build', `headers-${DESKTOP_WINDOWS_INPUTS.headers.sha256}`)
  const originalStat = fs.lstatSync, originalFetch = globalThis.fetch; let checks = 0, calls = 0
  const descriptor = Object.getOwnPropertyDescriptor(process, 'execPath')
  try {
    Object.defineProperty(process, 'execPath', { ...descriptor, value: ownedRuntime(f.root) })
    fs.lstatSync = function (file, ...args) {
      if (file === archive && ++checks === 2) fs.writeFileSync(archive, 'corrupt', { flag: 'wx' })
      return originalStat.call(this, file, ...args)
    }
    globalThis.fetch = async () => { calls++; throw new Error('unexpected fetch') }
    await assert.rejects(() => prepareDesktopNodeHeaders({ dest, preferRuntimeHeaders: true }), /DESKTOP_SDK_INTEGRITY/)
    assert.equal(checks, 3); assert.equal(calls, 0)
    assert.equal(fs.readFileSync(archive, 'utf8'), 'corrupt')
  } finally { Object.defineProperty(process, 'execPath', descriptor); fs.lstatSync = originalStat; globalThis.fetch = originalFetch }
})

test('Windows preference keeps the original download route', async t => {
  const f = fixture(t), dest = path.join(f.root, 'output'), originalFetch = globalThis.fetch
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform'); let calls = 0
  const expected = new Error('owned fetch sentinel')
  try {
    Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' })
    globalThis.fetch = async url => { calls++; assert.equal(url, DESKTOP_WINDOWS_INPUTS.headers.url); throw expected }
    await assert.rejects(() => prepareDesktopNodeHeaders({ dest, preferRuntimeHeaders: true }), error => error === expected)
    assert.equal(calls, 1)
  } finally { Object.defineProperty(process, 'platform', descriptor); globalThis.fetch = originalFetch }
})

test('macOS native header consumers only request members in the pinned set', () => {
  for (const file of [
    '../../src/desktop/native/launcher.c',
    '../../tests/fixtures/desktop-480/inheritable-sentinel.c',
    '../../tests/fixtures/desktop-480/construction-failure.c',
  ]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    const includes = [...source.matchAll(/^\s*#\s*include\s*[<"]((?:node|js_native)[^>"]+)[>"]/gm)].map(m => m[1])
    assert.ok(includes.length, file)
    for (const name of includes) assert.ok(names.includes(name), `${file}: ${name}`)
  }
})

test('unsafe or empty existing archive is refused without fetching', async t => {
  for (const kind of ['symlink', 'hardlink', 'empty']) {
    const f = fixture(t), dest = path.join(f.root, 'output'), cache = path.join(dest, '.desktop-sdk-build')
    fs.mkdirSync(cache, { recursive: true })
    const archive = path.join(cache, `headers-${DESKTOP_WINDOWS_INPUTS.headers.sha256}`)
    const other = path.join(f.root, 'other'); fs.writeFileSync(other, 'untrusted')
    if (kind === 'symlink') fs.symlinkSync(other, archive)
    else if (kind === 'hardlink') fs.linkSync(other, archive)
    else fs.writeFileSync(archive, '')
    const original = globalThis.fetch; let calls = 0
    try {
      globalThis.fetch = async () => { calls++; throw new Error('unexpected fetch') }
      await assert.rejects(() => prepareDesktopNodeHeaders({ dest, preferRuntimeHeaders: true }), kind === 'empty' ? /DESKTOP_SDK_INPUT_LIMIT/ : /DESKTOP_SDK_FILE_IDENTITY/)
      assert.equal(calls, 0)
    } finally { globalThis.fetch = original }
  }
})
