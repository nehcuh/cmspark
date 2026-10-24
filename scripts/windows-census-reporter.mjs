// #650: observation only. Original events reach Node's builtin TAP unchanged.
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { tap } from 'node:test/reporters'
import { types as utilTypes } from 'node:util'

const types = new Set(['test:enqueue', 'test:dequeue', 'test:start', 'test:complete', 'test:pass', 'test:fail', 'test:plan', 'test:diagnostic', 'test:stdout', 'test:stderr', 'test:summary', 'test:coverage', 'test:watch:drained'])
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const digest = value => typeof value === 'string' ? createHash('sha256').update(value).digest('hex') : null
export function relativeFile(root, file) {
  if (typeof file !== 'string') return null
  const relative = path.relative(root, file)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
    ? relative.split(path.sep).join('/') : null
}
function observedFile(root, file) {
  if (typeof file !== 'string') return null
  // The reporter root uses native realpath. Resolve observed paths with the
  // same API: Windows short names and filesystem aliases are not new files.
  try { return relativeFile(root, fsSync.realpathSync.native(file)) }
  catch { return null }
}
// TestsStream preserves the real rejected child-process error as a cause.
// Inspect only own data properties: no command, output, message or getter leaves
// this projection, and a cycle or unbounded wrapper chain cannot grow receipts.
const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get
function childFailureChain(error) {
  const chain = [], seen = new Set()
  const own = (value, key) => {
    try { const d = Object.getOwnPropertyDescriptor(value, key); return d && 'value' in d ? d.value : undefined }
    catch { return undefined }
  }
  for (let current = error, depth = 0; current && typeof current === 'object' && !utilTypes.isProxy(current) && depth < 4 && !seen.has(current); depth++) {
    seen.add(current)
    const row = { depth }
    for (const key of ['code', 'exitCode', 'status', 'errno']) {
      const value = own(current, key)
      if (Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647) row[key] = value
    }
    const killed = own(current, 'killed'), signal = own(current, 'signal')
    if (typeof killed === 'boolean') row.killed = killed
    if (['SIGKILL', 'SIGTERM', 'SIGABRT', 'SIGSEGV'].includes(signal)) row.signal = signal
    for (const key of ['stdout', 'stderr']) {
      const value = own(current, key)
      if (typeof value === 'string') {
        if (value.length <= 16 * 1024 * 1024) row[key + '_bytes'] = Buffer.byteLength(value)
        else row[key + '_exceeds_projection_bound'] = true
      } else if (utilTypes.isUint8Array(value)) {
        // Brand-check raw byte views without Proxy traps, then read only
        // the typed-array internal slot (Buffer or Uint8Array).
        try { row[key + '_bytes'] = typedArrayByteLength.call(value) } catch { /* unavailable byte count */ }
      }
    }
    if (Object.keys(row).length > 1) chain.push(row)
    current = own(current, 'cause')
  }
  return chain
}
// Public diagnostic admission is exact-source/marker/schema only. No message,
// arbitrary path, raw byte or error object is copied into the finite receipt.
export const terminalDiagnosticFile = '.test-dist/tests/desktop-native-thread-metadata-476.test.js'
const terminalMarker = 'D476_TERMINAL_NATIVE_PHASE '
const terminalBooleans = ['inputEnterObserved', 'rawOutputMarkerSeen', 'failed', 'inputUnicode', 'outputUnicode', 'actualProcessExit', 'authenticated', 'windowRequested', 'childExited']
const terminalCounters = ['actualSpawns', 'openAttempts', 'confirmationRequests', 'decisions', 'deniedResults', 'outputBytes', 'largestFrame', 'outputFrames', 'acks', 'dimensions', 'stops', 'connections']
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
const unsigned = value => Number.isSafeInteger(value) && value >= 0
function terminalSnapshot(value) {
  const keys = ['schema', 'moment', 'firstFailure', 'readiness', 'receiptMask', ...terminalBooleans, ...terminalCounters]
  if (!exactKeys(value, keys) || value.schema !== 1 || !['ABORT', 'FINALLY'].includes(value.moment)) return null
  const first = value.firstFailure, ready = value.readiness
  if (!exactKeys(first, ['schema', 'source', 'first']) || first.schema !== 1 || first.source !== 'ffe3514318883fc863bf2347093f328354ee841b') return null
  if (first.first !== null && (!exactKeys(first.first, ['origin', 'site']) || !['W', 'R'].includes(first.first.origin) || !Number.isSafeInteger(first.first.site) || first.first.site < 1 || first.first.site > (first.first.origin === 'W' ? 28 : 19))) return null
  if (!exactKeys(ready, ['schema', 'seenMask']) || ready.schema !== 1 || !unsigned(ready.seenMask) || ready.seenMask > 4095 || !unsigned(value.receiptMask) || value.receiptMask > 255) return null
  if (terminalBooleans.some(key => typeof value[key] !== 'boolean') || terminalCounters.some(key => !unsigned(value[key]))) return null
  // Match the actual producer order too. Duplicate JSON keys or noncanonical
  // encodings cannot be accepted through JSON.parse's last-key-wins behavior.
  return { schema: 1, moment: value.moment,
    firstFailure: { schema: 1, source: 'ffe3514318883fc863bf2347093f328354ee841b', first: first.first === null ? null : { origin: first.first.origin, site: first.first.site } },
    readiness: { schema: 1, seenMask: ready.seenMask }, inputEnterObserved: value.inputEnterObserved, rawOutputMarkerSeen: value.rawOutputMarkerSeen,
    failed: value.failed, receiptMask: value.receiptMask, actualSpawns: value.actualSpawns, openAttempts: value.openAttempts, confirmationRequests: value.confirmationRequests,
    decisions: value.decisions, deniedResults: value.deniedResults, outputBytes: value.outputBytes, largestFrame: value.largestFrame, outputFrames: value.outputFrames,
    acks: value.acks, dimensions: value.dimensions, inputUnicode: value.inputUnicode, outputUnicode: value.outputUnicode, stops: value.stops,
    actualProcessExit: value.actualProcessExit, authenticated: value.authenticated, windowRequested: value.windowRequested, connections: value.connections, childExited: value.childExited }
}
export function terminalDiagnostic(message) {
  if (typeof message !== 'string' || !message.startsWith(terminalMarker)) return null
  if (message.length > 4096 || Buffer.byteLength(message, 'utf8') > 4096) return { status: 'UNKNOWN', reason: 'OVERSIZE' }
  try {
    const payload = message.slice(terminalMarker.length), snapshot = terminalSnapshot(JSON.parse(payload))
    if (!snapshot || JSON.stringify(snapshot) !== payload) return { status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT' }
    return { status: 'OBSERVED', snapshot }
  } catch { return { status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT' } }
}
export function publicTerminalDiagnostic(value) {
  if (exactKeys(value, ['status', 'reason']) && value.status === 'UNKNOWN' && ['OVERSIZE', 'INVALID_SNAPSHOT'].includes(value.reason)) return { status: 'UNKNOWN', reason: value.reason }
  if (!exactKeys(value, ['status', 'snapshot']) || value.status !== 'OBSERVED') throw Error('CENSUS_METADATA_INVALID')
  const snapshot = terminalSnapshot(value.snapshot)
  if (!snapshot || JSON.stringify(snapshot) !== JSON.stringify(value.snapshot)) throw Error('CENSUS_METADATA_INVALID')
  return { status: 'OBSERVED', snapshot }
}
export function publicFailureMetadata(event) {
  if (event.failure_type === undefined) {
    if (['error_code', 'exit_code', 'signal', 'child_failure_chain'].some(key => event[key] !== undefined)) throw Error('CENSUS_METADATA_INVALID')
    return { status: 'UNAVAILABLE' }
  }
  const failures = ['testCodeFailure', 'subtestsFailed', 'testTimeoutFailure', 'cancelledByParent', 'hookFailed', 'testAbortedFailure', 'testCreationFailure', 'asyncActivity', 'testFailed', 'UNCLASSIFIED']
  const signals = ['SIGKILL', 'SIGTERM', 'SIGABRT', 'SIGSEGV']
  if (!failures.includes(event.failure_type) || !['ERR_TEST_FAILURE', 'ERR_ASSERTION', 'UNCLASSIFIED'].includes(event.error_code) || !(event.exit_code === null || typeof event.exit_code === 'number' && Number.isFinite(event.exit_code) && event.exit_code >= 0) || !(event.signal === null || signals.includes(event.signal))) throw Error('CENSUS_METADATA_INVALID')
  const result = { status: 'OBSERVED', failure_type: event.failure_type, error_code: event.error_code, exit_code: event.exit_code, signal: event.signal }
  if (event.child_failure_chain !== undefined) {
    const rows = event.child_failure_chain
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 4) throw Error('CENSUS_METADATA_INVALID')
    let prior = -1
    result.child_failure_chain = rows.map(row => {
      const keys = ['depth', 'code', 'exitCode', 'status', 'errno', 'killed', 'signal', 'stdout_bytes', 'stderr_bytes', 'stdout_exceeds_projection_bound', 'stderr_exceeds_projection_bound']
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !keys.includes(key)) || !Number.isSafeInteger(row.depth) || row.depth <= prior || row.depth > 3 || Object.keys(row).length < 2) throw Error('CENSUS_METADATA_INVALID')
      prior = row.depth
      const copy = { depth: row.depth }
      for (const key of ['code', 'exitCode', 'status', 'errno']) if (Object.hasOwn(row, key)) {
        if (!Number.isSafeInteger(row[key]) || row[key] < -2147483648 || row[key] > 2147483647) throw Error('CENSUS_METADATA_INVALID')
        copy[key] = row[key]
      }
      if (Object.hasOwn(row, 'killed')) { if (typeof row.killed !== 'boolean') throw Error('CENSUS_METADATA_INVALID'); copy.killed = row.killed }
      if (Object.hasOwn(row, 'signal')) { if (!signals.includes(row.signal)) throw Error('CENSUS_METADATA_INVALID'); copy.signal = row.signal }
      for (const key of ['stdout', 'stderr']) {
        if (Object.hasOwn(row, key + '_bytes')) { if (!unsigned(row[key + '_bytes'])) throw Error('CENSUS_METADATA_INVALID'); copy[key + '_bytes'] = row[key + '_bytes'] }
        if (Object.hasOwn(row, key + '_exceeds_projection_bound')) { if (row[key + '_exceeds_projection_bound'] !== true || Object.hasOwn(row, key + '_bytes')) throw Error('CENSUS_METADATA_INVALID'); copy[key + '_exceeds_projection_bound'] = true }
      }
      return copy
    })
  }
  return result
}

