import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
const supply = require(path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-browser-supply.cjs'))
// ZIP-format fixtures contain inert text, never an executable/browser/native receipt.
const inert = Buffer.from('INERT_NOT_AN_EXECUTABLE')
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex')
function zip(entries: { name: string; bytes?: Buffer; deflate?: boolean; crcWrong?: boolean; attributes?: number }[]) {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name), bytes = e.bytes ?? inert, compressed = e.deflate ? deflateRawSync(bytes) : bytes
    const crc = ((supply.crcUpdate(0xffffffff, bytes) ^ 0xffffffff) >>> 0) ^ (e.crcWrong ? 1 : 0)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(e.deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26)
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(e.deflate ? 8 : 0, 10)
    directory.writeUInt32LE(crc >>> 0, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE((e.attributes ?? 0) >>> 0, 38); directory.writeUInt32LE(offset, 42)
    locals.push(local, name, compressed); central.push(directory, name); offset += local.length + name.length + compressed.length
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}
function prepare(bytes: Buffer, exe = hash(inert)) {
  const root = fs.mkdtempSync(path.join(process.env.CMSPARK_TEST_RUN_DIR!, 'supply-cpu-')), archive = path.join(root, 'fixture.zip')
  fs.writeFileSync(archive, bytes)
  const pin = { kind: 'chrome-for-testing', platform: 'win64', version: '155.0.8059.84', source: 'https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.84/win64/chrome-win64.zip', archiveBytes: bytes.length, archiveSHA256: hash(bytes), executableSHA256: exe }
  return { root, archive, pin, destination: path.join(root, 'unpacked') }
}
async function refuse(entries: Parameters<typeof zip>[0], reason: RegExp) {
  const x = prepare(zip(entries)); await assert.rejects(supply.extract(x.archive, x.destination, x.pin), reason)
}
test('empty source pins refuse before network; setup transfer budget is independent', () => {
  assert.throws(() => supply.selectPin({ version: 1, builds: [] }), /NOT_READY/)
  assert.equal(supply.TRANSFER_MS, 600000)
})
test('fixed URL and exact archive length are mandatory, without eligibility booleans', () => {
  const x = prepare(zip([{ name: 'chrome-win64/chrome.exe' }]))
  for (const bad of [{ source: 'https://example.invalid/chrome.zip' }, { archiveBytes: undefined }, { archiveBytes: 0 }, { kind: 'system-chrome' }])
    assert.throws(() => supply.selectPin({ version: 1, builds: [{ ...x.pin, ...bad }] }), /NOT_READY/)
})
test('actual supplier extracts stored and deflated inert bytes, checks CRC and exact EXE hash', async () => {
  const x = prepare(zip([{ name: 'chrome-win64/', bytes: Buffer.alloc(0) }, { name: 'chrome-win64/chrome.exe', deflate: true }, { name: 'chrome-win64/resources/file.txt', bytes: Buffer.from('text') }]))
  const exe = await supply.extract(x.archive, x.destination, x.pin)
  assert.deepEqual(fs.readFileSync(exe), inert)
  assert.equal(fs.readFileSync(path.join(x.destination, 'chrome-win64/resources/file.txt'), 'utf8'), 'text')
})
test('archive mutation refuses before creating extraction tree', async () => {
  const x = prepare(zip([{ name: 'chrome-win64/chrome.exe' }])); const bad = Buffer.from(fs.readFileSync(x.archive)); bad[40] ^= 1; fs.writeFileSync(x.archive, bad)
  await assert.rejects(supply.extract(x.archive, x.destination, x.pin), /ARCHIVE_HASH/); assert.equal(fs.existsSync(x.destination), false)
})
test('incorrect expanded CRC fails despite a pinned outer archive', async () => { await refuse([{ name: 'chrome-win64/chrome.exe', crcWrong: true }], /ZIP_CRC/) })
test('wrong executable hash refuses without executing bytes', async () => {
  const x = prepare(zip([{ name: 'chrome-win64/chrome.exe' }]), '0'.repeat(64))
  await assert.rejects(supply.extract(x.archive, x.destination, x.pin), /EXECUTABLE_HASH/)
})
test('traversal, ADS and reserved Windows names refuse before extraction', async () => {
  for (const name of ['chrome-win64/../outside', 'chrome-win64/file:stream', 'chrome-win64/CON.txt', 'chrome-win64/dir./x'])
    await refuse([{ name: 'chrome-win64/chrome.exe' }, { name }], /ZIP_NAME/)
})
test('Windows case aliases and duplicate paths refuse before extraction', async () => {
  await refuse([{ name: 'chrome-win64/chrome.exe' }, { name: 'chrome-win64/CHROME.EXE' }], /ZIP_DUPLICATE/)
  await refuse([{ name: 'chrome-win64/chrome.exe' }, { name: 'chrome-win64/A/x' }, { name: 'chrome-win64/a/y' }], /ZIP_CASE_ALIAS/)
})
test('symlinks/reparse entries and file parents refuse', async () => {
  await refuse([{ name: 'chrome-win64/chrome.exe', attributes: 0xa0000000 }], /ZIP_SPECIAL/)
  await refuse([{ name: 'chrome-win64/chrome.exe', attributes: 0x400 }], /ZIP_SPECIAL/)
  await refuse([{ name: 'chrome-win64/chrome.exe' }, { name: 'chrome-win64/p' }, { name: 'chrome-win64/p/child' }], /ZIP_PARENT_FILE/)
})
test('mismatched local name and missing actual executable refuse', async () => {
  const data = zip([{ name: 'chrome-win64/chrome.exe' }]); data[30] = 0x43
  const x = prepare(data); await assert.rejects(supply.extract(x.archive, x.destination, x.pin), /ZIP_LOCAL_NAME/)
  await refuse([{ name: 'chrome-win64/other.exe' }], /ZIP_EXECUTABLE/)
})
test('supplier never merges with an existing extraction directory', async () => {
  const x = prepare(zip([{ name: 'chrome-win64/chrome.exe' }])); fs.mkdirSync(x.destination); fs.writeFileSync(path.join(x.destination, 'retain.txt'), 'retain')
  await assert.rejects(supply.extract(x.archive, x.destination, x.pin), /EEXIST/)
  assert.equal(fs.readFileSync(path.join(x.destination, 'retain.txt'), 'utf8'), 'retain')
})
