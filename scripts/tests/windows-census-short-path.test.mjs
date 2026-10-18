import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as census from '../windows-census.mjs'
const helperURL = new URL('../windows-census-owned-short-path.mjs', import.meta.url)
const helper = fs.existsSync(helperURL) ? await import(helperURL.href) : {}
const expected = path.join(os.tmpdir(), 'owned-run-uuid', 'canonical short alias owned')
const short = path.join(os.tmpdir(), 'owned-run-uuid', 'CANONI~1')
function model() {
  let replaced = false, link = false, inode = 42n, zero = false
  const stat = { dev: 2n, ino: inode, isDirectory: () => true, isSymbolicLink: () => false }
  const io = { realpathSync: { native: p => p === short || p === expected ? expected : p },
    lstatSync: (p, options) => { assert.equal(options.bigint, true); return { ...stat, ino: zero ? 0n : replaced ? 99n : inode, isSymbolicLink: () => link } } }
  return { io, replace: () => { replaced = true }, symlink: () => { link = true }, zero: () => { zero = true } }
}
test('owned canonical long/8.3 alias is prepared with same nonzero filesystem identity', () => {
  assert.equal(typeof helper.prepareOwnedShortRoots, 'function')
  const m = model(), roots = helper.prepareOwnedShortRoots(expected, short, expected, m.io)
  assert.equal(roots.longRoot, expected); assert.equal(roots.shortRoot, short); roots.validate()
  assert.ok(Object.isFrozen(roots))
})
test('missing/foreign/equal/nonalias/newline locators never enter a child environment', () => {
  assert.equal(typeof helper.prepareOwnedShortRoots, 'function')
  for (const [a, b] of [[undefined, short], [expected, undefined], [expected, expected], [expected, short.replace('CANONI~1', 'ordinary')],
    [expected + '\n', short], [expected, short + '\n'], [path.join(os.tmpdir(), 'foreign'), short]]) {
    assert.throws(() => helper.prepareOwnedShortRoots(a, b, expected, model().io), { message: 'CENSUS_OWNED_SHORT_ROOT_INVALID' })
  }
})
test('symlink and zero inode cannot be admitted as a native 8.3 alias', () => {
  assert.equal(typeof helper.prepareOwnedShortRoots, 'function')
  for (const state of ['symlink', 'zero']) { const m = model(); m[state](); assert.throws(() => helper.prepareOwnedShortRoots(expected, short, expected, m.io), { message: 'CENSUS_OWNED_SHORT_ROOT_INVALID' }) }
})
test('replacement or reparse after admission fails before stage use', () => {
  assert.equal(typeof helper.prepareOwnedShortRoots, 'function')
  for (const state of ['replace', 'symlink']) { const m = model(), roots = helper.prepareOwnedShortRoots(expected, short, expected, m.io); m[state](); assert.throws(roots.validate, { message: 'CENSUS_OWNED_SHORT_ROOT_INVALID' }) }
})
test('real owned ordinary directory is refused as its own short alias, no filesystem writes by helper', () => {
  assert.equal(typeof helper.prepareOwnedShortRoots, 'function')
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'census-short-negative-')))
  try { assert.throws(() => helper.prepareOwnedShortRoots(dir, dir, dir), { message: 'CENSUS_OWNED_SHORT_ROOT_INVALID' }); assert.deepEqual(fs.readdirSync(dir), []) }
  finally { fs.rmdirSync(dir) }
})
test('only tests stage receives exact validated roots; ambient roots never enter generic environment', () => {
  const base = census.childEnvironment({ PATH: 'owned', CMSPARK_TEST_LONG_ROOT: 'foreign', CMSPARK_TEST_SHORT_ROOT: 'foreign', SECRET: 'not forwarded' }, 'workspace', 'temp')
  assert.equal('CMSPARK_TEST_LONG_ROOT' in base, false); assert.equal('CMSPARK_TEST_SHORT_ROOT' in base, false)
  let calls = 0
  const options = { uncShare: '\\\\127.0.0.1\\cmspark650_123_1_0123456789abcdef0123456789abcdef', run: '123', attempt: '1', receipts: 'owned', reporter: 'file:///owned.mjs', shortRoots: { longRoot: expected, shortRoot: short, validate: () => { calls++ } } }
  for (const name of ['install', 'build', 'stage']) assert.equal(census.censusStageEnvironment(name, base, options), base)
  const actual = census.censusStageEnvironment('tests', base, options)
  assert.equal(actual.CMSPARK_TEST_LONG_ROOT, expected); assert.equal(actual.CMSPARK_TEST_SHORT_ROOT, short); assert.equal(calls, 1); assert.equal('SECRET' in actual, false)
  assert.throws(() => census.censusStageEnvironment('tests', base, { ...options, shortRoots: undefined }), { message: 'CENSUS_OWNED_SHORT_ROOT_INVALID' })
})
test('fixed workflow creates real Win32 long/short alias inside already-owned SMB directory and removes both env names', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const step = workflow.split('Complete Windows Companion census (#650)')[1].split('Windows census finite public receipts')[0]
  assert.match(step, /GetShortPathName/); assert.match(step, /GetLongPathName/)
  assert.match(step, /Join-Path \$fixture 'canonical short alias owned'/)
  for (const key of ['CMSPARK_TEST_LONG_ROOT', 'CMSPARK_TEST_SHORT_ROOT']) { assert.ok(step.includes('$env:' + key + ' =')); assert.ok(step.includes('Remove-Item Env:' + key)) }
  assert.ok(step.indexOf('$env:CMSPARK_TEST_SHORT_ROOT =') < step.indexOf('node scripts/windows-census.mjs'))
})
test('launcher binds roots to current validated share child and checks identity around every canonical stage', () => {
  const source = fs.readFileSync(new URL('../windows-census.mjs', import.meta.url), 'utf8')
  assert.ok(source.includes("uncShare.split('\\\\').at(-1), 'canonical short alias owned'"))
  assert.ok(source.includes('receipts, shortRoots, reporter:'))
  assert.match(source, /shortRoots\.validate\(\)\s+const stage = await captureStage/)
  assert.match(source, /progress\)\s+stages\.push\([^\n]+\n\s+shortRoots\.validate\(\)/)
})

