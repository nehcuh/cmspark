/** GitHub #723 D1 remote-only capture acceptance; fixed generated content only. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import cp from "node:child_process"
import { promisify } from "node:util"
import { withSurface650 } from "./fixtures/native-surface-650"
import { modes723, forcedFallback723, remaining723, waitReceipt723, assertSetup723, assertUnchanged723, cleanup723, type Child723, type Mode723 } from "./helpers/capture-native-723"

const testsRoot = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../tests" : ".")
const script = path.resolve(testsRoot, "../src/host-use/win/scripts/computer-capture.ps1")
const fixture = path.join(testsRoot, "fixtures/win/capture-wpf-723.ps1")
const ps = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
// runPs caches its promisified observer; each sequential callback supplies only
// its current retained-child scope, never the previous case's lease/children.
let captureObserver723: ((args: any[]) => any) | undefined
for (const mode of modes723) test(`723 D1 actual Windows capture ${mode}`, { skip: process.platform !== "win32", timeout: 45_000 }, async t => {
  assert.ok(process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_OS === "Windows", "D1_723_REMOTE_WINDOWS_ONLY")
  await withSurface650(t, async (owned, lease) => {
    const deadline = performance.now() + 45_000
    const data = process.env.CMSPARK_DATA_DIR
    assert.ok(data && path.isAbsolute(data))
    const dir = fs.mkdtempSync(path.join(data, "capture-native-723-")), identity = fs.lstatSync(dir, { bigint: true })
    const ready = path.join(dir, "ready.json"), request = path.join(dir, "verify"), verified = path.join(dir, "verified.json"), variant = path.join(dir, "capture-forced.ps1")
    const tempBefore = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }
    const temp = path.join(dir, "tmp")
    let originalScript: Buffer = Buffer.alloc(0)
    const originalExec = cp.execFile, originalPromise: any = promisify(originalExec)
    const children: Child723[] = [], actualChildren: cp.ChildProcess[] = []
    const track = (child: cp.ChildProcess): Child723 => {
      let ended = false
      const c = { closed: new Promise<void>(resolve => child.once("close", () => { ended = true; resolve() })), isClosed: () => ended, terminate: () => child.exitCode !== null || child.signalCode !== null || child.kill() }
      children.push(c); actualChildren.push(child); return c
    }
    let stage = "SETUP", primary: unknown
    const stop = () => { for (const [i, child] of actualChildren.entries()) if (!children[i].isClosed()) child.kill() }
    // Transparent tracking of the actual default runner. No successful runner stub.
    const wrapped: any = (...args: any[]) => Reflect.apply(originalExec, cp, args)
    Object.defineProperty(wrapped, promisify.custom, { value: (...args: any[]) => {
      assert.ok(captureObserver723, "D1_723_NO_ACTIVE_CAPTURE_OWNER"); return captureObserver723(args)
    } })
    captureObserver723 = (args: any[]) => {
      lease.checkpoint(); remaining723(deadline, performance.now(), 15_000)
      assert.ok(args[0] === ps || path.normalize(args[0]) === path.normalize(ps), "D1_723_FIXED_POWERSHELL")
      assert.ok(args[1][5] === script || args[1][5] === variant, "D1_723_FIXED_CAPTURE_SOURCE")
      assert.equal(args[2].timeout, 15_000)
      const result = originalPromise(...args)
      assert.ok(result.child, "D1_723_REAL_CAPTURE_CHILD_REQUIRED"); track(result.child)
      result.catch(() => {}); return result
    }
    try {
      // Retain only after entering the cleanup scope and before any child starts.
      lease.retain()
      fs.mkdirSync(temp); process.env.TEMP = temp; process.env.TMP = temp; process.env.TMPDIR = temp
      originalScript = fs.readFileSync(script)
      cp.execFile = wrapped
      owned.signal.addEventListener("abort", stop, { once: true })
      lease.checkpoint(); owned.signal.throwIfAborted()
      stage = "FIXTURE_READY"
      const child = originalExec(ps, ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Mode", mode, "-Ready", ready, "-VerifyRequest", request, "-Verified", verified], {
        windowsHide: true, timeout: remaining723(deadline), maxBuffer: 4096,
      }, () => { /* retained close, never callback/exit alone, owns settlement */ })
      const owner = track(child)
      const before = await waitReceipt723(ready, owner, deadline, owned.signal)
      assertSetup723(mode, before, phase => { stage = "FIXTURE_" + phase }); lease.checkpoint()
      stage = "CAPTURE"
      // Import only after installing the transparent actual-child observer.
      const { PsScreenCapturer } = await import("../src/computer/win-adapters")
      const { runPs, resolveWinScript } = await import("../src/host-use/win/powershell")
      const { ComputerError } = await import("../src/computer/types")
      assert.ok(path.resolve(resolveWinScript("computer-capture.ps1")) === script, "D1_723_ACTUAL_PRODUCTION_SCRIPT_REQUIRED")
      const force = mode === "partial" || mode === "occluded" || mode === "nonforeground"
      if (force) fs.writeFileSync(variant, forcedFallback723(originalScript.toString("utf8")), { flag: "wx", mode: 0o600 })
      const capturer = force ? new PsScreenCapturer((_file, args, opts) => runPs(variant, args, opts)) : new PsScreenCapturer()
      remaining723(deadline, performance.now(), 15_000)
      if (mode === "minimized" || mode === "nonforeground") {
        const expectedReason = mode === "minimized" ? "passive target is minimized" : "target is not foreground"
        await assert.rejects(capturer.captureWindow(before.hwnd, { passive: true }), (e: unknown) =>
          e instanceof ComputerError && e.code === "CAPTURE_FAILED" && e.message === `computer.capture: ${expectedReason}` &&
          e.detail?.psPrefix === "CAPTUREFAILED", "passive refusal must match its actual fixed PS reason")
      } else {
        const meta = await capturer.captureWindow(before.hwnd, { passive: true })
        try {
          assert.equal(meta.capture_method, mode === "printwindow" ? "printwindow" : "bitblt")
          assert.equal(meta.observation_quality, mode === "printwindow" ? "ok" : mode)
          assert.ok(meta.fallbackUsed === (mode !== "printwindow") && meta.black === false)
          assert.ok(Array.isArray(meta.occludedBy), "finite observed occluder array required")
          if (mode === "occluded") assert.ok(meta.occludedBy.some(row => row.hwnd === before.other), "exact owned overlay must be observed")
          else assert.equal(meta.occludedBy.length, 0)
        } finally { fs.rmSync(meta.path, { force: true }) }
      }
      stage = "VERIFY"
      lease.checkpoint(); remaining723(deadline)
      const check = waitReceipt723(verified, owner, deadline, owned.signal)
      fs.writeFileSync(request, "VERIFY", { flag: "wx", mode: 0o600 })
      assertUnchanged723(before, await check)
      assert.ok(fs.readFileSync(script).equals(originalScript), "production capture script unchanged")
      owned.diagnostic(`D1_CAPTURE_723_${mode.toUpperCase()}_NATIVE_PASS`)
    } catch { primary = Error(`D1_CAPTURE_723_${stage}_FAILED`) }
    finally {
      captureObserver723 = undefined; cp.execFile = originalExec; owned.signal.removeEventListener("abort", stop)
      try { await cleanup723(children, () => {
        const current = fs.lstatSync(dir, { bigint: true })
        assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino, "D1_723_CLEANUP_IDENTITY")
        fs.rmSync(dir, { recursive: true, force: true }); lease.settled()
      }, primary) } finally {
        for (const key of ["TEMP", "TMP", "TMPDIR"] as const) { if (tempBefore[key] === undefined) delete process.env[key]; else process.env[key] = tempBefore[key] }
      }
    }
  })
})
