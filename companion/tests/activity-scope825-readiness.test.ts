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
const { adaptSetup, inputLayout } = createRequire(__filename)(path.resolve('tests/helpers/activity-scope825-input-control.cjs'))
const setup = adaptSetup(source)
function one(pattern: RegExp): string {
  const matches = [...source.matchAll(pattern)]
  assert.equal(matches.length, 1, 'one actual fixture source boundary')
  return matches[0][1]
}
const guard = one(/static bool IsReady\(Window window, TextBox focus, bool rendered\) \{([\s\S]*?)\n  \}/g)
const inputReason = one(/static string SetupInputReason\(string message\) \{([\s\S]*?)\r?\n  \}/g)
const finite = one(/static bool Finite\(double value\) \{([^\n]+)\}/g)
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
let jsWire = port('bool rendered = false, requested = false, setupComplete = false;', 'let rendered = false, requested = false, setupComplete = false;', wire)
for (const [before, after] of [
  ['Action check = delegate {', 'const check = () => {'], ['string name = PendingReceipt;', 'const name = PendingReceipt;'],
  ['window.ContentRendered += delegate {', 'window.onRendered = () => {'], ['window.Activated += delegate {', 'window.onActivated = () => {'],
  ['focus.GotKeyboardFocus += delegate {', 'focus.onKeyboardFocus = () => {'],
  ['catch (Exception error)', 'catch (error)'],
  ['new { type = "OWNED_SCOPE825_INPUT_SETUP_FAILED", reason = SetupInputReason(error.Message) }', '({ type: "OWNED_SCOPE825_INPUT_SETUP_FAILED", reason: SetupInputReason(error.message) })'],
  ['window.SourceInitialized += delegate {', 'window.onSourceInitialized = () => {'], ['window.Loaded += delegate {', 'window.onLoaded = () => {'],
]) jsWire = port(before, after, jsWire)

