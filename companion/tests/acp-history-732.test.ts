import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

const posixTest = (name: string, fn: () => void | Promise<void>) => test(name, { skip: process.platform === "win32" }, fn)

const sourceRoot = path.resolve(__dirname, "../../src")
const historyFile = path.join(sourceRoot, "acp/history-store.ts")
function historyModule(options: { io?: typeof fs; platform?: string } = {}) {
  const js = ts.transpileModule(fs.readFileSync(historyFile, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} as any }
  vm.runInNewContext(js, { module, exports: module.exports,
    require: (name: string) => {
      if (name === "fs") return options.io || fs
      if (name === "path") return path
      if (name === "crypto") return { randomUUID: () => "owned-fixed" }
      if (name === "./history-privacy") return { verifyHistoryPrivacy: async () => "PRIVATE" }
      // Existing Windows-shaped ACL tests are inert seams; the real initializer has its own controls.
      if (name === "./history-new-empty") return { initializeHistoryEmpty: async () => { assert.equal(options.platform, "win32"); return "INITIALIZED" } }
      throw new Error(`unadmitted history dependency ${name}`)
  }, Buffer, process: { platform: options.platform || "darwin", getuid: () => process.getuid?.() || 0 },
  }, { filename: historyFile })
  return module.exports
}
const record = (id = "session-one", thread = "owner", state = "running") => ({
  session_id: id, thread_id: thread, agent_id: "inert", mode: "review_readonly", state,
  created_at: "2026-10-19T12:00:00.000Z", goal: "NEVER_PERSIST_GOAL", workspace_root: "/NEVER_PERSIST_PATH",
  handback_text: "NEVER_PERSIST_HANDBACK", terminal_command_line: "NEVER_PERSIST_COMMAND",
})

