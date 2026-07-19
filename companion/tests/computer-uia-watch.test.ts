// WP3 — WindowOpened watcher drain wiring in the executor (the <5% small-popup
// channel) + X2 (WP3 adversary) lifecycle semantics. All providers are fakes
// except one win32 real-ps1 smoke; assertions target the wiring contract:
// factory receives {hwnd, pid}, drained events feed the dialog invariant
// (OR'd with the pixel/foreground channels), drain is consume-once, disposal
// on every exit, honest degrade on factory failure, the uiaCapable gate, and
// the X2 lifecycle: ready handshake gating, mid-task death detection with
// evidence liveness, and fail-safe buffer overflow.

import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"

import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import {
  type CaptureMeta,
  type InputInjector,
  type LocateHit,
  type Locator,
  type OcrResult,
  type OcrWord,
  type ScreenCapturer,
  type SecurityEnvironment,
  type UiaWatcher,
  type UiaWindowOpenedEvent,
  type WindowEnumerator,
} from "../src/computer/types"
import { createUiaWatchBuffer, startUiaWindowWatcher, UIA_WATCH_BUFFER_CAP } from "../src/computer/win-adapters"
import type { EvidenceActionRecord, EvidenceSink } from "../src/computer/evidence"
import type { CompanionConfig } from "../src/config"

const HWND = 424242
const EXE = "C:\\Program Files\\TestApp\\app.exe"
// Benign anchor — absent from every danger word list, so no danger/budget
// pause can mask the dialog-invariant assertions below.
const ANCHOR = "保存"

function shotAt(path: string): CaptureMeta {
  return {
    hwnd: HWND,
    rect: { x: 100, y: 100, width: 640, height: 480 },
    client: { x: 10, y: 40, width: 620, height: 430 },
    dpi: 96,
    path,
    sha256: "x",
    black: false,
    fallbackUsed: false,
    osrBlackSuspected: false,
  }
}

class FakeLocator implements Locator {
  constructor(private words: OcrWord[]) {}
  async ensureLanguage(): Promise<void> {}
  async ocr(): Promise<OcrResult> {
    return { language: "zh-Hans", words: this.words }
  }
  locate(result: OcrResult, text: string): LocateHit | null {
    for (const w of result.words) {
      if (w.text.includes(text)) {
        const x = w.x + w.w / 2
        const y = w.y + w.h / 2
        return { x, y, bbox: { x: x - 20, y: y - 10, width: 40, height: 20 }, layer: "ocr", confidence: 0.9, matchedText: text }
      }
    }
    return null
  }
}

class ExecCapturer implements ScreenCapturer {
  n = 0
  async captureWindow(): Promise<CaptureMeta> {
    this.n++
    return shotAt(`cap-${this.n}.png`)
  }
  async crop(_s: string, _r: any, out: string) {
    return out
  }
  async diff() {
    return { diffRatio: 0 }
  }
  async diffRegion() {
    return { diffRatio: 0 }
  }
}

class RecordEvidence implements EvidenceSink {
  readonly dir = "evidence"
  records: EvidenceActionRecord[] = []
  finalized: Record<string, unknown> | null = null
  async init() {}
  async sealScreenshot() {
    return { sha256: "s" }
  }
  async appendAction(r: EvidenceActionRecord) {
    this.records.push(r)
  }
  async finalize(summary: Record<string, unknown>) {
    this.finalized = summary
  }
}

function winInfo() {
  return { hwnd: HWND, pid: 1234, exePath: EXE, title: "Test App", rect: { x: 100, y: 100, width: 640, height: 480 }, alive: true }
}

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

class FakeWatcher implements UiaWatcher {
  drainCalls = 0
  disposed = 0
  dead = false
  exitCode: number | null = null
  constructor(
    private script: UiaWindowOpenedEvent[][] = [],
    private opts: { dieAfterDrains?: number; dieExitCode?: number } = {},
  ) {}
  drain(): UiaWindowOpenedEvent[] {
    this.drainCalls++
    const out = this.script.length > 0 ? this.script.shift()! : []
    // X2: simulate a mid-task process death surfacing at a drain boundary.
    if (this.opts.dieAfterDrains !== undefined && this.drainCalls >= this.opts.dieAfterDrains) {
      this.dead = true
      this.exitCode = this.opts.dieExitCode ?? 5
    }
    return out
  }
  dispose(): void {
    this.disposed++
  }
}

function popupEvent(): UiaWindowOpenedEvent {
  return { controlType: "Window", className: "WindowsForms10.Window.8.app.0.141b42a_r6_ad1", pid: 1234, at: new Date(0).toISOString() }
}

