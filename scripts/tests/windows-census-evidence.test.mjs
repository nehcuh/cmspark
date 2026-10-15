import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { capture, childEnvironment, discover, reconcile } from '../windows-census.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const retained = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-evidence-controls-'))); fs.chmodSync(retained, 0o700)
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 })
const wrongPair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 })
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
const moduleDir = path.join(retained, 'module'); fs.mkdirSync(moduleDir)
const pem = pair.publicKey.export({ type: 'spki', format: 'pem' })
const realSource = fs.readFileSync(path.join(root, 'scripts/windows-census-evidence.mjs'), 'utf8')
// Declared test seam: same complete production module, only the two fixed public
// recipient fingerprints and its PEM differ. No protocol/state/crypto body rewrite.
const source = realSource.replace('be77436ea653fe38e5741659ce5b5421f4aabf92f80b9db85818d6af2dbc2a23', hash(pem)).replace('3adfed76775c539aa40b2f8b0faee00592a5ad3f362687ff637296174cb0da78', hash(pair.publicKey.export({ type: 'spki', format: 'der' })))
fs.writeFileSync(path.join(moduleDir, 'windows-census-evidence.mjs'), source)
fs.writeFileSync(path.join(moduleDir, 'windows-census-recipient-650.pem'), pem)
fs.writeFileSync(path.join(retained, 'boundary.json'), JSON.stringify({ production_source_sha256: hash(realSource), executed_source_sha256: hash(source), substitutions: 'only two recipient fingerprints plus public PEM; private pairs in memory only', private_key_written: false }, null, 2))
const { sealEvidence, recoverEvidence, canonical } = await import(pathToFileURL(path.join(moduleDir, 'windows-census-evidence.mjs')))
const reporter = path.join(root, 'scripts/windows-census-reporter.mjs')
let index = 0
async function fixture({ captureLoss = false } = {}) {
  const owned = path.join(retained, `case-${index++}`); fs.mkdirSync(owned, { mode: 0o700 })
  const raw = path.join(owned, 'raw'), receipts = path.join(owned, 'receipts'), publicDir = path.join(owned, 'public'), companion = path.join(owned, 'companion')
  for (const dir of [raw, receipts, publicDir]) fs.mkdirSync(dir, { mode: 0o700 })
  fs.mkdirSync(path.join(companion, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(companion, '.test-dist/tests'), { recursive: true })
  for (const file of ['run-tests.mjs', 'test-data-dir.cjs']) fs.copyFileSync(path.join(root, 'companion/scripts', file), path.join(companion, 'scripts', file))
  fs.writeFileSync(path.join(companion, '.test-dist/tests/a.test.js'), 'const test=require("node:test");console.log("OWNED_RAW_CANARY_650");test("actual",()=>{});')
  fs.writeFileSync(path.join(companion, '.test-dist/tests/settings-web.test.js'), 'require("node:test")("settings",()=>{});')
  const env = childEnvironment(process.env, owned, raw), stages = []
  // Three inert real Node processes stand at install/build/stage boundaries;
  // test stage runs the actual unchanged canonical runner on synthetic source.
  for (const name of ['install', 'build', 'stage']) {
    const io = captureLoss && name === 'install' ? { async open(file, ...args) { const handle = await fsp.open(file, ...args); if (!file.endsWith('.stdout')) return handle; let first = true; return { async writeFile(chunk) { await handle.writeFile(chunk); if (first) { first = false; await handle.close() } }, close: () => handle.close() } } } : fsp
    stages.push(await capture(process.execPath, ['-e', 'console.log("OWNED_INERT_STAGE");setTimeout(()=>console.log("OWNED_TAIL"),10)'], { cwd: companion, env, raw, name }, io))
  }
  stages.push(await capture(process.execPath, [path.join(companion, 'scripts/run-tests.mjs')], { cwd: companion, env: { ...env, CMSPARK_CENSUS_DIR: receipts, NODE_OPTIONS: `--test-reporter=${JSON.stringify(pathToFileURL(reporter).href)}` }, raw, name: 'tests' }))
  const accounting = await reconcile({ companion, receipts, rawFile: path.join(raw, 'tests.stdout'), discovery: discover(companion), execution: stages.at(-1) })
  assert.equal(accounting.outcome, 'PASS')
  const identity = { head: 'd00772eda2d430253845595f11f1c491930685aa', tree: 'e3e592f71e17b08be31bef4124306dc01f78d7e7', run: '1', attempt: '1', namespace: crypto.randomUUID() }
  const result = { outcome: 'PASS', complete: true, stages }
  fs.writeFileSync(path.join(owned, 'actual-producer.json'), JSON.stringify({ identity, result, accounting }, null, 2))
  return { owned, raw, receipts, publicDir, identity, result, bundleDir: path.join(publicDir, 'sealed') }
}
const recover = (f, outputDir = path.join(f.owned, 'restored'), key = pair.privateKey, expected = f.identity) => recoverEvidence({ bundleDir: f.bundleDir, outputDir, privateKey: key, expected })
const envelope = f => JSON.parse(fs.readFileSync(path.join(f.bundleDir, 'envelope.json'), 'utf8'))
const rewrite = (f, value) => fs.writeFileSync(path.join(f.bundleDir, 'envelope.json'), canonical(value))
const evidenceError = error => /^CENSUS_EVIDENCE_/.test(error.message)
test.after(() => console.log('CENSUS_EVIDENCE_CONTROL_RETAINED ' + retained))

test('actual capture → canonical accounting → sealed serializer → recovery roundtrip; publication has no plaintext/private key', async () => {
  const f = await fixture(), sealed = await sealEvidence(f)
  assert.equal(sealed.status.complete, true)
  const restored = await recover(f); assert.equal(restored.status.complete, true)
  for (const row of envelope(f).body.files) assert.deepEqual(fs.readFileSync(path.join(f.owned, row.path)), fs.readFileSync(path.join(f.owned, 'restored/recovered', row.path)))
  for (const file of fs.readdirSync(f.bundleDir)) {
    const b = fs.readFileSync(path.join(f.bundleDir, file))
    assert.equal(b.includes(Buffer.from('OWNED_RAW_CANARY_650')), false); assert.equal(b.includes(Buffer.from('BEGIN PRIVATE KEY')), false)
  }
  await assert.rejects(recover(f), /CENSUS_EVIDENCE_OUTPUT_EXISTS/)
  await assert.rejects(sealEvidence(f), /CENSUS_EVIDENCE_OUTPUT_EXISTS/)
})

for (const mode of ['wrong-key', 'manifest-tag', 'file-tag', 'nonce', 'declared-size', 'envelope-limit', 'ciphertext', 'missing-file', 'duplicate', 'reorder', 'unknown-field', 'duplicate-json-key', 'wrong-identity', 'missing-ciphertext', 'extra-file']) {
  test(`actual serialized bundle ${mode} is refused without a final restored tree`, async () => {
    const f = await fixture(); await sealEvidence(f)
    const e = envelope(f)
    if (mode === 'manifest-tag') { const b = Buffer.from(e.manifest_tag, 'base64'); b[0] ^= 1; e.manifest_tag = b.toString('base64'); rewrite(f, e) }
    if (mode === 'file-tag') { const b = Buffer.from(e.body.files[0].tag, 'base64'); b[0] ^= 1; e.body.files[0].tag = b.toString('base64'); rewrite(f, e) }
    if (mode === 'nonce') { const b = Buffer.from(e.body.files[0].nonce, 'base64'); b[0] ^= 1; e.body.files[0].nonce = b.toString('base64'); rewrite(f, e) }
    if (mode === 'declared-size') { e.body.files[0].bytes++; rewrite(f, e) }
    if (mode === 'envelope-limit') fs.appendFileSync(path.join(f.bundleDir, 'envelope.json'), ' '.repeat(2 * 1024 * 1024))
    if (mode === 'ciphertext') { const p = path.join(f.bundleDir, e.body.files.find(x => x.bytes > 0).ciphertext), b = fs.readFileSync(p); b[0] ^= 1; fs.writeFileSync(p, b) }
    if (mode === 'missing-file') { e.body.files.pop(); rewrite(f, e) }
    if (mode === 'duplicate') { e.body.files.push(e.body.files[0]); rewrite(f, e) }
    if (mode === 'reorder') { e.body.files.reverse(); rewrite(f, e) }
    if (mode === 'unknown-field') { e.body.unknown = 'not allowed'; rewrite(f, e) }
    if (mode === 'duplicate-json-key') { const p = path.join(f.bundleDir, 'envelope.json'); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('"version":1', '"version":1,"version":1')) }
    if (mode === 'missing-ciphertext') fs.unlinkSync(path.join(f.bundleDir, e.body.files[0].ciphertext))
    if (mode === 'extra-file') fs.writeFileSync(path.join(f.bundleDir, 'extra.enc'), 'inert')
    const output = path.join(f.owned, 'rejected')
    await assert.rejects(recover(f, output, mode === 'wrong-key' ? wrongPair.privateKey : pair.privateKey, mode === 'wrong-identity' ? { ...f.identity, run: '2' } : f.identity), evidenceError)
    assert.equal(fs.existsSync(path.join(output, 'recovered')), false)
    assert.equal(fs.existsSync(path.join(f.raw, 'tests.stdout')), true)
  })
}

