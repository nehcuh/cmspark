import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fork } from "node:child_process"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-project-641-"))
process.env.CMSPARK_DATA_DIR = root
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let router: typeof import("../src/message-router")
let tm: import("../src/threads/thread-manager").ThreadManager
before(async () => {
  await (await import("../src/config")).initDataDir()
  tm = new (await import("../src/threads/thread-manager")).ThreadManager()
  router = await import("../src/message-router")
})
after(async () => { (await import("../src/threads/project-activity")).bindProjectConfirmationProbe(null); fs.rmSync(root, { recursive: true, force: true }) })
const session = { surface: "panel", sendToExtension() {}, executeTool: async () => ({ success: false }) } as any
function call(type: string, rest: Record<string, unknown> = {}) {
  return router.handleMessage({ type, ...rest }, { threadManager: tm } as any, session)
}

test("name-only project is a real independent persisted entity, not a folder rename", async () => {
  const old = tm.create("plain")
  tm.update(old.id, { topic_folder: "separate folder", user_tags: ["original"] })
  const index = fs.readFileSync(path.join(root, "threads", "index.json"))
  const result = await call("project.create", { name: "业务 / 无目录", user_gesture: true,
    operation_id: randomUUID(), expected_revision: 0 })
  assert.equal(result.type, "project.changed")
  assert.equal(result.project.name, "业务 / 无目录")
  assert.match(result.project.id, /^[0-9a-f-]{36}$/)
  assert.equal(result.revision, 1)
  assert.deepEqual(fs.readFileSync(path.join(root, "threads", "index.json")), index)
  assert.equal(tm.get(old.id)?.topic_folder, "separate folder")
  const listed = await call("project.list")
  assert.equal(listed.projects[0].id, result.project.id)
  assert.equal(fs.existsSync(path.join(root, "业务")), false)
})

function operation(revision: number, fields: Record<string, unknown> = {}) { return { user_gesture: true, operation_id: randomUUID(), expected_revision: revision, ...fields } }
async function snapshot() { return call("project.list") }
async function idle() { (await import("../src/threads/project-activity")).bindProjectConfirmationProbe(() => 0) }

test("actual canonical membership projects onto list/get replies without index migration or same-ID inheritance", async () => {
  await idle()
  const project = (await snapshot()).projects[0], thread = tm.create("membership", "incarnation641")
  tm.update(thread.id, { user_tags: ["manual"], topic_folder: "manual folder", workspace_root: root })
  tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "OWNED_SYNTHETIC_ORIGINAL_MESSAGE" })
  const messageBytes = fs.readFileSync(path.join(root, "threads", thread.id + ".json"))
  const index = fs.readFileSync(path.join(root, "threads", "index.json"))
  const result = await call("thread.project.set", operation((await snapshot()).revision, { thread_id: thread.id, project_id: project.id }))
  assert.equal(result.type, "project.changed")
  assert.equal(result.thread.project_id, project.id)
  assert.equal(result.thread.workspace_root, root)
  assert.deepEqual(fs.readFileSync(path.join(root, "threads", "index.json")), index)
  assert.deepEqual(fs.readFileSync(path.join(root, "threads", thread.id + ".json")), messageBytes)
  assert.throws(() => tm.update(thread.id, { project_id: project.id }), /ProjectStore/)
  assert.equal(tm.get(thread.id)?.project_id, undefined, "projection must not mutate index-owned objects")
  const list = await call("thread.list")
  assert.equal(list.threads.find((t: any) => t.id === thread.id).project_id, project.id)
  assert.equal((await call("thread.select", { thread_id: thread.id })).project_id, project.id)
  const reload = new (await import("../src/threads/thread-manager")).ThreadManager()
  assert.equal(reload.projects.projectId(reload.get(thread.id)!), project.id)
  const newIncarnation = { ...thread, created_at: "2099-01-01T00:00:00Z" }
  assert.equal(reload.projects.projectId(newIncarnation), null)
})

