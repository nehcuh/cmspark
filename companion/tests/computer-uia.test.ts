// WP3 — UIA admission probe verdicts + AppEntry.uiaCapable write-back
// (plan §K.5) + executor lazy-probe wiring. All PowerShell is faked; the
// verdict thresholds and tampering semantics are the properties under test.

import test from "node:test"
import assert from "node:assert/strict"

import {
  uiaVerdictFromStats,
  UIA_CAPABLE_MIN_NODES,
  type UiaProbeStats,
  type UiaProber,
} from "../src/computer/uia"
import { applyUiaProbedVerdict, validateAppEntry, type AppEntry } from "../src/apps/types"
import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import type { CaptureMeta, InputInjector, Locator, ScreenCapturer, SecurityEnvironment, WindowEnumerator } from "../src/computer/types"
import type { EvidenceSink } from "../src/computer/evidence"
import type { CompanionConfig } from "../src/config"

// --- verdict matrix ---------------------------------------------------------

function stats(over: Partial<UiaProbeStats>): UiaProbeStats {
  return {
    nodes: 0,
    maxDepth: 0,
    edits: 0,
    documents: 0,
    interactive: 0,
    named: 0,
    namedOnscreen: 0,
    capped: false,
    hydrationRechecked: false,
    passANodes: 0,
    durationMs: 1,
    ...over,
  }
}

test("uia verdict: rich tree via edits/documents -> capable 0.9", () => {
  assert.deepEqual(
    uiaVerdictFromStats(stats({ nodes: 3, edits: 1 })).uiaCapable,
    true,
  )
  assert.equal(uiaVerdictFromStats(stats({ nodes: 3, edits: 1 })).confidence, 0.9)
  assert.equal(uiaVerdictFromStats(stats({ nodes: 5, documents: 2 })).uiaCapable, true)
})

test("uia verdict: rich tree via node count -> capable 0.9 (Chrome-class)", () => {
  const v = uiaVerdictFromStats(stats({ nodes: UIA_CAPABLE_MIN_NODES, namedOnscreen: 0 }))
  assert.equal(v.uiaCapable, true)
  assert.equal(v.confidence, 0.9)
})

test("uia verdict: minimal signal (namedOnscreen>=1, legacy WinForms Pane names) -> capable 0.6", () => {
  // Fixture UiaMode=on reality: 3 nodes, 0 edits (MSAA bridge => Pane), 1 named on-screen.
  const v = uiaVerdictFromStats(stats({ nodes: 3, named: 1, namedOnscreen: 1 }))
  assert.equal(v.uiaCapable, true)
  assert.equal(v.confidence, 0.6)
})

test("uia verdict: unnamed-only tree -> blind (cloudmusic spike shape: 5 nodes, 0 named)", () => {
  const sparse = uiaVerdictFromStats(stats({ nodes: 5, namedOnscreen: 0 }))
  assert.equal(sparse.uiaCapable, false)
  assert.equal(sparse.confidence, 0.4) // sparse tree -> lower confidence in the negative
  const substantial = uiaVerdictFromStats(stats({ nodes: 12, namedOnscreen: 0 }))
  assert.equal(substantial.uiaCapable, false)
  assert.equal(substantial.confidence, 0.6) // real tree, nothing addressable
})

// --- AppEntry schema + write-back semantics ----------------------------------

function entry(over: Partial<AppEntry> = {}): AppEntry {
  return {
    token: "win.app.test",
    kind: "gui",
    display_name: "Test App",
    source: "user",
    policy: "manual",
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    exe: { path: "C:\\Program Files\\TestApp\\app.exe", signer: "CN=Test", user_writable_dir: false },
    ...over,
  }
}

test("uia fields: validateAppEntry accepts boolean/string, rejects other types", () => {
  assert.equal(validateAppEntry(entry({ uiaCapable: true, uiaProbedAt: "2026-07-19T00:00:00.000Z" })), null)
  assert.equal(validateAppEntry(entry({ uiaCapable: false })), null)
  assert.match(validateAppEntry(entry({ uiaCapable: "yes" as any })) ?? "", /uiaCapable must be a boolean/)
  assert.match(validateAppEntry(entry({ uiaProbedAt: 7 as any })) ?? "", /uiaProbedAt must be a string/)
})