for (const mode of ['symlink', 'hardlink', 'unknown-path', 'replaced', 'midstream-input', 'midstream-output']) {
  test(`actual owned ${mode} primitive blocks sealing and retains raw/partial evidence`, async t => {
    const f = await fixture(), target = path.join(f.raw, 'tests.stdout'), original = fs.readFileSync(target)
    if (mode === 'symlink' || mode === 'hardlink') {
      const other = path.join(f.owned, 'owned-original'); fs.renameSync(target, other)
      if (mode === 'symlink') fs.symlinkSync(other, target, 'file'); else fs.linkSync(other, target)
    }
    if (mode === 'unknown-path') fs.writeFileSync(path.join(f.raw, 'unexpected'), 'inert')
    if (mode === 'replaced' || mode === 'midstream-input') {
      const real = fsp.open.bind(fsp); let injected = false
      t.mock.method(fsp, 'open', async (file, ...args) => {
        if (file === target && !injected) {
          injected = true
          if (mode === 'replaced') { fs.renameSync(target, path.join(f.owned, 'before-replace')); fs.writeFileSync(target, original) }
          const handle = await real(file, ...args)
          if (mode === 'midstream-input') { const create = handle.createReadStream.bind(handle); handle.createReadStream = opts => { const stream = create(opts); stream.once('data', () => fs.appendFileSync(target, 'OWNED_MUTATION')); return stream } }
          return handle
        }
        return real(file, ...args)
      })
    }
    if (mode === 'midstream-output') {
      const real = fs.createWriteStream.bind(fs); let injected = false
      t.mock.method(fs, 'createWriteStream', (file, ...args) => { const stream = real(file, ...args); if (String(file).endsWith('.enc') && !injected) { injected = true; stream.once('open', fd => fs.closeSync(fd)) } return stream })
    }
    await assert.rejects(sealEvidence(f))
    assert.equal(fs.existsSync(f.bundleDir), false)
    assert.equal(fs.existsSync(target), true)
    if (!['midstream-input', 'symlink', 'hardlink'].includes(mode)) assert.deepEqual(fs.readFileSync(target), original)
    t.mock.restoreAll()
  })
}