test("create replay after reload returns the original current project without rename or duplicate", async () => {
  const request = operation((await snapshot()).revision, { name: "replay" })
  const first = await call("project.create", request)
  const renamed = await call("project.rename", operation(first.revision, { project_id: first.project.id, name: "renamed" }))
  assert.equal(renamed.type, "project.changed")
  const ProjectStore = (await import("../src/threads/project-store")).ProjectStore
  const reopened = new ProjectStore(root)
  const replay = reopened.mutate("project.create", request, { thread: () => undefined, busy: () => "unknown" })
  assert.equal(replay.project?.id, first.project.id)
  assert.equal(replay.project?.name, "renamed")
  assert.equal(replay.revision, renamed.revision)
  assert.equal(replay.unchanged, true)
  assert.equal((await call("project.create", { ...request, name: "forged replay" })).error_code, "PROJECT_INVALID")
})

test("OCC conflict and scoped precommit rename failure leave actual prior file bytes", async () => {
  const state = await snapshot(), project = state.projects[0], previous = fs.readFileSync(path.join(root, "projects.json"))
  assert.equal((await call("project.rename", operation(state.revision - 1, { project_id: project.id, name: "stale" }))).error_code, "PROJECT_CONFLICT")
  const actualFs = require("node:fs"), original = actualFs.renameSync
  actualFs.renameSync = (...args: any[]) => { if (args[1] === path.join(root, "projects.json")) throw new Error("OWNED_PRECOMMIT_FAILURE"); return original(...args) }
  try {
    const failed = await call("project.rename", operation(state.revision, { project_id: project.id, name: "not published" }))
    assert.equal(failed.type, "project.error")
    assert.equal(failed.error_code, "PROJECT_WRITE_FAILED")
    assert.deepEqual(fs.readFileSync(path.join(root, "projects.json")), previous)
    assert.equal((await snapshot()).revision, state.revision)
    assert.equal((await snapshot()).projects[0].name, project.name)
    assert.equal(fs.readdirSync(root).some(n => n.startsWith("projects.json.tmp-") || n === "projects.json.lock"), false)
  } finally { actualFs.renameSync = original }
})

test("actual missing/unknown SCM and current LLM registry refuse association before write", async () => {
  const activity = await import("../src/threads/project-activity"), state = await snapshot(), thread = tm.create("busy")
  const request = operation(state.revision, { thread_id: thread.id, project_id: state.projects[0].id })
  for (const probe of [null, () => NaN, () => { throw new Error("unbound") }]) {
    activity.bindProjectConfirmationProbe(probe)
    assert.equal((await call("thread.project.set", request)).error_code, "PROJECT_ACTIVITY_UNKNOWN")
  }
  await idle(); router.__testSetLlmActiveForTests(thread.id, true)
  try { assert.equal((await call("thread.project.set", request)).error_code, "PROJECT_THREAD_BUSY") }
  finally { router.__testSetLlmActiveForTests(thread.id, false) }
  assert.equal((await snapshot()).revision, state.revision)
  assert.equal((await call("thread.project.set", request)).type, "project.changed")
})

test("actual origin-only SecurityConfirmationManager pending refuses all unsafe guesses, then resolves", async () => {
  const scm = new (await import("../src/security-confirmation")).SecurityConfirmationManager()
  ;(await import("../src/ws/lifecycle")).bindWsLifecycle({ securityConfirmations: scm } as any)
  const state = await snapshot(), thread = tm.create("pending")
  const decision = scm.request(() => {}, { toolName: "terminal.open", dangerousApis: ["pty"], code: "OWNED_SYNTHETIC" }, { originWs: { readyState: 1 } as any })
  assert.equal(scm.pendingCount(), 1)
  assert.equal(scm.hasPendingForWorker(thread.id), false, "origin-only pending must not be guessed thread idle")
  assert.equal((await call("thread.project.set", operation(state.revision, { thread_id: thread.id, project_id: state.projects[0].id }))).error_code, "PROJECT_THREAD_BUSY")
  scm.rejectAll("disconnect"); await decision
  assert.equal((await call("thread.project.set", operation(state.revision, { thread_id: thread.id, project_id: state.projects[0].id }))).type, "project.changed")
  await idle()
})

