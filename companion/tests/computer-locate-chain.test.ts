// WP3 — locate-chain degradation matrix (plan §B.1/§B.2) + executor-level
// UIA layer integration. All providers are fakes; assertions target the
// chain's honest semantics: layer order, structured degrade reasons,
// crossverify channels, pixel-region freshness, and error codes.

import test from "node:test"
import assert from "node:assert/strict"

import { locateTargetWithChain, type LocateChainDeps } from "../src/computer/locate-chain"
import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import {
  ComputerError,
  type CaptureMeta,
  type InputInjector,
  type LocateHit,
  type Locator,
  type OcrResult,
  type OcrWord,
  type ScreenCapturer,
  type SecurityEnvironment,
  type UiaLocateHit,
  type UiaLocator,
  type WindowEnumerator,
} from "../src/computer/types"
import type { EvidenceActionRecord, EvidenceSink } from "../src/computer/evidence"
import type { CompanionConfig } from "../src/config"

// --- fakes ------------------------------------------------------------------

const HWND = 424242

function shotAt(path: string, rect = { x: 100, y: 100, width: 640, height: 480 }, client = { x: 10, y: 40, width: 620, height: 430 }): CaptureMeta {
  return { hwnd: HWND, rect, client, dpi: 96, path, sha256: "x", black: false, fallbackUsed: false, osrBlackSuspected: false }
}

function ocrHitAt(x: number, y: number): LocateHit {
  return { x, y, bbox: { x: x - 20, y: y - 10, width: 40, height: 20 }, layer: "ocr", confidence: 0.9, matchedText: "确定" }
}

class FakeLocator implements Locator {
  ocrCalls = 0
  constructor(
    private words: OcrWord[],
    private opts: { available?: boolean; ocrThrows?: ComputerError } = {},
  ) {}
  async ensureLanguage(): Promise<void> {
    if (this.opts.available === false) throw new ComputerError("OCR_LANGUAGE_MISSING", "no zh pack")
  }
  async ocr(): Promise<OcrResult> {
    this.ocrCalls++
    if (this.opts.ocrThrows) throw this.opts.ocrThrows
    return { language: "zh-Hans", words: this.words }
  }
  locate(result: OcrResult, text: string): LocateHit | null {
    for (const w of result.words) {
      if (w.text.includes(text)) return ocrHitAt(w.x + w.w / 2, w.y + w.h / 2)
    }
    return null
  }
}

class FakeCapturer {
  captures = 0
  constructor(private diffScript: number[] = []) {}
  async captureWindow(): Promise<CaptureMeta> {
    this.captures++
    return shotAt(`cap-${this.captures}.png`)
  }
  async diffRegion(): Promise<{ diffRatio: number }> {
    return { diffRatio: this.diffScript.length > 0 ? this.diffScript.shift()! : 0 }
  }
}

function uiaHit(over: Partial<UiaLocateHit> = {}): UiaLocateHit {
  // Screen (250,280) -> image (150,180) with the default shot rect (100,100).
  return {
    x: 250, y: 280,
    bbox: { x: 230, y: 270, width: 40, height: 20 },
    name: "确定", controlType: "Pane", confidence: 1.0, candidates: 1,
    ...over,
  }
}

class FakeUia implements UiaLocator {
  calls = 0
  constructor(private script: Array<UiaLocateHit | null | Error>) {}
  async locate(): Promise<UiaLocateHit | null> {
    this.calls++
    const next = this.script.length > 0 ? this.script.shift()! : null
    if (next instanceof Error) throw next
    return next
  }
}

function chainDeps(over: Partial<LocateChainDeps> = {}): LocateChainDeps {
  return {
    uia: null,
    locator: new FakeLocator([{ text: "确定", x: 130, y: 170, w: 40, h: 20 }]),
    capturer: new FakeCapturer() as any,
    ...over,
  }
}

async function runChain(deps: LocateChainDeps, opts: { staleOnNotFound?: boolean } = {}) {
  const released: string[] = []
  const capturer = deps.capturer as unknown as FakeCapturer
  const result = await locateTargetWithChain({
    target: "确定",
    hwnd: HWND,
    shot: shotAt("cap-0.png"),
    deps,
    trackCapture: async () => capturer.captureWindow(),
    releaseRaw: async (p?: string) => { if (p) released.push(p) },
    ...opts,
  })
  return { result, released, capturer }
}

// --- the matrix ---------------------------------------------------------------

