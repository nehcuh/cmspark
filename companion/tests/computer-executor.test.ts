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
  type DiffMetrics,
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

/** X1: script entries are either a bare diffRatio or full zoned metrics. */
type DiffScriptEntry = number | DiffMetrics

class FakeCapturer implements ScreenCapturer {
  captures = 0
  paths: string[] = []
  diffs: number[] = []
  constructor(private diffScript: DiffScriptEntry[] = []) {}
  async captureWindow(): Promise<CaptureMeta> {
    this.captures += 1
    const p = `cap-${this.captures}.png`
    this.paths.push(p)
    return shot(p)
  }
  async crop(_s: string, _r: any, out: string): Promise<string> { return out }
  async diff(): Promise<DiffMetrics> {
    const v = this.diffScript.length > 0 ? this.diffScript.shift()! : 0
    const m: DiffMetrics = typeof v === "number" ? { diffRatio: v } : v
    this.diffs.push(m.diffRatio)
    return m
  }
  async diffRegion(): Promise<{ diffRatio: number }> {
    // R4 pixel channel consumes the SAME script as whole-frame diffs, in
    // call order (region check runs before the post-action whole diff).
    // Zoning is meaningless on a crop — only diffRatio is returned.
    const m = await this.diff()
    return { diffRatio: m.diffRatio }
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
  sealedRaws: string[] = []
  records: EvidenceActionRecord[] = []
  async init(): Promise<void> {}
  async sealScreenshot(raw: string, seq: number, phase: string, blurRects: any[]): Promise<{ sha256: string }> {
    this.sealed.push({ seq, phase, blur: blurRects })
    this.sealedRaws.push(raw)
    return { sha256: `sha-${seq}-${phase}` }
  }
  async appendAction(r: EvidenceActionRecord): Promise<void> { this.records.push(r) }
  async finalize(): Promise<void> {}
}

/** R1 property: every captured raw path is either sealed or swept — none lingers. */
function assertNoRawResidue(capturer: FakeCapturer, evidence: FakeEvidence, removed: string[]) {
  for (const p of capturer.paths) {
    assert.ok(
      evidence.sealedRaws.includes(p) || removed.includes(p),
      `raw ${p} was neither sealed into evidence nor swept (R1 leak)`,
    )
  }
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

// --- X1: zoned pixel channels + new-top-level-window channel --------------------
// A 500x350 dialog in a 1054x736 window measures ~0.12-0.22 whole-window —
// UNDER the 0.3 threshold. The macro-zone / blob / new-hwnd channels must
// catch what the whole-window ratio misses.

test("executor X1: 500×350 对话框必须触发暂停 — zone channel catches the local popup the whole-window ratio misses", async () => {
  const confirm = scriptedConfirm([false])
  // [region cross-check 0 = stable, post-action: whole 0.22 < 0.3 BUT zone saturated]
  const capturer = new FakeCapturer([0, { diffRatio: 0.22, maxZoneRatio: 1.0, maxBlobRatio: 0.22 }])
  const deps = makeDeps({ confirm: confirm.fn, capturer })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "DIALOG_PAUSED_DENIED")
  assert.equal(confirm.captured.length, 1)
  assert.ok(confirm.captured[0].details.code.includes("对话框"))
})

test("executor X1: below all zoned thresholds -> NO pause (no false positive)", async () => {
  const confirm = scriptedConfirm([true])
  // whole 0.22 < 0.3, zone 0.3 < 0.5, blob 0.02 < 0.05 → no channel fires
  const capturer = new FakeCapturer([0, { diffRatio: 0.22, maxZoneRatio: 0.3, maxBlobRatio: 0.02 }])
  const deps = makeDeps({ confirm: confirm.fn, capturer })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.success, true)
  assert.equal(confirm.captured.length, 0)
})

