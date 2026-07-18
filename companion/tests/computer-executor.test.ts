// WP1 computer task executor — safety-property tests with injected fakes
// (plan G.3 mock boundary). Real SendInput never runs here; the injector is a
// RecordingInjector. Assertions target PROPERTIES (fail-closed codes, required
// re-confirms, no-path denials), never message shapes.

import test from "node:test"
import assert from "node:assert/strict"

import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import { PsLocator } from "../src/computer/win-adapters"
import {
  ComputerError,
  type CaptureMeta,
  type ComputerAction,
  type InputInjector,
  type Locator,
  type OcrResult,
  type OcrWord,
  type ScreenCapturer,
  type WindowEnumerator,
  type WindowInfo,
} from "../src/computer/types"
import type { EvidenceActionRecord, EvidenceSink } from "../src/computer/evidence"
import type { CompanionConfig } from "../src/config"
import type { SecurityConfirmationDetails } from "../src/security-confirmation"

// --- fixtures ---------------------------------------------------------------

const EXE = "C:\\Program Files\\TestApp\\app.exe"
const HWND = 424242

function testConfig(overrides: { coordinateEnabled?: boolean; coordinateAllowed?: boolean; exePath?: string } = {}): CompanionConfig {
  return {
    apps: {
      enabled: true,
      entries: {
        "win.app.test": {
          token: "win.app.test",
          kind: "gui",
          display_name: "Test App",
          source: "user",
          policy: "manual",
          enabled: true,
          added_at: "2026-07-18T10:00:00.000Z",
          exe: { path: overrides.exePath ?? EXE, signer: "CN=Test", user_writable_dir: false },
          ...(overrides.coordinateAllowed !== undefined ? { coordinateAllowed: overrides.coordinateAllowed } : { coordinateAllowed: true }),
        },
      },
    },
    computer: { coordinateEnabled: overrides.coordinateEnabled ?? true },
  } as unknown as CompanionConfig
}

function winInfo(overrides: Partial<WindowInfo> = {}): WindowInfo {
  return {
    hwnd: HWND,
    pid: 1234,
    exePath: EXE,
    title: "Test App",
    rect: { x: 100, y: 100, width: 640, height: 480 },
    alive: true,
    ...overrides,
  }
}

function shot(path: string): CaptureMeta {
  return {
    hwnd: HWND,
    rect: { x: 100, y: 100, width: 640, height: 480 },
    client: { x: 10, y: 40, width: 620, height: 430 },
    dpi: 96,
    path,
    sha256: "deadbeef",
    black: false,
    fallbackUsed: false,
    osrBlackSuspected: false,
  }
}

class FakeCapturer implements ScreenCapturer {
  captures = 0
  diffs: number[] = []
  constructor(private diffScript: number[] = []) {}
  async captureWindow(): Promise<CaptureMeta> {
    this.captures += 1
    return shot(`cap-${this.captures}.png`)
  }
  async crop(_s: string, _r: any, out: string): Promise<string> { return out }
  async diff(): Promise<{ diffRatio: number }> {
    const v = this.diffScript.length > 0 ? this.diffScript.shift()! : 0
    this.diffs.push(v)
    return { diffRatio: v }
  }
  async diffRegion(): Promise<{ diffRatio: number }> {
    // R4 pixel channel consumes the SAME script as whole-frame diffs, in
    // call order (region check runs before the post-action whole diff).
    return this.diff()
  }
}

const realLocate = PsLocator.prototype.locate

class FakeLocator implements Locator {
  ocrCalls = 0
  constructor(private words: OcrWord[]) {}
  async ensureLanguage(): Promise<void> {}
  async ocr(): Promise<OcrResult> {
    this.ocrCalls += 1
    return { language: "zh-Hans", words: this.words }
  }
  locate(result: OcrResult, text: string) {
    return realLocate.call(this, result, text)
  }
}

class RecordingInjector implements InputInjector {
  clicks: Array<{ hwnd: number; x: number; y: number; kind: string }> = []
  types: Array<{ hwnd: number; text: string }> = []
  foreground: number = HWND
  alive = true
  async click(hwnd: number, x: number, y: number, kind: any): Promise<void> {
    this.clicks.push({ hwnd, x, y, kind })
  }
  async typeText(hwnd: number, text: string): Promise<void> {
    this.types.push({ hwnd, text })
  }
  async probeWindow(): Promise<WindowInfo> { return winInfo({ alive: this.alive }) }
  async foregroundHwnd(): Promise<number> { return this.foreground }
}

class FakeWindows implements WindowEnumerator {
  constructor(private info: WindowInfo = winInfo()) {}
  async enumerateByExe(): Promise<WindowInfo[]> { return [this.info] }
  async infoForHwnd(): Promise<WindowInfo> { return this.info }
}