test('a post-child fixture replacement still records closed raw before fail-closed sealing', async () => {
  const { pathToFileURL } = await import('node:url')
  const { sealEvidence } = await import('../windows-census-evidence.mjs')
  const { randomUUID } = await import('node:crypto')
  const source = fs.readFileSync(new URL('../windows-census.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("    for (const [name, args] of [['install', ['ci']], ['build'")
  const end = source.indexOf('\n    const tests = stages.find(', start)
  assert.ok(start > 0 && end > start)
  const loop = source.slice(start, end)
  const execute = new (Object.getPrototypeOf(async function () {}).constructor)('d', `const {gitConfig,shortRoots,censusStageEnvironment,env,process,uncShare,receipts,root,path,pathToFileURL,npmPath,companion,raw,progress,stageSucceeded,captureStage}=d;const stages=[];let result={outcome:'INCOMPLETE',stages};let failure=null;try{${loop}}catch(error){failure=error.message;result={...result,outcome:'INCOMPLETE',error_code:failure};}return {result,failure};`)
  const repo = fs.realpathSync.native(path.resolve(import.meta.dirname, '../..'))
  for (const replace of [false, true]) {
    const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'census-short-settled-'))
    try {
      for (const d of ['raw', 'receipts', 'public']) fs.mkdirSync(path.join(owned, d), { mode: 0o700 })
      const long = path.join(owned, 'canonical short alias owned'), alias = path.join(owned, 'CANONI~1')
      fs.mkdirSync(long)
      // Real owned directory/inode and child; only Darwin's unavailable 8.3 lookup is modeled.
      const io = { realpathSync: { native: p => fs.realpathSync.native(p === alias ? long : p) }, lstatSync: (p, options) => fs.lstatSync(p === alias ? long : p, options) }
      const shortRoots = helper.prepareOwnedShortRoots(fs.realpathSync.native(long), alias, long, io)
      let children = 0
      const deps = { gitConfig: { validate() {} }, shortRoots, censusStageEnvironment: census.censusStageEnvironment,
        env: { PATH: path.dirname(process.execPath) }, process: { execPath: process.execPath, env: { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' } },
        uncShare: '\\\\127.0.0.1\\cmspark650_123_1_0123456789abcdef0123456789abcdef', receipts: path.join(owned, 'receipts'), root: repo, path, pathToFileURL,
        npmPath: 'inert-not-executed-npm', companion: owned, raw: path.join(owned, 'raw'), stageSucceeded: census.stageSucceeded,
        progress: census.createStageProgress((name, value) => fs.writeFileSync(path.join(owned, 'public', name), JSON.stringify(value), { flag: 'wx', mode: 0o600 }), () => {}),
        captureStage: async (_command, _argv, options, progress) => {
          const body = `const fs=require('node:fs');${replace ? `fs.renameSync(${JSON.stringify(long)},${JSON.stringify(long + '-retired')});fs.mkdirSync(${JSON.stringify(long)});` : ''}process.stdout.write('INERT_OWNED_STDOUT');process.stderr.write('INERT_OWNED_STDERR');`
          const stage = await census.captureStage(process.execPath, ['-e', body], { ...options, cwd: owned }, progress)
          children++; assert.equal(stage.code, 0); assert.ok(stage.files.every(f => f.complete && f.gap_bytes === 0))
          return stage
        } }
      const { result, failure } = await execute(deps)
      assert.equal(children, replace ? 1 : 4)
      assert.equal(failure, replace ? 'CENSUS_OWNED_SHORT_ROOT_INVALID' : null)
      assert.equal(result.stages.length, children, 'every already-settled child remains in the sealing input ledger')
      const sealed = await sealEvidence({ owned, publicDir: path.join(owned, 'public'), identity: {
        head: 'a'.repeat(40), tree: 'b'.repeat(40), run: '123', attempt: '1', namespace: randomUUID(),
      }, result })
      assert.equal(sealed.files, children * 2)
      assert.equal(sealed.status.capture_loss, false)
      // This fixture deliberately has no canonical TAP/receipts, so even stable children are not full-suite PASS.
      assert.equal(sealed.status.outcome, 'INCOMPLETE')
    } finally { fs.rmSync(owned, { recursive: true, force: true }) }
  }
})
