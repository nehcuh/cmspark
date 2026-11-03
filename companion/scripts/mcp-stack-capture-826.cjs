// Unshipped, explicit one-off diagnostic. Never imported by production code.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const RAW_CAP = 512 * 1024, JSON_CAP = 64 * 1024
const COMMAND = '~*kc 0n16;qd'
const PROCESS_FIELDS = Object.freeze(['pid', 'parentPid', 'executablePath', 'createdMs', 'live'])
const MODULES = new Set(['ntdll', 'kernelbase', 'kernel32', 'user32', 'win32u', 'winhttp', 'combase', 'ole32', 'rpcrt4', 'ucrtbase', 'msvcp140', 'vcruntime140', 'vcruntime140_1', 'node', 'cmspark-desktop', 'cmspark_desktop', 'msedgewebview2', 'msedge', 'msedge_elf', 'embeddedbrowserwebview', 'webview2loader', 'webview2loaderstatic', 'oleacc', 'uiautomationcore'])
const unknownStack = () => ({ status: 'UNKNOWN', threads: [] })
const target = (kind, status = 'UNKNOWN') => ({ kind, status, threads: [] })
const unknown = () => ({ schema: 1, status: 'UNKNOWN', targets: [target('native'), target('browser', 'SKIPPED')] })
const qualification = () => ({ schema: 1, status: 'UNKNOWN', parserPositive: false, actualDetached: false, dummyClosed: false })
const integer = n => Number.isSafeInteger(n) && n > 0
const windowsPath = value => typeof value === 'string' && value.length <= 32767 && !/[\0\r\n]/.test(value) && /^[a-z]:\\/i.test(value)
const samePath = (a, b) => windowsPath(a) && windowsPath(b) && path.win32.normalize(a) === path.win32.normalize(b)

function admitSymbol826(value) {
  if (typeof value !== 'string' || value.length > 280) return null
  const match = /^([A-Za-z0-9_-]{1,64})!([A-Za-z_?$@~][A-Za-z0-9_?$@:.~<>-]{0,159})(?:\+0x[0-9a-f]+)?$/i.exec(value)
  if (!match || !MODULES.has(match[1].toLowerCase())) return null
  return { module: match[1].toLowerCase(), function: match[2] }
}

// Documented kc clean frames only. Real CDB output is qualified on Windows
// before MCP. Unknown headers/frames are never promoted into symbol evidence.
function projectCdbStacks826(stdout, stderr = Buffer.alloc(0)) {
  try {
    const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout), err = Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr)
    if (out.length + err.length > RAW_CAP || out.includes(0)) return unknownStack()
    const threads = []; let current, frames = false, incomplete = err.length > 0 || !out.toString('utf8').endsWith('\n')
    for (const line of out.toString('utf8').split(/\r?\n/)) {
      if (/^\s*[.#*]?\s*\d+\s+Id:\s+[0-9a-f]+\.[0-9a-f]+\s+Suspend:\s+\d+\s+Teb:\s+[0-9a-f`]+\s+(?:Unfrozen|Frozen)\s*$/i.test(line)) {
        if (threads.length >= 32) { incomplete = true; break }
        current = { ordinal: threads.length, frames: [] }; threads.push(current); frames = false; continue
      }
      if (/^\s*#?\s*Call Site\s*$/.test(line)) { if (current) frames = true; continue }
      if (!line.trim()) { frames = false; continue }
      if (!current || !frames) continue
      const frame = admitSymbol826(line.trim().replace(/^[0-9a-f]{1,2}\s+/i, ''))
      if (!frame) { incomplete = true; continue }
      if (current.frames.length >= 16) { incomplete = true; continue }
      current.frames.push(frame)
    }
    if (!threads.some(row => row.frames.length)) return unknownStack()
    if (threads.some(row => !row.frames.length || row.frames.length === 16)) incomplete = true
    const result = { status: incomplete ? 'INCOMPLETE' : 'OBSERVED', threads }
    return Buffer.byteLength(JSON.stringify(result)) <= JSON_CAP ? result : unknownStack()
  } catch { return unknownStack() }
}

// These controls consume the actual Windows qualification capture, rather
// than treating a hand-authored debugger transcript as vendor evidence.
function qualifyProjection826(stdout, stderr) {
  const parsed = projectCdbStacks826(stdout, stderr)
  if (parsed.status === 'UNKNOWN' || !parsed.threads.some(thread => thread.frames.length)) return false
  const text = stdout.toString('utf8'), lf = text.replace(/\r\n/g, '\n')
  return JSON.stringify(projectCdbStacks826(lf, stderr)) === JSON.stringify(projectCdbStacks826(lf.replace(/\n/g, '\r\n'), stderr)) &&
    projectCdbStacks826(Buffer.alloc(RAW_CAP + 1, 65)).status === 'UNKNOWN' &&
    projectCdbStacks826(text.split(/\r?\n/).filter(line => /Id:|Call Site/.test(line)).join('\n')).status === 'UNKNOWN' &&
    !JSON.stringify(projectCdbStacks826(text + '\nC:\\private\\secret pid=123 register=ffff\n', stderr)).includes('private')
}

