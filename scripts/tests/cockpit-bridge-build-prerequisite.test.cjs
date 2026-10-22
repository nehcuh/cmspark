'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
const path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto')
const source = fs.readFileSync(path.join(__dirname, 'cockpit-bridge-build-prerequisite.cjs'), 'utf8')
const builder = fs.readFileSync(path.join(__dirname, '../build-cockpit-native-bridge.ps1'), 'utf8')
const names = ['binary', 'digest'].map(name => {
  const match = builder.match(new RegExp('\\$' + name + " = Join-Path \\$directory.FullName '([^']+)'"))
  assert.ok(match); return match[1]
})
function actual(fault = 'none') {
  const win = path.win32, root = 'C:\\owned\\cmspark-cockpit-build-one', files = new Map(), handles = new Map()
  let ino = 1, fd = 20, launches = 0, removed = false, closed = 0
  const stdout = [], stderr = [], calls = []
  function put(name, bytes, kind = 'file') { files.set(name, { bytes: Buffer.from(bytes), kind, ino: ino++, dev: 1, mtimeMs: 1, nlink: 1 }) }
  function stat(name) {
    const row = files.get(name); assert.ok(row, name)
    return { ...row, size: row.bytes.length, isFile: () => row.kind === 'file', isDirectory: () => row.kind === 'dir', isSymbolicLink: () => row.kind === 'link' }
  }
  put(root, '', 'dir')
  const io = {
    mkdtempSync: prefix => { assert.equal(prefix, 'C:\\owned\\cmspark-cockpit-build-'); return root },
    realpathSync: { native: name => name }, lstatSync: stat,
    mkdirSync: name => { assert.ok(name.startsWith(root + '\\')); put(name, '', 'dir') },
    openSync: (name, mode) => { assert.equal(mode, 'r'); stat(name); handles.set(++fd, name); return fd },
    fstatSync: n => stat(handles.get(n)), closeSync: n => { assert.ok(handles.delete(n)); closed++ },
    readSync: (n, buffer, offset, length, position) => {
      const name = handles.get(n), row = files.get(name)
      if (fault === 'changed-binary' && name.endsWith('.exe')) row.mtimeMs++
      if (fault === 'grown-digest' && name.endsWith('.sha256') && position === 0) row.bytes = Buffer.concat([row.bytes, Buffer.from('x')])
      if (fault === 'zero-read' && name.endsWith('.exe')) return 0
      const count = Math.min(length, Math.max(0, row.bytes.length - position)); row.bytes.copy(buffer, offset, position, position + count); return count
    },
    rmSync: (name, options) => { assert.equal(name, root); assert.equal(options.recursive, true); assert.equal(options.force, false); removed = true },
  }
  const spawnSync = (file, args, options) => {
    launches++; calls.push({ file, args: Array.from(args), options })
    if (args[3].endsWith('cockpit-bridge-build-completion.test.ps1')) {
      if (fault === 'control-error') return { error: Error('inert control spawn refusal'), status: null, signal: null }
      if (fault === 'control-unclosed') return { status: null, signal: 'SIGTERM' }
      return fault === 'control-failed' ? { status: 1, signal: null } : { status: 0, signal: null }
    }
    assert.ok(args[3].endsWith('build-cockpit-native-bridge.ps1'))
    const binary = win.join(root, 'bin', names[0]), digest = win.join(root, 'bin', names[1]), bytes = Buffer.from('inert compiler-output fixture; never executed')
    if (fault !== 'missing-binary') put(binary, bytes, fault === 'binary-link' ? 'link' : 'file')
    if (fault !== 'missing-digest') put(digest, crypto.createHash('sha256').update(bytes).digest('hex') + '\n', fault === 'digest-link' ? 'link' : 'file')
    if (fault === 'binary-hardlink') files.get(binary).nlink = 2
    if (fault === 'wrong-digest') files.get(digest).bytes = Buffer.from('0'.repeat(64) + '\n')
    if (fault === 'root-replaced') files.get(root).ino++
    return fault === 'spawn-error' ? { error: Error('inert spawn refusal'), status: null, signal: null }
      : { status: fault === 'compiler-failed' ? 1 : fault === 'unclosed-child' ? null : 0, signal: fault === 'unclosed-child' ? 'SIGTERM' : null }
  }
  const childEnv = require('./cockpit-bridge-child-env.cjs')
  const proc = { platform: fault === 'wrong-platform' ? 'linux' : 'win32', arch: 'x64',
    env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', SystemRoot: 'C:\\Windows', PROVIDER_KEY: 'inert-denied', HOME: 'inert-denied' },
    stdout: { write: x => stdout.push(x) }, stderr: { write: x => stderr.push(x) }, exitCode: undefined }
  const mod = { exports: {} }, imports = { 'node:assert/strict': assert, 'node:fs': io, 'node:path': win,
    'node:os': { tmpdir: () => 'C:\\owned' }, 'node:child_process': { spawnSync }, 'node:crypto': crypto,
    './cockpit-bridge-child-env.cjs': childEnv }
  const req = name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name] }; req.main = mod
  vm.runInNewContext(source, { require: req, module: mod, __dirname: 'C:\\repo\\scripts\\tests', process: proc, Buffer }, { timeout: 1000 })
  assert.equal(handles.size, 0)
  return { proc, stdout, stderr, calls, launches, removed, closed }
}
test('actual build prerequisite runs only the fixed PS5.1 builder and validates its owned output', () => {
  const r = actual(); assert.equal(r.proc.exitCode, undefined); assert.equal(r.launches, 2); assert.equal(r.removed, true)
  assert.deepEqual(r.stdout, ['COCKPIT_BRIDGE_FIXED_BUILD_COMPLETE\n']); assert.deepEqual(r.stderr, [])
  const control = r.calls[0]
  assert.deepEqual(control.args, ['-NoProfile', '-NonInteractive', '-File', 'C:\\repo\\scripts\\tests\\cockpit-bridge-build-completion.test.ps1', '-TestRoot', 'C:\\owned\\cmspark-cockpit-build-one\\compiler-controls'])
  const c = r.calls[1]; assert.equal(c.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.equal(control.file, c.file); assert.equal(control.options.env, c.options.env)
  assert.deepEqual(c.args, ['-NoProfile', '-NonInteractive', '-File', 'C:\\repo\\scripts\\build-cockpit-native-bridge.ps1', '-OutputDirectory', 'C:\\owned\\cmspark-cockpit-build-one\\bin'])
  assert.equal(c.options.stdio, 'inherit'); assert.equal(c.options.windowsHide, true); assert.equal(c.options.cwd, 'C:\\repo')
  for (const k of ['HOME', 'USERPROFILE', 'PROVIDER_KEY', 'HTTPS_PROXY', 'NODE_OPTIONS']) assert.equal(k in c.options.env, false)
  assert.equal(r.closed, 2)
})
for (const fault of ['compiler-failed', 'missing-binary', 'missing-digest', 'wrong-digest', 'binary-link', 'digest-link', 'binary-hardlink', 'changed-binary', 'grown-digest', 'zero-read']) test('actual build prerequisite refuses ' + fault, () => {
  const r = actual(fault); assert.equal(r.proc.exitCode, 1); assert.equal(r.launches, 2); assert.equal(r.removed, false)
  assert.deepEqual(r.stdout, []); assert.deepEqual(r.stderr, ['COCKPIT_BRIDGE_FIXED_BUILD_REFUSED\n'])
})
for (const fault of ['unclosed-child', 'spawn-error', 'root-replaced']) test('actual build prerequisite retains uncertain ownership/liveness: ' + fault, () => {
  const r = actual(fault); assert.equal(r.proc.exitCode, 1); assert.equal(r.launches, 2); assert.equal(r.removed, false)
})
test('actual compiler-control failure refuses before the product builder and retains scratch', () => {
  for (const fault of ['control-failed', 'control-error', 'control-unclosed']) {
    const r = actual(fault); assert.equal(r.proc.exitCode, 1); assert.equal(r.launches, 1); assert.equal(r.removed, false)
    assert.equal(r.closed, 0); assert.deepEqual(r.stdout, []); assert.deepEqual(r.stderr, ['COCKPIT_BRIDGE_FIXED_BUILD_REFUSED\n'])
  }
})
test('actual build prerequisite refuses non-Windows before allocating or launching', () => {
  const r = actual('wrong-platform'); assert.equal(r.proc.exitCode, 1); assert.equal(r.launches, 0); assert.equal(r.removed, false)
})
test('actual Windows workflow requires fixed builder before canonical and keeps scalar selection first', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n')
  const command = 'node scripts/tests/cockpit-bridge-build-prerequisite.cjs'
  assert.equal(workflow.split(command).length, 2)
  const at = workflow.indexOf(command)
  assert.ok(at > workflow.indexOf('& scripts/tests/cockpit-bridge-node-selection.test.ps1'))
  assert.ok(at < workflow.indexOf('Native Windows read-only Registry discovery (#644)'))
  assert.ok(at < workflow.indexOf('Complete Windows Companion census (#650)'))
  assert.ok(workflow.slice(at).startsWith(command + '\n          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n'))
})