test("executor X1: blob channel alone (zone not saturated) -> dialog pause", async () => {
  const confirm = scriptedConfirm([false])
  // whole 0.1, zone 0.2 — but one coherent 6% blob (small dialog)
  const capturer = new FakeCapturer([0, { diffRatio: 0.1, maxZoneRatio: 0.2, maxBlobRatio: 0.06 }])
  const deps = makeDeps({ confirm: confirm.fn, capturer })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "DIALOG_PAUSED_DENIED")
  assert.equal(confirm.captured.length, 1)
})

test("executor X1: new top-level window of the same exe after the action -> dialog pause", async () => {
  const confirm = scriptedConfirm([false])
  const info = winInfo()
  let enumCalls = 0
  const windows: WindowEnumerator = {
    // call 1 = startup resolve, call 2 = pre-inject snapshot, call 3+ = post-action
    async enumerateByExe() {
      enumCalls += 1
      return enumCalls <= 2 ? [info] : [info, winInfo({ hwnd: 777777, title: "确认操作" })]
    },
    async infoForHwnd() { return info },
  }
  const deps = makeDeps({ confirm: confirm.fn, windows })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "DIALOG_PAUSED_DENIED")
  assert.equal(confirm.captured.length, 1)
})

// --- X5: the after frame gets its OWN credential scan; OCR failure drops it -----

test("executor X5: credential surfacing ONLY in the after frame is blurred (own OCR)", async () => {
  const evidence = new FakeEvidence()
  let ocrCalls = 0
  const staged: Locator = {
    async ensureLanguage() {},
    async ocr() {
      ocrCalls += 1
      // call 1 = locate (clean); call 2 = after frame — a password prompt
      // the click surfaced (the before frame's blur rects know nothing of it)
      return {
        language: "zh-Hans",
        words: ocrCalls === 1 ? OK_WORDS : [{ text: "密码", x: 300, y: 200, w: 60, h: 30 }],
      }
    },
    locate(result: OcrResult, text: string) { return realLocate.call(this, result, text) },
  } as unknown as Locator
  const deps = makeDeps({ locator: staged, evidenceFactory: () => evidence })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.success, true)
  const beforeSeal = evidence.sealed.find((s) => s.phase === "before")!
  const afterSeal = evidence.sealed.find((s) => s.phase === "after")!
  assert.equal(beforeSeal.blur.length, 0, "before frame is clean")
  assert.equal(afterSeal.blur.length, 1, "after frame's OWN credential neighborhood is blurred")
})

test("executor X5: after-frame OCR failure -> frame dropped, never persisted unblurred (A7.4)", async () => {
  const capturer = new FakeCapturer()
  const evidence = new FakeEvidence()
  const removed: string[] = []
  let ocrCalls = 0
  const staged: Locator = {
    async ensureLanguage() {},
    async ocr() {
      ocrCalls += 1
      if (ocrCalls === 1) return { language: "zh-Hans", words: OK_WORDS }
      throw new Error("ocr boom")
    },
    locate(result: OcrResult, text: string) { return realLocate.call(this, result, text) },
  } as unknown as Locator
  const deps = makeDeps({
    capturer,
    locator: staged,
    evidenceFactory: () => evidence,
    removeFile: async (p) => { removed.push(p) },
  })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.success, true, "the action happened — only the unverifiable after frame is dropped")
  assert.deepEqual(evidence.sealedRaws, ["cap-2.png"], "only the before frame is sealed")
  assert.ok(removed.includes("cap-3.png"), "after raw is swept")
  assert.equal(evidence.records[0].afterSha256, undefined)
  assert.equal(evidence.records[0].note, "after frame dropped (OCR unavailable)")
  assertNoRawResidue(capturer, evidence, removed)
})

// --- R1: no plaintext raw residue at ANY exit -------------------------------------

test("executor R1: success path — locate frame swept, before/after sealed, zero residue", async () => {
  const capturer = new FakeCapturer()
  const evidence = new FakeEvidence()
  const removed: string[] = []
  const deps = makeDeps({
    capturer,
    evidenceFactory: () => evidence,
    removeFile: async (p) => { removed.push(p) },
  })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.success, true)
  // cap-1 = locate frame (superseded, swept); cap-2/3 = pre-inject/after (sealed)
  assert.deepEqual(removed, ["cap-1.png"])
  assert.deepEqual(evidence.sealedRaws, ["cap-2.png", "cap-3.png"])
  assertNoRawResidue(capturer, evidence, removed)
})