function selectOwnedTargets826(rows, binding) {
  const result = { native: null, browser: null }
  try {
    if (!Array.isArray(rows) || rows.length > 4 || !windowsPath(binding.binary) || !integer(binding.parentPid) || !Number.isSafeInteger(binding.createdAfterMs) || !Number.isSafeInteger(binding.createdBeforeMs) || binding.createdBeforeMs < binding.createdAfterMs) return result
    const valid = row => row && !Array.isArray(row) && Object.keys(row).sort().join() === [...PROCESS_FIELDS].sort().join() && integer(row.pid) && integer(row.parentPid) && windowsPath(row.executablePath) && Number.isSafeInteger(row.createdMs) && typeof row.live === 'boolean'
    if (!rows.every(valid)) return result
    const natives = rows.filter(row => row.live && row.parentPid === binding.parentPid && samePath(row.executablePath, binding.binary) && row.createdMs >= binding.createdAfterMs && row.createdMs <= binding.createdBeforeMs)
    if (natives.length !== 1) return result
    result.native = natives[0].pid
    const browsers = rows.filter(row => row.live && row.parentPid === result.native && path.win32.basename(row.executablePath).toLowerCase() === 'msedgewebview2.exe' && row.createdMs >= natives[0].createdMs && row.createdMs <= binding.createdBeforeMs)
    if (browsers.length === 1) result.browser = browsers[0].pid
  } catch { /* Identity uncertainty cannot admit a PID. */ }
  return result
}

// One bounded PowerShell invocation. No command line, window/title or provider
// enumeration. The explicit DTO is consumed by the selector above.
const QUERY_PS_826 = String.raw`$ErrorActionPreference='Stop'
$x=ConvertFrom-Json -InputObject $env:CMSPARK_STACK_BINDING_826
$s=Get-AuthenticodeSignature -LiteralPath $x.cdb
$signed=($s.Status -eq 'Valid' -and $null -ne $s.SignerCertificate -and $s.SignerCertificate.Subject -match '(^|,\s*)O=Microsoft Corporation(,|$)')
$rows=@()
function Fact826($p) {
  $live=$false; $handle=$null
  try { $handle=Get-Process -Id ([int]$p.ProcessId) -ErrorAction Stop; $live=-not $handle.HasExited } catch {} finally { if($null -ne $handle){$handle.Dispose()} }
  [ordered]@{ pid=[int]$p.ProcessId; parentPid=[int]$p.ParentProcessId; executablePath=[string]$p.ExecutablePath; createdMs=([DateTimeOffset]$p.CreationDate.ToUniversalTime()).ToUnixTimeMilliseconds(); live=[bool]$live }
}
if($signed -and $null -ne $x.binary) {
  $native=@(Get-CimInstance -ClassName Win32_Process -Filter ('ParentProcessId = '+[int]$x.parentPid+" AND Name = 'cmspark-desktop.exe'") | Where-Object {
    ([DateTimeOffset]$_.CreationDate.ToUniversalTime()).ToUnixTimeMilliseconds() -ge $x.createdAfterMs -and ([DateTimeOffset]$_.CreationDate.ToUniversalTime()).ToUnixTimeMilliseconds() -le $x.createdBeforeMs
  } | Select-Object -First 2)
  foreach($p in $native){$rows+=Fact826 $p}
  if($native.Count -eq 1){
    $browser=@(Get-CimInstance -ClassName Win32_Process -Filter ('ParentProcessId = '+[int]$native[0].ProcessId+" AND Name = 'msedgewebview2.exe'") | Select-Object -First 2)
    foreach($p in $browser){$rows+=Fact826 $p}
  }
}
ConvertTo-Json -Depth 4 -Compress -InputObject ([ordered]@{ signed=[bool]$signed; rows=@($rows) })`

