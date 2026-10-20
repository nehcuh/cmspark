// WP1 computer task executor — safety-property tests with injected fakes
// (plan G.3 mock boundary). Real SendInput never runs here; the injector is a
// RecordingInjector. Assertions target PROPERTIES (fail-closed codes, required
// re-confirms, no-path denials), never message shapes.

import test from "node:test"
import assert from "node:assert/strict"
import * as os from "os"

import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import { PsLocator } from "../src/computer/win-adapters"
import { PsScreenCapturer } from "../src/computer/win-adapters"
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
import { ComputerSessionTrust } from "../src/computer/session-trust"
import type { CompanionConfig } from "../src/config"
import type { SecurityConfirmationDetails } from "../src/security-confirmation"

// --- fixtures ---------------------------------------------------------------

const EXE = "C:\\Program Files\\TestApp\\app.exe"
const HWND = 424242

function testConfig(overrides: { coordinateEnabled?: boolean; coordinateAllowed?: boolean; exePath?: string; exeSha256?: string; companionUiBasenames?: string[] } = {}): CompanionConfig {
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
          exe: {
            path: overrides.exePath ?? EXE,
            signer: "CN=Test",
            user_writable_dir: false,
            ...(overrides.exeSha256 !== undefined ? { sha256: overrides.exeSha256 } : {}),
          },
          ...(overrides.coordinateAllowed !== undefined ? { coordinateAllowed: overrides.coordinateAllowed } : { coordinateAllowed: true }),
        },
      },
    },
    computer: { coordinateEnabled: overrides.coordinateEnabled ?? true },
    // UX-spike 2026-07-23: FOREGROUND-YIELD self-UI recovery allow-list. The
    // production default lives in config.ts; tests opt in via this override.
    ...(overrides.companionUiBasenames !== undefined
      ? { security: { companion_ui_exe_basenames: overrides.companionUiBasenames } }
      : {}),
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

const observed723 = (quality: "ok" | "partial" | "occluded") => ({
  fallbackUsed: quality !== "ok",
  capture_method: quality === "ok" ? "printwindow" : "bitblt",
  observation_quality: quality,
  occludedBy: quality === "occluded" ? [{ hwnd: 99, rect: { x: 100, y: 100, width: 20, height: 20 }, className: "OwnedTest" }] : [],
})

test("#723 actual Windows adapter retains closed observation and internal passive argument", async () => {
  let args: string[] = []
  const c = new PsScreenCapturer(async (_script, argv) => {
    args = argv!
    const out = args[args.indexOf("-OutPath") + 1]
    return JSON.stringify({ ...shot(out), sha256: "a".repeat(64), ok: true, ...observed723("occluded") })
  })
  const result = await (c.captureWindow as any)(HWND, { passive: true })
  assert.equal((result as any).observation_quality, "occluded")
  assert.deepEqual((result as any).occludedBy, observed723("occluded").occludedBy)
  assert.ok(args.includes("-Passive"))
})

