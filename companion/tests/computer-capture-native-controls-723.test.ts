/** CPU contracts for actual #723 acceptance helpers; never runs PS/native. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { modes723, forcedFallback723, remaining723, receipt723, assertSetup723, assertUnchanged723, cleanup723, waitReceipt723, type Receipt723 } from "./helpers/capture-native-723"
const testsRoot = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../tests" : ".")
const ps = () => fs.readFileSync(path.join(testsRoot, "../src/host-use/win/scripts/computer-capture.ps1"), "utf8")
const sample = (): Receipt723 => ({ hwnd: 7, other: 0, foreground: 7, minimized: false, desktop51: true })
test("723 unshipped variant preserves complete real PS bytes in LF/CRLF and performs real PrintWindow first", () => {
  for (const source of [ps().replace(/\r\n/g, "\n"), ps().replace(/\r?\n/g, "\r\n")]) {
    const variant = forcedFallback723(source)
    assert.ok(variant.includes("$printed = [CapW32]::PrintWindow($hwndPtr, $hdc, 2); $printed = $false"))
    assert.equal(variant.replace("; $printed = $false # TEST_ONLY_723_AFTER_REAL_PRINTWINDOW", ""), source)
    assert.throws(() => forcedFallback723(variant)); assert.throws(() => forcedFallback723(source + source)); assert.throws(() => forcedFallback723(source.replace("$printed = [CapW32]::PrintWindow", "$changed = [CapW32]::PrintWindow")))
  }
})
test("723 original envelope never extends the default helper ceiling", () => {
  assert.equal(remaining723(45000, 30000, 15000), 15000)
  assert.throws(() => remaining723(45000, 30001, 15000)); assert.throws(() => remaining723(45000, 45000))
})
test("723 actual receipt parser rejects wrong schema, unknowns and nonfinite/coerced native observations", () => {
  assert.deepEqual(receipt723(JSON.stringify(sample())), sample())
  for (const value of [[], null, { ...sample(), extra: "secret" }, { ...sample(), hwnd: "7" }, { ...sample(), foreground: 0 }, { ...sample(), minimized: 0 }, { ...sample(), desktop51: false }, { ...sample(), hwnd: 1.5 }]) assert.throws(() => receipt723(JSON.stringify(value)))
  assert.throws(() => receipt723(" ".repeat(1025))); assert.throws(() => receipt723('{"hwnd":NaN}'))
})
test("723 five native preconditions and post-capture foreground/restore identity are hard gates", () => {
  for (const mode of modes723) {
    const expected = { ...sample(), other: ["minimized", "nonforeground", "occluded"].includes(mode) ? 9 : 0,
      foreground: ["minimized", "nonforeground"].includes(mode) ? 9 : 7, minimized: mode === "minimized" }
    assertSetup723(mode, expected); assertUnchanged723(expected, { ...expected })
    assert.throws(() => assertSetup723(mode, { ...expected, foreground: 11 }))
    assert.throws(() => assertUnchanged723(expected, { ...expected, minimized: !expected.minimized }))
    assert.throws(() => assertUnchanged723(expected, { ...expected, hwnd: 11 }))
  }
})
test("723 actual cleanup retains child through close and preserves original failure over terminate errors", async () => {
  const events: string[] = []; let close!: () => void
  const pending = cleanup723([{ isClosed: () => false, terminate: () => { events.push("terminate"); return true }, closed: new Promise<void>(resolve => close = resolve) }], () => { events.push("remove") }, undefined)
  await Promise.resolve(); assert.deepEqual(events, ["terminate"]); close(); await pending; assert.deepEqual(events, ["terminate", "remove"])
  const primary = Error("original")
  await assert.rejects(cleanup723([{ isClosed: () => false, terminate: () => false, closed: Promise.resolve() }], () => { events.push("cleanup"); throw Error("cleanup") }, primary), e => e === primary)
  await assert.rejects(cleanup723([{ isClosed: () => false, terminate: () => false, closed: Promise.resolve() }], () => {}, undefined), /TERMINATE_REFUSED/)
})
test("723 actual file event waiter handles prepublished and rename publication without polling", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture723-cpu-")), file = path.join(dir, "ready.json")
  const controller = new AbortController(), owner = { isClosed: () => false, terminate: () => true, closed: new Promise<void>(() => {}) }
  try {
    fs.writeFileSync(file, JSON.stringify(sample()), { flag: "wx" })
    assert.deepEqual(await waitReceipt723(file, owner, performance.now() + 1000, controller.signal), sample()); fs.unlinkSync(file)
    const pending = waitReceipt723(file, owner, performance.now() + 1000, controller.signal)
    fs.writeFileSync(file + ".pending", JSON.stringify(sample()), { flag: "wx" }); fs.renameSync(file + ".pending", file)
    assert.deepEqual(await pending, sample())
  } finally { controller.abort(); fs.rmSync(dir, { recursive: true, force: true }) }
})
test("723 receipt waiter abort/preabort and actual child close refuse before late publication", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture723-cpu-")), file = path.join(dir, "ready.json")
  try {
    const aborted = new AbortController(); aborted.abort(Error("preabort"))
    const owner = { isClosed: () => false, terminate: () => true, closed: new Promise<void>(() => {}) }
    await assert.rejects(waitReceipt723(file, owner, performance.now() + 1000, aborted.signal), /preabort/)
    const signal = new AbortController(); const pending = waitReceipt723(file, owner, performance.now() + 1000, signal.signal); signal.abort(Error("cancel")); await assert.rejects(pending, /cancel/)
    const closed = { ...owner, isClosed: () => true, closed: Promise.resolve() }; fs.writeFileSync(file, JSON.stringify(sample()))
    await assert.rejects(waitReceipt723(file, closed, performance.now() + 1000, new AbortController().signal), /OWNER_CLOSED/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test("723 real native module and existing CI retain default adapter, actual BitBlt and owned NOACTIVATE fixture", () => {
  const source = fs.readFileSync(path.join(testsRoot, "computer-capture-windows-native-723.test.ts"), "utf8")
  const fixture = fs.readFileSync(path.join(testsRoot, "fixtures/win/capture-wpf-723.ps1"), "utf8")
  const workflow = fs.readFileSync(path.join(testsRoot, "../../.github/workflows/ci.yml"), "utf8")
  assert.ok(source.includes("new PsScreenCapturer()") && source.includes("runPs(variant, args, opts)"))
  assert.ok(source.includes("before.other") && source.includes("assertUnchanged723(before, await check)"))
  assert.ok(fixture.includes("0x08000000") && fixture.includes("w.ShowActivated=false") && fixture.includes("watcher.Created +="))
  assert.ok(!fixture.includes("Start-Sleep") && !fixture.includes("SetForegroundWindow") && !fixture.includes("EnumWindows"))
  assert.ok(!workflow.includes(".test-dist/tests/computer-capture-windows-native-723.test.js"), "canonical auto-discovery only; no duplicate explicit native run")
})
test("723 whole native callbacks bind each current retained child scope across the cached default runner", async () => {
  const helpers = require("./helpers/capture-native-723")
  const { runNativeCallbacks723 } = require(path.join(testsRoot, "helpers/capture-native-driver-controls-723.cjs"))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture723-driver-cpu-"))
  try {
    const refusals = await actualRefusalErrors723()
    const result = await runNativeCallbacks723(path.join(testsRoot, "computer-capture-windows-native-723.test.ts"), dir, helpers, undefined, refusals)
    assert.equal(result.callbacks.length, 5); assert.equal(result.scopes, 5); assert.equal(result.native, 0); assert.equal(result.postChecks, 5)
    await assert.rejects(runNativeCallbacks723(path.join(testsRoot, "computer-capture-windows-native-723.test.ts"), dir, helpers, "postForeground", refusals), /VERIFY_FAILED/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test("723 actual canonical walk and Windows schedule discover the native module once and preserve five callbacks", () => {
  const vm = require("node:vm"), ts = require("typescript")
  const runnerPath = path.join(testsRoot, "../scripts/run-tests.mjs")
  const source = fs.readFileSync(runnerPath, "utf8")
  assert.equal(source.split("import.meta.url").length, 2)
  const lowered = ts.transpileModule(source.replace("import.meta.url", '"file:///owned/companion/scripts/run-tests.mjs"'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const files = ["computer-capture-native-controls-723.test.js", "computer-capture-windows-native-723.test.js", "_ignored.test.js"], scheduled: string[][] = []
  const fsBoundary = { existsSync: () => true, realpathSync: (p: string) => p,
    readdirSync: () => files.map(name => ({ name, isDirectory: () => false, isFile: () => true })),
    mkdtempSync: () => "/owned/tmp/cmspark-test-run-723", rmSync: () => {} }
  const requireRunner = (id: string) => {
    if (id === "node:fs") return fsBoundary
    if (id === "node:path") return path.posix
    if (id === "node:os") return { tmpdir: () => "/owned/tmp" }
    if (id === "node:url") return { fileURLToPath: () => "/owned/companion/scripts/run-tests.mjs" }
    if (id === "node:child_process") return { spawnSync: (_exe: string, args: string[], options: any) => {
      assert.equal(options.cwd, "/owned/companion"); assert.equal(options.env.CMSPARK_TEST_RUN_DIR, "/owned/tmp/cmspark-test-run-723")
      scheduled.push(args); return { status: 0, signal: null }
    } }
    throw Error("CPU_RUNNER_UNDECLARED_IMPORT")
  }
  let exit: number | undefined
  vm.runInNewContext(lowered, { require: requireRunner, exports: {}, process: { execPath: "/owned/node", argv: ["node", "runner"], platform: "win32", versions: { node: "22.23.2" }, env: {}, exit: (code: number) => { exit = code } }, console: { error: () => { throw Error("CPU_RUNNER_ERROR") } } })
  assert.equal(exit, 0); assert.equal(scheduled.length, 1)
  assert.ok(scheduled[0].includes("--test-concurrency=1"))
  assert.equal(scheduled[0].filter(p => p.endsWith("/computer-capture-windows-native-723.test.js")).length, 1)
  assert.ok(!scheduled[0].some(p => p.endsWith("/_ignored.test.js")))
  // Actual TS emitted module registration; callbacks remain inert, never Win32.
  const registered: any[] = []
  const native = fs.readFileSync(path.join(testsRoot, "computer-capture-windows-native-723.test.ts"), "utf8")
  const compiled = ts.transpileModule(native, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  vm.runInNewContext(compiled, { exports: {}, __dirname: "/owned/companion/.test-dist/tests", process: { platform: "win32" }, require: (id: string) => {
    if (id === "node:test") return (name: string, options: any, callback: any) => registered.push({ name, options, callback })
    if (id === "./helpers/capture-native-723") return { modes723 }
    if (id === "./fixtures/native-surface-650") return {}
    if (id === "node:path") return path.posix
    if (id.startsWith("node:")) return require(id)
    throw Error("CPU_NATIVE_REGISTRATION_IMPORT")
  } })
  assert.equal(registered.length, 5)
  assert.ok(registered.every(r => r.options.skip === false && r.options.timeout === 45_000 && typeof r.callback === "function"))
})

/** Extract the real adapter, not a shadow cleanup implementation. */
async function runTrackedClose723(exitCode: number | null, signalCode: string | null, killResult: boolean) {
  const ts = require("typescript"), vm = require("node:vm"), { EventEmitter } = require("node:events")
  const source = fs.readFileSync(path.join(testsRoot, "computer-capture-windows-native-723.test.ts"), "utf8")
  const ast = ts.createSourceFile("native.ts", source, ts.ScriptTarget.Latest, true), tracks: string[] = []
  const visit = (node: any) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "track") tracks.push(node.initializer.getText(ast)); ts.forEachChild(node, visit) }
  visit(ast); assert.equal(tracks.length, 1)
  const children: any[] = [], actualChildren: any[] = [], output: any = {}
  const emitted = ts.transpileModule("exports.track=(" + tracks[0] + ");", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(emitted, { exports: output, children, actualChildren })
  const child = new EventEmitter(); child.exitCode = exitCode; child.signalCode = signalCode
  let kills = 0, removed = false, sawExit = false, sawClose = false
  child.kill = () => { kills++; return killResult }
  child.once("exit", () => { sawExit = true }); child.once("close", () => { sawClose = true })
  output.track(child)
  let error: string | null = null
  const pending = cleanup723(children, () => { assert.ok(sawClose, "owned cleanup cannot precede actual close"); removed = true }, undefined)
  assert.equal(removed, false)
  queueMicrotask(() => {
    child.exitCode = exitCode ?? (signalCode === null ? 0 : null); child.signalCode = signalCode
    child.emit("exit", child.exitCode, child.signalCode)
    assert.equal(removed, false, "exit still cannot release the retained child")
    queueMicrotask(() => child.emit("close", child.exitCode, child.signalCode))
  })
  try { await pending } catch (e) { error = (e as Error).message }
  return { kills, removed, sawExit, sawClose, error }
}
test("723 actual track: observed exit or signal waits for close without redundant kill", async () => {
  const exited = await runTrackedClose723(0, null, false), signalled = await runTrackedClose723(null, "SIGTERM", false)
  for (const result of [exited, signalled]) assert.deepEqual(result, { kills: 0, removed: true, sawExit: true, sawClose: true, error: null })
})
test("723 actual track: live child termination occurs once and remains retained until close", async () => {
  assert.deepEqual(await runTrackedClose723(null, null, true), { kills: 1, removed: true, sawExit: true, sawClose: true, error: null })
})
test("723 actual track: live refused termination stays hard failure even after later close", async () => {
  assert.deepEqual(await runTrackedClose723(null, null, false), { kills: 1, removed: true, sawExit: true, sawClose: true, error: "D1_723_OWNED_TERMINATE_REFUSED" })
})