test("chain: L0 hit + witness agree -> layer uia, channel uia+ocr, crossverified", async () => {
  const uia = new FakeUia([uiaHit()])
  const { result } = await runChain(chainDeps({ uia }))
  assert.equal(result.hit.layer, "uia")
  assert.equal(result.hit.confidence, 1.0)
  assert.equal(result.crossverified, true)
  assert.equal(result.crossverifyChannel, "uia+ocr")
  assert.equal(result.uncrossverified, false)
  // screen(250,280) -> image(150,180) -> client(140,140)
  assert.deepEqual(result.pointClient, { x: 140, y: 140 })
  assert.deepEqual(result.attempts.map((a) => [a.layer, a.outcome]), [["uia", "hit"]])
})

test("chain: L0 hit + witness unavailable (no language pack) -> pixel-region channel", async () => {
  const uia = new FakeUia([uiaHit()])
  const locator = new FakeLocator([], { available: false })
  const { result } = await runChain(chainDeps({ uia, locator, ocrAvailable: async () => false }))
  assert.equal(result.hit.layer, "uia")
  assert.equal(result.crossverifyChannel, "pixel-region")
  assert.equal(result.crossverified, true)
  assert.equal(result.ocrRes, null)
})

test("chain: L0 hit + witness DISAGREE -> degrade to L1 (OCR becomes coordinate source)", async () => {
  const uia = new FakeUia([uiaHit({ x: 500, y: 500, bbox: { x: 480, y: 490, width: 40, height: 20 } })])
  // OCR words sit at (130,170) — nowhere near the UIA bbox.
  const locator = new FakeLocator([{ text: "确定", x: 130, y: 170, w: 40, h: 20 }])
  const { result } = await runChain(chainDeps({ uia, locator }))
  assert.equal(result.hit.layer, "ocr")
  assert.equal(result.crossverifyChannel, "pixel-region")
  assert.deepEqual(
    result.attempts.map((a) => [a.layer, a.outcome, a.reason ?? ""]),
    [["uia", "hit", ""], ["uia", "error", "uia-ocr-disagree"], ["ocr", "hit", ""]],
  )
})

test("chain: L0 not-found -> L1 hit, structured degrade reason", async () => {
  const uia = new FakeUia([null])
  const { result } = await runChain(chainDeps({ uia }))
  assert.equal(result.hit.layer, "ocr")
  assert.deepEqual(
    result.attempts.map((a) => [a.layer, a.outcome]),
    [["uia", "not-found"], ["ocr", "hit"]],
  )
})

test("chain: L0 absent (incapable/unprobed) -> skipped with reason, L1 locates", async () => {
  const { result } = await runChain(chainDeps({ uia: null }))
  assert.equal(result.hit.layer, "ocr")
  assert.deepEqual(
    result.attempts.map((a) => [a.layer, a.outcome, a.reason ?? ""]),
    [["uia", "skipped", "uia-incapable-or-unprobed"], ["ocr", "hit", ""]],
  )
})

test("chain: L0 hit + region unstable + live re-probe hit -> uncrossverified uia coords", async () => {
  const uia = new FakeUia([uiaHit(), uiaHit({ x: 260, y: 290 })])
  const capturer = new FakeCapturer([1.0]) // region diff explodes
  const { result } = await runChain(chainDeps({ uia, capturer: capturer as any }))
  assert.equal(uia.calls, 2)
  assert.equal(result.hit.layer, "uia")
  assert.equal(result.crossverified, false)
  assert.equal(result.uncrossverified, true)
  // re-probe screen(260,290) -> image(160,190) -> client(150,150)
  assert.deepEqual(result.pointClient, { x: 150, y: 150 })
})

test("chain: L0 hit + region unstable + re-probe miss -> STALE_SCREENSHOT", async () => {
  const uia = new FakeUia([uiaHit(), null])
  const capturer = new FakeCapturer([1.0])
  await assert.rejects(
    runChain(chainDeps({ uia, capturer: capturer as any })),
    (err: any) => err instanceof ComputerError && err.code === "STALE_SCREENSHOT",
  )
})

test("chain: L1 hit + region unstable + re-locate miss -> STALE_SCREENSHOT (WP1 semantics preserved)", async () => {
  const locator = new FakeLocator([{ text: "确定", x: 130, y: 170, w: 40, h: 20 }])
  // First ocr finds the word; after instability the re-ocr finds nothing.
  let calls = 0
  const flaky: Locator = {
    async ensureLanguage() {},
    async ocr() {
      calls++
      return { language: "zh-Hans", words: calls === 1 ? [{ text: "确定", x: 130, y: 170, w: 40, h: 20 }] : [] }
    },
    locate(result, text) {
      for (const w of result.words) if (w.text.includes(text)) return ocrHitAt(w.x + w.w / 2, w.y + w.h / 2)
      return null
    },
  }
  const capturer = new FakeCapturer([1.0])
  await assert.rejects(
    runChain(chainDeps({ locator: flaky, capturer: capturer as any })),
    (err: any) => err instanceof ComputerError && err.code === "STALE_SCREENSHOT",
  )
})

