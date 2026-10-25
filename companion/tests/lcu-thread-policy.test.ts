import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { lcuThreadAdmitted, type LcuThreadPolicy } from "../src/computer/lcu/runtime"
import { isExecutionPolicy } from "../src/tool/plan-readonly"

const selected = (): LcuThreadPolicy => ({ active_mcp_server_ids: ["cmspark_lcu"], execution_policy: "default" })
test("LCU keeps plan-readonly, worker, trash and explicit selection restrictions even with cruise-expanded whitelist", () => {
  assert.equal(lcuThreadAdmitted("t", () => selected(), () => true), true)
  for (const value of [undefined, {}, { ...selected(), agent_role: "worker" }, { ...selected(), execution_policy: "plan_readonly" as const }, { ...selected(), trashed_at: "owned" }, { ...selected(), execution_policy: "unknown" as any }]) {
    assert.equal(lcuThreadAdmitted("t", () => value, () => true), false)
  }
  for (const denied of ["lcu_js", "lcu_js_reset"]) assert.equal(lcuThreadAdmitted("t", () => selected(), name => name !== denied), false)
  assert.equal(lcuThreadAdmitted("t", () => { throw Error("unavailable") }, () => true), false)
})

function routerCase(kind: "thread.update" | "thread.execution_policy.set", thread: LcuThreadPolicy, updates: Record<string, unknown>, failAfterMutation = false) {
  const root = process.env.CMSPARK_SOURCE_ROOT ?? path.resolve(__dirname, "../../src")
  const source = fs.readFileSync(path.join(root, "message-router.ts"), "utf8")
  const sf = ts.createSourceFile("message-router.ts", source, ts.ScriptTarget.Latest, true)
  let clause: ts.CaseClause | undefined
  function visit(node: ts.Node) { if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === kind) clause = node; ts.forEachChild(node, visit) }
  visit(sf); assert.ok(clause)
  const helper = sf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "retireRevokedLcuThread")
  assert.ok(helper)
  const stopped: string[] = [], fallback: string[] = []
  const manager = { get: () => thread, isToolAllowed: (_id: string, name: string) => !(thread as any).tool_whitelist || (thread as any).tool_whitelist.includes(name), update: (_id: string, patch: Record<string, unknown>) => {
    Object.assign(thread, patch); if (failAfterMutation) throw Error("owned persistence refusal"); return thread
  } }
  const text = `${helper.getText(sf)}\nexport async function runOwnedCase() { ${clause.statements.map(node => node.getText(sf)).join("\n")} }`
  const exports: any = {}
  const body = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(body, { exports, rest: kind === "thread.update" ? { thread_id: "owned-thread", updates } : { thread_id: "owned-thread", policy: "plan_readonly", user_gesture: true },
    threadManager: manager, stampedSurface: "tray", session: {}, broadcastLoopStatus: async () => {}, abortControllers: new Map([["owned-thread", { abort: () => fallback.push("owned-thread") }]]),
    require(name: string) {
      if (name === "./computer/lcu/runtime") return { lcuThreadAdmitted }
      if (name === "./computer/task-abort-registry") return { notifyComputerTaskAbort: (id: string) => stopped.push(id) }
      if (name === "./tool/plan-readonly") return { isExecutionPolicy }
      if (name === "./packs/audit-log") return { appendCapabilityAudit() {} }
      if (name === "./loop/loop-kernel") return { markLoopStoppedByUser() {} }
      throw Error(`UNEXPECTED_ROUTE_DEPENDENCY:${name}`)
    },
  }, { timeout: 1000 })
  return { run: exports.runOwnedCase as () => Promise<any>, stopped, fallback }
}

test("actual thread-update deselection interrupts the owned desktop scope while unrelated metadata preserves it", async () => {
  const revoke = routerCase("thread.update", selected(), { active_mcp_server_ids: [] })
  assert.equal((await revoke.run()).type, "thread.updated"); assert.deepEqual(revoke.stopped, ["owned-thread"]); assert.deepEqual(revoke.fallback, [])
  const unchanged = routerCase("thread.update", selected(), { alias: "owned alias", active_mcp_server_ids: ["cmspark_lcu", "filesystem"] })
  assert.equal((await unchanged.run()).type, "thread.updated"); assert.deepEqual(unchanged.stopped, [])
})

test("actual thread-update whitelist revocation and failed persistence cannot leave the previous desktop scope alive", async () => {
  for (const [updates, failure] of [[{ tool_whitelist: ["lcu_js_reset"] }, false], [{ active_mcp_server_ids: [] }, true]] as const) {
    const f = routerCase("thread.update", selected(), updates, failure)
    assert.equal((await f.run()).type, failure ? "error" : "thread.updated")
    assert.deepEqual(f.stopped, ["owned-thread"]); assert.deepEqual(f.fallback, [])
  }
})

test("actual user-gesture plan-mode route revokes LCU immediately without changing the read-only policy", async () => {
  const thread = selected(), f = routerCase("thread.execution_policy.set", thread, {})
  assert.equal((await f.run()).type, "thread.execution_policy.updated")
  assert.equal(thread.execution_policy, "plan_readonly")
  assert.deepEqual(f.stopped, ["owned-thread"]); assert.deepEqual(f.fallback, [])
})
