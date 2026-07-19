// WP3 — WindowOpened watcher drain wiring in the executor (the <5% small-popup
// channel). All providers are fakes; assertions target the wiring contract:
// factory receives {hwnd, pid} of the resolved target, drained events feed the
// task-induced-dialog invariant (OR'd with the pixel/foreground channels),
// drain is consume-once, the watcher is disposed on EVERY exit, a factory
// failure degrades honestly (log + continue), and uiaCapable:false gates the
// subscription off entirely.

import test from "node:test"
import assert from "node:assert/strict"

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
  async init() {}
  async sealScreenshot() {
    return { sha256: "s" }
  }
  async appendAction(r: EvidenceActionRecord) {
    this.records.push(r)
  }
  async finalize() {}
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
  constructor(private script: UiaWindowOpenedEvent[][] = []) {}
  drain(): UiaWindowOpenedEvent[] {
    this.drainCalls++
    return this.script.length > 0 ? this.script.shift()! : []
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
        uiaWatcherFactory: (t) => {
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
        uiaWatcherFactory: () => watcher,
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
})

test("watch: uiaCapable:false entry -> factory NEVER called (subscription gated off)", async () => {
  const evidence = new RecordEvidence()
  let factoryCalls = 0
  const r = await runComputerTask(
    CLICK_OK,
    execDeps(
      {
        config: exeConfig({ uiaCapable: false, uiaProbedAt: "2026-07-19T00:00:00.000Z" }),
        uiaWatcherFactory: () => {
          factoryCalls++
          return new FakeWatcher([[popupEvent()]]) // would fire — must never exist
        },
      },
      evidence,
    ),
  )
  assert.equal(r.success, true, r.error)
  assert.equal(factoryCalls, 0)
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
        uiaWatcherFactory: () => watcher,
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