function harness() {
  const queued: Array<() => void> = [], writes: any[] = [], calls: string[] = [], observations: any[] = [], seen = new Set<string>()
  const inputs: any[] = [], shutdowns: number[] = []
  const math = Object.create(Math)
  math.Floor = Math.floor
  math.Round = (value: number) => { const floor = Math.floor(value), fraction = value - floor; return fraction === 0.5 ? floor + (floor % 2) : Math.round(value) }
  const context: any = {
    Current: null, ContentRegion: null, TitleRegion: null, Focus: null, ReceiptWindow: null, PendingReceipt: null, CheckCurrentReceipt: null,
    InitialWindow: null, InitialReady: false, MainThread: 11, Thread: { CurrentThread: { ManagedThreadId: 11 } },
    Observed: { Add(phase: string) { if (seen.has(phase)) return false; seen.add(phase); return true } },
    RecordObservation(_phase: string, value: any) { observations.push(JSON.parse(JSON.stringify(value))) },
    foreground: 0, IntPtr: { Zero: 0, Size: 8 }, DispatcherPriority: { Input: 5 },
    WindowState: { Minimized: 1 }, Math: math, Int32: { MinValue: -2147483648, MaxValue: 2147483647 },
    Point: function (this: any, X: number, Y: number) { this.X = X; this.Y = Y },
    Double: { IsNaN: Number.isNaN, IsInfinity: (value: number) => value === Infinity || value === -Infinity }, Process: { GetCurrentProcess: () => ({ Id: 42 }) },
    virtual: [-1920, 0, 3840, 1080], client: { Left: 0, Top: 0, Right: 900, Bottom: 600 },
    inputSize: 40, inserted: 3, ownerPid: 42, ownerThread: 7, hitRoot: undefined, hit: undefined,
    PresentationSource: { FromVisual: (focus: any) => focus.presentation },
    IsWindowVisible: () => context.nativeVisible !== false,
    GetClientRect: (_hwnd: number, output: (rect: any) => void) => { output(context.client); return context.clientOk !== false },
    ScreenToClient: (_hwnd: number, point: any) => { point.X -= -1800; point.Y -= 40; return context.clientPointOk !== false },
    GetSystemMetrics: (index: number) => context.virtual[index - 76],
    Marshal: { SizeOf: (name: string) => { assert.equal(name, 'Input'); return context.inputSize } },
    WindowFromPoint: (point: any) => { context.lastPoint = JSON.parse(JSON.stringify(point)); return context.hit ?? context.Current.hwnd },
    GetAncestor: (_hwnd: number, flag: number) => { assert.equal(flag, 2); return context.hitRoot ?? context.Current.hwnd },
    GetWindowThreadProcessId: (_hwnd: number, output: (pid: number) => void) => { output(context.ownerPid); return context.ownerThread },
    SendInput: (count: number, batch: any[], size: number) => {
      assert.equal(count, 3); assert.equal(batch.length, 3); assert.equal(size, context.inputSize)
      inputs.push(JSON.parse(JSON.stringify(batch))); calls.push('input:' + context.Current.hwnd)
      context.duringSend?.(); return context.inserted
    },
    Application: { Current: { Shutdown: (code: number) => shutdowns.push(code) } },
    GetForegroundWindow: () => context.foreground,
    WindowInteropHelper: function (this: any, window: any) { this.Handle = window.hwnd },
    Write(name: string, snapshot: any) { writes.push({ name, ...snapshot }) },
    Snapshot: () => ({ hwnd: context.Current.hwnd, width: context.Current.Width }),
  }
  vm.createContext(context)
  vm.runInContext('globalThis.SetupInputReason=(message)=>{' + inputReason + '};globalThis.Finite=(value)=>{' + finite + '};globalThis.SetupOwnedClick=(window,focus,rendered)=>{' + setup + '};globalThis.Observe=(phase)=>{' + jsObserve + '};globalThis.ReadyResult=(window,result,reason)=>{' + result + '};globalThis.IsReady=(window,focus,rendered)=>{' + guard + '};globalThis.mount=(window,focus,popup)=>{const content={},title={};' + jsWire + '};', context)
  const mount = (hwnd: number, popup = false) => {
    const window: any = { hwnd, Width: 100, IsVisible: true, IsEnabled: true, WindowState: 0, Dispatcher: { BeginInvoke: (_priority: any, callback: () => void) => queued.push(callback) }, UpdateLayout() { calls.push('layout:' + hwnd) }, PointFromScreen: (point: any) => point }
    const focus: any = { IsKeyboardFocused: false, IsVisible: true, IsEnabled: true, IsMeasureValid: true, IsArrangeValid: true, ActualWidth: 400, ActualHeight: 60, presentation: { Handle: hwnd },
      PointToScreen: (point: any) => ({ X: -1700 + point.X, Y: 120 + point.Y }), PointFromScreen: (point: any) => ({ X: point.X + 1700, Y: point.Y - 120 }),
      IsAncestorOf: (element: any) => element?.ownedTextChild === true,
    }
    window.InputHitTest = () => focus
    context.mount(window, focus, popup)
    return { window, focus }
  }
  return { context, mount, writes, calls, observations, inputs, shutdowns, flush() { while (queued.length) queued.shift()!() } }
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
    window.onRendered() // At most one owned setup input batch per window.
    h.context.foreground = 99; focus.IsKeyboardFocused = true; focus.onKeyboardFocus(); h.flush()
    assert.equal(h.writes.length, 0, 'logical WPF focus without the foreground HWND is insufficient')
    h.context.foreground = 17; focus.IsKeyboardFocused = false; window.onActivated(); h.flush()
    assert.equal(h.writes.length, 0, 'foreground without actual keyboard focus is insufficient')
    focus.IsKeyboardFocused = true; focus.onKeyboardFocus(); h.flush()
    assert.deepEqual(h.writes, [{ name: 'ready.json', hwnd: 17, width: 100 }])
    window.onActivated(); focus.onKeyboardFocus(); window.onRendered(); h.flush()
    assert.equal(h.writes.length, 1)
    assert.deepEqual(h.calls, ['input:17'])
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
  assert.deepEqual(h.calls, ['input:17', 'input:27'])
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
  assert.deepEqual(h.calls, ['input:17', 'layout:17'])
})

