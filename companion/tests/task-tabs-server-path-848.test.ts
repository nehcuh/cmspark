import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { captureLocalPageResult } from "../src/business-evidence/executor"
import { EvidenceStore } from "../src/business-evidence/store"
import { resolveEffectiveExecutionPolicy } from "../src/tool/plan-readonly"

/** Execute the actual server orchestration shell with inert external boundaries. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-task-tabs-server-"))
  const filename = path.join(__dirname, "../../src/server.ts"), text = fs.readFileSync(filename, "utf8")
  const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "createToolExecutor")!
  const source = ts.transpileModule(node.getText(ast).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const execution = "11111111-1111-4111-8111-111111111111"
  const worker = { id: "worker", agent_role: "worker", parent_thread_id: "parent", last_run_execution_id: execution }
  const parent = { id: "parent", execution_policy: "default" } as any
  const sent: any[] = [], noop = () => {}, ws: any = { readyState: 1, send: (body: string) => sent.push(JSON.parse(body)) }
  const gate = async (x: any) => ({ ok: true, finalParams: x.finalParams })
  let duringDispatch = () => {}
  const wire = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/task-tabs-848.json"), "utf8"))
  const context: any = { Object, Date, JSON, AbortController, require,
    securityConfirmations: {}, randomUUID: () => "synthetic-session", mcpSessionByWs: new Map(),
    contextReadParams: (_name: string, p: any) => ({ ...p }),
    threadManager: { get: (id: string) => id === "worker" ? worker : id === "parent" ? parent : undefined, isToolAllowed: () => true },
    logger: { info: noop, warn: noop, error: noop }, summarizeToolParams: (p: any) => p, logToolFinish: noop,
    runMultiAgentToolPregate: gate, hasPendingForTab: () => false, toolDisplayNameZh: noop,
    runCookieTrustAdmission: () => ({ ok: true }), runBrowserDownloadAdmission: (x: any) => ({ ok: true, finalParams: x.finalParams }), runL2ToolAdmission: gate,
    getCachedTabUrl: noop, getDomainFromUrl: noop, computerRateLimiter: null, activeTrayConfirmsByWs: new Map(),
    getWsClients: () => [], runUrlNavigateAdmission: gate, runImageFetchAdmission: async () => null,
    isCompanionTool: () => false, isMcpNamespaced: () => false, isSnapshotRequest: () => false,
    getWsAuthState: () => ({ authenticated: true, surface: "panel", origin: "chrome-extension://fixture" }),
    WebSocket: { OPEN: 1 }, pickAuthenticatedClientWs: () => ws,
    forwardL1OrUnavailable: async (ctx: any) => ctx.forward({ ws }),
    forwardToolToExtension: async (ctx: any) => { duringDispatch(); return ctx.toolName === "get_page_text" ? structuredClone(wire.read) : { success: true } },
    getConfigDir: () => root, captureLocalPageResult, resolveEffectiveExecutionPolicy,
  }
  const factory = vm.runInNewContext(source + ";createToolExecutor", context)
  return { root, parent, sent, execution, context, executor: factory(ws), scope: { kind: "chat" as const, threadId: "worker" },
    duringDispatch: (fn: () => void) => { duringDispatch = fn }, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

test("automatic final cleanup cannot reopen a running tool card after chat.done", async () => {
  const f = fixture()
  try {
    const args = { tabId: 7, __thread_id: "worker", __task_tab_cleanup: { automatic: true } }
    assert.equal((await f.executor("automatic", "close_tab", args, undefined, { evidenceScope: f.scope, taskTabCleanupExecutionId: f.execution })).success, true)
    assert.equal(f.sent.some(frame => frame.type === "tool.start"), false)
    await f.executor("ordinary", "close_tab", args, undefined, { evidenceScope: f.scope })
    assert.equal(f.sent.filter(frame => frame.type === "tool.start").length, 1, "ordinary model closes remain visible")
    await f.executor("forged", "close_tab", { ...args, taskTabCleanupExecutionId: f.execution }, undefined, { evidenceScope: f.scope })
    assert.equal(f.sent.filter(frame => frame.type === "tool.start").length, 2, "raw model arguments cannot suppress UI events")
  } finally { f.cleanup() }
})

test("actual image-admission phases inherit the current server-owned task context", async () => {
  const f = fixture(); let metadata: any
  f.context.runImageFetchAdmission = async (ctx: any) => ctx.dispatchToExtension("phase", "analyze_image", { tabId: 7 }, {}, { threadId: "worker", tabId: 7 })
  f.context.dispatchToExtension = async (_id: string, _name: string, _args: any, _peer: any, meta: any) => { metadata = meta; return { success: true } }
  try {
    const result = await f.executor("image", "analyze_image", { tabId: 7 }, undefined, { evidenceScope: f.scope })
    assert.equal(result.success, true)
    assert.deepEqual(JSON.parse(JSON.stringify(metadata.taskContext)), { thread_id: "worker", execution_id: f.execution })
  } finally { f.cleanup() }
})

test("worker page capture respects inherited plan mode both before and during extension dispatch", async () => {
  for (const timing of ["before", "during"] as const) {
    const f = fixture()
    try {
      if (timing === "before") f.parent.execution_policy = "plan_readonly"
      else f.duringDispatch(() => { f.parent.execution_policy = "plan_readonly" })
      const result = await f.executor("read", "get_page_text", { tabId: 7 }, undefined, { evidenceScope: f.scope })
      assert.equal(result.success, true)
      assert.equal(result.data.evidence_capture.capture_status, "skipped", timing)
      assert.equal(result.data.evidence_capture.reason, "PLAN_READONLY", timing)
      assert.equal(new EvidenceStore(f.root, f.scope).read().observations.length, 0, timing)
    } finally { f.cleanup() }
  }
})
