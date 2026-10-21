// Test-only finite observation. No error inspection and no acceptance authority.
'use strict'
const fs = require('node:fs')
const catalogue = require('./cockpit-bridge-first-sites.cjs')
const LIMIT = 4096, CODES = new Set(['SYNC_REFUSED', 'ASSERT_REFUSED', 'CHECK_REFUSED', 'SCOPE_REFUSED', 'AWAIT_REFUSED', 'CALLBACK_REFUSED'])
const siteOK = site => Number.isInteger(site) && Object.hasOwn(catalogue.sites, site)
const pendingOK = (foreground, pending) => (foreground === 0 || siteOK(foreground)) && Array.isArray(pending) && pending.length <= 128 && pending.every((site, index) => siteOK(site) && (index === 0 || pending[index - 1] < site)) && (foreground === 0 || pending.includes(foreground))
const refusalOK = value => value !== null && Object.keys(value).join(',') === 'site,code,foreground,pending' && siteOK(value.site) && CODES.has(value.code) && pendingOK(value.foreground, value.pending)
function createObserver(write = bytes => {
  const stat = fs.fstatSync(3)
  if (!Number.isInteger(stat.mode)) return 0
  // Windows Stats.isFIFO()/isSocket() return false even for libuv pipe modes.
  const type = stat.mode & fs.constants.S_IFMT
  if (type !== fs.constants.S_IFIFO && type !== fs.constants.S_IFSOCK) return 0
  return fs.writeSync(3, bytes)
}) {
  let first = null, cleanupFirst = null, interrupted = false, completed = false, started = false, cleanup = false, surface = 0, armed = 0, written = 0, disabled = false
  const active = new Map(); let sequence = 0
  const safe = action => { try { return action() } catch { } }
  const emit = value => safe(() => {
    if (disabled) return
    const bytes = Buffer.from(JSON.stringify(value) + '\n', 'ascii')
    if (written + bytes.length > LIMIT) { disabled = true; return }
    written += bytes.length
    // A partial write is not a complete frame; never retry or affect the gate.
    if (write(bytes) !== bytes.length) disabled = true
  })
  const refuse = (site, code) => safe(() => {
    if (!siteOK(site) || !CODES.has(code) || completed) return
    const value = { site, code, foreground: [...active.values()].at(-1) || 0, pending: [...new Set(active.values())].sort((a, b) => a - b) }
    if (cleanup && cleanupFirst === null) cleanupFirst = value
    if (first === null) { first = value; emit({ v: 1, kind: 'first', ...value }) }
  })
  const enter = site => { const token = ++sequence; active.set(token, site); return token }
  const leave = token => { active.delete(token) }
  const observer = {
    refuse,
    sync(site, action) { try { return action() } catch (error) { refuse(site, 'SYNC_REFUSED'); if (!started) observer.complete(false); throw error } },
    assert(site, assertion) { return (...args) => { try { return assertion(...args) } catch (error) { refuse(site, 'ASSERT_REFUSED'); if (!started) observer.complete(false); throw error } } },
    check(site, action) { try { return action() } catch (error) { refuse(site, 'CHECK_REFUSED'); if (!started) observer.complete(false); throw error } },
    primary(site) { if (first === null) refuse(site, 'SCOPE_REFUSED') },
    callback(site, action) { return function (...args) { try { return Reflect.apply(action, this, args) } catch (error) { refuse(site, 'CALLBACK_REFUSED'); throw error } } },
    async wait(site, action, fallbackOnly = false) {
      const token = enter(site)
      try { return await action() } catch (error) { if (!fallbackOnly || first === null) refuse(site, 'AWAIT_REFUSED'); throw error }
      finally { leave(token) }
    },
    surfaceWait(site, action) { return observer.wait(site, action, true) },
    fallback(site, code) { if (first === null) refuse(site, code) },
    arm(site, action) { const previous = armed; armed = site; try { return action() } finally { armed = previous } },
    dependency() { const token = siteOK(armed) ? enter(armed) : null; return () => { if (token !== null) leave(token) } },
    cleanup() { cleanup = true },
    surface(value) { if ([0, 1, 2].includes(value)) surface = value },
    start(signal) {
      started = true
      signal.addEventListener('abort', () => safe(() => {
        if (completed || interrupted) return
        interrupted = true
        const pending = [...new Set(active.values())].sort((a, b) => a - b)
        const foreground = [...active.values()].at(-1) || 0
        emit({ v: 1, kind: 'interrupt', foreground, pending, surface })
      }), { once: true })
    },
    complete(ok) {
      if (completed) return
      completed = true
      emit({ v: 1, kind: 'completion', ok: ok === true, surface, cleanupFirst })
    },
  }
  return observer
}
function capture(stream) {
  let bytes = 0, invalid = false, eof = false, parts = []
  if (!stream || typeof stream.on !== 'function') invalid = true
  else {
    stream.on('data', chunk => {
      if (invalid) return
      bytes += chunk.length
      if (bytes > LIMIT) { invalid = true; parts = []; return } // Continue draining through EOF; never induce EPIPE.
      parts.push(Buffer.from(chunk))
    })
    stream.on('error', () => { invalid = true; parts = [] })
    stream.on('end', () => { eof = true })
  }
  return { finish(closed) { return !invalid && eof && closed === true ? decode(Buffer.concat(parts)) : null } }
}
function decode(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > LIMIT || bytes.some(byte => byte > 127) || bytes.at(-1) !== 10) return null
    const lines = bytes.toString('ascii').slice(0, -1).split('\n')
    if (lines.length > 3) return null
    const seen = new Set(), result = { first: null, interrupt: null, completion: null }
    for (const line of lines) {
      const value = JSON.parse(line)
      if (!value || Array.isArray(value) || JSON.stringify(value) !== line || value.v !== 1 || !Object.hasOwn(result, value.kind) || seen.has(value.kind) || seen.has('completion')) return null
      seen.add(value.kind)
      if (value.kind === 'first') {
        if (Object.keys(value).join(',') !== 'v,kind,site,code,foreground,pending' || !refusalOK({ site: value.site, code: value.code, foreground: value.foreground, pending: value.pending })) return null
      } else if (value.kind === 'interrupt') {
        if (Object.keys(value).join(',') !== 'v,kind,foreground,pending,surface' || ![0, 1, 2].includes(value.surface) || !pendingOK(value.foreground, value.pending)) return null
      } else if (Object.keys(value).join(',') !== 'v,kind,ok,surface,cleanupFirst' || typeof value.ok !== 'boolean' || ![0, 1, 2].includes(value.surface) || !(value.cleanupFirst === null || refusalOK(value.cleanupFirst))) return null
      result[value.kind] = value
    }
    return result
  } catch { return null }
}
function runnerOutcome(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) return 'UNKNOWN'
  const lines = text.split(/\r?\n/), begin = lines.indexOf('  ---'), end = lines.indexOf('  ...', begin + 1)
  if (begin < 0 || end < 0 || lines.filter(line => /^not ok 1 - /.test(line)).length !== 1 || !lines.includes('1..1')) return 'UNKNOWN'
  const types = lines.slice(begin + 1, end).filter(line => /^  failureType: /.test(line))
  if (types.length !== 1) return 'UNKNOWN'
  return new Map([["  failureType: 'testTimeoutFailure'", 'TIMEOUT'], ["  failureType: 'testCodeFailure'", 'CODE_FAILURE'], ["  failureType: 'uncaughtException'", 'UNCAUGHT_EXCEPTION'], ["  failureType: 'unhandledRejection'", 'UNHANDLED_REJECTION'], ["  failureType: 'cancelledByParent'", 'CANCELLED']]).get(types[0]) || 'UNKNOWN'
}
function publicEvidence(record, text) {
  if (record === null) return null
  const locate = site => site === 0 ? null : { role: 1, site, line: catalogue.sites[site][0], column: catalogue.sites[site][1] }
  const refusal = value => value ? { ...locate(value.site), code: value.code, foreground: locate(value.foreground), pending: value.pending.map(locate) } : null
  return { v: 1, sourceSHA256: catalogue.sourceSHA256,
    first: refusal(record.first),
    interrupt: record.interrupt ? { foreground: locate(record.interrupt.foreground), pending: record.interrupt.pending.map(locate), surface: record.interrupt.surface } : null,
    completion: record.completion ? { ok: record.completion.ok, surface: record.completion.surface, cleanupFirst: refusal(record.completion.cleanupFirst) } : null,
    runner: runnerOutcome(text) }
}
module.exports = { createObserver, capture, decode, runnerOutcome, publicEvidence, LIMIT }