function execDeps(
  over: Partial<ComputerExecutorDeps>,
  evidence: RecordEvidence,
): ComputerExecutorDeps {
  const injector: InputInjector = {
    async click() {},
    async typeText() {},
    async keyChord() {},
    async scroll() {},
    async drag() {},
    async probeWindow() {
      return winInfo()
    },
    async foregroundHwnd() {
      return HWND
    },
  }
  const windows: WindowEnumerator = {
    async enumerateByExe() {
      return [winInfo()]
    },
    async infoForHwnd() {
      return winInfo()
    },
  }
  const securityEnv: SecurityEnvironment = { async assertInjectable() {} }
  return {
    capturer: new ExecCapturer(),
    locator: new FakeLocator([{ text: ANCHOR, x: 130, y: 170, w: 40, h: 20 }]),
    injector,
    windows,
    securityEnv,
    evidenceFactory: () => evidence,
    confirm: async () => ({ confirmationId: "", approved: true } as any),
    config: exeConfig({ uiaCapable: true }),
    ...over,
  }
}

const CLICK_OK = { task: "t", app: "win.app.test", actions: [{ action: "click" as const, target: ANCHOR }] }

test("watch: drained WindowOpened event pauses the task; denial -> DIALOG_PAUSED_DENIED + dispose", async () => {
  const evidence = new RecordEvidence()
  const watcher = new FakeWatcher([[popupEvent()]])
  let factoryTarget: { hwnd: number; pid: number } | null = null
  const logs: Array<{ event: string; data: any }> = []
  const r = await runComputerTask(
    CLICK_OK,
    execDeps(
      {
        uiaWatcherFactory: async (t) => {
          factoryTarget = t
          return watcher
        },
        confirm: async () => ({ confirmationId: "", approved: false, reason: "denied" } as any),
        log: (event: string, data: any) => logs.push({ event, data }),
      },
      evidence,
    ),
  )
  assert.equal(r.success, false)
  assert.equal(r.errorCode, "DIALOG_PAUSED_DENIED")
  assert.deepEqual(factoryTarget, { hwnd: HWND, pid: 1234 })
  assert.equal(watcher.disposed, 1)
  const dlg = logs.find((l) => l.event === "computer.task.dialog_suspected")
  assert.ok(dlg, "dialog_suspected log expected")
  assert.equal(dlg.data.uiaWindowOpened, 1)
  assert.match(dlg.data.uiaWindowClass, /^WindowsForms10/)
  // pixel/foreground channels were quiet — the UIA event alone fired the invariant
  assert.equal(dlg.data.newTopLevel, false)
  assert.equal(dlg.data.fgChanged, false)
})

test("watch: empty drain -> success with NO re-L2 (confirm never called), disposed at the tail", async () => {
  const evidence = new RecordEvidence()
  const watcher = new FakeWatcher()
  let confirmCalls = 0
  const r = await runComputerTask(
    CLICK_OK,
    execDeps(
      {
        uiaWatcherFactory: async () => watcher,
        confirm: async () => {
          confirmCalls++
          return { confirmationId: "", approved: true } as any
        },
      },
      evidence,
    ),
  )
  assert.equal(r.success, true, r.error)
  assert.equal(confirmCalls, 0)
  assert.ok(watcher.drainCalls >= 1)
  assert.equal(watcher.disposed, 1)
  // X2: a live watcher at the tail is recorded started/!died.
  assert.deepEqual((evidence.finalized as any)?.uiaWatcher, { started: true, died: false, exitCode: null })
})

test("watch: uiaCapable:false entry -> factory NEVER called (subscription gated off)", async () => {
  const evidence = new RecordEvidence()
  let factoryCalls = 0
  const r = await runComputerTask(
    CLICK_OK,
    execDeps(
      {
        config: exeConfig({ uiaCapable: false, uiaProbedAt: "2026-07-19T00:00:00.000Z" }),
        uiaWatcherFactory: async () => {
          factoryCalls++
          return new FakeWatcher([[popupEvent()]]) // would fire — must never exist
        },
      },
      evidence,
    ),
  )
  assert.equal(r.success, true, r.error)
  assert.equal(factoryCalls, 0)
  // never started -> liveness says so
  assert.deepEqual((evidence.finalized as any)?.uiaWatcher, { started: false, died: false, exitCode: null })
})

test("watch: factory throw -> computer.uia.watch_failed logged, task continues honestly", async () => {
  const evidence = new RecordEvidence()
  const logs: Array<{ event: string; data: any }> = []
  let confirmCalls = 0
  const r = await runComputerTask(
    CLICK_OK,
    execDeps(
      {
        uiaWatcherFactory: () => {
          throw new Error("spawn failed")
        },
        log: (event: string, data: any) => logs.push({ event, data }),
        confirm: async () => {
          confirmCalls++
          return { confirmationId: "", approved: true } as any
        },
      },
      evidence,
    ),
  )
  assert.equal(r.success, true, r.error)
  assert.ok(logs.some((l) => l.event === "computer.uia.watch_failed"))
  assert.equal(confirmCalls, 0)
})