test("#723 describe taint reaches real result/event/evidence with private OCR and no page body", async t => {
  windows723(t)
  for (const quality of ["occluded", "partial"] as const) {
    let ocrCalls = 0; const events: any[] = [], evidence = new FakeEvidence()
    const { deps } = deps723([winInfo()])
    deps.capturer.captureWindow = async () => ({ ...shot("tainted-723"), ...observed723(quality) } as CaptureMeta)
    deps.locator.ocr = async () => { ocrCalls++; return { language: "zh-Hans", words: [{ text: "DO_NOT_RETURN_PAGE_BODY", x: 0, y: 0, w: 20, h: 10 }] } }
    deps.evidenceFactory = () => evidence; deps.onEvent = e => { events.push(e) }
    const result = await runComputerTask({ task: "read", app: "win.app.test", actions: [{ action: "describe" }] }, deps)
    assert.equal(result.success, true); assert.equal(ocrCalls, 1)
    assert.ok(result.steps[0].untrustedText!.includes(`[host observation: ${quality};`))
    assert.ok(!result.steps[0].untrustedText!.includes("DO_NOT_RETURN_PAGE_BODY"))
    assert.equal((result.steps[0] as any).observation_quality, quality)
    assert.equal(events.find(e => e.event === "step").observation_quality, quality)
    assert.equal((evidence.records[0] as any).observation_quality, quality)
    assert.equal(evidence.sealed.length, 1)
  }
})

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
  keyChords: Array<{ hwnd: number; keys: string[] }> = []
  scrolls: Array<{ hwnd: number; x: number; y: number; delta: number }> = []
  drags: Array<{ hwnd: number; x: number; y: number; x2: number; y2: number }> = []
  foreground: number = HWND
  alive = true
  async click(hwnd: number, x: number, y: number, kind: any): Promise<void> {
    this.clicks.push({ hwnd, x, y, kind })
  }
  async typeText(hwnd: number, text: string): Promise<void> {
    this.types.push({ hwnd, text })
  }
  async keyChord(hwnd: number, keys: string[]): Promise<void> {
    this.keyChords.push({ hwnd, keys })
  }
  async scroll(hwnd: number, x: number, y: number, delta: number): Promise<void> {
    this.scrolls.push({ hwnd, x, y, delta })
  }
  async drag(hwnd: number, x: number, y: number, x2: number, y2: number): Promise<void> {
    this.drags.push({ hwnd, x, y, x2, y2 })
  }
  async probeWindow(): Promise<WindowInfo> { return winInfo({ alive: this.alive }) }
  async foregroundHwnd(): Promise<number> { return this.foreground }
  // UX-spike 2026-07-23: focus-only recovery (FOREGROUND-YIELD self-UI path).
  // The fake simulates a successful re-raise: subsequent foregroundHwnd()
  // returns the target again.
  async forceForeground(hwnd: number): Promise<boolean> {
    this.foreground = hwnd
    return true
  }
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
    securityEnv: { assertInjectable: async () => {} },
    evidenceFactory: () => new FakeEvidence(),
    confirm: scriptedConfirm([true]).fn,
    config: testConfig(),
    now: () => 1000000,
    sleep: async () => {},
    ...overrides,
  }
}

const clickOk: ComputerAction = { action: "click", target: "确定" }

// GitHub: #723. Inert production entry controls; no PowerShell/Win32 execution.
import type { TestContext } from "node:test"
import nativeOs from "node:os"
import * as fs723 from "node:fs"
import * as path723 from "node:path"
import { buildComputerL2PreviewImage } from "../src/computer/l2-preview-image"
import { assertHwndOwnedByEntry } from "../src/computer/policy"

const COCKPIT723 = "CMspark Confirmation Cockpit [723]"
function windows723(t: TestContext) {
  t.mock.method(nativeOs, "platform", () => "win32")
}
function rows723(rows: WindowInfo[], fresh?: WindowInfo): WindowEnumerator {
  return { enumerateByExe: async () => rows, infoForHwnd: async h => fresh ?? rows.find(w => w.hwnd === h)! }
}
function deps723(rows: WindowInfo[], fresh?: WindowInfo) {
  const capturer = new FakeCapturer()
  return { capturer, deps: makeDeps({ windows: rows723(rows, fresh), capturer, removeFile: async () => {} }) }
}
const own723 = () => winInfo({ title: COCKPIT723 + " - Google Chrome", hwnd: 11 })
const main723 = () => winInfo({ hwnd: 10, title: "Document", rect: { x: -32000, y: -32000, width: 0, height: 0 } })

