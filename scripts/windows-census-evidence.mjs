// #650 evidence only. No app authority, arbitrary file API, or runtime recipient override.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline, finished } from 'node:stream/promises'
import { createInterface } from 'node:readline'

const PURPOSE = 'CMSPARK_WINDOWS_CENSUS_650'
const ALGORITHM = 'RSA-OAEP-SHA256+A256GCM'
const PEM_SHA256 = 'be77436ea653fe38e5741659ce5b5421f4aabf92f80b9db85818d6af2dbc2a23'
const SPKI_SHA256 = '3adfed76775c539aa40b2f8b0faee00592a5ad3f362687ff637296174cb0da78'
const MAX_FILES = 4096, MAX_ENVELOPE = 2 * 1024 * 1024
const stagesOrder = ['install', 'build', 'stage', 'tests']
const rawNames = stagesOrder.flatMap(stage => [`raw/${stage}.stdout`, `raw/${stage}.stderr`])
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const fail = code => { throw Error('CENSUS_EVIDENCE_' + code) }
const keys = (object, names) => {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).sort().join('\0') !== [...names].sort().join('\0')) fail('SCHEMA')
}
const integer = x => Number.isSafeInteger(x) && x >= 0
const hex = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)
function base64(value, bytes) {
  if (typeof value !== 'string') fail('SCHEMA')
  const b = Buffer.from(value, 'base64')
  if (b.length !== bytes || b.toString('base64') !== value) fail('SCHEMA')
  return b
}
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  fail('SCHEMA')
}
function validateIdentity(identity) {
  keys(identity, ['head', 'tree', 'run', 'attempt', 'namespace'])
  if (!/^[0-9a-f]{40}$/.test(identity.head) || !/^[0-9a-f]{40}$/.test(identity.tree) || !/^[1-9]\d{0,19}$/.test(identity.run) || !/^[1-9]\d{0,9}$/.test(identity.attempt) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(identity.namespace)) fail('IDENTITY')
}
function allowed(name) {
  return rawNames.includes(name) || /^receipts\/events-[1-9]\d{0,15}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/.test(name)
}
function nonce(prefix, counter) { const b = Buffer.alloc(12); prefix.copy(b); b.writeUInt32BE(counter, 8); return b }
function aad(identity, name) { return Buffer.from(canonical({ purpose: PURPOSE, version: 1, identity, path: name })) }
function regular(stat) { if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.ino === 0n || stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) fail('INPUT_TYPE') }
function same(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && b.nlink === 1n && b.isFile() && !b.isSymbolicLink() }
function directory(dir) {
  const s = fs.lstatSync(dir, { bigint: true })
  if (!s.isDirectory() || s.isSymbolicLink()) fail('DIRECTORY')
  return s
}
function inputs(owned) {
  const out = []
  for (const kind of ['raw', 'receipts']) {
    directory(path.join(owned, kind))
    for (const name of fs.readdirSync(path.join(owned, kind)).sort()) {
      const relative = `${kind}/${name}`
      if (!allowed(relative)) fail('INPUT_NAME')
      out.push(relative)
    }
  }
  if (out.length > MAX_FILES) fail('METADATA_LIMIT')
  return out.sort()
}
async function openRegular(file) {
  const before = fs.lstatSync(file, { bigint: true }); regular(before)
  const flags = fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0))
  const handle = await fsp.open(file, flags)
  try { if (!same(before, await handle.stat({ bigint: true }))) fail('INPUT_REPLACED'); return { before, handle } }
  catch (error) { await handle.close(); throw error }
}
async function receiptComplete(stream) {
  let state = 'begin', events = 0, valid = true
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (Buffer.byteLength(line) > 256 * 1024) { valid = false; continue }
    let row
    try { row = JSON.parse(line) } catch { valid = false; continue }
    if (state === 'begin') { if (row.kind !== 'begin') valid = false; state = 'events' }
    else if (state === 'events' && row.kind === 'event') { if (row.seq !== events++) valid = false }
    else if (state === 'events' && row.kind === 'end') { if (row.events !== events) valid = false; state = 'end' }
    else valid = false
  }
  return valid && state === 'end'
}
function recipient() {
  const pem = fs.readFileSync(new URL('./windows-census-recipient-650.pem', import.meta.url))
  if (sha(pem) !== PEM_SHA256) fail('RECIPIENT')
  const key = crypto.createPublicKey(pem)
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 3072 || sha(key.export({ format: 'der', type: 'spki' })) !== SPKI_SHA256) fail('RECIPIENT')
  return key
}
function validateEnvelope(envelope) {
  keys(envelope, ['body', 'manifest_tag'])
  const b = envelope.body
  keys(b, ['version', 'purpose', 'algorithm', 'identity', 'recipient_sha256', 'wrapped_key', 'nonce_prefix', 'files', 'status'])
  if (b.version !== 1 || b.purpose !== PURPOSE || b.algorithm !== ALGORITHM || b.recipient_sha256 !== SPKI_SHA256) fail('SCHEMA')
  validateIdentity(b.identity); base64(b.wrapped_key, 384); const prefix = base64(b.nonce_prefix, 8); base64(envelope.manifest_tag, 16)
  keys(b.status, ['outcome', 'complete', 'capture_loss', 'receipt_eof_complete', 'missing_raw'])
  if (!['PASS', 'FAIL', 'INCOMPLETE'].includes(b.status.outcome) || ['complete', 'capture_loss', 'receipt_eof_complete'].some(k => typeof b.status[k] !== 'boolean') || !Array.isArray(b.status.missing_raw) || b.status.missing_raw.some(x => !rawNames.includes(x)) || new Set(b.status.missing_raw).size !== b.status.missing_raw.length) fail('SCHEMA')
  if (!Array.isArray(b.files) || b.files.length > MAX_FILES) fail('METADATA_LIMIT')
  let previous = ''
  for (const [i, row] of b.files.entries()) {
    keys(row, ['path', 'ciphertext', 'bytes', 'sha256', 'ciphertext_sha256', 'nonce', 'tag', 'observed_bytes', 'gap_bytes', 'complete'])
    if (!allowed(row.path) || row.path <= previous || row.ciphertext !== `${String(i + 1).padStart(4, '0')}.enc` || !integer(row.bytes) || !hex(row.sha256) || !hex(row.ciphertext_sha256) || typeof row.complete !== 'boolean') fail('SCHEMA')
    previous = row.path
    if (row.nonce !== nonce(prefix, i + 1).toString('base64')) fail('NONCE')
    base64(row.nonce, 12); base64(row.tag, 16)
    if ((row.observed_bytes !== null && (!integer(row.observed_bytes) || row.observed_bytes < row.bytes)) || (row.gap_bytes !== null && !integer(row.gap_bytes)) || (row.observed_bytes === null) !== (row.gap_bytes === null) || (row.observed_bytes !== null && row.observed_bytes - row.bytes !== row.gap_bytes)) fail('SCHEMA')
    if (row.complete && (row.gap_bytes !== 0 || row.observed_bytes !== row.bytes)) fail('STATUS')
    if (row.path.startsWith('receipts/') && (row.gap_bytes !== 0 || row.observed_bytes !== row.bytes)) fail('STATUS')
  }
  if (JSON.stringify(b.status.missing_raw) !== JSON.stringify([...b.status.missing_raw].sort())) fail('STATUS')
  if (b.status.missing_raw.some(name => b.files.some(f => f.path === name))) fail('STATUS')
  if (b.status.outcome === 'PASS' && !b.status.complete) fail('STATUS')
  if (b.status.complete && (b.status.outcome !== 'PASS' || b.status.capture_loss || !b.status.receipt_eof_complete || b.status.missing_raw.length || b.files.some(f => !f.complete || f.gap_bytes !== 0))) fail('STATUS')
  if (b.status.complete && (rawNames.some(name => !b.files.some(f => f.path === name)) || !b.files.some(f => f.path.startsWith('receipts/')))) fail('STATUS')
}

