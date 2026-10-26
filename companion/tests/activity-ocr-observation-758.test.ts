/** Actual OCR source/runner contracts; controlled FS and CPU-only child. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { types, promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { childFailureChain, observedOcrSource758, observedOcrCall758, ocrTrace758, ocrSites758 } from './helpers/activity-ocr-observation-758'

const original = fs.readFileSync(path.resolve('src/host-use/win/scripts/computer-ocr.ps1'), 'utf8')
const owned = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr758-observation-'))
  const script = path.join(dir, 'original.ps1')
  fs.writeFileSync(script, original)
  return { dir, script, close: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('758 OCR observation preserves the entire real BOM source under LF and CRLF', () => {
  for (const source of [original.replace(/\r\n/g, '\n'), original.replace(/\r?\n/g, '\r\n')]) {
    const result = observedOcrSource758(source, "C:\\owned dir\\a'b.txt")
    assert.equal(result.inverse, source)
    assert.ok(Buffer.from(result.inverse).equals(Buffer.from(source)))
    assert.equal(result.source.charCodeAt(0), 0xfeff)
    assert.ok(result.source.includes("'C:\\owned dir\\a''b.txt'"))
    assert.ok(result.source.includes('TraceOcr758 28'))
    assert.equal(ocrSites758.length, 29)
    assert.doesNotMatch(result.source, /Start-Sleep|Get-Command|Start-Process|Set-ExecutionPolicy/)
  }
})
test('758 OCR observation refuses missing or ambiguous source anchors and unsafe trace operands', () => {
  assert.throws(() => observedOcrSource758(original.replace('  $task.Wait()', '  $task.Wrong()'), 'owned'), /ANCHOR_REFUSED/)
  assert.throws(() => observedOcrSource758(original + '\n  $task.Wait()\n', 'owned'), /ANCHOR_REFUSED/)
  assert.throws(() => observedOcrSource758(original + '\n# TraceOcr758', 'owned'), /SOURCE_REFUSED/)
  for (const trace of ['', 'a\nb', 'a\rb', 'a\0b']) assert.throws(() => observedOcrSource758(original, trace), /SOURCE_REFUSED/)
})
test('758 OCR child failure projection matches the actual census function and never reads getters or proxies', () => {
  const reporter = fs.readFileSync(path.resolve('../scripts/windows-census-reporter.mjs'), 'utf8')
  const a = reporter.indexOf('const typedArrayByteLength'), z = reporter.indexOf('// Public diagnostic', a)
  assert.ok(a > 0 && z > a)
  const context: any = { utilTypes: types, Buffer }
  vm.runInNewContext(reporter.slice(a, z) + '\nglobalThis.actual=childFailureChain;', context)
  let effects = 0
  const getter: any = {}
  for (const key of ['code', 'killed', 'signal', 'stdout', 'stderr', 'cause']) Object.defineProperty(getter, key, { get() { effects++; throw Error('PRIVATE_GETTER') } })
  const proxy = new Proxy({}, { get() { effects++; throw Error('PRIVATE_PROXY') }, getPrototypeOf() { effects++; throw Error('PRIVATE_PROXY') } })
  const revocable = Proxy.revocable({}, {}); revocable.revoke()
  const bytes = Buffer.from('owned'); Object.defineProperty(bytes, 'length', { get() { effects++; throw Error('PRIVATE_LENGTH') } })
  const wrapped: any = { cause: { code: 42, killed: true, signal: 'SIGTERM', stdout: bytes, stderr: 'PRIVATE_TEXT' } }
  const cycle: any = { status: -1 }; cycle.cause = cycle
  for (const input of [null, getter, proxy, revocable.proxy, wrapped, cycle, { code: 'PRIVATE_CODE', signal: 'PRIVATE_SIGNAL', privateName: 'PRIVATE_VALUE' }]) {
    const observed = childFailureChain(input)
    assert.equal(JSON.stringify(observed), JSON.stringify(context.actual(input)))
    assert.doesNotMatch(JSON.stringify(observed), /PRIVATE_/)
  }
  assert.equal(effects, 0)
  assert.equal(childFailureChain(wrapped)[0].stdout_bytes, 5)
})
test('758 OCR phase parser accepts only fixed source sites and process-local ordered buckets', () => {
  assert.deepEqual(ocrTrace758(Buffer.from('1,0,0,0\n7,1,2,0\n29,1,3,-2147467259\n')), { status: 'OBSERVED', rows: [
    { site: 1, wait: 0, bucket: 0 }, { site: 7, wait: 1, bucket: 2 }, { site: 29, wait: 1, bucket: 3, hresult: -2147467259 },
  ] })
})
test('758 OCR malformed missing truncated or oversized phases remain UNKNOWN', () => {
  for (const text of ['', '1,0,0,0', '2,0,0,0\n', '1,0,0,1\n', '1,0,361,0\n', '1,17,0,0\n', '1,0,0,0\n30,0,1,0\n',
    '1,0,2,0\n2,0,1,0\n', '1,0,0,0\n29,1,1,2147483648\n', '1,0,0,0\nPRIVATE_MESSAGE\n', '1,0,0,0\n' + '2,0,0,0\n'.repeat(96), 'x'.repeat(4097)]) {
    assert.equal(ocrTrace758(Buffer.from(text)).status, 'UNKNOWN')
  }
  assert.equal(ocrTrace758(Buffer.from([0xff, 10])).status, 'UNKNOWN')
})
test('758 OCR projector observes a real owned Node CPU child exit without a PowerShell or desktop claim', { timeout: 5000 }, async () => {
  let caught: unknown
  try { await promisify(execFile)(process.execPath, ['-e', 'process.exit(42)'], { encoding: 'utf8', timeout: 3000, maxBuffer: 4096 }) }
  catch (error) { caught = error }
  assert.ok(caught)
  assert.deepEqual(childFailureChain(caught), [{ depth: 0, code: 42, killed: false, stdout_bytes: 0, stderr_bytes: 0 }])
})
test('758 OCR actual observation wrapper makes one call and preserves original stdout argv and source bytes', async () => {
  const a = owned(), args = ['-ImagePath', 'PRIVATE_OWNED_IMAGE', '-Language', 'en-US'], reports: string[] = []
  let calls = 0
  try {
    const result = await observedOcrCall758(a.script, args, a.dir, async (script, actual, options) => {
      calls++; assert.equal(actual, args); assert.equal(options, undefined)
      assert.equal(script, path.join(a.dir, 'ocr-observed-758.ps1'))
      assert.equal(fs.readFileSync(script, 'utf8'), observedOcrSource758(original, path.join(a.dir, 'ocr-phases-758.txt')).source)
      fs.writeFileSync(path.join(a.dir, 'ocr-phases-758.txt'), '1,0,0,0\n28,5,1,0\n')
      return '{"ok":true,"words":[]}'
    }, line => reports.push(line))
    assert.equal(result, '{"ok":true,"words":[]}'); assert.equal(calls, 1)
    assert.equal(fs.readFileSync(a.script, 'utf8'), original)
    assert.equal(reports.length, 1); assert.doesNotMatch(reports[0], /PRIVATE_|original\.ps1|ocr758-observation-/)
    const dto = JSON.parse(reports[0].slice('D758_OCR_OBSERVATION '.length))
    assert.equal(dto.sourceUnchanged, true); assert.equal(dto.rejected, false)
    assert.equal(dto.stdoutBytes, Buffer.byteLength(result)); assert.equal(dto.successStderr, 'UNKNOWN')
    assert.equal(dto.phases.status, 'OBSERVED')
  } finally { a.close() }
})
test('758 OCR observation preserves the identical original failure even when diagnostic delivery throws', async () => {
  const a = owned(), failure = Object.assign(Error('PRIVATE_ERROR'), { code: 5, killed: false, stdout: '', stderr: 'PRIVATE_ERROR_BODY' })
  let calls = 0, reports = 0
  try {
    await assert.rejects(observedOcrCall758(a.script, [], a.dir, async () => { calls++; throw failure }, line => {
      reports++; assert.doesNotMatch(line, /PRIVATE_|original\.ps1|ocr758-observation-/)
      const dto = JSON.parse(line.slice('D758_OCR_OBSERVATION '.length)); assert.equal(dto.rejected, true)
      assert.equal(dto.phases.status, 'UNKNOWN'); assert.deepEqual(dto.child, childFailureChain(failure))
      throw Error('OWNED_DIAGNOSTIC_FAILURE')
    }), error => error === failure)
    assert.equal(calls, 1); assert.equal(reports, 1)
  } finally { a.close() }
})
test('758 OCR observer filesystem and delivery failures cannot alter original success', async () => {
  const a = owned()
  try {
    assert.equal(await observedOcrCall758(a.script, [], a.dir, async () => { fs.unlinkSync(a.script); return 'ORIGINAL_STDOUT' }, () => { throw Error('NOT_PRIMARY') }), 'ORIGINAL_STDOUT')
  } finally { a.close() }
})