test("router marks a PTY admission before dynamic import/first await; synthetic deny never spawns", async () => {
  await idle()
  const config = await import("../src/config"), pty = await import("../src/pty/session")
  const state = await snapshot(), thread = tm.create("pending first await")
  tm.update(thread.id, { workspace_root: root });config.saveConfig({ embedded_terminal: { enabled: true } })
  pty.__testSetPtyPlatform("darwin");let spawns = 0
  pty.__testSetPtySpawn(() => { spawns++; throw new Error("OWNED_NATIVE_FORBIDDEN") })
  let decision!: (value: { approved: boolean }) => void
  const pending = router.handleMessage({ type: "terminal.open", id: "owned-pending", thread_id: thread.id, user_gesture: true },
    { threadManager: tm } as any, { ...session, originWs: { readyState: 1 }, requestConfirmation: () => new Promise(resolve => { decision = resolve }) } as any)
  try {
    const refused = await call("thread.project.set", operation(state.revision, { thread_id: thread.id, project_id: state.projects[0].id }))
    assert.equal(refused.error_code, "PROJECT_THREAD_BUSY")
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await import("../src/pty/handler")).hasPendingTerminalOpen(), true)
    assert.equal((await call("thread.project.set", operation(state.revision, { thread_id: thread.id, project_id: state.projects[0].id }))).error_code, "PROJECT_THREAD_BUSY")
    decision({ approved: false });assert.equal((await pending).code, "denied")
    assert.equal(spawns, 0);assert.equal((await snapshot()).revision, state.revision)
  } finally { if (decision) decision({ approved: false });await pending;pty.__testResetPtySessions();config.saveConfig({ embedded_terminal: { enabled: false } }) }
})

test("actual ACP offered record blocks association, without starting any CLI/model", async () => {
  await idle()
  const config = await import("../src/config"), manager = (await import("../src/acp/manager")).getAcpManager()
  config.saveConfig({ acp: { enabled: true, servers: { owned: { enabled: true, command: process.execPath, args: [], protocol: "cli", policy: { profile: "review_readonly" } } } } } as any)
  const state = await snapshot(), thread = tm.create("offered only")
  const offered = manager.propose({ threadId: thread.id, agentId: "owned", goal: "OWNED_NOT_EXECUTED", workspaceRoot: root })
  assert.ok(offered.ok)
  if (!offered.ok) return
  try { assert.equal((await call("thread.project.set", operation(state.revision, { thread_id: thread.id, project_id: state.projects[0].id }))).error_code, "PROJECT_THREAD_BUSY");assert.equal(offered.session.pid, undefined) }
  finally { manager.cancel(offered.session.session_id);config.saveConfig({ acp: { ...config.getConfig().acp!, enabled: false } }) }
})

test("real embed-intent and extension pending-tool producers block metadata, without consuming either", async () => {
  await idle()
  const intent = await import("../src/acp/open-local-terminal"), tools = await import("../src/ws/tool-forward")
  const state = await snapshot(), thread = tm.create("pending tools"), request = operation(state.revision, { thread_id: thread.id, project_id: state.projects[0].id })
  intent.recordEmbedIntent(thread.id, { cwd: root, file: process.execPath, args: ["OWNED_NOT_EXECUTED"] })
  assert.equal((await call("thread.project.set", request)).error_code, "PROJECT_THREAD_BUSY")
  assert.ok(intent.peekEmbedIntent(thread.id), "metadata must not consume launch intent")
  intent.takeEmbedIntent(thread.id)
  const peer = { readyState: 1, send() {} } as any
  const pending = tools.dispatchToExtension("owned-project-641", "get_page_info", {}, peer, { threadId: thread.id })
  assert.equal(tools.listPendingToolsForThread(thread.id).length, 1)
  assert.equal((await call("thread.project.set", request)).error_code, "PROJECT_THREAD_BUSY")
  tools.handleToolResult({ type: "tool.result", tool_call_id: "owned-project-641", success: true, data: {} }, peer)
  await pending
  assert.equal((await snapshot()).revision, state.revision)
})

