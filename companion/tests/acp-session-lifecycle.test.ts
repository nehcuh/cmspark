import test, { before, after, type TestContext } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-acp-lifecycle-"))
process.env.CMSPARK_DATA_DIR = root
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let AcpManager: typeof import("../src/acp/manager").AcpManager
let saveConfig: typeof import("../src/config").saveConfig
before(async () => {
  const config = await import("../src/config")
  await config.initDataDir()
  saveConfig = config.saveConfig
  AcpManager = (await import("../src/acp/manager")).AcpManager
})
after(() => fs.rmSync(root, { recursive: true, force: true }))

async function until(check: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (!check()) {
    assert.ok(Date.now() < deadline, "fixture state did not arrive before deadline")
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true } catch { return false }
}
function setup(t: TestContext, mode: string) {
  const workspace = fs.mkdtempSync(path.join(root, "session-"))
  const pidFile = path.join(workspace, "pid"), stageFile = path.join(workspace, "stage")
  const permissionFile = path.join(workspace, "permission")
  saveConfig({ acp: { enabled: true, servers: { fixture: {
    enabled: true, command: process.execPath,
    args: [path.resolve("tests/fixtures/acp-lifecycle.cjs")], protocol: "acp",
    env: { FIXTURE_MODE: mode, FIXTURE_PID_FILE: pidFile, FIXTURE_STAGE_FILE: stageFile,
      FIXTURE_PERMISSION_FILE: permissionFile }, policy: { profile: "review_readonly" },
  } } }, coding_handoff: { open_local_terminal: false } } as any)
  const manager = new AcpManager()
  t.after(() => {
    manager.shutdown()
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, "utf8"))
      try { process.kill(pid, "SIGKILL") } catch { /* already reaped */ }
    }
  })
  const offered = manager.propose({ threadId: "fixture-thread", agentId: "fixture",
    goal: "return controlled output", workspaceRoot: workspace })
  assert.ok(offered.ok)
  const session = offered.session
  return { manager, session, pidFile, stageFile, permissionFile }
}

test("persistent ACP success preserves only message chunks, denies permission and reaps the child", async t => {
  const { manager, session, pidFile, permissionFile } = setup(t, "normal")
  const result = await manager.start(session.session_id)
  assert.ok(result.ok)
  assert.equal(session.agent_output_text, '{"result":"真实分块✅"}')
  assert.equal(session.agent_text, session.agent_output_text)
  assert.equal(session.partial, false)
  assert.equal(session.terminal_kind, "closed")
  assert.ok(session.timeline?.some(item => item.label.includes("EXCLUDED_REASONING")), JSON.stringify(session.timeline))
  assert.ok(!session.handback_text?.includes("EXCLUDED_REASONING"))
  assert.ok(!session.handback_text?.includes("ACP initialize"))
  assert.deepEqual(JSON.parse(fs.readFileSync(permissionFile, "utf8")), {
    outcome: { outcome: "cancelled" }, approved: false,
  })
  const pid = Number(fs.readFileSync(pidFile, "utf8"))
  await until(() => !alive(pid))
})

for (const mode of ["hang-init", "hang-prompt"]) test(`cancel during ${mode} stops the actual child and never starts a fallback`, async t => {
  const { manager, session, pidFile, stageFile } = setup(t, mode)
  const pending = manager.start(session.session_id)
  const stage = mode === "hang-init" ? "initialize" : "prompt"
  await until(() => fs.existsSync(stageFile) && fs.readFileSync(stageFile, "utf8") === stage)
  const pid = Number(fs.readFileSync(pidFile, "utf8"))
  assert.equal(manager.cancel(session.session_id).ok, true)
  assert.equal((await pending).ok, false)
  await until(() => !alive(pid))
  assert.equal(session.terminal_kind, "cancelled")
  assert.equal(session.partial, true)
  assert.equal(fs.readFileSync(stageFile, "utf8"), stage)
})

test("reasoning and status alone remain an empty partial handback", async t => {
  const { manager, session } = setup(t, "empty")
  assert.equal((await manager.start(session.session_id)).ok, true)
  assert.equal(session.agent_output_text, undefined)
  assert.equal(session.partial, true)
  assert.ok(!session.handback_text?.includes("EXCLUDED_REASONING"))
  assert.ok(!session.handback_text?.includes("ACP initialized"))
})

test("oversized assistant output cancels only its session and retains bounded text", async t => {
  const { manager, session, pidFile } = setup(t, "oversize")
  const result = await manager.start(session.session_id)
  assert.equal(result.ok, false)
  assert.equal(session.partial, true)
  assert.equal(session.terminal_kind, "cancelled")
  assert.ok(Buffer.byteLength(session.agent_output_text || "") <= 256 * 1024)
  await until(() => !alive(Number(fs.readFileSync(pidFile, "utf8"))))
})
