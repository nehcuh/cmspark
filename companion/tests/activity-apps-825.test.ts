import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { decodeWindowsActivityApps, WINDOWS_ACTIVITY_APP_LIMIT } from '../src/activity/windows-apps'
import { buildOwnedWpf758, runOwnedCompiler758 } from './helpers/activity-native-fixture-758'
import { withSurface650 } from './fixtures/native-surface-650'
import { resolveWinScript, runPs } from '../src/host-use/win/powershell'

// Controlled decoder inputs follow the production Apps row declaration. The
// Windows acceptance below consumes the actual script's serialized output.
const app = (index: number, app_name = `Owned ${index}`, window_state = 'none') => ({ app_id: 'win.' + createHash('sha256').update(`owned-executable-${index}`).digest('hex'), app_name, window_state })

test('#825 Windows Apps decoder accepts live identities without HWND and keeps no paths or titles', () => {
  const rows = ['visible', 'minimized', 'hidden', 'none'].map((state, index) => app(index, `Owned ${index}`, state))
  const result = decodeWindowsActivityApps({ ok: true, apps: rows })
  assert.equal(result.length, 4)
  for (const item of result) assert.deepEqual(Object.keys(item).sort(), ['app_id', 'app_name', 'window_state'])
  assert.equal(JSON.stringify(result).includes('hwnd'), false)
  assert.equal(JSON.stringify(result).includes('exe'), false)
  assert.throws(() => decodeWindowsActivityApps({ ok: true, apps: [{ ...app(1), exe: 'c:\\private\\chat.exe' }] }), (error: any) => error.code === 'APP_LIST_FAILED')
})

test('#825 Windows Apps decoder is deterministic, merges same executable states and retains distinct same-name identities', () => {
  const input = [app(3, 'Zulu'), app(1, 'Alpha', 'hidden'), app(1, 'Alpha', 'visible'), app(2, 'Alpha', 'minimized')]
  const first = decodeWindowsActivityApps({ ok: true, apps: input })
  assert.deepEqual(decodeWindowsActivityApps({ ok: true, apps: [...input].reverse() }), first)
  assert.equal(first.length, 3)
  assert.deepEqual(first.map(row => row.app_name), ['Alpha', 'Alpha', 'Zulu'])
  assert.equal(first.find(row => row.app_id === app(1).app_id)!.window_state, 'visible')
  assert.equal(first.filter(row => row.app_name === 'Alpha').length, 2)
})

test('#825 Windows Apps admits 201 and 4096 entries and explicitly refuses 4097', () => {
  for (const count of [201, WINDOWS_ACTIVITY_APP_LIMIT]) {
    const rows = Array.from({ length: count }, (_, index) => app(index, index === count - 1 ? 'AChat' : `ZBackground ${index}`))
    const result = decodeWindowsActivityApps({ ok: true, apps: rows })
    assert.equal(result.length, count)
    assert.equal(result[0].app_name, 'AChat')
  }
  assert.throws(() => decodeWindowsActivityApps({ ok: true, apps: Array.from({ length: 4097 }, (_, index) => app(index)) }), (error: any) => error.code === 'APP_LIST_LIMIT_EXCEEDED')
})

test('#825 Windows Apps rejects invalid states and identities, and excludes sensitive display names', () => {
  assert.deepEqual(decodeWindowsActivityApps({ ok: true, apps: [app(1, '1Password'), app(2, 'Owned Chat')] }), [app(2, 'Owned Chat')])
  for (const value of [null, { ok: false, apps: [] }, { ok: true, windows: [] }, { ok: true, apps: [{ ...app(1), app_id: 'win.fake' }] }, { ok: true, apps: [app(1, '', 'none')] }, { ok: true, apps: [app(1, 'Owned', 'capturable')] }]) {
    assert.throws(() => decodeWindowsActivityApps(value), (error: any) => error.code === 'APP_LIST_FAILED')
  }
})

function appsProducerParts825(source: string): { functions: string; body: string } {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const functions = source.slice(source.indexOf('function Process-Identity'), source.indexOf('function Window-Info'))
  const start = source.indexOf(`if ($Mode -eq 'Apps') {${eol}  # Window observations`)
  const end = source.indexOf(`} else {${eol}  $h =`, start)
  assert.ok(start >= 0 && end > start)
  assert.ok(functions.includes('function App-Name'))
  return { functions, body: source.slice(start, end) + '}' }
}