test("#723 executor excludes known cockpit before original score", async t => {
  windows723(t)
  const { deps } = deps723([own723(), main723()])
  const seen: number[] = []
  deps.capturer.captureWindow = async h => { seen.push(h); return shot("raw-723") }
  const result = await runComputerTask({ task: "read", app: "win.app.test", actions: [{ action: "screenshot" }] }, deps)
  assert.equal(result.success, true)
  assert.deepEqual(seen, [10])
})
test("#723 all cockpit rows fail before capture; spoofing only denies", async t => {
  windows723(t)
  const { deps, capturer } = deps723([own723()])
  const result = await runComputerTask({ task: "read", app: "win.app.test", actions: [{ action: "describe" }] }, deps)
  assert.equal(result.errorCode, "COMPUTER_WINDOW_ABSENT")
  assert.equal(capturer.captures, 0)
})
test("#723 ownership refuses same-exe cockpit; absent marker grants nothing", t => {
  windows723(t)
  const entry = testConfig().apps!.entries["win.app.test"]
  for (const title of [COCKPIT723, COCKPIT723 + " - Google Chrome"]) {
    assert.throws(() => assertHwndOwnedByEntry(winInfo({ title }), entry), { code: "HWND_NOT_OWNED" })
  }
  assert.throws(() => assertHwndOwnedByEntry(winInfo({ exePath: "C:\\foreign.exe" }), entry), { code: "HWND_NOT_OWNED" })
  assert.throws(() => assertHwndOwnedByEntry(winInfo({ alive: false }), entry), { code: "HWND_DEAD" })
  for (const title of ["CMspark document", "Confirmation", COCKPIT723 + "suffix", "x" + COCKPIT723]) {
    assert.doesNotThrow(() => assertHwndOwnedByEntry(winInfo({ title }), entry))
  }
})
test("#723 current target becomes cockpit after selection: read never captures", async t => {
  windows723(t)
  const { deps, capturer } = deps723([main723()], { ...own723(), hwnd: 10 })
  const result = await runComputerTask({ task: "read", app: "win.app.test", actions: [{ action: "describe" }] }, deps)
  assert.equal(result.errorCode, "HWND_NOT_OWNED")
  assert.equal(capturer.captures, 0)
})
test("#723 preview independently excludes cockpit and refuses late title change", async t => {
  windows723(t)
  for (const [rows, fresh, expected] of [
    [[own723(), main723()], undefined, [10]],
    [[own723()], undefined, []],
    [[main723()], { ...own723(), hwnd: 10 }, []],
  ] as Array<[WindowInfo[], WindowInfo | undefined, number[]]>) {
    const seen: number[] = [], removed: string[] = []
    await buildComputerL2PreviewImage({
      windows: rows723(rows, fresh), capturer: Object.assign(new FakeCapturer(), { captureWindow: async (h: number) => { seen.push(h); return shot("preview-723") } }),
      locator: new FakeLocator(OK_WORDS), previewBuilder: { build: async () => "FINITE" }, removeFile: async f => { removed.push(f) },
    }, { exePath: EXE, appDisplayName: "Owned", actions: [clickOk] })
    assert.deepEqual(seen, expected)
    assert.deepEqual(removed, expected.length ? ["preview-723"] : [])
  }
})
test("#723 non-Windows selection semantics stay unchanged", async t => {
  t.mock.method(nativeOs, "platform", () => "linux")
  const { deps } = deps723([own723(), main723()]); const seen: number[] = []
  deps.capturer.captureWindow = async h => { seen.push(h); return shot("raw-723") }
  await runComputerTask({ task: "read", app: "win.app.test", actions: [{ action: "screenshot" }] }, deps)
  assert.deepEqual(seen, [11])
})

