import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
const filename = path.resolve(__dirname, "../../src/acp/handlers.ts")
function fixture() {
  const cfg = { acp: { enabled: true } }
  let exists = true, role: string | undefined = "main", calls = 0, after = () => {}
  const module = { exports: {} as any }
  const manager = { listHistoryForThread: async (thread: string) => { calls++; after(); return { status: "ok", rows: [{ thread_id: thread, session_id: "synthetic" }] } } }
  const imports: Record<string, unknown> = { fs: {}, "../config": { getConfig: () => cfg }, "../logger": {},
    "./manager": { getAcpManager: () => manager }, "./discover": {}, "./confirm-copy": {}, "./git-status": {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, Buffer, require: (name: string) => { assert.ok(Object.hasOwn(imports, name)); return imports[name] } })
  const context = { threadId: "owner", hasThread: () => exists, getAgentRole: () => role }
  return { cfg, context, calls: () => calls, setExists: (v: boolean) => { exists = v }, setRole: (v: string) => { role = v },
    setAfter: (f: () => void) => { after = f },
    query: (overrides = {}) => module.exports.handleAcpWsMessage("acp.sessions.list", { thread_id: "owner", request_id: "history:one", ...overrides }, context) }
}
test("#732 full history handler binds owner/request and preserves only metadata output", async () => {
  const f = fixture(), reply = await f.query()
  assert.equal(reply.type, "acp.sessions.list_result"); assert.equal(reply.thread_id, "owner"); assert.equal(reply.request_id, "history:one")
  assert.equal(f.calls(), 1)
})
for (const variant of ["foreign", "worker", "missing", "bad-request", "empty-owner"] as const) test(`#732 full handler ${variant} refuses before history I/O`, async () => {
  const f = fixture()
  if (variant === "foreign") f.context.threadId = "foreign"
  if (variant === "worker") f.setRole("worker")
  if (variant === "missing") f.setExists(false)
  const reply = await f.query(variant === "bad-request" ? { request_id: "untrusted\n" } : variant === "empty-owner" ? { thread_id: "" } : {})
  assert.equal(reply.type, "error"); assert.equal(reply.error, "ACP_HISTORY_OWNER_INVALID"); assert.equal(f.calls(), 0)
})
for (const variant of ["deleted", "worker", "disabled"] as const) test(`#732 owner/enable changes after history await: ${variant}`, async () => {
  const f = fixture(); f.setAfter(() => {
    if (variant === "deleted") f.setExists(false)
    if (variant === "worker") f.setRole("worker")
    if (variant === "disabled") f.cfg.acp.enabled = false
  })
  const reply = await f.query()
  if (variant === "disabled") { assert.equal(reply.status, "disabled"); assert.equal(reply.rows.length, 0) }
  else { assert.equal(reply.type, "error"); assert.equal(reply.rows, undefined) }
})
test("#732 disabled query never calls the history store", async () => {
  const f = fixture(); f.cfg.acp.enabled = false
  const reply = await f.query(); assert.equal(reply.status, "disabled"); assert.equal(reply.rows.length, 0); assert.equal(f.calls(), 0)
})