function runBounded826(file, args, options, spawnPort = spawn) {
  return new Promise(resolve => {
    let child, timer, done = false, invalid = false, count = 0; const buffers = { stdout: [], stderr: [] }
    const finish = (code = null, signal = null) => {
      if (done) return; done = true; clearTimeout(timer)
      resolve({ ok: !invalid && code === 0 && signal == null, stdout: invalid ? Buffer.alloc(0) : Buffer.concat(buffers.stdout), stderr: invalid ? Buffer.alloc(0) : Buffer.concat(buffers.stderr) })
    }
    // Expiry bounds useful work. A kill request is not process closure: the
    // caller must not detach/clean its workspace until actual tool close.
    const refuse = () => { if (invalid || done) return; invalid = true; clearTimeout(timer); try { child?.kill() } catch {} }
    try {
      child = spawnPort(file, args, { cwd: options.cwd, env: options.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      for (const kind of ['stdout', 'stderr']) child[kind]?.on('data', value => {
        if (done) return
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); count += bytes.length
        if (count > RAW_CAP) refuse(); else buffers[kind].push(bytes)
      })
      child.once('error', () => { if (!child.pid) { invalid = true; finish() } else refuse() }); child.once('close', finish)
      if (!done) timer = setTimeout(refuse, options.timeoutMs)
    } catch { finish() }
  })
}

function resolveCdb826(env = process.env) {
  const root = env['ProgramFiles(x86)']
  if (!windowsPath(root)) throw Error('TOOL')
  const file = path.win32.join(root, 'Windows Kits', '10', 'Debuggers', 'x64', 'cdb.exe')
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('TOOL')
  const fd = fs.openSync(file, 'r')
  try {
    const dos = Buffer.alloc(64)
    if (fs.readSync(fd, dos, 0, 64, 0) !== 64 || dos.toString('ascii', 0, 2) !== 'MZ') throw Error('TOOL')
    const offset = dos.readUInt32LE(60), pe = Buffer.alloc(6)
    if (offset > 4096 || fs.readSync(fd, pe, 0, 6, offset) !== 6 || pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) throw Error('TOOL')
  } finally { fs.closeSync(fd) }
  return file
}

function makeWorkspace826(outputRoot) {
  const stat = fs.lstatSync(outputRoot)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('ROOT')
  const directory = fs.mkdtempSync(path.join(outputRoot, '.cdb826-')), symbols = path.join(directory, 'symbols')
  fs.mkdirSync(symbols, { mode: 0o700 })
  return { directory, symbols, close() { fs.rmSync(directory, { recursive: true, force: true }) } }
}
function toolEnvironment826(env, cdb, work, binding) {
  const system = env.SystemRoot || env.SYSTEMROOT
  if (!windowsPath(system)) throw Error('ENV')
  const result = { SystemRoot: system, WINDIR: system, PATH: path.win32.dirname(cdb) + ';' + path.win32.join(system, 'System32'), _NT_SYMBOL_PATH: work.symbols, _NT_ALT_SYMBOL_PATH: '', _NT_SOURCE_PATH: '', _NT_EXECUTABLE_IMAGE_PATH: '' }
  for (const name of ['TEMP', 'TMP']) if (windowsPath(env[name])) result[name] = env[name]
  if (binding) result.CMSPARK_STACK_BINDING_826 = JSON.stringify(binding)
  return result
}
const defaults = { platform: process.platform, arch: process.arch, env: process.env, pid: process.pid, now: Date.now, run: runBounded826, tool: resolveCdb826, workspace: makeWorkspace826, canonical: fs.realpathSync.native, spawn }
function queryOptions(io, cdb, work, binding) {
  const system = io.env.SystemRoot || io.env.SYSTEMROOT
  return { file: path.win32.join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(QUERY_PS_826, 'utf16le').toString('base64')], options: { timeoutMs: 3000, cwd: work.directory, env: toolEnvironment826(io.env, cdb, work, { cdb, ...binding }) } }
}
async function query826(io, cdb, work, binding) {
  const q = queryOptions(io, cdb, work, binding), result = await io.run(q.file, q.args, q.options)
  if (!result.ok || result.stderr.length) return null
  try { const value = JSON.parse(result.stdout.toString('utf8')); return value && !Array.isArray(value) && Object.keys(value).sort().join() === 'rows,signed' && value.signed === true && Array.isArray(value.rows) ? value : null } catch { return null }
}
async function debug826(io, cdb, work, kind, pid) {
  const result = await io.run(cdb, [kind === 'native' ? '-pv' : '-pvr', '-p', String(pid), '-c', COMMAND], { timeoutMs: 6000, cwd: work.directory, env: toolEnvironment826(io.env, cdb, work) })
  return result.ok ? projectCdbStacks826(result.stdout, result.stderr) : unknownStack()
}
async function collectMcpStacks826(options, io = defaults) {
  let work
  try {
    if (io.platform !== 'win32' || io.arch !== 'x64' || !options || !windowsPath(options.root) || !windowsPath(options.outputRoot) || !samePath(options.binary, path.win32.join(options.root, 'mcp-snapshot-825', 'cmspark-desktop.exe')) || options.parentPid !== io.pid || !integer(options.parentPid) || !Number.isSafeInteger(options.createdAfterMs) || !Number.isSafeInteger(options.createdBeforeMs) || options.createdAfterMs < 0 || options.createdBeforeMs < options.createdAfterMs || options.createdBeforeMs > io.now()) return unknown()
    const cdb = io.tool(io.env); work = io.workspace(options.outputRoot)
    const facts = await query826(io, cdb, work, { binary: options.binary, parentPid: options.parentPid, createdAfterMs: options.createdAfterMs, createdBeforeMs: options.createdBeforeMs })
    if (!facts) return unknown()
    // CIM may expand an owned GetTempPath 8.3 name. Compare both actual files
    // in the same native realpath domain; failure never admits a PID.
    const binary = io.canonical(options.binary)
    const rows = facts.rows.map(row => row && row.parentPid === options.parentPid && windowsPath(row.executablePath) && path.win32.basename(row.executablePath).toLowerCase() === 'cmspark-desktop.exe' && row.createdMs >= options.createdAfterMs && row.createdMs <= options.createdBeforeMs
      ? { ...row, executablePath: io.canonical(row.executablePath) } : row)
    const selected = selectOwnedTargets826(rows, { ...options, binary })
    if (!selected.native) return unknown()
    const native = { kind: 'native', ...await debug826(io, cdb, work, 'native', selected.native) }
    // UNKNOWN includes failed/expired tools and no useful native clean frames.
    const browser = native.status === 'UNKNOWN' ? target('browser', 'SKIPPED') : selected.browser ? { kind: 'browser', ...await debug826(io, cdb, work, 'browser', selected.browser) } : target('browser')
    const result = { schema: 1, status: native.status === 'UNKNOWN' ? 'UNKNOWN' : native.status === 'INCOMPLETE' || browser.status !== 'OBSERVED' ? 'INCOMPLETE' : 'OBSERVED', targets: [native, browser] }
    return Buffer.byteLength(JSON.stringify(result)) <= JSON_CAP ? result : unknown()
  } catch { return unknown() } finally { try { work?.close() } catch {} }
}

