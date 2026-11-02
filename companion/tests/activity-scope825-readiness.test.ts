/** Execute the real owned C# gate/event bodies with controlled WPF/Win32 leaves.
 * This proves fixture scheduling/qualification, not Windows foreground behavior. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import os from 'node:os'
import { createRequire } from 'node:module'

const file = path.resolve('tests/fixtures/activity-scope825-windows.cs'), source = fs.readFileSync(file, 'utf8')
function one(pattern: RegExp): string {
  const matches = [...source.matchAll(pattern)]
  assert.equal(matches.length, 1, 'one actual fixture source boundary')
  return matches[0][1]
}
const guard = one(/static bool IsReady\(Window window, TextBox focus, bool rendered\) \{([\s\S]*?)\n  \}/g)
const result = one(/static bool ReadyResult\(Window window, bool result, string reason\) \{([\s\S]*?)\n  \}/g)
const observe = one(/static void Observe\(string phase\) \{([\s\S]*?)\n  \}/g)
const producerExpression = 'new { phase = phase, sameSta = Thread.CurrentThread.ManagedThreadId == MainThread }'
assert.equal(observe.split(producerExpression).length, 2, 'actual closed producer payload')
const jsObserve = observe.replace(producerExpression, '({ phase: phase, sameSta: Thread.CurrentThread.ManagedThreadId == MainThread })')
const wire = one(/    (Current = window;[\s\S]*?)\n    return window;/g)
function port(before: string, after: string, text: string): string {
  assert.equal(text.split(before).length, 2, 'exact language/event adapter')
  return text.replace(before, after)
}
let jsWire = port('bool rendered = false, requested = false;', 'let rendered = false, requested = false;', wire)
for (const [before, after] of [
  ['Action check = delegate {', 'const check = () => {'], ['string name = PendingReceipt;', 'const name = PendingReceipt;'],
  ['window.ContentRendered += delegate {', 'window.onRendered = () => {'], ['window.Activated += delegate {', 'window.onActivated = () => {'],
  ['focus.GotKeyboardFocus += delegate {', 'focus.onKeyboardFocus = () => {'],
  ['bool activated = window.Activate();', 'const activated = window.Activate();'], ['bool focused = focus.Focus();', 'const focused = focus.Focus();'],
  ['window.SourceInitialized += delegate {', 'window.onSourceInitialized = () => {'], ['window.Loaded += delegate {', 'window.onLoaded = () => {'],
]) jsWire = port(before, after, jsWire)

function harness() {
  const queued: Array<() => void> = [], writes: any[] = [], calls: string[] = [], observations: any[] = [], seen = new Set<string>()
  const context: any = {
    Current: null, ContentRegion: null, TitleRegion: null, Focus: null, ReceiptWindow: null, PendingReceipt: null, CheckCurrentReceipt: null,
    InitialWindow: null, InitialReady: false, MainThread: 11, Thread: { CurrentThread: { ManagedThreadId: 11 } },
    Observed: { Add(phase: string) { if (seen.has(phase)) return false; seen.add(phase); return true } },
    RecordObservation(_phase: string, value: any) { observations.push(JSON.parse(JSON.stringify(value))) },
    foreground: 0, IntPtr: { Zero: 0 }, DispatcherPriority: { Input: 5 },
    GetForegroundWindow: () => context.foreground,
    WindowInteropHelper: function (this: any, window: any) { this.Handle = window.hwnd },
    Write(name: string, snapshot: any) { writes.push({ name, ...snapshot }) },
    Snapshot: () => ({ hwnd: context.Current.hwnd, width: context.Current.Width }),
  }
  vm.createContext(context)
  vm.runInContext('globalThis.Observe=(phase)=>{' + jsObserve + '};globalThis.ReadyResult=(window,result,reason)=>{' + result + '};globalThis.IsReady=(window,focus,rendered)=>{' + guard + '};globalThis.mount=(window,focus,popup)=>{const content={},title={};' + jsWire + '};', context)
  const mount = (hwnd: number, popup = false) => {
    const window: any = { hwnd, Width: 100, Dispatcher: { BeginInvoke: (_priority: any, callback: () => void) => queued.push(callback) }, Activate() { calls.push('activate:' + hwnd); return false }, UpdateLayout() { calls.push('layout:' + hwnd) } }
    const focus: any = { IsKeyboardFocused: false, Focus() { calls.push('focus:' + hwnd); return false } }
    context.mount(window, focus, popup)
    return { window, focus }
  }
  return { context, mount, writes, calls, observations, flush() { while (queued.length) queued.shift()!() } }
}

test('825 recorded old ContentRendered writes false ready even when both original requests fail', () => {
  // Recorded verbatim from bd43 before this fixture-only fix; the body is valid
  // C# and JS, so no qualification logic is translated or reimplemented.
  const old = 'if (File.Exists(Path.Combine(Root, "ready.json"))) return; Current.Activate(); Focus.Focus(); Write("ready.json", Snapshot());'
  assert.equal(createHash('sha256').update(old).digest('hex'), '43fb0fd3a4776fbebdfb09a44cd4a83c805ce705f09d9313494b0667b9e520ad')
  let writes = 0
  vm.runInNewContext('(function(){' + old + '})()', { Root: 'owned', File: { Exists: () => false }, Path: { Combine: () => 'owned/ready.json' }, Current: { Activate: () => false }, Focus: { Focus: () => false }, Write: () => writes++, Snapshot: () => ({}) })
  assert.equal(writes, 1)
})

test('825 actual gate waits for rendering, real foreground HWND and keyboard focus in either event order', () => {
  for (const first of ['foreground', 'focus', 'rendered']) {
    const h = harness(), { window, focus } = h.mount(17)
    if (first === 'foreground') { h.context.foreground = 17; window.onActivated(); h.flush() }
    if (first === 'focus') { focus.IsKeyboardFocused = true; focus.onKeyboardFocus(); h.flush() }
    if (first === 'rendered') window.onRendered()
    assert.equal(h.writes.length, 0)
    window.onRendered() // At most one explicit activation/focus request per window.
    h.context.foreground = 99; focus.IsKeyboardFocused = true; focus.onKeyboardFocus(); h.flush()
    assert.equal(h.writes.length, 0, 'logical WPF focus without the foreground HWND is insufficient')
    h.context.foreground = 17; focus.IsKeyboardFocused = false; window.onActivated(); h.flush()
    assert.equal(h.writes.length, 0, 'foreground without actual keyboard focus is insufficient')
    focus.IsKeyboardFocused = true; focus.onKeyboardFocus(); h.flush()
    assert.deepEqual(h.writes, [{ name: 'ready.json', hwnd: 17, width: 100 }])
    window.onActivated(); focus.onKeyboardFocus(); window.onRendered(); h.flush()
    assert.equal(h.writes.length, 1)
    assert.deepEqual(h.calls, ['activate:17', 'focus:17'])
  }
})

test('825 queued event rechecks current native state and a stale old window cannot publish a new popup receipt', () => {
  const h = harness(), old = h.mount(17)
  old.window.onRendered(); h.context.foreground = 17; old.focus.IsKeyboardFocused = true; old.window.onActivated()
  h.context.foreground = 99; h.flush(); assert.equal(h.writes.length, 0, 'state is checked after the event, not when queued')
  const popup = h.mount(27, true)
  h.context.foreground = 17; old.window.onRendered(); old.window.onActivated(); old.focus.onKeyboardFocus(); h.flush()
  assert.equal(h.writes.length, 0)
  popup.window.onRendered(); popup.focus.IsKeyboardFocused = true; popup.focus.onKeyboardFocus(); h.flush(); assert.equal(h.writes.length, 0)
  h.context.foreground = 27; popup.window.onActivated(); h.flush()
  assert.deepEqual(h.writes, [{ name: 'ack.json', hwnd: 27, width: 100 }])
  assert.deepEqual(h.calls, ['activate:17', 'focus:17', 'activate:27', 'focus:27'])
})

test('825 actual resize handler updates layout then uses the same current-window receipt gate', () => {
  const resize = one(/if \(action == "resize"\) \{ ([^\n]+) \}/g)
  const h = harness(), { window, focus } = h.mount(17)
  window.onRendered(); h.context.foreground = 17; focus.IsKeyboardFocused = true; focus.onKeyboardFocus(); h.flush()
  assert.equal(h.writes.length, 1)
  h.context.foreground = 99; vm.runInContext('(function(){' + resize + '})()', h.context)
  assert.equal(h.writes.length, 1); assert.equal(window.Width, 180); assert.equal(h.calls.filter(call => call === 'layout:17').length, 1)
  h.context.foreground = 17; focus.IsKeyboardFocused = false; window.onActivated(); h.flush(); assert.equal(h.writes.length, 1)
  focus.IsKeyboardFocused = true; focus.onKeyboardFocus(); h.flush()
  assert.deepEqual(h.writes[1], { name: 'ack.json', hwnd: 17, width: 180 })
  assert.deepEqual(h.calls, ['activate:17', 'focus:17', 'layout:17'])
})

test('826 observed real guard preserves all 128 qualification combinations and query counts', () => {
  // Original IsReady body recorded from 64dbdaaf before passive instrumentation.
  const baseline = 'if (!rendered || Current != window || ReceiptWindow != window || PendingReceipt == null) return false;\nvar hwnd = new WindowInteropHelper(window).Handle;\nreturn hwnd != IntPtr.Zero && GetForegroundWindow() == hwnd && focus.IsKeyboardFocused;'
  const reached = new Set<string>()
  for (let mask = 0; mask < 128; mask++) {
    const run = (body: string, throwing: boolean) => {
      const h = harness(), counts = { handle: 0, foreground: 0, focus: 0 }
      const window = { hwnd: mask & 16 ? 17 : 0 }, focus = { get IsKeyboardFocused() { counts.focus++; return !!(mask & 64) } }
      Object.assign(h.context, {
        InitialWindow: window, Current: mask & 2 ? window : null, ReceiptWindow: mask & 4 ? window : null,
        PendingReceipt: mask & 8 ? 'ready.json' : null,
        WindowInteropHelper: function (this: any) { Object.defineProperty(this, 'Handle', { get() { counts.handle++; return window.hwnd } }) },
        GetForegroundWindow() { counts.foreground++; return mask & 32 ? 17 : 99 },
      })
      if (throwing) h.context.RecordObservation = () => { throw Error('owned-observer-failure') }
      const value = vm.runInContext('(function(window,focus,rendered){' + body + '})(window,focus,rendered)', Object.assign(h.context, { window, focus, rendered: !!(mask & 1) }))
      for (const item of h.observations) reached.add(item.phase)
      return { value, counts }
    }
    const expected = run(baseline, false)
    assert.deepEqual(run(guard, false), expected, String(mask))
    assert.deepEqual(run(guard, true), expected, 'throwing observer ' + mask)
  }
  assert.deepEqual([...reached].sort(), ['NOT_RENDERED', 'NOT_CURRENT', 'NOT_RECEIPT_WINDOW', 'NO_PENDING', 'NO_HWND', 'NOT_FOREGROUND', 'NO_KEYBOARD_FOCUS', 'QUALIFIED'].sort())
})

test('826 actual observation producer is once-only, inert on failure, initial-only and records readiness after its write', () => {
  const h = harness(), { window, focus } = h.mount(17)
  let attempts = 0
  h.context.RecordObservation = () => { attempts++; throw Error('owned-write-failure') }
  h.context.Observe('RUN_ENTER'); h.context.Observe('RUN_ENTER'); assert.equal(attempts, 1)
  h.context.foreground = 17; focus.IsKeyboardFocused = true; window.onRendered()
  assert.equal(h.writes.length, 1, 'failed diagnostic writes cannot suppress original ready')
  assert.equal(h.context.InitialReady, true)
  const before = attempts; h.context.IsReady(window, focus, true); assert.equal(attempts, before)
  const popup = h.mount(27, true); popup.window.onRendered(); assert.equal(attempts, before, 'popup has no initial observation')
  const clean = harness(), initial = clean.mount(17)
  clean.context.foreground = 17; initial.focus.IsKeyboardFocused = true
  let alreadyWritten = false
  clean.context.Write = () => { alreadyWritten = true }
  clean.context.RecordObservation = (phase: string) => { if (phase === 'READY_WRITTEN') assert.equal(alreadyWritten, true) }
  initial.window.onRendered()
  assert.equal(clean.context.InitialReady, true)
})

test('826 actual producer payload and target feed the closed initial observation reader', () => {
  const require = createRequire(__filename), readerFile = path.resolve('tests/helpers/activity-scope825-observation.cjs')
  const project = require(readerFile), readerSource = fs.readFileSync(readerFile, 'utf8')
  const names: string[] = vm.runInNewContext(readerSource.match(/const names = (\[[^\n]+\])/)![1])
  const target = one(/string file = (Path.Combine\(Root, "scope-initial-" \+ phase \+ ".json"\)), pending/g)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope825-observation-'))
  try {
    assert.equal(project(dir).status, 'UNKNOWN')
    const h = harness(), produced: Array<{ file: string; value: any }> = []
    h.context.RecordObservation = (phase: string, value: any) => {
      const file = vm.runInNewContext(target, { Root: dir, phase, Path: { Combine: path.join } })
      produced.push({ file, value: JSON.parse(JSON.stringify(value)) }); fs.writeFileSync(file, JSON.stringify(value))
    }
    for (const name of names) { assert.ok(source.includes('"' + name + '"')); h.context.Observe(name); h.context.Observe(name) }
    assert.equal(produced.length, names.length)
    assert.deepEqual(Object.keys(project(dir).points).sort(), [...names].sort())
    assert.equal(project(dir).status, 'OBSERVED')
    for (const row of produced) fs.unlinkSync(row.file)
    const actual = produced[0]
    for (const bad of ['{', JSON.stringify({ ...actual.value, private: 'OWNED_NEVER_PROJECT' }), JSON.stringify({ ...actual.value, sameSta: 'true' }), JSON.stringify({ ...actual.value, phase: 'UNADMITTED' })]) {
      fs.writeFileSync(actual.file, bad); assert.equal(project(dir).status, 'UNKNOWN')
    }
    fs.unlinkSync(actual.file)
    fs.writeFileSync(actual.file + '.pending', JSON.stringify(actual.value)); assert.equal(project(dir).status, 'UNKNOWN')
    h.context.Thread.CurrentThread.ManagedThreadId = 22
    h.context.Observed = { Add: () => true }; h.context.Observe(names[0])
    assert.equal(project(dir).points[names[0]], false, 'sameSta false is preserved as a closed boolean')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('826 actual native finally projects only after child close and preserves primary failure through projection errors', async () => {
  const native = fs.readFileSync(path.resolve('tests/activity-scope825-native.test.ts'), 'utf8')
  for (const eol of ['\n', '\r\n']) {
    const text = native.replace(/\r?\n/g, eol).replace(/\r\n/g, '\n')
    const body = text.match(/\} finally \{([\s\S]*?)\n  \}\n\}\)\)/)![1]
    const calls: string[] = [], primary = Error('owned-primary')
    const run = vm.runInNewContext('(async()=>{try{throw primary}finally{' + body + '}})', {
      primary, service: { stop: async () => { calls.push('stop') } }, child: { kill() { calls.push('kill') } }, ended: false,
      closed: { then(resolve: () => void) { calls.push('closed'); resolve() } }, dir: 'owned', path,
      require: () => () => { calls.push('project'); throw Error('owned-projection-failure') },
      t: { diagnostic() { calls.push('diagnostic') } }, fs: { rmSync() { calls.push('remove') } }, lease: { settled() { calls.push('settled') } },
    })
    await assert.rejects(run(), (error: unknown) => error === primary)
    assert.deepEqual(calls, ['stop', 'kill', 'closed', 'project', 'remove', 'settled'])
  }
})
