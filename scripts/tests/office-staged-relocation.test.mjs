import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { stageOfficeRuntime, verifyOfficeEngine, officeTarget } from '../stage-office-runtime.mjs'
import { removeOfficeSmokeRuntime } from '../office-smoke-cleanup.mjs'

const scriptURL = new URL('../smoke-office-runtime.mjs', import.meta.url)
const source = fs.readFileSync(scriptURL, 'utf8')
// Run the actual CLI body with inert imports and an explicit no-spawn boundary.
// The generated Office probe is written as text, never evaluated or executed.
assert.equal(source.match(/^import .*$/gm)?.length, 7)
assert.equal(source.match(/import\.meta\.url/g)?.length, 1)
const body = source.replace(/^import .*$/gm, '').replace('import.meta.url', 'sourceURL')

function fixture(run) {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'office staged 中文 '))
  const source = path.join(owned, 'source'), staged = path.join(owned, 'staged')
  const runtime = path.join(owned, 'inert-node.exe'), scratch = path.join(owned, 'scratch')
  const engineName = officeTarget('windows-x64').engine
  const pkg = (name, data, files) => {
    const root = path.join(source, 'node_modules', name)
    fs.mkdirSync(root, {recursive:true})
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name,version:'0.1.5',...data}))
    for (const [name, bytes] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), {recursive:true})
      fs.writeFileSync(path.join(root, name), bytes)
    }
  }
  try {
    fs.mkdirSync(source)
    fs.mkdirSync(scratch)
    fs.writeFileSync(runtime, 'owned inert bytes; never executable', {mode:0o600})
    fs.writeFileSync(path.join(source,'package.json'), '{}')
    fs.writeFileSync(path.join(source,'package-lock.json'), JSON.stringify({packages:{}}))
    pkg('@deepseek-ai/libreoffice-kit', {dependencies:{'fixture-adapter':'0.1.5'},optionalDependencies:{[engineName]:'0.1.5'}},
      {'lib/index.js':'inert entry','lib/worker.js':'inert worker','lib/font-snapshot-worker.js':'inert fonts',LICENSE:'license',NOTICE:'notice'})
    pkg('fixture-adapter', {}, {'fixture.txt':'owned adapter'})
    const assets = {'program/engine.exe':'inert engine; never executed','sources/recipe.json':'recipe','licenses/MPL.txt':'license'}
    const files = Object.fromEntries(Object.entries(assets).map(([name, bytes]) => [name,createHash('sha256').update(bytes).digest('hex')]))
    pkg(engineName, {os:['win32'],cpu:['x64']}, {...assets,'prebuilds.json':JSON.stringify({schemaVersion:1,version:'0.1.5',platform:'win32-x64',status:'built',
      engine:{kind:'native',executable:'program/engine.exe',programDirectory:'program'},files})})
    fs.mkdirSync(path.join(source,'tests/fixtures/office-611'), {recursive:true})
    fs.writeFileSync(path.join(source,'tests/fixtures/office-611/one-page.doc'), 'owned inert document')
    // The record and staged tree come from the real producer, not a hand-written schema.
    const record = stageOfficeRuntime({source,destination:staged,platform:'windows-x64'})
    const engine = record.packages.find(pkg => pkg.name === engineName)
    run({owned,source,staged,runtime,scratch,record,engine})
  } finally { fs.rmSync(owned,{recursive:true,force:true}) }
}

function execute(f, overrides = {}, diagnosticThrows = false) {
  const evidence = [], reachedProbe = new Error('owned no-spawn boundary')
  let spawns = 0
  const context = vm.createContext({fs:{...fs,...overrides},os:{tmpdir:()=>f.scratch},path,fileURLToPath,sourceURL:scriptURL,
    stageOfficeRuntime,verifyOfficeEngine,officeTarget,removeOfficeSmokeRuntime,
    process:{argv:['node',fileURLToPath(scriptURL),'--source',f.source,'--platform','windows-x64','--staged',f.staged,'--runtime',f.runtime],
      execPath:f.runtime,platform:'win32',arch:'x64',env:{}},
    console:{log(){},error(value){if(diagnosticThrows)throw new Error('owned diagnostic refusal');evidence.push(JSON.parse(value))}},
    spawnSync(){spawns++;throw reachedProbe}})
  let failure
  try {new vm.Script(body,{filename:fileURLToPath(scriptURL)}).runInContext(context,{timeout:5000})} catch(error){failure=error}
  assert.deepEqual(fs.readdirSync(f.scratch), [], 'actual finally removed the owned relocation')
  return {failure,evidence,spawns,reachedProbe}
}