test("watch: approved pause consumes the event — the NEXT action does not re-trigger", async () => {
  const evidence = new RecordEvidence()
  const watcher = new FakeWatcher([[popupEvent()]])
  let confirmCalls = 0
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "click" as const, target: ANCHOR }, { action: "click" as const, target: ANCHOR }] },
    execDeps(
      {
        uiaWatcherFactory: async () => watcher,
        confirm: async () => {
          confirmCalls++
          return { confirmationId: "", approved: true } as any
        },
      },
      evidence,
    ),
  )
  assert.equal(r.success, true, r.error)
  assert.equal(r.completedActions, 2)
  assert.equal(confirmCalls, 1, "the drained event must not pause again on the next action")
  assert.equal(watcher.disposed, 1)
})

// --- X2 (WP3 adversary): watcher lifecycle seams --------------------------------

test("X2: ready handshake rejection -> watch_failed (NEVER watch_started), task continues", async () => {
  const evidence = new RecordEvidence()
  const logs: Array<{ event: string; data: any }> = []
  const r = await runComputerTask(
    CLICK_OK,
    execDeps(
      {
        // async rejection = the ps1 exited before ready / handshake timeout
        uiaWatcherFactory: async () => {
          throw new Error("computer-uia-watch ready handshake timeout (10000ms)")
        },
        log: (event: string, data: any) => logs.push({ event, data }),
      },
      evidence,
    ),
  )
  assert.equal(r.success, true, r.error)
  assert.ok(logs.some((l) => l.event === "computer.uia.watch_failed"), "rejection must be recorded")
  assert.ok(
    !logs.some((l) => l.event === "computer.uia.watch_started"),
    "watch_started may only fire for a LIVE channel (the old code logged it unconditionally)",
  )
  assert.deepEqual((evidence.finalized as any)?.uiaWatcher, { started: false, died: false, exitCode: null })
})

test("X2: mid-task watcher death -> watch_died logged ONCE, evidence finalize marks the channel offline", async () => {
  const evidence = new RecordEvidence()
  // Dies at the first drain boundary (exit code 5, the ps1's WATCHFAILED).
  const watcher = new FakeWatcher([], { dieAfterDrains: 1, dieExitCode: 5 })
  const logs: Array<{ event: string; data: any }> = []
  const r = await runComputerTask(
    { task: "t", app: "win.app.test", actions: [{ action: "click" as const, target: ANCHOR }, { action: "click" as const, target: ANCHOR }] },
    execDeps(
      {
        uiaWatcherFactory: async () => watcher,
        log: (event: string, data: any) => logs.push({ event, data }),
      },
      evidence,
    ),
  )
  assert.equal(r.success, true, r.error)
  const died = logs.filter((l) => l.event === "computer.uia.watch_died")
  assert.equal(died.length, 1, "death is logged exactly once (watcher is disposed+null afterwards)")
  assert.equal(died[0].data.exitCode, 5)
  assert.deepEqual(
    (evidence.finalized as any)?.uiaWatcher,
    { started: true, died: true, exitCode: 5 },
    "the evidence tail must NOT claim the channel was online",
  )
})

test("X2: buffer overflow is FAIL-SAFE — drain past the cap carries a synthetic popup marker", () => {
  const buf = createUiaWatchBuffer(1234)
  assert.equal(buf.feed('{"ready":true}'), true, "the ready handshake is recognized")
  for (let i = 0; i < UIA_WATCH_BUFFER_CAP + 44; i++) {
    buf.feed(`{"event":"window-opened","controlType":"Window","className":"Popup","pid":1234,"at":"t${i}"}`)
  }
  const out = buf.drain()
  assert.equal(out.length, UIA_WATCH_BUFFER_CAP + 1, "capped buffer + one fail-safe marker")
  assert.equal(out[out.length - 1].className, "(watcher-buffer-overflow)")
  assert.equal(buf.drain().length, 0, "overflow marker is consume-once")
  // pid filtering stays intact
  buf.feed(`{"event":"window-opened","controlType":"Window","className":"Other","pid":999,"at":"t"}`)
  assert.equal(buf.drain().length, 0)
})

test("X2: win32 smoke — real ps1 ready handshake resolves; dispose flips dead promptly", { skip: process.platform !== "win32", timeout: 60_000 }, async () => {
  // resolveWinScript falls back to the packaged staged path under the kimi
  // runtime node — the dev-only override points it at the repo scripts.
  const prevScripts = process.env.CMSPARK_WIN_SCRIPTS
  process.env.CMSPARK_WIN_SCRIPTS = path.resolve(__dirname, "..", "..", "src", "host-use", "win", "scripts")
  let watcher: UiaWatcher | null = null
  try {
    watcher = await startUiaWindowWatcher({ hwnd: 0, pid: process.pid }, { maxSeconds: 60, readyTimeoutMs: 20_000 })
  } finally {
    if (prevScripts === undefined) delete process.env.CMSPARK_WIN_SCRIPTS
    else process.env.CMSPARK_WIN_SCRIPTS = prevScripts
  }
  assert.equal(watcher!.dead, false)
  assert.equal(watcher!.exitCode, null)
  assert.deepEqual(watcher!.drain(), [])
  watcher!.dispose()
  await new Promise((r) => setTimeout(r, 1500))
  assert.equal(watcher!.dead, true, "exit monitoring must surface the killed child")
})