export function project(event, seq, root) {
  if (!types.has(event.type)) throw Error('CENSUS_UNKNOWN_EVENT')
  const d = event.data ?? {}
  const file = observedFile(root, d.file)
  const record = {
    kind: 'event', seq, type: event.type, file,
    outside_source: typeof d.file === 'string' && file === null,
    name_hash: digest(d.name), line: numeric(d.line), column: numeric(d.column),
    nesting: numeric(d.nesting), testNumber: numeric(d.testNumber), count: numeric(d.count),
    duration_ms: numeric(d.details?.duration_ms ?? d.duration_ms), suite: d.details?.type === 'suite',
    skip: d.skip !== undefined && d.skip !== false, todo: d.todo !== undefined && d.todo !== false,
    skip_reason_hash: digest(d.skip), todo_reason_hash: digest(d.todo),
  }
  if (typeof d.success === 'boolean') record.success = d.success
  if (d.counts) record.counts = Object.fromEntries(['cancelled', 'failed', 'passed', 'skipped', 'suites', 'tests', 'todo', 'topLevel'].map(k => [k, numeric(d.counts[k])]))
  if (event.type === 'test:diagnostic' && file === terminalDiagnosticFile) {
    const finite = terminalDiagnostic(d.message)
    if (finite) record.terminal_phase = finite
  }
  const e = d.details?.error
  if (e) {
    record.failure_type = ['testCodeFailure', 'subtestsFailed', 'testTimeoutFailure', 'cancelledByParent', 'hookFailed', 'testAbortedFailure', 'testCreationFailure', 'asyncActivity', 'testFailed'].includes(e.failureType) ? e.failureType : 'UNCLASSIFIED'
    record.error_code = ['ERR_TEST_FAILURE', 'ERR_ASSERTION'].includes(e.code) ? e.code : 'UNCLASSIFIED'
    record.exit_code = numeric(e.exitCode)
    record.signal = ['SIGKILL', 'SIGTERM', 'SIGABRT', 'SIGSEGV'].includes(e.signal) ? e.signal : null
    const child = childFailureChain(e)
    if (child.length) record.child_failure_chain = child
  }
  return record
}

export default async function* reporter(source) {
  const root = await fs.realpath(process.cwd())
  const dir = process.env.CMSPARK_CENSUS_DIR
  if (!dir || !path.isAbsolute(dir)) throw Error('CENSUS_RECEIPT_DIR_REQUIRED')
  const id = randomUUID()
  const handle = await fs.open(path.join(dir, `events-${process.pid}-${id}.jsonl`), 'wx', 0o600)
  let seq = 0
  const write = record => handle.writeFile(JSON.stringify(record) + '\n')
  try {
    await write({ kind: 'begin', id, pid: process.pid, ppid: process.ppid, node: process.version,
      test_argv: process.argv.slice(1).map(file => observedFile(root, file)),
      outside_argv: process.argv.slice(1).some(file => observedFile(root, file) === null),
      isolation_none: process.execArgv.includes('--experimental-test-isolation=none') })
    async function* observed() {
      for await (const event of source) {
        await write(project(event, seq++, root))
        yield event
      }
      await write({ kind: 'end', events: seq })
    }
    yield* tap(observed())
  } finally {
    await handle.close()
  }
}
