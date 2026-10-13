import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { officeTarget, verifyOfficeEngine, stageOfficeRuntime } from '../stage-office-runtime.mjs'

test('Office target selects published Linux WASM and exact native architecture', () => {
  assert.equal(officeTarget('linux-arm64').engine, '@deepseek-ai/libreoffice-kit-wasm')
  assert.equal(officeTarget('windows-x64').engine, '@deepseek-ai/libreoffice-kit-win32-x64')
  assert.equal(officeTarget('macos-arm64').engine, '@deepseek-ai/libreoffice-kit-darwin-arm64')
  assert.throws(() => officeTarget('linux-ia32'), /Unsupported/)
})

test('Staging keeps dependency layout and matching optional payload; omissions fail closed', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'office graph '))
  const source = path.join(temporary, 'source')
  const destination = path.join(temporary, 'destination 中文')
  const engine = officeTarget('linux-arm64').engine
  const entry = '@deepseek-ai/libreoffice-kit'
  function pkg(name, data, files = {}) {
    const root = path.join(source, 'node_modules', name)
    fs.mkdirSync(root, {recursive:true})
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name,version:'0.1.5',...data}))
    for (const [name, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), {recursive:true})
      fs.writeFileSync(path.join(root, name), contents)
    }
    return root
  }
  try {
    fs.mkdirSync(source, {recursive:true})
    fs.writeFileSync(path.join(source, 'package.json'), '{}')
    pkg(entry, {dependencies:{'native-adapter':'1.0.0'},optionalDependencies:{[engine]:'0.1.5','@deepseek-ai/libreoffice-kit-win32-x64':'0.1.5'}},
      {'lib/index.js':'entry','lib/worker.js':'worker','lib/font-snapshot-worker.js':'fonts',LICENSE:'license',NOTICE:'notice'})
    pkg('native-adapter', {optionalDependencies:{'native-linux-arm64':'1.0.0','native-win32-x64':'1.0.0'}}, {LICENSE:'native license'})
    pkg('native-linux-arm64', {os:['linux'],cpu:['arm64']}, {'binary.node':'binary'})
    fs.writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({packages:{'node_modules/native-linux-arm64':{os:['linux'],cpu:['arm64']},'node_modules/native-win32-x64':{os:['win32'],cpu:['x64']}}}))
    const bytes = {'loader.js':'loader','engine.wasm':'wasm','engine.data':'data','metadata.json':'metadata','sources/recipe.json':'recipe','licenses/MPL.txt':'mpl'}
    const files = Object.fromEntries(Object.entries(bytes).map(([name, data]) => [name, createHash('sha256').update(data).digest('hex')]))
    const manifest = {schemaVersion:1,version:'0.1.5',platform:'wasm',status:'built',engine:{kind:'wasm',loader:'loader.js',wasm:'engine.wasm',data:'engine.data',metadata:'metadata.json'},files}
    pkg(engine, {os:['linux']}, {...bytes,'prebuilds.json':JSON.stringify(manifest)})
    const record = stageOfficeRuntime({source,destination,platform:'linux-arm64'})
    assert.equal(record.engine, engine)
    assert.ok(fs.existsSync(path.join(destination,'node_modules',entry,'lib/worker.js')))
    assert.ok(fs.existsSync(path.join(destination,'node_modules/native-linux-arm64/binary.node')))
    assert.ok(fs.existsSync(path.join(destination,'node_modules',engine,'licenses/MPL.txt')))
    assert.ok(!fs.existsSync(path.join(destination,'node_modules/native-win32-x64')))
    fs.rmSync(path.join(source,'node_modules/native-linux-arm64'), {recursive:true})
    assert.throws(() => stageOfficeRuntime({source,destination,platform:'linux-arm64'}), /Required matching.*missing/)
  } finally {fs.rmSync(temporary,{recursive:true,force:true})}
})

test('Engine integrity gate detects corruption, missing resources and wrong versions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office manifest '))
  const target = officeTarget('linux-arm64')
  try {
    const files = {}
    for (const name of ['loader.js', 'engine.wasm', 'engine.data', 'metadata.json', 'sources/recipe.json', 'licenses/MPL.txt']) {
      const file = path.join(root, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, name)
      files[name] = createHash('sha256').update(name).digest('hex')
    }
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: target.engine, version: '0.1.5' }))
    const manifest = {schemaVersion:1,version:'0.1.5',platform:'wasm',status:'built',engine:{kind:'wasm',loader:'loader.js',wasm:'engine.wasm',data:'engine.data',metadata:'metadata.json'},files}
    const save = () => fs.writeFileSync(path.join(root, 'prebuilds.json'), JSON.stringify(manifest))
    save()
    verifyOfficeEngine(root, target.engine, target)
    fs.appendFileSync(path.join(root, 'engine.wasm'), 'corruption')
    assert.throws(() => verifyOfficeEngine(root, target.engine, target), /integrity mismatch/)
    fs.writeFileSync(path.join(root, 'engine.wasm'), 'engine.wasm')
    manifest.version = '0.1.4'; save()
    assert.throws(() => verifyOfficeEngine(root, target.engine, target), /manifest mismatch/)
    manifest.version = '0.1.5'; save()
    fs.rmSync(path.join(root, 'licenses'), { recursive: true })
    assert.throws(() => verifyOfficeEngine(root, target.engine, target), /ENOENT|missing/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