export async function sealEvidence({ owned, publicDir, identity, result }) {
  validateIdentity(identity)
  owned = fs.realpathSync(owned); publicDir = fs.realpathSync(publicDir)
  if (path.dirname(publicDir) !== owned || path.basename(publicDir) !== 'public') fail('DIRECTORY')
  directory(publicDir)
  const destination = path.join(publicDir, 'sealed')
  if (fs.existsSync(destination)) fail('OUTPUT_EXISTS')
  const names = inputs(owned), initialDirs = ['raw', 'receipts'].map(name => directory(path.join(owned, name)))
  const key = crypto.randomBytes(32), prefix = crypto.randomBytes(8)
  try {
  const stageDir = fs.mkdtempSync(path.join(owned, 'sealing-')); fs.chmodSync(stageDir, 0o700)
  const rawMetadata = new Map(), expectedRaw = []
  for (const [index, stage] of (result.stages ?? []).entries()) {
    if (stage.name !== stagesOrder[index]) fail('STATUS')
    for (const kind of ['stdout', 'stderr']) expectedRaw.push(`raw/${stage.name}.${kind}`)
    for (const file of stage.files ?? []) {
      if (!['stdout', 'stderr'].includes(file.kind)) fail('STATUS')
      rawMetadata.set(`raw/${stage.name}.${file.kind}`, file)
    }
  }
  if (names.some(n => n.startsWith('raw/') && !expectedRaw.includes(n))) fail('INPUT_NAME')
  const missing = expectedRaw.filter(n => !names.includes(n)).sort()
  const body = { version: 1, purpose: PURPOSE, algorithm: ALGORITHM, identity, recipient_sha256: SPKI_SHA256,
    wrapped_key: crypto.publicEncrypt({ key: recipient(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'),
    nonce_prefix: prefix.toString('base64'), files: [], status: null }
  const snapshots = []
  let receiptEOF = names.some(n => n.startsWith('receipts/'))
  for (const [i, name] of names.entries()) {
    const input = path.join(owned, name), { before, handle } = await openRegular(input)
    const output = `${String(i + 1).padStart(4, '0')}.enc`
    const h = crypto.createHash('sha256'), ch = crypto.createHash('sha256'); let bytes = 0
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce(prefix, i + 1), { authTagLength: 16 }); cipher.setAAD(aad(identity, name))
    const isReceipt = name.startsWith('receipts/'); let eof = false
    try {
      await pipeline(handle.createReadStream({ autoClose: false }), new Transform({ transform(chunk, _encoding, done) { h.update(chunk); bytes += chunk.length; done(null, chunk) } }), cipher,
        new Transform({ transform(chunk, _encoding, done) { ch.update(chunk); done(null, chunk) } }), fs.createWriteStream(path.join(stageDir, output), { flags: 'wx', mode: 0o600 }))
      if (!same(before, await handle.stat({ bigint: true })) || !same(before, fs.lstatSync(input, { bigint: true })) || bytes !== Number(before.size)) fail('INPUT_CHANGED')
      if (isReceipt) eof = await receiptComplete(handle.createReadStream({ start: 0, autoClose: false }))
    } finally { await handle.close() }
    snapshots.push({ input, before })
    const digest = h.digest('hex'), metadata = rawMetadata.get(name)
    if (metadata && (metadata.bytes !== bytes || metadata.sha256 !== digest)) fail('CAPTURE_MISMATCH')
    if (isReceipt) receiptEOF &&= eof
    body.files.push({ path: name, ciphertext: output, bytes, sha256: digest, ciphertext_sha256: ch.digest('hex'), nonce: nonce(prefix, i + 1).toString('base64'), tag: cipher.getAuthTag().toString('base64'),
      observed_bytes: isReceipt ? bytes : metadata?.observed_bytes ?? null,
      gap_bytes: isReceipt ? 0 : metadata?.gap_bytes ?? null, complete: isReceipt ? eof : metadata?.complete === true })
  }
  const loss = (result.stages ?? []).some(s => s.capture_error) || body.files.some(f => !f.complete || f.gap_bytes === null || f.gap_bytes > 0) || missing.length > 0
  const stagesComplete = result.stages?.length === 4 && result.stages.every(s => s.code === 0 && !s.signal && !s.spawn_error && !s.capture_error)
  const complete = result.outcome === 'PASS' && result.complete === true && stagesComplete && !loss && receiptEOF
  body.status = { outcome: complete ? 'PASS' : loss || !receiptEOF || result.outcome === 'INCOMPLETE' ? 'INCOMPLETE' : 'FAIL', complete, capture_loss: loss, receipt_eof_complete: receiptEOF, missing_raw: missing }
  const seal = crypto.createCipheriv('aes-256-gcm', key, nonce(prefix, 0), { authTagLength: 16 }); seal.setAAD(Buffer.from(canonical(body))); seal.final()
  const envelope = { body, manifest_tag: seal.getAuthTag().toString('base64') }
  validateEnvelope(envelope)
  const serialized = canonical(envelope)
  if (Buffer.byteLength(serialized) > MAX_ENVELOPE) fail('METADATA_LIMIT')
  if (JSON.stringify(inputs(owned)) !== JSON.stringify(names)) fail('DIRECTORY_CHANGED')
  for (const { input, before } of snapshots) if (!same(before, fs.lstatSync(input, { bigint: true }))) fail('INPUT_CHANGED')
  for (const [i, name] of ['raw', 'receipts'].entries()) {
    const after = directory(path.join(owned, name)); if (after.dev !== initialDirs[i].dev || after.ino !== initialDirs[i].ino || after.mtimeNs !== initialDirs[i].mtimeNs) fail('DIRECTORY_CHANGED')
  }
  fs.writeFileSync(path.join(stageDir, 'envelope.json'), serialized, { flag: 'wx', mode: 0o600 })
  fs.renameSync(stageDir, destination)
  return { status: body.status, files: body.files.length, recipient_sha256: SPKI_SHA256, envelope_sha256: sha(serialized) }
  } finally { key.fill(0) }
}

export async function recoverEvidence({ bundleDir, outputDir, privateKey, expected }) {
  validateIdentity(expected)
  directory(bundleDir)
  const envelopePath = path.join(bundleDir, 'envelope.json'), opened = await openRegular(envelopePath)
  let bytes
  try { if (opened.before.size > BigInt(MAX_ENVELOPE)) fail('METADATA_LIMIT'); bytes = await opened.handle.readFile(); if (!same(opened.before, await opened.handle.stat({ bigint: true })) || !same(opened.before, fs.lstatSync(envelopePath, { bigint: true }))) fail('INPUT_CHANGED') }
  finally { await opened.handle.close() }
  let envelope
  try { envelope = JSON.parse(bytes.toString('utf8')) } catch { fail('SCHEMA') }
  if (canonical(envelope) !== bytes.toString('utf8')) fail('CANONICAL')
  validateEnvelope(envelope)
  let key
  try {
    if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails?.modulusLength !== 3072) fail('RECIPIENT')
    key = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, base64(envelope.body.wrapped_key, 384))
    if (key.length !== 32) fail('RECIPIENT')
    const verifier = crypto.createDecipheriv('aes-256-gcm', key, nonce(base64(envelope.body.nonce_prefix, 8), 0), { authTagLength: 16 })
    verifier.setAAD(Buffer.from(canonical(envelope.body))); verifier.setAuthTag(base64(envelope.manifest_tag, 16)); verifier.final()
  } catch { key?.fill(0); fail('AUTH_FAILED') }
  try {
    // Metadata is authenticated before it can govern output paths, sizes or I/O.
    if (canonical(envelope.body.identity) !== canonical(expected)) fail('IDENTITY_MISMATCH')
    const listing = fs.readdirSync(bundleDir).sort()
    if (JSON.stringify(listing) !== JSON.stringify(['envelope.json', ...envelope.body.files.map(f => f.ciphertext)].sort())) fail('BUNDLE_LIST')
    if (fs.existsSync(outputDir)) fail('OUTPUT_EXISTS')
    fs.mkdirSync(outputDir, { mode: 0o700 })
    const partial = path.join(outputDir, 'partial'); fs.mkdirSync(partial, { mode: 0o700 })
    for (const kind of ['raw', 'receipts']) fs.mkdirSync(path.join(partial, kind), { mode: 0o700 })
    const snapshots = []
    for (const row of envelope.body.files) {
      const input = path.join(bundleDir, row.ciphertext), { before, handle } = await openRegular(input)
      const output = path.join(partial, row.path)
      const plainHash = crypto.createHash('sha256'), cipherHash = crypto.createHash('sha256'); let count = 0
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, base64(row.nonce, 12), { authTagLength: 16 }); decipher.setAAD(aad(expected, row.path)); decipher.setAuthTag(base64(row.tag, 16))
      try {
        if (before.size !== BigInt(row.bytes)) fail('CIPHERTEXT_SIZE')
        await pipeline(handle.createReadStream({ autoClose: false }), new Transform({ transform(chunk, _encoding, done) { cipherHash.update(chunk); done(null, chunk) } }), decipher,
          new Transform({ transform(chunk, _encoding, done) { plainHash.update(chunk); count += chunk.length; done(null, chunk) } }), fs.createWriteStream(output, { flags: 'wx', mode: 0o600 }))
        if (!same(before, await handle.stat({ bigint: true })) || !same(before, fs.lstatSync(input, { bigint: true }))) fail('INPUT_CHANGED')
        if (count !== row.bytes || plainHash.digest('hex') !== row.sha256 || cipherHash.digest('hex') !== row.ciphertext_sha256) fail('HASH_MISMATCH')
      } catch { fail('RESTORE_FAILED') }
      finally { await handle.close() }
      snapshots.push({ input, before })
      if (row.path.startsWith('receipts/') && row.complete) {
        const reader = fs.createReadStream(output)
        const [complete] = await Promise.all([receiptComplete(reader), finished(reader, { cleanup: true })])
        if (!complete) fail('RECEIPT_EOF')
      }
    }
    if (JSON.stringify(fs.readdirSync(bundleDir).sort()) !== JSON.stringify(listing)) fail('BUNDLE_LIST')
    for (const { input, before } of snapshots) if (!same(before, fs.lstatSync(input, { bigint: true }))) fail('INPUT_CHANGED')
    fs.writeFileSync(path.join(partial, 'verified.json'), canonical({ identity: expected, status: envelope.body.status, envelope_sha256: sha(bytes), files: envelope.body.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })) }), { flag: 'wx', mode: 0o600 })
    fs.renameSync(partial, path.join(outputDir, 'recovered'))
    return { status: envelope.body.status, files: envelope.body.files.length, envelope_sha256: sha(bytes) }
  } finally { key.fill(0) }
}