test("executor R1: ELEMENT_NOT_FOUND — the captured frame is swept at the failure exit", async () => {
  const capturer = new FakeCapturer()
  const evidence = new FakeEvidence()
  const removed: string[] = []
  const deps = makeDeps({
    capturer,
    locator: new FakeLocator([]),
    evidenceFactory: () => evidence,
    removeFile: async (p) => { removed.push(p) },
  })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "ELEMENT_NOT_FOUND")
  assert.deepEqual(evidence.sealedRaws, [])
  assert.deepEqual(removed, ["cap-1.png"])
  assertNoRawResidue(capturer, evidence, removed)
})

test("executor R1: STALE_SCREENSHOT — BOTH the locate and fresh frames are swept", async () => {
  const capturer = new FakeCapturer([0.5])
  const evidence = new FakeEvidence()
  const removed: string[] = []
  const twoStage: Locator = {
    async ensureLanguage() {},
    calls: 0,
    async ocr(this: any) {
      this.calls += 1
      return { language: "zh-Hans", words: this.calls === 1 ? OK_WORDS : [] }
    },
    locate(result: OcrResult, text: string) { return realLocate.call(this, result, text) },
  } as unknown as Locator
  const deps = makeDeps({
    capturer,
    locator: twoStage,
    evidenceFactory: () => evidence,
    removeFile: async (p) => { removed.push(p) },
  })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.errorCode, "STALE_SCREENSHOT")
  assert.deepEqual(evidence.sealedRaws, [])
  assert.deepEqual(removed, ["cap-1.png", "cap-2.png"])
  assertNoRawResidue(capturer, evidence, removed)
})

test("executor R1: DANGER_HARD_DENY — captured frames swept, nothing sealed, no re-L2", async () => {
  const confirm = scriptedConfirm([true])
  const capturer = new FakeCapturer()
  const evidence = new FakeEvidence()
  const removed: string[] = []
  const locator = new FakeLocator([{ text: "立即支付", x: 160, y: 208, w: 120, h: 30 }])
  const deps = makeDeps({
    capturer,
    locator,
    confirm: confirm.fn,
    evidenceFactory: () => evidence,
    removeFile: async (p) => { removed.push(p) },
  })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "click", target: "立即支付" }] },
    deps,
  )
  assert.equal(r.errorCode, "DANGER_HARD_DENY")
  assert.equal(confirm.captured.length, 0)
  assert.deepEqual(evidence.sealedRaws, [])
  assert.deepEqual(removed, ["cap-1.png", "cap-2.png"])
  assertNoRawResidue(capturer, evidence, removed)
})

test("executor R1: read-only describe frame is sealed (sealer-consumed), zero residue", async () => {
  const capturer = new FakeCapturer()
  const evidence = new FakeEvidence()
  const removed: string[] = []
  const deps = makeDeps({
    capturer,
    evidenceFactory: () => evidence,
    removeFile: async (p) => { removed.push(p) },
  })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [{ action: "describe" }] }, deps)
  assert.equal(r.success, true)
  assert.deepEqual(evidence.sealedRaws, ["cap-1.png"])
  assert.deepEqual(removed, [])
  assertNoRawResidue(capturer, evidence, removed)
})

// --- R2: read-only frames are credential-blurred before sealing --------------------

