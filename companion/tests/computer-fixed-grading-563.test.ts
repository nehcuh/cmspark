import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import { PsInputInjector, PsSecurityEnvironment } from "../src/computer/win-adapters"
import { clearCompanionUiRects, setCompanionUiRect } from "../src/computer/companion-ui-rects"
import { classifyError, ERROR_CODE_LEVELS, DEFAULT_NON_RECOVERABLE_CODES } from "../src/security"

// Use actual return/consumer statements; only native PsRunner, windows, frames,
// OCR and evidence are inert boundaries. No effective L2, native or human action.
const dispatchPath = path.resolve(__dirname, "../../src/tool/companion-dispatch.ts")
const dispatchSource = ts.createSourceFile(dispatchPath, fs.readFileSync(dispatchPath, "utf8"), ts.ScriptTarget.Latest, true)
const returns: string[] = []
function collectReturn(node: ts.Node): void {
  if (ts.isIfStatement(node) && node.expression.getText(dispatchSource) === "!result.success" &&
    node.thenStatement.getText(dispatchSource).includes("evidence_dir") && ts.isBlock(node.thenStatement)) {
    const returned = node.thenStatement.statements.find(ts.isReturnStatement)
    if (returned) returns.push(returned.getText(dispatchSource))
  }
  ts.forEachChild(node, collectReturn)
}
collectReturn(dispatchSource)
assert.equal(returns.length, 1)
const failureEnvelope = new Function("result", returns[0])
const adapterPath = path.resolve(__dirname, "../../src/llm/adapter.ts")
const adapterSource = ts.createSourceFile(adapterPath, fs.readFileSync(adapterPath, "utf8"), ts.ScriptTarget.Latest, true)
const consumerStatements: string[] = []
function collectConsumer(node: ts.Node): void {
  if (ts.isVariableStatement(node)) {
    const name = node.declarationList.declarations[0]?.name.getText(adapterSource)
    if (name === "classCode" || name === "errorLevel") consumerStatements.push(node.getText(adapterSource))
  }
  ts.forEachChild(node, collectConsumer)
}
collectConsumer(adapterSource)
assert.equal(consumerStatements.length, 2)
const consume = new Function("toolResult", "classifyError", "toolName",
  ts.transpile(consumerStatements.join("\n") + ";return {classCode,errorLevel};", {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }))

const HWND = 424242
const EXE = "C:/OwnedComputerFixture/app.exe"
const windowInfo = { hwnd: HWND, pid: 1234, exePath: EXE, title: "Owned fixture", alive: true,
  rect: { x: 100, y: 100, width: 640, height: 480 } }

function fixture(overrides: Partial<ComputerExecutorDeps> = {}) {
  const unexpected: string[] = []
  const trap = async () => { unexpected.push("native/confirmation"); throw new Error("UNEXPECTED_NATIVE_EFFECT") }
  let captures = 0
  const deps = {
    config: { apps: { enabled: true, entries: { "win.app.owned": {
      token: "win.app.owned", kind: "gui", display_name: "Owned fixture", source: "user", policy: "manual",
      enabled: true, coordinateAllowed: true, added_at: "2026-10-16",
      exe: { path: EXE, user_writable_dir: false },
    } } }, computer: { coordinateEnabled: true } },
    capturer: { captureWindow: async () => ({ hwnd: HWND, rect: windowInfo.rect,
      client: { x: 10, y: 40, width: 620, height: 430 }, dpi: 96,
      path: `OWNED_INERT_${++captures}`, sha256: "owned", black: false, fallbackUsed: false, osrBlackSuspected: false }),
      crop: async (_source: string, _rect: unknown, out: string) => out,
      diffRegion: async () => ({ diffRatio: 0 }), diff: async () => ({ diffRatio: 0 }) },
    locator: { ensureLanguage: async () => {}, ocr: async () => ({ language: "zh-Hans", words: [] }) },
    injector: { click: trap, typeText: trap, keyChord: trap, scroll: trap, drag: trap,
      probeWindow: async () => windowInfo, foregroundHwnd: async () => HWND, forceForeground: async () => true },
    windows: { enumerateByExe: async () => [windowInfo], infoForHwnd: async () => windowInfo },
    securityEnv: { assertInjectable: async () => {} },
    evidenceFactory: () => ({ dir: "OWNED_INERT_EVIDENCE", init: async () => {}, finalize: async () => {},
      appendAction: async () => {}, sealScreenshot: async () => ({ sha256: "owned" }) }),
    confirm: trap, removeFile: async () => {}, now: () => 1000000, sleep: async () => {}, ...overrides,
  } as unknown as ComputerExecutorDeps
  return { deps, unexpected }
}

