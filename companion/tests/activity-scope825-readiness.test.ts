/** Execute the real owned C# gate/event bodies with controlled WPF/Win32 leaves.
 * This proves fixture scheduling/qualification, not Windows foreground behavior. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'

const file = path.resolve('tests/fixtures/activity-scope825-windows.cs'), source = fs.readFileSync(file, 'utf8')
function one(pattern: RegExp): string {
  const matches = [...source.matchAll(pattern)]
  assert.equal(matches.length, 1, 'one actual fixture source boundary')
  return matches[0][1]
}
const guard = one(/static bool IsReady\(Window window, TextBox focus, bool rendered\) \{([\s\S]*?)\n  \}/g)
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
]) jsWire = port(before, after, jsWire)

function harness() {
  const queued: Array<() => void> = [], writes: any[] = [], calls: string[] = []
  const context: any = {
    Current: null, ContentRegion: null, TitleRegion: null, Focus: null, ReceiptWindow: null, PendingReceipt: null, CheckCurrentReceipt: null,
    foreground: 0, IntPtr: { Zero: 0 }, DispatcherPriority: { Input: 5 },
    GetForegroundWindow: () => context.foreground,
    WindowInteropHelper: function (this: any, window: any) { this.Handle = window.hwnd },
    Write(name: string, snapshot: any) { writes.push({ name, ...snapshot }) },
    Snapshot: () => ({ hwnd: context.Current.hwnd, width: context.Current.Width }),
  }
  vm.createContext(context)
  vm.runInContext('globalThis.IsReady=(window,focus,rendered)=>{' + guard + '};globalThis.mount=(window,focus,popup)=>{const content={},title={};' + jsWire + '};', context)
  const mount = (hwnd: number, popup = false) => {
    const window: any = { hwnd, Width: 100, Dispatcher: { BeginInvoke: (_priority: any, callback: () => void) => queued.push(callback) }, Activate() { calls.push('activate:' + hwnd); return false }, UpdateLayout() { calls.push('layout:' + hwnd) } }
    const focus: any = { IsKeyboardFocused: false, Focus() { calls.push('focus:' + hwnd); return false } }
    context.mount(window, focus, popup)
    return { window, focus }
  }
  return { context, mount, writes, calls, flush() { while (queued.length) queued.shift()!() } }
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