const repo723 = fs723.existsSync(path723.resolve(process.cwd(), "src/host-use/win/scripts/computer-capture.ps1")) ? path723.resolve(process.cwd(), "..") : process.cwd()
const ps723 = () => fs723.readFileSync(path723.join(repo723, "companion/src/host-use/win/scripts/computer-capture.ps1"), "utf8").replace(/\r\n/g, "\n")
test("#723 final PS boundary has bounded non-authorizing title refusal before window effects", () => {
  const ps = ps723(), capture = ps.slice(ps.indexOf("# ---- capture mode"))
  assert.ok(ps.includes('CharSet=CharSet.Unicode'))
  assert.ok(ps.includes('new System.Text.StringBuilder(512)'))
  assert.ok(ps.includes(COCKPIT723))
  assert.ok(capture.indexOf("Refuse-CockpitWindow $hwndPtr") < capture.indexOf("[CapW32]::IsIconic"))
  const finalTitle = 'if ([CapW32]::IsCockpitWindow($hwndPtr)) { $bmp.Dispose(); Fail "CAPTUREFAILED"'
  assert.ok(ps.includes(finalTitle))
  assert.ok(ps.indexOf(finalTitle) < ps.indexOf("$bmp.Save($OutPath"))
  const crop = ps.slice(ps.indexOf("# ---- crop-only"), ps.indexOf("# ---- capture mode"))
  assert.ok(!crop.includes("Refuse-CockpitWindow"))
})
test("#723 fallback consumes force result and checks exact foreground before copy and save", () => {
  const ps = ps723(), fallback = ps.slice(ps.indexOf("if ((-not $printed) -or $black)"), ps.indexOf("$bmp.Save($OutPath"))
  assert.ok(fallback.includes('if (-not [CapW32]::ForceForeground($hwndPtr)) { Fail "CAPTUREFAILED"'))
  assert.ok(fallback.includes('if ([CapW32]::GetForegroundWindow() -ne $hwndPtr) { Fail "CAPTUREFAILED"'))
  assert.ok(fallback.includes('if (-not [CapW32]::GetWindowRect($hwndPtr, [ref]$r)) { Fail "CAPTUREFAILED"'))
  assert.ok(ps.includes('if ($fallbackUsed -and [CapW32]::GetForegroundWindow() -ne $hwndPtr) { $bmp.Dispose(); Fail "CAPTUREFAILED"'))
  assert.ok(!fallback.includes('ForceForeground($hwndPtr) | Out-Null'))
  assert.equal((fallback.match(/ForceForeground\(/g) ?? []).length, 1)
  assert.equal((fallback.match(/Start-Sleep -Milliseconds 250/g) ?? []).length, 1)
  assert.ok(fallback.includes('if (-not $ok) { $bmp.Dispose(); Fail "CAPTUREFAILED"'))
  assert.ok(fallback.includes('if ($black) { $bmp.Dispose(); Fail "CAPTUREFAILED"'))
})
test("#723 initial rect query failure is consumed; title literal agrees with extension", () => {
  const ps = ps723()
  assert.ok(ps.includes('if (-not [CapW32]::GetWindowRect($hwndPtr, [ref]$r)) { Fail "HWNDDEAD"'))
  const cockpit = fs723.readFileSync(path723.join(repo723, "chrome-extension/src/tabs/cockpit.tsx"), "utf8")
  assert.ok(cockpit.includes('document.title = "' + COCKPIT723 + '"'))
})

// Limited lowering of the actual PS guards, not a PowerShell interpreter or a
// native success simulation. Unsupported expressions fail this test closed.
function fallbackGuards723(source: string) {
  const expressions = [
    ["force", "-not [CapW32]::ForceForeground($hwndPtr)"],
    ["foreground", "[CapW32]::GetForegroundWindow() -ne $hwndPtr"],
    ["rect", "-not [CapW32]::GetWindowRect($hwndPtr, [ref]$r)"],
    ["save", "$fallbackUsed -and [CapW32]::GetForegroundWindow() -ne $hwndPtr"],
  ] as const
  return expressions.map(([name, expression]) => {
    const literal = `if (${expression}) { `
    const index = source.indexOf(literal, source.indexOf("if ((-not $printed) -or $black)"))
    assert.ok(index >= 0, `actual ${name} guard must exist`)
    assert.ok(source.slice(index + literal.length).startsWith(name === "save" ? '$bmp.Dispose(); Fail "CAPTUREFAILED"' : 'Fail "CAPTUREFAILED"'))
    const actual = source.slice(index + 4, index + 4 + expression.length)
    // Only the four closed, exact expressions above enter this lowering.
    const js = actual.replace("[CapW32]::ForceForeground($hwndPtr)", "native.force()")
      .replace("[CapW32]::GetForegroundWindow()", "native.foreground()")
      .replace("[CapW32]::GetWindowRect($hwndPtr, [ref]$r)", "native.rect()")
      .replace("$hwndPtr", "1").replace("$fallbackUsed", "fallbackUsed")
      .replace("-not ", "!").replace(" -ne ", " !== ").replace(" -and ", " && ")
    const predicate = new Function("native", "fallbackUsed", `return (${js})`) as (native: object, fallback: boolean) => boolean
    return { name, index, evaluate: (v: Record<string, boolean>) => predicate({
      force: () => v.force, rect: () => v.rect,
      foreground: () => (name === "save" ? v.saveForeground : v.foreground) ? 1 : 2,
    }, v.fallback) }
  })
}
test("#723 PS source-derived fallback known-failure matrix never reaches save", () => {
  const ps = ps723(), guards = fallbackGuards723(ps)
  for (const g of guards) assert.ok(g.index >= 0, `actual ${g.name} refusal must exist`)
  const copy = ps.indexOf("$ok = [CapW32]::BitBlt"), save = ps.indexOf("$bmp.Save($OutPath")
  assert.ok(guards[0].index < guards[1].index && guards[1].index < guards[2].index && guards[2].index < copy)
  assert.ok(copy < guards[3].index && guards[3].index < save)
  for (let bits = 0; bits < 16; bits++) {
    const values = { fallback: true, force: !!(bits & 1), foreground: !!(bits & 2), rect: !!(bits & 4), saveForeground: !!(bits & 8) }
    const rejected = guards.some(g => g.evaluate(values))
    assert.equal(rejected, bits !== 15)
  }
  assert.equal(guards[3].evaluate({ fallback: false, saveForeground: false }), false, "usable PrintWindow does not gain a foreground requirement")
})
test("#723 original scoring matrix and spoof-safe title boundary are retained", async t => {
  windows723(t)
  for (const rows of [
    [winInfo({ hwnd: 12, title: "", rect: { x: 0, y: 0, width: 1728, height: 33 } }), winInfo({ hwnd: 10 })],
    [own723(), winInfo({ hwnd: 10 })],
    [winInfo({ hwnd: 12, title: "", rect: { x: 0, y: 0, width: 500, height: 500 } }), winInfo({ hwnd: 10 })],
  ]) {
    const { deps } = deps723(rows), seen: number[] = []
    deps.capturer.captureWindow = async h => { seen.push(h); return shot("raw-723") }
    const result = await runComputerTask({ task: "read", app: "win.app.test", actions: [{ action: "screenshot" }] }, deps)
    assert.equal(result.success, true); assert.deepEqual(seen, [10])
  }
})
test("#723 capture refusal propagates without OCR/seal or fabricated image", async t => {
  windows723(t)
  let ocr = 0; const evidence = new FakeEvidence()
  const { deps } = deps723([winInfo()])
  deps.evidenceFactory = () => evidence
  deps.capturer.captureWindow = async () => { throw new ComputerError("CAPTURE_FAILED", "fixed refusal") }
  deps.locator.ocr = async () => { ocr++; return { language: "zh-Hans", words: [] } }
  const result = await runComputerTask({ task: "read", app: "win.app.test", actions: [{ action: "screenshot" }] }, deps)
  assert.equal(result.errorCode, "CAPTURE_FAILED"); assert.equal(ocr, 0); assert.equal(evidence.sealed.length, 0)
})
