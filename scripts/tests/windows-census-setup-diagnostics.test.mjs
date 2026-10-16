import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const yaml = createRequire(new URL('../../companion/package.json', import.meta.url))('js-yaml')
const workflow = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const run = yaml.load(workflow).jobs['smoke-os'].steps.find(s => s.id === 'windows-census').run
const phases = ["service", "directory_create", "share_owner", "share_create", "controls", "short_join", "short_directory", "short_type", "long_buffer", "short_buffer", "long_call", "long_check", "short_call", "short_check", "roots_long", "roots_short", "roots_unc", "launcher", "cleanup_identity", "cleanup_lookup", "cleanup_verify", "cleanup_share", "cleanup_directory", "cleanup_unc_env", "cleanup_long_env", "cleanup_short_env"]
function formatter() {
  const match = run.match(/^# CMSPARK_650_SETUP_DIAGNOSTIC_BEGIN\n([\s\S]*?)^# CMSPARK_650_SETUP_DIAGNOSTIC_END\n/m)
  assert.ok(match, 'actual fixed workflow must contain the bounded diagnostic function')
  return match[1]
}
// CPU projection checks actual closed PS declarations, not a claimed PowerShell execution.
function declarationProjection(source, stage, phase, errorId) {
  const stageDecl = source.match(/if \(\$Stage -cin @\(([^\n]+)\)\)/)
  const phaseDecl = source.match(/if \(\$Phase -cin @\(([^\n]+)\)\)/)
  assert.ok(stageDecl); assert.ok(phaseDecl)
  const literals = x => [...x.matchAll(/'([^']*)'/g)].map(m => m[1])
  const rows = [...source.matchAll(/^    '(CENSUS_[A-Z_]+)' \{ \$reason = '([A-Z_]+)'; break \}$/gm)]
  assert.equal(rows.length, 3)
  return { stage: literals(stageDecl[1]).includes(stage) ? stage : 'UNKNOWN', phase: literals(phaseDecl[1]).includes(phase) ? phase : 'UNKNOWN', reason: rows.find(m => m[1] === errorId)?.[2] ?? 'OTHER' }
}
test('actual workflow formatter publishes only six fixed fields and bounded numeric source location', () => {
  const f = formatter()
  assert.match(f, /\$receipt = \[ordered\]@\{ version = 1; stage = \$safeStage; phase = \$safePhase; reason = \$reason; line = \$line; column = \$column \}/)
  assert.match(f, /\$candidateLine -ge 1 -and \$candidateLine -le 4096/)
  assert.match(f, /\$candidateColumn -ge 1 -and \$candidateColumn -le 4096/)
  assert.match(f, /Write-Output \('CENSUS_650_SETUP ' \+ \(\$receipt \| ConvertTo-Json -Compress\)\)/)
  assert.doesNotMatch(f, /\.Message|\.Exception|PositionMessage|ScriptStackTrace|\.Line\b|\$env:|Get-Content|Write-Host|Format-/)
})
test('actual declaration projection preserves exact three reasons and refuses marker-bearing IDs and unknown phases', () => {
  const f = formatter(), marker = 'PRIVATE_DIAGNOSTIC_MARKER'
  for (const [id, reason] of [['CENSUS_OWNED_SMB_SETUP_FAILED','SMB_SETUP'], ['CENSUS_OWNED_SMB_IDENTITY_INVALID','SMB_IDENTITY'], ['CENSUS_OWNED_SHORT_ROOT_INVALID','SHORT_ROOT']]) {
    assert.deepEqual(declarationProjection(f, 'primary', 'short_check', id), { stage:'primary', phase:'short_check', reason })
    for (const bad of [id.toLowerCase(), id + marker, marker + id, id + '\n']) assert.equal(declarationProjection(f, 'primary', 'short_check', bad).reason, 'OTHER')
  }
  assert.deepEqual(declarationProjection(f, marker, marker, marker), { stage:'UNKNOWN', phase:'UNKNOWN', reason:'OTHER' })
  assert.equal(JSON.stringify(declarationProjection(f, marker, marker, marker)).includes(marker), false)
})
test('every named phase is unique and remains distinguishable in the actual closed formatter declaration', () => {
  const f=formatter(); assert.equal(new Set(phases).size, phases.length)
  for (const phase of phases) assert.equal(declarationProjection(f, 'cleanup', phase, 'arbitrary').phase, phase)
  for (const phase of phases) assert.equal((run.match(new RegExp("\\$phase = '" + phase + "'", 'g')) ?? []).length, 1)
})
test('primary and cleanup independently emit receipt immediately before the unchanged hard throws', () => {
  formatter()
  assert.match(run, /\} catch \{\n  Write-Cmspark650SetupDiagnostic -Stage 'primary' -Phase \$phase -Record \$_\n  throw 'CENSUS_OWNED_SMB_STEP_FAILED'\n\} finally \{/)
  assert.match(run, /\} catch \{\n    Write-Cmspark650SetupDiagnostic -Stage 'cleanup' -Phase \$phase -Record \$_\n    throw 'CENSUS_OWNED_SMB_CLEANUP_FAILED'\n  \} finally \{/)
  assert.equal((run.match(/Write-Cmspark650SetupDiagnostic -Stage /g) ?? []).length,2)
})
test('original short-root and SMB failures still reject, without diagnostic fallback or extra dispatch', () => {
  formatter()
  assert.match(run, /if \(\$longLength -eq 0 -or \$longLength -ge 32768\) \{ throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' \}/)
  assert.match(run, /if \(\$shortLength -eq 0 -or \$shortLength -ge 32768 -or \$shortBuffer\.ToString\(\) -notmatch '~\[0-9\]' -or \$shortBuffer\.ToString\(\) -eq \$longBuffer\.ToString\(\)\) \{ throw 'CENSUS_OWNED_SHORT_ROOT_INVALID' \}/)
  assert.equal((run.match(/^  node scripts\/windows-census\.mjs$/gm)??[]).length,1)
  assert.match(run, /if \(-not \$shareCreated\) \{ throw 'CENSUS_OWNED_SMB_IDENTITY_INVALID' \}/)
  assert.match(run, /if \(\$current.Count -ne 1\) \{ throw 'CENSUS_OWNED_SMB_IDENTITY_INVALID' \}/)
  assert.doesNotMatch(run, /SilentlyContinue|continue-on-error|Start-Sleep/)
})
test('original eighty-five control families remain, followed only by this new diagnostic family', () => {
  formatter()
  assert.match(run, /^  node --test scripts\/tests\/windows-census\.test\.mjs scripts\/tests\/windows-census-evidence\.test\.mjs scripts\/tests\/windows-census-cli\.test\.mjs scripts\/tests\/windows-census-short-path\.test\.mjs scripts\/tests\/windows-census-setup-diagnostics\.test\.mjs$/m)
  assert.match(run, /node --test[^\n]+\n  if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/)
})
test('hosted Windows executes actual PS formatter with unknown marker and fixed known IDs; no SMB/native application', { skip: process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' ? 'actual hosted Windows PowerShell formatter required' : false }, () => {
  const f = formatter(), marker='PRIVATE_DIAGNOSTIC_MARKER'
  const script="if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'CENSUS_DIAGNOSTIC_PS51_REQUIRED' }\n"+f+`\n$unknown = [System.Management.Automation.ErrorRecord]::new([Exception]::new('${marker}'), '${marker}', [System.Management.Automation.ErrorCategory]::InvalidOperation, '${marker}')\nWrite-Cmspark650SetupDiagnostic -Stage '${marker}' -Phase '${marker}' -Record $unknown\nforeach ($id in @('CENSUS_OWNED_SMB_SETUP_FAILED','CENSUS_OWNED_SMB_IDENTITY_INVALID','CENSUS_OWNED_SHORT_ROOT_INVALID')) {\n  try { throw $id } catch { Write-Cmspark650SetupDiagnostic -Stage 'primary' -Phase 'short_check' -Record $_ }\n}\ntry { throw '${marker}' } catch { Write-Cmspark650SetupDiagnostic -Stage 'cleanup' -Phase 'cleanup_verify' -Record $_ }\n`
  const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH'])if(typeof process.env[key]==='string')env[key]=process.env[key]
  const actual=spawnSync(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536})
  assert.equal(actual.error,undefined,'formatter process must settle');assert.equal(actual.status,0,'actual Desktop PS formatter must succeed');assert.equal(actual.stderr,'')
  assert.equal(actual.stdout.includes(marker),false,'arbitrary ErrorRecord contents never publish')
  const rows=actual.stdout.trim().split(/\r?\n/).map(line=>{assert.ok(line.startsWith('CENSUS_650_SETUP '));return JSON.parse(line.slice(17))})
  assert.equal(rows.length,5)
  for(const row of rows){assert.deepEqual(Object.keys(row),['version','stage','phase','reason','line','column']);assert.equal(row.version,1);for(const key of ['line','column'])assert.ok(Number.isInteger(row[key])&&row[key]>=0&&row[key]<=4096)}
  assert.deepEqual(rows[0],{version:1,stage:'UNKNOWN',phase:'UNKNOWN',reason:'OTHER',line:0,column:0})
  assert.deepEqual(rows.slice(1,4).map(x=>x.reason),['SMB_SETUP','SMB_IDENTITY','SHORT_ROOT'])
  assert.ok(rows.slice(1).every(x=>x.line>0&&x.column>0));assert.equal(rows[4].stage,'cleanup');assert.equal(rows[4].phase,'cleanup_verify');assert.equal(rows[4].reason,'OTHER')
})