test('Staged Office actual producer and CLI relocate Unicode paths before the inert no-spawn boundary', () => fixture(f => {
  const r = execute(f)
  assert.equal(r.failure,r.reachedProbe)
  assert.equal(r.spawns,1)
  assert.deepEqual(r.evidence,[])
}))

test('Staged Office missing source metadata preserves the real post-copy ENOENT and finite states', () => fixture(f => {
  fs.unlinkSync(path.join(f.staged,f.engine.path,'package.json'))
  const r = execute(f)
  assert.equal(r.failure?.code,'ENOENT')
  assert.equal(r.spawns,0)
  assert.equal(r.evidence.length,1)
  const e = r.evidence[0]
  assert.equal(e.schema,'office-staged-relocation-v1')
  assert.equal(e.phase,'verify')
  for(const snapshot of [e.source,e.afterCopy,e.beforeVerify]) assert.deepEqual(snapshot,[['directory','directory'],['missing','missing'],['file','file']])
  assert.ok(Buffer.byteLength(JSON.stringify(e))<1024)
  assert.ok(!JSON.stringify(e).includes(f.owned))
}))

test('Staged Office controlled destination omission distinguishes intact source without claiming a Node copy defect', () => fixture(f => {
  const r = execute(f,{cpSync(from,to,options){fs.cpSync(from,to,options);if(from===path.join(f.staged,f.engine.path))fs.unlinkSync(path.join(to,'package.json'))}})
  assert.equal(r.failure?.code,'ENOENT')
  assert.equal(r.spawns,0)
  assert.equal(r.evidence[0].phase,'verify')
  assert.deepEqual(r.evidence[0].source,[['directory','directory'],['file','file'],['file','file']])
  for(const snapshot of [r.evidence[0].afterCopy,r.evidence[0].beforeVerify]) assert.deepEqual(snapshot,[['directory','directory'],['missing','missing'],['file','file']])
}))

test('Staged Office missing package directory remains a copy failure before engine verification or spawn', () => fixture(f => {
  fs.rmSync(path.join(f.staged,f.engine.path),{recursive:true})
  const r = execute(f)
  assert.equal(r.failure?.code,'ENOENT')
  assert.equal(r.spawns,0)
  assert.equal(r.evidence[0].phase,'copy')
  assert.equal(r.evidence[0].copyIndex,f.record.packages.indexOf(f.engine))
  assert.deepEqual(r.evidence[0].source,[['missing','missing'],['missing','missing'],['missing','missing']])
  assert.equal(r.evidence[0].afterCopy,null)
  assert.equal(r.evidence[0].beforeVerify,null)
}))

test('Staged Office diagnostic writer failure cannot replace the original filesystem error', () => fixture(f => {
  fs.unlinkSync(path.join(f.staged,f.engine.path,'package.json'))
  const r = execute(f,{},true)
  assert.equal(r.failure?.code,'ENOENT')
  assert.equal(r.spawns,0)
  assert.deepEqual(r.evidence,[])
}))

test('Staged Office integrity corruption still refuses before any runtime spawn', () => fixture(f => {
  fs.appendFileSync(path.join(f.staged,f.engine.path,'program/engine.exe'),'corrupt')
  const r = execute(f)
  assert.match(r.failure?.message,/Office engine integrity mismatch/)
  assert.equal(r.spawns,0)
  assert.equal(r.evidence[0].phase,'verify')
  assert.deepEqual(r.evidence[0].source,[['directory','directory'],['file','file'],['file','file']])
}))