test('826 actual mouse-only INPUT layout and PInvoke signatures match both Windows pointer widths', () => {
  assert.match(source, /\[StructLayout\(LayoutKind.Sequential\)\] struct NativePoint \{ public int X, Y; \}/)
  assert.match(source, /\[StructLayout\(LayoutKind.Sequential\)\] struct NativeRect \{ public int Left, Top, Right, Bottom; \}/)
  for (const eol of ['\n', '\r\n']) {
    const variant = source.replace(/\r?\n/g, eol)
    assert.equal(adaptSetup(variant).replace(/\r\n/g, '\n'), setup.replace(/\r\n/g, '\n'))
    assert.deepEqual(inputLayout(variant, 8), inputLayout(source, 8))
  }
  assert.deepEqual(inputLayout(source, 8), { mouse: { size: 32, align: 8, offsets: { X: 0, Y: 4, Data: 8, Flags: 12, Time: 16, ExtraInfo: 24 } }, input: { size: 40, align: 8, offsets: { Type: 0, Mouse: 8 } } })
  assert.deepEqual(inputLayout(source, 4), { mouse: { size: 24, align: 4, offsets: { X: 0, Y: 4, Data: 8, Flags: 12, Time: 16, ExtraInfo: 20 } }, input: { size: 28, align: 4, offsets: { Type: 0, Mouse: 4 } } })
  assert.match(source, /\[DllImport\("user32.dll", SetLastError = true\)\] static extern uint SendInput\(uint count, Input\[\] inputs, int size\);/)
  assert.match(source, /static extern IntPtr WindowFromPoint\(NativePoint point\);/)
  assert.match(source, /static extern bool ScreenToClient\(IntPtr hwnd, ref NativePoint point\);/)
  assert.match(source, /static extern bool GetClientRect\(IntPtr hwnd, out NativeRect rect\);/)
  assert.match(source, /static extern uint GetWindowThreadProcessId\(IntPtr hwnd, out uint pid\);/)
  assert.doesNotMatch(wire, /\.Activate\(|\.Focus\(/, 'setup click replaces the old requests, with no fallback')
  for (const size of [4, 8]) {
    const h = harness(), { window } = h.mount(17)
    h.context.IntPtr.Size = size; h.context.inputSize = inputLayout(source, size).input.size
    window.onRendered(); assert.equal(h.inputs.length, 1); assert.equal(h.shutdowns.length, 0)
    h.context.inputSize--
    const popup = h.mount(27, true); popup.window.onRendered()
    assert.equal(h.inputs.length, 1, 'actual runtime ABI mismatch refuses before sending')
    assert.deepEqual(h.shutdowns, [2])
  }
})

test('826 complete actual setup body rejects unsafe WPF, native ownership, layout and screen paths before input', () => {
  type Candidate = ReturnType<typeof harness> & ReturnType<ReturnType<typeof harness>['mount']>
  const cases: Array<[string, (h: Candidate) => void]> = [
    ['stale current', h => { h.context.Current = {} }], ['stale receipt', h => { h.context.ReceiptWindow = {} }],
    ['no pending', h => { h.context.PendingReceipt = null }], ['hidden', h => { h.window.IsVisible = false }],
    ['disabled', h => { h.window.IsEnabled = false }], ['minimized', h => { h.window.WindowState = 1 }],
    ['hidden textbox', h => { h.focus.IsVisible = false }], ['disabled textbox', h => { h.focus.IsEnabled = false }],
    ['measure invalid', h => { h.focus.IsMeasureValid = false }], ['arrange invalid', h => { h.focus.IsArrangeValid = false }],
    ['no HWND', h => { h.window.hwnd = 0 }], ['native invisible', h => { h.context.nativeVisible = false }],
    ['no presentation', h => { h.focus.presentation = null }], ['wrong presentation', h => { h.focus.presentation.Handle = 27 }],
    ['zero width', h => { h.focus.ActualWidth = 0 }], ['negative height', h => { h.focus.ActualHeight = -1 }],
    ['NaN width', h => { h.focus.ActualWidth = NaN }], ['infinite height', h => { h.focus.ActualHeight = Infinity }],
    ['NaN screen', h => { h.focus.PointToScreen = () => ({ X: NaN, Y: 100 }) }],
    ['screen int overflow', h => { h.focus.PointToScreen = () => ({ X: 2147483648, Y: 100 }) }],
    ['local nonfinite', h => { h.focus.PointFromScreen = () => ({ X: 0, Y: Infinity }) }],
    ['rounded point outside textbox', h => { h.focus.PointFromScreen = () => ({ X: 400, Y: 30 }) }],
    ['null WPF hit', h => { h.window.InputHitTest = () => null }],
    ['same HWND covering sibling', h => { h.window.InputHitTest = () => ({ sibling: true }) }],
    ['client failed', h => { h.context.clientOk = false }], ['screen to client failed', h => { h.context.clientPointOk = false }],
    ['outside client', h => { h.context.client.Right = 300 }], ['virtual width invalid', h => { h.context.virtual[2] = 1 }],
    ['outside virtual screen', h => { h.context.virtual[0] = 0 }], ['wrong ABI', h => { h.context.inputSize = 28 }],
    ['no native point hit', h => { h.context.hit = 0 }], ['occluding other top level', h => { h.context.hitRoot = 27 }],
    ['wrong process', h => { h.context.ownerPid = 77 }], ['failed PID query', h => { h.context.ownerThread = 0 }],
  ]
  for (const [name, mutate] of cases) {
    const h = harness(), candidate = Object.assign(h, h.mount(17)); mutate(candidate)
    assert.throws(() => h.context.SetupOwnedClick(candidate.window, candidate.focus, true), /OWNED_SCOPE825_INPUT_/, name)
    assert.equal(h.inputs.length, 0, name)
  }
  const h = harness(), { window, focus } = h.mount(17)
  assert.throws(() => h.context.SetupOwnedClick(window, focus, false), /OWNED_SCOPE825_INPUT_PRECONDITION/)
  assert.equal(h.inputs.length, 0)
})

test('826 actual setup derives one exact mouse batch from rounded native and WPF coordinates on a negative-origin virtual desktop', () => {
  const h = harness(), { window, focus } = h.mount(17)
  let hitPoint: any
  window.PointFromScreen = (point: any) => ({ X: point.X + 1800, Y: point.Y - 40 })
  window.InputHitTest = (point: any) => { hitPoint = { ...point }; return { ownedTextChild: true } }
  focus.PointToScreen = () => ({ X: -1499.2, Y: 150.8 })
  window.onRendered()
  assert.deepEqual(h.context.lastPoint, { X: -1500, Y: 150 })
  assert.deepEqual(hitPoint, { X: 300, Y: 110 }, 'whole-window WPF hit consumes the rounded actual screen point')
  assert.deepEqual(h.inputs, [[
    { Type: 0, Mouse: { X: Math.round(420 * 65535 / 3839), Y: Math.round(150 * 65535 / 1079), Data: 0, Flags: 0xc001, Time: 0, ExtraInfo: 0 } },
    { Type: 0, Mouse: { X: 0, Y: 0, Data: 0, Flags: 2, Time: 0, ExtraInfo: 0 } },
    { Type: 0, Mouse: { X: 0, Y: 0, Data: 0, Flags: 4, Time: 0, ExtraInfo: 0 } },
  ]])
  assert.equal(h.writes.length, 0, 'inserting input does not prove foreground or keyboard focus')
  assert.deepEqual(h.observations.filter(row => row.phase.startsWith('INPUT_')), [{ phase: 'INPUT_COMPLETE', sameSta: true }])
  assert.deepEqual(h.shutdowns, [])
})

test('826 actual success fence rejects late qualified events after short input or refused setup, including reentrant send events', () => {
  for (const failure of [0, 1, 2, 'covered', 'ABI'] as const) {
    const h = harness(), { window, focus } = h.mount(17)
    if (typeof failure === 'number') h.context.inserted = failure
    if (failure === 'covered') h.context.hitRoot = 27
    if (failure === 'ABI') h.context.inputSize = 1
    h.context.duringSend = () => {
      h.context.foreground = 17; focus.IsKeyboardFocused = true
      window.onActivated(); focus.onKeyboardFocus(); h.flush()
      assert.equal(h.writes.length, 0, 'setup has not yet returned successfully')
    }
    window.onRendered()
    assert.deepEqual(h.shutdowns, [2], String(failure))
    assert.deepEqual(h.writes, [{ name: 'failure.json', type: 'OWNED_SCOPE825_INPUT_SETUP_FAILED', reason: typeof failure === 'number' ? 'SHORT' : failure === 'covered' ? 'HIT' : 'ABI' }])
    h.context.foreground = 17; focus.IsKeyboardFocused = true
    assert.equal(h.context.IsReady(window, focus, true), true, 'all original qualification predicates now pass')
    window.onActivated(); focus.onKeyboardFocus(); h.flush(); h.context.CheckCurrentReceipt(); window.onRendered(); h.flush()
    assert.equal(h.writes.filter(row => row.name !== 'failure.json').length, 0, 'failure fence blocks later ready even if original IsReady is true')
    assert.equal(h.inputs.length, typeof failure === 'number' ? 1 : 0, String(failure))
    assert.deepEqual(h.observations.filter(row => row.phase.startsWith('INPUT_')), [{ phase: 'INPUT_REFUSED', sameSta: true }])
  }
  const h = harness(), { window, focus } = h.mount(17)
  h.context.inserted = 2; h.context.Write = () => { throw Error('owned-failure-write-refused') }
  window.onRendered(); h.context.foreground = 17; focus.IsKeyboardFocused = true
  window.onActivated(); focus.onKeyboardFocus(); h.flush()
  assert.deepEqual(h.shutdowns, [2]); assert.equal(h.inputs.length, 1); assert.equal(h.writes.length, 0)
})

test('826 actual scope mapper and catch project only twelve exact setup reasons or UNKNOWN without private exception text', () => {
  const expected = ['PRECONDITION', 'WINDOW', 'LAYOUT', 'POINT', 'INTERIOR', 'TEXTBOX', 'CLIENT', 'SCREEN', 'ABI', 'HIT', 'OWNER', 'SHORT']
  const actualThrows = [...source.matchAll(/throw new Exception\("(OWNED_SCOPE825_INPUT_[A-Z_]+)"\)/g)].map(row => row[1])
  assert.deepEqual(actualThrows.sort(), expected.map(reason => 'OWNED_SCOPE825_INPUT_' + reason).sort())
  for (const reason of expected) {
    const h = harness(), { window } = h.mount(17), message = 'OWNED_SCOPE825_INPUT_' + reason
    assert.equal(h.context.SetupInputReason(message), reason)
    h.context.SetupOwnedClick = () => { throw Error(message) }
    window.onRendered()
    assert.deepEqual(h.writes, [{ name: 'failure.json', type: 'OWNED_SCOPE825_INPUT_SETUP_FAILED', reason }])
    assert.deepEqual(h.shutdowns, [2]); assert.equal(h.inputs.length, 0)
  }
  for (const message of ['PRIVATE_NEVER_PROJECT', 'OWNED_SCOPE825_INPUT_SHORT PRIVATE_NEVER_PROJECT', 'owned_scope825_input_short', '', null, undefined]) {
    const h = harness(), { window, focus } = h.mount(17)
    assert.equal(h.context.SetupInputReason(message), 'UNKNOWN')
    h.context.SetupOwnedClick = () => { throw { message, private: 'PRIVATE_NEVER_PROJECT' } }
    window.onRendered()
    assert.deepEqual(h.writes, [{ name: 'failure.json', type: 'OWNED_SCOPE825_INPUT_SETUP_FAILED', reason: 'UNKNOWN' }])
    assert.doesNotMatch(JSON.stringify(h.writes), /PRIVATE_NEVER_PROJECT/)
    h.context.foreground = 17; focus.IsKeyboardFocused = true; window.onActivated(); focus.onKeyboardFocus(); h.flush()
    assert.equal(h.writes.length, 1, 'the same failure fence still blocks ready')
    assert.deepEqual(h.shutdowns, [2])
  }
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
    assert.equal(names.includes('INPUT_COMPLETE'), true); assert.equal(names.includes('INPUT_REFUSED'), true)
    for (const phase of ['ACTIVATE_TRUE', 'ACTIVATE_FALSE', 'FOCUS_TRUE', 'FOCUS_FALSE']) {
      assert.equal(names.includes(phase), false, 'the current closed projection has no legacy compatibility branch')
      const old = path.join(dir, 'scope-initial-' + phase + '.json')
      fs.writeFileSync(old, JSON.stringify({ phase, sameSta: true }))
      assert.equal(project(dir).status, 'UNKNOWN'); fs.unlinkSync(old)
    }
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
