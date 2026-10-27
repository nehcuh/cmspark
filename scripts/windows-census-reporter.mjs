import {joinDiagnostic788} from './tests/native-join-observation-788.mjs'
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
const unsigned = value => Number.isSafeInteger(value) && value >= 0
// Copy only the finite first-party observation vocabulary; never forward an
// arbitrary value from a diagnostic into the public census.
function nativeObservationSnapshot788(value) {
  const data = confirmationData(value, ['schema', 'local', 'archive', 'terminal'], true)
  if (!data || data.schema !== 1) return null
  const relations = ['NULL', 'OWNED_MAIN', 'OWNED_CONFIRMATION', 'SAME_PROCESS_OTHER', 'OTHER_PROCESS', 'UNKNOWN']
  const foreground = value => {
    if (value === null) return null
    const row = confirmationData(value, ['activationReturned', 'focusSucceeded', 'relation'], true)
    if (!row || typeof row.activationReturned !== 'boolean' || typeof row.focusSucceeded !== 'boolean' ||
      !(row.focusSucceeded ? relations.includes(row.relation) : row.relation === 'NOT_READ')) return undefined
    return { activationReturned: row.activationReturned, focusSucceeded: row.focusSucceeded, relation: row.relation }
  }
  const local = foreground(data.local), archive = foreground(data.archive)
  const terminal = confirmationData(data.terminal, ['seenMask', 'firstSkip'], true)
  if (local === undefined || archive === undefined || !terminal || !unsigned(terminal.seenMask) || terminal.seenMask > 1023 ||
    !(terminal.firstSkip === null || terminal.firstSkip === 'NOT_VISIBLE' || relations.includes(terminal.firstSkip))) return null
  return { schema: 1, local, archive, terminal: { seenMask: terminal.seenMask, firstSkip: terminal.firstSkip } }
}
function terminalSnapshot(value) {
  const keys = ['schema', 'moment', 'firstFailure', 'readiness', 'inputEnterObserved', 'rawOutputMarkerSeen', 'failed', 'receiptMask', 'actualSpawns', 'openAttempts', 'confirmationRequests', 'decisions', 'deniedResults', 'outputBytes', 'largestFrame', 'outputFrames', 'acks', 'dimensions', 'inputUnicode', 'outputUnicode', 'stops', 'actualProcessExit', 'authenticated', 'windowRequested', 'connections', 'childExited']
  const extendedKeys = [...keys.slice(0, 4), 'observation788', ...keys.slice(4)]
  const extended = confirmationData(value, extendedKeys, true)
  value = extended || confirmationData(value, keys, true)
  if (!value || value.schema !== 1 || !['ABORT', 'FINALLY'].includes(value.moment)) return null
  const observation788 = extended ? nativeObservationSnapshot788(value.observation788) : null
  if (extended && !observation788) return null
  const first = confirmationData(value.firstFailure, ['schema', 'source', 'first'], true), ready = confirmationData(value.readiness, ['schema', 'seenMask'], true)
  if (!first || first.schema !== 1 || first.source !== 'ffe3514318883fc863bf2347093f328354ee841b') return null
  const firstEntry = first.first === null ? null : confirmationData(first.first, ['origin', 'site'], true)
  if (first.first !== null && (!firstEntry || !['W', 'R'].includes(firstEntry.origin) || !Number.isSafeInteger(firstEntry.site) || firstEntry.site < 1 || firstEntry.site > (firstEntry.origin === 'W' ? 28 : 19))) return null
  if (!ready || ready.schema !== 1 || !unsigned(ready.seenMask) || ready.seenMask > 4095 || !unsigned(value.receiptMask) || value.receiptMask > 255) return null
  if (terminalBooleans.some(key => typeof value[key] !== 'boolean') || terminalCounters.some(key => !unsigned(value[key]))) return null
  // Match the actual producer order too. Duplicate JSON keys or noncanonical
  // encodings cannot be accepted through JSON.parse's last-key-wins behavior.
  return { schema: 1, moment: value.moment,
    firstFailure: { schema: 1, source: 'ffe3514318883fc863bf2347093f328354ee841b', first: firstEntry === null ? null : { origin: firstEntry.origin, site: firstEntry.site } },
    readiness: { schema: 1, seenMask: ready.seenMask }, ...(extended ? { observation788 } : {}), inputEnterObserved: value.inputEnterObserved, rawOutputMarkerSeen: value.rawOutputMarkerSeen,
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
  const unknown = confirmationData(value, ['status', 'reason'], true)
  if (unknown && unknown.status === 'UNKNOWN' && ['OVERSIZE', 'INVALID_SNAPSHOT'].includes(unknown.reason)) return { status: 'UNKNOWN', reason: unknown.reason }
  const observed = confirmationData(value, ['status', 'snapshot'], true)
  if (!observed || observed.status !== 'OBSERVED') throw Error('CENSUS_METADATA_INVALID')
  const snapshot = terminalSnapshot(observed.snapshot)
  if (!snapshot || Buffer.byteLength(terminalMarker + JSON.stringify(snapshot), 'utf8') > 4096) throw Error('CENSUS_METADATA_INVALID')
  return { status: 'OBSERVED', snapshot }
}
// Independent passive confirmation observations. Only these two actual public
// registration-name hashes may receive this field; locations still bind the
// diagnostic to one failure in its original canonical TestsStream document.
const confirmationRoles = new Map([
  ['1c1ad79cba22b289046bad930054f0e6a6dd5e22c15d9c72d497730d62b8657b', 'LOCAL'],
  ['8bae2561b67e9ced4b87fd83f1ffad8d4c9bf39e6f610dba6ab9d15440e7288d', 'TERMINAL'],
])
export function confirmationRoleForNameHash(nameHash) { return confirmationRoles.get(nameHash) ?? null }
const confirmationMarker = 'D476_NATIVE_CONFIRMATION_PHASE '
// Read own data only. In particular, neither Proxy traps, accessors, inherited
// toJSON methods nor overridden array methods run at the public object boundary.
function confirmationData(value, keys, requireEnumerable = false) {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)) return null
  try {
    const own = Reflect.ownKeys(value)
    if (own.length !== keys.length || own.some((key, index) => key !== keys[index])) return null
    const result = {}
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(value, key)
      if (!property || !Object.hasOwn(property, 'value') || (requireEnumerable && !property.enumerable)) return null
      result[key] = property.value
    }
    return result
  } catch { return null }
}
function confirmationArray(value, maximum) {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || !Array.isArray(value)) return null
  try {
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null
    const keys = Reflect.ownKeys(value)
    if (keys.length !== length + 1 || keys[length] !== 'length') return null
    const result = []
    for (let index = 0; index < length; index++) {
      if (keys[index] !== String(index)) return null
      const property = Object.getOwnPropertyDescriptor(value, String(index))
      if (!property || !Object.hasOwn(property, 'value')) return null
      result.push(property.value)
    }
    return result
  } catch { return null }
}
function confirmationRows(value, maxPoint, maximum, withValue = false) {
  const rows = confirmationArray(value, maximum)
  if (!rows) return null
  const seen = new Set(), result = []
  for (const row of rows) {
    const tuple = confirmationArray(row, withValue ? 4 : 3)
    if (!tuple || tuple.length !== (withValue ? 4 : 3)) return null
    const [point, ordinal, bucket] = tuple
    if (!Number.isSafeInteger(point) || point < 1 || point > maxPoint || !Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 8 || !Number.isSafeInteger(bucket) || bucket < 0 || bucket > 240) return null
    if (withValue && typeof tuple[3] !== 'boolean') return null
    const pair = `${point}:${ordinal}`
    if (seen.has(pair)) return null
    seen.add(pair)
    // Preserve actual observation order. Each domain owns its own clock;
    // neither site order nor a server/native time difference is inferred.
    result.push(withValue ? [point, ordinal, bucket, tuple[3]] : [point, ordinal, bucket])
  }
  return result
}
function confirmationSnapshot(value) {
  const data = confirmationData(value, ['schema', 'role', 'moment', 'server', 'native', 'malformed'])
  if (!data || data.schema !== 1 || !['LOCAL', 'TERMINAL'].includes(data.role) || !['ABORT', 'FINALLY'].includes(data.moment) || typeof data.malformed !== 'boolean') return null
  const server = confirmationRows(data.server, 5, 40), native = confirmationRows(data.native, 128, 1024, true)
  if (!server || !native) return null
  return { schema: 1, role: data.role, moment: data.moment, server, native, malformed: data.malformed }
}
export function confirmationDiagnostic(message) {
  if (typeof message !== 'string' || !message.startsWith(confirmationMarker)) return null
  if (message.length > 32768 || Buffer.byteLength(message, 'utf8') > 32768) return { status: 'UNKNOWN', reason: 'OVERSIZE' }
  try {
    const payload = message.slice(confirmationMarker.length), snapshot = confirmationSnapshot(JSON.parse(payload))
    if (!snapshot || JSON.stringify(snapshot) !== payload) return { status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT' }
    return { status: 'OBSERVED', snapshot }
  } catch { return { status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT' } }
}
export function publicConfirmationDiagnostic(value) {
  const unknown = confirmationData(value, ['status', 'reason'])
  if (unknown && unknown.status === 'UNKNOWN' && ['OVERSIZE', 'INVALID_SNAPSHOT'].includes(unknown.reason)) return { status: 'UNKNOWN', reason: unknown.reason }
  const observed = confirmationData(value, ['status', 'snapshot'])
  if (!observed || observed.status !== 'OBSERVED') throw Error('CENSUS_METADATA_INVALID')
  const snapshot = confirmationSnapshot(observed.snapshot)
  // Never serialize the incoming object: even an inherited toJSON method is
  // outside this finite contract. Only the fresh primitive copy is serialized.
  if (!snapshot || Buffer.byteLength(confirmationMarker + JSON.stringify(snapshot), 'utf8') > 32768) throw Error('CENSUS_METADATA_INVALID')
  return { status: 'OBSERVED', snapshot }
}
const localMarker = 'D476_LOCAL_NATIVE_PHASE '
const localBooleanKeys = ['failed', 'inputUnicode', 'authenticated', 'windowRequested', 'childExited']
const localCounterKeys = ['protocolStarts', 'saved', 'resizeCalls', 'terminalStops', 'connections']
const localProgressKeys = ['agentRequests', 'agentResults', 'agentAccepted', 'agentConfirmations', 'agentDecisions', 'agentApprovals', 'runtimeStarts', 'protocolAttempts', 'protocolHandles']
function localSnapshot(value) {
  const keys = ['schema', 'failed', 'receiptMask', 'protocolStarts', 'saved', 'inputUnicode', 'resizeCalls', 'terminalStops', 'authenticated', 'windowRequested', 'connections', 'childExited', 'localFirstSite', 'localFocusResult', 'localActivation', 'localData', 'localProgress']
  const extended = confirmationData(value, [...keys, 'observation788'])
  const data = extended || confirmationData(value, keys)
  if (!data || data.schema !== 1 || !unsigned(data.receiptMask) || data.receiptMask > 255 || localBooleanKeys.some(key => typeof data[key] !== 'boolean') || localCounterKeys.some(key => !unsigned(data[key]))) return null
  const observation788 = extended ? nativeObservationSnapshot788(data.observation788) : null
  if (extended && !observation788) return null
  const first = confirmationData(data.localFirstSite, ['R', 'W', 'M'])
  if (!first || [['R', 17], ['W', 13], ['M', 8]].some(([key, maximum]) => first[key] !== null && (!Number.isSafeInteger(first[key]) || first[key] < 1 || first[key] > maximum))) return null
  if (data.localFocusResult !== null && !['MOVE_FOCUS_FAILED', 'FOREGROUND_MISMATCH'].includes(data.localFocusResult)) return null
  let activation = null
  if (data.localActivation !== null) {
    activation = confirmationData(data.localActivation, ['requested', 'foreground'])
    if (!activation || typeof activation.requested !== 'boolean' || !['NOT_READ', 'NULL', 'OWNED', 'OTHER'].includes(activation.foreground)) return null
  }
  const bytes = confirmationData(data.localData, ['rendererFirstData', 'terminalDataFrames', 'terminalDataBytes', 'terminalDataIncomplete'])
  if (!bytes || typeof bytes.rendererFirstData !== 'boolean' || typeof bytes.terminalDataIncomplete !== 'boolean' || !unsigned(bytes.terminalDataFrames) || bytes.terminalDataFrames > 65535 || !unsigned(bytes.terminalDataBytes) || bytes.terminalDataBytes > 16777216) return null
  const progress = confirmationData(data.localProgress, localProgressKeys)
  if (!progress || localProgressKeys.some(key => !unsigned(progress[key]) || progress[key] > 65535)) return null
  return { schema: 1, failed: data.failed, receiptMask: data.receiptMask, protocolStarts: data.protocolStarts, saved: data.saved, inputUnicode: data.inputUnicode, resizeCalls: data.resizeCalls, terminalStops: data.terminalStops,
    authenticated: data.authenticated, windowRequested: data.windowRequested, connections: data.connections, childExited: data.childExited,
    localFirstSite: first, localFocusResult: data.localFocusResult, localActivation: activation, localData: bytes, localProgress: progress, ...(extended ? { observation788 } : {}) }
}
export function localDiagnostic(message) {
  if (typeof message !== 'string' || !message.startsWith(localMarker)) return null
  if (message.length > 4096 || Buffer.byteLength(message, 'utf8') > 4096) return { status: 'UNKNOWN', reason: 'OVERSIZE' }
  try {
    const payload = message.slice(localMarker.length), snapshot = localSnapshot(JSON.parse(payload))
    if (!snapshot || JSON.stringify(snapshot) !== payload) return { status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT' }
    return { status: 'OBSERVED', snapshot }
  } catch { return { status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT' } }
}
export function publicLocalDiagnostic(value) {
  const unknown = confirmationData(value, ['status', 'reason'])
  if (unknown && unknown.status === 'UNKNOWN' && ['OVERSIZE', 'INVALID_SNAPSHOT'].includes(unknown.reason)) return { status: 'UNKNOWN', reason: unknown.reason }
  const observed = confirmationData(value, ['status', 'snapshot'])
  if (!observed || observed.status !== 'OBSERVED') throw Error('CENSUS_METADATA_INVALID')
  const snapshot = localSnapshot(observed.snapshot)
  if (!snapshot || Buffer.byteLength(localMarker + JSON.stringify(snapshot), 'utf8') > 4096) throw Error('CENSUS_METADATA_INVALID')
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
    const join788 = joinDiagnostic788(d.message)
    if (join788) record.native_join788 = join788
    const finite = terminalDiagnostic(d.message)
    if (finite) record.terminal_phase = finite
    const confirmation = confirmationDiagnostic(d.message)
    if (confirmation) record.confirmation_phase = confirmation
    const local = localDiagnostic(d.message)
    if (local) record.local_phase = local
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