class FakeEvidence implements EvidenceSink {
  readonly dir = "evidence-dir"
  sealed: Array<{ seq: number; phase: string; blur: any[] }> = []
  records: EvidenceActionRecord[] = []
  async init(): Promise<void> {}
  async sealScreenshot(_raw: string, seq: number, phase: string, blurRects: any[]): Promise<{ sha256: string }> {
    this.sealed.push({ seq, phase, blur: blurRects })
    return { sha256: `sha-${seq}-${phase}` }
  }
  async appendAction(r: EvidenceActionRecord): Promise<void> { this.records.push(r) }
  async finalize(): Promise<void> {}
}

interface ConfirmCall { details: SecurityConfirmationDetails }
function scriptedConfirm(behaviors: boolean[], captured: ConfirmCall[] = []) {
  let i = 0
  return {
    captured,
    fn: async (details: SecurityConfirmationDetails) => {
      captured.push({ details })
      const approved = behaviors[Math.min(i, behaviors.length - 1)]
      i += 1
      return { confirmationId: `c${i}`, approved, reason: approved ? "approved" as const : "denied" as const }
    },
  }
}

const OK_WORDS: OcrWord[] = [{ text: "确定", x: 160, y: 208, w: 60, h: 30 }]

function makeDeps(overrides: Partial<ComputerExecutorDeps> = {}): ComputerExecutorDeps {
  return {
    capturer: new FakeCapturer(),
    locator: new FakeLocator(OK_WORDS),
    injector: new RecordingInjector(),
    windows: new FakeWindows(),
    evidenceFactory: () => new FakeEvidence(),
    confirm: scriptedConfirm([true]).fn,
    config: testConfig(),
    now: () => 1000000,
    sleep: async () => {},
    ...overrides,
  }
}

const clickOk: ComputerAction = { action: "click", target: "确定" }

// --- happy path ---------------------------------------------------------------

test("executor: OCR-located click executes and is crossverified via the pixel-region channel (R4)", async () => {
  const injector = new RecordingInjector()
  const evidence = new FakeEvidence()
  const deps = makeDeps({ injector, evidenceFactory: () => evidence })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.success, true)
  assert.equal(injector.clicks.length, 1)
  // OCR image-space (190,223) - client offset (10,40) = client (180,183)
  assert.deepEqual([injector.clicks[0].x, injector.clicks[0].y], [180, 183])
  assert.equal(evidence.records[0].crossverified, true)
  assert.equal(evidence.records[0].crossverifyChannel, "pixel-region", "R4: honest channel label, not semantic OCR<->UIA")
  assert.equal(evidence.records[0].uncrossverified, false)
  assert.equal(evidence.records[0].layer, "ocr")
  assert.equal(evidence.sealed.length, 2) // before + after
})

test("executor: type action executes when text is in the confirmed corpus", async () => {
  const injector = new RecordingInjector()
  const deps = makeDeps({ injector })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "type", text: "青花瓷" }] },
    deps,
  )
  assert.equal(r.success, true)
  assert.deepEqual(injector.types.map((t) => t.text), ["青花瓷"])
})

// --- A10 / whitelist fail-closed ----------------------------------------------

test("executor: global switch off -> COMPUTER_DISABLED, nothing injected", async () => {
  const injector = new RecordingInjector()
  const deps = makeDeps({ injector, config: testConfig({ coordinateEnabled: false }) })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.success, false)
  assert.equal(r.errorCode, "COMPUTER_DISABLED")
  assert.equal(injector.clicks.length, 0)
})

test("executor: app bit off -> APP_COORDINATE_DENIED", async () => {
  const deps = makeDeps({ config: testConfig({ coordinateAllowed: false }) })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "APP_COORDINATE_DENIED")
})

test("executor: hwnd ownership drift mid-task -> HWND_NOT_OWNED, fail-closed", async () => {
  const windows = new FakeWindows(winInfo({ exePath: "C:\\evil\\replaced.exe" }))
  const injector = new RecordingInjector()
  const deps = makeDeps({ windows, injector })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "HWND_NOT_OWNED")
  assert.equal(injector.clicks.length, 0)
})

test("executor: coordinates outside the client rect -> OUT_OF_BOUNDS (never clamped)", async () => {
  const deps = makeDeps()
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "click", x: 9999, y: 0 }] },
    deps,
  )
  assert.equal(r.errorCode, "OUT_OF_BOUNDS")
})

// --- A1 pixel check -------------------------------------------------------------

