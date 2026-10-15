import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { capture, childEnvironment, prepareOwnedGitConfig } from '../windows-census.mjs'
import * as census from '../windows-census.mjs'
import { installLockedDependencies } from '../windows-census-install.mjs'

const root = fs.realpathSync(path.resolve(import.meta.dirname, '../..'))
const owned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-census-cli-')))
fs.chmodSync(owned, 0o700)
const raw = path.join(owned, 'raw'); fs.mkdirSync(raw, { mode: 0o700 })
// Even on hosted Windows this negative must not start a real census or read a key.
const env = { ...childEnvironment(process.env, owned, raw), GITHUB_ACTIONS: 'false' }
test.after(() => console.log('CENSUS_CLI_CONTROL_RETAINED ' + owned))
for (const name of ['windows-census', 'recover-windows-census', 'windows-census-install']) {
  test(`${name} actual symlink CLI entry/no-args is a refusal, never silent exit0`, async () => {
    const source = path.join(root, 'scripts', name + '.mjs'), alias = path.join(owned, name + '-alias.mjs')
    fs.symlinkSync(source, alias, 'file')
    const direct = await capture(process.execPath, [source], { cwd: owned, env, raw, name: name + '-direct' })
    assert.equal(direct.code, 1)
    const aliased = await capture(process.execPath, [alias], { cwd: owned, env, raw, name: name + '-alias' })
    fs.writeFileSync(path.join(owned, name + '-proof.json'), JSON.stringify({ direct, aliased }, null, 2))
    assert.equal(aliased.code, 1)
    assert.equal(fs.readFileSync(path.join(raw, name + '-alias.stdout'), 'utf8'), '')
    assert.match(fs.readFileSync(path.join(raw, name + '-alias.stderr'), 'utf8'), /^CENSUS_[A-Z_]+\r?\n$/)
  })
}
test('all census CLI modules remain inert when imported, including a missing non-file argv1', async () => {
  const entry = ['windows-census', 'recover-windows-census', 'windows-census-install'].map(name => 'await import(' + JSON.stringify(pathToFileURL(path.join(root, 'scripts', name + '.mjs')).href) + ');').join('') + 'console.log("OWNED_IMPORT_ONLY");'
  const r = await capture(process.execPath, ['--input-type=module', '-e', entry, 'OWNED_NONEXISTENT_ARGV'], { cwd: owned, env, raw, name: 'import-only' })
  assert.equal(r.code, 0)
  assert.equal(fs.readFileSync(path.join(raw, 'import-only.stdout'), 'utf8').trim(), 'OWNED_IMPORT_ONLY')
  assert.equal(fs.readFileSync(path.join(raw, 'import-only.stderr'), 'utf8'), '')
})

function progressFixture(label, fail = null) {
  const directory = fs.mkdtempSync(path.join(owned, label + '-'))
  const privateRaw = path.join(directory, 'raw'), publicDir = path.join(directory, 'public')
  fs.mkdirSync(privateRaw); fs.mkdirSync(publicDir)
  const lines = []
  const progress = census.createStageProgress((name, value) => {
    if (fail === name) throw Error('PRIVATE_WRITER_ERROR_SENTINEL')
    fs.writeFileSync(path.join(publicDir, name), JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 })
  }, line => {
    if (fail === 'emit') throw Error('PRIVATE_EMITTER_ERROR_SENTINEL')
    lines.push(line)
  })
  return { directory, privateRaw, publicDir, lines, progress }
}
const childScript = 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],"owned-done");console.log("PRIVATE_STDOUT_SENTINEL");console.error("PRIVATE_STDERR_SENTINEL");process.exitCode=Number(process.argv[2]);'
const runStage = (f, name = 'install', code = 0, io) => census.captureStage(process.execPath,
  ['-e', childScript, path.join(f.directory, name + '.marker'), String(code)],
  { cwd: f.directory, env, raw: f.privateRaw, name }, f.progress, io)