async function actualFailure(f: ReturnType<typeof fixture>, action: any, code: string) {
  const result = await runComputerTask({ task: "Owned rejection", app: "win.app.owned", actions: [action] }, f.deps)
  assert.equal(result.success, false)
  assert.equal(result.errorCode, code)
  assert.deepEqual(f.unexpected, [])
  const wire = JSON.parse(JSON.stringify(failureEnvelope(result)))
  assert.equal(wire.data.error_code, code)
  assert.equal(wire.error, result.error)
  return wire
}

function gradeActual(wire: any, expected: "recoverable" | "non_recoverable", variants = true): void {
  const normal = consume(wire, classifyError, "host_computer")
  assert.equal(normal.classCode, wire.data.error_code)
  assert.equal(normal.errorLevel, expected)
  if (variants) {
    // Retain the actual producer's JSON/code; vary only diagnostic text at the
    // consumer. These are controlled variants, not claimed natural PS output.
    for (const error of ["", "owned refusal", "timeout not found disconnected", "permission denied", "Security Block: owned"])
      assert.equal(consume({ ...wire, error }, classifyError, "host_computer").errorLevel, expected, error)
  }
}

for (const [prefix, code, message, level] of [
  ["ILDENIED", "INTEGRITY_LEVEL_DENIED", "integrity-level probe failed (own=-1 target=-1) — fail-closed", "non_recoverable"],
  ["STOPPED", "TASK_ABORTED", "emergency-stop flag present — injection aborted", "non_recoverable"],
  ["OUTOFBOUNDS", "OUT_OF_BOUNDS", "(9999,20) outside client rect 620x430", "recoverable"],
] as const) {
  test(`#563 actual PsInput ${prefix} fixed refusal is code-first at the adapter`, async () => {
    const calls: string[] = []
    const injector = new PsInputInjector(async (script) => { calls.push(path.basename(script)); throw { stderr: `${prefix}:${message}` } })
    const f = fixture()
    f.deps.injector.click = injector.click.bind(injector)
    const wire = await actualFailure(f, { action: "click", x: 20, y: 20 }, code)
    assert.deepEqual(calls, ["computer-input.ps1"])
    gradeActual(wire, level)
  })
}

for (const payload of [{ ownIl: -1, targetIl: -1 }, { ownIl: 8192, targetIl: 12288 }]) {
  test(`#563 actual PS security JSON IL refusal ${payload.ownIl} remains intrinsically hard`, async () => {
    const securityEnv = new PsSecurityEnvironment(async () => JSON.stringify({ ...payload, pid: 1234, desktop: "Default" }))
    gradeActual(await actualFailure(fixture({ securityEnv }), { action: "click", x: 20, y: 20 }, "INTEGRITY_LEVEL_DENIED"), "non_recoverable")
  })
}

for (const channel of ["hotkey", "panel"] as const) {
  test(`#563 actual ${channel} abort remains a hard stop, not transient retry`, async () => {
    gradeActual(await actualFailure(fixture({ abortCheck: () => channel }), { action: "wait", ms: 1 }, "TASK_ABORTED"), "non_recoverable")
  })
}

for (const action of [{ action: "click", x: 9999, y: 20 }, { action: "drag", x: 20, y: 20, x2: 9999, y2: 20 }]) {
  test(`#563 actual ${action.action} bounds refusal remains correction-oriented, never clamped/injected`, async () => {
    gradeActual(await actualFailure(fixture(), action, "OUT_OF_BOUNDS"), "recoverable")
  })
}

