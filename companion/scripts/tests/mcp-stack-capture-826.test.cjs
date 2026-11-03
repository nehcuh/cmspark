'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const c = require('../mcp-stack-capture-826.cjs')
// Grammar/control model only. This is NOT a vendor recording or Windows CDB
// evidence. The explicit Windows qualifier alone consumes actual CDB output.
const grammar = '   0  Id: 1a.2b Suspend: 1 Teb: 00000000`00001000 Unfrozen\r\n # Call Site\r\n00 ntdll!NtWaitForSingleObject+0x14\r\n01 kernelbase!WaitForSingleObjectEx\r\n\r\n'
const options = { root: 'C:\\owned\\case', binary: 'C:\\owned\\case\\mcp-snapshot-825\\cmspark-desktop.exe', outputRoot: 'C:\\owned\\out', parentPid: 42, createdAfterMs: 1000, createdBeforeMs: 2000 }
// Facts derive their names from the actual producer's explicit DTO, not CIM.
const factBody = c.QUERY_PS_826.match(/\[ordered\]@\{ pid=.*?live=\[bool\]\$live \}/s)[0]
const fields = [...factBody.matchAll(/(?:\{|;)\s*(\w+)=/g)].map(m => m[1])
const fact = values => Object.fromEntries(fields.map((name, i) => [name, values[i]]))
const native = () => fact([71, 42, options.binary, 1500, true])
const browser = () => fact([72, 71, 'C:\\WebView\\msedgewebview2.exe', 1600, true])
const okay = (stdout = grammar, stderr = '') => ({ ok: true, toolOutcome: 'OK', exitCode: 0, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) })
const failure = (stdout = '', stderr = '') => ({ ok: false, toolOutcome: 'ERROR', exitCode: null, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) })
function ports(overrides = {}) {
  const calls = [], state = { closed: 0, canonical: [], spawn: 0 }
  const io = { platform: 'win32', arch: 'x64', pid: 42, now: () => 3000,
    env: { SystemRoot: 'C:\\Windows', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', SECRET_TOKEN: 'private', _NT_SYMBOL_PATH: 'srv*https://private', TEMP: 'C:\\Temp' },
    tool: () => 'C:\\SDK\\cdb.exe', canonical(file) { state.canonical.push(file); return file },
    workspace: () => ({ directory: 'C:\\owned\\out\\work', symbols: 'C:\\owned\\out\\work\\symbols', close() { state.closed++ } }),
    async run(file, args, opts) { calls.push({ file, args, opts }); return file.endsWith('powershell.exe') ? okay(JSON.stringify({ rows: [native(), browser()] })) : okay() },
    spawn() { state.spawn++; const child = new EventEmitter(); child.pid = 91; child.send = value => { assert.equal(value, 'ping'); queueMicrotask(() => child.emit('message', 'pong')) }; child.kill = () => { queueMicrotask(() => child.emit('close', 0, null)); return true }; queueMicrotask(() => child.emit('message', 'ready')); return child }, ...overrides }
  return { io, calls, state }
}
function safe(value) {
  const text = JSON.stringify(value)
  assert.ok(Buffer.byteLength(text) <= c.JSON_CAP)
  assert.doesNotMatch(text, /private|owned|WebView|1a\.2b|00001000|"pid"|"parentPid"|executablePath|SECRET_TOKEN/)
  return value
}
test('actual PS producer DTO and bounded identity selector', () => {
  assert.deepEqual(fields, c.PROCESS_FIELDS)
  assert.doesNotMatch(c.QUERY_PS_826, /Get-AuthenticodeSignature|signed|SignerCertificate|cdb/)
  assert.match(c.QUERY_PS_826, /ConvertTo-Json[^\n]+\[ordered\]@\{ rows=@\(\$rows\) \}/)
  assert.match(c.QUERY_PS_826, /Name = 'cmspark-desktop.exe'/)
  assert.match(c.QUERY_PS_826, /Select-Object -First 2/g)
  assert.doesNotMatch(c.QUERY_PS_826, /CommandLine|WindowTitle|Get-ChildItem|Invoke-WebRequest/)
  assert.deepEqual(c.selectOwnedTargets826([native(), browser()], options), { native: 71, browser: 72 })
  for (const mutate of [r => { r.parentPid++ }, r => { r.executablePath = 'C:\\other\\cmspark-desktop.exe' }, r => { r.createdMs = 999 }, r => { r.createdMs = 2001 }, r => { r.live = false }, r => { r.extra = true }]) {
    const row = native(); mutate(row); assert.equal(c.selectOwnedTargets826([row, browser()], options).native, null)
  }
  for (const rows of [[], [native(), native()], [native(), browser(), browser()]]) {
    const result = c.selectOwnedTargets826(rows, options)
    assert.equal(rows.length === 3 ? result.browser : result.native, null)
  }
  for (const mutate of [r => { r.parentPid++ }, r => { r.live = false }, r => { r.executablePath = 'C:\\WebView\\other.exe' }, r => { r.createdMs = 1499 }]) {
    const row = browser(); mutate(row); assert.deepEqual(c.selectOwnedTargets826([native(), row], options), { native: 71, browser: null })
  }
  // Selector receives canonical paths. Case folding cannot invent identity.
  assert.equal(c.selectOwnedTargets826([{ ...native(), executablePath: options.binary.toUpperCase() }], options).native, null)
})
test('actual clean-stack projection admits bounded symbols and strips private fields', () => {
  const result = safe(c.projectCdbStacks826(grammar))
  assert.equal(result.status, 'OBSERVED'); assert.deepEqual(result.threads[0], { ordinal: 0, frames: [{ module: 'ntdll', function: 'NtWaitForSingleObject' }, { module: 'kernelbase', function: 'WaitForSingleObjectEx' }] })
  assert.equal(c.qualifyProjection826(Buffer.from(grammar), Buffer.alloc(0)), true)
  assert.deepEqual(c.admitSymbol826('winhttp!WinHttpWebSocketSend+0x14'), { module: 'winhttp', function: 'WinHttpWebSocketSend' })
  assert.equal(c.projectCdbStacks826(grammar.replace('ntdll!NtWaitForSingleObject+0x14', 'winhttp!WinHttpWebSocketSend+0x14')).threads[0].frames[0].module, 'winhttp')
  for (const text of ['', 'private pid=12', ' # Call Site\nntdll!NtWaitForSingleObject', grammar.split('\r\n').slice(0, 2).join('\n'), grammar.replace(/ntdll!.*|kernelbase!.*/g, '00007ffb`12345678'), 'register rax=123', Buffer.alloc(c.RAW_CAP + 1)]) assert.equal(safe(c.projectCdbStacks826(text)).status, 'UNKNOWN')
  for (const token of ['private!Secret', 'ntdll!f(123)', 'C:\\private\\ntdll!f', 'ntdll!0x1234', 'ntdll!f arg=secret', 'ntdll!' + 'f'.repeat(300)]) assert.equal(c.admitSymbol826(token), null)
  assert.equal(safe(c.projectCdbStacks826(grammar.replace('01 kernelbase!WaitForSingleObjectEx', '01 private!Secret'))).status, 'INCOMPLETE')
  assert.equal(safe(c.projectCdbStacks826(grammar, 'private error')).status, 'INCOMPLETE')
  assert.equal(c.projectCdbStacks826(grammar.trimEnd()).status, 'INCOMPLETE')
  const sixteen = grammar.split('\r\n').slice(0, 2).join('\n') + '\n' + Array.from({ length: 17 }, () => 'ntdll!NtWaitForSingleObject').join('\n')
  assert.equal(c.projectCdbStacks826(sixteen).threads[0].frames.length, 16); assert.equal(c.projectCdbStacks826(sixteen).status, 'INCOMPLETE')
  const many = c.projectCdbStacks826(grammar.repeat(34)); assert.equal(many.threads.length, 32); assert.equal(many.status, 'INCOMPLETE')
})
test('actual collector calls one query and hybrid CDB with finite local environment', async () => {
  const { io, calls, state } = ports(); const result = safe(await c.collectMcpStacks826(options, io))
  assert.equal(result.status, 'OBSERVED'); assert.equal(state.closed, 1); assert.equal(calls.length, 3)
  assert.equal(calls[0].opts.timeoutMs, 3000)
  assert.equal(Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le'), c.QUERY_PS_826)
  assert.deepEqual(JSON.parse(calls[0].opts.env.CMSPARK_STACK_BINDING_826), { binary: options.binary, parentPid: 42, createdAfterMs: 1000, createdBeforeMs: 2000 })
  assert.deepEqual(calls[1].args, ['-pv', '-p', '71', '-c', '~*kc 0n16;qd'])
  assert.deepEqual(calls[2].args, ['-pvr', '-p', '72', '-c', '~*kc 0n16;qd'])
  for (const call of calls) { assert.equal(call.opts.cwd, 'C:\\owned\\out\\work'); assert.equal(call.opts.env.SECRET_TOKEN, undefined); assert.equal(call.opts.env._NT_SYMBOL_PATH, 'C:\\owned\\out\\work\\symbols'); assert.doesNotMatch(JSON.stringify(call.opts.env), /https:|srv\*/); if (call.file.endsWith('cdb.exe')) assert.equal(call.opts.timeoutMs, 6000) }
  assert.deepEqual(state.canonical, [options.binary, options.binary])
})
test('native canonical domain handles supported short/long names and fails closed', async () => {
  const short = { ...options, root: 'C:\\OWNED~1\\case', binary: 'C:\\OWNED~1\\case\\mcp-snapshot-825\\cmspark-desktop.exe' }
  const p = ports(); p.io.canonical = () => options.binary
  assert.equal((await c.collectMcpStacks826(short, p.io)).status, 'OBSERVED')
  const mismatch = ports(); let count = 0; mismatch.io.canonical = file => ++count === 1 ? file : 'C:\\other\\cmspark-desktop.exe'
  assert.equal((await c.collectMcpStacks826(options, mismatch.io)).status, 'UNKNOWN'); assert.equal(mismatch.calls.length, 1)
  const broken = ports({ canonical() { throw Error('private path') } }); assert.equal(safe(await c.collectMcpStacks826(options, broken.io)).status, 'UNKNOWN'); assert.equal(broken.calls.length, 1)
})
test('query/tool/ambiguity failures never attach unrelated targets or leak errors', async () => {
  for (const rows of [[], [native(), native()], [{ ...native(), live: false }], [{ ...native(), executablePath: 'C:\\other\\cmspark-desktop.exe' }]]) {
    const p = ports(); p.io.run = async (...args) => { p.calls.push(args); return okay(JSON.stringify({ rows })) }; assert.equal(safe(await c.collectMcpStacks826(options, p.io)).status, 'UNKNOWN'); assert.equal(p.calls.length, 1); assert.equal(p.state.closed, 1)
  }
  for (const response of [failure('', 'private'), okay('private malformed'), okay(JSON.stringify({ signed: false, rows: [native()] })), okay(JSON.stringify({ rows: [native()], extra: true })), okay(JSON.stringify({ rows: null }))]) {
    const p = ports({ run: async () => response }); assert.equal(safe(await c.collectMcpStacks826(options, p.io)).status, 'UNKNOWN'); assert.equal(p.state.closed, 1)
  }
  for (const response of [failure('private'), okay(Buffer.alloc(c.RAW_CAP + 1)), okay('unresolved')]) {
    const p = ports(); const base = p.io.run; p.io.run = (...args) => args[0].endsWith('cdb.exe') ? (p.calls.push({ args }), response) : base(...args)
    const result = safe(await c.collectMcpStacks826(options, p.io)); assert.equal(result.targets[1].status, 'SKIPPED'); assert.equal(p.calls.length, 2)
  }
  const thrown = ports({ tool() { throw Error('private secret tool') } }); assert.equal(safe(await c.collectMcpStacks826(options, thrown.io)).status, 'UNKNOWN')
  for (const changed of [{ parentPid: 7 }, { binary: 'C:\\other.exe' }, { createdBeforeMs: 4000 }, { createdAfterMs: -1 }]) { const p = ports(); assert.equal((await c.collectMcpStacks826({ ...options, ...changed }, p.io)).status, 'UNKNOWN'); assert.equal(p.calls.length, 0) }
})
test('actual bounded child runner enforces combined cap, close status, expiry and kill', async () => {
  async function run(mode) { let killed = 0; const opts = { timeoutMs: 8, cwd: 'owned', env: {} }; const result = await c.runBounded826('tool', [], opts, (_file, _args, childOpts) => { assert.deepEqual(childOpts.stdio, ['ignore', 'pipe', 'pipe']); const child = new EventEmitter(); child.pid = 91; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { killed++; queueMicrotask(() => child.emit('close', 1, null)) }; queueMicrotask(() => { if (mode === 'expiry') return; if (mode === 'error') return child.emit('error', Error('private')); child.stdout.emit('data', Buffer.from(mode === 'overflow' ? 'x'.repeat(c.RAW_CAP) : 'out')); child.stderr.emit('data', Buffer.from('err')); if (mode !== 'overflow') child.emit('close', mode === 'badstatus' ? 2 : 0, null) }); return child }); return { result, killed } }
  const good = await run('good'); assert.equal(good.result.ok, true); assert.equal(good.result.stdout.toString(), 'out')
  for (const mode of ['overflow', 'error', 'expiry', 'badstatus']) { const value = await run(mode); assert.equal(value.result.ok, false); if (mode !== 'badstatus') { assert.equal(value.killed, 1); assert.equal(value.result.stdout.length, 0) } }
  const failed = await c.runBounded826('tool', [], { timeoutMs: 8 }, () => { throw Error('private') }); assert.equal(failed.ok, false)
})
test('expired/overflowed actual runner holds its result and collector workspace until tool close', async () => {
  for (const mode of ['expiry', 'overflow']) {
    let child, kills = 0, resolved = false
    const promise = c.runBounded826('tool', [], { timeoutMs: 8, cwd: 'owned', env: {} }, () => {
      child = new EventEmitter(); child.pid = 91; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { kills++ }
      if (mode === 'overflow') queueMicrotask(() => child.stdout.emit('data', Buffer.alloc(c.RAW_CAP + 1)))
      return child
    }).then(value => { resolved = true; return value })
    await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(kills, 1); assert.equal(resolved, false)
    child.emit('close', null, 'SIGTERM'); assert.equal((await promise).ok, false); assert.equal(resolved, true)
  }
  const p = ports(); const base = p.io.run; let release
  p.io.run = (...args) => args[0].endsWith('cdb.exe') ? new Promise(resolve => { release = () => resolve(failure()) }) : base(...args)
  const collected = c.collectMcpStacks826(options, p.io)
  await new Promise(resolve => setImmediate(resolve)); assert.equal(p.state.closed, 0)
  release(); const result = await collected; assert.equal(result.targets[1].status, 'SKIPPED'); assert.equal(p.state.closed, 1)
})
test('qualifier controlled leaves prove actual parser wiring, detach ping and actual close fence', async () => {
  const p = ports(); const result = safe(await c.qualifyCdb826({ outputRoot: options.outputRoot }, p.io))
  assert.deepEqual(result, { schema: 1, status: 'OBSERVED', stoppedAt: 'COMPLETE', toolOutcome: 'OK', exitCode: 0, parserPositive: true, actualDetached: true, dummyClosed: true })
  assert.equal(p.state.closed, 1); assert.equal(p.state.spawn, 1); assert.equal(p.calls.length, 1)
  assert.deepEqual(p.calls[0].args, ['-pv', '-p', '91', '-c', c.COMMAND]); assert.equal(p.calls[0].opts.timeoutMs, 120000)
  const noParse = ports(); const base = noParse.io.run; noParse.io.run = (...args) => args[0].endsWith('cdb.exe') ? okay('private unknown format') : base(...args)
  assert.deepEqual(safe(await c.qualifyCdb826({ outputRoot: options.outputRoot }, noParse.io)), { schema: 1, status: 'UNKNOWN', stoppedAt: 'PARSER', toolOutcome: 'OK', exitCode: 0, parserPositive: false, actualDetached: false, dummyClosed: true })
  const noTool = ports({ tool() { throw Error('private') } }); assert.equal((await c.qualifyCdb826({ outputRoot: options.outputRoot }, noTool.io)).status, 'UNKNOWN'); assert.equal(noTool.state.spawn, 0)
})
test('unsupported platform and absent explicit options perform zero tool/native work', async () => {
  const p = ports({ platform: 'darwin', tool() { throw Error('must not call') } })
  assert.equal((await c.qualifyCdb826({ outputRoot: options.outputRoot }, p.io)).status, 'UNKNOWN'); assert.equal((await c.collectMcpStacks826(options, p.io)).status, 'UNKNOWN'); assert.equal(p.calls.length, 0)
  assert.equal((await c.qualifyCdb826()).status, 'UNKNOWN'); assert.equal((await c.collectMcpStacks826()).status, 'UNKNOWN')
})
test('qualifier CDB failure awaits actual dummy close despite kill and actual-process error', async () => {
  const p = ports(); const base = p.io.run; let dummy, kills = 0, settled = false
  p.io.run = (...args) => args[0].endsWith('cdb.exe') ? failure() : base(...args)
  p.io.spawn = () => {
    dummy = new EventEmitter(); dummy.pid = 91; dummy.kill = () => { kills++; queueMicrotask(() => dummy.emit('error', Error('private actual process error'))) }
    queueMicrotask(() => dummy.emit('message', 'ready')); return dummy
  }
  const pending = c.qualifyCdb826({ outputRoot: options.outputRoot }, p.io).then(value => { settled = true; return value })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(kills, 1); assert.equal(settled, false); assert.equal(p.state.closed, 0)
  dummy.emit('close', 1, null)
  assert.deepEqual(safe(await pending), { schema: 1, status: 'UNKNOWN', stoppedAt: 'CDB', toolOutcome: 'ERROR', exitCode: null, parserPositive: false, actualDetached: false, dummyClosed: true })
  assert.equal(p.state.closed, 1)
})
test('qualifier failed spawn without PID remains UNKNOWN and does not wait for nonexistent process', async () => {
  const p = ports(); p.io.spawn = () => { const dummy = new EventEmitter(); dummy.kill = () => {}; queueMicrotask(() => dummy.emit('error', Error('private spawn error'))); return dummy }
  assert.deepEqual(safe(await c.qualifyCdb826({ outputRoot: options.outputRoot }, p.io)), { schema: 1, status: 'UNKNOWN', stoppedAt: 'DUMMY_READY', toolOutcome: 'NOT_RUN', exitCode: null, parserPositive: false, actualDetached: false, dummyClosed: false })
  assert.equal(p.state.closed, 1); assert.equal(p.calls.length, 0)
})
test('qualifier cannot return at the former 3s teardown race while dummy close is held', async () => {
  const p = ports(); const base = p.io.run; let dummy, settled = false
  p.io.run = (...args) => args[0].endsWith('cdb.exe') ? failure() : base(...args)
  p.io.spawn = () => { dummy = new EventEmitter(); dummy.pid = 91; dummy.kill = () => {}; queueMicrotask(() => dummy.emit('message', 'ready')); return dummy }
  const pending = c.qualifyCdb826({ outputRoot: options.outputRoot }, p.io).then(value => { settled = true; return value })
  // Exercise the former actual 3000ms race, not an invented shorter analogue.
  await new Promise(resolve => setTimeout(resolve, 3100))
  assert.equal(settled, false); assert.equal(p.state.closed, 0)
  dummy.emit('close', 1, null); assert.equal((await pending).dummyClosed, true); assert.equal(p.state.closed, 1)
})
test('actual fixed SDK resolver trusts a regular managed tool without PE or signature prerequisites', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../mcp-stack-capture-826.cjs'), 'utf8')
  const module = { exports: {} }; let kind = 'regular', stats = 0, opens = 0
  const fsPort = { realpathSync: { native() {} }, lstatSync(file) {
    stats++; assert.equal(file, 'C:\\Program Files (x86)\\Windows Kits\\10\\Debuggers\\x64\\cdb.exe')
    if (kind === 'missing') throw Error('private missing tool')
    return { isFile: () => kind !== 'directory', isSymbolicLink: () => kind === 'link' }
  }, openSync() { opens++; throw Error('unexpected PE read') } }
  vm.runInNewContext(source + '\nmodule.exports.resolveForControl826=resolveCdb826;', { module, exports: module.exports, require: name => name === 'node:fs' ? fsPort : require(name), process, Buffer, Set, Promise, Date, setTimeout, clearTimeout })
  const p = ports({ tool: module.exports.resolveForControl826 }), run = p.io.run
  p.io.run = (...args) => { assert.ok(!args[0].endsWith('powershell.exe'), 'no pre-dummy signature/OS prerequisite'); return run(...args) }
  assert.equal(safe(await c.qualifyCdb826({ outputRoot: options.outputRoot }, p.io)).stoppedAt, 'COMPLETE')
  assert.equal(stats, 1); assert.equal(opens, 0); assert.equal(p.calls.length, 1)
  for (kind of ['missing', 'directory', 'link']) {
    const refused = ports({ tool: module.exports.resolveForControl826 })
    const result = safe(await c.qualifyCdb826({ outputRoot: options.outputRoot }, refused.io))
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.stoppedAt, 'TOOL'); assert.equal(refused.state.spawn, 0); assert.equal(refused.calls.length, 0)
  }
})
test('qualification returns only nine fixed stages and preserves the first failure through cleanup', async () => {
  const seen = new Set(), observe = async io => { const result = safe(await c.qualifyCdb826({ outputRoot: options.outputRoot }, io)); seen.add(result.stoppedAt); return result }
  assert.equal((await observe(ports({ platform: 'darwin' }).io)).stoppedAt, 'INPUT')
  assert.equal((await observe(ports({ tool() { throw Error('private tool') } }).io)).stoppedAt, 'TOOL')
  assert.equal((await observe(ports({ workspace() { throw Error('private workspace') } }).io)).stoppedAt, 'WORKSPACE')
  assert.equal((await observe(ports({ spawn() { throw Error('private spawn') } }).io)).stoppedAt, 'DUMMY_READY')
  for (const run of [async () => failure(), async () => { throw Error('private CDB') }]) {
    const p = ports({ run }); p.io.workspace = () => ({ directory: 'C:\\owned', symbols: 'C:\\owned\\symbols', close() { throw Error('private later cleanup') } })
    const result = await observe(p.io); assert.equal(result.stoppedAt, 'CDB'); assert.equal(result.dummyClosed, true)
  }
  assert.equal((await observe(ports({ run: async () => okay('unknown private wire') }).io)).stoppedAt, 'PARSER')
  const detached = ports(), spawn = detached.io.spawn
  detached.io.spawn = (...args) => { const child = spawn(...args); child.send = () => queueMicrotask(() => child.emit('close', 0, null)); return child }
  const noPong = await observe(detached.io); assert.equal(noPong.stoppedAt, 'DETACH'); assert.equal(noPong.actualDetached, false); assert.equal(noPong.dummyClosed, true)
  const closing = ports(); closing.io.workspace = () => ({ directory: 'C:\\owned', symbols: 'C:\\owned\\symbols', close() { throw Error('private close') } })
  const closeFailed = await observe(closing.io); assert.equal(closeFailed.stoppedAt, 'CLOSE'); assert.equal(closeFailed.status, 'UNKNOWN'); assert.equal(closeFailed.dummyClosed, true)
  assert.equal((await observe(ports().io)).stoppedAt, 'COMPLETE')
  assert.deepEqual([...seen].sort(), ['INPUT', 'TOOL', 'WORKSPACE', 'DUMMY_READY', 'CDB', 'PARSER', 'DETACH', 'CLOSE', 'COMPLETE'].sort())
})
test('actual bounded producer reports six closed outcomes and only actual close exit codes', async () => {
  async function produce(mode) {
    return c.runBounded826('owned-tool', [], { timeoutMs: 8, cwd: 'owned', env: {} }, () => {
      const child = new EventEmitter(); if (mode !== 'spawn-error') child.pid = 91
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.kill = () => queueMicrotask(() => { if (mode !== 'error') child.emit('error', Error('private later error')); child.emit('close', mode === 'error' ? 17 : 0, null) })
      queueMicrotask(() => {
        if (mode === 'timeout') return
        if (mode === 'spawn-error' || mode === 'error') return child.emit('error', Object.assign(Error('private first error'), { code: 123 }))
        if (mode === 'overflow') return child.stdout.emit('data', Buffer.alloc(c.RAW_CAP + 1))
        child.stdout.emit('data', Buffer.from(grammar))
        child.emit('close', mode === 'nonzero' ? 17 : mode === 'signal' ? null : mode === 'bad-code' ? 'private' : 0, mode === 'signal' ? 'PRIVATE_SIGNAL' : null)
      }); return child
    })
  }
  const positive = await produce('ok'); assert.deepEqual(positive, okay())
  const spawnFailure = await produce('spawn-error'); assert.deepEqual(spawnFailure, failure())
  for (const [mode, outcome, exitCode] of [['timeout', 'TIMEOUT', 0], ['overflow', 'OUTPUT_LIMIT', 0], ['error', 'ERROR', 17], ['nonzero', 'NONZERO_EXIT', 17], ['signal', 'SIGNALLED', null], ['bad-code', 'NONZERO_EXIT', null]]) {
    const result = await produce(mode); assert.equal(result.ok, false); assert.equal(result.toolOutcome, outcome); assert.equal(result.exitCode, exitCode)
    assert.deepEqual(Object.keys(result).sort(), Object.keys(positive).sort())
    assert.doesNotMatch(JSON.stringify({ toolOutcome: result.toolOutcome, exitCode: result.exitCode }), /private|PRIVATE_SIGNAL|123/)
  }
})
test('first timeout outcome and actual-close code survive later error without early resolution', async () => {
  let child, settled = false, kills = 0
  const pending = c.runBounded826('owned-tool', [], { timeoutMs: 8 }, () => {
    child = new EventEmitter(); child.pid = 91; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { kills++ }; return child
  }).then(result => { settled = true; return result })
  await new Promise(resolve => setTimeout(resolve, 15)); child.emit('error', Error('private after-timeout'))
  assert.equal(settled, false); assert.equal(kills, 1)
  child.emit('close', 0, null); const result = await pending
  assert.equal(result.ok, false); assert.equal(result.toolOutcome, 'TIMEOUT'); assert.equal(result.exitCode, 0)
})
test('CPU qualifier consumes actual producer metadata with only its new 120s preparation window', async () => {
  const p = ports(); p.io.run = (file, args, opts) => {
    p.calls.push({ file, args, opts }); assert.equal(opts.timeoutMs, 120000); assert.ok(file.endsWith('cdb.exe'))
    return c.runBounded826(file, args, opts, () => {
      const child = new EventEmitter(); child.pid = 92; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {}
      queueMicrotask(() => { child.stdout.emit('data', Buffer.from(grammar)); child.emit('close', 0, null) }); return child
    }).then(result => ({ ...result, privateExtra: 'private unparsed body' }))
  }
  const result = safe(await c.qualifyCdb826({ outputRoot: options.outputRoot }, p.io))
  assert.deepEqual(result, { schema: 1, status: 'OBSERVED', stoppedAt: 'COMPLETE', toolOutcome: 'OK', exitCode: 0, parserPositive: true, actualDetached: true, dummyClosed: true })
  assert.equal(p.calls.length, 1)
  const early = await c.qualifyCdb826(); assert.equal(early.toolOutcome, 'NOT_RUN'); assert.equal(early.exitCode, null)
  assert.deepEqual(Object.keys(early).sort(), Object.keys(result).sort())
})