test('finite progress observes all four real child close/EOF pairs without publishing child data', async () => {
  const f = progressFixture('progress-all')
  for (const name of ['install', 'build', 'stage', 'tests']) {
    const result = await runStage(f, name)
    assert.equal(census.stageSucceeded(result), true)
    assert.equal(fs.readFileSync(path.join(f.directory, name + '.marker'), 'utf8'), 'owned-done')
    for (const kind of ['stdout', 'stderr']) assert.match(fs.readFileSync(path.join(f.privateRaw, name + '.' + kind), 'utf8'), /PRIVATE_STD(OUT|ERR)_SENTINEL/)
  }
  assert.equal(f.lines.length, 8)
  const records = f.lines.map(line => { assert.match(line, /^CENSUS_650_PROGRESS /); return JSON.parse(line.slice('CENSUS_650_PROGRESS '.length)) })
  assert.deepEqual(records, ['install', 'build', 'stage', 'tests'].flatMap((stage, i) => [
    { version: 1, sequence: i * 2, stage, state: 'start' },
    { version: 1, sequence: i * 2 + 1, stage, state: 'end', outcome: 'PASS' },
  ]))
  const files = fs.readdirSync(f.publicDir)
  assert.equal(files.length, 8)
  for (const file of files) {
    const value = JSON.parse(fs.readFileSync(path.join(f.publicDir, file), 'utf8'))
    assert.deepEqual(value, records[value.sequence])
  }
  assert.equal(JSON.stringify(records).includes('PRIVATE'), false)
  assert.equal(JSON.stringify(records).includes(f.directory), false)
  assert.throws(() => f.progress.start('install'), { message: 'CENSUS_PROGRESS_INVALID' })
  assert.equal(f.lines.length, 8)
})

for (const failure of ['progress-install-start.json', 'emit']) test(`start ${failure} failure latches permanently before any real child effect`, async () => {
  const f = progressFixture('progress-start-failure', failure)
  for (let i = 0; i < 2; i++) await assert.rejects(runStage(f), { message: 'CENSUS_PROGRESS_WRITE_FAILED' })
  assert.equal(fs.existsSync(path.join(f.directory, 'install.marker')), false)
  assert.deepEqual(fs.readdirSync(f.privateRaw), [])
  assert.equal(f.lines.length, 0)
})

test('end write failure retains settled child and full closed raw but cannot admit another stage', async () => {
  const f = progressFixture('progress-end-failure', 'progress-install-end.json')
  await assert.rejects(runStage(f), { message: 'CENSUS_PROGRESS_WRITE_FAILED' })
  assert.equal(fs.readFileSync(path.join(f.directory, 'install.marker'), 'utf8'), 'owned-done')
  assert.match(fs.readFileSync(path.join(f.privateRaw, 'install.stdout'), 'utf8'), /PRIVATE_STDOUT_SENTINEL/)
  assert.match(fs.readFileSync(path.join(f.privateRaw, 'install.stderr'), 'utf8'), /PRIVATE_STDERR_SENTINEL/)
  await assert.rejects(runStage(f, 'build'), { message: 'CENSUS_PROGRESS_WRITE_FAILED' })
  assert.equal(fs.existsSync(path.join(f.directory, 'build.marker')), false)
  assert.equal(f.lines.length, 1)
})

test('nonzero child has a finite FAIL end and no private error projection', async () => {
  const f = progressFixture('progress-child-failure')
  const result = await runStage(f, 'install', 7)
  assert.equal(result.code, 7)
  assert.equal(census.stageSucceeded(result), false)
  assert.deepEqual(JSON.parse(f.lines[1].slice('CENSUS_650_PROGRESS '.length)), { version: 1, sequence: 1, stage: 'install', state: 'end', outcome: 'FAIL' })
})

test('pre-spawn raw destination failure records FAIL without claiming spawn or creating marker', async () => {
  const f = progressFixture('progress-pre-spawn')
  const result = await runStage(f, 'install', 0, { open: async () => { throw Error('PRIVATE_OPEN_ERROR_SENTINEL') } })
  assert.equal(result.capture_error, true)
  assert.equal(result.pid, undefined)
  assert.equal(fs.existsSync(path.join(f.directory, 'install.marker')), false)
  assert.equal(JSON.parse(f.lines[1].slice('CENSUS_650_PROGRESS '.length)).outcome, 'FAIL')
  assert.equal(f.lines.join('').includes('PRIVATE'), false)
})

test('unknown labels, reordered phases, duplicate start and unmatched end reject before public output', async () => {
  const f = progressFixture('progress-invalid')
  for (const name of ['PRIVATE_NAME_SENTINEL', 'build', null, {}, 'tests']) assert.throws(() => f.progress.start(name), { message: 'CENSUS_PROGRESS_INVALID' })
  assert.throws(() => f.progress.end({ name: 'install', code: 0 }), { message: 'CENSUS_PROGRESS_INVALID' })
  assert.equal(f.lines.length, 0)
  await runStage(f)
  assert.throws(() => f.progress.end({ name: 'install', code: 0 }), { message: 'CENSUS_PROGRESS_INVALID' })
  f.progress.start('build')
  assert.throws(() => f.progress.start('build'), { message: 'CENSUS_PROGRESS_INVALID' })
  assert.throws(() => f.progress.end({ name: 'stage', code: 0 }), { message: 'CENSUS_PROGRESS_INVALID' })
  assert.equal(f.lines.length, 3)
})

