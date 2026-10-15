import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { childEnvironment, rejectCheckoutCredentials, capture, discover, reconcile, scheduledBatches, inventory, stageSucceeded } from '../windows-census.mjs'

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