for (const surface of ["overlay", "hud", "tray", "pairing"] as const) {
  test(`#563 actual S23 ${surface} guard remains a hard stop`, async () => {
    clearCompanionUiRects()
    setCompanionUiRect({ surface, x: 100, y: 100, width: 100, height: 100 })
    try {
      gradeActual(await actualFailure(fixture(), { action: "click", x: 20, y: 20 }, "COMPANION_UI_CLICK_DENIED"), "non_recoverable")
    } finally { clearCompanionUiRects() }
  })
}

for (const [name, action, words] of [
  ["payment region", { action: "click", x: 20, y: 20 }, [{ text: "立即支付 timeout", x: 5, y: 5, w: 30, h: 20 }]],
  ["credential type", { action: "type", text: "OWNED_INERT_TEXT" }, [{ text: "密码 disconnected", x: 5, y: 5, w: 30, h: 20 }]],
] as const) {
  test(`#563 actual A4 ${name} has no re-confirm/injection path`, async () => {
    const f = fixture({ locator: { ensureLanguage: async () => {}, ocr: async () => ({ language: "zh-Hans", words: [...words] }) } as any })
    gradeActual(await actualFailure(f, action, "DANGER_HARD_DENY"), "non_recoverable")
  })
}

test("#563 actual A3 corpus guard rejects a controlled action change after the corpus snapshot", async () => {
  const action = { action: "type", text: "OWNED_ORIGINAL" }
  const f = fixture({ windows: { enumerateByExe: async () => {
    action.text = "OWNED_CHANGED_AFTER_CORPUS"
    return [windowInfo]
  }, infoForHwnd: async () => windowInfo } })
  gradeActual(await actualFailure(f, action, "TYPE_TEXT_NOT_CONFIRMED"), "non_recoverable")
})

for (const [prefix, level] of [["ILDENIED", "non_recoverable"], ["STOPPED", "non_recoverable"], ["OUTOFBOUNDS", "recoverable"]] as const) {
  test(`#563 existing type wrapper remains TYPE_NO_EFFECT for ${prefix}`, async () => {
    let calls = 0
    const detail = prefix === "OUTOFBOUNDS" ? "outside client rect 620x430" : "owned fixed refusal"
    const injector = new PsInputInjector(async () => { calls++; throw { stderr: `${prefix}:${detail}` } })
    const f = fixture()
    f.deps.injector.typeText = injector.typeText.bind(injector)
    gradeActual(await actualFailure(f, { action: "type", text: "OWNED_INERT_TEXT" }, "TYPE_NO_EFFECT"), level, false)
    assert.equal(calls, 2, "existing one-refocus/retype behavior is unchanged")
  })
}

test("#563 UIA stop retains its aborted reason; coordinate permission still precedes PS", async () => {
  const stopped = new PsInputInjector(async () => { throw { stderr: "STOPPED:emergency-stop flag present — delivery aborted" } })
  assert.deepEqual(await stopped.invokeUia(HWND, "Owned", "invoke"), { ok: false, reason: "aborted", detail: "emergency-stop flag present — delivery aborted" })
  let calls = 0
  const f = fixture({ securityEnv: new PsSecurityEnvironment(async () => { calls++; throw new Error("UNEXPECTED_PS") }) })
  f.deps.config.apps!.entries["win.app.owned"].coordinateAllowed = false
  const wire = await actualFailure(f, { action: "click", x: 20, y: 20 }, "APP_COORDINATE_DENIED")
  gradeActual(wire, "non_recoverable")
  assert.equal(calls, 0)
})

test("#563 mixed/unknown/no-code fallback and the original 59 defaults remain unchanged", () => {
  assert.equal(DEFAULT_NON_RECOVERABLE_CODES.length, 59)
  assert.equal(ERROR_CODE_LEVELS.has("EMERGENCY_STOP_UNAVAILABLE"), false)
  assert.equal(ERROR_CODE_LEVELS.has("TYPE_NO_EFFECT"), false)
  for (const error_code of [undefined, "UNKNOWN_COMPUTER_CODE", "EMERGENCY_STOP_UNAVAILABLE"])
    for (const [error, level] of [["timeout", "recoverable"], ["owned refusal", "non_recoverable"], ["permission denied", "non_recoverable"]] as const)
      assert.equal(classifyError(error, { error_code }), level)
})
