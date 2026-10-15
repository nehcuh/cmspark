// #650: observation only. Original events reach Node's builtin TAP unchanged.
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { tap } from 'node:test/reporters'

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
  const e = d.details?.error
  if (e) {
    record.failure_type = ['testCodeFailure', 'subtestsFailed', 'testTimeoutFailure', 'cancelledByParent', 'hookFailed', 'testAbortedFailure', 'testCreationFailure', 'asyncActivity', 'testFailed'].includes(e.failureType) ? e.failureType : 'UNCLASSIFIED'
    record.error_code = ['ERR_TEST_FAILURE', 'ERR_ASSERTION'].includes(e.code) ? e.code : 'UNCLASSIFIED'
    record.exit_code = numeric(e.exitCode)
    record.signal = ['SIGKILL', 'SIGTERM', 'SIGABRT', 'SIGSEGV'].includes(e.signal) ? e.signal : null
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
