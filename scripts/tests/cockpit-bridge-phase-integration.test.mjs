import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const api = require('./cockpit-bridge-first-evidence.cjs')
const { createObservation } = require('./cockpit-bridge-phase-observation.cjs')

test('optional phase frame retains old wire and first/cleanup authority under original4096 bound', () => {
  const frames = [], o = api.createObserver(bytes => { frames.push(Buffer.from(bytes)); return bytes.length })
  const clock = createObservation(() => 0); clock.start(); clock.mark(1)
  o.start(new AbortController().signal); o.refuse(1, 'CHECK_REFUSED'); o.phases(clock.snapshot('ABORT'))
  o.phases({ v: 1, phases: [[1, 0], [9, 0]], registrar: [[1, 0]], at: 'CLOSE' })
  o.cleanup(); o.refuse(2, 'ASSERT_REFUSED'); o.complete(false)
  const bytes = Buffer.concat(frames), record = api.decode(bytes)
  assert.equal(api.LIMIT, 4096); assert.ok(bytes.length <= 4096)
  assert.equal(record.first.site, 1); assert.equal(record.completion.cleanupFirst.site, 2)
  assert.equal(record.completion.ok, false); assert.equal(record.phases.record.at, 'ABORT')
  assert.equal(frames.filter(b => b.toString().includes('"kind":"phases"')).length, 1)
  const publicValue = api.publicEvidence(record, '')
  assert.deepEqual(publicValue.phases, clock.snapshot('CLOSE'))
  const old = api.createObserver(bytes => bytes.length); old.complete(true)
  assert.equal(Object.hasOwn(api.decode(Buffer.from('{"v":1,"kind":"completion","ok":true,"surface":0,"cleanupFirst":null}\n')), 'phases'), false)
})
test('invalid optional diagnostics never export private fields or replace original outcome', () => {
  const frames = [], o = api.createObserver(bytes => { frames.push(Buffer.from(bytes)); return bytes.length })
  o.phases({ v: 1, phases: [[1, 0]], registrar: null, at: 'ABORT', path: 'PRIVATE' }); o.complete(false)
  const bytes = Buffer.concat(frames), result = api.decode(bytes)
  assert.equal(bytes.includes(Buffer.from('PRIVATE')), false)
  assert.deepEqual(result.phases.record, { v: 1, phases: null, registrar: null, at: 'UNKNOWN' })
  for (const replace of [s => s.replace('"at":"UNKNOWN"', '"at":"PRIVATE"'), s => s.replace('"phases":null', '"phases":[[1,181]]'), s => s.replace('"registrar":null', '"registrar":[[2,0]]')]) assert.equal(api.decode(Buffer.from(replace(bytes.toString()))), null)
  let actual = 0; const broken = api.createObserver(() => { throw Error('PRIVATE_SINK') })
  broken.phases(createObservation().snapshot('UNKNOWN')); broken.check(1, () => { actual++ }); broken.complete(true)
  assert.equal(actual, 1)
})
test('registrar diagnostic opt-in conserves every original business statement byte', () => {
  const source = fs.readFileSync(new URL('../register-cockpit-native-bridge.ps1', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  assert.ok(source.includes("$GateObservation723 -and -not $Unregister -and [Environment]::GetEnvironmentVariable('GITHUB_ACTIONS') -ceq 'true' -and [Environment]::GetEnvironmentVariable('RUNNER_OS') -ceq 'Windows'"))
  let business = source.replace('  [switch]$Unregister,\n  [switch]$GateObservation723\n', '  [switch]$Unregister\n')
  const a = business.indexOf('# Explicit remote-gate observation only.'), b = business.indexOf("$ErrorActionPreference = 'Stop'", a)
  assert.ok(a > 0 && b > a); business = business.slice(0, a) + business.slice(b)
  const lines = business.split('\n')
  business = lines.filter(line => !/^\s*(?:Write-Cmspark723Phase [1-8]|\$cmspark723Terminal = \$true|if \(\$cmspark723Terminal\) \{ Write-Cmspark723Phase 8 \})$/.test(line)).join('\n')
  // The separate full-registrar regression admits exactly six qualified reads.
  business = business.replaceAll('Microsoft.PowerShell.Management\\Get-Item', 'Get-Item')
  assert.equal(createHash('sha256').update(business).digest('hex'), '7618f1946a985272eae1c030d2db5ab383e2ddf6b81500a20c95fc02f2d88909')
  for (let id = 1; id <= 8; id++) assert.equal((source.match(new RegExp('Write-Cmspark723Phase ' + id + '(?![0-9])', 'g')) || []).length, 1)
  assert.ok(source.includes("[Console]::Out.WriteLine('CM723P '"))
  assert.ok(source.includes('foreach ($base in $bases.Values) { $base.Dispose() }\n  if ($cmspark723Terminal)'))
})

// Source-consumer regression only: the remote two-runner probe supplies the
// command-resolution evidence; these controls do not execute PowerShell.
test('registrar binds all six actual Get-Item reads to the admitted built-in module', () => {
  const source = fs.readFileSync(new URL('../register-cockpit-native-bridge.ps1', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  const calls = [...source.matchAll(/([A-Za-z.]+\\)?Get-Item -LiteralPath (\$[A-Za-z]+)/g)]
  assert.deepEqual(calls.map(m => [m[1], m[2]]), [
    ['Microsoft.PowerShell.Management\\', '$InstallRoot'], ['Microsoft.PowerShell.Management\\', '$root'], ['Microsoft.PowerShell.Management\\', '$root'],
    ['Microsoft.PowerShell.Management\\', '$Path'], ['Microsoft.PowerShell.Management\\', '$directory'], ['Microsoft.PowerShell.Management\\', '$binary'],
  ])
  // Removing only the six qualified command names restores the full registrar,
  // including literal paths, reparse fences, both registry views and re-read cleanup.
  assert.equal(createHash('sha256').update(source.replaceAll('Microsoft.PowerShell.Management\\Get-Item', 'Get-Item')).digest('hex'), '57a0a06ab55e7b9da3bfe8cbcf2d9856a5830858cb55a0db177122ddf5bc88f4')
})
