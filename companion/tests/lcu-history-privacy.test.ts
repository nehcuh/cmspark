import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import * as rules from "../src/security/redact-rules"
import { redactToolPayloadForPersistence, redactAssistantToolCallsForPersistence } from "../src/security/tool-persistence-redact"
import { snapshotHistory } from "../src/tool/snapshot-locator"
import { projectLcuResult } from "../src/computer/lcu/result"

function historyBoundary() {
  const root = process.env.CMSPARK_SOURCE_ROOT ?? path.resolve(__dirname, "../../src")
  const source = fs.readFileSync(path.join(root, "history/store.ts"), "utf8")
  const sf = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true)
  const functions = ["redactForStorage", "redactCodeParams"].map(name => {
    const fn = sf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(fn); return fn.getText(sf)
  })
  const cls = sf.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "HistoryStore") as ts.ClassDeclaration | undefined
  assert.ok(cls)
  const record = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(sf) === "record")
  assert.ok(record)
  const exports: any = {}
  const js = ts.transpileModule(`${functions.join("\n")}\nexport class Probe { ${record.getText(sf)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(js, { exports, ...rules, HistoryStore: { FLUSH_THRESHOLD: 256 }, Date }, { timeout: 1000 })
  return exports as { redactForStorage: (name: string, params: string, summary: string) => { params: string; result_summary: string }; Probe: new () => any }
}

const privateArgs = { code: "PRIVATE_CODE_SENTINEL", title: "PRIVATE_DOCUMENT_TITLE_SENTINEL", extra: { oldText: "PRIVATE_SCREEN_TEXT_SENTINEL" } }

test("LCU folds title and unknown operands in both durable thread and full-history assistant argument paths", () => {
  for (const name of ["lcu_js", "lcu_js_reset"]) {
    const params = rules.redactCodeishParams(privateArgs, name)
    assert.deepEqual(Object.keys(params).sort(), ["len", "redacted", "sha256"])
    const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="
    const result = projectLcuResult({ content: [{ type: "text", text: "PRIVATE_SCREEN_TEXT_SENTINEL" }, { type: "image", mimeType: "image/png", data: pixel }] }).result
    const thread = redactToolPayloadForPersistence(name, privateArgs, result)
    const assistant = redactAssistantToolCallsForPersistence([{ id: "owned", type: "function", function: { name, arguments: JSON.stringify(privateArgs) } }], { persistFull: true })
    assert.doesNotMatch(JSON.stringify([params, thread, assistant]), /PRIVATE_[A-Z_]+_SENTINEL/)
    assert.equal(JSON.stringify([params, thread, assistant]).includes(pixel), false)
  }
  const unaffected = rules.redactCodeishParams(privateArgs, "shell_exec")
  assert.equal(unaffected.title, privateArgs.title)
  assert.notEqual(unaffected.code, privateArgs.code)
})

test("actual snapshot fallback and actual HistoryStore record fold LCU operands and screen summary before SQL insertion", async () => {
  const actual = historyBoundary()
  for (const name of ["lcu_js", "lcu_js_reset"]) {
    const result = { success: true, data: { content: [{ type: "text", text: "PRIVATE_SCREEN_TEXT_SENTINEL" }] } }
    assert.equal(snapshotHistory(name, privateArgs, result), undefined)
    const values: any[][] = [], history = new actual.Probe()
    history.ready = Promise.resolve(); history.pendingSinceFlush = 0; history.flushTimer = {}
    history.db = { run(sql: string, operands: unknown[]) { assert.match(sql, /^INSERT INTO operations/); values.push(operands) }, exec: () => [{ values: [[37]] }] }
    const id = await history.record({ thread_id: "owned-thread", tool_name: name, params: JSON.stringify(privateArgs), result_summary: JSON.stringify(result.data).substring(0, 500), success: 1 })
    assert.equal(id, 37); assert.equal(values.length, 1)
    assert.equal(JSON.parse(values[0][2]).redacted, true)
    assert.match(values[0][3], /^<redacted:len=/)
    assert.doesNotMatch(JSON.stringify(values), /PRIVATE_[A-Z_]+_SENTINEL/)
  }
})