test("rename is label only; archive refuses one busy member atomically, then archive/restore preserve membership", async () => {
  await idle()
  const state = await snapshot(), project = state.projects[0], member = (await call("thread.list")).threads.find((t: any) => t.project_id === project.id)
  router.__testSetLlmActiveForTests(member.id, true)
  try {
    const renamed = await call("project.rename", operation(state.revision, { project_id: project.id, name: "label only" }))
    assert.equal(renamed.type, "project.changed")
    assert.equal(renamed.project.id, project.id)
    assert.equal((await call("project.archive", operation(renamed.revision, { project_id: project.id }))).error_code, "PROJECT_THREAD_BUSY")
    assert.equal((await snapshot()).revision, renamed.revision)
  } finally { router.__testSetLlmActiveForTests(member.id, false) }
  const archived = await call("project.archive", operation((await snapshot()).revision, { project_id: project.id }))
  assert.ok(archived.project.archived_at)
  assert.equal((await call("thread.select", { thread_id: member.id })).project_id, project.id)
  const outsider = tm.create("outside")
  assert.equal((await call("thread.project.set", operation(archived.revision, { thread_id: outsider.id, project_id: project.id }))).error_code, "PROJECT_ARCHIVED")
  const restored = await call("project.restore", operation(archived.revision, { project_id: project.id }))
  assert.equal(restored.project.archived_at, null)
  assert.ok(tm.get(member.id)); assert.equal(fs.existsSync(path.join(root, "threads", member.id + ".json")), true)
})

test("schema/overlay HTTP gate deny mixed metadata+authority and untrusted surfaces", async () => {
  const acl = await import("../src/ws/summoner-acl"), validate = await import("../src/ws/validate")
  const state = await snapshot()
  for (const key of ["workspace_root", "config_override", "security_token", "approved", "trust", "__proto__"]) {
    const fields = JSON.parse(JSON.stringify({ ...operation(state.revision, { name: "safe" }), [key]: "FORBIDDEN" }))
    const message = { type: "project.create", ...fields }
    assert.equal(validate.validateWsMessage(message).valid, false)
    assert.equal(acl.applySummonerPayloadPolicy("summoner", message).ok, false)
    assert.equal((await call("project.create", fields)).error_code, "PROJECT_INVALID")
  }
  assert.equal((await router.handleMessage({ type: "project.list" }, { threadManager: tm } as any, { ...session, surface: "tray" })).error_code, "PROJECT_METHOD_DENIED")
  assert.equal((await snapshot()).revision, state.revision)
})

test("corrupt/missing project still permits original conversation; read never creates or resets metadata", async () => {
  const file = path.join(root, "projects.json"), original = fs.readFileSync(file)
  try {
    const dangling = JSON.parse(original.toString())
    const binding = dangling.bindings[0];assert.ok(binding)
    dangling.projects = dangling.projects.filter((p: any) => p.id !== binding.project_id)
    fs.writeFileSync(file, JSON.stringify(dangling))
    assert.equal((await call("thread.list")).threads.find((t: any) => t.id === binding.thread_id).project_id, binding.project_id)
    assert.equal((await call("thread.select", { thread_id: binding.thread_id })).messages[0].content, "OWNED_SYNTHETIC_ORIGINAL_MESSAGE")
    fs.writeFileSync(file, "{BROKEN_OWNED_FIXTURE")
    assert.equal((await snapshot()).error_code, "PROJECT_STORE_INVALID")
    const listed = await call("thread.list")
    assert.ok(listed.threads.length > 0)
    assert.equal(listed.project_metadata_unavailable, true)
    assert.equal(fs.readFileSync(file, "utf8"), "{BROKEN_OWNED_FIXTURE")
    fs.unlinkSync(file)
    assert.equal((await snapshot()).revision, 0)
    assert.equal(fs.existsSync(file), false)
  } finally { fs.writeFileSync(file, original) }
})

