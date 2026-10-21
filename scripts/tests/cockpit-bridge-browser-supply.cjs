// Remote test dependency supplier. No executable is launched by this module.
'use strict'
const fs = require('node:fs'), path = require('node:path'), https = require('node:https')
const { createHash } = require('node:crypto'), { Transform, Writable } = require('node:stream')
const { pipeline } = require('node:stream/promises'), { createInflateRaw } = require('node:zlib')
const { TextDecoder } = require('node:util')
const TRANSFER_MS = 600000 // New network setup budget only; one transfer, no retry.
function check(value, reason) { if (!value) throw Error('COCKPIT_BRIDGE_SUPPLY_' + reason) }
function selectPin(admission) {
  check(admission?.version === 1 && Array.isArray(admission.builds) && admission.builds.length === 1, 'NOT_READY')
  const p = admission.builds[0]
  check(p.kind === 'chrome-for-testing' && p.platform === 'win64' && /^[0-9]+(?:\.[0-9]+){3}$/.test(p.version), 'NOT_READY')
  check(p.source === `https://storage.googleapis.com/chrome-for-testing-public/${p.version}/win64/chrome-win64.zip` &&
    /^[0-9a-f]{64}$/.test(p.archiveSHA256) && /^[0-9a-f]{64}$/.test(p.executableSHA256) &&
    Number.isSafeInteger(p.archiveBytes) && p.archiveBytes > 0 && p.archiveBytes <= 0xffffffff, 'NOT_READY')
  return Object.freeze({ ...p })
}
async function download(pin, destination) {
  // Caller has already selected a source pin. Revalidate before any I/O/network.
  pin = selectPin({ version: 1, builds: [pin] })
  const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })
  const hash = createHash('sha256'); let bytes = 0, request
  const deadline = setTimeout(() => { request?.destroy(Error('COCKPIT_BRIDGE_SUPPLY_TRANSFER_DEADLINE')); output.destroy(Error('COCKPIT_BRIDGE_SUPPLY_TRANSFER_DEADLINE')) }, TRANSFER_MS)
  try {
    const response = await new Promise((resolve, reject) => {
      output.once('error', reject)
      request = https.get(pin.source, { agent: false, headers: { 'Accept-Encoding': 'identity' } }, resolve)
      request.once('error', reject)
    })
    // Redirects, decompressed responses and a missing/different length refuse.
    if (response.statusCode !== 200 || response.headers['content-encoding'] ||
        response.headers['content-length'] !== String(pin.archiveBytes)) {
      response.destroy(); throw Error('COCKPIT_BRIDGE_SUPPLY_HTTP')
    }
    await pipeline(response, new Transform({ transform(chunk, encoding, done) {
      bytes += chunk.length
      if (bytes > pin.archiveBytes) return done(Error('COCKPIT_BRIDGE_SUPPLY_SIZE'))
      hash.update(chunk); done(null, chunk)
    } }), output)
    check(bytes === pin.archiveBytes && hash.digest('hex') === pin.archiveSHA256, 'ARCHIVE_HASH')
  } finally { clearTimeout(deadline); request?.destroy(); output.destroy() }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let b = 0; b < 8; b++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); return n >>> 0 })