test('actual truncated receipt stays incomplete after successful sealing/recovery; authentication never washes lost EOF green', async () => {
  const f = await fixture(), receipt = path.join(f.receipts, fs.readdirSync(f.receipts)[0])
  const lines = fs.readFileSync(receipt, 'utf8').trim().split('\n'); fs.writeFileSync(receipt, lines.slice(0, -1).join('\n') + '\n')
  const sealed = await sealEvidence(f)
  assert.equal(sealed.status.complete, false); assert.equal(sealed.status.outcome, 'INCOMPLETE'); assert.equal(sealed.status.receipt_eof_complete, false)
  const restored = await recover(f)
  assert.equal(restored.status.complete, false); assert.equal(restored.status.outcome, 'INCOMPLETE')
})


test('actual captured EBADF gap cannot be washed PASS by a caller or authenticated sealing/recovery', async () => {
  const f = await fixture({ captureLoss: true })
  assert.equal(f.result.stages[0].code, 0); assert.equal(f.result.stages[0].capture_error, true)
  const sealed = await sealEvidence(f), body = envelope(f).body
  assert.equal(sealed.status.outcome, 'INCOMPLETE'); assert.equal(sealed.status.complete, false)
  assert.equal(sealed.status.capture_loss, true)
  assert.ok(body.files.find(row => row.path === 'raw/install.stdout').gap_bytes > 0)
  const recovered = await recover(f)
  assert.equal(recovered.status.complete, false)
  assert.deepEqual(fs.readFileSync(path.join(f.raw, 'install.stdout')), fs.readFileSync(path.join(f.owned, 'restored/recovered/raw/install.stdout')))
})

test('actual decrypt output EBADF never publishes a verified tree and retains source ciphertext/raw', async t => {
  const f = await fixture(); await sealEvidence(f)
  const real = fs.createWriteStream.bind(fs); let injected = false
  t.mock.method(fs, 'createWriteStream', (file, ...args) => { const stream = real(file, ...args); if (String(file).includes(path.sep + 'partial' + path.sep) && !injected) { injected = true; stream.once('open', fd => fs.closeSync(fd)) } return stream })
  const output = path.join(f.owned, 'write-failure')
  await assert.rejects(recover(f, output), /CENSUS_EVIDENCE_RESTORE_FAILED/)
  assert.equal(fs.existsSync(path.join(output, 'recovered')), false)
  assert.equal(fs.existsSync(path.join(f.raw, 'tests.stdout')), true)
  assert.equal(fs.existsSync(path.join(f.bundleDir, 'envelope.json')), true)
  t.mock.restoreAll()
})


test('actual withheld closed stage streams remain explicitly missing, sorted and incomplete after recovery', async () => {
  const f = await fixture()
  for (const kind of ['stdout', 'stderr']) fs.renameSync(path.join(f.raw, 'install.' + kind), path.join(f.owned, 'withheld-install.' + kind))
  const sealed = await sealEvidence(f)
  assert.equal(sealed.status.complete, false); assert.equal(sealed.status.outcome, 'INCOMPLETE')
  assert.deepEqual(sealed.status.missing_raw, ['raw/install.stderr', 'raw/install.stdout'])
  assert.equal((await recover(f)).status.complete, false)
  assert.equal(fs.existsSync(path.join(f.owned, 'withheld-install.stdout')), true)
})