test("write-back: unprobed entry is filled with verdict + probedAt", () => {
  const r = applyUiaProbedVerdict({ "win.app.test": entry() }, "win.app.test", true, "2026-07-19T01:00:00.000Z")
  assert.equal(r.applied, true)
  assert.equal(r.entries["win.app.test"].uiaCapable, true)
  assert.equal(r.entries["win.app.test"].uiaProbedAt, "2026-07-19T01:00:00.000Z")
})

test("write-back: previously auto-probed value refreshes (uiaProbedAt present)", () => {
  const e = entry({ uiaCapable: true, uiaProbedAt: "2026-07-19T01:00:00.000Z" })
  const r = applyUiaProbedVerdict({ "win.app.test": e }, "win.app.test", false, "2026-07-19T02:00:00.000Z")
  assert.equal(r.applied, true)
  assert.equal(r.entries["win.app.test"].uiaCapable, false)
  assert.equal(r.entries["win.app.test"].uiaProbedAt, "2026-07-19T02:00:00.000Z")
})

test("write-back: HAND-SET override is never overwritten (uiaCapable without uiaProbedAt)", () => {
  for (const hand of [true, false]) {
    const e = entry({ uiaCapable: hand }) // no uiaProbedAt = human wrote this
    const r = applyUiaProbedVerdict({ "win.app.test": e }, "win.app.test", !hand, "2026-07-19T02:00:00.000Z")
    assert.equal(r.applied, false, `hand-set ${hand} must block the write`)
    assert.equal(r.reason, "hand-set-override")
    assert.equal(r.entries["win.app.test"].uiaCapable, hand) // map returned untouched
    assert.equal(r.entries["win.app.test"].uiaProbedAt, undefined)
  }
})

test("write-back: unknown token is a no-op", () => {
  const r = applyUiaProbedVerdict({}, "win.app.ghost", true, "2026-07-19T02:00:00.000Z")
  assert.equal(r.applied, false)
  assert.equal(r.reason, "unknown-token")
})

// --- writeBackUiaVerdict lives in computer-uia-writeback.test.ts ------------
// (It calls the global config module, so its file pins CMSPARK_DATA_DIR
// BEFORE any config-touching import is evaluated — the apps-config.test.ts
// pattern. Importing uia.ts statically HERE is safe: module evaluation only
// computes DATA_DIR; nothing in this file calls the global config.)

// --- executor lazy-probe wiring ----------------------------------------------

const EXE = "C:\\Program Files\\TestApp\\app.exe"
const HWND = 424242

function uiaConfig(uia: { uiaCapable?: boolean; uiaProbedAt?: string } | undefined): CompanionConfig {
  return {
    apps: {
      enabled: true,
      entries: {
        "win.app.test": entry({
          coordinateAllowed: true,
          ...(uia ?? {}),
        }),
      },
    },
    computer: { coordinateEnabled: true },
  } as unknown as CompanionConfig
}

function fakeShot(): CaptureMeta {
  return {
    hwnd: HWND,
    rect: { x: 0, y: 0, width: 640, height: 480 },
    client: { x: 0, y: 0, width: 640, height: 480 },
    dpi: 96,
    path: "cap-1.png",
    sha256: "deadbeef",
    black: false,
    fallbackUsed: false,
    osrBlackSuspected: false,
  }
}

class MetaCaptureEvidence implements EvidenceSink {
  readonly dir = "evidence"
  meta: Record<string, unknown> | null = null
  async init(meta: Record<string, unknown>) { this.meta = meta }
  async sealScreenshot() { return { sha256: "x" } }
  async appendAction() {}
  async finalize() {}
}

