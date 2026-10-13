import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { buildSync } from "esbuild"
import { coerceEvaluateNullResult, getOriginFailCount, peekSiteOpBan, recordSiteOpFailure, resetSiteOpMemoryForTests } from "../src/tool/site-op-memory"

// Compile the actual extension producer without importing its sources into the
// companion tsc root. No hand-built tool result: every envelope below comes from
// BrowserBridge.execute, then crosses the same JSON boundary as the WebSocket.
let BrowserBridge: any
let temporary: string
before(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-evaluate-completion-"))
  const source = path.resolve(process.cwd(), "../chrome-extension/src/background/browser-bridge.ts")
  const output = path.join(temporary, "browser-bridge.cjs")
  buildSync({ entryPoints: [source], outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" })
  BrowserBridge = createRequire(__filename)(output).BrowserBridge
})
after(() => fs.rmSync(temporary, { recursive: true, force: true }))

async function runBridge(options: { remote?: any; cdpFails?: boolean; scripted?: any; missingScriptResult?: boolean; probe?: boolean; probeRemote?: any; request?: any }) {
  const previous = (globalThis as any).chrome
  const expressions: string[] = []
  const scripts: string[] = []
  const code = "globalThis.syntheticOperation()"
  ;(globalThis as any).chrome = {
    tabs: { get: async (id: number) => ({ id, url: "https://synthetic.example/page" }) },
    debugger: {
      onDetach: { addListener() {} }, attach: async () => {},
      sendCommand: async (_target: any, method: string, params: any) => {
        if (method !== "Runtime.evaluate") return {}
        expressions.push(params.expression)
        if (options.cdpFails) throw new Error("synthetic debugger unavailable")
        if (params.expression === "1+1===2") return options.probeRemote || { result: { type: "boolean", value: options.probe !== false } }
        return options.remote
      },
    },
    scripting: { executeScript: async (params: any) => {
      scripts.push(params.args[0])
      if (options.missingScriptResult) return [{}]
      return [{ result: params.args[0] === "1+1===2" ? options.probe !== false : options.scripted }]
    } },
  }
  try {
    const producer = await new BrowserBridge().execute("evaluate", { tabId: 7, code, security_token: "synthetic-token", ...options.request })
    const wire = JSON.parse(JSON.stringify(producer))
    return { producer, wire, result: coerceEvaluateNullResult("evaluate", wire), expressions, scripts, code }
  } finally {
    if (previous === undefined) delete (globalThis as any).chrome
    else (globalThis as any).chrome = previous
  }
}

test("real bridge CDP and scripting null/undefined completions survive JSON exactly once", async () => {
  resetSiteOpMemoryForTests()
  for (const options of [
    { remote: { result: { type: "object", subtype: "null", value: null } } },
    { remote: { result: { type: "undefined" } } },
    { cdpFails: true, scripted: null },
    { cdpFails: true, scripted: undefined },
  ]) {
    const r = await runBridge(options)
    assert.equal(r.result.success, true, JSON.stringify(r.result))
    assert.equal(r.expressions.filter(e => e === r.code).length, 1, "never rerun original expression for its probe")
    assert.equal(r.scripts.filter(e => e === r.code).length, options.cdpFails ? 1 : 0)
    const nullResult = r.wire.data.type === "object"
    assert.equal(r.wire.data.evaluate_kind, nullResult ? "null_completion" : "empty_completion")
    assert.equal(Object.hasOwn(r.wire.data, "result"), nullResult, "JSON omits undefined but keeps null")
    if (!r.result.success) recordSiteOpFailure("completion", "evaluate", { tabId: 7 }, r.result.data.error_code, "https://synthetic.example")
  }
  assert.equal(getOriginFailCount("completion", "https://synthetic.example"), 0)
  assert.equal(peekSiteOpBan("completion", "evaluate", { tabId: 7 }, "https://synthetic.example").banned, false)
})

test("malformed original responses cannot borrow completion from a healthy probe or request flags", async () => {
  for (const remote of [
    {}, { result: {} }, { result: { type: "object" } },
    { result: { type: "object", value: null } },
    { result: { type: "undefined", value: null } },
    { result: { type: "undefined", objectId: "contradiction" } },
    { result: { type: "number", unserializableValue: "NaN" } },
  ]) {
    const r = await runBridge({ remote, probe: true, request: { type: "undefined", evaluate_kind: "empty_completion" } })
    assert.equal(r.result.success, false, JSON.stringify(remote))
    assert.equal(r.result.data.error_code, "EVALUATE_NULL_RESULT")
    assert.equal(r.expressions.filter(e => e === r.code).length, 1)
    assert.equal(r.expressions.includes("1+1===2"), false, "missing original completion must fail before probe")
  }
  const missing = await runBridge({ cdpFails: true, missingScriptResult: true })
  assert.equal(missing.result.success, false)
  assert.equal(missing.result.data.error_code, "CDP_ATTACH_FAILED")
})

test("page nested completion flags are ordinary return data; exceptions and dead worlds stay failures", async () => {
  const nested = { result: null, type: "object", evaluate_kind: "null_completion" }
  const object = await runBridge({ remote: { result: { type: "object", value: nested } } })
  assert.equal(object.result.success, true)
  assert.deepEqual(object.wire.data.result, nested)
  assert.equal(object.wire.data.evaluate_kind, undefined, "page data is never promoted into host metadata")
  const thrown = await runBridge({ remote: { result: { type: "undefined" }, exceptionDetails: { text: "synthetic page error" } } })
  assert.equal(thrown.result.success, false)
  assert.equal(thrown.result.data.error_code, "EVAL_THROWN")
  assert.equal(thrown.scripts.length, 0, "page exceptions do not trigger original-expression replay")
  const dead = await runBridge({ remote: { result: { type: "undefined" } }, probe: false })
  assert.equal(dead.result.success, false)
  assert.equal(dead.result.data.error_code, "EVAL_DEAD_WORLD")
  assert.equal(dead.expressions.filter(e => e === dead.code).length, 1)
  for (const probeRemote of [
    { result: { value: true } },
    { result: { type: "boolean", value: true }, exceptionDetails: { text: "synthetic probe exception" } },
  ]) {
    const badProbe = await runBridge({ remote: { result: { type: "undefined" } }, probeRemote })
    assert.equal(badProbe.result.success, false)
    assert.equal(badProbe.result.data.error_code, "EVAL_DEAD_WORLD")
  }
})