function crcUpdate(crc, buffer) { for (const b of buffer) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return crc >>> 0 }
function read(fd, length, offset) {
  check(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length >= 0, 'ZIP_RANGE')
  const out = Buffer.alloc(length); check(fs.readSync(fd, out, 0, length, offset) === length, 'ZIP_TRUNCATED'); return out
}
function safeName(bytes, flags) {
  let name
  if (flags & 0x800) name = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  else { check([...bytes].every(b => b >= 32 && b < 127), 'ZIP_NAME'); name = bytes.toString('ascii') }
  check(name.startsWith('chrome-win64/') && !name.includes('\\') && !/[\x00-\x1f\x7f:*?"<>|]/.test(name), 'ZIP_NAME')
  const parts = name.replace(/\/$/, '').split('/')
  check(parts.every(s => s && s !== '.' && s !== '..' && !/[. ]$/.test(s) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)), 'ZIP_NAME')
  return name
}
function inspectZip(fd, bytes) {
  check(bytes >= 22 && bytes <= 0xffffffff, 'ZIP_SIZE')
  // EOCD's format-defined maximum comment length is 65535.
  const tailStart = Math.max(0, bytes - 22 - 65535), tail = read(fd, bytes - tailStart, tailStart)
  let end = -1
  for (let n = tail.length - 22; n >= 0; n--) if (tail.readUInt32LE(n) === 0x06054b50 && n + 22 + tail.readUInt16LE(n + 20) === tail.length) { end = n; break }
  check(end >= 0, 'ZIP_EOCD')
  check(tail.readUInt16LE(end + 4) === 0 && tail.readUInt16LE(end + 6) === 0, 'ZIP_DISK')
  const count = tail.readUInt16LE(end + 10), centralBytes = tail.readUInt32LE(end + 12), central = tail.readUInt32LE(end + 16)
  check(count > 0 && count !== 0xffff && count === tail.readUInt16LE(end + 8) && centralBytes !== 0xffffffff && central !== 0xffffffff && central + centralBytes === tailStart + end, 'ZIP_DIRECTORY')
  const entries = [], names = new Map(), prefixes = new Map(); let cursor = central
  for (let i = 0; i < count; i++) {
    check(cursor + 46 <= central + centralBytes, 'ZIP_RANGE')
    const h = read(fd, 46, cursor); check(h.readUInt32LE(0) === 0x02014b50, 'ZIP_CENTRAL')
    const flags = h.readUInt16LE(8), method = h.readUInt16LE(10), crc = h.readUInt32LE(16), compressed = h.readUInt32LE(20), size = h.readUInt32LE(24)
    const nameBytes = h.readUInt16LE(28), extraBytes = h.readUInt16LE(30), commentBytes = h.readUInt16LE(32), local = h.readUInt32LE(42)
    check(h.readUInt16LE(6) <= 20 && !(flags & ~0x808) && (method === 0 || method === 8) && h.readUInt16LE(34) === 0 && compressed !== 0xffffffff && size !== 0xffffffff && local !== 0xffffffff, 'ZIP_FORMAT')
    check(cursor + 46 + nameBytes + extraBytes + commentBytes <= central + centralBytes, 'ZIP_RANGE')
    const rawName = read(fd, nameBytes, cursor + 46), name = safeName(rawName, flags), directory = name.endsWith('/')
    const mode = h.readUInt32LE(38) >>> 16, type = mode & 0xf000
    check((type === 0 || type === (directory ? 0x4000 : 0x8000)) && !(h.readUInt32LE(38) & 0x400), 'ZIP_SPECIAL')
    if (directory) check(size === 0, 'ZIP_DIRECTORY_DATA')
    const key = name.replace(/\/$/, '').toLowerCase(); check(!names.has(key), 'ZIP_DUPLICATE'); names.set(key, directory)
    const segments = name.replace(/\/$/, '').split('/')
    for (let k = 1; k <= segments.length; k++) {
      const prefix = segments.slice(0, k).join('/'), lower = prefix.toLowerCase()
      check(!prefixes.has(lower) || prefixes.get(lower) === prefix, 'ZIP_CASE_ALIAS'); prefixes.set(lower, prefix)
    }
    check(local + 30 <= central, 'ZIP_RANGE'); const l = read(fd, 30, local)
    check(l.readUInt32LE(0) === 0x04034b50 && l.readUInt16LE(6) === flags && l.readUInt16LE(8) === method && l.readUInt16LE(26) === nameBytes, 'ZIP_LOCAL')
    check(read(fd, nameBytes, local + 30).equals(rawName), 'ZIP_LOCAL_NAME')
    const start = local + 30 + nameBytes + l.readUInt16LE(28), dataEnd = start + compressed
    check(start <= central && dataEnd <= central, 'ZIP_RANGE')
    if (!(flags & 8)) check(l.readUInt32LE(14) === crc && l.readUInt32LE(18) === compressed && l.readUInt32LE(22) === size, 'ZIP_LOCAL_SIZE')
    else check([l.readUInt32LE(14), l.readUInt32LE(18), l.readUInt32LE(22)].every((v, j) => v === 0 || v === [crc, compressed, size][j]), 'ZIP_LOCAL_SIZE')
    let finish = dataEnd
    if (flags & 8) {
      const first = read(fd, 4, finish).readUInt32LE(0); if (first === 0x08074b50) finish += 4
      check(finish + 12 <= central, 'ZIP_DESCRIPTOR')
      const d = read(fd, 12, finish); check(d.readUInt32LE(0) === crc && d.readUInt32LE(4) === compressed && d.readUInt32LE(8) === size, 'ZIP_DESCRIPTOR'); finish += 12
    }
    entries.push({ name, directory, start, compressed, size, crc, method, local, finish })
    cursor += 46 + nameBytes + extraBytes + commentBytes
  }
  check(cursor === central + centralBytes, 'ZIP_DIRECTORY')
  for (const e of entries) {
    const parts = e.name.replace(/\/$/, '').split('/')
    for (let k = 1; k < parts.length; k++) check(names.get(parts.slice(0, k).join('/').toLowerCase()) !== false, 'ZIP_PARENT_FILE')
  }
  const ordered = [...entries].sort((a, b) => a.local - b.local); let next = 0
  for (const e of ordered) { check(e.local === next, 'ZIP_OVERLAP_OR_GAP'); next = e.finish }
  check(next === central && entries.some(e => e.name === 'chrome-win64/chrome.exe' && !e.directory), 'ZIP_EXECUTABLE')
  return entries
}
async function extract(archive, destination, pin) {
  pin = selectPin({ version: 1, builds: [pin] })
  const archiveStat = fs.lstatSync(archive)
  check(archiveStat.isFile() && !archiveStat.isSymbolicLink() && archiveStat.nlink === 1, 'ARCHIVE_FILE')
  const fd = fs.openSync(archive, 'r')
  try {
    const stat = fs.fstatSync(fd); check(stat.isFile() && stat.size === pin.archiveBytes, 'ARCHIVE_SIZE')
    const digest = createHash('sha256')
    for await (const chunk of fs.createReadStream(archive, { fd, autoClose: false, start: 0, end: stat.size - 1 })) digest.update(chunk)
    check(digest.digest('hex') === pin.archiveSHA256, 'ARCHIVE_HASH')
    const entries = inspectZip(fd, stat.size)
    fs.mkdirSync(destination) // New owned directory only; never merge into a supplied tree.
    let executableSHA256
    for (const e of entries) {
      const target = path.join(destination, ...e.name.replace(/\/$/, '').split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      if (e.directory) fs.mkdirSync(target, { recursive: true })
      let size = 0, crc = 0xffffffff; const hash = createHash('sha256')
      const verify = new Transform({ transform(chunk, encoding, done) {
        size += chunk.length; if (size > e.size) return done(Error('COCKPIT_BRIDGE_SUPPLY_ZIP_EXPANDED_SIZE'))
        crc = crcUpdate(crc, chunk); hash.update(chunk); done(null, chunk)
      } })
      const input = e.compressed ? fs.createReadStream(archive, { fd, autoClose: false, start: e.start, end: e.start + e.compressed - 1 }) : require('node:stream').Readable.from([])
      const output = e.directory ? new Writable({ write(chunk, encoding, done) { done() } }) : fs.createWriteStream(target, { flags: 'wx', mode: 0o600 })
      await pipeline(...(e.method === 8 ? [input, createInflateRaw(), verify, output] : [input, verify, output]))
      check(size === e.size && ((crc ^ 0xffffffff) >>> 0) === e.crc, 'ZIP_CRC')
      if (e.name === 'chrome-win64/chrome.exe') executableSHA256 = hash.digest('hex')
    }
    check(executableSHA256 === pin.executableSHA256, 'EXECUTABLE_HASH')
    return path.join(destination, 'chrome-win64', 'chrome.exe')
  } finally { fs.closeSync(fd) }
}
module.exports = { TRANSFER_MS, selectPin, download, inspectZip, extract, crcUpdate }
