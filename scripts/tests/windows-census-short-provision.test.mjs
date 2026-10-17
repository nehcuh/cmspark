import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const yaml = createRequire(new URL('../../companion/package.json', import.meta.url))('js-yaml')
const workflow = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
const run = yaml.load(workflow).jobs['smoke-os'].steps.find(s => s.id === 'windows-census').run
function method() {
  const from = run.indexOf('  public static int PrepareShortName(string source, string dev, string ino) {')
  assert.ok(from > 0, 'owned fixture must establish its required short-name precondition')
  const to = run.indexOf('\n  private static int AliasResult(', from)
  assert.ok(to > from)
  return run.slice(from, to)
}
function actualProjection() {
  // Actual whole fixed C# method, only native ABI and C# local declarations projected.
  const source = method().replace('  public static int PrepareShortName(string source, string dev, string ino) {', 'return function(source, dev, ino) {')
    .replace('Microsoft.Win32.SafeHandles.SafeFileHandle handle =', 'const handle =').replaceAll('IntPtr.Zero', 'null')
    .replace('OwnedInfo info = new OwnedInfo();', 'const info = {};').replace('out info', 'info').replace('((ulong)info.FileIndexHigh << 32) | info.FileIndexLow', '(BigInt(info.FileIndexHigh) << 32n) | BigInt(info.FileIndexLow)').replaceAll('.ToString(System.Globalization.CultureInfo.InvariantCulture)', '.toString()').replace('ulong fileId =', 'const fileId =')
  assert.doesNotMatch(source, /\b(?:SafeFileHandle|OwnedInfo|IntPtr|out|ulong)\b/)
  return Function('CreateFile', 'GetFileInformationByHandle', 'SetFileShortName', 'Marshal', 'AliasResult', source)
}
function control(options = {}) {
  let disposed = 0, changed = 0
  const calls = [], records = [], handle = { IsInvalid: Boolean(options.invalid), Dispose() { disposed++ } }
  const api = {
    CreateFile(...args) { calls.push(['open', ...args]); return handle },
    GetFileInformationByHandle(h, info) {
      calls.push(['info', h]); Object.assign(info, { Attributes: 0x10, FileIndexHigh: 0, FileIndexLow: 42, VolumeSerialNumber: 2 }, options.info)
      return !options.infoFailure
    },
    SetFileShortName(h, name) { calls.push(['set', h, name]); if (options.setFailure) return false; changed++; return true },
    Marshal: { GetLastWin32Error: () => options.error ?? 5 },
    AliasResult(stage, error) { records.push({ stage, error }); return stage },
  }
  const actual = actualProjection()(...Object.values(api))('OWNED_NEW_CHILD', '2', '42')
  return { actual, calls, records, disposed, changed }
}
test('actual owned short-name C# has fixed least-right directory handle and no volume policy change', () => {
  const source = method()
  assert.ok(source.includes('CreateFile(source, 0x10080, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)'))
  assert.ok(source.includes('SetFileShortName(handle, "CNSUS~1")'))
  assert.ok(source.includes('finally { handle.Dispose(); }'))
  assert.doesNotMatch(run, /fsutil|SeRestore|AdjustTokenPrivileges|NtfsDisable8dot3|Set-ItemProperty|SetVolume/)
  assert.match(run, /DllImport\("kernel32\.dll", EntryPoint="SetFileShortNameW", CharSet=CharSet\.Unicode, SetLastError=true, ExactSpelling=true\)/)
})
test('actual source method establishes alias when automatic alias creation is absent', () => {
  const c = control()
  assert.equal(c.actual, 0); assert.equal(c.changed, 1); assert.equal(c.disposed, 1)
  assert.deepEqual(c.calls.map(a => a[0]), ['open', 'info', 'set'])
  assert.deepEqual(c.records, [{ stage: 0, error: 0 }])
})
test('actual source method refuses native errors/reparse/non-directory/zero identity and always closes handle', () => {
  for (const [options, stage, sets] of [
    [{ invalid: true }, 1, 0], [{ infoFailure: true }, 2, 0],
    [{ info: { Attributes: 0x410 } }, 3, 0], [{ info: { Attributes: 0 } }, 3, 0],
    [{ info: { FileIndexHigh: 0, FileIndexLow: 0 } }, 3, 0], [{ info: { FileIndexLow: 99 } }, 3, 0], [{ info: { VolumeSerialNumber: 99 } }, 3, 0], [{ setFailure: true, error: 305 }, 4, 0],
  ]) {
    const c = control(options); assert.equal(c.actual, stage); assert.equal(c.changed, sets); assert.equal(c.disposed, 1)
    assert.equal(c.records.length, 1)
    if (stage < 4) assert.equal(c.calls.some(a => a[0] === 'set'), false)
  }
})
test('workflow provision precedes unchanged real alias guards and publishes only finite native status', () => {
  method()
  const call = '$shortSetStatus = [Cmspark650OwnedPaths]::PrepareShortName($shortFixture, $shortCreated.dev, $shortCreated.ino)'
  assert.ok(run.includes(call)); assert.ok(run.indexOf(call) < run.indexOf('$longLength ='))
  assert.match(run, /if \(\$shortSetStatus -ne 0\) \{ throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' \}/)
  assert.match(run, /\[System\.IO\.Path\]::GetFileName\(\$shortBuffer\.ToString\(\)\) -ine 'CNSUS~1'/)
  assert.ok(run.includes("$shortBuffer.ToString() -notmatch '~[0-9]'"))
  assert.ok(run.includes('$shortBuffer.ToString() -eq $longBuffer.ToString()'))
  assert.ok(run.includes("if (error < 0 || error > 65535) error = 0;"))
  assert.ok(run.includes('Console.WriteLine("CENSUS_650_SHORT {{\\"stage\\":{0},\\"error\\":{1}}}", stage, error);'))
  assert.ok(run.indexOf('scripts/windows-census-owned-smb.mjs create-short $share $created.dev $created.ino') < run.indexOf(call))
})

// Original creation/snapshot discipline; no atomic mkdir+handle claim.
test('actual fixed child creation verifies original parent and never reuses occupied child', async () => {
  const h = await import('../windows-census-owned-smb.mjs')
  assert.equal(typeof h.createOwnedShortDirectory, 'function')
  const os = await import('node:os'), path = await import('node:path')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'census-alias-create-'))
  const name = 'cmspark650_123_1_0123456789abcdef0123456789abcdef'
  try {
    const parent = h.createOwnedUncDirectory(temp, name, '123', '1')
    assert.throws(() => h.createOwnedShortDirectory(temp, name, '123', '1', { ...parent, ino: (BigInt(parent.ino) + 1n).toString() }))
    assert.deepEqual(fs.readdirSync(parent.path), [])
    const child = h.createOwnedShortDirectory(temp, name, '123', '1', parent)
    assert.equal(child.path, fs.realpathSync.native(path.join(parent.path, 'canonical short alias owned')))
    const actual = fs.lstatSync(child.path, { bigint: true })
    assert.equal(child.dev, actual.dev.toString()); assert.equal(child.ino, actual.ino.toString())
    assert.throws(() => h.createOwnedShortDirectory(temp, name, '123', '1', parent))
    assert.equal(fs.lstatSync(child.path, { bigint: true }).ino.toString(), child.ino)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