/** Real adapter / error mapping with an inert failed PS boundary; never handcraft success/error DTOs. */
async function actualCaptureFailure723(stderr?: string, body = "OWNED_NOT_JSON"): Promise<Error> {
  const { PsScreenCapturer } = await import("../src/computer/win-adapters")
  let failure: unknown
  try { await new PsScreenCapturer(async () => { if (stderr !== undefined) throw Object.assign(Error("owned runner refusal"), { stderr }); return body }).captureWindow(7, { passive: true }) } catch (e) { failure = e }
  assert.ok(failure instanceof Error, "actual adapter must produce failure")
  return failure
}
async function actualRefusalErrors723() {
  const script = ps()
  assert.ok(script.includes('Fail "CAPTUREFAILED" "passive target is minimized" 6'))
  assert.ok(script.includes('Fail "CAPTUREFAILED" "target is not foreground" 6'))
  return { minimized: await actualCaptureFailure723("CAPTUREFAILED:passive target is minimized"), nonforeground: await actualCaptureFailure723("CAPTUREFAILED:target is not foreground") }
}
test("723 passive native oracles reject actual adapter malformed, invalid, API and wrong-phase failures", async () => {
  const helpers = require("./helpers/capture-native-723")
  const { runNativeCallbacks723 } = require(path.join(testsRoot, "helpers/capture-native-driver-controls-723.cjs"))
  const refusals = await actualRefusalErrors723()
  const unrelated = [await actualCaptureFailure723(), await actualCaptureFailure723(undefined, "{}"),
    await actualCaptureFailure723("CAPTUREFAILED:occlusion observation unavailable"),
    await actualCaptureFailure723("HWNDDEAD:passive target is minimized")]
  assert.equal((unrelated[0] as any).code, "CAPTURE_FAILED")
  assert.equal(unrelated[0].message, "computer: unavailable capture observation")
  for (const [mode, other] of [["minimized", "nonforeground"], ["nonforeground", "minimized"]] as const) {
    for (const failure of [...unrelated, refusals[other]]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture723-reason-cpu-"))
      try {
        let rejected: any
        try { await runNativeCallbacks723(path.join(testsRoot, "computer-capture-windows-native-723.test.ts"), dir, helpers, undefined, { ...refusals, [mode]: failure }) } catch (e) { rejected = e }
        assert.ok(rejected, "unrelated actual adapter failure must not become native pass")
        assert.match(rejected.message, /D1_CAPTURE_723_CAPTURE_FAILED/)
        assert.equal(rejected.inertRefusal?.mode, mode, "same target negative reached the capture boundary")
        assert.equal(rejected.inertRefusal?.error, failure, "the actual adapter failure reached the real native predicate")
        assert.equal(rejected.inertRefusal?.postChecks, mode === "minimized" ? 1 : 2, "only preceding positive/current-mode checks may complete")
      } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    }
  }
})