// Source-consumer controls only. Actual PS5.1 parsing/compiler behavior is
// exercised by the required remote completion.test.ps1, never a JS interpreter.
function completionContract(build, registration, nativeControls) {
  for (const text of [build, registration]) assert.equal(text.includes('$LASTEXITCODE'), false)
  const owners = [[build, 'compileChild', 'compilerExitCode'], [registration, 'compileChild', 'framingCompilerExitCode'], [registration, 'framingChild', 'framingExitCode']]
  for (const [text, child, code] of owners) {
    const begin = text.indexOf(`if (-not $${child}.Start())`)
    const wait = text.indexOf(`$${child}.WaitForExit()`, begin), exit = text.indexOf(`$${code} = $${child}.ExitCode`, wait)
    const dispose = text.indexOf(`} finally { $${child}.Dispose() }`, exit)
    assert.ok(begin >= 0 && wait > begin && exit > wait && dispose > exit, child)
  }
  assert.ok(build.includes("$compileStart.UseShellExecute = $false"))
  assert.ok(registration.includes("$compileStart.UseShellExecute = $false"))
  assert.ok(registration.includes("$framingStart.UseShellExecute = $false"))
  assert.equal(/UseShellExecute\s*=\s*\$true/.test(build + registration), false)
  for (const text of [build, registration]) assert.ok(text.includes('[char[]]@([char]34, [char]0, [char]13, [char]10)'))
  assert.ok(build.includes("'/nologo /target:exe /platform:x64 /optimize+ /warn:4 /warnaserror+ /codepage:65001 /out:\"' + $binary + '\" \"' + $source + '\"'"))
  assert.ok(registration.includes("'/nologo /target:exe /platform:x64 /warn:4 /warnaserror+ /codepage:65001 /main:CMspark.CockpitBridge.FramingTests /out:\"' + $cpu + '\" \"' + $hostSource + '\" \"' + $framingSource + '\"'"))
  assert.ok(build.includes("$buildFailure.Data['CompilerExitCode'] = $compilerExitCode"))
  assert.ok(registration.includes('Check ($framingCompilerExitCode -eq 0)'))
  assert.ok(registration.includes('Check ($framingExitCode -eq 0)'))
  assert.ok(registration.includes('$framingChild.StandardOutput.ReadToEndAsync()'))
  assert.ok(nativeControls.includes("$controlCaught.Exception.Data['CompilerExitCode'] -isnot [int]"))
  assert.ok(nativeControls.includes("$controlCaught.Exception.Data['CompilerExitCode'] -eq 0"))
  assert.ok(nativeControls.includes('$compilerExitCode -isnot [int] -or $compilerExitCode -ne 0'))
  assert.ok(nativeControls.includes('$controlReply = . $controlBuilder -OutputDirectory $controlOutput'))
  assert.equal(/&\s*\$controlBinary|FileName\s*=\s*\$controlBinary/.test(nativeControls), false)
  assert.ok(nativeControls.includes('[char]0x4e2d + [char]0x6587'))
}
const registration = fs.readFileSync(path.join(__dirname, 'cockpit-bridge-registration.ps1'), 'utf8')
const nativeControls = fs.readFileSync(path.join(__dirname, 'cockpit-bridge-build-completion.test.ps1'), 'utf8')
test('actual three Process consumers and true numeric compiler controls retain their LF and CRLF contracts', () => {
  const inputs = [builder, registration, nativeControls].map(x => x.replaceAll('\r\n', '\n'))
  for (const ending of ['\n', '\r\n']) completionContract(...inputs.map(x => x.replaceAll('\n', ending)))
})
test('completion source controls reject missing wait/dispose, stale exit, weakened flags and fake numeric negatives', () => {
  const mutations = [
    [builder.replace('$compileChild.WaitForExit()', '# missing wait'), registration, nativeControls],
    [builder.replace('$compileChild.Dispose()', '# missing dispose'), registration, nativeControls],
    [builder.replace('$compilerExitCode = $compileChild.ExitCode', '$compilerExitCode = 0'), registration, nativeControls],
    [builder.replace('UseShellExecute = $false', 'UseShellExecute = $true'), registration, nativeControls],
    [builder.replace('/warnaserror+', '/warnaserror-'), registration, nativeControls],
    [builder.replace('[char]34, [char]0, [char]13, [char]10', '[char]34, [char]0'), registration, nativeControls],
    [builder, registration.replace('$framingExitCode = $framingChild.ExitCode', '$framingExitCode = $framingCompilerExitCode'), nativeControls],
    [builder, registration.replace('Check ($framingCompilerExitCode -eq 0)', 'Check ($true)'), nativeControls],
    [builder, registration, nativeControls.replace("$controlCaught.Exception.Data['CompilerExitCode'] -eq 0", '$false')],
  ]
  for (const values of mutations) assert.throws(() => completionContract(...values))
})