test("executor R2: describe frame carries credentialRects from its OWN OCR result", async () => {
  const evidence = new FakeEvidence()
  const locator = new FakeLocator([{ text: "密码", x: 300, y: 300, w: 40, h: 20 }])
  const deps = makeDeps({ locator, evidenceFactory: () => evidence })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [{ action: "describe" }] }, deps)
  assert.equal(r.success, true)
  assert.equal(evidence.sealed.length, 1)
  assert.equal(evidence.sealed[0].blur.length, 1, "credential neighborhood pixelated before seal")
  const rect = evidence.sealed[0].blur[0]
  assert.equal(rect.x + rect.width / 2, 320, "blur rect centered on the credential word")
  assert.equal(rect.y + rect.height / 2, 310)
})

test("executor R2: screenshot frame is credential-scanned too (no longer a fixed empty blur)", async () => {
  const evidence = new FakeEvidence()
  const locator = new FakeLocator([{ text: "password", x: 100, y: 100, w: 80, h: 20 }])
  const deps = makeDeps({ locator, evidenceFactory: () => evidence })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [{ action: "screenshot" }] }, deps)
  assert.equal(r.success, true)
  assert.equal(evidence.sealed[0].blur.length, 1)
})

test("executor R2: clean window -> read-only frames seal with empty blur (no over-blur)", async () => {
  const evidence = new FakeEvidence()
  const deps = makeDeps({ evidenceFactory: () => evidence }) // OK_WORDS: 确定 only
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "screenshot" }, { action: "describe" }] },
    deps,
  )
  assert.equal(r.success, true)
  assert.equal(evidence.sealed.length, 2)
  assert.deepEqual(evidence.sealed[0].blur, [])
  assert.deepEqual(evidence.sealed[1].blur, [])
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

// --- X4: type.text cap ----------------------------------------------------------

test("executor X4: type text beyond 2000 chars -> TYPE_TEXT_TOO_LONG, nothing injected, no confirm", async () => {
  const confirm = scriptedConfirm([true])
  const injector = new RecordingInjector()
  const deps = makeDeps({ confirm: confirm.fn, injector })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "type", text: "长".repeat(2001) }] },
    deps,
  )
  assert.equal(r.errorCode, "TYPE_TEXT_TOO_LONG")
  assert.equal(injector.types.length, 0)
  assert.equal(confirm.captured.length, 0)
})

test("executor X4: task corpus TOTAL beyond 2000 chars -> TYPE_TEXT_TOO_LONG (task-splitting guard)", async () => {
  const injector = new RecordingInjector()
  const deps = makeDeps({ injector })
  const r = await runComputerTask(
    {
      task: "t",
      app: "win.app.test",
      actions: [
        { action: "type", text: "a".repeat(1200) },
        { action: "type", text: "b".repeat(900) },
      ],
    },
    deps,
  )
  assert.equal(r.errorCode, "TYPE_TEXT_TOO_LONG")
  assert.equal(injector.types.length, 0)
})

test("executor X4: corpus at exactly 2000 chars passes the cap", async () => {
  const injector = new RecordingInjector()
  const deps = makeDeps({ injector })
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "type", text: "z".repeat(2000) }] },
    deps,
  )
  assert.equal(r.success, true)
})

// --- X2: landing-window interception (click occlusion) ----------------------------

test("executor X2: landing point owned by another window -> CLICK_OCCLUDED, fail-closed, no re-L2 path", async () => {
  const confirm = scriptedConfirm([true])
  const injector = new RecordingInjector()
  injector.click = async () => {
    throw new ComputerError("CLICK_OCCLUDED", "point lands on hwnd 999999, not target")
  }
  const evidence = new FakeEvidence()
  const capturer = new FakeCapturer()
  const removed: string[] = []
  const deps = makeDeps({
    capturer,
    injector,
    confirm: confirm.fn,
    evidenceFactory: () => evidence,
    removeFile: async (p) => { removed.push(p) },
  })
  const r = await runComputerTask({ task: "t", app: "win.app.test", actions: [clickOk] }, deps)
  assert.equal(r.success, false)
  assert.equal(r.errorCode, "CLICK_OCCLUDED")
  assert.equal(confirm.captured.length, 0, "occlusion is a hard fail-closed, never a re-L2 question")
  assertNoRawResidue(capturer, evidence, removed)
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
