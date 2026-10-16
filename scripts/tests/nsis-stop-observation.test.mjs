import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildObservedHelper, restoreOriginalHelper, createObservation, collectObservation } from './nsis-stop-observation.mjs'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const modulePath = fileURLToPath(new URL('./nsis-stop-observation.mjs', import.meta.url))
const original = fs.readFileSync(path.join(repo, 'companion/stop-installed-agent.ps1'))
const insideName = "space 中文 & O'Brien ! (test)"
const receipt = '.cmspark-stop-smoke.receipt'
const phases = ['section-enter', 'helper-enter', 'cim-enter', 'first-row', 'pipeline-return', 'helper-end', 'macro-return']
const complete = phases.slice(0, 5).map(p => `phase:${p}\r\n`).join('') + 'attempts:2\r\nphase:helper-end\r\nphase:macro-return\r\n'
const invalid = /NSIS_STOP_OBSERVATION_INVALID/
function owned(fn) {
  const root = path.join(os.tmpdir(), `cmspark-stop-${crypto.randomUUID().replaceAll('-', '')}`)
  fs.mkdirSync(root); fs.mkdirSync(path.join(root, insideName))
  try { return fn(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
function write(root, bytes) { fs.writeFileSync(path.join(root, insideName, receipt), bytes) }

test('observed helper inverses the complete actual production bytes, BOM and CRLF variants', () => {
  for (const bytes of [original, Buffer.concat([Buffer.from([239, 187, 191]), original]), Buffer.from(original.toString().replaceAll('\n', '\r\n'))]) {
    const observed = buildObservedHelper(bytes)
    assert.ok(observed.subarray(0, 3).equals(Buffer.from([239, 187, 191])))
    assert.deepEqual(restoreOriginalHelper(observed), bytes)
    assert.equal((observed.toString().match(/Get-CimInstance Win32_Process \| ForEach-Object \{/g) ?? []).length, 1)
    assert.equal((observed.toString().match(/Stop-Process -Id \$_\.ProcessId -Force -ErrorAction SilentlyContinue/g) ?? []).length, 1)
    assert.match(observed.toString(), /if \(\$script:cmsparkSmokeObservationGap\) \{ exit 149 \}/)
    assert.ok(observed.toString().indexOf('phase:pipeline-return') > observed.toString().indexOf('Stop-Process -Id'))
  }
})

test('missing, duplicate and pre-instrumented anchors cannot generate a different helper', () => {
  for (const marker of ["$ErrorActionPreference = 'Stop'", 'Get-CimInstance Win32_Process | ForEach-Object {', 'Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue']) {
    assert.throws(() => buildObservedHelper(Buffer.from(original.toString().replace(marker, 'REMOVED'))), invalid)
    assert.throws(() => buildObservedHelper(Buffer.concat([original, Buffer.from('\n' + marker)])), invalid)
  }
  assert.throws(() => buildObservedHelper(buildObservedHelper(original)), invalid)
  const observed = buildObservedHelper(original).toString()
  assert.throws(() => restoreOriginalHelper(Buffer.from(observed.replace('BEGIN:prelude', 'BEGIN:missing'))), invalid)
  assert.throws(() => restoreOriginalHelper(Buffer.from(observed + '\n# CMSPARK_NSIS_OBSERVE_V1_BEGIN:prelude\n')), invalid)
})

test('fresh exclusive owned preparation is incomplete and cannot substitute for stop acceptance', () => owned(root => {
  const descriptor = createObservation(root)
  assert.equal(descriptor.helperPath, path.join(fs.realpathSync(root), 'observed-stop.ps1'))
  assert.match(descriptor.sourceSHA256, /^[a-f0-9]{64}$/)
  assert.match(descriptor.observedSHA256, /^[a-f0-9]{64}$/)
  const summary = collectObservation(root, descriptor)
  assert.equal(summary.capture, 'incomplete')
  assert.equal(summary.stopOrSiblingAcceptanceProvided, false)
  assert.deepEqual(summary.phases, [])
  assert.throws(() => createObservation(root))
}))

test('complete finite phases retain no raw source, path, PID or observation-as-acceptance claim', () => owned(root => {
  const descriptor = createObservation(root); write(root, complete)
  const summary = collectObservation(root, descriptor)
  assert.equal(summary.capture, 'complete'); assert.equal(summary.gap, false)
  assert.equal(summary.stopAttempts, 2); assert.equal(summary.identityVerified, true)
  assert.equal(summary.helperInverseExact, true); assert.equal(summary.stopOrSiblingAcceptanceProvided, false)
  assert.deepEqual(summary.phases, phases)
  const wire = JSON.stringify(summary)
  assert.equal(wire.includes(root), false); assert.equal(wire.includes(descriptor.sourceSHA256), false)
  assert.deepEqual(Object.keys(summary).sort(), ['schema', 'kind', 'complete', 'capture', 'gap', 'phases', 'stopAttempts', 'recordBytes', 'identityVerified', 'helperInverseExact', 'stopOrSiblingAcceptanceProvided'].sort())
}))

test('missing or failure phases never become complete', () => {
  for (const value of ['', 'phase:section-enter\n', 'phase:section-enter\nphase:nsis-failed\n', complete.replace('phase:helper-end\r\n', ''), complete.replace('attempts:2\r\n', '')]) {
    owned(root => { const descriptor = createObservation(root); write(root, value); assert.equal(collectObservation(root, descriptor).capture, 'incomplete') })
  }
})

test('malformed, duplicate, oversized, non-ASCII, partial and raw-data records fail closed', () => {
  for (const value of [complete + 'phase:helper-enter\n', complete + 'SECRET-OWNED-MARKER\n', complete + 'attempts:1\n', complete.replace('attempts:2', 'attempts:-1'), complete.replace('attempts:2', 'attempts:2147483648'), complete.slice(0, -1), Buffer.from([0xff, 10]), 'x'.repeat(4097)]) {
    owned(root => { const descriptor = createObservation(root); write(root, value); assert.throws(() => collectObservation(root, descriptor), invalid) })
  }
})

test('replaced and linked receipt identities and mutated helper cannot be accepted', () => {
  owned(root => { const descriptor = createObservation(root); const trace = path.join(root, insideName, receipt); fs.renameSync(trace, trace + '.original'); write(root, complete); assert.throws(() => collectObservation(root, descriptor), invalid) })
  owned(root => { const descriptor = createObservation(root); fs.linkSync(path.join(root, insideName, receipt), path.join(root, 'same-file')); assert.throws(() => collectObservation(root, descriptor), invalid) })
  owned(root => { const descriptor = createObservation(root); fs.appendFileSync(descriptor.helperPath, '# mutation'); assert.throws(() => collectObservation(root, descriptor), invalid) })
  owned(root => { const descriptor = createObservation(root); assert.throws(() => collectObservation(root, { ...descriptor, helperPath: path.join(root, 'arbitrary.ps1') }), invalid) })
})

test('CLI invalid inputs emit only fixed finite gap JSON without exception or input disclosure', () => {
  for (const args of [['prepare', 'SECRET-OWNED-MARKER'], ['collect', 'SECRET-OWNED-MARKER', 'not-json'], ['unknown']]) {
    const result = spawnSync(process.execPath, [modulePath, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1); assert.equal(result.stderr, '')
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.capture, 'incomplete'); assert.equal(summary.gap, true)
    assert.equal(result.stdout.includes('SECRET-OWNED-MARKER'), false)
    assert.equal(result.stdout.includes('NSIS_STOP_OBSERVATION_INVALID'), false)
  }
})

test('smoke integrates passive instrumented helper while retaining the whole macro and every old native gate', () => {
  const smoke = fs.readFileSync(path.join(repo, 'scripts/tests/win-installer-stop-smoke.ps1'), 'utf8')
  assert.match(smoke, /& \$node --test \$observationTests/)
  assert.match(smoke, /\$node \$observationModule prepare \$root/)
  assert.match(smoke, /\$node \$observationModule collect \$root \$observationDescriptor/)
  assert.match(smoke, /\/DCMSPARK_STOP_SCRIPT=' \+ \$observation\.helperPath/)
  assert.match(smoke, /\.Replace\('__MACRO__', \$macro\)/)
  assert.ok(smoke.indexOf('ReadEnvStr $INSTDIR') < smoke.indexOf('__OBSERVATION_ENTER__'))
  assert.match(smoke, /NATIVE_TEST_PASSIVE_INSTRUMENTED_EXACT_ORIGINAL_BODY/)
  for (const old of ["$macro -match 'daemon\\s+stop|/IM\\s+cmspark-agent'", '$stop.WaitForExit(30000)', '$stop.ExitCode -ne 0', '$processes[0].WaitForExit(10000)', "$processes[1].HasExited", '$p.WaitForExit(10000)', '$p.HasExited', 'installed fixture was not stopped', 'sibling installation was incorrectly stopped', 'system Node agent was not stopped', 'unrelated system Node process was stopped']) assert.ok(smoke.includes(old), old)
  assert.ok(smoke.indexOf('$summary.capture') < smoke.indexOf('$processes[0].WaitForExit(10000)'))
  assert.match(smoke, /catch \{ Write-Host 'NSIS_STOP_OBSERVATION/)
})

// This interpreter exercises the emitted instruction/control-flow text only.
// It does not claim to compile or execute NSIS or to validate its filesystem.
test('emitted NSIS phase branches restore registers and prior error state while latching every capture failure', () => owned(root => {
  const descriptor = createObservation(root)
  const body = descriptor.nsisPreamble.match(/!macro CMSparkSmokePhase PHASE\n([\s\S]*?)!macroend/)[1]
  const instructions = body.split('\n').map(s => s.trim()).filter(Boolean)
  for (const previousError of [false, true]) for (const failure of ['none', 'open', 'seek', 'write']) {
    const registers = { '$7': 'old-seven', '$8': 'old-eight', '$9': 'old-nine', '$CMSparkSmokeObservationGap': '0' }, stack = []
    let error = previousError, pc = 0, executed = 0, closes = 0, writes = 0
    while (pc < instructions.length) {
      assert.ok(executed++ < 80, 'finite emitted control flow')
      const line = instructions[pc], op = line.split(' ')[0]
      const jump = value => { pc += Number(value) }
      if (op === 'Push') { stack.push(registers[line.split(' ')[1]]); pc++ }
      else if (op === 'Pop') { registers[line.split(' ')[1]] = stack.pop(); pc++ }
      else if (op === 'StrCpy') { const [, dest, value] = line.split(/\s+/); registers[dest] = value; pc++ }
      else if (op === 'IfErrors') { const [, yes, no] = line.split(/\s+/); const target = error ? yes : no; if (target === '0') pc++; else jump(target) }
      else if (op === 'Goto') jump(line.split(' ')[1])
      else if (op === 'ClearErrors') { error = false; pc++ }
      else if (op === 'SetErrors') { error = true; pc++ }
      else if (op === 'FileOpen') { error = failure === 'open'; if (!error) registers['$8'] = 'owned-file-handle'; pc++ }
      else if (op === 'FileSeek') { assert.equal(registers['$8'], 'owned-file-handle'); assert.match(line, /^FileSeek \$8 0 END \$7$/); registers['$7'] = failure === 'seek' ? '-1' : '0'; pc++ }
      else if (op === 'IntCmpU') { const [, variable, bound, equal, less, greater] = line.split(/\s+/); const actual = BigInt.asUintN(32, BigInt(registers[variable])), limit = BigInt(bound), target = actual === limit ? equal : actual < limit ? less : greater; if (target === '0') pc++; else jump(target) }
      else if (op === 'FileWrite') { assert.equal(registers['$8'], 'owned-file-handle'); writes++; error = failure === 'write'; pc++ }
      else if (op === 'FileClose') { assert.equal(registers['$8'], 'owned-file-handle'); closes++; pc++ }
      else if (op === 'StrCmp') { const [, variable, value, equal] = line.split(/\s+/); if (registers[variable] === value) jump(equal); else pc++ }
      else assert.fail('unexpected emitted instruction ' + op)
    }
    assert.equal(registers['$7'], 'old-seven'); assert.equal(registers['$8'], 'old-eight'); assert.equal(registers['$9'], 'old-nine')
    assert.equal(error, previousError); assert.equal(stack.length, 0)
    assert.equal(registers['$CMSparkSmokeObservationGap'], failure === 'none' ? '0' : '1')
    assert.equal(closes, failure === 'open' ? 0 : 1)
    assert.equal(writes, failure === 'open' || failure === 'seek' ? 0 : 1)
  }
  assert.ok(descriptor.nsisPreamble.indexOf('StrCmp $CMSparkSmokeSectionEntered "1"') < descriptor.nsisPreamble.indexOf('"nsis-failed"'))
}))

test('actual CLI prepare and collect use captured descriptors and publish only the finite complete summary', () => owned(root => {
  const prepared = spawnSync(process.execPath, [modulePath, 'prepare', root], { encoding: 'utf8' })
  assert.equal(prepared.status, 0); assert.equal(prepared.stderr, '')
  const descriptor = JSON.parse(prepared.stdout)
  write(root, complete)
  const result = spawnSync(process.execPath, [modulePath, 'collect', root, Buffer.from(prepared.stdout).toString('base64')], { encoding: 'utf8' })
  assert.equal(result.status, 0); assert.equal(result.stderr, '')
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.complete, true); assert.equal(summary.capture, 'complete'); assert.equal(summary.gap, false)
  assert.equal(result.stdout.includes(root), false); assert.equal(result.stdout.includes(descriptor.observedSHA256), false)
  assert.equal(summary.stopOrSiblingAcceptanceProvided, false)
}))

test('attempt counter is exactly after pipeline-return and before helper-end, never a reorderable side record', () => {
  for (const value of ['attempts:2\n' + complete.replace('attempts:2\r\n', ''), complete.replace('attempts:2\r\n', '') + 'attempts:2\n', complete.replace('attempts:2\r\n', '').replace('phase:helper-end\r\n', 'phase:helper-end\r\nattempts:2\r\n')]) {
    owned(root => { const descriptor = createObservation(root); write(root, value); assert.throws(() => collectObservation(root, descriptor), invalid) })
  }
})

// Official NSIS FileOpen 'a' opens without truncation at BEGINNING; FileSeek
// returns its position rather than setting the error flag, and FileClose also
// does not set that flag. These are explicit primitive-contract projections,
// not execution of an NSIS binary. Real Node files supply write position/bytes.
function replayEmittedPhase(descriptor, trace, seekFailure = false) {
  const body = descriptor.nsisPreamble.match(/!macro CMSparkSmokePhase PHASE\n([\s\S]*?)!macroend/)[1]
  const instructions = body.split('\n').map(s => s.trim()).filter(Boolean)
  const registers = { '$7': 'previous-seven', '$8': 'previous-eight', '$9': 'previous-nine', '$CMSparkSmokeObservationGap': '0' }, stack = []
  let error = false, pc = 0, fd = null, position = 0, steps = 0, writes = 0
  try {
    while (pc < instructions.length) {
      assert.ok(steps++ < 80)
      const line = instructions[pc], op = line.split(' ')[0]
      if (op === 'Push') { stack.push(registers[line.split(' ')[1]]); pc++ }
      else if (op === 'Pop') { registers[line.split(' ')[1]] = stack.pop(); pc++ }
      else if (op === 'StrCpy') { const [, dest, value] = line.split(/\s+/); registers[dest] = value; pc++ }
      else if (op === 'IfErrors') { const [, yes, no] = line.split(/\s+/), target = error ? yes : no; if (target === '0') pc++; else pc += Number(target) }
      else if (op === 'Goto') pc += Number(line.split(' ')[1])
      else if (op === 'ClearErrors') { error = false; pc++ }
      else if (op === 'SetErrors') { error = true; pc++ }
      else if (op === 'StrCmp') { const [, name, value, equal] = line.split(/\s+/); if (registers[name] === value) pc += Number(equal); else pc++ }
      else if (op === 'FileOpen') { assert.match(line, /^FileOpen \$8 .+ a$/); fd = fs.openSync(trace, 'r+'); registers['$8'] = fd; position = 0; pc++ }
      else if (op === 'FileSeek') {
        assert.match(line, /^FileSeek \$8 0 END \$7$/)
        registers['$7'] = seekFailure ? '-1' : String(fs.fstatSync(fd).size)
        if (!seekFailure) position = Number(registers['$7'])
        // No error flag change on either documented seek result.
        pc++
      } else if (op === 'IntCmpU') {
        const [, name, bound, equal, less, greater] = line.split(/\s+/)
        const actual = BigInt.asUintN(32, BigInt(registers[name])), limit = BigInt(bound), target = actual === limit ? equal : actual < limit ? less : greater
        if (target === '0') pc++; else pc += Number(target)
      } else if (op === 'FileWrite') {
        const match = line.match(/^FileWrite \$8 "(.+)"$/); assert.ok(match)
        const bytes = Buffer.from(match[1].replace('\${PHASE}', 'macro-return').replaceAll('$\\r', '\r').replaceAll('$\\n', '\n'), 'ascii')
        position += fs.writeSync(fd, bytes, 0, bytes.length, position); writes++; pc++
      } else if (op === 'FileClose') { fs.closeSync(fd); fd = null; pc++ }
      else assert.fail('unexpected emitted instruction ' + op)
    }
  } finally { if (fd !== null) fs.closeSync(fd) }
  assert.equal(registers['$7'], 'previous-seven'); assert.equal(registers['$8'], 'previous-eight'); assert.equal(registers['$9'], 'previous-nine'); assert.equal(error, false); assert.equal(stack.length, 0)
  return { gap: registers['$CMSparkSmokeObservationGap'], writes }
}

test('actual emitted phase writer appends real helper records and bounds seek failure or overflow without writing', () => {
  owned(root => {
    const descriptor = createObservation(root), trace = path.join(root, insideName, receipt)
    write(root, complete.replace('phase:macro-return\r\n', ''))
    assert.deepEqual(replayEmittedPhase(descriptor, trace), { gap: '0', writes: 1 })
    let summary
    assert.doesNotThrow(() => { summary = collectObservation(root, descriptor) })
    assert.equal(summary.complete, true); assert.equal(fs.readFileSync(trace, 'utf8'), complete)
  })
  for (const value of [0, 4096]) owned(root => {
    const descriptor = createObservation(root), trace = path.join(root, insideName, receipt)
    write(root, value ? 'x'.repeat(value) : complete.replace('phase:macro-return\r\n', ''))
    const before = fs.readFileSync(trace)
    assert.deepEqual(replayEmittedPhase(descriptor, trace, value === 0), { gap: '1', writes: 0 })
    assert.deepEqual(fs.readFileSync(trace), before)
  })
  // NSIS FileClose has no failure-result/error-flag contract. We claim no
  // direct close-failure observation; the real collector still validates data.
})