test("executor: unstable region with failed re-locate -> STALE_SCREENSHOT, no injection", async () => {
  const capturer = new FakeCapturer([0.5]) // region diff = 0.5 > threshold
  const injector = new RecordingInjector()
  const deps = makeDeps({ capturer, injector })
  // Two-stage locator: first locate succeeds, re-locate on the fresh frame
  // finds nothing.
  const twoStage: Locator = {
    async ensureLanguage() {},
    calls: 0,
    async ocr(this: any) {
      this.calls += 1
      return { language: "zh-Hans", words: this.calls === 1 ? OK_WORDS : [] }
    },
    locate(result: OcrResult, text: string) { return realLocate.call(this, result, text) },
  } as unknown as Locator
  deps.locator = twoStage
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "STALE_SCREENSHOT")
  assert.equal(injector.clicks.length, 0)
})

test("executor: unstable region with successful re-locate proceeds with FRESH coordinates, honestly uncrossverified", async () => {
  const capturer = new FakeCapturer([0.5])
  const twoStage: Locator = {
    async ensureLanguage() {},
    calls: 0,
    async ocr(this: any) {
      this.calls += 1
      // second OCR: button moved 100px right
      return { language: "zh-Hans", words: this.calls === 1 ? OK_WORDS : [{ text: "确定", x: 260, y: 208, w: 60, h: 30 }] }
    },
    locate(result: OcrResult, text: string) { return realLocate.call(this, result, text) },
  } as unknown as Locator
  const injector = new RecordingInjector()
  const evidence = new FakeEvidence()
  const deps = makeDeps({ capturer, locator: twoStage, injector, evidenceFactory: () => evidence })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.success, true)
  // fresh coords: image (290,223) - offset (10,40) = (280,183)
  assert.deepEqual([injector.clicks[0].x, injector.clicks[0].y], [280, 183])
  // R4: the pixel channel DISAGREED — the re-located click is uncrossverified
  assert.equal(evidence.records[0].crossverified, false)
  assert.equal(evidence.records[0].uncrossverified, true)
  assert.equal(evidence.records[0].crossverifyChannel, undefined)
})

// --- uncrossverified sub-budget -------------------------------------------------

test("executor: 4th explicit-coordinate click forces a new L2 (uncrossverified > 3)", async () => {
  const confirm = scriptedConfirm([true])
  const deps = makeDeps({ confirm: confirm.fn })
  const actions: ComputerAction[] = [1, 2, 3, 4].map((i) => ({ action: "click", x: 10 + i, y: 10 }))
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions }, deps)
  assert.equal(r.success, true)
  assert.equal(confirm.captured.length, 1, "one re-L2 for the 4th uncrossverified click")
  assert.ok(confirm.captured[0].details.code.includes("交叉验证"))
})

test("executor: uncrossverified re-L2 denied -> UNCROSS_DENIED, remaining clicks not injected", async () => {
  const confirm = scriptedConfirm([false])
  const injector = new RecordingInjector()
  const deps = makeDeps({ confirm: confirm.fn, injector })
  const actions: ComputerAction[] = [1, 2, 3, 4, 5].map((i) => ({ action: "click", x: 10 + i, y: 10 }))
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions }, deps)
  assert.equal(r.errorCode, "UNCROSS_DENIED")
  assert.equal(injector.clicks.length, 3, "only the first 3 sub-budget clicks landed")
})

// --- budget --------------------------------------------------------------------

test("executor: budget exhaustion forces a new L2; denial stops the task (BUDGET_DENIED)", async () => {
  const confirm = scriptedConfirm([false])
  const injector = new RecordingInjector()
  const deps = makeDeps({ confirm: confirm.fn, injector })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", budget: 1, actions: [clickOk, clickOk] },
    deps,
  )
  assert.equal(r.errorCode, "BUDGET_DENIED")
  assert.equal(injector.clicks.length, 1)
})

test("executor: budget renewal approved -> task continues", async () => {
  const confirm = scriptedConfirm([true])
  const injector = new RecordingInjector()
  const deps = makeDeps({ confirm: confirm.fn, injector })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", budget: 1, actions: [clickOk, clickOk] },
    deps,
  )
  assert.equal(r.success, true)
  assert.equal(injector.clicks.length, 2)
})

// --- A4 / A2 danger -------------------------------------------------------------

test("executor: payment word in the click region -> DANGER_HARD_DENY with NO re-L2 (A4)", async () => {
  const confirm = scriptedConfirm([true])
  const injector = new RecordingInjector()
  const locator = new FakeLocator([{ text: "立即支付", x: 160, y: 208, w: 120, h: 30 }])
  const deps = makeDeps({ confirm: confirm.fn, injector, locator })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "click", target: "立即支付" }] },
    deps,
  )
  assert.equal(r.errorCode, "DANGER_HARD_DENY")
  assert.equal(injector.clicks.length, 0)
  assert.equal(confirm.captured.length, 0, "hard deny has NO re-confirm path")
})

