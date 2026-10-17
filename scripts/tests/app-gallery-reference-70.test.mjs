// Pure Node/owned-FS controls. No native signature result or binary download.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import * as collector from '../collect-app-gallery-reference-70.mjs'
import { requireHostedWindows, downloadArchive, parseSample, ARCHIVE_LIMIT } from '../collect-app-gallery-reference-70.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'companion/src/apps/preset-gallery-references.json'), 'utf8'))
function owned(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-gallery70-cpu-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, 'archive.zip')
}
test('#70 collector refuses local execution without acquisition or native calls', () => {
  assert.throws(() => requireHostedWindows('darwin', {}), /HOSTED_WINDOWS_ONLY/)
  assert.throws(() => requireHostedWindows('win32', { GITHUB_ACTIONS: 'true' }), /HOSTED_WINDOWS_ONLY/)
  assert.doesNotThrow(() => requireHostedWindows('win32', { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows' }))
})
test('#70 fixed artifact mutation rejects before file creation/fetch', async t => {
  const target = owned(t)
  const changed = structuredClone(catalog[0]); changed.reference.artifactURL = 'https://example.invalid/other.zip'
  await assert.rejects(downloadArchive(changed, target, () => { throw Error('must not fetch') }), /UNPINNED_ARTIFACT/)
  assert.equal(fs.existsSync(target), false)
})
test('#70 exclusive archive preserves a preexisting owned file and does not fetch', async t => {
  const target = owned(t); fs.writeFileSync(target, 'preserve-exact')
  await assert.rejects(downloadArchive(catalog[0], target, () => { throw Error('must not fetch') }), { code: 'EEXIST' })
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserve-exact')
})
test('#70 actual streamed bytes with wrong pin are removed, adjacent data preserved, request aborted', async t => {
  const target = owned(t), sibling = target + '.owned'
  fs.writeFileSync(sibling, 'preserve')
  let signal, calls = 0
  await assert.rejects(downloadArchive(catalog[0], target, async (url, opts) => {
    calls++; signal = opts.signal
    assert.equal(url, catalog[0].reference.artifactURL); assert.equal(opts.redirect, 'manual')
    return new Response('owned inert bytes, not a signed binary')
  }), /PACKAGE_SHA_MISMATCH/)
  assert.equal(calls, 1); assert.equal(signal.aborted, true)
  assert.equal(fs.existsSync(target), false); assert.equal(fs.readFileSync(sibling, 'utf8'), 'preserve')
})
test('#70 oversized content-length rejects without consuming/writing body', async t => {
  const target = owned(t)
  await assert.rejects(downloadArchive(catalog[0], target, async () => new Response('inert', { headers: { 'content-length': String(ARCHIVE_LIMIT + 1) } })), /ARCHIVE_LIMIT/)
  assert.equal(fs.existsSync(target), false)
})
test('#70 body byte limit also applies when content-length is absent', async t => {
  const target = owned(t)
  // Inert iterator seam: the bound rejects before touching/hash-writing bytes.
  // No 384MiB allocation or archive download is needed for this negative control.
  const response = { status: 200, headers: new Headers(), body: (async function* () { yield { byteLength: ARCHIVE_LIMIT + 1 } })() }
  await assert.rejects(downloadArchive(catalog[0], target, async () => response), /ARCHIVE_LIMIT/)
  assert.equal(fs.existsSync(target), false)
})
for (const location of ['http://release-assets.githubusercontent.com/owned', 'https://example.invalid/owned', 'https://user:pass@release-assets.githubusercontent.com/owned']) {
  test(`#70 unapproved redirect is rejected (${new URL(location).protocol}/${new URL(location).hostname})`, async t => {
    const target = owned(t); let calls = 0
    await assert.rejects(downloadArchive(catalog[0], target, async () => { calls++; return new Response(null, { status: 302, headers: { location } }) }), /REDIRECT_REJECTED/)
    assert.equal(calls, 1); assert.equal(fs.existsSync(target), false)
  })
}
test('#70 finite approved-host redirect loop cannot continue indefinitely', async t => {
  const target = owned(t); let calls = 0
  await assert.rejects(downloadArchive(catalog[0], target, async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/owned' } }) }), /REDIRECT_REJECTED/)
  assert.equal(calls, 4); assert.equal(fs.existsSync(target), false)
})
test('#70 download exception cleans exact partially owned archive', async t => {
  const target = owned(t)
  const failure = Error('OWNED_FETCH_FAILURE')
  await assert.rejects(downloadArchive(catalog[0], target, async () => { throw failure }), e => e === failure)
  assert.equal(fs.existsSync(target), false)
})
test('#70 malformed/unsigned wire cannot be promoted to certificate evidence', () => {
  for (const raw of ['{}', 'null', '{"signatureStatus":"NotSigned"}', '[]', 'not-json', 'x'.repeat(16_385)]) {
    assert.throws(() => parseSample(raw, catalog[0]))
  }
})
test('#70 production PS source binds exact entry, same archive handle and leaf DER, never whole extracts or launches', () => {
  // Static binding only. This is explicitly not PowerShell parsing or native execution.
  const ps = fs.readFileSync(path.join(root, 'scripts/fixtures/app-gallery-reference-70.ps1'), 'utf8')
  assert.ok(ps.includes('$candidate.FullName -ceq $EntryName'))
  assert.ok(ps.includes("if ($matchCount -ne 1) { throw 'EXACT_ONE_ENTRY_REQUIRED' }"))
  assert.ok(ps.includes('foreach ($candidate in $zip.Entries)'))
  assert.ok(ps.includes('$hash.ComputeHash($archive)'))
  assert.ok(ps.includes('$archive.Position = 0'))
  assert.ok(ps.includes('[IO.FileMode]::CreateNew'))
  assert.ok(ps.includes('$signature.SignerCertificate.RawData'))
  assert.ok(ps.indexOf('$held = [IO.File]::Open') < ps.indexOf('Get-AuthenticodeSignature -LiteralPath'))
  assert.equal(/ExtractToDirectory|Expand-Archive|Start-Process|Invoke-Item|Thumbprint/.test(ps), false)
})

function cliFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-gallery70-cli-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const copy = path.join(dir, 'actual'), scripts = path.join(copy, 'scripts'), data = path.join(copy, 'companion/src/apps')
  fs.mkdirSync(scripts, { recursive: true }); fs.mkdirSync(data, { recursive: true })
  const entry = path.join(scripts, 'collect-app-gallery-reference-70.mjs')
  fs.copyFileSync(path.join(root, 'scripts/collect-app-gallery-reference-70.mjs'), entry)
  fs.copyFileSync(path.join(root, 'companion/src/apps/preset-gallery-references.json'), path.join(data, 'preset-gallery-references.json'))
  const alias = path.join(dir, 'alias')
  fs.symlinkSync(copy, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const guard = path.join(dir, 'child-deny.cjs')
  fs.writeFileSync(guard, `const cp=require('node:child_process');let child=0,network=0,native=0;
for(const n of ['exec','execFile','execSync','execFileSync','spawn','spawnSync','fork'])cp[n]=()=>{child++;throw Error('CHILD_BLOCKED')};
require('node:net').Socket.prototype.connect=()=>{network++;throw Error('NETWORK_BLOCKED')};
globalThis.fetch=async()=>{network++;throw Error('NETWORK_BLOCKED')};process.dlopen=()=>{native++;throw Error('NATIVE_BLOCKED')};
require('node:module').syncBuiltinESMExports();process.on('exit',()=>console.error(JSON.stringify({guard:'gallery70-cli',child,network,native})));`)
  const invoke = script => {
    // Only this owned Node CLI may run. No inherited GHA credentials/config or
    // hosted opt-in; no output argument means acquisition is unreachable too.
    const result = spawnSync(process.execPath, ['--require', guard, script], {
      env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), LANG: 'C.UTF-8', GITHUB_ACTIONS: 'false', RUNNER_OS: 'NotHosted' },
      encoding: 'utf8', timeout: 5_000, maxBuffer: 65_536,
    })
    assert.equal(result.error, undefined); assert.equal(result.signal, null)
    const lines = result.stderr.trim().split('\n')
    const receipt = JSON.parse(lines.find(line => line.startsWith('{"guard":"gallery70-cli"')) || 'null')
    assert.deepEqual(receipt, { guard: 'gallery70-cli', child: 0, network: 0, native: 0 })
    t.diagnostic(JSON.stringify({ cli: path.basename(script), naturalExit: result.status, guard: receipt }))
    return result
  }
  return { entry, aliasEntry: path.join(alias, 'scripts', path.basename(entry)), missing: path.join(scripts, 'missing.mjs'), invoke }
}
test('#70 actual canonical CLI rejects unsupported host with no external effects', t => {
  const f = cliFixture(t), result = f.invoke(fs.realpathSync(f.entry))
  assert.equal(result.status, 1); assert.match(result.stderr, /HOSTED_WINDOWS_ONLY/)
})
test('#70 actual alias CLI runs the same gate instead of silent success', t => {
  const f = cliFixture(t), result = f.invoke(f.aliasEntry)
  assert.equal(result.status, 1); assert.match(result.stderr, /HOSTED_WINDOWS_ONLY/)
})
test('#70 actual missing CLI entry cannot silently succeed', t => {
  const f = cliFixture(t), result = f.invoke(f.missing)
  assert.notEqual(result.status, 0); assert.match(result.stderr, /MODULE_NOT_FOUND/)
})
test('#70 entry identity refuses missing/unsupported metadata and accepts an actual file alias', t => {
  const f = cliFixture(t)
  assert.equal(typeof collector.isCLIEntrypoint, 'function')
  assert.equal(collector.isCLIEntrypoint(undefined, pathToFileURL(f.entry).href), false)
  assert.equal(collector.isCLIEntrypoint(f.missing, pathToFileURL(f.entry).href), false)
  assert.equal(collector.isCLIEntrypoint(f.entry, 'https://example.invalid/entry.mjs'), false)
  assert.equal(collector.isCLIEntrypoint(f.aliasEntry, pathToFileURL(f.entry).href), true)
})

// Static/source and real JS producer controls only: hosted Desktop PS5.1 still
// decides whether fixed module discovery and signature sampling succeed.
test('#70 sampler fixes Utility/Security discovery without changing the 15s runner', () => {
  const ps = fs.readFileSync(path.join(root, 'scripts/fixtures/app-gallery-reference-70.ps1'), 'utf8')
  assert.ok(ps.includes("$compressionIdentity = 'System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089'"))
  assert.ok(ps.includes('$compressionAssembly = [Reflection.Assembly]::Load($compressionIdentity)'))
  assert.ok(ps.includes('$compressionAssembly.FullName -cne $compressionIdentity'))
  assert.ok(ps.includes("[object]::ReferenceEquals($compressionAssembly.GetType('System.IO.Compression.ZipArchive', $true).Assembly, $compressionAssembly)"))
  assert.doesNotMatch(ps, /Add-Type|LoadWithPartialName|LoadFrom|LoadFile/)
  assert.ok(ps.includes('Microsoft.PowerShell.Utility\\ConvertTo-Json'))
  assert.ok(ps.includes('$buffer = [byte[]]::new(65536)'))
  assert.doesNotMatch(ps, /\|\s*Where-Object|\bNew-Object\b/)
  assert.ok(ps.includes('Microsoft.PowerShell.Security\\Get-AuthenticodeSignature'))
  const source = fs.readFileSync(path.join(root, 'scripts/collect-app-gallery-reference-70.mjs'), 'utf8')
  assert.match(source, /const raw = await runPs\(/)
  assert.doesNotMatch(source, /timeoutMs\s*:/)
})
test('#70 actual failure projection retains only fixed stages and finite child facts', () => {
  assert.equal(typeof collector.sampleFailureDiagnostic, 'function')
  const secret = 'OWNED_INERT_SENTINEL_DO_NOT_ECHO'
  const result = collector.sampleFailureDiagnostic({
    stderr: 'GALLERY70_PHASE=ENTERED:1\r\n' + secret + '\nGALLERY70_PHASE=ASSEMBLY_READY:9\n',
    stdout: secret, message: secret, code: secret, killed: true, signal: 'SIGTERM',
  })
  assert.deepEqual(result, { kind: 'GALLERY70_SAMPLE_FAILURE',
    phases: [{ phase: 'ENTERED', elapsed_ms: 1 }, { phase: 'ASSEMBLY_READY', elapsed_ms: 9 }],
    code: null, killed: true, signal: 'SIGTERM' })
  assert.equal(JSON.stringify(result).includes(secret), false)
})
test('#70 failure projection refuses unknown, reordered, duplicate, oversized and injected markers', () => {
  assert.equal(typeof collector.sampleFailureDiagnostic, 'function')
  for (const stderr of [
    'GALLERY70_PHASE=UNKNOWN_SECRET:4', 'prefix GALLERY70_PHASE=ENTERED:1',
    'GALLERY70_PHASE=ASSEMBLY_READY:9\nGALLERY70_PHASE=ENTERED:10',
    'GALLERY70_PHASE=ENTERED:1\nGALLERY70_PHASE=ENTERED:2',
    'GALLERY70_PHASE=ENTERED:999999999999999999999',
    'GALLERY70_PHASE=ENTERED:1 extra', 'x'.repeat(16 * 1024 * 1024 + 1),
  ]) assert.deepEqual(collector.sampleFailureDiagnostic({ stderr }).phases, [])
  assert.deepEqual(collector.sampleFailureDiagnostic(null), {
    kind: 'GALLERY70_SAMPLE_FAILURE', phases: [], code: null, killed: false, signal: null })
  assert.equal(collector.sampleFailureDiagnostic({ code: 1 }).code, 1)
  assert.equal(collector.sampleFailureDiagnostic({ code: 'ENOENT' }).code, 'ENOENT')
  assert.equal(collector.sampleFailureDiagnostic({ signal: 'OWNED_UNKNOWN' }).signal, null)
})

test('#70 finite failure fields snapshot actual accessors once before admission', () => {
  let signalReads = 0, stderrReads = 0
  const error = {
    get signal() { return ++signalReads === 1 ? 'SIGTERM' : 'OWNED_INERT_SENTINEL_DO_NOT_ECHO' },
    get stderr() { return ++stderrReads === 1 ? 'GALLERY70_PHASE=ENTERED:1' : 'GALLERY70_PHASE=UNKNOWN_SECRET:2' },
  }
  const result = collector.sampleFailureDiagnostic(error)
  assert.equal(signalReads, 1); assert.equal(stderrReads, 1)
  assert.equal(result.signal, 'SIGTERM')
  assert.deepEqual(result.phases, [{ phase: 'ENTERED', elapsed_ms: 1 }])
  assert.equal(JSON.stringify(result).includes('OWNED_INERT_SENTINEL_DO_NOT_ECHO'), false)
})

test('#70 extraction boundary reports a strict prefix through buffer readiness', () => {
  const phases = ['ENTERED', 'ASSEMBLY_READY', 'ARCHIVE_VERIFIED', 'ZIP_OPENED',
    'ENTRY_SELECTED', 'ENTRY_OPENED', 'OUTPUT_OPENED', 'BUFFER_READY', 'ENTRY_WRITTEN',
    'EXE_VERIFIED', 'SIGNATURE_ENTERED', 'SIGNATURE_RETURNED', 'COMPLETE']
  for (let length = 1; length <= phases.length; length++) {
    const prefix = phases.slice(0, length)
    const stderr = prefix.map((phase, i) => `GALLERY70_PHASE=${phase}:${i}`).join('\r\n')
    assert.deepEqual(collector.sampleFailureDiagnostic({ stderr }).phases,
      prefix.map((phase, i) => ({ phase, elapsed_ms: i })))
  }
  for (const stderr of [
    'GALLERY70_PHASE=ENTERED:0\nGALLERY70_PHASE=ZIP_OPENED:1',
    phases.slice(0, 4).map((phase, i) => `GALLERY70_PHASE=${phase}:${i}`).join('\n') + '\nGALLERY70_PHASE=ZIP_OPENED:4',
  ]) assert.deepEqual(collector.sampleFailureDiagnostic({ stderr }).phases, [])
})