test('actual default emitter publishes only two fixed records while actual child streams remain private', async () => {
  const f = progressFixture('progress-default-emitter')
  const entry = `import fs from 'node:fs';import {createStageProgress,captureStage} from ${JSON.stringify(pathToFileURL(path.join(root, 'scripts/windows-census.mjs')).href)};
    const progress=createStageProgress((name,value)=>fs.writeFileSync(${JSON.stringify(f.publicDir)}+'/'+name,JSON.stringify(value),{flag:'wx',mode:384}));
    await captureStage(process.execPath,['-e',${JSON.stringify(childScript)},${JSON.stringify(path.join(f.directory, 'install.marker'))},'0'],{cwd:${JSON.stringify(f.directory)},env:{},raw:${JSON.stringify(f.privateRaw)},name:'install'},progress);`
  const result = await capture(process.execPath, ['--input-type=module', '-e', entry], { cwd: owned, env, raw, name: 'default-progress-emitter' })
  assert.equal(result.code, 0)
  const stdout = fs.readFileSync(path.join(raw, 'default-progress-emitter.stdout'), 'utf8')
  const lines = stdout.trim().split(/\r?\n/)
  assert.equal(lines.length, 2)
  assert.deepEqual(lines.map(line => JSON.parse(line.slice('CENSUS_650_PROGRESS '.length))), [
    { version: 1, sequence: 0, stage: 'install', state: 'start' },
    { version: 1, sequence: 1, stage: 'install', state: 'end', outcome: 'PASS' },
  ])
  assert.equal(stdout.includes('PRIVATE'), false)
  assert.equal(stdout.includes(f.directory), false)
  assert.equal(fs.readFileSync(path.join(raw, 'default-progress-emitter.stderr'), 'utf8'), '')
})

test('real spawn error produces FAIL with both capture EOFs rather than a completed census claim', async () => {
  const f = progressFixture('progress-spawn-error')
  const result = await census.captureStage(path.join(f.directory, 'never-created-executable'), [],
    { cwd: f.directory, env, raw: f.privateRaw, name: 'install' }, f.progress)
  assert.equal(result.spawn_error, 'ENOENT')
  assert.equal(census.stageSucceeded(result), false)
  assert.equal(result.files.length, 2)
  assert.equal(result.files.every(file => file.complete && file.bytes === 0), true)
  assert.equal(JSON.parse(f.lines[1].slice('CENSUS_650_PROGRESS '.length)).outcome, 'FAIL')
})

test('an existing public start receipt stays unchanged and prevents any capture', async () => {
  const f = progressFixture('progress-collision')
  const file = path.join(f.publicDir, 'progress-install-start.json')
  fs.writeFileSync(file, 'OWNED_PREEXISTING_RECORD')
  await assert.rejects(runStage(f), { message: 'CENSUS_PROGRESS_WRITE_FAILED' })
  assert.equal(fs.readFileSync(file, 'utf8'), 'OWNED_PREEXISTING_RECORD')
  assert.equal(fs.existsSync(path.join(f.directory, 'install.marker')), false)
  assert.deepEqual(fs.readdirSync(f.privateRaw), [])
})

function installFixture(mode = 'success') {
  const directory = fs.mkdtempSync(path.join(owned, 'installer-')), repo = path.join(directory, 'repo'), log = path.join(directory, 'commands.jsonl')
  fs.mkdirSync(repo); fs.mkdirSync(path.join(repo, 'companion')); fs.mkdirSync(path.join(repo, 'chrome-extension'))
  prepareOwnedGitConfig(directory)
  const clean = childEnvironment(process.env, repo, directory), npmCli = path.join(directory, 'npm-cli.cjs')
  fs.writeFileSync(npmCli, `const fs=require('node:fs'),path=require('node:path'),name=path.basename(process.cwd()),log=${JSON.stringify(log)},mode=${JSON.stringify(mode)};
    fs.appendFileSync(log,JSON.stringify({name,phase:'start',argv:process.argv.slice(2),env_keys:Object.keys(process.env).sort(),forbidden:['NPM_TOKEN','GITHUB_TOKEN','NODE_OPTIONS','PRIVATE_INSTALL_ENV'].filter(k=>k in process.env)})+'\\n');
    console.log('OWNED_INSTALL_STDOUT');console.error('OWNED_INSTALL_STDERR');
    if(mode==='signal-first'&&name==='companion')process.kill(process.pid,'SIGTERM');
    if(name==='companion'){const config=process.env.GIT_CONFIG_GLOBAL;if(mode==='config-nonempty')fs.writeFileSync(config,'OWNED_INERT_INPUT_CHANGE');if(mode==='config-replaced'){fs.unlinkSync(config);fs.writeFileSync(config,'',{flag:'wx',mode:0o600})}if(mode==='config-missing')fs.unlinkSync(config);if(mode==='config-linked')fs.linkSync(config,path.join(path.dirname(config),'owned-extra-link'));}
    setTimeout(()=>{fs.appendFileSync(log,JSON.stringify({name,phase:'settled'})+'\\n');process.exitCode=(mode==='fail-first'&&name==='companion')?7:(mode==='fail-second'&&name==='chrome-extension')?9:0},10);`)
  return { directory, repo, log, clean, npmCli }
}
async function runInstaller(f) {
  const entry = `import {installLockedDependencies} from ${JSON.stringify(pathToFileURL(path.join(root, 'scripts/windows-census-install.mjs')).href)};process.exitCode=await installLockedDependencies({root:${JSON.stringify(f.repo)},env:${JSON.stringify(f.clean)},npmCli:${JSON.stringify(f.npmCli)}});`
  return capture(process.execPath, ['--input-type=module', '-e', entry], { cwd: f.directory, env: f.clean, raw, name: path.basename(f.directory) })
}
const installEvents = f => fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []

