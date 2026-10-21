import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { PassThrough, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
const file = path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-first-gate.cjs')
const firstEvidence = require(path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-first-evidence.cjs'))
const text = fs.readFileSync(file, 'utf8'), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const functions = source.statements.filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'run')
assert.equal(functions.length, 1)
async function execute(code: number, signal: string | null) {
  const child = new EventEmitter(), calls: unknown[][] = [], closed: number[] = [], environment = Object.freeze({ ONLY_OWNED: 'yes' })
  const sandbox = { sequence: 0, raw: '/owned/raw', path,
    fs: { openSync: (...a: unknown[]) => { calls.push(['open', ...a]); return calls.length }, closeSync: (fd: number) => closed.push(fd) },
    cp: { spawn: (...a: unknown[]) => { calls.push(['spawn', ...a]); return child } },
  }
  const run = new vm.Script(`(${functions[0].getText(source)})`, { filename: file }).runInNewContext(sandbox)
  const promise = run('/fixed/node', ['/fixed/script'], '/owned/repo', environment, 'control')
  child.emit('exit', code, signal) // Actual run must keep waiting for stdio/close.
  assert.equal(closed.length, 0)
  child.emit('close', code, signal)
  let error: unknown; try { await promise } catch (value) { error = value }
  const spawn = calls.find(c => c[0] === 'spawn')!, options = spawn[3] as { env: unknown; cwd: string; stdio: unknown[] }
  assert.equal(options.env, environment); assert.equal(options.cwd, '/owned/repo'); assert.equal(options.stdio[0], 'ignore')
  assert.equal(closed.length, 2)
  return error
}
test('actual setup runner passes exact sanitized environment and waits for close', async () => { assert.equal(await execute(0, null), undefined) })
test('actual setup runner rejects natural failure and signal, retaining separate raw handles', async () => {
  assert.match(String(await execute(1, null)), /GATE_control_FAILED/)
  assert.match(String(await execute(0, 'SIGTERM')), /GATE_control_FAILED/)
})
test('actual runner observation receives close and cannot alter the original success predicate', async () => {
  for (const throws of [false, true]) {
    const child = new EventEmitter(), events: unknown[][] = [], closes: number[] = []
    const run = new vm.Script(`(${functions[0].getText(source)})`).runInNewContext({ sequence: 0, raw: '/owned/raw', path,
      fs: { openSync: () => 7 + closes.length, closeSync: (fd: number) => closes.push(fd) }, cp: { spawn: () => child } })
    const result = run('/fixed/node', [], '/owned', {}, 'control', (...args: unknown[]) => { events.push(args); if (throws) throw Error('OBSERVER_ONLY') })
    child.emit('exit', 0, null); assert.equal(events.length, 0); assert.equal(closes.length, 0)
    child.emit('close', 0, null); await result
    assert.deepEqual(events, [['close', 0, null]]); assert.equal(closes.length, 2)
  }
})
type EvidenceAPI = {
  runRecorded: (...args: unknown[]) => Promise<void>
  failure: () => Record<string, unknown> | undefined
  last: () => unknown
  parse: (text: unknown) => unknown
  describe: (...args: unknown[]) => Record<string, unknown>
}
function evidenceAPI(raw: string, spawn: (...args: unknown[]) => unknown, fileSystem: typeof fs = fs): EvidenceAPI {
  const begin = text.indexOf('// Failure evidence is observation only:'), end = text.indexOf('\nasync function main()', begin)
  assert.ok(begin > 0 && end > begin)
  return new vm.Script(`(()=>{${text.slice(begin, end)};return {runRecorded,failure:()=>firstFailure,last:()=>lastStep,parse:registrationEvidence,describe:failureEvidence}})()`)
    .runInNewContext({ firstEvidence, fs: fileSystem, path, Buffer, cp: { spawn }, sequence: 0, stage: 'registration-framing', raw }) as EvidenceAPI
}
async function recordedControl(code: number, stderr = '', spawnError?: unknown) {
  const raw = fs.mkdtempSync(path.join(process.env.CMSPARK_TEST_RUN_DIR!, 'first-evidence-')), child = new EventEmitter()
  const api = evidenceAPI(raw, (...args: unknown[]) => {
    const options = args[2] as { stdio: [string, number, number] }
    fs.writeSync(options.stdio[1], 'PRIVATE_BODY_NOT_PUBLIC\n')
    fs.writeSync(options.stdio[2], stderr)
    queueMicrotask(() => { if (spawnError !== undefined) child.emit('error', spawnError); else { child.emit('exit', code, null); child.emit('close', code, null) } })
    return child
  })
  let error: unknown
  try { await api.runRecorded('/fixed/node', [], '/owned', Object.freeze({}), 'registration-framing') } catch (value) { error = value }
  return { raw, api, error, child }
}
test('actual step failure preserves exit and only publishes closed numeric/code evidence', async () => {
  const payload = { v: 1, role: 'registration', line: 49, column: 3, check: 4, hresult: -1, reason: 'COCKPIT_BRIDGE_REGISTRATION_ASSERT' }
  const s = await recordedControl(7, 'PRIVATE_PATH_AND_BODY\nerror CS0165: PRIVATE_TEXT\nCOCKPIT_BRIDGE_FRAMING_FAILED checks=5\nCOCKPIT_BRIDGE_REGISTRATION_FAILURE ' + JSON.stringify(payload) + '\n')
  try {
    assert.match(String(s.error), /GATE_registration-framing_FAILED/)
    const value = s.api.failure()!
    assert.equal(value.kind, 'child_refused'); assert.equal(value.exitCode, 7); assert.equal(value.closeObserved, true)
    assert.equal(value.framingChecks, 5); assert.equal(JSON.stringify(value.registration), JSON.stringify(payload))
    assert.equal(JSON.stringify(value.compilerCodes), '["CS0165"]')
    const encoded = JSON.stringify(value)
    assert.ok(encoded.length <= 4096); assert.equal(/PRIVATE|\/fixed|\/owned/.test(encoded), false)
    assert.ok(!('text' in value) && !('error' in value))
  } finally { fs.rmSync(s.raw, { recursive: true }) }
})
test('successful child plus later controller assertion stays distinct from child failure', async () => {
  const s = await recordedControl(0)
  try {
    assert.equal(s.error, undefined); assert.equal(s.api.failure(), undefined)
    const value = s.api.describe('controller_refused', 'registration-framing', s.api.last())
    assert.equal(value.kind, 'controller_refused'); assert.equal(value.exitCode, 0); assert.equal(value.closeObserved, true)
    assert.equal(value.step, 'registration-framing')
  } finally { fs.rmSync(s.raw, { recursive: true }) }
})
test('spawn error is preserved without reading it and later close cannot rewrite first evidence', async () => {
  let traps = 0
  const opaque = new Proxy({}, { get() { traps++; throw Error('PRIVATE_GETTER') }, getPrototypeOf() { traps++; throw Error('PRIVATE_PROTOTYPE') } })
  const s = await recordedControl(0, '', opaque)
  try {
    assert.equal(s.error, opaque); assert.equal(traps, 0)
    const value = s.api.failure()!, before = JSON.stringify(value)
    assert.equal(value.spawnError, true); assert.equal(value.closeObserved, false); assert.equal(value.exitCode, null)
    s.child.emit('close', 0, null); assert.equal(JSON.stringify(s.api.failure()), before); assert.equal(traps, 0)
  } finally { fs.rmSync(s.raw, { recursive: true }) }
})
test('registration evidence requires exactly the actual closed seven-key canonical record', () => {
  const api = evidenceAPI('/unused', () => { throw Error('NO_CHILD') })
  const fixture = fs.readFileSync(path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-registration.ps1'), 'utf8').replaceAll('\r\n', '\n')
  // This is a source-derived CPU input, not a claim to execute PowerShell's serializer.
  const value = { v: 1, role: 'build', line: 1, column: 1, check: 0, hresult: -2147483648, reason: 'OTHER' }
  const producer = fixture.indexOf('$registrationFailureJson = ConvertTo-Json -Compress -InputObject ([ordered]@{'), end = fixture.indexOf('\n    })', producer)
  assert.ok(producer > 0 && end > producer)
  const fields = [...fixture.slice(producer + '$registrationFailureJson = ConvertTo-Json -Compress -InputObject ([ordered]@{'.length, end).matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s*=/g)].map(m => m[1])
  assert.deepEqual(fields, Object.keys(value))
  const prefix = 'COCKPIT_BRIDGE_REGISTRATION_FAILURE ', body = JSON.stringify(value)
  assert.equal(JSON.stringify(api.parse(prefix + body + '\r\n')), body)
  const bad = [body + ' ', body.replace('"v":1', '"v":1,"v":1'), JSON.stringify({ ...value, line: -1 }), JSON.stringify({ ...value, check: 100001 }), JSON.stringify({ ...value, hresult: 2147483648 }), JSON.stringify({ ...value, role: 'PRIVATE_PATH' }), JSON.stringify({ ...value, reason: 'COCKPIT_BRIDGE_INVENTED' }), JSON.stringify({ ...value, body: 'PRIVATE' })]
  for (const candidate of bad) assert.equal(api.parse(prefix + candidate + '\n'), null)
  assert.equal(api.parse(prefix + body + '\n' + prefix + body + '\n'), null)
  let touched = 0
  assert.equal(api.parse(new Proxy({}, { get() { touched++; throw Error('NO_READ') } })), null); assert.equal(touched, 0)
})
test('oversized or replaced observation files are unavailable and cannot change primary failure', async () => {
  const s = await recordedControl(9, 'x'.repeat(65537))
  try {
    const value = s.api.failure()!
    assert.equal(value.exitCode, 9); assert.equal(value.stderrBytes, 65537); assert.equal(value.detailsAvailable, false)
    assert.equal(value.registration, null); assert.equal(value.framingChecks, null)
    const file = path.join(s.raw, '1-registration-framing.stderr'), moved = file + '.owned'
    fs.writeFileSync(file, 'original')
    let swapped = false
    const fileSystem = { ...fs, openSync: ((name: fs.PathLike, flags: fs.OpenMode) => {
      if (name === file && !swapped) { swapped = true; fs.renameSync(file, moved); fs.writeFileSync(file, 'replacement') }
      return fs.openSync(name, flags)
    }) as typeof fs.openSync }
    try {
      const api = evidenceAPI(s.raw, () => { throw Error('NO_CHILD') }, fileSystem)
      const current = api.describe('controller_refused', 'PRIVATE_STAGE', { label: 'registration-framing', output: path.join(s.raw, '1-registration-framing.stdout'), error: file, state: { closed: true, spawnError: false, code: 9, signal: null } })
      assert.equal(swapped, true); assert.equal(current.stage, 'unknown'); assert.equal(current.detailsAvailable, false); assert.equal(current.stderrBytes, null)
      assert.equal(s.api.failure()!.exitCode, 9)
    } finally { if (swapped) { fs.unlinkSync(file); fs.renameSync(moved, file) } }
  } finally { fs.rmSync(s.raw, { recursive: true }) }
})
test('evidence remains byte bounded when a closed-child output file grows at the read boundary', () => {
  const raw = fs.mkdtempSync(path.join(process.env.CMSPARK_TEST_RUN_DIR!, 'growing-evidence-')), file = path.join(raw, 'growing'), empty = path.join(raw, 'empty')
  fs.writeFileSync(file, 'base'); fs.writeFileSync(empty, '')
  const fds = new Set<number>(); let grown = false, maximumRead = 0
  const grow = (fd: number) => { if (fds.has(fd) && !grown) { grown = true; fs.appendFileSync(file, 'x'.repeat(100000)) } }
  const fileSystem = { ...fs,
    openSync: ((name: fs.PathLike, flags: fs.OpenMode) => { const fd = fs.openSync(name, flags); if (name === file) fds.add(fd); else fds.delete(fd); return fd }) as typeof fs.openSync,
    readFileSync: ((name: fs.PathOrFileDescriptor, encoding: BufferEncoding) => { if (typeof name === 'number') grow(name); const data = fs.readFileSync(name, encoding); if (typeof name === 'number' && fds.has(name)) maximumRead = Math.max(maximumRead, Buffer.byteLength(data)); return data }) as typeof fs.readFileSync,
    readSync: ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) => { grow(fd); if (fds.has(fd)) maximumRead = Math.max(maximumRead, length); return fs.readSync(fd, buffer, offset, length, position) }) as typeof fs.readSync }
  try {
    const api = evidenceAPI(raw, () => { throw Error('NO_CHILD') }, fileSystem)
    const value = api.describe('child_refused', 'registration-framing', { label: 'registration-framing', output: empty, error: file, state: { closed: true, spawnError: false, code: 8, signal: null } })
    assert.equal(grown, true); assert.ok(maximumRead <= 65537, 'metadata check cannot authorize an unbounded whole-file read')
    assert.equal(value.exitCode, 8); assert.equal(value.stderrBytes, null); assert.equal(value.detailsAvailable, false)
  } finally { fs.rmSync(raw, { recursive: true }) }
})
test('evidence rejects a timestamp change actually observed by its final open-file stat', () => {
  for (const changed of [false, true]) {
    const raw = fs.mkdtempSync(path.join(process.env.CMSPARK_TEST_RUN_DIR!, 'final-stat-evidence-')), output = path.join(raw, 'out'), error = path.join(raw, 'err')
    fs.writeFileSync(output, ''); fs.writeFileSync(error, 'error CS0165: PUBLIC\n')
    const initial = fs.statSync(error), files = new Map<number, fs.PathLike>(), counts = new Map<number, number>()
    let observed: fs.Stats | undefined
    const fileSystem = { ...fs,
      openSync: ((name: fs.PathLike, flags: fs.OpenMode) => { const fd = fs.openSync(name, flags); files.set(fd, name); counts.set(fd, 0); return fd }) as typeof fs.openSync,
      fstatSync: ((fd: number) => {
        const count = (counts.get(fd) ?? 0) + 1; counts.set(fd, count)
        if (changed && files.get(fd) === error && count === 2) { fs.writeFileSync(error, 'error CS9999: PUBLIC\n'); fs.utimesSync(error, initial.atime, new Date(initial.mtimeMs + 10000)) }
        const stat = fs.fstatSync(fd); if (files.get(fd) === error && count === 2) observed = stat
        return stat
      }) as typeof fs.fstatSync }
    try {
      const api = evidenceAPI(raw, () => { throw Error('NO_CHILD') }, fileSystem)
      const value = api.describe('child_refused', 'registration-framing', { label: 'registration-framing', output, error, state: { closed: true, spawnError: false, code: 9, signal: null } })
      assert.equal(value.exitCode, 9); assert.equal(observed?.size, initial.size)
      if (changed) { assert.notEqual(observed?.mtimeMs, initial.mtimeMs); assert.equal(value.detailsAvailable, false); assert.equal(value.stderrBytes, null); assert.equal(JSON.stringify(value.compilerCodes), '[]') }
      else { assert.equal(value.detailsAvailable, true); assert.equal(JSON.stringify(value.compilerCodes), '["CS0165"]') }
    } finally { fs.rmSync(raw, { recursive: true }) }
  }
})
test('whole actual gate refuses the empty source pin before filesystem, process, or network effects', () => {
  const actualSupply = require(path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-browser-supply.cjs'))
  let effects = 0
  const deny = new Proxy({}, { get() { effects++; throw Error('FORBIDDEN_EFFECT') } })
  const modules: Record<string, unknown> = { 'node:assert/strict': assert, 'node:fs': deny, 'node:path': path, 'node:child_process': deny,
    './cockpit-bridge-first-evidence.cjs': firstEvidence, './cockpit-bridge-browser-supply.cjs': actualSupply, './cockpit-bridge-browser-admission.cjs': { version: 1, builds: [] } }
  assert.throws(() => new vm.Script(text, { filename: file }).runInNewContext({ require: (id: string) => { assert.ok(id in modules); return modules[id] }, process: { platform: 'win32', arch: 'x64', env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows' } } }), /SUPPLY_NOT_READY/)
  assert.equal(effects, 0)
})

const supplierFile = path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-browser-supply.cjs')
const supplierText = fs.readFileSync(supplierFile, 'utf8'), supplierAst = ts.createSourceFile(supplierFile, supplierText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const downloads = supplierAst.statements.filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'download')
assert.equal(downloads.length, 1)
async function httpControl(statusCode: number, length: string, expectedHash?: string, timeout = false) {
  const actual = require(supplierFile), bytes = Buffer.from('INERT_DOWNLOAD_BYTES'), root = fs.mkdtempSync(path.join(process.env.CMSPARK_TEST_RUN_DIR!, 'http-cpu-'))
  const pin = { kind: 'chrome-for-testing', platform: 'win64', version: '155.0.8059.84', source: 'https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.84/win64/chrome-win64.zip', archiveBytes: bytes.length, archiveSHA256: expectedHash ?? createHash('sha256').update(bytes).digest('hex'), executableSHA256: '0'.repeat(64) }
  let transfers = 0, scheduled: (() => void) | undefined, cleared = false
  const request = new EventEmitter() as EventEmitter & { destroy: (error?: Error) => void }
  request.destroy = (error?: Error) => { if (error) request.emit('error', error) }
  const response = Object.assign(new PassThrough(), { statusCode, headers: { 'content-length': length } })
  const sandbox = { fs, createHash, Transform, pipeline, selectPin: actual.selectPin, check: (value: unknown, reason: string) => { if (!value) throw Error('COCKPIT_BRIDGE_SUPPLY_' + reason) }, TRANSFER_MS: actual.TRANSFER_MS,
    setTimeout: (fn: () => void, ms: number) => { assert.equal(ms, 600000); scheduled = fn; return 1 }, clearTimeout: () => { cleared = true },
    https: { get(url: string, options: { agent: boolean; headers: unknown }, done: (response: unknown) => void) {
      transfers++; assert.equal(url, pin.source); assert.equal(options.agent, false)
      queueMicrotask(() => { if (timeout) scheduled!(); else { done(response); setImmediate(() => response.end(bytes)) } }); return request
    } },
  }
  const download = new vm.Script(`(${downloads[0].getText(supplierAst)})`, { filename: supplierFile }).runInNewContext(sandbox)
  const file = path.join(root, 'partial.zip'); let error: unknown
  try { await download(pin, file) } catch (value) { error = value }
  assert.equal(transfers, 1); assert.equal(cleared, true)
  return { error, file, bytes }
}
test('actual single-transfer producer accepts exact body and refuses redirect/length/hash mismatches', async () => {
  const good = await httpControl(200, '20'); assert.equal(good.error, undefined); assert.deepEqual(fs.readFileSync(good.file), good.bytes)
  assert.match(String((await httpControl(302, '20')).error), /SUPPLY_HTTP/)
  assert.match(String((await httpControl(200, '19')).error), /SUPPLY_HTTP/)
  assert.match(String((await httpControl(200, '20', '0'.repeat(64))).error), /ARCHIVE_HASH/)
})
test('actual independent transfer deadline destroys the sole request without retry', async () => {
  assert.match(String((await httpControl(200, '20', undefined, true)).error), /TRANSFER_DEADLINE/)
})

test('whole actual gate consumes the actual fixed source pin and preserves preparation/registration/controller order', async () => {
  const actualSupply = require(supplierFile), admission = require(path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-browser-admission.cjs'))
  const actualEnv = require(path.resolve(__dirname, '../../../scripts/tests/cockpit-bridge-child-env.cjs'))
  const pin = actualSupply.selectPin(admission), calls: { file: string; args: string[]; options: { env: Record<string, string>; cwd: string } }[] = [], stages: string[] = []
  const win = path.win32, repo = 'C:\\candidate', root = 'C:\\owned\\cmspark-test-run-controlled', output: string[] = []
  const modules: Record<string, unknown> = { 'node:assert/strict': assert, 'node:path': win,
    'node:fs': { lstatSync: () => ({ isSymbolicLink: () => false, isDirectory: () => true, isFile: () => true }), realpathSync: { native: (p: string) => win.resolve(p) },
      mkdirSync() {}, writeFileSync() {}, openSync: () => 1, closeSync() {}, readdirSync: () => [{ name: 'cockpit-bridge-controlled', isDirectory: () => true }], existsSync: () => true },
    'node:child_process': { spawn(file: string, args: string[], options: { env: Record<string, string>; cwd: string }) { calls.push({ file, args, options }); const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 0, null)); return child } },
    './cockpit-bridge-first-evidence.cjs': firstEvidence, './cockpit-bridge-browser-supply.cjs': { selectPin: actualSupply.selectPin,
      async download(selected: unknown) { assert.deepEqual(selected, pin); stages.push('fixed-download') },
      async extract() { stages.push('verified-extract'); return 'C:\\owned\\chrome.exe' } },
    './cockpit-bridge-browser-admission.cjs': admission, './cockpit-bridge-child-env.cjs': actualEnv,
  }
  const sandbox = { require: (id: string) => { assert.ok(id in modules); return modules[id] }, __dirname: win.join(repo, 'scripts/tests'), process: { platform: 'win32', arch: 'x64', execPath: 'C:\\node\\node.exe', env: { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', SystemRoot: 'C:\\Windows', CMSPARK_TEST_RUN_DIR: root, CMSPARK_DATA_DIR: win.join(root, 'data'), TEMP: win.join(root, 'temp') }, stdout: { write: (s: string) => output.push(s) }, stderr: { write: (s: string) => output.push(s) }, exitCode: 0 } }
  await new vm.Script(text, { filename: file }).runInNewContext(sandbox)
  assert.equal(sandbox.process.exitCode, 0); assert.deepEqual(stages, ['fixed-download', 'verified-extract'])
  assert.equal(calls.length, 6)
  assert.deepEqual(Array.from(calls[0].args.slice(1)), ['ci', '--registry=https://registry.npmjs.org/', '--no-audit', '--no-fund'])
  assert.deepEqual(Array.from(calls[1].args.slice(1)), ['run', 'build']); assert.deepEqual(Array.from(calls[2].args.slice(1)), ['-p', 'tsconfig.test.json'])
  assert.ok(calls[3].args[3].endsWith('cockpit-bridge-registration.ps1'))
  assert.ok(calls[4].args[2].endsWith('cockpit-bridge-document-receipt.cjs'))
  assert.ok(calls[5].args[2].endsWith('cockpit-bridge-real-first.cjs')); assert.equal(calls[5].args.length, 7)
  assert.equal(calls[5].args[4], pin.executableSHA256); assert.ok(calls[5].args[6].endsWith('companion\\.test-dist\\src'))
  for (const call of calls) { assert.equal('HOME' in call.options.env, false); assert.equal('USERPROFILE' in call.options.env, false); assert.equal('NODE_OPTIONS' in call.options.env, false); assert.equal('HTTPS_PROXY' in call.options.env, false) }
  assert.deepEqual(output, ['COCKPIT_BRIDGE_FIRST_IDENTITY_COMPLETE\n'])
  // These are inert child close events, not a Windows/Chrome/native-positive receipt.
})


test('actual PowerShell launcher bounds both scalar domains and runs the interpreter regression before canonical', () => {
  const root = path.resolve(__dirname, '../../..')
  const launcher = fs.readFileSync(path.join(root, 'scripts/tests/run-cockpit-bridge-first.ps1'), 'utf8').replace(/\r\n/g, '\n')
  const micro = fs.readFileSync(path.join(root, 'scripts/tests/cockpit-bridge-node-selection.test.ps1'), 'utf8').replace(/\r\n/g, '\n')
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n')
  for (const literal of ['@(Get-Command node.exe -CommandType Application -TotalCount 1 -ErrorAction Stop)', '$nodeCommands.Count -ne 1', '[System.Management.Automation.ApplicationInfo]', '$node -isnot [string]', '[IO.Path]::GetFullPath($node)', '@(Get-Item -LiteralPath $node -ErrorAction Stop)', '$nodeItems.Count -ne 1', '[IO.FileInfo]', '$nodeItem.PSIsContainer', '$nodeItem.Attributes -band [IO.FileAttributes]::ReparsePoint']) assert.ok(launcher.includes(literal), literal)
  assert.ok(launcher.indexOf('$nodeItems.Count -ne 1') < launcher.indexOf('$nodeItem.Attributes -band'))
  assert.equal(launcher.includes('Select-Object'), false)
  for (const literal of ['::ParseFile(', '$_.Right.FindAll(', '[scriptblock]::Create(', '. $selection', '-Commands @()', '@($realCommands[0], $realCommands[0])', '-Items @()', '@($realItems[0], $realItems[0])', '[IO.FileAttributes]::ReparsePoint', '-Items @($directory)', 'native_identity']) assert.ok(micro.includes(literal), literal)
  const early = workflow.indexOf('& scripts/tests/cockpit-bridge-node-selection.test.ps1')
  assert.ok(early > workflow.indexOf('Compile shared companion test inputs (#650)'))
  assert.ok(early < workflow.indexOf('Native Windows read-only Registry discovery (#644)'))
  const final = workflow.indexOf('& scripts/tests/run-cockpit-bridge-first.ps1')
  assert.ok(final > workflow.indexOf('Post-census isolated module-scope diagnostic (#650)'))
  assert.equal(workflow.split('& scripts/tests/run-cockpit-bridge-first.ps1').length, 2)
})
