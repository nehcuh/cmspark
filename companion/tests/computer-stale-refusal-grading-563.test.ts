/** #563: real locate-chain refusals through the complete executor failure
 * closure and actual outward/adapter expressions. Providers and closure effects
 * are inert; this does not run an authorized task, native input, or a browser.
 */
import test, { before, after, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import ts from "typescript"
import { locateTargetWithChain, type LocateChainDeps } from "../src/computer/locate-chain"
import { ComputerError, type CaptureMeta, type LocateHit, type UiaLocateHit } from "../src/computer/types"

const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-stale-563-"))
process.env.CMSPARK_DATA_DIR = owned
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
process.env.CMSPARK_SECURITY_SECRET = "OWNED_STALE_NO_TOKEN"
let security: typeof import("../src/security"), guard: typeof import("../src/llm/same-tool-guard")
let effects = 0, tokens = 0
before(async () => {
  const cp = require("node:child_process")
  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"])
    mock.method(cp, key, () => { effects++; throw Error("NATIVE_EFFECT_FORBIDDEN") })
  security = await import("../src/security")
  guard = await import("../src/llm/same-tool-guard")
  const policy = (await import("../src/security-policy")).securityPolicy
  for (const key of ["issueToken", "issueTokenFor"] as const)
    mock.method(policy, key, () => { tokens++; throw Error("TOKEN_ISSUANCE_FORBIDDEN") })
})
after(() => {
  assert.equal(effects, 0); assert.equal(tokens, 0)
  mock.restoreAll(); fs.rmSync(owned, { recursive: true, force: true })
})

function source(relative: string) {
  const file = path.resolve(__dirname, "../../src", relative)
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
}
function unique(root: ts.Node, predicate: (n: ts.Node) => boolean): ts.Node {
  const found: ts.Node[] = []
  const walk = (n: ts.Node) => { if (predicate(n)) found.push(n); ts.forEachChild(n, walk) }
  walk(root); assert.equal(found.length, 1, "unique actual producer/adapter AST required")
  return found[0]
}
function body(args: string[], statement: string) {
  return new Function(...args, ts.transpileModule(statement, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText)
}
const executor = source("computer/executor.ts")
const failure = unique(executor, n => ts.isVariableDeclaration(n) && n.name.getText(executor) === "fail") as ts.VariableDeclaration
const failureClosure = body(["log", "emit", "taskId", "steps", "params", "sweepRaws", "evidence", "uiaWatcherLiveness"],
  `let uiaWatcher = null; return ${failure.initializer!.getText(executor)};`)
const dispatcher = source("tool/companion-dispatch.ts")
const envelope = body(["result"], unique(dispatcher, n => ts.isReturnStatement(n)
  && n.getText(dispatcher).includes("error_code: result.errorCode")).getText(dispatcher))
const adapter = source("llm/adapter.ts")
const variable = (name: string) => unique(adapter, n => ts.isVariableDeclaration(n)
  && n.name.getText(adapter) === name) as ts.VariableDeclaration
const classify = body(["toolResult", "toolName", "classifyError"],
  `const classCode=${variable("classCode").initializer!.getText(adapter)};
   const errorLevel=${variable("errorLevel").initializer!.getText(adapter)};
   const failCode=${variable("failCode").initializer!.getText(adapter)};
   return {classCode,errorLevel,failCode};`)
const halt = unique(adapter, n => ts.isIfStatement(n)
  && n.expression.getText(adapter) === 'errorLevel === "security" || errorLevel === "non_recoverable"') as ts.IfStatement
const shouldHalt = body(["errorLevel"], "return " + halt.expression.getText(adapter))
const threshold = Number(variable("MAX_SAME_TOOL_RECOVERABLE_FAILURES").initializer!.getText(adapter))

function shot(name: string, drift = 0): CaptureMeta {
  return { hwnd: 424242, rect: { x: 100 + drift, y: 100, width: 640, height: 480 },
    client: { x: 10, y: 40, width: 620, height: 430 }, dpi: 96, path: name,
    sha256: "owned-no-file", black: false, fallbackUsed: false, osrBlackSuspected: false }
}
const uiaHit: UiaLocateHit = { x: 250, y: 280, bbox: { x: 230, y: 270, width: 40, height: 20 },
  name: "Save", controlType: "Button", confidence: 1, candidates: 1 }
const ocrHit: LocateHit = { x: 150, y: 180, bbox: { x: 130, y: 170, width: 40, height: 20 },
  layer: "ocr", confidence: 1, matchedText: "Save" }
type Scenario = "uia-moved" | "ocr-moved" | "twice-drift" | "post-approval-missing"
async function refusal(scenario: Scenario, target: string) {
  const calls = { uia: 0, ocr: 0, locate: 0, capture: 0, diff: 0, release: 0 }
  const locator = {
    ensureLanguage: async () => {},
    ocr: async () => { calls.ocr++; return { language: "owned", words: [] } },
    locate: () => { calls.locate++; return scenario === "ocr-moved" && calls.locate === 1 ? ocrHit : null },
  }
  const deps: LocateChainDeps = {
    uia: scenario === "uia-moved" || scenario === "twice-drift" ? {
      locate: async () => { calls.uia++; return calls.uia === 1 ? uiaHit : null },
    } : null,
    locator,
    capturer: { diffRegion: async () => { calls.diff++; return { diffRatio: scenario === "twice-drift" ? 0 : 1 } } } as any,
    ocrAvailable: async () => scenario === "ocr-moved" || scenario === "post-approval-missing",
  }
  let error: ComputerError | undefined
  try {
    await locateTargetWithChain({ target, hwnd: 424242, shot: shot("owned-before"), deps,
      trackCapture: async () => { calls.capture++; return shot("owned-after", scenario === "twice-drift" ? 100 : 0) },
      releaseRaw: async () => { calls.release++ },
      driftRestarted: scenario === "twice-drift", staleOnNotFound: scenario === "post-approval-missing" })
    assert.fail("invalidated coordinates must not produce an injection point")
  } catch (err) { assert.ok(err instanceof ComputerError); error = err }
  assert.equal(error.code, "STALE_SCREENSHOT")
  assert.ok(error.message.includes(target), "model target remains in original diagnostic")
  if (scenario === "uia-moved") assert.deepEqual(calls, { uia: 2, ocr: 0, locate: 0, capture: 1, diff: 1, release: 0 })
  if (scenario === "ocr-moved") assert.deepEqual(calls, { uia: 0, ocr: 2, locate: 2, capture: 1, diff: 1, release: 0 })
  if (scenario === "twice-drift") assert.deepEqual(calls, { uia: 1, ocr: 0, locate: 0, capture: 1, diff: 1, release: 1 })
  if (scenario === "post-approval-missing") {
    assert.match(error.message, /not found.*re-confirm approval/)
    assert.match(error.message, /uia:skipped.*ocr:not-found/)
    assert.deepEqual(calls, { uia: 0, ocr: 1, locate: 1, capture: 0, diff: 0, release: 0 })
  }
  return error
}
async function outward(error: ComputerError) {
  const events: any[] = [], logs: any[] = []
  let sweeps = 0
  const fail = failureClosure((...args: any[]) => logs.push(args), (event: any) => events.push(event),
    "owned-task", [], { actions: [{ action: "click", target: "owned" }] }, async () => { sweeps++ }, null, () => null)
  const result = await fail(error)
  assert.equal(sweeps, 1); assert.equal(logs.length, 1)
  assert.equal(events.length, 1); assert.equal(events[0].event, "finished")
  assert.equal(events[0].errorCode, "STALE_SCREENSHOT"); assert.equal(events[0].ok, false)
  assert.equal(result.completedActions, 0); assert.deepEqual(result.steps, [])
  const wire = JSON.parse(JSON.stringify(envelope(result)))
  assert.equal(wire.success, false); assert.equal(wire.error, error.message)
  assert.equal(wire.data.error_code, "STALE_SCREENSHOT")
  return { wire, classified: classify(wire, "host_computer", security.classifyError) }
}
for (const scenario of ["uia-moved", "ocr-moved", "twice-drift", "post-approval-missing"] as const)
  for (const target of ["Save", "timeout", "element_not_found", "not found", "Security Block", "Save\npermission denied"]) {
    test(`#563 stale ${scenario} keeps intrinsic refusal for ${JSON.stringify(target)}`, async () => {
      const { wire, classified } = await outward(await refusal(scenario, target))
      assert.equal(classified.classCode, "STALE_SCREENSHOT")
      assert.equal(classified.errorLevel, "non_recoverable")
      assert.equal(shouldHalt(classified.errorLevel), true)
      assert.equal(threshold, 3)
      for (const alreadyPivoted of [false, true]) assert.equal(guard.decideSameToolFailure({
        failCount: threshold, threshold, errorCode: classified.failCode, errorText: wire.error, alreadyPivoted,
      }).action, "stop", "typed native refusal cannot become a webpage locator pivot")
    })
  }
test("#563 experimental post-approval region refusal uses the same existing typed code", async () => {
  const created = unique(executor, n => ts.isNewExpression(n) && n.expression.getText(executor) === "ComputerError"
    && n.arguments?.[0]?.getText(executor) === '"STALE_SCREENSHOT"') as ts.NewExpression
  // Actual fixed constructor expression only; not a full authorized executor.
  const error = body(["ComputerError"], "return " + created.getText(executor))(ComputerError)
  assert.match(error.message, /experimental suggestion region went unstable/)
  const { classified } = await outward(error)
  assert.equal(classified.errorLevel, "non_recoverable"); assert.equal(shouldHalt(classified.errorLevel), true)
})
test("#563 stale finite registration preserves unknown/legacy recovery and existing safety grades", () => {
  assert.equal(security.DEFAULT_NON_RECOVERABLE_CODES.length, 59)
  assert.equal(security.ERROR_CODE_LEVELS.get("STALE_SCREENSHOT"), "non_recoverable")
  for (const errorCode of [undefined, "OWNED_UNKNOWN_CODE"]) {
    assert.equal(security.classifyError("timeout element_not_found", { error_code: errorCode }), "recoverable")
    assert.equal(guard.decideSameToolFailure({ failCount: 3, threshold, errorCode,
      errorText: "timeout element_not_found", alreadyPivoted: false }).action, "pivot")
  }
  assert.equal(security.classifyError("Security Block", { error_code: "COOKIE_TRUST_DENIED" }), "security")
  assert.equal(security.classifyError("not found", { error_code: "ELEMENT_NOT_FOUND" }), "recoverable")
  assert.equal(security.classifyError("timeout", { error_code: "CLICK_OCCLUDED" }), "non_recoverable")
  assert.equal(security.ERROR_CODE_LEVELS.has("TYPE_NO_EFFECT"), false)
})
test("#563 actual dispatcher missing/invalid authorization remains denied before native effects", async () => {
  const api = await import("../src/tool/companion-dispatch")
  api.bindCompanionDispatchRuntime({ getThreadManager: () => null, getSkillEngine: () => null,
    getComputerEstopEnsureOverride: () => () => { effects++; throw Error("ADMISSION_FORBIDDEN") } } as any)
  for (const security_token of [undefined, "OWNED_INVALID_NOT_ISSUED"]) {
    const wire = JSON.parse(JSON.stringify(await api.executeCompanionTool("host_computer", {
      app: "win.app.test", task: "owned", actions: [{ action: "click", target: "timeout" }], security_token,
    })))
    assert.equal(wire.success, false)
    assert.match(wire.error, security_token ? /Invalid or expired security token/ : /requires L2 security_token confirmation/)
    assert.equal(security.classifyError(wire.error), "non_recoverable")
  }
})
