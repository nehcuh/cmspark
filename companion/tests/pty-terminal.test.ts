/**
 * #432 P0 companion: terminal.* wire, L2, plan_readonly, cwd, ack watermark, kill.
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { CodeReviewService } from "../src/code-review/service"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-pty-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let handleMessage: typeof import("../src/message-router").handleMessage
let validateWsMessage: typeof import("../src/ws/validate").validateWsMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let saveConfig: typeof import("../src/config").saveConfig
let initDataDir: typeof import("../src/config").initDataDir
let pty: typeof import("../src/pty/session")
let buildTerminalEnv: typeof import("../src/pty/env").buildTerminalEnv
let resolveTerminalStartCwd: typeof import("../src/pty/cwd").resolveTerminalStartCwd

class MockPty {
  // Synthetic handle must never target a real OS PID during close/kill tests.
  pid = 0
  paused = false
  killed = false
  writes: string[] = []
  private dataCb: ((d: string) => void) | undefined
  private exitCb: ((e: { exitCode: number; signal?: number }) => void) | undefined
  write(d: string) {
    this.writes.push(d)
  }
  resize() {}
  pause() {
    this.paused = true
  }
  resume() {
    this.paused = false
  }
  kill() {
    this.killed = true
    this.exitCb?.({ exitCode: 0, signal: 0 })
  }
  onData(cb: (d: string) => void) {
    this.dataCb = cb
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
    this.exitCb = cb
  }
  emit(d: string) {
    this.dataCb?.(d)
  }
}

let lastPty: MockPty | null = null

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  saveConfig = configMod.saveConfig
  await initDataDir()
  handleMessage = (await import("../src/message-router")).handleMessage
  validateWsMessage = (await import("../src/ws/validate")).validateWsMessage
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  pty = await import("../src/pty/session")
  buildTerminalEnv = (await import("../src/pty/env")).buildTerminalEnv
  resolveTerminalStartCwd = (await import("../src/pty/cwd")).resolveTerminalStartCwd
})

after(() => {
  pty.__testResetPtySessions()
  fs.rmSync(tempHome, { recursive: true, force: true })
})

beforeEach(() => {
  lastPty = null
  pty.__testResetPtySessions()
  pty.__testSetPtyPlatform("darwin")
  pty.__testSetPtySpawn((_file, _args, _opts) => {
    lastPty = new MockPty()
    return lastPty
  })
  saveConfig({ embedded_terminal: { enabled: true } })
})

function services() {
  return {
    threadManager: new ThreadManager(),
    skillEngine: new SkillEngine(),
    historyStore: { record: () => 0 } as never,
  }
}

function panel(overrides: { confirm?: boolean; frames?: unknown[] } = {}) {
  const frames = overrides.frames ?? []
  return {
    originWs: { readyState: 1 },
    surface: "panel" as const,
    sendToExtension: (d: unknown) => {
      frames.push(d)
    },
    requestConfirmation: async () => ({
      approved: overrides.confirm !== false,
      confirmationId: "c1",
      reason: overrides.confirm === false ? ("denied" as const) : ("approved" as const),
    }),
  }
}

test("#432 validate: open requires id + user_gesture", () => {
  assert.equal(validateWsMessage({ type: "terminal.open" }).valid, false)
  assert.equal(validateWsMessage({ type: "terminal.open", id: "t1" }).valid, false)
  assert.equal(validateWsMessage({ type: "terminal.open", id: "t1", user_gesture: true }).valid, true)
  assert.equal(validateWsMessage({ type: "terminal.ack", id: "t1", seq: 1 }).valid, true)
})

test("#432 open: default-disabled / no gesture / summoner / tray", async () => {
  saveConfig({ embedded_terminal: { enabled: false } })
  const svc = services()
  const p = panel()
  const disabled = await handleMessage(
    { type: "terminal.open", id: "t1", user_gesture: true },
    svc,
    p as never,
  )
  assert.equal(disabled.error, "embedded_terminal_disabled")

  saveConfig({ embedded_terminal: { enabled: true } })
  const noG = await handleMessage({ type: "terminal.open", id: "t1" }, svc, p as never)
  assert.match(String(noG.error), /user_gesture/)

  const sum = await handleMessage(
    { type: "terminal.open", id: "t1", user_gesture: true },
    svc,
    { ...p, surface: "summoner" } as never,
  )
  assert.equal(sum.error_code, "SUMMONER_ACL")

  const tray = await handleMessage(
    { type: "terminal.open", id: "t1", user_gesture: true },
    svc,
    { ...p, surface: "tray" } as never,
  )
  assert.equal(tray.error_code, "TERMINAL_SURFACE")
})

test("#432 open: L2 denied does not spawn; approved opens", async () => {
  const svc = services()
  const denied = await handleMessage(
    { type: "terminal.open", id: "t1", user_gesture: true },
    svc,
    panel({ confirm: false }) as never,
  )
  assert.equal(denied.type, "terminal.closed")
  assert.equal(denied.code, "denied")
  assert.equal(lastPty, null)

  const ok = await handleMessage(
    { type: "terminal.open", id: "t1", user_gesture: true },
    svc,
    panel() as never,
  )
  assert.equal(ok.type, "terminal.opened")
  assert.equal(ok.platform, "darwin")
  assert.equal(ok.pid, 0)
  assert.ok(lastPty)
})

test("#432 open: plan_readonly bound thread denied; unbound ok", async () => {
  const svc = services()
  const thr = svc.threadManager.create("plan")
  svc.threadManager.update(thr.id, { execution_policy: "plan_readonly" })
  const denied = await handleMessage(
    { type: "terminal.open", id: "t1", user_gesture: true, thread_id: thr.id },
    svc,
    panel() as never,
  )
  assert.match(String(denied.error), /PLAN_READONLY/)
  assert.equal(lastPty, null)

  const ok = await handleMessage(
    { type: "terminal.open", id: "t2", user_gesture: true },
    svc,
    panel() as never,
  )
  assert.equal(ok.type, "terminal.opened")
})

test("#432 cwd: root and symlink escape denied", () => {
  const sandbox = path.join(tempHome, "CMspark-projects")
  fs.mkdirSync(sandbox, { recursive: true })
  const slash = resolveTerminalStartCwd({ requested: "/", workspaceRoot: sandbox })
  assert.equal(slash.ok, false)

  const outside = path.join(tempHome, "outside-secret")
  fs.mkdirSync(outside, { recursive: true })
  const link = path.join(sandbox, "escape")
  try {
    fs.symlinkSync(outside, link)
  } catch {
    return // platform may refuse symlinks
  }
  const esc = resolveTerminalStartCwd({ requested: link, workspaceRoot: sandbox })
  assert.equal(esc.ok, false)
})

test("#466 env: retain user Agent keys; strip internal pairing credentials, keep PATH", () => {
  process.env.CMSPARK_OUTBOUND_GRANT = "secret"
  process.env.DEEPSEEK_API_KEY = "sk-leak"
  process.env.ws_secret = "ws-leak"
  const env = buildTerminalEnv()
  assert.equal(env.CMSPARK_OUTBOUND_GRANT, undefined)
  assert.equal(env.DEEPSEEK_API_KEY, "sk-leak")
  assert.equal(env.ws_secret, undefined)
  assert.equal(env.TERM, "xterm-256color")
  assert.ok(env.PATH || env.Path)
  delete process.env.CMSPARK_OUTBOUND_GRANT
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.ws_secret
})

test("#432 ack watermark pauses PTY; close kills", async () => {
  const frames: unknown[] = []
  const svc = services()
  const sess = panel({ frames })
  await handleMessage({ type: "terminal.open", id: "t1", user_gesture: true }, svc, sess as never)
  assert.ok(lastPty)
  const chunk = "x".repeat(70 * 1024)
  lastPty.emit(chunk)
  assert.equal(pty.__testPtyPaused(), true)
  assert.ok(pty.__testPtyUnackedBytes() >= 64 * 1024)
  const dataFrames = frames.filter((f: any) => f.type === "terminal.data") as Array<{ seq: number }>
  assert.ok(dataFrames.length >= 1)
  await handleMessage({ type: "terminal.ack", id: "t1", seq: dataFrames[dataFrames.length - 1].seq }, svc, sess as never)
  assert.equal(pty.__testPtyPaused(), false)

  await handleMessage({ type: "terminal.close", id: "t1" }, svc, sess as never)
  assert.equal(lastPty.killed, true)
  assert.ok(frames.some((f: any) => f.type === "terminal.closed"))
})

test("#432 non-darwin honest unsupported (no spawn)", async () => {
  pty.__testSetPtyPlatform("linux")
  const svc = services()
  const r = await handleMessage(
    { type: "terminal.open", id: "t1", user_gesture: true },
    svc,
    panel() as never,
  )
  assert.equal(r.type, "terminal.closed")
  assert.equal(r.code, "unsupported")
  assert.match(String(r.error), /macOS/)
  assert.equal(lastPty, null)
})

test("#432 input writes decoded bytes; second open busy", async () => {
  const svc = services()
  const sess = panel()
  await handleMessage({ type: "terminal.open", id: "t1", user_gesture: true }, svc, sess as never)
  const payload = Buffer.from("ls\r").toString("base64")
  await handleMessage({ type: "terminal.input", id: "t1", b64: payload }, svc, sess as never)
  assert.deepEqual(lastPty?.writes, ["ls\r"])
  const busy = await handleMessage(
    { type: "terminal.open", id: "t2", user_gesture: true },
    svc,
    sess as never,
  )
  assert.equal(busy.error, "terminal_busy")
})

test("#466 terminal frames require the opening live peer and login shell args", async () => {
  const svc = services(), sess = panel()
  let args: string[] = []
  pty.__testSetPtySpawn((_file, argv) => { args = argv; lastPty = new MockPty(); return lastPty })
  await handleMessage({ type: "terminal.open", id: "owned", user_gesture: true }, svc, sess as never)
  assert.deepEqual(args, ["-l"])
  for (const type of ["terminal.input", "terminal.close", "terminal.ack", "terminal.resize", "terminal.ping"]) {
    const response = await handleMessage({ type, id: "owned", b64: "eA==", seq: 1 }, svc, panel() as never)
    assert.equal(response.error, "TERMINAL_SESSION_NOT_OWNED")
  }
  assert.deepEqual(lastPty?.writes, [])
  assert.equal(pty.getLivePtyId(), "owned")
})

test("#466 disconnected peer cannot finish a pending terminal open", async () => {
  const svc = services(), sess = panel()
  sess.requestConfirmation = async () => { sess.originWs.readyState = 3; return { approved: true, confirmationId: "c1", reason: "approved" } }
  const response = await handleMessage({ type: "terminal.open", id: "pending", user_gesture: true }, svc, sess as never)
  assert.equal(response.error, "TERMINAL_PEER_CLOSED")
  assert.equal(lastPty, null)
})

test("#466 closing a tab during confirmation cancels the pending open", async () => {
  const svc = services(), sess = panel()
  sess.requestConfirmation = async () => {
    const closed = await handleMessage({ type: "terminal.close", id: "pending-tab" }, svc, sess as never)
    assert.equal(closed.type, "terminal.ok")
    return { approved: true, confirmationId: "late", reason: "approved" }
  }
  const response = await handleMessage({ type: "terminal.open", id: "pending-tab", user_gesture: true }, svc, sess as never)
  assert.equal(response.error, "TERMINAL_OPEN_CANCELED")
  assert.equal(lastPty, null)
})

test("#466 ack cannot be bypassed by resume and hard output bound stops an unresponsive client", async () => {
  const svc = services(), frames: any[] = [], sess = panel({ frames })
  await handleMessage({ type: "terminal.open", id: "bounded", user_gesture: true }, svc, sess as never)
  lastPty!.emit("x".repeat(pty.TERMINAL_HIGH_WATER_UNACKED))
  assert.equal(pty.__testPtyPaused(), true)
  assert.equal(pty.resumePty("bounded").ok, false)
  lastPty!.emit("x".repeat(pty.TERMINAL_MAX_UNACKED))
  assert.equal(pty.getLivePtyId(), null)
  assert.ok(frames.some(frame => frame.type === "terminal.closed" && frame.code === "output_overflow"))
})

test("#466 in-workspace dot-prefixed directory is not an escape", () => {
  const child = path.join(tempHome, "CMspark-projects", "..cache")
  fs.mkdirSync(child, { recursive: true })
  assert.equal(resolveTerminalStartCwd({ requested: child, workspaceRoot: path.dirname(child) }).ok, true)
})

test("#466 long CJK output preserves characters across frame boundaries; malformed input rejected", async () => {
  const svc = services(), frames: any[] = [], sess = panel({ frames })
  await handleMessage({ type: "terminal.open", id: "utf8", user_gesture: true }, svc, sess as never)
  const text = "中😀文".repeat(4000)
  lastPty!.emit(text)
  const chunks = frames.filter(frame => frame.type === "terminal.data").map(frame => Buffer.from(frame.b64, "base64"))
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(chunk => chunk.length <= 16384))
  assert.equal(chunks.map(chunk => chunk.toString("utf8")).join(""), text)
  for (const b64 of ["!!!", "Zg", "Zh==", "", "A".repeat(1024 * 1024 + 4)]) {
    const response = await handleMessage({ type: "terminal.input", id: "utf8", b64 }, svc, sess as never)
    assert.equal(response.error, "invalid_b64")
  }
  assert.deepEqual(lastPty!.writes, [])
})

function reviewForThread(threadId: string) {
  const service = new CodeReviewService(process.env.CMSPARK_DATA_DIR!, { kind: "chat", threadId })
  const view = service.create({ request_id: "review", repository: "https://code.example.test/team/repo", base: "a".repeat(40), head: "b".repeat(40) })
  const report = { review_id: view.review_id, repository: view.repository, base: view.base, head: view.head, diff_hash: view.diff_hash,
    status: "partial", summary: "Agent-only result; source not independently verified", reviewed_files: [], findings: [], mappings: [] }
  return { service, view, report }
}

test("#466 changed review while open confirmation is pending must be reconfirmed", async () => {
  const svc = services(), thread = svc.threadManager.create("review changed"), sess = panel()
  const { service, view, report } = reviewForThread(thread.id)
  sess.requestConfirmation = async () => { service.assess(report); return { approved: true, confirmationId: "old", reason: "approved" } }
  const response = await handleMessage({ type: "terminal.open", id: "changed", thread_id: thread.id, review_id: view.review_id, user_gesture: true }, svc, sess as never)
  assert.equal(response.error, "CODE_REVIEW_CONTEXT_CHANGED")
  assert.equal(lastPty, null)
})

test("#466 confirmed report returns to original task, persists and retries without duplicate history", async () => {
  const svc = services(), thread = svc.threadManager.create("code review"), sess = panel()
  const { service, view, report } = reviewForThread(thread.id)
  const opened = await handleMessage({ type: "terminal.open", id: "review-terminal", thread_id: thread.id, review_id: view.review_id, user_gesture: true }, svc, sess as never)
  assert.equal(opened.type, "terminal.opened")
  assert.match(String(opened.review_prompt), /不可信数据/)
  const submit = { type: "terminal.review.submit", id: "review-terminal", user_gesture: true, report }
  sess.sendToExtension = () => { throw new Error("socket closed after persistence") }
  const first = await handleMessage(submit, svc, sess as never)
  assert.equal(first.type, "terminal.review.received")
  assert.deepEqual(await handleMessage(submit, svc, sess as never), first)
  assert.equal(svc.threadManager.getMessages(thread.id).length, 1)
  const stored = service.read({ review_id: view.review_id })
  assert.equal(stored.receipt?.id, first.receipt_id)
  assert.equal(stored.receipt?.origin, "user_confirmed_external_assessment")
  assert.equal(stored.review_ready, false)
  const conflict = await handleMessage({ ...submit, report: { ...report, summary: "different" } }, svc, sess as never)
  assert.equal(conflict.error, "CODE_REPORT_ALREADY_RECEIVED")
})

test("#466 wrong identity, denied and closed-during-confirmation reports never persist", async () => {
  const svc = services(), thread = svc.threadManager.create("denials"), sess = panel()
  const { service, view, report } = reviewForThread(thread.id)
  await handleMessage({ type: "terminal.open", id: "denials", thread_id: thread.id, review_id: view.review_id, user_gesture: true }, svc, sess as never)
  const submit = { type: "terminal.review.submit", id: "denials", user_gesture: true, report }
  const wrong = await handleMessage({ ...submit, report: { ...report, head: "c".repeat(40) } }, svc, sess as never)
  assert.equal(wrong.error, "CODE_REPORT_IDENTITY_MISMATCH")
  sess.requestConfirmation = async () => ({ approved: false, confirmationId: "no", reason: "denied" })
  assert.equal((await handleMessage(submit, svc, sess as never)).error, "CODE_REPORT_DENIED")
  sess.requestConfirmation = async () => { pty.closePty("denials"); return { approved: true, confirmationId: "yes", reason: "approved" } }
  assert.equal((await handleMessage(submit, svc, sess as never)).error, "CODE_REPORT_CONTEXT_CHANGED")
  assert.equal(service.read({ review_id: view.review_id }).receipt, null)
  assert.equal(svc.threadManager.getMessages(thread.id).length, 0)
})

test("#432 load-native source uses createRequire(execPath)", () => {
  const root = path.resolve(__dirname, "..", "..")
  const src = fs.readFileSync(path.join(root, "src", "pty", "load-native.ts"), "utf8")
  assert.ok(src.includes("createRequire(process.execPath)"))
  const args = fs.readFileSync(path.join(root, "scripts", "esbuild-bundle-args.json"), "utf8")
  assert.ok(args.includes("@lydell/node-pty"))
})

test("#432 ping resets heartbeat; unknown id is ignored", async () => {
  assert.equal(validateWsMessage({ type: "terminal.ping" }).valid, false)
  assert.equal(validateWsMessage({ type: "terminal.ping", id: "t1" }).valid, true)

  const svc = services()
  const sess = panel()
  await handleMessage({ type: "terminal.open", id: "t1", user_gesture: true }, svc, sess as never)
  const before = pty.__testPtyLastClientAt()
  pty.__testAgePtyClient(40_000)
  assert.ok(pty.__testPtyLastClientAt() < before)

  const ping = await handleMessage({ type: "terminal.ping", id: "t1" }, svc, sess as never)
  assert.equal(ping.type, "terminal.ok")
  assert.ok(pty.__testPtyLastClientAt() >= before)

  const unknown = await handleMessage({ type: "terminal.ping", id: "no-such" }, svc, sess as never)
  assert.equal(unknown.type, "terminal.error")
  assert.equal(pty.getLivePtyId(), "t1")
})

test("#432 WS-close kills only that peer's PTY", async () => {
  const svc = services()
  const peerA = { tag: "a", readyState: 1 }
  const peerB = { tag: "b", readyState: 1 }
  const sess = { ...panel(), originWs: peerA }
  await handleMessage({ type: "terminal.open", id: "t1", user_gesture: true }, svc, sess as never)
  assert.ok(lastPty)
  assert.equal(pty.killPtyByPeer(peerB), false)
  assert.equal(lastPty.killed, false)
  assert.equal(pty.getLivePtyId(), "t1")
  assert.equal(pty.killPtyByPeer(peerA), true)
  assert.equal(lastPty.killed, true)
  assert.equal(pty.getLivePtyId(), null)
})

test("#432 spawn throw → terminal.closed spawn_failed", async () => {
  pty.__testSetPtySpawn(() => {
    throw new Error("chdir failed")
  })
  const svc = services()
  const r = await handleMessage(
    { type: "terminal.open", id: "t1", user_gesture: true },
    svc,
    panel() as never,
  )
  assert.equal(r.type, "terminal.closed")
  assert.equal(r.code, "spawn_failed")
  assert.match(String(r.error), /chdir failed/)
  assert.equal(pty.getLivePtyId(), null)
})

test("#432 cwd: broken symlink refused (no lexical fallback)", () => {
  const sandbox = path.join(tempHome, "CMspark-projects")
  fs.mkdirSync(sandbox, { recursive: true })
  const dangling = path.join(sandbox, "dangling-link")
  try {
    fs.symlinkSync(path.join(sandbox, "does-not-exist"), dangling)
  } catch {
    return
  }
  const denied = resolveTerminalStartCwd({ requested: dangling, workspaceRoot: sandbox })
  assert.equal(denied.ok, false)
  assert.match(String((denied as { error: string }).error), /unreadable|broken symlink/)
})
