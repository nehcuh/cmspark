import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import vm from 'node:vm'
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
  assert.ok(f.includes("  [Console]::Out.WriteLine([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, 'CENSUS_650_SETUP {{\"version\":1,\"stage\":\"{0}\",\"phase\":\"{1}\",\"reason\":\"{2}\",\"line\":{3},\"column\":{4}}}', [object[]]@($receipt.stage, $receipt.phase, $receipt.reason, $receipt.line, $receipt.column)))\n"))
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
// Fixed progress is separate from the five formatter receipts; nothing arbitrary is public.
const probePrefix = 'CENSUS_650_PROBE '
const outerProbePlan = ['bootstrap', 'defined', 'unknown_before', 0, 'unknown_after', 'smb_setup_before', 1, 'smb_setup_after', 'smb_identity_before', 2, 'smb_identity_after', 'short_root_before', 3, 'short_root_after', 'cleanup_before', 4, 'cleanup_after', 'complete']
const formatterInnerStages = ['inner_param','inner_stage','inner_phase','inner_reason','inner_location','inner_receipt','inner_emitted']
const probePlan = outerProbePlan.flatMap(token => typeof token === 'number' ? [...formatterInnerStages.slice(0,6), token, formatterInnerStages[6]] : [token])
const formatterInnerAnchors = [
  {
    "stage": "inner_param",
    "before": "  param([string]$Stage, [string]$Phase, [System.Management.Automation.ErrorRecord]$Record)\n",
    "after": "  param([string]$Stage, [string]$Phase, [System.Management.Automation.ErrorRecord]$Record)\n  [Console]::Out.WriteLine('CENSUS_650_PROBE inner_param')\n"
  },
  {
    "stage": "inner_stage",
    "before": "  if ($Stage -cin @('primary', 'cleanup')) { $safeStage = $Stage }\n",
    "after": "  if ($Stage -cin @('primary', 'cleanup')) { $safeStage = $Stage }\n  [Console]::Out.WriteLine('CENSUS_650_PROBE inner_stage')\n"
  },
  {
    "stage": "inner_phase",
    "before": "  if ($Phase -cin @('service', 'directory_create', 'share_owner', 'share_create', 'controls', 'short_join', 'short_directory', 'short_type', 'long_buffer', 'short_buffer', 'long_call', 'long_check', 'short_call', 'short_check', 'roots_long', 'roots_short', 'roots_unc', 'launcher', 'cleanup_identity', 'cleanup_lookup', 'cleanup_verify', 'cleanup_share', 'cleanup_directory', 'cleanup_unc_env', 'cleanup_long_env', 'cleanup_short_env')) { $safePhase = $Phase }\n",
    "after": "  if ($Phase -cin @('service', 'directory_create', 'share_owner', 'share_create', 'controls', 'short_join', 'short_directory', 'short_type', 'long_buffer', 'short_buffer', 'long_call', 'long_check', 'short_call', 'short_check', 'roots_long', 'roots_short', 'roots_unc', 'launcher', 'cleanup_identity', 'cleanup_lookup', 'cleanup_verify', 'cleanup_share', 'cleanup_directory', 'cleanup_unc_env', 'cleanup_long_env', 'cleanup_short_env')) { $safePhase = $Phase }\n  [Console]::Out.WriteLine('CENSUS_650_PROBE inner_phase')\n"
  },
  {
    "stage": "inner_reason",
    "before": "  }\n  $line = 0; $column = 0\n",
    "after": "  }\n  [Console]::Out.WriteLine('CENSUS_650_PROBE inner_reason')\n  $line = 0; $column = 0\n"
  },
  {
    "stage": "inner_location",
    "before": "  }\n  $receipt = [ordered]@{ version = 1; stage = $safeStage; phase = $safePhase; reason = $reason; line = $line; column = $column }\n",
    "after": "  }\n  [Console]::Out.WriteLine('CENSUS_650_PROBE inner_location')\n  $receipt = [ordered]@{ version = 1; stage = $safeStage; phase = $safePhase; reason = $reason; line = $line; column = $column }\n"
  },
  {
    "stage": "inner_receipt",
    "before": "  $receipt = [ordered]@{ version = 1; stage = $safeStage; phase = $safePhase; reason = $reason; line = $line; column = $column }\n",
    "after": "  $receipt = [ordered]@{ version = 1; stage = $safeStage; phase = $safePhase; reason = $reason; line = $line; column = $column }\n  [Console]::Out.WriteLine('CENSUS_650_PROBE inner_receipt')\n"
  },
  {
    "stage": "inner_emitted",
    "before": "  [Console]::Out.WriteLine([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, 'CENSUS_650_SETUP {{\"version\":1,\"stage\":\"{0}\",\"phase\":\"{1}\",\"reason\":\"{2}\",\"line\":{3},\"column\":{4}}}', [object[]]@($receipt.stage, $receipt.phase, $receipt.reason, $receipt.line, $receipt.column)))\n",
    "after": "  [Console]::Out.WriteLine([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, 'CENSUS_650_SETUP {{\"version\":1,\"stage\":\"{0}\",\"phase\":\"{1}\",\"reason\":\"{2}\",\"line\":{3},\"column\":{4}}}', [object[]]@($receipt.stage, $receipt.phase, $receipt.reason, $receipt.line, $receipt.column)))\n  [Console]::Out.WriteLine('CENSUS_650_PROBE inner_emitted')\n"
  }
]
function instrumentedFormatter(original = formatter()) {
  assert.equal(original.includes('CENSUS_650_PROBE inner_'), false, 'actual formatter already has inner diagnostics')
  let instrumented = original
  for (const {before, after} of formatterInnerAnchors) {
    assert.equal(instrumented.split(before).length - 1, 1, 'fixed formatter anchor must occur exactly once')
    instrumented = instrumented.replace(before, after)
  }
  let restored = instrumented
  for (const stage of formatterInnerStages) {
    const line = `  [Console]::Out.WriteLine('${probePrefix}${stage}')\n`
    assert.equal(restored.split(line).length - 1, 1, 'fixed inner marker must occur exactly once')
    restored = restored.replace(line, '')
  }
  assert.equal(restored, original, 'test-only inner markers must invert to actual formatter bytes')
  return instrumented
}
const probeMarker = 'PRIVATE_DIAGNOSTIC_MARKER'
function inspectProbeOutput(stdout) {
  const result = { stages: [], rows: [], validPrefix: true, complete: false, markerSeen: typeof stdout === 'string' && stdout.includes(probeMarker) }
  if (typeof stdout !== 'string') { result.validPrefix = false; return result }
  const lines = stdout === '' ? [] : stdout.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], expected = probePlan[index]
    if (line.includes(probeMarker) || expected === undefined) { result.validPrefix = false; break }
    if (typeof expected === 'string') {
      if (line !== probePrefix + expected) { result.validPrefix = false; break }
      result.stages.push(expected)
    } else {
      let row
      try { if (!line.startsWith('CENSUS_650_SETUP ')) throw new Error('FORMAT'); row = JSON.parse(line.slice(17)) } catch { result.validPrefix = false; break }
      const reason = ['OTHER', 'SMB_SETUP', 'SMB_IDENTITY', 'SHORT_ROOT', 'OTHER'][expected]
      const valid = row !== null && typeof row === 'object' && !Array.isArray(row) &&
        JSON.stringify(Object.keys(row)) === JSON.stringify(['version','stage','phase','reason','line','column']) &&
        row.version === 1 && row.stage === (expected === 0 ? 'UNKNOWN' : expected === 4 ? 'cleanup' : 'primary') &&
        row.phase === (expected === 0 ? 'UNKNOWN' : expected === 4 ? 'cleanup_verify' : 'short_check') && row.reason === reason &&
        ['line','column'].every(key => Number.isInteger(row[key]) && row[key] >= (expected === 0 ? 0 : 1) && row[key] <= 4096) &&
        (expected !== 0 || (row.line === 0 && row.column === 0))
      if (!valid) { result.validPrefix = false; break }
      result.rows.push(row)
    }
  }
  result.complete = result.validPrefix && lines.length === probePlan.length && !result.markerSeen
  return result
}
function finiteProbeOutcome(actual, observed) {
  return {
    error: actual.error === undefined ? 'NONE' : actual.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'OTHER',
    status: actual.status === 0 ? 'ZERO' : Number.isInteger(actual.status) ? 'NONZERO' : 'NONE',
    signal: actual.signal == null ? 'NONE' : actual.signal === 'SIGTERM' ? 'TERM' : actual.signal === 'SIGKILL' ? 'KILL' : 'OTHER',
    stages: observed.stages, receipts: observed.rows.length, validPrefix: observed.validPrefix,
    complete: observed.complete, markerSeen: observed.markerSeen, stderrEmpty: actual.stderr === '',
  }
}
function declaredProbeScript() {
  const f = instrumentedFormatter(), mark = stage => `[Console]::Out.WriteLine('${probePrefix}${stage}')\n`
  let script = mark('bootstrap') + "if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'CENSUS_DIAGNOSTIC_PS51_REQUIRED' }\n" + f + '\n' + mark('defined')
  script += `$unknown = [System.Management.Automation.ErrorRecord]::new([Exception]::new('${probeMarker}'), '${probeMarker}', [System.Management.Automation.ErrorCategory]::InvalidOperation, '${probeMarker}')\n` + mark('unknown_before')
  script += `Write-Cmspark650SetupDiagnostic -Stage '${probeMarker}' -Phase '${probeMarker}' -Record $unknown\n` + mark('unknown_after')
  for (const [id, stage] of [['CENSUS_OWNED_SMB_SETUP_FAILED','smb_setup'],['CENSUS_OWNED_SMB_IDENTITY_INVALID','smb_identity'],['CENSUS_OWNED_SHORT_ROOT_INVALID','short_root']]) {
    script += mark(stage + '_before') + `try { throw '${id}' } catch { Write-Cmspark650SetupDiagnostic -Stage 'primary' -Phase 'short_check' -Record $_ }\n` + mark(stage + '_after')
  }
  script += mark('cleanup_before') + `try { throw '${probeMarker}' } catch { Write-Cmspark650SetupDiagnostic -Stage 'cleanup' -Phase 'cleanup_verify' -Record $_ }\n` + mark('cleanup_after') + mark('complete')
  return script
}
test('hosted Windows executes actual PS formatter with unknown marker and fixed known IDs; no SMB/native application', { skip: process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' ? 'actual hosted Windows PowerShell formatter required' : false }, () => {
  const script = declaredProbeScript(), marker = probeMarker
  const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH'])if(typeof process.env[key]==='string')env[key]=process.env[key]
  const actual=spawnSync(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536})
  const observed = inspectProbeOutput(actual.stdout), summary = 'CENSUS_650_FORMATTER ' + JSON.stringify(finiteProbeOutcome(actual, observed))
  // Boolean assertions keep Node from formatting the original Error/argv/stream bodies.
  assert.equal(actual.error === undefined,true,summary);assert.equal(actual.status === 0,true,summary);assert.equal(actual.stderr === '',true,summary)
  assert.equal(observed.complete,true,summary)
  assert.equal(actual.stdout.includes(marker),false,'arbitrary ErrorRecord contents never publish')
  const rows=observed.rows
  assert.equal(rows.length,5)
  for(const row of rows){assert.deepEqual(Object.keys(row),['version','stage','phase','reason','line','column']);assert.equal(row.version,1);for(const key of ['line','column'])assert.ok(Number.isInteger(row[key])&&row[key]>=0&&row[key]<=4096)}
  assert.deepEqual(rows[0],{version:1,stage:'UNKNOWN',phase:'UNKNOWN',reason:'OTHER',line:0,column:0})
  assert.deepEqual(rows.slice(1,4).map(x=>x.reason),['SMB_SETUP','SMB_IDENTITY','SHORT_ROOT'])
  assert.ok(rows.slice(1).every(x=>x.line>0&&x.column>0));assert.equal(rows[4].stage,'cleanup');assert.equal(rows[4].phase,'cleanup_verify');assert.equal(rows[4].reason,'OTHER')
})
// Portable controls invoke the registered real parent callback with a child-process seam.
// They execute no PowerShell/native process and make no Windows startup claim.
function controlledNativeCallback(actual, source = fs.readFileSync(new URL(import.meta.url), 'utf8')) {
  const callbacks = [], calls = []
  const register = (name, options, callback) => callbacks.push({ name, callback: typeof options === 'function' ? options : callback })
  const fixtureURL = new URL(import.meta.url).href
  vm.runInNewContext(source.replace(/^import .*$/gm, '').replaceAll('import.meta.url', 'fixtureURL'), {
    test: register, assert, fs, os, path, vm, Buffer, URL, createRequire, fixtureURL,
    process: { platform: 'win32', env: { GITHUB_ACTIONS:'true', SystemRoot:'C:\\Windows', WINDIR:'C:\\Windows', TEMP:'C:\\Owned', TMP:'C:\\Owned', PATH:'C:\\Windows' } },
    spawnSync: (...args) => { calls.push(args); return actual },
  }, { timeout:1000 })
  let failure
  try { callbacks.find(x => x.name.startsWith('hosted Windows executes actual PS formatter')).callback() } catch (error) { failure = error }
  return { failure, calls }
}
function completeProbeLines() {
  return probePlan.map(token => typeof token === 'string' ? probePrefix + token : 'CENSUS_650_SETUP ' + JSON.stringify({ version:1, stage:token === 0 ? 'UNKNOWN' : token === 4 ? 'cleanup' : 'primary', phase:token === 0 ? 'UNKNOWN' : token === 4 ? 'cleanup_verify' : 'short_check', reason:['OTHER','SMB_SETUP','SMB_IDENTITY','SHORT_ROOT','OTHER'][token], line:token === 0 ? 0 : 1, column:token === 0 ? 0 : 1 }))
}
test('portable real parent callback admits only the exact complete stages and original five receipts', () => {
  const stdout = completeProbeLines().join('\r\n') + '\r\n', result = controlledNativeCallback({ stdout, stderr:'', status:0, signal:null })
  assert.equal(result.failure,undefined);assert.equal(result.calls.length,1)
  const [program,args,options] = result.calls[0]
  assert.ok(program.endsWith('powershell.exe'));assert.deepEqual(Array.from(args.slice(0,3)),['-NoProfile','-NonInteractive','-EncodedCommand'])
  assert.equal(options.timeout,15000);assert.equal(options.maxBuffer,65536);assert.equal(options.windowsHide,true)
  assert.deepEqual(Object.keys(options.env),['SystemRoot','WINDIR','TEMP','TMP','PATH'])
  const decoded=Buffer.from(args[3],'base64').toString('utf16le')
  assert.equal(decoded,declaredProbeScript())
  const lexicalStages=[...decoded.matchAll(/\[Console\]::Out\.WriteLine\('CENSUS_650_PROBE ([a-z_]+)'\)/g)].map(x=>x[1])
  assert.deepEqual(lexicalStages.filter(x=>!formatterInnerStages.includes(x)),outerProbePlan.filter(x=>typeof x==='string'))
  for(const stage of formatterInnerStages)assert.equal(lexicalStages.filter(x=>x===stage).length,1)
  assert.equal((decoded.match(/^Write-Cmspark650SetupDiagnostic /gm)??[]).length,1)
  assert.equal((decoded.match(/catch \{ Write-Cmspark650SetupDiagnostic /g)??[]).length,4)
  assert.equal(inspectProbeOutput(stdout).rows.length,5)
})
test('portable real timeout retains fixed partial stages without printing raw error argv or stream bodies', () => {
  const stdout = completeProbeLines().slice(0,3).join('\r\n') + '\r\n'
  const error = Object.assign(new Error(probeMarker), { code:'ETIMEDOUT', spawnargs:[probeMarker], path:probeMarker })
  const result = controlledNativeCallback({ error, stdout, stderr:probeMarker, status:null, signal:'SIGTERM' })
  assert.ok(result.failure);assert.equal(result.failure.message.includes(probeMarker),false)
  assert.match(result.failure.message, /CENSUS_650_FORMATTER .*"error":"TIMEOUT"/)
  assert.match(result.failure.message, /"stages":\["bootstrap","defined","unknown_before"\]/)
  assert.match(result.failure.message, /"receipts":0,"validPrefix":true,"complete":false/)
})
test('portable parser and real parent reject unknown forged duplicated out-of-order or extra stages without echo', () => {
  const good = completeProbeLines()
  const variants = [ ['CENSUS_650_PROBE arbitrary',...good.slice(1)], [good[1],good[0],...good.slice(2)], [good[0],...good], [...good,'CENSUS_650_PROBE complete'], [...good.slice(0,4),'CENSUS_650_PROBE '+probeMarker,...good.slice(5)], good.filter((_,i)=>i!==3) ]
  for (const lines of variants) {
    const stdout = lines.join('\n')+'\n', observed = inspectProbeOutput(stdout)
    assert.equal(observed.complete,false)
    const actual = controlledNativeCallback({ stdout, stderr:'', status:0, signal:null })
    assert.ok(actual.failure);assert.equal(actual.failure.message.includes(probeMarker),false)
  }
})
test('portable parser rejects arbitrary marker malformed extra-field and incorrectly classified receipts', () => {
  for (const poison of [probeMarker, '{', JSON.stringify({version:1}), JSON.stringify({version:1,stage:'UNKNOWN',phase:'UNKNOWN',reason:'OTHER',line:0,column:0,extra:probeMarker}), JSON.stringify({version:1,stage:'UNKNOWN',phase:'UNKNOWN',reason:'SMB_SETUP',line:0,column:0})]) {
    const lines=completeProbeLines();lines[probePlan.findIndex(x=>typeof x==='number')]='CENSUS_650_SETUP '+poison
    const stdout=lines.join('\n')+'\n';assert.equal(inspectProbeOutput(stdout).complete,false)
    const actual=controlledNativeCallback({stdout,stderr:'',status:0,signal:null})
    assert.ok(actual.failure);assert.equal(actual.failure.message.includes(probeMarker),false)
  }
})
test('portable failure categories never publish unknown signal error status or stderr values', () => {
  for (const actual of [ {error:Object.assign(new Error(probeMarker),{code:probeMarker}),status:null,signal:probeMarker}, {status:1,signal:null}, {status:0,signal:null} ]) {
    actual.stdout=completeProbeLines().join('\n')+'\n';actual.stderr=probeMarker
    const result=controlledNativeCallback(actual)
    assert.ok(result.failure);assert.equal(result.failure.message.includes(probeMarker),false)
    assert.match(result.failure.message,/CENSUS_650_FORMATTER /)
  }
})

// Independent finite expected protocol; this fixture is not Windows output.
function expectedInnerProtocolLines() {
  const outer=['bootstrap','defined','unknown_before',0,'unknown_after','smb_setup_before',1,'smb_setup_after','smb_identity_before',2,'smb_identity_after','short_root_before',3,'short_root_after','cleanup_before',4,'cleanup_after','complete']
  const inner=['inner_param','inner_stage','inner_phase','inner_reason','inner_location','inner_receipt']
  return outer.flatMap(token => {
    if(typeof token==='string')return[probePrefix+token]
    const row={version:1,stage:token===0?'UNKNOWN':token===4?'cleanup':'primary',phase:token===0?'UNKNOWN':token===4?'cleanup_verify':'short_check',reason:['OTHER','SMB_SETUP','SMB_IDENTITY','SHORT_ROOT','OTHER'][token],line:token===0?0:1,column:token===0?0:1}
    return[...inner.map(stage=>probePrefix+stage),'CENSUS_650_SETUP '+JSON.stringify(row),probePrefix+'inner_emitted']
  })
}
test('portable inner protocol real parent requires every fixed inner stage in all five calls',()=>{
  const lines=expectedInnerProtocolLines();assert.equal(lines.length,53)
  const result=controlledNativeCallback({stdout:lines.join('\r\n')+'\r\n',stderr:'',status:0,signal:null})
  assert.equal(result.failure,undefined);assert.equal(result.calls.length,1)
  assert.deepEqual(completeProbeLines(),lines)
  const decoded=Buffer.from(result.calls[0][1][3],'base64').toString('utf16le')
  for(const stage of ['inner_param','inner_stage','inner_phase','inner_reason','inner_location','inner_receipt','inner_emitted'])assert.equal((decoded.match(new RegExp("\\[Console\\]::Out\\.WriteLine\\('CENSUS_650_PROBE "+stage+"'\\)",'g'))??[]).length,1)
})
test('portable inner TIMEOUT preserves each actually validated call prefix and remains failure',()=>{
  const lines=expectedInnerProtocolLines()
  for(let end=0;end<lines.length;end++){
    if(!/^CENSUS_650_PROBE inner_/.test(lines[end]))continue
    const partial=lines.slice(0,end+1),error=Object.assign(new Error(probeMarker),{code:'ETIMEDOUT',spawnargs:[probeMarker]})
    const result=controlledNativeCallback({stdout:partial.join('\n')+'\n',stderr:'',status:null,signal:'SIGTERM',error})
    assert.ok(result.failure);assert.equal(result.calls.length,1);assert.equal(result.failure.message.includes(probeMarker),false)
    const match=result.failure.message.match(/CENSUS_650_FORMATTER (\{[^\n]+\})/);assert.ok(match)
    const summary=JSON.parse(match[1]);assert.equal(summary.error,'TIMEOUT');assert.equal(summary.complete,false);assert.equal(summary.validPrefix,true)
    assert.deepEqual(summary.stages,partial.filter(x=>x.startsWith(probePrefix)).map(x=>x.slice(probePrefix.length)))
    assert.equal(summary.receipts,partial.filter(x=>x.startsWith('CENSUS_650_SETUP ')).length)
  }
})
test('portable test-copy inner instrumentation is exactly reversible and every anchor fails before spawn',()=>{
  const original=formatter(),instrumented=instrumentedFormatter(original)
  const markers=['inner_param','inner_stage','inner_phase','inner_reason','inner_location','inner_receipt','inner_emitted']
  let restored=instrumented
  for(const marker of markers){const line=`  [Console]::Out.WriteLine('${probePrefix}${marker}')\n`;assert.equal(restored.split(line).length-1,1);restored=restored.replace(line,'')}
  assert.equal(restored,original)
  assert.ok(instrumented.includes("  [Console]::Out.WriteLine([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, 'CENSUS_650_SETUP {{\"version\":1,\"stage\":\"{0}\",\"phase\":\"{1}\",\"reason\":\"{2}\",\"line\":{3},\"column\":{4}}}', [object[]]@($receipt.stage, $receipt.phase, $receipt.reason, $receipt.line, $receipt.column)))\n  [Console]::Out.WriteLine('CENSUS_650_PROBE inner_emitted')\n"), 'emitted marker follows the intact original output expression')
  assert.equal(instrumented.replace(/^  \[Console\]::Out\.WriteLine\('CENSUS_650_PROBE inner_[a-z]+'\)\n/gm,''),original)
  const nativeSource=fs.readFileSync(new URL(import.meta.url),'utf8')
  assert.ok(nativeSource.includes('const f = instrumentedFormatter()'))
  for(const anchor of formatterInnerAnchors){
    for(const mutated of [original.replace(anchor.before,''),original.replace(anchor.before,anchor.before+anchor.before),original.replace(anchor.before,anchor.before.replace(/\n$/, ' # changed\n'))]){
      assert.notEqual(mutated,original);assert.throws(()=>instrumentedFormatter(mutated))
      const changedSource=nativeSource.replace('const f = instrumentedFormatter()',`const f = instrumentedFormatter(${JSON.stringify(mutated)})`)
      const result=controlledNativeCallback({stdout:'',stderr:'',status:0,signal:null},changedSource)
      assert.ok(result.failure);assert.equal(result.calls.length,0,'invalid anchor refuses before actual child call')
    }
  }
})
test('portable inner protocol rejects unknown duplicate wrong-order missing or poisoned inner events',()=>{
  const good=expectedInnerProtocolLines(),first=good.indexOf(probePrefix+'inner_param'),receipt=good.findIndex(x=>x.startsWith('CENSUS_650_SETUP '))
  const variants=[good.with(first,probePrefix+'inner_unknown'),[...good.slice(0,first),good[first],...good.slice(first)],good.with(first,probePrefix+'inner_phase'),good.filter((_,i)=>i!==first),good.with(receipt,'CENSUS_650_SETUP '+probeMarker),good.with(first,probePrefix+probeMarker)]
  for(const lines of variants){const result=controlledNativeCallback({stdout:lines.join('\n')+'\n',stderr:'',status:0,signal:null});assert.ok(result.failure);assert.equal(result.failure.message.includes(probeMarker),false)}
})


// CPU source projection is not PowerShell execution; actual hosted callback still gates all five receipts.
function fixedEmissionFormat(source = formatter()) {
  const match = source.match(/^  \[Console\]::Out\.WriteLine\(\[string\]::Format\(\[System\.Globalization\.CultureInfo\]::InvariantCulture, '([^'\n]+)', \[object\[\]\]@\(\$receipt\.stage, \$receipt\.phase, \$receipt\.reason, \$receipt\.line, \$receipt\.column\)\)\)\n/m)
  assert.ok(match, 'actual closed formatter must use invariant fixed-format direct Console emission')
  return match[1]
}
test('cmdlet-free actual formatter output has no pipeline or module-dependent emitter',()=>{
 const f=formatter();fixedEmissionFormat(f)
 assert.doesNotMatch(f,/Write-Output|ConvertTo-Json|\|/)
 assert.match(f,/\$receipt = \[ordered\]@\{ version = 1; stage = \$safeStage; phase = \$safePhase; reason = \$reason; line = \$line; column = \$column \}/)
})
test('cmdlet-free fixed emission source projects canonical six-key JSON for every closed declaration',()=>{
 const format=fixedEmissionFormat(),marker='PRIVATE_DIAGNOSTIC_MARKER'
 for(const stage of['primary','cleanup',marker])for(const phase of[...phases,marker])for(const id of['CENSUS_OWNED_SMB_SETUP_FAILED','CENSUS_OWNED_SMB_IDENTITY_INVALID','CENSUS_OWNED_SHORT_ROOT_INVALID',marker])for(const position of[0,1,4096]){
  const closed=declarationProjection(formatter(),stage,phase,id),args=[closed.stage,closed.phase,closed.reason,String(position),String(position)]
  // Decode ONLY the real invariant-format literal and its closed scalar positions; not a PS runtime claim.
  const wire=format.replace(/\{\{|\}\}|\{([0-4])\}/g,(literal,index)=>index===undefined?(literal==='{{'?'{':'}'):args[Number(index)])
  assert.equal(wire,'CENSUS_650_SETUP '+JSON.stringify({version:1,...closed,line:position,column:position}));assert.equal(wire.includes(marker),false)
 }
})
