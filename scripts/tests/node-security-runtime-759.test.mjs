// #759: inert contracts against the actual version guards and shipping inputs.
// No build entry point, subprocess, network, native module or container is run.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { DESKTOP_WINDOWS_INPUTS } from '../../companion/scripts/build-desktop-windows.mjs'
const read = name => fs.readFileSync(new URL('../../' + name, import.meta.url), 'utf8')
const patched = '22.23.4'
const rejected = ['22.19.0', '22.23.2', '22.23.3', '22.23.5', '24.22.1', '26.9.1']

test('owned package/lock engines require the patched, qualified Node22 line', () => {
  for (const prefix of ['', 'companion/']) {
    const pkg = JSON.parse(read(prefix + 'package.json'))
    const lock = JSON.parse(read(prefix + 'package-lock.json'))
    assert.equal(pkg.engines.node, '>=22.23.4 <23')
    assert.deepEqual(lock.packages[''].engines, pkg.engines)
    assert.equal(lock.packages[''].version, pkg.version)
  }
})
test('every CI/release setup-node job and packaged runtime use exact patched Node', () => {
  for (const [name, count] of [['ci.yml', 4], ['release.yml', 2]]) {
    const source = read('.github/workflows/' + name)
    const setupCount = [...source.matchAll(/uses: actions\/setup-node@/g)].length
    const versions = [...source.matchAll(/node-version:\s*['"]?([\d.]+)['"]?/g)].map(m => m[1])
    assert.equal(setupCount, count)
    assert.deepEqual(versions, Array(count).fill(patched))
  }
  assert.match(read('scripts/package.sh'), /^NODE_VERSION="v22\.23\.4"$/m)
})
test('native SDK URLs and SHA256 pins match the official v22.23.4 SHASUMS', () => {
  assert.equal(DESKTOP_WINDOWS_INPUTS.headers.url, 'https://nodejs.org/dist/v22.23.4/node-v22.23.4-headers.tar.gz')
  assert.equal(DESKTOP_WINDOWS_INPUTS.headers.sha256, 'dc4028dc105e27e5295119dd9da076fca71d5216113e097813f0fb30f59241a5')
  assert.equal(DESKTOP_WINDOWS_INPUTS.nodeLib.url, 'https://nodejs.org/dist/v22.23.4/win-x64/node.lib')
  assert.equal(DESKTOP_WINDOWS_INPUTS.nodeLib.sha256, 'c243185f2347870cadb637c909bf123fc703dc65dbfa769b17ec45a4b661d782')
})
test('Office Docker validation keeps the verified multi-platform index digest', () => {
  assert.match(read('docker/office-val.Dockerfile'), /^FROM node:22\.23\.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d$/m)
  const script = read('scripts/validate-office-container.sh')
  assert.equal((script.match(/cmspark-office-val:node22\.23\.4/g) || []).length, 2)
})
const guards = [
  ['build-desktop-native.mjs', 'darwin'],
  ['build-ax-native-571.mjs', 'darwin'],
  ['build-computer-uia-no-focus.mjs', 'win32'],
  ['build-computer-uia-native-probe-572.mjs', 'win32'],
]
for (const [file, platform] of guards) {
  test(file + ': actual pre-build runtime guard accepts only the pinned build runtime', () => {
    const lines = read('companion/scripts/' + file).split(/\r?\n/).filter(line => /^\s*if\s*\(/.test(line) && line.includes('process.version') && line.includes('throw'))
    assert.equal(lines.length, 1, 'one complete actual guard statement')
    const execute = (version, overrides = {}) => vm.runInNewContext(lines[0], { process: { platform, arch: 'x64', version: 'v' + version, ...overrides } })
    assert.doesNotThrow(() => execute(patched))
    for (const version of rejected) assert.throws(() => execute(version), { name: 'Error' })
    if (file !== 'build-desktop-native.mjs') assert.throws(() => execute(patched, {platform: 'linux'}), { name: 'Error' })
    if (platform === 'win32') assert.throws(() => execute(patched, {arch: 'arm64'}), { name: 'Error' })
    // The prior vulnerable pin must fail the exact same positive/negative oracle.
    const old = lines[0].replaceAll('22.23.4', '22.23.2')
    assert.notEqual(old, lines[0])
    assert.throws(() => vm.runInNewContext(old, {process: {platform, arch: 'x64', version: 'v' + patched}}), {name: 'Error'})
    assert.doesNotThrow(() => vm.runInNewContext(old, {process: {platform, arch: 'x64', version: 'v22.23.2'}}))
  })
}
test('Windows SEA actual Node guard cannot embed an old or mismatched runtime', () => {
  const source = read('scripts/build-windows-exe.ps1')
  const matches = [...source.matchAll(/^& \$NodeExe -e "(.*process\.versions\.node.*)"\r?$/gm)]
  assert.equal(matches.length, 1)
  const execute = (node, arch = 'x64') => {
    const exits = []
    vm.runInNewContext(matches[0][1], {process: {versions: {node}, arch, exit: code => exits.push(code)}, console: {error() {}}})
    return exits
  }
  assert.deepEqual(execute(patched), [])
  for (const version of rejected) assert.deepEqual(execute(version), [1])
  assert.deepEqual(execute(patched, 'arm64'), [1])
  assert.match(source, /if \(\$LASTEXITCODE -ne 0\) \{ Fail "Node\.js 22\.23\.4 required for Windows SEA packaging" \}/)
})

// Extract only the real SEA Node dispatch/copy statements, not a second packager.
// Inert command/runtime outlets model documented PowerShell command precedence;
// the complete original JavaScript guard executes unchanged in a VM.
function seaDispatch759(source) {
  const guard = [...source.matchAll(/^\s*(node|& \$NodeExe) -e "(.*process\.versions\.node.*)"\r?$/gm)]
  assert.equal(guard.length, 1)
  const resolve = [...source.matchAll(/^\$NodeCommand = Get-Command (node\.exe) -CommandType (Application) -ErrorAction SilentlyContinue\r?$/gm)]
  assert.equal(resolve.length, 1)
  const binding = [...source.matchAll(/^\$NodeExe = \$NodeCommand.Source\r?$/gm)]
  assert.equal(binding.length, 1)
  assert.ok(resolve[0].index < binding[0].index && binding[0].index < guard[0].index)
  assert.ok(source.includes('if (-not $NodeCommand -or -not $NodeCommand.Source -or $NodeCommand.Source -notlike "*.exe")'))
  const copy = [...source.matchAll(/^\s*Copy-Item (\$NodeExe) \$AppExe -Force\r?$/gm)]
  assert.equal(copy.length, 1)
  assert.ok(copy[0].index > guard[0].index)
  const direct = [...source.matchAll(/^\s*(node|& \$NodeExe) (.+)\r?$/gm)]
  assert.equal(direct.length, 10, 'complete direct Node call inventory')
  assert.equal((source.match(/Get-Command node\.exe/g) || []).length, 1)
  assert.equal((source.match(/^\s*\$NodeExe\s*=/gm) || []).length, 1)
  return io => {
    const command = io.resolve(resolve[0][1], resolve[0][2])
    if (!command?.Source || !command.Source.toLowerCase().endsWith('.exe')) throw Error('NO_NODE_EXE')
    const nodeExe = command.Source, calls = []
    for (const call of direct) {
      const binary = call[1] === '& $NodeExe' ? nodeExe : io.bareNode()
      if (call.index === guard[0].index) {
        const runtime = io.runtime(binary)
        vm.runInNewContext(guard[0][2], {process: {versions: {node: runtime.version}, arch: runtime.arch, exit() { throw Error('NODE_PIN_REFUSED') }}, console: {error() {}}})
      }
      calls.push(binary)
    }
    return {copied: nodeExe, calls}
  }
}
const seaSource759 = () => read('scripts/build-windows-exe.ps1')
function seaInputs759(realVersion = patched, arch = 'x64') {
  let resolves = 0
  return {io: {
    resolve(name, type) { assert.equal(name, 'node.exe'); assert.equal(type, 'Application'); resolves++; return {Source: 'C:\\owned real\\node.exe'} },
    bareNode: () => 'C:\\shim\\node.cmd',
    runtime: binary => binary.endsWith('node.cmd') ? {version: patched, arch: 'x64'} : {version: realVersion, arch},
  }, resolutions: () => resolves}
}
test('SEA validates and copies one bound executable despite a different bare node shim', () => {
  const s = seaInputs759(), result = seaDispatch759(seaSource759())(s.io)
  assert.equal(s.resolutions(), 1)
  assert.equal(result.copied, 'C:\\owned real\\node.exe')
  assert.deepEqual(result.calls, Array(10).fill(result.copied))
  for (const version of ['22.23.2', '22.23.3', '24.22.1']) assert.throws(() => seaDispatch759(seaSource759())(seaInputs759(version).io), /NODE_PIN_REFUSED/)
  assert.throws(() => seaDispatch759(seaSource759())(seaInputs759(patched, 'arm64').io), /NODE_PIN_REFUSED/)
})
test('SEA old unbound guard admits a patched shim while copying a vulnerable real executable', () => {
  const actual = seaSource759(), mutant = actual.replace('& $NodeExe -e ', 'node -e ')
  assert.notEqual(mutant, actual)
  const scenario = seaInputs759('22.23.2')
  const bad = seaDispatch759(mutant)(scenario.io)
  assert.equal(scenario.io.runtime(bad.calls[0]).version, patched)
  assert.equal(scenario.io.runtime(bad.copied).version, '22.23.2')
  assert.notEqual(bad.calls[0], bad.copied)
  assert.throws(() => seaDispatch759(actual)(seaInputs759('22.23.2').io), /NODE_PIN_REFUSED/)
})
test('SEA refuses missing/shim-only resolution and never re-resolves after validation', () => {
  for (const command of [null, {Source: ''}, {Source: 'C:\\shim\\node.cmd'}]) {
    const s = seaInputs759(); s.io.resolve = () => command
    assert.throws(() => seaDispatch759(seaSource759())(s.io), /NO_NODE_EXE/)
  }
  const s = seaInputs759(); let changed = false
  s.io.resolve = () => { if (changed) throw Error('UNEXPECTED_LATE_RESOLUTION'); return {Source: 'C:\\initial\\node.exe'} }
  s.io.runtime = () => { changed = true; return {version: patched, arch: 'x64'} }
  const result = seaDispatch759(seaSource759())(s.io)
  assert.equal(result.copied, 'C:\\initial\\node.exe')
  assert.deepEqual(result.calls, Array(10).fill(result.copied))
})

test('activity notifier staging reuses the same validated SEA executable', () => {
  const actual = seaSource759()
  const calls = [...actual.matchAll(/^& \$NodeExe ("\$ProjectRoot\\scripts\\stage-activity-notifier\.mjs" "\$CompanionDir" "\$StagingDir")\r?$/gm)]
  assert.equal(calls.length, 1, 'one exact actual notifier staging producer')
  const sourceCall = calls[0][0]
  assert.ok(actual.includes(sourceCall + '\nif ($LASTEXITCODE -ne 0) { Fail "Activity notification resource staging failed" }'))
  const mutant = actual.replace(sourceCall, sourceCall.replace('& $NodeExe ', 'node '))
  assert.notEqual(mutant, actual)
  const good = seaDispatch759(actual)(seaInputs759().io)
  const bad = seaDispatch759(mutant)(seaInputs759().io)
  assert.deepEqual(good.calls, Array(10).fill(good.copied))
  assert.equal(bad.calls.filter(binary => binary !== bad.copied).length, 1)
  assert.ok(bad.calls.includes('C:\\shim\\node.cmd'))
})