test("chain: L0 skipped + L1 language-missing -> honest stubs -> ELEMENT_NOT_FOUND naming every layer", async () => {
  const locator = new FakeLocator([], { available: false })
  try {
    await runChain(chainDeps({ locator, ocrAvailable: async () => false }))
    assert.fail("must throw")
  } catch (err: any) {
    assert.equal(err.code, "ELEMENT_NOT_FOUND")
    const attempts: Array<{ layer: string; outcome: string; reason?: string }> = err.message ? [] : []
    void attempts
  }
  // inspect attempts via a second run with a capturing hook
  const locator2 = new FakeLocator([], { available: false })
  let captured: any
  try {
    const deps = chainDeps({ locator: locator2, ocrAvailable: async () => false })
    await locateTargetWithChain({
      target: "确定", hwnd: HWND, shot: shotAt("cap-0.png"), deps,
      trackCapture: async () => shotAt("cap-1.png"), releaseRaw: async () => {},
    })
  } catch (err: any) {
    captured = err
  }
  assert.match(captured.message, /uia:skipped\(uia-incapable-or-unprobed\)/)
  assert.match(captured.message, /ocr:skipped\(ocr-language-missing\)/)
  assert.match(captured.message, /tinyclick:skipped\(wp5-not-implemented\)/)
  assert.match(captured.message, /cloud:skipped\(wp6-not-implemented\)/)
})

test("chain: L1 not-found -> stubs -> ELEMENT_NOT_FOUND", async () => {
  const locator = new FakeLocator([]) // pack available, anchor absent
  await assert.rejects(
    runChain(chainDeps({ locator })),
    (err: any) => err instanceof ComputerError && err.code === "ELEMENT_NOT_FOUND" && /ocr:not-found/.test(err.message),
  )
})

test("chain: ocr() THROW on the L1 coordinate path propagates (no silent degrade)", async () => {
  const locator = new FakeLocator([], { ocrThrows: new ComputerError("OCR_LANGUAGE_MISSING", "no zh pack") })
  await assert.rejects(
    runChain(chainDeps({ locator })),
    (err: any) => err instanceof ComputerError && err.code === "OCR_LANGUAGE_MISSING",
  )
})

test("chain: refresh context (staleOnNotFound) maps a vanished target to STALE_SCREENSHOT", async () => {
  const locator = new FakeLocator([])
  await assert.rejects(
    runChain(chainDeps({ locator }), { staleOnNotFound: true }),
    (err: any) => err instanceof ComputerError && err.code === "STALE_SCREENSHOT",
  )
})

test("chain: superseded locate frame is released on success", async () => {
  const uia = new FakeUia([uiaHit()])
  const { released } = await runChain(chainDeps({ uia }))
  assert.deepEqual(released, ["cap-0.png"])
})

// --- executor-level integration ------------------------------------------------

const EXE = "C:\\Program Files\\TestApp\\app.exe"

function exeConfig(uia: { uiaCapable?: boolean; uiaProbedAt?: string }): CompanionConfig {
  return {
    apps: {
      enabled: true,
      entries: {
        "win.app.test": {
          token: "win.app.test", kind: "gui", display_name: "Test App", source: "user",
          policy: "manual", enabled: true, added_at: "2026-07-18T10:00:00.000Z",
          exe: { path: EXE, signer: "CN=Test", user_writable_dir: false },
          coordinateAllowed: true,
          ...uia,
        },
      },
    },
    computer: { coordinateEnabled: true },
  } as unknown as CompanionConfig
}

function winInfo() {
  return { hwnd: HWND, pid: 1234, exePath: EXE, title: "Test App", rect: { x: 100, y: 100, width: 640, height: 480 }, alive: true }
}

class RecordEvidence implements EvidenceSink {
  readonly dir = "evidence"
  records: EvidenceActionRecord[] = []
  async init() {}
  async sealScreenshot() { return { sha256: "s" } }
  async appendAction(r: EvidenceActionRecord) { this.records.push(r) }
  async finalize() {}
}

