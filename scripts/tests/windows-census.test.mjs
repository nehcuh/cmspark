import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { project } from '../windows-census-reporter.mjs'
import { childEnvironment, prepareOwnedGitConfig, rejectCheckoutCredentials, capture, discover, reconcile, scheduledBatches, inventory, stageSucceeded } from '../windows-census.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const reporter = path.join(root, 'scripts/windows-census-reporter.mjs')
const retained = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-census-control-raw-'))
fs.chmodSync(retained, 0o700)
function retire(f) { fs.cpSync(f.owned, path.join(retained, path.basename(f.owned)), { recursive: true, errorOnExist: true, force: false }); fs.rmSync(f.owned, { recursive: true, force: true }) }
test.after(() => { console.log('CENSUS_CONTROL_RAW_RETAINED ' + retained) })
const cases = 'const test=require("node:test"),assert=require("node:assert/strict");\n'
function fixture(files) {
  const owned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-census-control-')))
  const companion = path.join(owned, 'companion')
  fs.mkdirSync(path.join(companion, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(companion, '.test-dist', 'tests'), { recursive: true })
  for (const name of ['run-tests.mjs', 'test-data-dir.cjs']) fs.copyFileSync(path.join(root, 'companion/scripts', name), path.join(companion, 'scripts', name))
  for (const [file, body] of Object.entries(files)) { const target = path.join(companion, '.test-dist/tests', file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, body) }
  return { owned, companion }
}
async function run(f, name, observed) {
  const raw = path.join(f.owned, name), receipts = path.join(raw, 'receipts')
  fs.mkdirSync(raw, { mode: 0o700 }); fs.mkdirSync(receipts, { mode: 0o700 })
  const input = { PATH: process.env.PATH, HOME: process.env.HOME, TMP: os.tmpdir(), TEMP: os.tmpdir(), RUNNER_TRACKING_ID: 'OWNED_TRACKING_INERT_ONLY', GITHUB_TOKEN: 'FORBIDDEN_TOKEN_CANARY', NPM_TOKEN: 'FORBIDDEN_NPM_CANARY', HTTPS_PROXY: 'FORBIDDEN_PROXY_CANARY', CMSPARK_DATA_DIR: 'FORBIDDEN_CONFIG_CANARY', NODE_OPTIONS: '--require FORBIDDEN_PRELOAD_CANARY' }
  const env = childEnvironment(input, f.owned, raw)
  if (observed) { env.NODE_OPTIONS = `--test-reporter=${JSON.stringify(pathToFileURL(reporter).href)}`; env.CMSPARK_CENSUS_DIR = receipts }
  const execution = await capture(process.execPath, [path.join(f.companion, 'scripts/run-tests.mjs')], { cwd: f.companion, env, raw, name: 'tests' })
  return { execution, raw, receipts, discovery: discover(f.companion), rawFile: path.join(raw, 'tests.stdout'), companion: f.companion }
}
const settings = cases + 'test("settings",()=>assert.ok(process.env.CMSPARK_DATA_DIR));'
const normalize = raw => raw.replace(/^\s*duration_ms: .*\n/gm, '').replace(/^# duration_ms .*\n/gm, '')

test('constructed environment and checkout admission reject inherited credentials without values in errors', () => {
  const env = childEnvironment({ Path: 'owned-path', GITHUB_TOKEN: 'secret', NODE_OPTIONS: '--require secret', NPM_TOKEN: 'secret', CMSPARK_DATA_DIR: 'secret' }, 'owned-workspace', 'owned-temp')
  assert.equal(env.PATH, 'owned-path'); assert.equal(env.CI, 'true'); assert.equal('RUNNER_TRACKING_ID' in env, false)
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1')
  assert.equal(env.GIT_CONFIG_GLOBAL, path.join('owned-temp', 'empty.gitconfig'))
  assert.equal(childEnvironment({ RUNNER_TRACKING_ID: 'OWNED_TRACKING_INERT_ONLY' }, 'w', 't').RUNNER_TRACKING_ID, 'OWNED_TRACKING_INERT_ONLY')
  for (const key of ['GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_OPTIONS', 'CMSPARK_DATA_DIR']) assert.equal(key in env, false)
  rejectCheckoutCredentials('remote.origin.url https://github.com/nehcuh/cmspark\n')
  for (const input of ['http.https://github.com/.extraheader AUTHORIZATION: secret', 'credential.helper secret', 'remote.origin.url https://secret@github.com/owner/repo', 'remote.origin.url https://github.com/owner/repo?token=secret']) assert.throws(() => rejectCheckoutCredentials(input), { message: 'CENSUS_CHECKOUT_CREDENTIALS_PRESENT' })
})

test('actual unchanged runner: baseline success has no census; passive observation reconciles real nested/skip/todo/colliding names/settings', async () => {
  const f = fixture({
    'a.test.js': cases + 'test("same",()=>{assert.equal(process.env.RUNNER_TRACKING_ID,"OWNED_TRACKING_INERT_ONLY");for(const key of ["GITHUB_TOKEN","NPM_TOKEN","HTTPS_PROXY"])assert.equal(process.env[key],undefined)});test.skip("skip",()=>{});test.todo("todo");test("failing-todo",{todo:"owned expected"},()=>assert.fail("EXPECTED_TODO"));test("parent",async t=>{await t.test("child",()=>{});});',
    'b.test.js': cases + 'test("same",()=>{});', '_excluded.test.js': 'throw Error("must not discover");', 'settings-web.test.js': settings,
  })
  try {
    const baseline = await run(f, 'baseline', false), observed = await run(f, 'observed', true)
    assert.equal(baseline.execution.code, 0); assert.equal(observed.execution.code, 0)
    await assert.rejects(reconcile(baseline), { message: 'CENSUS_CANONICAL_PARENT_UNRESOLVED' })
    const r = await reconcile(observed)
    assert.equal(r.outcome, 'PASS'); assert.equal(r.complete, true); assert.equal(r.files.length, 3); assert.equal(r.skips.length, 3); assert.equal(r.cases.filter(x => x.outcome === 'TODO').length, 2); assert.equal(r.files.some(x => x.state === 'failed'), false)
    assert.equal(observed.discovery.filter(x => x.excluded).length, 1)
    assert.equal(normalize(fs.readFileSync(baseline.rawFile, 'utf8')), normalize(fs.readFileSync(observed.rawFile, 'utf8')))
    const receipts = fs.readdirSync(observed.receipts).map(file => fs.readFileSync(path.join(observed.receipts, file), 'utf8')).join('')
    for (const marker of ['FORBIDDEN_TOKEN_CANARY', 'FORBIDDEN_NPM_CANARY', 'FORBIDDEN_PROXY_CANARY', 'FORBIDDEN_CONFIG_CANARY', 'FORBIDDEN_PRELOAD_CANARY', '"name":"same"']) assert.equal(receipts.includes(marker), false)
    assert.equal(r.files.filter(x => path.basename(x.file) === 'a.test.js' || path.basename(x.file) === 'b.test.js').length, 2)
  } finally { retire(f) }
})

test('actual Node reporter binds a filesystem alias to the same physical discovered test', async () => {
  const f = fixture({ 'a.test.js': cases + 'test("owned alias",()=>{});' })
  const alias = path.join(f.owned, 'same-physical-companion')
  fs.symlinkSync(f.companion, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const file = path.join(alias, '.test-dist/tests/a.test.js')
  assert.equal(fs.realpathSync.native(file), fs.realpathSync.native(path.join(f.companion, '.test-dist/tests/a.test.js')))
  const raw = path.join(f.owned, 'alias-observed'), receipts = path.join(raw, 'receipts')
  fs.mkdirSync(receipts, { recursive: true })
  const env = { ...childEnvironment(process.env, f.owned, raw),
    NODE_OPTIONS: `--test-reporter=${JSON.stringify(pathToFileURL(reporter).href)}`, CMSPARK_CENSUS_DIR: receipts }
  try {
    // This directly exercises Node's real alias argv, not the canonical runner's
    // own realpath-normalized argv. Receipt bodies are actual reporter output.
    const execution = await capture(process.execPath, ['--test', file], { cwd: f.companion, env, raw, name: 'tests' })
    assert.equal(execution.code, 0)
    const result = await reconcile({ companion: f.companion, receipts, rawFile: path.join(raw, 'tests.stdout'), discovery: discover(f.companion), execution })
    assert.equal(result.outcome, 'PASS'); assert.equal(result.files.length, 1)
    assert.equal(result.files[0].file, '.test-dist/tests/a.test.js')
  } finally { fs.unlinkSync(alias); retire(f) }
})

test('actual Node reporter refuses an internal alias whose physical file is outside the test root', async () => {
  const f = fixture({ 'a.test.js': cases + 'test("owned internal",()=>{});' })
  const foreign = path.join(f.owned, 'foreign')
  fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'foreign.test.js'), cases + 'test("owned outside",()=>{});')
  const alias = path.join(f.companion, 'foreign-alias')
  fs.symlinkSync(foreign, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const raw = path.join(f.owned, 'outside-observed'), receipts = path.join(raw, 'receipts')
  fs.mkdirSync(receipts, { recursive: true })
  const env = { ...childEnvironment(process.env, f.owned, raw),
    NODE_OPTIONS: `--test-reporter=${JSON.stringify(pathToFileURL(reporter).href)}`, CMSPARK_CENSUS_DIR: receipts }
  try {
    const execution = await capture(process.execPath, ['--test', path.join(alias, 'foreign.test.js')], { cwd: f.companion, env, raw, name: 'tests' })
    assert.equal(execution.code, 0)
    const begins = fs.readdirSync(receipts).map(file => JSON.parse(fs.readFileSync(path.join(receipts, file), 'utf8').split('\n')[0]))
    assert.ok(begins.length > 0); assert.equal(begins.every(b => b.outside_argv), true)
    await assert.rejects(reconcile({ companion: f.companion, receipts, rawFile: path.join(raw, 'tests.stdout'), discovery: discover(f.companion), execution }), { message: 'CENSUS_CANONICAL_PARENT_UNRESOLVED' })
  } finally { fs.unlinkSync(alias); retire(f) }
})

for (const [name, body] of Object.entries({ assertion: cases + 'test("bad",()=>assert.fail("ACTUAL_ASSERTION"));', import: 'throw Error("ACTUAL_IMPORT_FAILURE");', terminated: 'process.kill(process.pid,"SIGKILL");', cancelled: cases + 'test("parent",t=>{t.test("pending",()=>new Promise(()=>{}));});' })) {
  test(`actual ${name} failure remains nonzero; settings is not-run, not skip`, async () => {
    const f = fixture({ 'a.test.js': body, 'settings-web.test.js': settings })
    try {
      const old = await run(f, 'baseline', false), current = await run(f, 'observed', true)
      assert.notEqual(old.execution.code, 0); assert.equal(current.execution.code, old.execution.code)
      const r = await reconcile(current); assert.equal(r.outcome, 'FAIL'); assert.equal(r.complete, false)
      assert.equal(r.files.at(-1).state, 'not_run_because_main_failed')
      assert.equal(r.canonical_batches.length, 1)
    } finally { retire(f) }
  })
}

test('actual 32000 canonical batching retains later main after failure and observes imported/empty files', async () => {
  const files = { 'helper.cjs': cases + 'test("imported",()=>{});', 'settings-web.test.js': settings }
  // Basenames alone exceed 32000, independent of the platform's temp-root length.
  const mainFiles = 192
  for (let i = 0; i < mainFiles; i++) files[`${String(i).padStart(3, '0')}-${'x'.repeat(180)}.test.js`] = i === 0 ? cases + 'test("first",()=>assert.fail());' : i === 1 ? 'require("./helper.cjs");' : '// Actual empty-file wrapper'
  const f = fixture(files)
  try {
    const current = await run(f, 'observed', true), r = await reconcile(current)
    assert.equal(current.execution.code, 1); assert.ok(scheduledBatches(f.companion, current.discovery).length >= 3)
    assert.equal(r.files.filter(x => x.stage === 'main').length, mainFiles)
    assert.equal(r.files.at(-1).state, 'not_run_because_main_failed')
    assert.equal(r.files.some(x => x.file.endsWith('helper.cjs')), false)
  } finally { retire(f) }
})

test('streaming output preserves >8MiB and unique ordinals; missing end/hash drift fails closed', async () => {
  const f = fixture({ 'a.test.js': cases + 'for(let i=0;i<900;i++)console.log("FLOW_"+i+"_"+"x".repeat(10000));test("flow",()=>{});', 'settings-web.test.js': settings })
  try {
    const current = await run(f, 'observed', true)
    assert.equal(current.execution.code, 0); assert.ok(current.execution.files[0].bytes > 8 * 1024 * 1024)
    const raw = fs.readFileSync(current.rawFile, 'utf8')
    // Builtin TAP may put a diagnostic prefix between stdout event fragments,
    // including inside this fixture's sentinel. Only that TAP framing is removed.
    const diagnostics = raw.replace(/\r?\n# /g, '')
    assert.deepEqual([...diagnostics.matchAll(/FLOW_(\d+)_/g)].map(m => Number(m[1])), Array.from({ length: 900 }, (_, i) => i))
    assert.equal((await reconcile(current)).outcome, 'PASS')
    const receipt = path.join(current.receipts, fs.readdirSync(current.receipts)[0])
    const rows = fs.readFileSync(receipt, 'utf8').trim().split('\n'); fs.writeFileSync(receipt, rows.slice(0, -1).join('\n') + '\n')
    await assert.rejects(reconcile(current), { message: 'CENSUS_RECEIPT_INCOMPLETE' })
    const before = inventory(f.owned, ['companion/scripts/run-tests.mjs'])
    fs.appendFileSync(path.join(f.companion, 'scripts/run-tests.mjs'), '\n// owned drift\n')
    assert.notDeepEqual(before, inventory(f.owned, ['companion/scripts/run-tests.mjs']))
  } finally { retire(f) }
})

test('actual receipt-open and spawn failures do not invent PASS or test outcomes', async () => {
  const f = fixture({ 'a.test.js': cases + 'test("ok",()=>{});' })
  try {
    const raw = path.join(f.owned, 'raw'); fs.mkdirSync(raw)
    const bad = path.join(f.owned, 'not-directory'); fs.writeFileSync(bad, 'x')
    const execution = await capture(process.execPath, [path.join(f.companion, 'scripts/run-tests.mjs')], { cwd: f.companion, raw, name: 'bad-receipt', env: { ...childEnvironment(process.env, f.owned, raw), NODE_OPTIONS: `--test-reporter=${JSON.stringify(pathToFileURL(reporter).href)}`, CMSPARK_CENSUS_DIR: bad } })
    assert.notEqual(execution.code, 0)
    const missing = await capture(path.join(f.owned, 'missing-node'), [], { cwd: f.companion, raw, name: 'spawn', env: childEnvironment(process.env, f.owned, raw) })
    assert.notEqual(missing.code, 0); assert.equal(missing.spawn_error, 'ENOENT')
    assert.equal(missing.files[0].bytes, 0)
  } finally { retire(f) }
})


test('real npm → unchanged runner → worker → grandchild drain after actual EBADF; loss blocks success and raw survives', async () => {
  const f = fixture({ 'settings-web.test.js': settings })
  try {
    const pids = path.join(f.companion, 'owned-exits.jsonl')
    const grandchild = `const fs=require('node:fs');require('node:assert/strict').equal(process.env.RUNNER_TRACKING_ID,'OWNED_TRACKING_INERT_ONLY');process.on('exit',()=>fs.appendFileSync(${JSON.stringify(pids)},JSON.stringify({kind:'grandchild',pid:process.pid,ppid:process.ppid})+'\\n'));setTimeout(()=>console.log('OWNED_GRANDCHILD_FINISHED'),20);`
    const body = cases + `assert.equal(process.env.RUNNER_TRACKING_ID,'OWNED_TRACKING_INERT_ONLY');const fs=require('node:fs'),cp=require('node:child_process');process.on('exit',()=>fs.appendFileSync(${JSON.stringify(pids)},JSON.stringify({kind:'worker',pid:process.pid,ppid:process.ppid})+'\\n'));test('actual-child',async()=>{await new Promise((resolve,reject)=>{const c=cp.spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','inherit','inherit']});c.on('error',reject);c.on('close',code=>code===0?resolve():reject(Error('child failed')));});});`
    fs.writeFileSync(path.join(f.companion, '.test-dist/tests/a.test.js'), body)
    fs.writeFileSync(path.join(f.companion, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node scripts/run-tests.mjs' } }))
    const raw = path.join(f.owned, 'write-failure'), receipts = path.join(raw, 'receipts')
    fs.mkdirSync(raw); fs.mkdirSync(receipts)
    let writes = 0
    const io = { async open(file, ...args) {
      const actual = await fsp.open(file, ...args)
      if (!file.endsWith('.stdout')) return actual
      return { async writeFile(chunk) { await actual.writeFile(chunk); if (++writes === 1) await actual.close() }, close: () => actual.close() }
    } }
    const npmCli = [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(file => fs.existsSync(file))
    assert.ok(npmCli)
    const env = { ...childEnvironment({ ...process.env, RUNNER_TRACKING_ID: 'OWNED_TRACKING_INERT_ONLY' }, f.owned, raw), NODE_OPTIONS: `--test-reporter=${JSON.stringify(pathToFileURL(reporter).href)}`, CMSPARK_CENSUS_DIR: receipts }
    const execution = await capture(process.execPath, [npmCli, 'test'], { cwd: f.companion, env, raw, name: 'tests' }, io)
    assert.equal(execution.code, 0); assert.equal(fs.readFileSync(path.join(raw, 'tests.stdout'), 'utf8').includes('OWNED_TRACKING_INERT_ONLY'), false); assert.equal(fs.readFileSync(path.join(raw, 'tests.stderr'), 'utf8').includes('OWNED_TRACKING_INERT_ONLY'), false); assert.equal(execution.capture_error, true); assert.equal(stageSucceeded(execution), false)
    assert.ok(execution.files[0].bytes > 0); assert.ok(execution.files[0].gap_bytes > 0); assert.equal(execution.files[0].complete, false)
    const exits = fs.readFileSync(pids, 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(exits.map(x => x.kind).sort(), ['grandchild', 'worker'])
    const allPids = new Set([execution.pid, ...exits.flatMap(x => [x.pid, x.ppid])])
    for (const file of fs.readdirSync(receipts)) { const begin = JSON.parse(fs.readFileSync(path.join(receipts, file), 'utf8').split('\n')[0]); allPids.add(begin.pid); allPids.add(begin.ppid) }
    for (const pid of allPids) assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH')
    fs.writeFileSync(path.join(raw, 'failure-proof.json'), JSON.stringify({ execution, owned_pids_confirmed_exited: [...allPids], exits }, null, 2))
    // Original process exit0 is retained, but accounting may not certify a truncated TAP.
    await assert.rejects(reconcile({ companion: f.companion, receipts, rawFile: path.join(raw, 'tests.stdout'), discovery: discover(f.companion), execution }))
  } finally { retire(f) }
})


test('fixed owned Git isolation keeps actual local credential refusal and ambient helper inert', () => {
  const owned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-census-git-')))
  try {
    const global = prepareOwnedGitConfig(owned), repo = path.join(owned, 'repo')
    fs.mkdirSync(repo)
    const env = childEnvironment({ ...process.env, GIT_CONFIG_SYSTEM: 'FORBIDDEN_CONFIG', GIT_CONFIG_GLOBAL: 'FORBIDDEN_CONFIG', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: 'FORBIDDEN_HELPER' }, repo, owned)
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1'); assert.equal(env.GIT_CONFIG_GLOBAL, global.file)
    for (const name of ['GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) assert.equal(name in env, false)
    const git = args => { const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', windowsHide: true }); assert.equal(r.error, undefined); assert.ok([0, 1].includes(r.status)); return r }
    git(['init', '-q'])
    const query = () => git(['config', '--get-regexp', '^(http\\..*extraheader|http\\.extraheader|credential\\..*|remote\\..*\\.url)$'])
    const clean = query(); assert.equal(clean.status, 1); rejectCheckoutCredentials(clean.stdout)
    const helperFile = path.join(owned, 'ambient.gitconfig')
    fs.writeFileSync(helperFile, '[credential]\nhelper=OWNED_NEVER_EXECUTE\n')
    // Explicit owned source seam models ambient config; old launcher did not forward this override.
    const ambient = spawnSync('git', ['config', '--get-regexp', '^credential\\.'], { cwd: repo, env: { ...env, GIT_CONFIG_NOSYSTEM: '0', GIT_CONFIG_SYSTEM: helperFile }, encoding: 'utf8', windowsHide: true })
    assert.equal(ambient.status, 0); assert.throws(() => rejectCheckoutCredentials(ambient.stdout), { message: 'CENSUS_CHECKOUT_CREDENTIALS_PRESENT' })
    for (const [key, value] of [['credential.helper', 'OWNED_NEVER_EXECUTE'], ['http.https://owned.invalid/.extraheader', 'OWNED_NOT_AUTHORIZATION'], ['remote.origin.url', 'https://owned-not-valid@owned.invalid/repo']]) {
      git(['config', '--local', key, value])
      assert.throws(() => rejectCheckoutCredentials(query().stdout), { message: 'CENSUS_CHECKOUT_CREDENTIALS_PRESENT' })
      git(['config', '--local', '--unset-all', key])
    }
    git(['config', '--local', 'include.path', helperFile])
    assert.throws(() => rejectCheckoutCredentials(query().stdout), { message: 'CENSUS_CHECKOUT_CREDENTIALS_PRESENT' })
    global.validate()
  } finally { fs.rmSync(owned, { recursive: true, force: true }) }
})

test('owned empty Git config is exclusive and rejects replacement, contents and namespace aliases', () => {
  for (const mode of ['file-collision', 'hardlink-collision', 'contents', 'replacement', 'parent-alias']) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-census-git-input-')))
    const owned = path.join(root, 'owned'); fs.mkdirSync(owned)
    try {
      const file = path.join(owned, 'empty.gitconfig')
      if (mode.endsWith('collision')) {
        const original = path.join(root, 'original'); fs.writeFileSync(original, 'OWNED_NOT_SECRET')
        if (mode === 'file-collision') fs.writeFileSync(file, 'OWNED_NOT_SECRET')
        else fs.linkSync(original, file)
        assert.throws(() => prepareOwnedGitConfig(owned), { message: 'CENSUS_OWNED_GIT_CONFIG_INVALID' })
        assert.equal(fs.readFileSync(file, 'utf8'), 'OWNED_NOT_SECRET')
      } else if (mode === 'parent-alias') {
        const alias = path.join(root, 'alias'); fs.symlinkSync(owned, alias, process.platform === 'win32' ? 'junction' : 'dir')
        assert.throws(() => prepareOwnedGitConfig(alias), { message: 'CENSUS_OWNED_GIT_CONFIG_INVALID' })
        assert.equal(fs.existsSync(file), false)
      } else {
        const input = prepareOwnedGitConfig(owned); input.validate()
        if (mode === 'contents') fs.writeFileSync(file, 'OWNED_NOT_SECRET')
        else { fs.renameSync(file, path.join(root, 'original-empty')); fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 }) }
        assert.throws(() => input.validate(), { message: 'CENSUS_OWNED_GIT_CONFIG_INVALID' })
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  }
})

// #650: actual child errors are wrapped by Node TestsStream in error.cause.
// Keep diagnostic projection finite; never publish command/output/error text.
test('census child failure projection preserves finite actual wrapped exit facts and no private strings', async () => {
  const body = cases + `test('owned child failure',async()=>{await require('node:util').promisify(require('node:child_process').execFile)(process.execPath,['-e',\"process.stdout.write('OWNED_STDOUT_650');process.stderr.write('OWNED_PRIVATE_ERROR_650');process.exit(7)\"],{env:{},timeout:2000});});`
  const f = fixture({ 'a.test.js': body })
  try {
    const observed = await run(f, 'child-failure', true)
    assert.equal(observed.execution.code, 1)
    const events = fs.readdirSync(observed.receipts).flatMap(file => fs.readFileSync(path.join(observed.receipts, file), 'utf8').trim().split('\n').map(JSON.parse))
    const child = events.find(e => e.type === 'test:fail' && e.child_failure_chain?.some(c => c.code === 7))
    assert.ok(child, 'actual child exit7 must survive Node error.cause wrapper')
    const entry = child.child_failure_chain.find(c => c.code === 7)
    assert.equal(entry.killed, false)
    assert.equal(entry.stdout_bytes, Buffer.byteLength('OWNED_STDOUT_650'))
    assert.equal(entry.stderr_bytes, Buffer.byteLength('OWNED_PRIVATE_ERROR_650'))
    const serialized = JSON.stringify(events)
    for (const value of ['OWNED_STDOUT_650','OWNED_PRIVATE_ERROR_650','process.exit(7)']) assert.equal(serialized.includes(value), false)
    assert.equal((await reconcile(observed)).outcome, 'FAIL', 'observability never changes original failure')
  } finally { retire(f) }
})

test('census child failure projection bounds cycles and refuses getters, text and nonfinite child fields', () => {
  let getters = 0
  const hidden = { code: 9, killed: true, signal: 'SIGTERM', stdout: 'OWNED_ONLY', stderr: 'OWNED_ONLY' }
  Object.defineProperty(hidden, 'cmd', { get() { getters++; throw Error('getter must not run') } })
  Object.defineProperty(hidden, 'exitCode', { get() { getters++; throw Error('getter must not run') } })
  hidden.cause = hidden
  const wrapper = new Error('OWNED_PRIVATE_MESSAGE_650', { cause: hidden })
  const actual = project({ type: 'test:fail', data: { details: { error: wrapper } } }, 1, root)
  assert.deepEqual(actual.child_failure_chain, [{ depth: 1, code: 9, killed: true, signal: 'SIGTERM', stdout_bytes: 10, stderr_bytes: 10 }])
  assert.equal(getters, 0)
  const invalid = project({ type: 'test:fail', data: { details: { error: { cause: { code: Infinity, killed: 'true', signal: 'OWNED_PRIVATE_SIGNAL', stdout: {}, stderr: null } } } } }, 2, root)
  assert.equal(invalid.child_failure_chain, undefined)
  assert.equal(JSON.stringify([actual,invalid]).includes('OWNED_'), false)
  assert.equal(project({type:'test:pass',data:{}},3,root).child_failure_chain,undefined)
})


test('census child failure projection reads actual Buffer size without overridden getters', () => {
  let getters = 0
  const buffer = Buffer.from('OWNED_BUFFER')
  for (const key of ['length','byteLength']) Object.defineProperty(buffer,key,{get(){getters++;throw Error('OWNED_FORBIDDEN_BUFFER_GETTER')}})
  const error = new Error('OWNED_PRIVATE_BUFFER_MESSAGE', { cause: { code: 8, stdout: buffer, stderr: buffer } })
  const actual = project({type:'test:fail',data:{details:{error}}},4,root)
  assert.deepEqual(actual.child_failure_chain,[{depth:1,code:8,stdout_bytes:12,stderr_bytes:12}])
  assert.equal(getters,0)
  assert.equal(JSON.stringify(actual).includes('OWNED_'),false)
})


test('census child failure projection rejects Proxy byte fields without invoking traps', () => {
  let traps = 0
  const proxy = new Proxy({}, {getPrototypeOf(){traps++;throw Error('OWNED_FORBIDDEN_PROTO_TRAP')}})
  const revoked = Proxy.revocable({}, {}); revoked.revoke()
  const error = new Error('OWNED_PRIVATE_PROXY_MESSAGE', {cause:{code:6,stdout:proxy,stderr:revoked.proxy}})
  const actual = project({type:'test:fail',data:{details:{error}}},5,root)
  assert.deepEqual(actual.child_failure_chain,[{depth:1,code:6}])
  assert.equal(traps,0)
  const cause = new Proxy({}, {getOwnPropertyDescriptor(){traps++;throw Error('OWNED_FORBIDDEN_DESCRIPTOR_TRAP')}})
  assert.equal(project({type:'test:fail',data:{details:{error:new Error('owned',{cause})}}},6,root).child_failure_chain,undefined)
  assert.equal(traps,0)
  const bytes = new Uint8Array([11,22,33])
  Object.defineProperty(bytes,'byteLength',{get(){traps++;throw Error('OWNED_FORBIDDEN_VIEW_GETTER')}})
  const view = project({type:'test:fail',data:{details:{error:{stdout:bytes}}}},6,root)
  assert.deepEqual(view.child_failure_chain,[{depth:0,stdout_bytes:3}])
  assert.equal(traps,0)
  assert.equal(JSON.stringify([actual,view]).includes('OWNED_'),false)
})


// #720: the observer predicts the unchanged runner, including its platform-only
// fixed argv. These are real source functions with an inert spawn collector;
// no child, native, filesystem test execution or shortened budget is involved.
test('passive census batch predictor matches unchanged runner platform fixed argv at boundaries', t => {
  const runner = fs.readFileSync(path.join(root, 'companion/scripts/run-tests.mjs'), 'utf8')
  const start = runner.indexOf('const MAX_ARGV_CHARS ='), end = runner.indexOf('const testRunDir =', start)
  assert.ok(start >= 0 && end > start)
  const pure = runner.slice(start, end)
  const mainCall = /^\s*code = (runNodeTest\(main, process\.platform === "win32" \? \["--test-concurrency=1"\] : \[\]\))$/m.exec(runner)
  const settingsCall = /^\s*if \(code === 0\) code = (runNodeTest\(settings, settingsWebIsolationArgs\(\)\))$/m.exec(runner)
  assert.ok(mainCall); assert.ok(settingsCall)
  const results = []
  for (const platform of ['win32', 'linux']) for (const node of ['20.20.0', '22.23.4']) for (const padding of [0, 21, 42]) {
    const nativePath = platform === 'win32' ? path.win32 : path.posix
    const companion = platform === 'win32' ? 'C:\\a\\cmspark\\cmspark\\companion' : '/owned/cmspark/companion'
    const execPath = platform === 'win32' ? 'C:\\hostedtoolcache\\windows\\node\\22.23.4\\x64\\node.exe' : '/owned/node'
    const main = Array.from({ length: 1200 }, (_, index) => ({ file: `.test-dist/tests/t${String(index).padStart(4, '0')}${index === 0 ? 'x'.repeat(padding) : ''}.test.js`, excluded: false, stage: 'main' }))
    const settings = { file: '.test-dist/tests/settings-web.test.js', excluded: false, stage: 'settings' }
    const discovery = [...main, { file: '.test-dist/tests/_excluded.test.js', excluded: true, stage: 'main' }, settings]
    const calls = [], view = { execPath, platform, versions: { node }, env: {} }
    const context = { path: nativePath, process: view, root: companion, testRunDir: 'OWNED_INERT', console: { error: () => assert.fail('canonical inert spawn must succeed') },
      spawnSync: (exe, args, options) => { calls.push({ exe, args: [...args], options }); return { status: 0, signal: null } },
      main: main.map(row => nativePath.join(companion, row.file)), settings: [nativePath.join(companion, settings.file)] }
    vm.runInNewContext(pure + ';' + mainCall[1] + ';' + settingsCall[1], context)
    // This is the imported production function body, not a rewritten predictor.
    const predict = vm.runInNewContext('(' + scheduledBatches.toString() + ')', { path: nativePath, process: view })
    const expected = Array.from(predict(companion, discovery, execPath), batch => ({ stage: batch.stage, files: Array.from(batch.files) }))
    const actual = calls.map(call => ({ stage: call.args.includes('--experimental-test-isolation=none') || call.args.some(arg => arg.endsWith('settings-web.test.js')) ? 'settings' : 'main',
      files: call.args.filter(arg => arg.endsWith('.test.js')).map(file => nativePath.relative(companion, file).split(nativePath.sep).join('/')) }))
    assert.equal(JSON.stringify(actual.flatMap(batch => batch.files)), JSON.stringify([...main.map(row => row.file), settings.file]), 'original ordered file list must be complete exactly once')
    assert.equal(calls.every(call => call.exe === execPath && call.options.cwd === companion), true)
    assert.equal(calls.at(-1).args.includes('--experimental-test-isolation=none'), Number(node.split('.')[0]) >= 22)
    assert.equal(calls.filter(call => !call.args.some(arg => arg.endsWith('settings-web.test.js'))).every(call => call.args.includes('--test-concurrency=1') === (platform === 'win32')), true)
    results.push({ platform, node, padding, actual: actual.map(batch => batch.files.length), predicted: expected.map(batch => batch.files.length), exact: JSON.stringify(actual) === JSON.stringify(expected) })
  }
  t.diagnostic(JSON.stringify({ cases: results, realChildSpawns: 0, canonicalRunnerUnchanged: true }))
  assert.equal(results.length, 12)
  assert.equal(results.every(row => row.exact), true, 'observer must reconstruct every original fixed argv boundary without changing test order, list or32000 limit')
})