// Both /main targets are consumed by the actual first-identity controller.
// These are source contracts; only the required PS5.1 control compiles them.
const jobBuilder = fs.readFileSync(path.join(__dirname, 'build-cockpit-bridge-job.ps1'), 'utf8')
function jobCompletionContract(job, controls) {
  assert.equal(job.includes('$LASTEXITCODE'), false)
  assert.equal(/&\s*\$compiler/.test(job), false)
  const start = job.indexOf('if (-not $jobCompileChild.Start())')
  const wait = job.indexOf('$jobCompileChild.WaitForExit()', start)
  const exit = job.indexOf('$jobCompilerExitCode = $jobCompileChild.ExitCode', wait)
  const dispose = job.indexOf('} finally { $jobCompileChild.Dispose() }', exit)
  const result = job.indexOf('$jobCompilerResults += [pscustomobject]@{ Target = $item[0]; ExitCode = $jobCompilerExitCode }', dispose)
  assert.ok(start >= 0 && wait > start && exit > wait && dispose > exit && result > dispose)
  assert.ok(job.includes('$jobCompileStart.FileName = $compiler'))
  assert.ok(job.includes('$jobCompileStart.UseShellExecute = $false'))
  assert.equal(/UseShellExecute\s*=\s*\$true|RedirectStandard|EnvironmentVariables/.test(job), false)
  assert.ok(job.includes('[char[]]@([char]34, [char]0, [char]13, [char]10)'))
  assert.ok(job.includes("'/nologo /target:exe /platform:x64 /optimize+ /warn:4 /warnaserror+ /codepage:65001 /main:' + $item[1] + ' /out:\"' + $target + '\" \"' + $source + '\" \"' + $fixture + '\"'"))
  for (const [target, main] of [['cockpit-chrome-job.exe', 'ChromeJob'], ['cockpit-chrome-job-cpu.exe', 'ChromeJobCpu']]) {
    assert.ok(job.includes(`@('${target}', 'CMspark.CockpitBridge.TestOnly.${main}')`))
  }
  assert.ok(job.includes("$jobBuildFailure.Data['CompilerTarget'] = $item[0]"))
  assert.ok(job.includes("$jobBuildFailure.Data['CompilerExitCode'] = $jobCompilerExitCode"))
  assert.ok(controls.includes("@('actual', 'missing-first', 'missing-second')"))
  assert.ok(controls.includes('$jobControlReply = . $jobControlBuilder -OutputDirectory $jobControlOutput'))
  assert.ok(controls.includes('[IO.File]::WriteAllBytes($jobControlSource, $jobControlSourceBytes)'))
  assert.ok(controls.includes('[IO.File]::WriteAllBytes($jobControlCpu, $jobControlCpuBytes)'))
  assert.ok(controls.includes("if ($Case -ceq 'missing-first') { 'MissingMain' } else { 'Main' }"))
  assert.ok(controls.includes("if ($Case -ceq 'missing-second') { 'MissingMain' } else { 'Main' }"))
  assert.ok(controls.includes('$jobControlResult.ExitCode -isnot [int]'))
  assert.ok(controls.includes('$jobControlResult.ExitCode -ne 0'))
  assert.ok(controls.includes("$jobControlCaught.Exception.Data['CompilerTarget'] -cne $jobControlFailedTarget"))
  assert.ok(controls.includes("$jobControlCaught.Exception.Data['CompilerExitCode'] -isnot [int]"))
  assert.ok(controls.includes("$jobControlCaught.Exception.Data['CompilerExitCode'] -eq 0"))
  assert.ok(controls.includes("$jobCompilerResults[$jobControlCount - 1].ExitCode -ne $jobControlCaught.Exception.Data['CompilerExitCode']"))
  assert.equal(/&\s*\$jobControl|FileName\s*=\s*\$jobControl/.test(controls), false)
}
test('actual Job compiler loop and required controls bind both own exits with LF and CRLF', () => {
  const inputs = [jobBuilder, nativeControls].map(x => x.replaceAll('\r\n', '\n'))
  for (const ending of ['\n', '\r\n']) jobCompletionContract(...inputs.map(x => x.replaceAll('\n', ending)))
  const controller = fs.readFileSync(path.join(__dirname, 'cockpit-bridge-real-first.cjs'), 'utf8')
  const parent = fs.readFileSync(path.join(__dirname, 'cockpit-bridge-first-gate.cjs'), 'utf8')
  assert.ok(parent.includes("path.join(__dirname, 'build-cockpit-bridge-job.ps1')"))
  assert.ok(parent.indexOf('await preparedBuild.prepare(') < parent.lastIndexOf("'first-identity')"))
  assert.ok(controller.includes("require('./cockpit-bridge-prepared-build.cjs').stage({"))
  assert.ok(controller.indexOf("path.join(jobBuild, 'cockpit-chrome-job-cpu.exe')") > controller.indexOf("require('./cockpit-bridge-prepared-build.cjs').stage({"))
  assert.equal(controller.includes("runPs(path.join(sourceRepo, 'scripts/tests/build-cockpit-bridge-job.ps1')"), false)
})
test('Job completion source controls reject stale exits and either uncovered main target', () => {
  const mutations = [
    [jobBuilder.replace('$jobCompileChild.WaitForExit()', '# no wait'), nativeControls],
    [jobBuilder.replace('$jobCompileChild.Dispose()', '# no dispose'), nativeControls],
    [jobBuilder.replace('$jobCompilerExitCode = $jobCompileChild.ExitCode', '$jobCompilerExitCode = $LASTEXITCODE'), nativeControls],
    [jobBuilder.replace('/warnaserror+', '/warnaserror-'), nativeControls],
    [jobBuilder.replace("'CMspark.CockpitBridge.TestOnly.ChromeJobCpu'", "'CMspark.CockpitBridge.TestOnly.ChromeJob'"), nativeControls],
    [jobBuilder, nativeControls.replace("@('actual', 'missing-first', 'missing-second')", "@('actual', 'missing-first')")],
    [jobBuilder, nativeControls.replace("if ($Case -ceq 'missing-second') { 'MissingMain' } else { 'Main' }", "'Main'")],
    [jobBuilder, nativeControls.replace("$jobControlCaught.Exception.Data['CompilerExitCode'] -eq 0", '$false')],
    [jobBuilder, nativeControls.replace("$jobControlCaught.Exception.Data['CompilerTarget'] -cne $jobControlFailedTarget", '$false')],
    [jobBuilder, nativeControls.replace('[IO.File]::WriteAllBytes($jobControlCpu, $jobControlCpuBytes)', '# fake positive CPU')],
  ]
  for (const values of mutations) assert.throws(() => jobCompletionContract(...values))
})