test("723 fixed setup diagnostics identify the exact still-strict failing assertion, never receipt content", () => {
  const cases: Array<{ mode: typeof modes723[number]; value: Receipt723; phase: string }> = [
    { mode: "minimized", value: { ...sample(), other: 9, foreground: 9 }, phase: "MINIMIZED_STATE" },
    { mode: "minimized", value: { ...sample(), other: 9, minimized: true }, phase: "OTHER_FOREGROUND" },
    { mode: "nonforeground", value: { ...sample(), other: 9 }, phase: "OTHER_FOREGROUND" },
    { mode: "printwindow", value: { ...sample(), foreground: 9 }, phase: "TARGET_FOREGROUND" },
    { mode: "occluded", value: sample(), phase: "OWNED_OCCLUDER" },
  ]
  for (const item of cases) {
    const observed: string[] = []
    assert.throws(() => assertSetup723(item.mode, item.value, phase => observed.push(phase)), assert.AssertionError)
    assert.equal(observed.at(-1), item.phase)
    assert.ok(observed.every(phase => ["MINIMIZED_STATE", "OTHER_FOREGROUND", "TARGET_FOREGROUND", "OWNED_OCCLUDER"].includes(phase)))
  }
})


test("723 actual WPF ContentRendered ordering establishes owned foreground after minimize side effects", () => {
  const vm = require("node:vm")
  const original = fs.readFileSync(path.join(testsRoot, "fixtures/win/capture-wpf-723.ps1"), "utf8")
  for (const fixture of [original.replace(/\r\n/g, "\n"), original.replace(/\r?\n/g, "\r\n")]) {
    const start = "target.ContentRendered += delegate {", finish = "    };"
    assert.equal(fixture.split(start).length, 2)
    const suffix = fixture.slice(fixture.indexOf(start) + start.length)
    const body = suffix.slice(0, suffix.indexOf(finish))
    assert.ok(body.includes("Publish(ready,target,other); verify();"))
    const json = fixture.match(/^    string json=(.+);\r?$/m)
    assert.ok(json, "actual Publish JSON expression required")
    // This fixed C# event body is also a JS-compatible subset. Execute its
    // actual statements unchanged; only window/API boundaries are inert.
    const run = (mode: typeof modes723[number], denied = false, ignoreMinimize = false) => {
      let foreground = 7, minimized = false, published = 0
      // Front-to-back model: other activation moves9 above target7; the next
      // top-level below target remains11. No actual host windows are inspected.
      let zOrder = [7, 11]
      const activate = (hwnd: number) => { zOrder = [hwnd, ...zOrder.filter(value => value !== hwnd)]; foreground = hwnd }
      const events: string[] = []
      const target: any = { Activate() { events.push("target-activate"); if (!denied) activate(7) } }
      Object.defineProperty(target, "WindowState", { set(value) {
        assert.equal(value, "minimized"); events.push("minimize")
        if (!ignoreMinimize) {
          minimized = true
          const targetIndex = zOrder.indexOf(7)
          assert.ok(targetIndex >= 0 && targetIndex + 1 < zOrder.length)
          foreground = zOrder[targetIndex + 1]
          zOrder = zOrder.filter(value => value !== 7)
        }
      } })
      let receipt!: Receipt723
      const callback = vm.runInNewContext(`(function(mode) { let rendered=false, other=null; return function() {${body}\n}; })`, {
        target, WindowState: { Minimized: "minimized" }, ready: "owned-ready", verify() {},
        Pattern(overlay: boolean) {
          return { Left: 0, Show() { events.push("other-show"); if (!overlay && !denied) activate(9) },
            Activate() { events.push("other-activate"); if (!denied) activate(9) } }
        },
        Publish(_ready: string, actualTarget: unknown, other: unknown) {
          assert.equal(actualTarget, target); published++; events.push("publish")
          // Same real C# Publish expression, not a handmade successful receipt.
          const text = vm.runInNewContext(`(${json![1]})`, {
            h: { ToInt64: () => 7 }, o: { ToInt64: () => other ? 9 : 0 },
            GetForegroundWindow: () => ({ ToInt64: () => foreground }), IsIconic: () => minimized,
          }, { timeout: 2000 })
          receipt = receipt723(text)
        },
      }, { timeout: 2000 })(mode)
      callback(); callback(); assert.equal(published, 1, "actual rendered latch still publishes once")
      return { receipt, events }
    }
    for (const mode of modes723) {
      const result = run(mode)
      // SW_MINIMIZE may activate the next Z window (sentinel11), even after a
      // prior owned activation. This models allowed API behavior, not Win32.
      assertSetup723(mode, result.receipt)
      if (mode === "minimized") assert.deepEqual(result.events, ["minimize", "other-show", "other-activate", "publish"])
    }
    for (const [denied, ignoreMinimize, expected] of [[true, false, "OTHER_FOREGROUND"], [false, true, "MINIMIZED_STATE"]] as const) {
      let phase = ""
      assert.throws(() => assertSetup723("minimized", run("minimized", denied, ignoreMinimize).receipt, value => { phase = value }), assert.AssertionError)
      assert.equal(phase, expected, "failed activation or absent minimization cannot become ready")
    }
  }
})