test("two actual Node writers start at persisted revision zero: exactly one commits", async () => {
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-project-641-two-writers-"))
  const children = ["owned A", "owned B"].map(name => fork(path.resolve(__dirname, "../../tests/fixtures/project-641-writer.cjs"),
    [path.resolve(__dirname, "../src/threads/project-store.js"), shared, name], {
      env: { HOME: shared, PATH: path.dirname(process.execPath) }, execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"],
    }))
  try {
    const receipts = children.map(child => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("OWNED_WRITER_TIMEOUT")), 5000)
      child.on("message", message => { if (!(message as any)?.ready) { clearTimeout(timer); resolve(message) } })
      child.once("error", reject)
    }))
    await Promise.all(children.map(child => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("OWNED_WRITER_READY_TIMEOUT")), 5000)
      child.once("message", () => { clearTimeout(timeout); resolve() }); child.once("error", reject)
    })))
    children.forEach(child => child.send({ go: true }))
    const results = await Promise.all(receipts)
    assert.equal(results.filter(r => r.ok).length, 1)
    assert.ok(["PROJECT_STORE_BUSY", "PROJECT_CONFLICT"].includes(results.find(r => !r.ok).error_code))
    const reopened = new (await import("../src/threads/project-store")).ProjectStore(shared)
    assert.equal(reopened.list().revision, 1)
    assert.equal(reopened.list().projects.length, 1)
    assert.equal(fs.readdirSync(shared).some(f => f.includes(".lock") || f.includes(".tmp-")), false)
    await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise<void>(resolve => child.once("exit", () => resolve()))))
  } finally { children.forEach(child => { if (child.exitCode === null) child.kill() }); fs.rmSync(shared, { recursive: true, force: true }) }
})

test("store budgets and retained unknown lock refuse without resetting; symlink never followed", async t => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-project-641-budget-"))
  const { ProjectStore, PROJECT_MAX_ROWS } = await import("../src/threads/project-store")
  const store = new ProjectStore(isolated), runtime = { thread: () => undefined, busy: () => "unknown" as const }
  try {
    const first = store.mutate("project.create", operation(0, { name: "template" }), runtime)
    const saved = JSON.parse(fs.readFileSync(store.file, "utf8"))
    const actual = saved.projects[0]
    saved.projects = Array.from({ length: PROJECT_MAX_ROWS }, (_, i) => ({ ...actual, id: randomUUID(), creation_operation_id: randomUUID(), name: "owned " + i }))
    fs.writeFileSync(store.file, JSON.stringify(saved))
    const bytes = fs.readFileSync(store.file)
    assert.throws(() => store.mutate("project.create", operation(first.revision, { name: "over budget" }), runtime), (e: any) => e.code === "PROJECT_LIMIT")
    assert.deepEqual(fs.readFileSync(store.file), bytes)
    fs.writeFileSync(store.file + ".lock", "OWNED_UNKNOWN_LOCK")
    assert.throws(() => store.mutate("project.rename", operation(first.revision, { project_id: saved.projects[0].id, name: "no" }), runtime), (e: any) => e.code === "PROJECT_STORE_BUSY")
    assert.equal(fs.readFileSync(store.file + ".lock", "utf8"), "OWNED_UNKNOWN_LOCK")
    fs.unlinkSync(store.file + ".lock")
    fs.renameSync(store.file, store.file + ".owned-original")
    try { fs.symlinkSync(store.file + ".owned-original", store.file) }
    catch (e: any) { if (["EPERM", "EACCES"].includes(e.code)) { t.diagnostic("owned symlink unavailable on this platform; no symlink-follow claim"); return }; throw e }
    assert.throws(() => store.list(), (e: any) => e.code === "PROJECT_STORE_INVALID")
    assert.deepEqual(fs.readFileSync(store.file + ".owned-original"), bytes)
  } finally { fs.rmSync(isolated, { recursive: true, force: true }) }
})
