import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import cp from "node:child_process"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-manual-entry-522-"))
process.env.CMSPARK_DATA_DIR = root
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let config: typeof import("../src/config")
let manager: typeof import("../src/acp/manager")
let handlers: typeof import("../src/acp/handlers")
before(async () => {
  config = await import("../src/config"); await config.initDataDir()
  manager = await import("../src/acp/manager"); handlers = await import("../src/acp/handlers")
})
after(async () => { await manager.getAcpManager().shutdown(); fs.rmSync(root, { recursive: true, force: true }) })

// An inert known-CLI print/stdio fixture: no Node REPL, model, TUI, native terminal or network.
// The actual successful AcpManager spawn and actual handler produce the tested shape.
function cliFixture(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  const script = path.join(dir, "inert-cli.cjs")
  fs.writeFileSync(script, "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('Synthetic CLI handback'));\n")
  const command = path.join(dir, process.platform === "win32" ? "claude.cmd" : "claude")
  fs.writeFileSync(command, process.platform === "win32"
    ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!${fs.realpathSync(process.execPath)}\n${fs.readFileSync(script, "utf8")}`, { mode: 0o700 })
  return command
}
function configure(command: string, args?: string[]) {
  config.saveConfig({ acp: { enabled: true, servers: { claude: {
    enabled: true, protocol: "cli", command, ...(args ? { args } : {}), policy: { profile: "review_readonly" },
  } } }, coding_handoff: { open_local_terminal: false }, embedded_terminal: { enabled: false } } as any)
}
const request = (sid: string, owner = "manual-owner", id = "manual-522-request") => ({ session_id: sid, thread_id: owner, request_id: id, user_gesture: true })

test("actual default-off CLI spawn prepares a fresh owner-only command without file or subprocess side effects", async (t) => {
  const command = cliFixture(path.join(root, "known cli")); configure(command)
  const mgr = manager.getAcpManager(), events: any[] = []
  const off = mgr.onEvent(e => events.push(e)); t.after(off)
  const offered = mgr.propose({ threadId: "manual-owner", agentId: "claude", goal: "Synthetic entry task", workspaceRoot: root })
  assert.ok(offered.ok)
  const result = await mgr.start(offered.session.session_id)
  assert.ok(result.ok)
  assert.equal(offered.session.transport, "cli")
  assert.equal(offered.session.local_terminal, "skipped")
  assert.equal(offered.session.terminal_command_line, undefined)
  const wrong = await handlers.handleAcpWsMessage("acp.session.prepare_manual_entry", request(offered.session.session_id, "other-owner"), {})
  assert.equal(wrong.type, "error"); assert.equal(wrong.command_line, undefined)
  const replacements = path.join(root, "unrelated cli"); const newCommand = cliFixture(replacements)
  configure(newCommand, ["SYNTHETIC_SECRET_ARG"])
  const envSentinel = "SYNTHETIC_ENV_SECRET"
  config.saveConfig({ acp: { servers: { claude: { env: { SYNTHETIC_KEY: envSentinel } } } } } as any)
  const calls: string[] = []
  const mocks: Array<{ mock: { restore(): void } }> = []
  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"] as const)
    mocks.push(t.mock.method(cp, key, () => { calls.push(key); throw new Error("prepare must not execute") }))
  for (const key of ["writeFileSync", "mkdirSync", "mkdtempSync", "unlinkSync"] as const)
    mocks.push(t.mock.method(fs, key, () => { calls.push(key); throw new Error("prepare must not write") }))
  let prepared: any
  try { prepared = await handlers.handleAcpWsMessage("acp.session.prepare_manual_entry", request(offered.session.session_id), {}) }
  finally { for (const mock of mocks) mock.mock.restore() }
  assert.deepEqual(calls, [])
  assert.equal(prepared.type, "acp.session.manual_entry")
  assert.equal(prepared.thread_id, "manual-owner"); assert.equal(prepared.session_id, offered.session.session_id)
  assert.equal(prepared.request_id, "manual-522-request")
  assert.equal(prepared.shell, process.platform === "win32" ? "cmd.exe" : "POSIX sh")
  assert.ok(prepared.command_line.includes(command), "uses actual old validated executable, not later config")
  assert.equal(prepared.command_line.includes(newCommand), false)
  assert.equal(/task\.md|Get-Content|SYNTHETIC_SECRET|SYNTHETIC_ENV_SECRET/.test(prepared.command_line), false)
  assert.equal(Buffer.byteLength(prepared.command_line) <= 32 * 1024, true)
  for (const publicValue of [offered, events, mgr.getSession(offered.session.session_id)]) {
    assert.equal(JSON.stringify(publicValue).includes(prepared.command_line), false)
    assert.equal(JSON.stringify(publicValue).includes("manualEntryLaunch"), false)
  }
  const tools = await import("../src/tool/companion-dispatch")
  const { ThreadManager } = await import("../src/threads/thread-manager")
  tools.bindCompanionDispatchRuntime({ getThreadManager: () => new ThreadManager(), getSkillEngine: () => null, getComputerEstopEnsureOverride: () => null } as any)
  const status = await tools.executeCompanionTool("acp_get_status", { session_id: offered.session.session_id, _thread_id: "manual-owner" })
  assert.equal(JSON.stringify(status).includes(prepared.command_line), false)
  if (process.env.CMSPARK_RECORD_MANUAL_ENTRY_FIXTURE) {
    const normalize = (value: unknown): unknown => typeof value === "string"
      ? value.replaceAll(offered.session.session_id, "manual-entry-session").replaceAll(root, "/fixture/manual-entry")
      : Array.isArray(value) ? value.map(normalize) : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)])) : value
    fs.writeFileSync(process.env.CMSPARK_RECORD_MANUAL_ENTRY_FIXTURE, JSON.stringify(normalize({ proposed: offered.session, progress: events.at(-1), prepared, wrong }), null, 2) + "\n")
  }
  // Exercise the actual validator and actual message-router dispatch, not a parallel test RPC.
  const { validateWsMessage } = await import("../src/ws/validate")
  const { handleMessage } = await import("../src/message-router")
  const wire = { type: "acp.session.prepare_manual_entry", ...request(offered.session.session_id) }
  assert.equal(validateWsMessage(wire).valid, true)
  for (const patch of [{ user_gesture: false }, { request_id: {} }, { thread_id: null }])
    assert.equal(validateWsMessage({ ...wire, ...patch }).valid, false)
  const services = { threadManager: { get: (id: string) => id === "manual-owner"
    ? { id, agent_role: "normal", workspace_root: root } : null }, skillEngine: null, historyStore: null }
  const routed = await handleMessage(wire, services as any)
  assert.deepEqual(routed, prepared, "actual router reaches owner-scoped UI-only producer")
  const blockedWorker = await handleMessage({ ...wire }, { ...services,
    threadManager: { get: () => ({ agent_role: "worker", workspace_root: root }) } } as any)
  assert.equal(blockedWorker.type, "error"); assert.equal(blockedWorker.command_line, undefined)
  fs.unlinkSync(command)
  const missing = await handlers.handleAcpWsMessage("acp.session.prepare_manual_entry", request(offered.session.session_id), {})
  assert.equal(missing.type, "error"); assert.equal(missing.command_line, undefined)
})

test("actual handler rejects disabled, worker, missing/structured metadata and absent legacy descriptor", async () => {
  const command = cliFixture(path.join(root, "unstarted cli")); configure(command)
  const offered = manager.getAcpManager().propose({ threadId: "manual-owner", agentId: "claude", goal: "Unstarted", workspaceRoot: root }); assert.ok(offered.ok)
  const valid = request(offered.session.session_id)
  for (const patch of [{ user_gesture: false }, { thread_id: undefined }, { thread_id: {} }, { session_id: {} }, { request_id: {} }]) {
    const reply = await handlers.handleAcpWsMessage("acp.session.prepare_manual_entry", { ...valid, ...patch }, {})
    assert.equal(reply.type, "error"); assert.equal(reply.command_line, undefined)
  }
  const legacy = await handlers.handleAcpWsMessage("acp.session.prepare_manual_entry", valid, {})
  assert.equal(legacy.type, "error"); assert.match(legacy.error, /验证|启动|descriptor/)
  const worker = await handlers.handleAcpWsMessage("acp.session.prepare_manual_entry", valid, { getAgentRole: () => "worker" })
  assert.equal(worker.type, "error"); assert.equal(worker.command_line, undefined)
  config.saveConfig({ acp: { enabled: false } } as any)
  const disabled = await handlers.handleAcpWsMessage("acp.session.prepare_manual_entry", valid, {})
  assert.equal(disabled.type, "error"); assert.match(disabled.error, /disabled/)
  manager.getAcpManager().cancel(offered.session.session_id)
})


test("manual entry refuses a workspace replaced at the same canonical path", async () => {
  const helper = await import("../src/acp/manual-entry")
  const command = cliFixture(path.join(root, "workspace identity cli"))
  const cwd = path.join(root, "workspace identity")
  fs.mkdirSync(cwd)
  const captured = helper.captureManualEntryLaunch({ agentId: "claude", command, cwd })
  assert.equal(helper.prepareManualEntry(captured).ok, true)
  fs.writeFileSync(path.join(cwd, "ordinary-workspace-edit"), "safe edit")
  assert.equal(helper.prepareManualEntry(captured).ok, true, "ordinary content changes preserve directory identity")
  const displaced = cwd + "-displaced"
  const replacement = cwd + "-replacement"
  fs.mkdirSync(replacement)
  fs.renameSync(cwd, displaced)
  fs.renameSync(replacement, cwd)
  const reply = helper.prepareManualEntry(captured)
  assert.equal(reply.ok, false, "same path now names a different workspace and must not inherit launch provenance")
  if (!reply.ok) assert.match(reply.error, /变化|删除/)
})


test("manual entry declines unsafe shell paths, wrappers and secret-bearing custom args", async () => {
  const helper = await import("../src/acp/manual-entry")
  assert.equal(helper.manualEntryPathsSafe("/opt/known cli/claude", "/work/中文 space", "linux"), true)
  for (const value of ["/work/owner's directory", "/work/new\nline", "relative-directory"]) {
    assert.equal(helper.manualEntryPathsSafe("/opt/claude", value, "linux"), false)
  }
  assert.equal(helper.manualEntryPathsSafe("C:\\Known CLI\\claude.cmd", "C:\\工作区 space", "win32"), true)
  for (const value of ["C:\\%TOKEN%", "C:\\!TOKEN!", "C:\\path&calc", "C:\\x|other", 'C:\\quoted"path'])
    assert.equal(helper.manualEntryPathsSafe("C:\\cli\\claude.cmd", value, "win32"), false)
  const command = cliFixture(path.join(root, "unsupported cli"))
  for (const input of [
    { agentId: "claude", command, cwd: root, args: ["--token", "SYNTHETIC_SECRET"] },
    { agentId: "claude", command: process.execPath, cwd: root },
    { agentId: "unknown-fixture", command, cwd: root },
  ]) {
    const result = helper.prepareManualEntry(helper.captureManualEntryLaunch(input))
    assert.equal(result.ok, false)
    assert.equal(JSON.stringify(result).includes("SYNTHETIC_SECRET"), false)
    assert.equal("commandLine" in result, false)
  }
  const captured = helper.captureManualEntryLaunch({ agentId: "claude", command, cwd: root })
  assert.equal(helper.prepareManualEntry(captured).ok, true)
  fs.appendFileSync(command, "\n// replaced executable bytes\n")
  assert.equal(helper.prepareManualEntry(captured).ok, false, "changed executable cannot inherit provenance")
})

test("actual POSIX shell executes only the inert verified CLI with safely quoted cwd", {
  skip: process.platform === "win32" ? "POSIX shell construction; Windows cmd execution requires native Windows gate" : false,
}, async () => {
  const helper = await import("../src/acp/manual-entry")
  const dir = path.join(root, "shell-safe 中文 $(touch INJECTED)")
  fs.mkdirSync(dir)
  const command = path.join(root, "claude")
  fs.writeFileSync(command, `#!${fs.realpathSync(process.execPath)}\nprocess.stdout.write(JSON.stringify({ cwd:process.cwd(), args:process.argv.slice(2) }))\n`, { mode: 0o700 })
  const reply = helper.prepareManualEntry(helper.captureManualEntryLaunch({ agentId: "claude", command, cwd: dir }))
  assert.equal(reply.ok, true)
  if (!reply.ok) return
  const observed = JSON.parse(cp.execFileSync("/bin/sh", ["-c", reply.commandLine], { cwd: root, input: "", timeout: 2000, encoding: "utf8" }))
  assert.deepEqual(observed, { cwd: fs.realpathSync(dir), args: [] })
  assert.equal(fs.existsSync(path.join(root, "INJECTED")), false)
  assert.equal(fs.existsSync(path.join(dir, "INJECTED")), false)
})


test("native Windows cmd runs only the inert verified CLI in its captured cwd", {
  skip: process.platform !== "win32" ? "Native Windows cmd contract; POSIX construction is tested separately" : false,
}, async () => {
  const helper = await import("../src/acp/manual-entry")
  const dir = path.join(root, "Windows 工作区 space")
  fs.mkdirSync(dir)
  const script = path.join(root, "windows-entry-fixture.cjs")
  fs.writeFileSync(script, "process.stdout.write(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));\n")
  const command = path.join(root, "claude.cmd")
  fs.writeFileSync(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
  const reply = helper.prepareManualEntry(helper.captureManualEntryLaunch({ agentId: "claude", command, cwd: dir }))
  assert.equal(reply.ok, true)
  if (!reply.ok) return
  assert.equal(reply.shell, "cmd.exe")
  // Node's shell adapter quotes the whole CMD expression and disables CRT
  // argument escaping; execFileSync would re-escape this already quoted line.
  const observed = JSON.parse(cp.execSync(reply.commandLine, {
    shell: "cmd.exe", cwd: root, input: "", timeout: 5000, encoding: "utf8",
  }))
  assert.deepEqual(observed, { cwd: fs.realpathSync(dir), args: [] })
})
