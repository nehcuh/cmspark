/** Failure-evidence boundaries only. No xcode, no product host, no extra probe. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import {createHash} from 'node:crypto'

const TEXT_CAP = 262144
const TREE_CAP = 33554432
const EVIDENCE = "if(primaryFailed)try{require('./helpers/picker-failure-evidence-476').preservePickerFailureEvidence476(uiOwner)}catch{try{t.diagnostic('D476_PICKER_EVIDENCE_COPY_FAILED')}catch{}};"
const STDERR_NOTE = ";try{require('./picker-failure-evidence-476').notePickerToolStderr476(b)}catch{}"
const TIMING = 'try{cancelTiming788=uiOwner?.scene.cancelTiming788()??null}catch{}'
const PRIOR = 'try{if(primaryFailed)cancelTiming788=uiOwner?.scene.cancelTiming788()??null}catch{}'
const REMOVAL = 'fs.rmSync(dir,{recursive:true,force:true})'

function repoOf(start: string) {
  let dir = start
  for (;;) {
    if (fs.existsSync(path.join(dir, 'companion/package.json')) && fs.existsSync(path.join(dir, '.github/workflows/ci.yml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw Error('REPO_REQUIRED')
    dir = parent
  }
}
const repo = repoOf(__dirname)
const nativePath = path.join(repo, 'companion/tests/desktop-native-thread-metadata-476.test.ts')
const helperPath = path.join(repo, 'companion/tests/helpers/workspace-xctest-owned-705.ts')
const workflowPath = path.join(repo, '.github/workflows/ci.yml')
const read = (file: string) => fs.readFileSync(file, 'utf8')
const {restoreSuccessTiming476} = require(path.join(repo, 'companion/scripts/tests/success-timing-inverse.cjs'))
const {restorePickerWait} = require(path.join(repo, 'companion/scripts/tests/picker-wait-inverse.cjs'))

test('timing inverse still fails before the evidence sentence and before the old hash', () => {
  const source = read(nativePath)
  const broken = source.replace(TIMING, 'try{cancelTiming=uiOwner?.scene.cancelTiming788()??null}catch{}')
  assert.throws(() => restoreSuccessTiming476(broken), (error: any) => error?.code === 'ERR_ASSERTION' && String(error.message).includes('SUCCESS_TIMING_ONCE') && !String(error.message).includes('PICKER_EVIDENCE_ONCE') && !String(error.message).includes('9e80020d'))
  const historical = `${PRIOR} ${REMOVAL}`
  assert.equal(restoreSuccessTiming476(historical), historical)
  const slice = `prefix ${TIMING} suffix`
  assert.equal(restoreSuccessTiming476(slice).includes(PRIOR), true)
  const missing = source.replace(EVIDENCE, '')
  assert.throws(() => restoreSuccessTiming476(missing), (error: any) => error?.code === 'ERR_ASSERTION' && String(error.message).includes('PICKER_EVIDENCE_ONCE') && !String(error.message).includes('9e80020d') && !String(error.message).includes('SUCCESS_TIMING_ONCE'))
  assert.equal(source.split(EVIDENCE).length, 2)
  assert.doesNotThrow(() => restoreSuccessTiming476(source))
})

test('helper stderr note peels once before the old helper seal', () => {
  const helper = read(helperPath)
  const callback = helper.slice(helper.indexOf("child.stderr!.on('data'"), helper.indexOf("child.stdout!.on('end'"))
  assert.equal(callback.split(STDERR_NOTE).length, 2)
  assert.equal(callback.includes('spawn('), false)
  assert.equal(callback.includes('xcrun'), false)
  const missing = helper.replace(STDERR_NOTE, '')
  assert.throws(() => restorePickerWait('helper', missing), (error: any) => error?.code === 'ERR_ASSERTION' && String(error.message).includes('XCRESULT_STDERR_ONCE') && !String(error.message).includes('PICKER_WAIT_HELPER_SUCCESS') && !String(error.message).includes('56cb1183'))
  assert.equal(createHash('sha256').update(restorePickerWait('helper', helper)).digest('hex'), '56cb1183b0e057b879d11567424c5b325362e7dbfd373edeca4faa5dd73751e5')
})

test('old native and helper seals still match after both peels', () => {
  const native = read(nativePath)
  const opened = require(path.join(repo, 'companion/scripts/tests/host-tick-inverse.cjs')).restoreHostTick(restoreSuccessTiming476(native))
  const peeled = restorePickerWait('other', opened)
  const observed = require(path.join(repo, 'companion/scripts/tests/observation-788-inverse.mjs')).restoreObservation788(peeled)
  const restored = require('./fixtures/archive-first-failure-782').terminalAdmissionInverse801(observed)
  assert.equal(createHash('sha256').update(restored).digest('hex'), '5f225d624d4d83a55b76ebe0b7f82bbe1202dffda843139c674156ea72e2e018')
  const helper = restorePickerWait('helper', read(helperPath))
  const helperObserved = require(path.join(repo, 'companion/scripts/tests/observation-788-inverse.mjs')).restoreObservation788(helper)
  assert.equal(createHash('sha256').update(helperObserved).digest('hex'), '873b5ced054248db5af1b6b007104ec7f4095f34ff622b5335e751419c2eff3b')
})

test('workflow uploads the companion cwd evidence directory for seven days', () => {
  const yml = read(workflowPath)
  const acceptance = yml.indexOf('name: Native desktop interaction acceptance (#476)')
  const upload = yml.indexOf('name: Upload picker failure evidence (#476)')
  assert.ok(acceptance > 0 && upload > acceptance)
  const block = yml.slice(upload, upload + 700)
  assert.match(block, /if: always\(\) && matrix\.os == 'macos-latest'/)
  assert.equal(block.includes('continue-on-error'), false)
  assert.match(block, /path: companion\/picker-failure-evidence\//)
  assert.match(block, /retention-days: 7/)
  assert.match(block, /if-no-files-found: ignore/)
  const companion = path.join(repo, 'companion')
  assert.equal(path.resolve(companion, 'picker-failure-evidence'), path.join(repo, 'companion', 'picker-failure-evidence'))
})

function evidenceModule() {
  return require('./helpers/picker-failure-evidence-476')
}
function sceneFiles(root: string, files: Record<string, Buffer | 'dir'>) {
  fs.mkdirSync(root, {recursive: true, mode: 0o700})
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    if (value === 'dir') fs.mkdirSync(file)
    else fs.writeFileSync(file, value)
  }
}
function listed(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  const walk = (rel: string) => {
    for (const name of fs.readdirSync(path.join(dir, rel))) {
      const next = rel ? path.join(rel, name) : name
      const st = fs.lstatSync(path.join(dir, next))
      if (st.isSymbolicLink()) out.push(next)
      else if (st.isDirectory()) walk(next)
      else out.push(next)
    }
  }
  walk('')
  return out.sort()
}
function texts(dir: string) {
  return listed(dir).map(name => fs.readFileSync(path.join(dir, name)).toString('utf8')).join('\n')
}

test('failure evidence keeps only bounded whitelist bytes and never follows an outside link', () => {
  const mod = evidenceModule()
  const text = read(path.join(repo, 'companion/tests/helpers/picker-failure-evidence-476.ts'))
  assert.equal(text.includes('spawn('), false)
  assert.equal(text.includes('xcrun'), false)
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'picker-evidence-476-'))
  try {
    mod.resetPickerToolStderr476()
    const absent = path.join(parent, 'absent')
    const scene = path.join(absent, 'scene')
    sceneFiles(scene, {'xcode.stdout': Buffer.from('out'), 'xcode.stderr': Buffer.from('err'), 'input.json': Buffer.from('SECRET-INPUT')})
    mod.preservePickerFailureEvidence476({scene: {root: scene}}, absent)
    const dest = path.join(absent, 'picker-failure-evidence')
    const status = JSON.parse(fs.readFileSync(path.join(dest, 'evidence-status.json'), 'utf8'))
    assert.deepEqual(Object.keys(status.files).sort(), ['Result.xcresult', 'xcode.stderr', 'xcode.stdout', 'xcresulttool-stderr.txt'])
    assert.deepEqual(status.files['Result.xcresult'], {status: 'ABSENT', bytes: 0})
    assert.deepEqual(status.files['xcresulttool-stderr.txt'], {status: 'ABSENT', bytes: 0})
    assert.equal(status.files['xcode.stdout'].status, 'COPIED')
    assert.equal(fs.readFileSync(path.join(dest, 'xcode.stdout'), 'utf8'), 'out')
    assert.equal(listed(dest).includes('input.json'), false)
    assert.equal(JSON.stringify(status).includes('SECRET-INPUT'), false)

    mod.resetPickerToolStderr476()
    const exact = path.join(parent, 'exact')
    const exactScene = path.join(exact, 'scene')
    const tree = path.join(exactScene, 'Result.xcresult')
    fs.mkdirSync(path.join(tree, 'Data'), {recursive: true})
    fs.writeFileSync(path.join(tree, 'Data', 'body'), Buffer.alloc(TREE_CAP))
    fs.writeFileSync(path.join(exactScene, 'xcode.stdout'), Buffer.alloc(TEXT_CAP))
    fs.writeFileSync(path.join(exactScene, 'xcode.stderr'), Buffer.alloc(1))
    mod.notePickerToolStderr476(Buffer.alloc(TEXT_CAP, 7))
    mod.preservePickerFailureEvidence476({scene: {root: exactScene}}, exact)
    const exactDest = path.join(exact, 'picker-failure-evidence')
    const exactStatus = JSON.parse(fs.readFileSync(path.join(exactDest, 'evidence-status.json'), 'utf8'))
    assert.equal(exactStatus.files['Result.xcresult'].status, 'COPIED')
    assert.equal(exactStatus.files['Result.xcresult'].bytes, TREE_CAP)
    assert.equal(fs.statSync(path.join(exactDest, 'Result.xcresult/Data/body')).size, TREE_CAP)
    assert.equal(exactStatus.files['xcode.stdout'].bytes, TEXT_CAP)
    assert.equal(exactStatus.files['xcresulttool-stderr.txt'].status, 'COPIED')
    assert.equal(fs.statSync(path.join(exactDest, 'xcresulttool-stderr.txt')).size, TEXT_CAP)
    assert.equal(listed(exact).some(name => name.includes('staging')), false)

    mod.resetPickerToolStderr476()
    const over = path.join(parent, 'over')
    const overScene = path.join(over, 'scene')
    fs.mkdirSync(path.join(overScene, 'Result.xcresult/Data'), {recursive: true})
    fs.writeFileSync(path.join(overScene, 'Result.xcresult/Data/keep'), Buffer.alloc(TREE_CAP - 1))
    fs.writeFileSync(path.join(overScene, 'Result.xcresult/Data/extra'), Buffer.alloc(2))
    fs.writeFileSync(path.join(overScene, 'xcode.stdout'), Buffer.alloc(TEXT_CAP + 1))
    fs.writeFileSync(path.join(overScene, 'xcode.stderr'), Buffer.from('kept'))
    fs.writeFileSync(path.join(overScene, 'secret.txt'), Buffer.from('TOP-SECRET-OUTSIDE'))
    fs.symlinkSync(path.join(overScene, 'secret.txt'), path.join(overScene, 'Result.xcresult/Data/leak'))
    mod.notePickerToolStderr476(Buffer.alloc(TEXT_CAP, 1))
    mod.notePickerToolStderr476(Buffer.alloc(1, 2))
    mod.preservePickerFailureEvidence476({scene: {root: overScene}}, over)
    const overDest = path.join(over, 'picker-failure-evidence')
    const overStatus = JSON.parse(fs.readFileSync(path.join(overDest, 'evidence-status.json'), 'utf8'))
    assert.equal(overStatus.files['Result.xcresult'].status, 'OVERSIZE')
    assert.equal(fs.existsSync(path.join(overDest, 'Result.xcresult')), false)
    assert.equal(overStatus.files['xcode.stdout'].status, 'OVERSIZE')
    assert.equal(fs.existsSync(path.join(overDest, 'xcode.stdout')), false)
    assert.equal(overStatus.files['xcresulttool-stderr.txt'].status, 'OVERSIZE')
    assert.equal(fs.existsSync(path.join(overDest, 'xcresulttool-stderr.txt')), false)
    assert.equal(fs.readFileSync(path.join(overDest, 'xcode.stderr'), 'utf8'), 'kept')
    assert.equal(listed(over).some(name => name.includes('staging')), false)
    assert.equal(texts(overDest).includes('TOP-SECRET-OUTSIDE'), false)
    assert.equal(JSON.stringify(overStatus).includes('TOP-SECRET-OUTSIDE'), false)

    mod.resetPickerToolStderr476()
    const linked = path.join(parent, 'linked')
    const linkedScene = path.join(linked, 'scene')
    fs.mkdirSync(linkedScene, {recursive: true})
    fs.mkdirSync(path.join(linked, 'outside'), {recursive: true})
    fs.writeFileSync(path.join(linked, 'outside/secret.txt'), Buffer.from('TOP-SECRET-LINK'))
    fs.symlinkSync(path.join(linked, 'outside'), path.join(linkedScene, 'Result.xcresult'))
    fs.writeFileSync(path.join(linkedScene, 'xcode.stdout'), Buffer.from('still'))
    mod.preservePickerFailureEvidence476({scene: {root: linkedScene}}, linked)
    const linkedDest = path.join(linked, 'picker-failure-evidence')
    const linkedStatus = JSON.parse(fs.readFileSync(path.join(linkedDest, 'evidence-status.json'), 'utf8'))
    assert.equal(linkedStatus.files['Result.xcresult'].status, 'OVERSIZE')
    assert.equal(fs.existsSync(path.join(linkedDest, 'Result.xcresult')), false)
    assert.equal(texts(linkedDest).includes('TOP-SECRET-LINK'), false)
    assert.equal(fs.readFileSync(path.join(linkedDest, 'xcode.stdout'), 'utf8'), 'still')

    mod.resetPickerToolStderr476()
    const rename = path.join(parent, 'rename')
    const renameScene = path.join(rename, 'scene')
    fs.mkdirSync(path.join(renameScene, 'Result.xcresult'), {recursive: true})
    fs.writeFileSync(path.join(renameScene, 'Result.xcresult/body'), Buffer.from('tree'))
    const renameDest = path.join(rename, 'picker-failure-evidence')
    fs.mkdirSync(path.join(renameDest, 'Result.xcresult'), {recursive: true})
    fs.writeFileSync(path.join(renameDest, 'Result.xcresult/blocker'), Buffer.from('block'))
    mod.preservePickerFailureEvidence476({scene: {root: renameScene}}, rename)
    const renameStatus = JSON.parse(fs.readFileSync(path.join(renameDest, 'evidence-status.json'), 'utf8'))
    assert.equal(renameStatus.files['Result.xcresult'].status, 'COPY_FAILED')
    assert.equal(fs.existsSync(path.join(renameDest, 'Result.xcresult')), false)
    assert.equal(listed(rename).some(name => name.includes('staging')), false)

    mod.resetPickerToolStderr476()
    const fault = path.join(parent, 'fault')
    const faultScene = path.join(fault, 'scene')
    fs.mkdirSync(faultScene, {recursive: true})
    fs.mkdirSync(path.join(faultScene, 'xcode.stdout'))
    fs.writeFileSync(path.join(faultScene, 'xcode.stderr'), Buffer.from('err'))
    assert.doesNotThrow(() => mod.preservePickerFailureEvidence476({scene: {root: faultScene}}, fault))
    const faultStatus = JSON.parse(fs.readFileSync(path.join(fault, 'picker-failure-evidence/evidence-status.json'), 'utf8'))
    assert.equal(faultStatus.files['xcode.stdout'].status, 'COPY_FAILED')
    assert.equal(fs.existsSync(path.join(fault, 'picker-failure-evidence/xcode.stdout')), false)
    assert.equal(faultStatus.files['xcode.stderr'].status, 'COPIED')

    mod.resetPickerToolStderr476()
    mod.notePickerToolStderr476(Buffer.alloc(0))
    const quiet = path.join(parent, 'quiet')
    fs.mkdirSync(path.join(quiet, 'scene'), {recursive: true})
    fs.writeFileSync(path.join(quiet, 'scene/xcode.stdout'), Buffer.from('only'))
    mod.preservePickerFailureEvidence476({scene: {root: path.join(quiet, 'scene')}}, quiet)
    const quietStatus = JSON.parse(fs.readFileSync(path.join(quiet, 'picker-failure-evidence/evidence-status.json'), 'utf8'))
    assert.equal(quietStatus.files['xcresulttool-stderr.txt'].status, 'ABSENT')
    assert.equal(quietStatus.files['xcode.stdout'].status, 'COPIED')
    let spawned = 0
    const childProcess = require('node:child_process') as typeof import('node:child_process')
    const original = childProcess.spawn
    childProcess.spawn = ((...args: unknown[]) => { spawned++; return original.apply(childProcess, args as never) }) as typeof childProcess.spawn
    try { mod.notePickerToolStderr476(Buffer.from('later')); mod.preservePickerFailureEvidence476(undefined, path.join(parent, 'spawn')) }
    finally { childProcess.spawn = original }
    assert.equal(spawned, 0)
  } finally { fs.rmSync(parent, {recursive: true, force: true}) }
})

test('failure evidence bounds reads while the source grows and clears old copies when the scene is gone', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'picker-growing-476-'))
  const scene = path.join(root, 'scene')
  const stdout = path.join(scene, 'xcode.stdout')
  const dest = path.join(root, 'picker-failure-evidence')
  const mod = evidenceModule()
  try {
    sceneFiles(scene, {'xcode.stdout': Buffer.from('initial'), 'xcode.stderr': Buffer.from('previous')})
    const originalRead = fs.readSync
    let grown = false
    const hook = t.mock.method(fs, 'readSync', (...args: Parameters<typeof fs.readSync>) => {
      if (!grown) {
        grown = true
        fs.appendFileSync(stdout, Buffer.alloc(TEXT_CAP))
        assert.equal((args as unknown[])[3], 'initial'.length + 1)
      }
      return Reflect.apply(originalRead, fs, args)
    })
    try { mod.preservePickerFailureEvidence476({scene: {root: scene}}, root) }
    finally { hook.mock.restore() }
    assert.equal(grown, true)
    const status = () => JSON.parse(fs.readFileSync(path.join(dest, 'evidence-status.json'), 'utf8'))
    assert.deepEqual(status().files['xcode.stdout'], {status: 'OVERSIZE', bytes: 0})
    assert.equal(fs.existsSync(path.join(dest, 'xcode.stdout')), false)
    assert.equal(fs.existsSync(path.join(dest, 'xcode.stderr')), true)
    mod.preservePickerFailureEvidence476(undefined, root)
    assert.deepEqual(status().files['xcode.stderr'], {status: 'ABSENT', bytes: 0})
    assert.equal(fs.existsSync(path.join(dest, 'xcode.stderr')), false)
  } finally { fs.rmSync(root, {recursive: true, force: true}) }
})

test('actual cleanup copies after it returns and before rm, and a copy fault keeps the original failure', async () => {
  const source = read(nativePath)
  const ast = ts.createSourceFile(nativePath, source, ts.ScriptTarget.Latest, true)
  let block: ts.Block | undefined
  const visit = (n: ts.Node) => { if (ts.isTryStatement(n) && n.finallyBlock?.getText(ast).includes('preservePickerFailureEvidence476')) block = n.finallyBlock; ts.forEachChild(n, visit) }
  visit(ast)
  assert.ok(block)
  const start = block.statements.findIndex(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'uiClosed'))
  assert.ok(start >= 0)
  const body = block.statements.slice(start).map(n => n.getText(ast)).join('\n')
  const cleanupAt = body.indexOf('await uiOwner?.cleanup()')
  const evidenceAt = body.indexOf('preservePickerFailureEvidence476')
  const removeAt = body.indexOf(REMOVAL)
  assert.ok(cleanupAt >= 0 && evidenceAt > cleanupAt && removeAt > evidenceAt)
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'picker-order-476-'))
  try {
    for (const mode of ['failed', 'cleanupFailed', 'success', 'copyThrows'] as const) {
      const cwd = path.join(parent, mode)
      const dir = path.join(cwd, 'scene-parent')
      const scene = path.join(dir, 'scene')
      fs.mkdirSync(scene, {recursive: true})
      fs.writeFileSync(path.join(scene, 'xcode.stdout'), Buffer.from(mode))
      const order: string[] = []
      const primary = Error('owned-primary')
      const run = vm.runInNewContext('(async()=>{try{throw primary}finally{' + body + '}})', {
        primary, primaryFailed: mode !== 'success', old: undefined, dir, process: {env: {}},
        t: {diagnostic(line: string) { order.push(line) }},
        uiOwner: {scene: {root: scene}, async cleanup() { order.push('cleanup'); if (mode === 'cleanupFailed') throw Error('owned-lifetime') }, observeRootRemoval826() { order.push('removed') }},
        fs: {...fs, rmSync(...args: unknown[]) { order.push('rm'); return fs.rmSync(...(args as Parameters<typeof fs.rmSync>)) }},
        surfaceLease: {settled() { order.push('settled') }},
        require(id: string) {
          assert.equal(id, './helpers/picker-failure-evidence-476')
          return {preservePickerFailureEvidence476(owner: {scene: {root: string}}) {
            order.push('evidence')
            if (mode === 'copyThrows') throw Error('owned-copy')
            evidenceModule().preservePickerFailureEvidence476(owner, cwd)
          }}
        },
      })
      const error = await run().then(() => undefined, (value: unknown) => value)
      assert.equal(error, mode === 'copyThrows' || mode === 'failed' || mode === 'cleanupFailed' ? primary : primary)
      if (mode === 'success') {
        assert.deepEqual(order, ['cleanup', 'rm', 'removed', 'settled'])
        assert.equal(fs.existsSync(path.join(cwd, 'picker-failure-evidence')), false)
      } else if (mode === 'cleanupFailed') {
        assert.deepEqual(order, ['cleanup', 'D476_WORKSPACE_UI_LIFETIME_UNKNOWN', 'evidence'])
        assert.equal(fs.existsSync(dir), true)
        assert.equal(fs.readFileSync(path.join(cwd, 'picker-failure-evidence/xcode.stdout'), 'utf8'), mode)
      } else if (mode === 'copyThrows') {
        assert.equal(error, primary)
        assert.equal(order.includes('D476_PICKER_EVIDENCE_COPY_FAILED'), true)
        assert.equal(order.includes('rm'), true)
      } else {
        assert.deepEqual(order.slice(0, 3), ['cleanup', 'evidence', 'rm'])
        assert.equal(fs.readFileSync(path.join(cwd, 'picker-failure-evidence/xcode.stdout'), 'utf8'), mode)
        assert.equal(fs.existsSync(dir), false)
      }
    }
  } finally { fs.rmSync(parent, {recursive: true, force: true}) }
})