function message826(child, wanted, timeoutMs) {
  return new Promise(resolve => {
    let timer
    const finish = value => { clearTimeout(timer); child.off('message', onMessage); child.off('close', closed); child.off('error', closed); resolve(value) }
    const onMessage = value => { if (value === wanted) finish(true) }, closed = () => finish(false)
    child.on('message', onMessage); child.once('close', closed); child.once('error', closed)
    timer = setTimeout(() => finish(false), timeoutMs)
  })
}
async function qualifyCdb826({ outputRoot } = {}, io = defaults) {
  const result = qualification(); let work, dummy, closed = false, closePromise
  try {
    if (io.platform !== 'win32' || io.arch !== 'x64' || !windowsPath(outputRoot)) return result
    const cdb = io.tool(io.env); work = io.workspace(outputRoot)
    if (!await query826(io, cdb, work, {})) return result
    // CPU/IPC only; no WebView, window, user file, provider or output payload.
    dummy = io.spawn(process.execPath, ['-e', 'process.send("ready");process.on("message",x=>{if(x==="ping")process.send("pong")});setInterval(()=>{},1000)'], { cwd: work.directory, env: toolEnvironment826(io.env, cdb, work), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    closePromise = new Promise(resolve => { dummy.once('close', () => { closed = true; resolve() }); dummy.once('error', () => { if (!integer(dummy.pid)) resolve() }) })
    if (!await message826(dummy, 'ready', 2000) || !integer(dummy.pid)) return result
    const captured = await io.run(cdb, ['-pv', '-p', String(dummy.pid), '-c', COMMAND], { timeoutMs: 6000, cwd: work.directory, env: toolEnvironment826(io.env, cdb, work) })
    result.parserPositive = captured.ok && qualifyProjection826(captured.stdout, captured.stderr)
    if (result.parserPositive) {
      const pong = message826(dummy, 'pong', 1000)
      try { dummy.send('ping') } catch { /* The awaited bounded pong becomes false. */ }
      result.actualDetached = await pong
    }
  } catch { /* No raw debugger/process failure can escape this collector. */ }
  finally {
    if (dummy) {
      try { if (!closed) dummy.kill() } catch {}
      if (closePromise && !closed) await closePromise
      result.dummyClosed = closed
    }
    try { work?.close() } catch {}
  }
  if (result.parserPositive && result.actualDetached && result.dummyClosed) result.status = 'OBSERVED'
  return result
}

module.exports = { qualifyCdb826, collectMcpStacks826, selectOwnedTargets826, projectCdbStacks826, qualifyProjection826, admitSymbol826, runBounded826, QUERY_PS_826, PROCESS_FIELDS, COMMAND, RAW_CAP, JSON_CAP, toolEnvironment826 }
