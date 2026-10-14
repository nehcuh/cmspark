import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import type { CompanionConfig } from "../src/config"
import { classifyError, ERROR_CODE_LEVELS } from "../src/security"

// Execute the actual production failure-envelope statement, not an assumed
// payload fixture. The complete authenticated dispatcher is tested separately
// below only for refusal; no valid token or native executor is admitted here.
const dispatchFile = path.resolve(__dirname, "../../src/tool/companion-dispatch.ts")
const source = ts.createSourceFile(dispatchFile, fs.readFileSync(dispatchFile, "utf8"), ts.ScriptTarget.Latest, true)
const returns: string[] = []
function findFailureEnvelope(node: ts.Node): void {
  if (ts.isIfStatement(node) && node.expression.getText(source) === "!result.success" &&
      node.thenStatement.getText(source).includes("evidence_dir") && ts.isBlock(node.thenStatement)) {
    const result = node.thenStatement.statements.find(ts.isReturnStatement)
    if (result) returns.push(result.getText(source))
  }
  ts.forEachChild(node, findFailureEnvelope)
}
findFailureEnvelope(source)
assert.equal(returns.length, 1, "must find exactly one actual host_computer failure envelope")
const failureEnvelope = new Function("result", returns[0]) as (result: Awaited<ReturnType<typeof runComputerTask>>) => any

async function actualDenial(kind: "app" | "hwnd", metadata: string) {
  const effects: string[] = []
  const trap = (name: string) => async () => { effects.push(name); throw new Error(`unexpected effect: ${name}`) }
  const native = new Proxy({}, { get: (_target, key) => trap(String(key)) })
  const config = {
    apps: { enabled: true, entries: { "win.app.test": {
      token: "win.app.test", kind: "gui", display_name: metadata, source: "user", policy: "manual",
      enabled: true, coordinateAllowed: kind !== "app", added_at: "2026-07-18T10:00:00Z",
      exe: { path: "C:/Program Files/TestApp/app.exe", user_writable_dir: false },
    } } }, computer: { coordinateEnabled: true },
  } as unknown as CompanionConfig
  const deps = {
    config, now: () => 1000000, injector: native, capturer: native, locator: native,
    windows: { enumerateByExe: async () => [{ hwnd: 424242, pid: 1234,
      exePath: `C:/${metadata}/foreign.exe`, title: "Synthetic window", alive: true,
      rect: { x: 100, y: 100, width: 640, height: 480 } }], infoForHwnd: trap("infoForHwnd") },
    securityEnv: native, evidenceFactory: () => { effects.push("evidence"); throw new Error("unexpected evidence") },
    confirm: trap("human confirmation"),
  } as unknown as ComputerExecutorDeps
  const produced = await runComputerTask({ task: "Synthetic refusal", app: "win.app.test",
    actions: [{ action: "click", target: "Synthetic target" }] }, deps)
  assert.equal(produced.success, false)
  assert.equal(produced.errorCode, kind === "app" ? "APP_COORDINATE_DENIED" : "HWND_NOT_OWNED")
  assert.deepEqual(effects, [], "denial must precede native input, capture, evidence and human confirmation")
  const wire = JSON.parse(JSON.stringify(failureEnvelope(produced)))
  assert.equal(wire.success, false)
  assert.equal(wire.data.error_code, produced.errorCode)
  assert.equal(wire.error, produced.error)
  return wire
}

for (const kind of ["app", "hwnd"] as const) {
  for (const metadata of ["ordinary", "timeout", "disconnected"] as const) {
    test(`#563 actual ${kind} denial remains a hard stop with ${metadata} metadata`, async () => {
      const wire = await actualDenial(kind, metadata)
      assert.equal(classifyError(wire.error, { toolName: "host_computer", error_code: wire.data.error_code }), "non_recoverable")
    })
  }
}

test("#563 Computer denial registration leaves correction and unknown-message fallback unchanged", () => {
  assert.equal(ERROR_CODE_LEVELS.has("OUT_OF_BOUNDS"), false)
  assert.equal(classifyError("computer: (9999,0) outside client rect 620x430", { error_code: "OUT_OF_BOUNDS" }), "recoverable")
  assert.equal(classifyError("timeout", { error_code: "UNKNOWN_COMPUTER_REFUSAL" }), "recoverable")
  assert.equal(classifyError("neutral refusal", { error_code: "UNKNOWN_COMPUTER_REFUSAL" }), "non_recoverable")
  for (const gate of ["user_gesture required", "task authorization required", "host_read requires L2 security_token confirmation"])
    assert.equal(classifyError(gate), "non_recoverable", "required/requires must not become broad recovery tokens")
})

test("#563 actual host_computer dispatcher still refuses missing and invalid tokens before native effects", async () => {
  const dispatch = await import("../src/tool/companion-dispatch")
  const effects: string[] = []
  const trap = () => { effects.push("native admission"); throw new Error("must refuse before native admission") }
  dispatch.bindCompanionDispatchRuntime({ getThreadManager: () => null, getSkillEngine: () => null,
    getComputerEstopEnsureOverride: () => trap } as any)
  const params = { app: "win.app.test", task: "Synthetic rejected task", actions: [{ action: "click", target: "Synthetic target" }] }
  for (const token of [undefined, "synthetic-invalid-token-not-issued"]) {
    const result = await dispatch.executeCompanionTool("host_computer", { ...params, security_token: token })
    const wire = JSON.parse(JSON.stringify(result))
    assert.equal(wire.success, false)
    assert.match(wire.error, token ? /Invalid or expired security token/ : /requires L2 security_token confirmation/)
    assert.equal(classifyError(wire.error, { toolName: "host_computer", error_code: wire.data?.error_code }), "non_recoverable")
  }
  assert.deepEqual(effects, [])
})