function minimalDeps(over: Partial<ComputerExecutorDeps>): ComputerExecutorDeps {
  const capturer: ScreenCapturer = {
    async captureWindow() { return fakeShot() },
    async crop(_s, _r, out) { return out },
    async diff() { return { diffRatio: 0 } },
    async diffRegion() { return { diffRatio: 0 } },
  }
  const locator: Locator = {
    async ensureLanguage() {},
    async ocr() { return { language: "zh-Hans", words: [] } },
    locate() { return null },
  }
  const injector: InputInjector = {
    async click() {}, async typeText() {}, async keyChord() {}, async scroll() {}, async drag() {},
    async probeWindow() { return winInfo() },
    async foregroundHwnd() { return HWND },
  }
  const windows: WindowEnumerator = {
    async enumerateByExe() { return [winInfo()] },
    async infoForHwnd() { return winInfo() },
  }
  const securityEnv: SecurityEnvironment = { async assertInjectable() {} }
  return {
    capturer,
    locator,
    injector,
    windows,
    securityEnv,
    evidenceFactory: () => new MetaCaptureEvidence(),
    confirm: async () => ({ confirmationId: "", approved: false, reason: "disconnect" as const }),
    config: uiaConfig(undefined),
    ...over,
  }
}

function winInfo() {
  return { hwnd: HWND, pid: 1234, exePath: EXE, title: "Test App", rect: { x: 0, y: 0, width: 640, height: 480 }, alive: true }
}

const WAIT_TASK = { task: "t", app: "win.app.test", actions: [{ action: "wait" as const, ms: 1 }] }

test("executor: unprobed entry -> lazy probe runs, verdict reported + sealed into task meta", async () => {
  const probed: number[] = []
  const verdicts: Array<{ token: string; capable: boolean; at: string }> = []
  const prober: UiaProber = {
    async probe(hwnd) {
      probed.push(hwnd)
      return { uiaCapable: true, confidence: 0.9, stats: stats({ nodes: 60 }) }
    },
  }
  const evidence = new MetaCaptureEvidence()
  const logs: Array<{ event: string; data: any }> = []
  const r = await runComputerTask(WAIT_TASK, minimalDeps({
    uiaProber: prober,
    onUiaVerdict: (token, v, at) => { verdicts.push({ token, capable: v.uiaCapable, at }) },
    evidenceFactory: () => evidence,
    log: (event, data) => logs.push({ event, data }),
  }))
  assert.equal(r.success, true)
  assert.deepEqual(probed, [HWND])
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0].token, "win.app.test")
  assert.equal(verdicts[0].capable, true)
  assert.ok(Date.parse(verdicts[0].at) > 0, "probedAt is an ISO timestamp")
  assert.equal(evidence.meta?.uiaCapable, true)
  assert.equal(evidence.meta?.uiaVerdictSource, "probe")
  assert.ok(logs.some((l) => l.event === "computer.uia.probed" && l.data.nodes === 60))
})

test("executor: preset entry value (incl. hand-set) skips the probe entirely", async () => {
  for (const uia of [{ uiaCapable: true }, { uiaCapable: false, uiaProbedAt: "2026-07-19T00:00:00.000Z" }]) {
    let probeCalls = 0
    const prober: UiaProber = { async probe() { probeCalls++; return { uiaCapable: true, confidence: 0.9, stats: stats({ nodes: 50 }) } } }
    const evidence = new MetaCaptureEvidence()
    const r = await runComputerTask(WAIT_TASK, minimalDeps({
      config: uiaConfig(uia),
      uiaProber: prober,
      onUiaVerdict: () => { throw new Error("must not be called for a preset entry") },
      evidenceFactory: () => evidence,
    }))
    assert.equal(r.success, true)
    assert.equal(probeCalls, 0)
    assert.equal(evidence.meta?.uiaCapable, uia.uiaCapable)
    assert.equal(evidence.meta?.uiaVerdictSource, "entry")
  }
})

test("executor: probe failure = honest unknown (OCR layer order, NO write-back, task proceeds)", async () => {
  let verdictCalls = 0
  const prober: UiaProber = { async probe() { throw new Error("UIA unavailable") } }
  const evidence = new MetaCaptureEvidence()
  const logs: Array<{ event: string; data: any }> = []
  const r = await runComputerTask(WAIT_TASK, minimalDeps({
    uiaProber: prober,
    onUiaVerdict: () => { verdictCalls++ },
    evidenceFactory: () => evidence,
    log: (event, data) => logs.push({ event, data }),
  }))
  assert.equal(r.success, true)
  assert.equal(verdictCalls, 0)
  assert.equal(evidence.meta?.uiaCapable, false)
  assert.equal(evidence.meta?.uiaVerdictSource, "unknown")
  assert.ok(logs.some((l) => l.event === "computer.uia.probe_failed"))
})