class ExecCapturer implements ScreenCapturer {
  n = 0
  async captureWindow(): Promise<CaptureMeta> { this.n++; return shotAt(`cap-${this.n}.png`) }
  async crop(_s: string, _r: any, out: string) { return out }
  async diff() { return { diffRatio: 0 } }
  async diffRegion() { return { diffRatio: 0 } }
}

function execDeps(over: Partial<ComputerExecutorDeps>, evidence: RecordEvidence): ComputerExecutorDeps {
  const injector: InputInjector = {
    clicks: [] as any,
    async click(hwnd: number, x: number, y: number, kind: any) { (this.clicks as any[]).push({ hwnd, x, y, kind }) },
    async typeText() {}, async keyChord() {}, async scroll() {}, async drag() {},
    async probeWindow() { return winInfo() },
    async foregroundHwnd() { return HWND },
  } as InputInjector & { clicks: any[] }
  const windows: WindowEnumerator = {
    async enumerateByExe() { return [winInfo()] },
    async infoForHwnd() { return winInfo() },
  }
  const securityEnv: SecurityEnvironment = { async assertInjectable() {} }
  return {
    capturer: new ExecCapturer(),
    locator: new FakeLocator([{ text: "确定", x: 130, y: 170, w: 40, h: 20 }]),
    injector,
    windows,
    securityEnv,
    evidenceFactory: () => evidence,
    confirm: async () => ({ confirmationId: "", approved: true } as any),
    config: exeConfig({ uiaCapable: true }),
    ...over,
  }
}

const CLICK_OK = { task: "t", app: "win.app.test", actions: [{ action: "click" as const, target: "确定" }] }

test("executor: uiaCapable entry + L0 hit -> evidence records layer uia + attempts + uia+ocr channel", async () => {
  const evidence = new RecordEvidence()
  const r = await runComputerTask(CLICK_OK, execDeps({ uiaLocator: new FakeUia([uiaHit()]) }, evidence))
  assert.equal(r.success, true, r.error)
  const rec = evidence.records.find((x) => x.action === "click")!
  assert.equal(rec.layer, "uia")
  assert.equal(rec.confidence, 1.0)
  assert.equal(rec.crossverified, true)
  assert.equal(rec.crossverifyChannel, "uia+ocr")
  assert.ok(rec.locateAttempts!.some((a) => a.layer === "uia" && a.outcome === "hit"))
  assert.equal(r.steps[0].layer, "uia")
  assert.ok(r.steps[0].locateAttempts!.length >= 1)
})

test("executor: uiaCapable entry but L0 misses -> honest degrade, evidence shows uia:not-found + ocr:hit", async () => {
  const evidence = new RecordEvidence()
  const r = await runComputerTask(CLICK_OK, execDeps({ uiaLocator: new FakeUia([null]) }, evidence))
  assert.equal(r.success, true, r.error)
  const rec = evidence.records.find((x) => x.action === "click")!
  assert.equal(rec.layer, "ocr")
  assert.equal(rec.crossverifyChannel, "pixel-region")
  assert.deepEqual(
    rec.locateAttempts!.map((a) => [a.layer, a.outcome]),
    [["uia", "not-found"], ["ocr", "hit"]],
  )
})

test("executor: UIA-incapable entry (fixture off-mode shape) -> L0 skipped, L1 pixel-region", async () => {
  const evidence = new RecordEvidence()
  const r = await runComputerTask(CLICK_OK, execDeps({
    config: exeConfig({ uiaCapable: false, uiaProbedAt: "2026-07-19T00:00:00.000Z" }),
    uiaLocator: new FakeUia([uiaHit()]), // wired but MUST NOT be consulted
  }, evidence))
  assert.equal(r.success, true, r.error)
  const rec = evidence.records.find((x) => x.action === "click")!
  assert.equal(rec.layer, "ocr")
  assert.deepEqual(
    rec.locateAttempts!.map((a) => [a.layer, a.outcome, a.reason ?? ""]),
    [["uia", "skipped", "uia-incapable-or-unprobed"], ["ocr", "hit", ""]],
  )
})

// --- X1 (WP3 adversary): quantified witness — adversarial shapes --------------
//
// The old witness had no bbox size cap and counted ANY overlapping anchor
// char as corroboration, so a forged UIA node with an inflated bbox (center
// parked on the attacker's button, bbox swallowing the REAL anchor text)
// earned the full-strength "uia+ocr" badge without consuming the A1.3
// sub-budget. These shapes are now locked: ① oversized bbox can never
// corroborate, ② single-char anchors need a full-word hit, ③ candidates>1
// is forced uncrossverified.