test('#825 Apps producer extraction preserves real-source LF and CRLF bytes', () => {
  const lf = fs.readFileSync(resolveWinScript('activity-windows.ps1'), 'utf8').replace(/\r\n/g, '\n')
  const expected = appsProducerParts825(lf)
  for (const eol of ['\n', '\r\n']) {
    const actual = appsProducerParts825(lf.replace(/\n/g, eol))
    for (const part of ['functions', 'body'] as const) {
      assert.equal(actual[part], expected[part].replace(/\n/g, eol))
    }
  }
})

test('#825 Windows PowerShell Apps producer keeps 201/4096 identities, excludes foreign/protected paths and refuses 4097', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async () => {
  // Execute the actual identity/name/Apps code with inert native/process leaves.
  // This consumes genuine producer JSON, rather than pinning a handwritten DTO.
  const source = fs.readFileSync(resolveWinScript('activity-windows.ps1'), 'utf8')
  const { functions, body } = appsProducerParts825(source)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-apps825-producer-'))
  try {
    const script = path.join(directory, 'producer.ps1')
    fs.writeFileSync(script, `param([string]$Root)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -TypeDefinition 'using System; public class ActivityWindows758 { public static IntPtr[] Windows(){return new IntPtr[0];} public static string Desktop(){return "Default";} }'
$ownSession=825
$Mode='Apps'
${functions}
function Get-Process { param($ErrorAction) return $script:fixtureRows }
function Invoke-Apps825 {
${body}
}
$results=@()
foreach ($count in @(201,4096,4097)) {
  $script:fixtureRows=@()
  for ($index=0;$index -lt $count;$index++) {
    $name=if($index -eq ($count-1)){'AChat'}else{'ZBackground'+$index}
    $script:fixtureRows += [pscustomobject]@{Id=$index+1;SessionId=825;Path=[IO.Path]::Combine($Root,'fake-'+$index+'.exe');ProcessName=$name}
  }
  # The first two have resolvable paths, but fail the actual session/path gates.
  $script:fixtureRows += [pscustomobject]@{Id=5000;SessionId=826;Path=[IO.Path]::Combine($Root,'foreign.exe');ProcessName='Foreign'}
  $script:fixtureRows += [pscustomobject]@{Id=5001;SessionId=825;Path=[IO.Path]::Combine($Root,'keepass.exe');ProcessName='Protected'}
  $script:fixtureRows += [pscustomobject]@{Id=5002;SessionId=825;Path='';ProcessName='Unresolved'}
  $script:fixtureRows += [pscustomobject]@{Id=5003;SessionId=825;Path=$script:fixtureRows[0].Path;ProcessName=$script:fixtureRows[0].ProcessName}
  try { $raw=Invoke-Apps825; $results += [ordered]@{count=$count;raw=[string]$raw;error=$null} }
  catch { $results += [ordered]@{count=$count;raw=$null;error=[string]$_.Exception.Message} }
}
ConvertTo-Json -Depth 4 -Compress -InputObject @($results)
`, { flag: 'wx' })
    const outputs = JSON.parse(await runPs(script, ['-Root', directory]))
    for (const result of outputs) {
      if (result.count === 4097) { assert.equal(result.error, 'APP_LIST_LIMIT_EXCEEDED'); assert.equal(result.raw, null); continue }
      assert.equal(result.error, null)
      const payload = JSON.parse(result.raw), apps = decodeWindowsActivityApps(payload)
      assert.equal(apps.length, result.count); assert.equal(apps[0].app_name, 'AChat')
      assert.equal(apps.every(item => item.window_state === 'none'), true)
      assert.deepEqual(payload.apps, apps, 'the producer and decoder use the same deterministic order')
      assert.equal(apps.some(item => ['Foreign', 'Protected', 'Unresolved'].includes(item.app_name)), false)
      for (const row of payload.apps) assert.deepEqual(Object.keys(row).sort(), ['app_id', 'app_name', 'window_state'])
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

function receipt825(file: string, child: ChildProcess, signal: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (error?: unknown, value?: unknown) => { if (finished) return; finished = true; clearTimeout(timer); watcher.close(); child.off('close', closed); signal.removeEventListener('abort', aborted); error ? reject(error) : resolve(value) }
    const check = () => { try {
      const failure = path.join(path.dirname(file), 'failure.json')
      if (fs.existsSync(failure)) { finish(Error('OWNED_APPS_FIXTURE_FAILED ' + fs.readFileSync(failure, 'utf8').slice(0, 1024))); return }
      if (fs.existsSync(file)) finish(undefined, JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (error) { finish(error) } }
    const closed = () => { check(); if (!finished) finish(Error('OWNED_APPS_FIXTURE_CLOSED')) }
    const aborted = () => finish(signal.reason)
    const watcher = fs.watch(path.dirname(file), check)
    const timer = setTimeout(() => { check(); if (!finished) finish(Error('OWNED_APPS_FIXTURE_NOT_READY')) }, 10_000)
    child.once('close', closed); signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted(); else check()
  })
}

test('#825 Windows native process remains discoverable when minimized, hidden or without a window; Apps never changes foreground', {
  skip: process.platform !== 'win32' || process.env.CMSPARK_ACTIVITY_NATIVE_758 !== '1', timeout: 90_000,
}, t => withSurface650(t, async (owned, lease) => {
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_OS, 'Windows')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-apps825-owned-'))
  let child: ChildProcess | undefined, ended = true, closed: Promise<void> = Promise.resolve(), sequence = 0
  const from = path.resolve('tests/fixtures/activity-windows-758.cs'), to = path.resolve('tests/fixtures/activity-apps-windows-825.cs')
  try {
    const binary = await buildOwnedWpf758(directory, owned.signal, (file, args, options) => runOwnedCompiler758(file, args.map(arg => arg === from ? to : arg), options))
    const rawApps = async () => JSON.parse(await runPs(resolveWinScript('activity-windows.ps1'), ['-Mode', 'Apps']))
    const probe = async () => JSON.parse(await runPs(resolveWinScript('activity-windows.ps1'), ['-Mode', 'Probe'])).window
    const launch = async (mode: 'gui' | 'headless') => {
      const root = path.join(directory, mode); fs.mkdirSync(root)
      child = spawn(binary, [root, mode], { windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] })
      child.stderr?.on('data', () => {})
      lease.retain(); ended = false
      closed = new Promise<void>(resolve => child!.once('close', () => { ended = true; resolve() }))
      child.on('error', () => {})
      const ready = await receipt825(path.join(root, 'ready.json'), child, owned.signal)
      assert.equal(ready.pid, child.pid)
      const control = async (command: string) => {
        const id = ++sequence, temporary = path.join(root, 'control.pending')
        fs.writeFileSync(temporary, JSON.stringify({ sequence: id, command }), { flag: 'wx' })
        fs.renameSync(temporary, path.join(root, 'control.json'))
        const value = await receipt825(path.join(root, `response-${id}.json`), child!, owned.signal)
        assert.equal(value.pid, child!.pid); assert.equal(value.command, command); return value
      }
      return { ready, control }
    }
    const gui = await launch('gui'), firstProbe = await probe()
    assert.equal(firstProbe.pid, child!.pid); assert.equal(firstProbe.hwnd, gui.ready.hwnd)
    assert.equal(firstProbe.window_class, gui.ready.window_class); assert.ok(firstProbe.window_class)
    const identity = firstProbe.app_id
    const observe = async (control: (command: string) => Promise<any>, state: string) => {
      const before = await control('snapshot'), payload = await rawApps(), apps = decodeWindowsActivityApps(payload), after = await control('snapshot')
      assert.equal(after.foreground, before.foreground)
      const row = apps.find(item => item.app_id === identity)
      assert.ok(row, 'owned executable must remain listed'); assert.equal(row.window_state, state)
      for (const item of payload.apps) assert.deepEqual(Object.keys(item).sort(), ['app_id', 'app_name', 'window_state'])
      return apps
    }
    await observe(gui.control, 'visible')
    const minimized = await gui.control('minimize'); assert.equal(minimized.minimized, true)
    await observe(gui.control, 'minimized'); assert.notEqual((await probe())?.pid, child!.pid)
    const hidden = await gui.control('hide'); assert.equal(hidden.visible, false)
    await observe(gui.control, 'hidden'); assert.notEqual((await probe())?.pid, child!.pid)
    await gui.control('quit'); await closed
    assert.equal(decodeWindowsActivityApps(await rawApps()).some(item => item.app_id === identity), false)
    const headless = await launch('headless'); assert.equal(headless.ready.hwnd, 0)
    await observe(headless.control, 'none'); assert.notEqual((await probe())?.pid, child!.pid)
    await headless.control('quit'); await closed
    assert.equal(decodeWindowsActivityApps(await rawApps()).some(item => item.app_id === identity), false)
    t.diagnostic('ACTIVITY825_NATIVE visible/minimized/hidden/no-window identity stable; foreground unchanged; process exit removed')
  } finally {
    if (child && !ended) child.kill()
    await closed
    fs.rmSync(directory, { recursive: true, force: true }); lease.settled()
  }
}))