test("executor: window-level payment word + type -> re-L2 (has a path), NOT hard deny (R5)", async () => {
  const confirm = scriptedConfirm([true])
  const injector = new RecordingInjector()
  const locator = new FakeLocator([{ text: "立即支付", x: 400, y: 300, w: 120, h: 30 }])
  const deps = makeDeps({ confirm: confirm.fn, injector, locator })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "type", text: "青花瓷" }] },
    deps,
  )
  assert.equal(r.success, true, "approved re-L2 lets the type proceed")
  assert.equal(confirm.captured.length, 1, "window-level hard goes through the re-L2 channel")
  assert.deepEqual(injector.types.map((t) => t.text), ["青花瓷"])
})

test("executor: window-level payment word + type, re-L2 denied -> DANGER_DENIED_BY_USER (R5)", async () => {
  const confirm = scriptedConfirm([false])
  const injector = new RecordingInjector()
  const locator = new FakeLocator([{ text: "立即支付", x: 400, y: 300, w: 120, h: 30 }])
  const deps = makeDeps({ confirm: confirm.fn, injector, locator })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "type", text: "青花瓷" }] },
    deps,
  )
  assert.equal(r.errorCode, "DANGER_DENIED_BY_USER")
  assert.equal(injector.types.length, 0, "denied re-L2 blocks the injection")
})

test("executor: destructive word in region -> re-L2; denial blocks the click (A2)", async () => {
  const confirm = scriptedConfirm([false])
  const injector = new RecordingInjector()
  const locator = new FakeLocator([{ text: "确认删除", x: 160, y: 208, w: 120, h: 30 }])
  const deps = makeDeps({ confirm: confirm.fn, injector, locator })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "click", target: "确认删除" }] },
    deps,
  )
  assert.equal(r.errorCode, "DANGER_DENIED_BY_USER")
  assert.equal(injector.clicks.length, 0)
  assert.equal(confirm.captured.length, 1)
})

test("executor: type into credential context -> DANGER_HARD_DENY, no path (A4.3)", async () => {
  const confirm = scriptedConfirm([true])
  const injector = new RecordingInjector()
  const locator = new FakeLocator([{ text: "密码", x: 50, y: 50, w: 60, h: 30 }])
  const deps = makeDeps({ confirm: confirm.fn, injector, locator })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "type", text: "hunter2" }] },
    deps,
  )
  assert.equal(r.errorCode, "DANGER_HARD_DENY")
  assert.equal(injector.types.length, 0)
  assert.equal(confirm.captured.length, 0)
})

// --- A2 dialog invariant ----------------------------------------------------------

test("executor: foreground change after action -> pause + re-L2; denial stops (A2)", async () => {
  const confirm = scriptedConfirm([false])
  const injector = new RecordingInjector()
  injector.foreground = 999999 // a new dialog stole foreground after the click
  const deps = makeDeps({ confirm: confirm.fn, injector })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "DIALOG_PAUSED_DENIED")
  assert.equal(confirm.captured.length, 1)
  assert.ok(confirm.captured[0].details.code.includes("对话框"))
})

test("executor: large post-action whole-window diff -> dialog pause re-L2", async () => {
  const confirm = scriptedConfirm([true])
  // [region cross-check 0 = stable, post-action whole-window diff 0.9]
  const capturer = new FakeCapturer([0, 0.9])
  const deps = makeDeps({ confirm: confirm.fn, capturer })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.success, true, "approved re-L2 lets the task finish")
  assert.equal(confirm.captured.length, 1)
})

// --- read-only actions -------------------------------------------------------------

test("executor: screenshot/describe/wait do not consume the action budget", async () => {
  const injector = new RecordingInjector()
  const deps = makeDeps({ injector })
  const actions: ComputerAction[] = [
    { action: "screenshot" },
    { action: "describe" },
    { action: "wait", ms: 100 },
    clickOk,
  ]
  const r = await runComputerTask({ task: "t", app: "win.app.test", budget: 1, actions }, deps)
  assert.equal(r.success, true)
  assert.equal(injector.clicks.length, 1, "budget 1 still allows the single click")
  const describe = r.steps.find((s) => s.action === "describe")
  assert.ok(describe?.untrustedText?.includes("确定"), "describe returns OCR text as untrusted data")
})

// --- missing anchor ------------------------------------------------------------------

test("executor: OCR anchor not found -> ELEMENT_NOT_FOUND, nothing injected", async () => {
  const injector = new RecordingInjector()
  const deps = makeDeps({ injector, locator: new FakeLocator([]) })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "ELEMENT_NOT_FOUND")
  assert.equal(injector.clicks.length, 0)
})

test("executor: OCR language missing propagates as OcrLanguageMissing typed skip", async () => {
  const locator: Locator = {
    async ensureLanguage() {},
    async ocr() { throw new ComputerError("OCR_LANGUAGE_MISSING", "no zh pack") },
    locate() { return null },
  }
  const deps = makeDeps({ locator })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "OCR_LANGUAGE_MISSING")
})
