import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import ts from "typescript"
import { terminalB64Decode, terminalB64Encode } from "../src/terminal/wire"

// Execute the real component effect with fake xterm/Port/timers. No browser or PTY is spawned.
function startup() {
  const timers: Array<{ callback: () => void; ms: number; interval: boolean; active: boolean }> = []
  const sent: any[] = [], states: any[] = []
  let effect: (() => (() => void)) | undefined
  let onFrame: (frame: unknown) => void = () => {}
  let onInput: (text: string) => void = () => {}
  let onResize: (size: { cols: number; rows: number }) => void = () => {}
  let inputDisposed = false
  const schedule = (callback: () => void, ms: number, interval = false) => {
    const timer = { callback, ms, interval, active: true }; timers.push(timer); return timer
  }
  class FakeTerminal {
    cols = 80; rows = 24
    loadAddon() {}; open() {}; focus() {}; dispose() {}
    write(_bytes: unknown, callback: () => void) { callback() }
    onData(fn: typeof onInput) { onInput = fn; return { dispose() { inputDisposed = true } } }
    onResize(fn: typeof onResize) { onResize = fn; return { dispose() {} } }
  }
  const source = fs.readFileSync(path.join(process.cwd(), "src/terminal/TerminalApp.tsx"), "utf8")
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const mocks: Record<string, unknown> = {
    react: {
      useRef: () => ({ current: {} }),
      useState: (initial: unknown) => { const slot = states.length; states.push(initial); return [initial, (next: any) => { states[slot] = typeof next === "function" ? next(states[slot]) : next }] },
      useEffect: (fn: typeof effect) => { effect = fn },
    },
    "react/jsx-runtime": { jsx() {}, jsxs() {} },
    "@xterm/xterm": { Terminal: FakeTerminal },
    "@xterm/addon-fit": { FitAddon: class { fit() {} } },
    "@xterm/xterm/css/xterm.css": {},
    "../background/terminal": { TERMINAL_PORT_NAME: "cmspark-terminal" },
    "./wire": { terminalB64Encode, terminalB64Decode },
    "../sidepanel/ui/tokens": { tokens: {} },
  }
  const exports: any = {}
  const load = (name: string) => { if (!(name in mocks)) throw new Error(name); return mocks[name] }
  new Function("exports", "require", compiled)(exports, load)
  exports.TerminalApp()
  const globals: Record<string, unknown> = {
    window: { location: { search: "?thread_id=jeatvi" }, addEventListener() {}, removeEventListener() {} },
    chrome: { runtime: { connect: () => ({ postMessage: (frame: unknown) => sent.push(frame), disconnect() {}, onMessage: { addListener: (fn: typeof onFrame) => { onFrame = fn } }, onDisconnect: { addListener() {} } }) } },
    ResizeObserver: class { observe() { onResize({ cols: 100, rows: 30 }) } disconnect() {} },
    setTimeout: (fn: () => void, ms: number) => schedule(fn, ms),
    setInterval: (fn: () => void, ms: number) => schedule(fn, ms, true),
    clearTimeout: (timer: any) => { timer.active = false },
    clearInterval: (timer: any) => { timer.active = false },
  }
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  const cleanup = effect!()
  return {
    sent, states,
    frame(value: unknown) { onFrame(value) },
    fire(ms: number) { for (const timer of [...timers]) if (timer.active && timer.ms <= ms) { if (!timer.interval) timer.active = false; timer.callback() } },
    input(text: string) { if (!inputDisposed) onInput(text) },
    opened() {
      // Recorded from the real Companion handler (the existing wire fixture).
      const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/terminal-review-v1.json"), "utf8"))
      onFrame({ ...fixture.opened, id: sent[0].id })
    },
    close() {
      cleanup()
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete (globalThis as any)[key]
      }
    },
  }
}

test("terminal sends no resize/input/ping before approved opened; flushes current size afterward", () => {
  const app = startup()
  try {
    app.input("ignored before approval")
    app.fire(25_000)
    assert.deepEqual(app.sent.map(frame => frame.type), ["terminal.open"])
    assert.equal(app.states[0], "connecting", "45s confirmation window must not trigger a 12s watchdog")
    app.opened()
    assert.equal(app.states[0], "running")
    assert.ok(app.sent.some(frame => frame.type === "terminal.resize" && frame.cols === 100))
    app.input("\x1b[B") // Claude permission menu: Down
    app.input("\r") // Enter
    app.fire(25_000)
    assert.deepEqual(app.sent.filter(frame => frame.type === "terminal.input").map(frame => new TextDecoder().decode(terminalB64Decode(frame.b64))), ["\x1b[B", "\r"])
    assert.ok(app.sent.some(frame => frame.type === "terminal.ping"))
  } finally { app.close() }
})

test("a vanished PTY ends the UI and blocks old input after reconnect", () => {
  for (const failure of [
    { code: "disconnected", error: "connection lost" },
    { code: "request_failed", error: "TERMINAL_SESSION_NOT_OWNED" },
  ]) {
    const app = startup()
    try {
      app.opened()
      app.frame({ type: "terminal.error", id: app.sent[0].id, ...failure })
      assert.equal(app.states[0], "closed")
      assert.match(app.states[1], /重新发起编程接力/)
      const count = app.sent.length
      app.input("lost keystroke")
      app.fire(25_000)
      app.opened()
      assert.equal(app.sent.length, count)
      assert.equal(app.states[0], "closed")
    } finally { app.close() }
  }
})

test("a review submission error does not close a live terminal", () => {
  const app = startup()
  try {
    app.opened()
    app.frame({ type: "terminal.error", id: app.sent[0].id, code: "request_failed", error: "invalid review report" })
    app.input("still usable")
    assert.equal(app.states[0], "running")
    assert.equal(app.sent.at(-1).type, "terminal.input")
  } finally { app.close() }
})

test("terminal watchdog closes a never-opened request and stops late frames", () => {
  const app = startup()
  try {
    app.fire(60_000)
    assert.equal(app.states[0], "error")
    assert.ok(app.sent.some(frame => frame.type === "terminal.close"))
    const count = app.sent.length
    app.opened()
    app.input("must not send")
    app.fire(60_000)
    assert.equal(app.states[0], "error")
    assert.equal(app.sent.length, count)
  } finally { app.close() }
})