posixTest("#732 accepted metadata survives a fresh store without reviving a runtime handle", async () => {
  const { AcpHistoryStore } = historyModule()
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cmspark-history732-")))
  try {
    const first = new AcpHistoryStore({ root: () => dir, enabled: () => true })
    first.note(record()); await first.settle()
    const second = new AcpHistoryStore({ root: () => dir, enabled: () => true })
    const reply = await second.list("owner", [])
    assert.equal(reply.status, "ok"); assert.equal(reply.rows.length, 1,
      JSON.stringify({ first: await first.list("owner", []), files: fs.readdirSync(dir) }))
    assert.equal(reply.rows[0].history_status, "interrupted")
    const content = fs.readFileSync(path.join(dir, "acp-history.json"), "utf8")
    assert.equal(content.includes("NEVER_PERSIST"), false)
    assert.equal(fs.statSync(path.join(dir, "acp-history.json")).mode & 0o777, 0o600)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

function owned() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cmspark-history732-")))
  return { dir, finish: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
for (const variant of ["offered", "confirmed", "running"] as const) posixTest(`#732 recovered ${variant} is interrupted, current owner remains separate`, async () => {
  const { AcpHistoryStore } = historyModule(), o = owned()
  try {
    const first = new AcpHistoryStore({ root: () => o.dir, enabled: () => true }); first.note(record("one", "owner", variant)); await first.settle()
    const next = new AcpHistoryStore({ root: () => o.dir, enabled: () => true })
    const rows = await next.list("owner", [])
    assert.equal(rows.rows[0].history_status, "interrupted")
    assert.equal((await next.list("foreign", [])).rows.length, 0)
    const current = await next.list("owner", [record("one", "owner", "running")])
    assert.equal(current.rows[0].source, "live"); assert.equal(current.rows[0].history_status, "running")
  } finally { o.finish() }
})
for (const variant of ["closed", "cancelled", "failed"] as const) posixTest(`#732 terminal fact ${variant} survives without rich content`, async () => {
  const { AcpHistoryStore } = historyModule(), o = owned()
  try {
    const first = new AcpHistoryStore({ root: () => o.dir, enabled: () => true })
    first.note({ ...record("one", "owner", "closed"), terminal_kind: variant }); await first.settle()
    const result = await new AcpHistoryStore({ root: () => o.dir, enabled: () => true }).list("owner", [])
    assert.equal(result.rows[0].history_status, "closed"); assert.equal(result.rows[0].terminal_kind, variant)
  } finally { o.finish() }
})
test("#732 disabled performs zero history IO or content publication", async () => {
  const { AcpHistoryStore } = historyModule()
  let roots = 0
  const disabled = new AcpHistoryStore({ root: () => { roots++; throw Error("no root IO") }, enabled: () => false })
  disabled.note(record()); assert.deepEqual(JSON.parse(JSON.stringify(await disabled.list("owner", []))), { status: "disabled", rows: [] })
  assert.equal(roots, 0)
})
for (const [name, mutate] of [
  ["unknown rich field", (v: any) => { v.records[0].goal = "secret not allowed" }],
  ["duplicate ID", (v: any) => { v.records.push({ ...v.records[0], thread_id: "other" }) }],
  ["bad date", (v: any) => { v.records[0].created_at = "2026-02-30T00:00:00.000Z" }],
  ["bad state", (v: any) => { v.records[0].observed_state = "ready" }],
  ["contradictory terminal", (v: any) => { v.records[0].terminal_kind = "failed" }],
  ["owner control bytes", (v: any) => { v.records[0].thread_id = "owner\nforged" }],
  ["extra envelope", (v: any) => { v.secret = "not accepted" }],
  ["oversized ID", (v: any) => { v.records[0].agent_id = "a".repeat(257) }],
] as const) test(`#732 schema rejects ${name}`, () => {
  const { parseAcpHistory, projectAcpHistory } = historyModule()
  const value = { version: 1, records: [projectAcpHistory(record())] }; mutate(value)
  assert.equal(parseAcpHistory(JSON.stringify(value)), null)
})
posixTest("#732 count/byte bounds and active-history protection are finite", async () => {
  const { AcpHistoryStore, parseAcpHistory, projectAcpHistory } = historyModule(), o = owned()
  try {
    assert.equal(parseAcpHistory("x".repeat(1024 * 1024 + 1)), null)
    assert.equal(parseAcpHistory(JSON.stringify({ version: 1, records: Array.from({ length: 33 }, (_, i) => projectAcpHistory(record(String(i)))) })), null)
    const store = new AcpHistoryStore({ root: () => o.dir, enabled: () => true })
    for (let i = 0; i < 33; i++) store.note(record(String(i), "owner", "running"))
    await store.settle()
    const result = await store.list("owner", [])
    assert.equal(result.rows.length, 32)
    assert.equal(result.rows.some((r: any) => r.session_id === "32"), false, "history capacity never evicts current active facts")
  } finally { o.finish() }
})
for (const variant of ["invalid-json", "oversized", "utf8-corrupt"] as const) posixTest(`#732 ${variant} is not partially loaded or overwritten`, async () => {
  const { AcpHistoryStore } = historyModule(), o = owned()
  try {
    const name = path.join(o.dir, "acp-history.json")
    const body = variant === "invalid-json" ? Buffer.from("{") : variant === "oversized" ? Buffer.alloc(1024 * 1024 + 1, 32) : Buffer.from([123, 34, 255, 34, 58, 49, 125])
    fs.writeFileSync(name, body, { mode: 0o600 })
    const store = new AcpHistoryStore({ root: () => o.dir, enabled: () => true }); store.note(record())
    const reply = await store.list("owner", [])
    assert.notEqual(reply.status, "ok"); assert.equal(reply.rows.length, 0)
    assert.equal(fs.readFileSync(name).equals(body), true)
  } finally { o.finish() }
})
posixTest("#732 symlink, multi-link and broad POSIX modes refuse content", async () => {
  const { AcpHistoryStore } = historyModule(), o = owned()
  try {
    const name = path.join(o.dir, "acp-history.json"), target = path.join(o.dir, "target")
    fs.writeFileSync(target, "{}", { mode: 0o600 }); fs.symlinkSync(target, name)
    assert.equal((await new AcpHistoryStore({ root: () => o.dir, enabled: () => true }).list("owner", [])).status, "private_refused")
    fs.unlinkSync(name); fs.linkSync(target, name)
    assert.equal((await new AcpHistoryStore({ root: () => o.dir, enabled: () => true }).list("owner", [])).status, "private_refused")
    fs.unlinkSync(name); fs.unlinkSync(target); fs.writeFileSync(name, "{}", { mode: 0o644 })
    assert.equal((await new AcpHistoryStore({ root: () => o.dir, enabled: () => true }).list("owner", [])).status, "private_refused")
  } finally { o.finish() }
})

function managerWith(history: any) {
  const config = { acp: { enabled: true, servers: { inert: { enabled: true, command: "NEVER_EXECUTED", display_name: "Inert", policy: { profile: "review_readonly" } } } }, coding_handoff: { open_local_terminal: false } }
  const source = fs.readFileSync(path.join(sourceRoot, "acp/manager.ts"), "utf8")
  const imports: Record<string, unknown> = {
    "./win-spawn": {}, fs: {}, os: {}, path,
    "../config": { getConfig: () => config }, "../logger": { logger: { info() {}, warn() {} } },
    "./workspace-bind": { resolveAcpWorkspaceRoot: () => ({ ok: true, root: "/inert" }) },
    "./handback": {}, "./taint": {}, "./discover": { discoverCodingAgents: () => [] },
    "./launch-presets": {}, "./diff-apply": {}, "./handback-format": {}, "./protocol-session": {},
    "./timeline": {}, "./open-local-terminal": {},
    "./progress-caps": { PROGRESS_TAIL_CLI_CHARS: 12000, PROGRESS_TAIL_ACP_CHARS: 12000 },
    "./agent-env": {}, "../pty/session": { onPtyAgentSpawned: () => () => {} }, "../process/windows-job": {}, "./manual-entry": {},
    "./ui-progress": { boundCodingProgress: (v: unknown) => v },
  }
  const module = { exports: {} as any }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, Buffer, require: (name: string) => { assert.ok(Object.hasOwn(imports, name)); return imports[name] } })
  return new module.exports.AcpManager(history)
}

posixTest("#732 actual manager proposal → persisted metadata → fresh manager never revives IDs", async () => {
  const { AcpHistoryStore } = historyModule(), o = owned()
  try {
    const history = new AcpHistoryStore({ root: () => o.dir, enabled: () => true })
    const first = managerWith(history)
    const proposed = first.propose({ threadId: "owner", agentId: "inert", goal: "NEVER_PERSIST_GOAL", workspaceRoot: "/inert" })
    assert.equal(proposed.ok, true); await history.settle()
    const freshHistory = new AcpHistoryStore({ root: () => o.dir, enabled: () => true })
    const rows = await freshHistory.list("owner", [])
    assert.equal(rows.rows.length, 1, "actual production manager must feed the history projection")
    const next = managerWith(freshHistory), id = proposed.session.session_id
    assert.equal(next.getSession(id), undefined)
    assert.equal((await next.start(id)).ok, false)
    assert.equal((await next.promptSession(id, "inert")).ok, false)
    assert.equal(next.applyPendingDiffs(id).ok, false)
    assert.equal(next.cancel(id).ok, false)
    assert.equal(rows.rows[0].history_status, "interrupted")
  } finally { o.finish() }
})

for (const stage of ["root", "empty-temp", "post-commit"] as const) posixTest(`#732 Windows privacy ${stage} refusal is fail-closed (inert ACL seam, not NTFS proof)`, async () => {
  const { AcpHistoryStore } = historyModule({ platform: "win32" }), o = owned()
  let calls = 0, empty = false
  try {
    const privacy = async (paths: string[]) => {
      calls++
      if (stage === "root" && paths.length === 1) return "REFUSED"
      if (paths[1]?.endsWith(".tmp") && fs.statSync(paths[1]).size === 0) {
        empty = true; if (stage === "empty-temp") return "UNKNOWN"
      }
      if (stage === "post-commit" && paths[1]?.endsWith("acp-history.json")) return "UNKNOWN"
      return "PRIVATE"
    }
    const store = new AcpHistoryStore({ root: () => o.dir, enabled: () => true, privacy })
    store.note(record()); await store.settle()
    const result = await store.list("owner", [])
    assert.notEqual(result.status, "ok"); assert.equal(result.rows.length, 0)
    assert.ok(calls > 0)
    const file = path.join(o.dir, "acp-history.json")
    if (stage === "post-commit") { assert.equal(result.status, "commit_unknown"); assert.ok(fs.existsSync(file)); assert.ok(empty) }
    else assert.equal(fs.existsSync(file), false)
    if (stage === "empty-temp") assert.ok(empty, "refused temp had no metadata bytes")
  } finally { o.finish() }
})
for (const stage of ["partial-write", "rename", "close"] as const) posixTest(`#732 ${stage} failure preserves the prior committed file`, async () => {
  const o = owned(), baseline = historyModule()
  try {
    const first = new baseline.AcpHistoryStore({ root: () => o.dir, enabled: () => true }); first.note(record("old", "owner", "closed")); await first.settle()
    const file = path.join(o.dir, "acp-history.json"), old = fs.readFileSync(file)
    let writes = 0, closes = 0
    const io = new Proxy(fs, { get(target, key) {
      if (stage === "partial-write" && key === "writeSync") return (fd: number, buffer: Buffer, offset: number, length: number) => {
        if (++writes > 1) throw Error("inert write failure"); return fs.writeSync(fd, buffer, offset, Math.max(1, Math.floor(length / 2)))
      }
      if (stage === "rename" && key === "renameSync") return () => { throw Error("inert rename failure") }
      if (stage === "close" && key === "closeSync") return (fd: number) => { closes++; fs.closeSync(fd); if (closes === 2) throw Error("inert close failure") }
      return Reflect.get(target, key)
    } })
    const store = new (historyModule({ io }).AcpHistoryStore)({ root: () => o.dir, enabled: () => true })
    store.note(record("new", "owner", "closed")); await store.settle()
    assert.notEqual((await store.list("owner", [])).status, "ok")
    assert.equal(fs.readFileSync(file).equals(old), true)
    assert.equal(fs.readdirSync(o.dir).some(n => n.endsWith(".tmp")), false)
    if (stage === "close") assert.equal(closes, 2, "read fd and write fd each retired once, no second close after throw")
  } finally { o.finish() }
})
posixTest("#732 replaced temp identity is refused and never unlinked as ours", async () => {
  const { AcpHistoryStore } = historyModule({ platform: "win32" }), o = owned()
  let replacement = ""
  try {
    const store = new AcpHistoryStore({ root: () => o.dir, enabled: () => true, privacy: async (paths: string[]) => {
      if (paths[1]?.endsWith(".tmp") && !replacement) { replacement = paths[1]; fs.unlinkSync(replacement); fs.writeFileSync(replacement, "FOREIGN_OWNED_TEST", { mode: 0o600 }) }
      return "PRIVATE"
    } })
    store.note(record()); await store.settle()
    assert.equal((await store.list("owner", [])).status, "private_refused")
    assert.equal(fs.readFileSync(replacement, "utf8"), "FOREIGN_OWNED_TEST")
    assert.equal(fs.existsSync(path.join(o.dir, "acp-history.json")), false)
  } finally { o.finish() }
})
posixTest("#732 disable during empty-temp ACL query writes no content; re-enable retires only owned temp", async () => {
  const { AcpHistoryStore } = historyModule({ platform: "win32" }), o = owned()
  let enabled = true, firstTemp = "", disableOnce = true
  try {
    const store = new AcpHistoryStore({ root: () => o.dir, enabled: () => enabled, privacy: async (paths: string[]) => {
      if (paths[1]?.endsWith(".tmp") && disableOnce) { firstTemp = paths[1]; disableOnce = false; enabled = false }
      return "PRIVATE"
    } })
    store.note(record()); await store.settle()
    assert.equal(fs.statSync(firstTemp).size, 0)
    assert.equal((await store.list("owner", [])).status, "disabled")
    enabled = true
    const result = await store.list("owner", [])
    assert.equal(result.status, "ok"); assert.equal(result.rows.length, 1)
    assert.equal(fs.readdirSync(o.dir).filter(n => n.endsWith(".tmp")).length, 0)
  } finally { o.finish() }
})

posixTest("#732 terminal UI state cannot evict metadata until its actual owned process retires", async () => {
  const { AcpHistoryStore } = historyModule(), o = owned()
  try {
    const store = new AcpHistoryStore({ root: () => o.dir, enabled: () => true })
    for (let i = 0; i < 32; i++) store.note(record(String(i), "owner", "closed"), true)
    store.note(record("extra", "owner", "closed"), true); await store.settle()
    assert.equal((await store.list("owner", [])).rows.some((r: any) => r.session_id === "extra"), false)
    store.note(record("0", "owner", "closed"), false)
    store.note(record("extra", "owner", "closed"), true); await store.settle()
    const next = await store.list("owner", [])
    assert.equal(next.rows.some((r: any) => r.session_id === "extra"), true)
    assert.equal(next.rows.some((r: any) => r.session_id === "0"), false)
  } finally { o.finish() }
})

posixTest("#732 eviction prefers terminal history over an older interrupted observation", async () => {
  const { AcpHistoryStore, projectAcpHistory } = historyModule(), o = owned()
  try {
    const records = Array.from({ length: 32 }, (_, i) => ({ ...projectAcpHistory(record(String(i), "owner", i === 0 ? "running" : "closed")),
      updated_at: `2026-10-19T12:00:${String(i).padStart(2, "0")}.000Z` }))
    fs.writeFileSync(path.join(o.dir, "acp-history.json"), JSON.stringify({ version: 1, records }), { mode: 0o600 })
    const current = new AcpHistoryStore({ root: () => o.dir, enabled: () => true })
    assert.equal((await current.list("owner", [])).rows.length, 32)
    current.note(record("new-current")); await current.settle()
    const result = await current.list("owner", [])
    assert.equal(result.rows.length, 32)
    assert.equal(result.rows.some((r: any) => r.session_id === "0"), true, "old interrupted observation remains while terminal eviction is available")
    assert.equal(result.rows.some((r: any) => r.session_id === "1"), false, "oldest terminal observation is evicted first")
    assert.equal(result.rows.some((r: any) => r.session_id === "new-current"), true)
  } finally { o.finish() }
})

// #732 R1: strict JSON scalars must not be normalized through String(...).
test("#732 persisted observed state requires an actual finite string scalar", () => {
  const { parseAcpHistory, projectAcpHistory } = historyModule()
  const bad: Array<[string, unknown]> = [["single-array", ["running"]], ["nested-array", [["running"]]],
    ["empty-array", []], ["object", {}], ["array-shaped-object", { 0: "running", length: 1 }],
    ["toString-data", { toString: "running" }], ["number", 1], ["null", null], ["missing", undefined], ["boolean", true]]
  const accepted = bad.filter(([, value]) => parseAcpHistory(JSON.stringify({ version: 1,
    records: [{ ...projectAcpHistory(record()), observed_state: value }] })) !== null).map(([name]) => name)
  assert.deepEqual(accepted, [], "all wrong JSON state types must be refused, including single/nested arrays")
})
test("#732 persisted terminal kind requires a finite string when present", () => {
  const { parseAcpHistory, projectAcpHistory } = historyModule()
  const bad: Array<[string, unknown]> = [["single-array", ["failed"]], ["nested-array", [["failed"]]],
    ["object", {}], ["toString-data", { toString: "failed" }], ["number", 1], ["null", null], ["boolean", false]]
  const accepted = bad.filter(([, value]) => parseAcpHistory(JSON.stringify({ version: 1,
    records: [{ ...projectAcpHistory(record("one", "owner", "closed")), terminal_kind: value }] })) !== null).map(([name]) => name)
  assert.deepEqual(accepted, [], "optional terminal kind may be missing but never another JSON type")
})
test("#732 finite state and terminal string positives plus omitted optional kind remain valid", () => {
  const { parseAcpHistory, projectAcpHistory } = historyModule()
  for (const state of ["offered", "confirmed", "running", "handback", "closed"])
    assert.notEqual(parseAcpHistory(JSON.stringify({ version: 1, records: [projectAcpHistory(record("one", "owner", state))] })), null)
  for (const state of ["closed", "handback"]) for (const kind of ["closed", "cancelled", "failed"])
    assert.notEqual(parseAcpHistory(JSON.stringify({ version: 1, records: [{ ...projectAcpHistory(record("one", "owner", state)), terminal_kind: kind }] })), null)
})
test("#732 in-memory projection never invokes state coercion", () => {
  const { projectAcpHistory } = historyModule()
  let coercions = 0
  const projected = projectAcpHistory({ ...record(), state: { toString() { coercions++; return "running" } } })
  assert.equal(projected === null, true, "non-JSON in-memory API must reject the object, not coerce it")
  assert.equal(coercions, 0)
})
posixTest("#732 malformed array file is invalid and preserved rather than an ok reply rejected downstream", async () => {
  const { AcpHistoryStore, projectAcpHistory } = historyModule()
  const results: Array<{ name: string; status: string; rows: number; unchanged: boolean }> = []
  for (const [name, patch] of [["state-array", { observed_state: ["running"] }],
    ["terminal-array", { observed_state: "closed", terminal_kind: ["failed"] }]] as const) {
    const o = owned()
    try {
      const file = path.join(o.dir, "acp-history.json")
      const body = JSON.stringify({ version: 1, records: [{ ...projectAcpHistory(record()), ...patch }] })
      fs.writeFileSync(file, body, { mode: 0o600 })
      const fresh = new AcpHistoryStore({ root: () => o.dir, enabled: () => true })
      const reply = await fresh.list("owner", [])
      fresh.note(record("new-current")); await fresh.settle()
      results.push({ name, status: reply.status, rows: reply.rows.length, unchanged: fs.readFileSync(file, "utf8") === body })
    } finally { o.finish() }
  }
  assert.deepEqual(results, [
    { name: "state-array", status: "invalid", rows: 0, unchanged: true },
    { name: "terminal-array", status: "invalid", rows: 0, unchanged: true },
  ])
})