async function runChainTarget(target: string, deps: LocateChainDeps) {
  const capturer = deps.capturer as unknown as FakeCapturer
  return locateTargetWithChain({
    target,
    hwnd: HWND,
    shot: shotAt("cap-0.png"),
    deps,
    trackCapture: async () => capturer.captureWindow(),
    releaseRaw: async () => {},
  })
}

test("X1: forged oversized bbox containing the real anchor can NEVER corroborate -> honest degrade L1", async () => {
  // Window 640x480 (=307200px²). Forged node: bbox 560x400 (=224000px² >
  // 150000 abs cap, 73% of the window) — the REAL "确定" word at (130,170)
  // falls inside it BY CONSTRUCTION (the old witness said "agree" here).
  const uia = new FakeUia([uiaHit({ x: 500, y: 400, bbox: { x: 140, y: 130, width: 560, height: 400 } })])
  const locator = new FakeLocator([{ text: "确定", x: 130, y: 170, w: 40, h: 20 }])
  const result = await runChainTarget("确定", chainDeps({ uia, locator }))
  assert.equal(result.hit.layer, "ocr", "forged UIA coords must be refused — OCR takes over")
  assert.equal(result.crossverifyChannel, "pixel-region")
  assert.equal(result.witness?.agree, false)
  assert.equal(result.witness?.oversized, true)
  // The anchor WAS fully covered inside the bbox — size alone refused it.
  assert.equal(result.witness?.matchedChars, 2)
  assert.equal(result.witness?.anchorChars, 2)
  assert.deepEqual(
    result.attempts.map((a) => [a.layer, a.outcome, a.reason ?? ""]),
    [["uia", "hit", ""], ["uia", "error", "uia-ocr-disagree"], ["ocr", "hit", ""]],
  )
})

test("X1: single-char anchor — char overlap inside the bbox does NOT corroborate (full-word hit required)", async () => {
  // Anchor "确"; the in-bbox word is "确定" — char overlap exists (old code
  // counted this) but no word IS the anchor.
  const uia = new FakeUia([uiaHit({ name: "确" })])
  const locator = new FakeLocator([{ text: "确定", x: 130, y: 170, w: 40, h: 20 }])
  const result = await runChainTarget("确", chainDeps({ uia, locator }))
  assert.equal(result.hit.layer, "ocr", "single-char overlap must not stand as witness")
  assert.equal(result.witness?.agree, false)
  // Full coverage (1/1) and STILL not corroborated — the rule is explicit.
  assert.equal(result.witness?.matchedChars, 1)
  assert.equal(result.witness?.anchorChars, 1)
  assert.equal(result.witness?.coverage, 1)
})

test("X1: single-char anchor with an exact in-bbox word DOES corroborate", async () => {
  const uia = new FakeUia([uiaHit({ name: "确" })])
  const locator = new FakeLocator([{ text: "确", x: 140, y: 170, w: 15, h: 20 }])
  const result = await runChainTarget("确", chainDeps({ uia, locator }))
  assert.equal(result.hit.layer, "uia")
  assert.equal(result.crossverified, true)
  assert.equal(result.crossverifyChannel, "uia+ocr")
  assert.equal(result.witness?.agree, true)
})

test("X1: multi-char anchor — contiguous reconstruction from split words corroborates", async () => {
  // OCR split "确定" into per-char words on the same line.
  const uia = new FakeUia([uiaHit()])
  const locator = new FakeLocator([
    { text: "确", x: 125, y: 170, w: 15, h: 20 },
    { text: "定", x: 145, y: 170, w: 15, h: 20 },
  ])
  const result = await runChainTarget("确定", chainDeps({ uia, locator }))
  assert.equal(result.hit.layer, "uia")
  assert.equal(result.crossverifyChannel, "uia+ocr")
  assert.equal(result.witness?.agree, true)
  assert.equal(result.witness?.reconstructed, true)
})

test("X1: candidates>1 (tree-order first pick) is forced uncrossverified — never the full-strength badge", async () => {
  // Witness agrees and pixels are stable, yet the pick is ambiguous.
  const uia = new FakeUia([uiaHit({ candidates: 2 })])
  const { result } = await runChain(chainDeps({ uia }))
  assert.equal(result.hit.layer, "uia", "coordinates still used (witness agreed, pixels stable)")
  assert.equal(result.crossverified, false)
  assert.equal(result.uncrossverified, true, "ambiguity consumes the A1.3 sub-budget")
  assert.equal(result.crossverifyChannel, undefined, "no uia+ocr badge on a guessed pick")
})
