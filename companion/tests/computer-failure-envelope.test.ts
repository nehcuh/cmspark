import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { computerFailureEnvelope } from "./helpers/computer-failure-envelope"
import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import { observationNotice } from "../src/computer/observation"

const file = path.resolve(__dirname, "../../src/tool/companion-dispatch.ts")
const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
const found: string[] = []
function walk(node: ts.Node): void {
  if (ts.isIfStatement(node) && node.expression.getText(source) === "!result.success" &&
      ts.isBlock(node.thenStatement) && node.thenStatement.getText(source).includes("evidence_dir")) {
    const returned = node.thenStatement.statements.find(ts.isReturnStatement)
    if (returned) found.push(returned.getText(source))
  }
  ts.forEachChild(node, walk)
}
walk(source)
assert.equal(found.length, 1)

for (const isWin of [false, true]) {
  test(`actual failure envelope keeps typed refusal with explicit Windows=${isWin} closure`, async () => {
    let effects = 0
    const refused = () => { effects++; throw Error("OWNED_EFFECT_FORBIDDEN") }
    const native = new Proxy({}, { get: () => refused })
    const result = await runComputerTask({ task: "Owned inert refusal", app: "win.app.owned", actions: [{ action: "wait", ms: 0 }] }, {
      config: { apps: { enabled: false, entries: {} }, computer: { coordinateEnabled: false } },
      windows: native, injector: native, capturer: native, locator: native, securityEnv: native,
      confirm: refused, evidenceFactory: refused,
    } as unknown as ComputerExecutorDeps)
    assert.equal(result.success, false)
    assert.equal(result.errorCode, "APP_NOT_WHITELISTED")
    assert.deepEqual(result.steps, [])
    assert.equal(effects, 0)
    const wire = computerFailureEnvelope(found[0], isWin)(result)
    assert.equal(wire.success, false)
    assert.equal(wire.error, result.error)
    assert.equal(wire.data.error_code, result.errorCode)
    assert.equal(wire.data.task_id, result.taskId)
    assert.equal(wire.data.evidence_dir, result.evidenceDir)
    assert.strictEqual(wire.data.steps, result.steps)
    if (isWin) assert.equal(wire.data.observation_notice, observationNotice(result.steps))
    else assert.equal(Object.hasOwn(wire.data, "observation_notice"), false)
    assert.throws(() => new Function("result", found[0])(result), /isWin is not defined/)
  })
}