test('locked installer uses both fixed npm ci commands sequentially inside the original raw capture', async () => {
  const f = installFixture(), result = await runInstaller(f), events = installEvents(f)
  assert.equal(result.code, 0)
  assert.deepEqual(events.map(x => [x.name, x.phase]), [['companion', 'start'], ['companion', 'settled'], ['chrome-extension', 'start'], ['chrome-extension', 'settled']])
  for (const event of events.filter(x => x.phase === 'start')) {
    assert.deepEqual(event.argv, ['ci']); assert.deepEqual(event.forbidden, [])
    assert.deepEqual(event.env_keys.map(x => x.toLowerCase()).sort(), [...Object.keys(f.clean), ...(process.platform === 'darwin' && !('__CF_USER_TEXT_ENCODING' in f.clean) ? ['__CF_USER_TEXT_ENCODING'] : [])].map(x => x.toLowerCase()).sort())
  }
  assert.match(fs.readFileSync(path.join(raw, path.basename(f.directory) + '.stdout'), 'utf8'), /OWNED_INSTALL_STDOUT/)
  assert.match(fs.readFileSync(path.join(raw, path.basename(f.directory) + '.stderr'), 'utf8'), /OWNED_INSTALL_STDERR/)
})
for (const [mode, code, commands] of [['fail-first', 7, ['companion']], ['fail-second', 9, ['companion', 'chrome-extension']]]) test(`locked installer ${mode} preserves failure and launches only admitted children`, async () => {
  const f = installFixture(mode), result = await runInstaller(f)
  assert.equal(result.code, code)
  assert.deepEqual(installEvents(f).filter(x => x.phase === 'start').map(x => x.name), commands)
})
test('owned first-child signal and real spawn error both prevent frontend installation', async () => {
  const signal = installFixture('signal-first'), ended = await runInstaller(signal)
  assert.notEqual(ended.code, 0)
  assert.deepEqual(installEvents(signal).filter(x => x.phase === 'start').map(x => x.name), ['companion'])
  const missing = installFixture(); fs.rmdirSync(path.join(missing.repo, 'companion'))
  const failed = await runInstaller(missing)
  assert.notEqual(failed.code, 0); assert.deepEqual(installEvents(missing), [])
})
test('installer has no omitted-host-env or unknown-key fallback and no missing-program fallback', async () => {
  const f = installFixture()
  for (const env of [undefined, {}, { ...f.clean, PRIVATE_INSTALL_ENV: 'OWNED_SECRET_CANARY' }, { ...f.clean, GIT_CONFIG_NOSYSTEM: '0' }, { ...f.clean, __CF_USER_TEXT_ENCODING: 'OWNED_PLATFORM_INJECTION_CANARY' }]) {
    await assert.rejects(installLockedDependencies({ root: f.repo, env, npmCli: f.npmCli }), { message: 'CENSUS_INSTALL_ENV_INVALID' })
  }
  await assert.rejects(installLockedDependencies({ root: f.repo, env: f.clean, npmCli: path.join(f.directory, 'missing-npm-cli.cjs') }), { message: 'CENSUS_INSTALL_CLI_MISSING' })
  assert.deepEqual(installEvents(f), [])
})

for (const mode of ['config-nonempty', 'config-replaced', 'config-missing', 'config-linked']) test(`installer revalidates owned Git input before second child: ${mode}`, async () => {
  const f = installFixture(mode), result = await runInstaller(f)
  assert.notEqual(result.code, 0)
  assert.deepEqual(installEvents(f).filter(x => x.phase === 'start').map(x => x.name), ['companion'])
})
