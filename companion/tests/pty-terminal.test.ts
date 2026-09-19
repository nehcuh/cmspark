/**
 * #432 P0 companion: terminal.* wire, L2, plan_readonly, cwd, ack watermark, kill.
 *
 * Spawn is ALWAYS injected through `__testSetPtySpawn`: no test in this file may reach the real
 * `loadNodePty()` path or start a real OS process (`$SHELL -l` included). A "production path armed"
 * test arms that hook with a throwing function instead of removing it — see the `#502 C` free-shell
 * pin below.
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

// --- #502 C: explicit executable + argv for agent embeds (PTY only; no Terminal.app path) ---

const TERMINAL_OPTS = { cols: 80, rows: 24, cwd: tempHome, send: () => {} }

/** Fresh darwin spawn recorder; resets any live session from a previous spawn. */
function freshSpawn(): Array<{ file: string; args: string[] }> {
  pty.__testResetPtySessions()
  pty.__testSetPtyPlatform("darwin")
  const calls: Array<{ file: string; args: string[] }> = []
  pty.__testSetPtySpawn((file, args) => {
    calls.push({ file, args })
    lastPty = new MockPty()
    return lastPty
  })
  return calls
}

/** node:assert.equal does not narrow the result union. */
function refusal(result: ReturnType<typeof pty.spawnPtySession>): { ok: false; error: string; code?: string } {
  assert.equal(result.ok, false)
  // Assert the message shape here so a refusal that omits `error` fails as a readable assertion
  // rather than `TypeError: match(undefined)` inside a case.
  const widened = result as { ok: false; error?: unknown; code?: unknown }
  assert.equal(typeof widened.error, "string", "refusal must carry a string error")
  assert.equal(typeof widened.code, "string", "refusal must carry a string code")
  return widened as { ok: false; error: string; code?: string }
}

/**
 * #502 C refusals are a single table: every malformed-`file`/`args` shape must be refused with a
 * `invalid_pty_opts` code, a matching message, no spawnFn call and no live session.
 * `opts` is deliberately untyped: these are shapes a non-conforming caller can really produce
 * (BigInt/circular/`toJSON`-throwing `file`, non-array `args`), so the cast is the test's subject.
 */
type RefusalCase = { name: string; opts: Record<string, unknown>; code: string; match: RegExp }

const circularFile: Record<string, unknown> = {}
circularFile.self = circularFile

const FILE_REFUSAL = /absolute path/i
const REFUSAL_CASES: RefusalCase[] = [
  // --- no explicit file: caller-supplied argv would turn `$SHELL` into a free shell ---
  { name: "args without file", opts: { args: ["-c", "echo pwned"] }, code: "invalid_pty_opts", match: /explicit absolute file/ },
  { name: "empty args without file", opts: { args: [] }, code: "invalid_pty_opts", match: /explicit absolute file/ },
  // A builder spreading an undefined key means "no file", not "omitted": still refused.
  { name: "file undefined plus args", opts: { file: undefined, args: ["-l"] }, code: "invalid_pty_opts", match: /explicit absolute file/ },

  // --- file is a string but not a usable path (never defaulted, never trimmed/repaired) ---
  { name: "file empty string", opts: { file: "" }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file whitespace only", opts: { file: "   " }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file leading space", opts: { file: " /bin/zsh" }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file leading tab", opts: { file: "\t/bin/zsh" }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file relative name", opts: { file: "claude" }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file relative dot path", opts: { file: "./bin/claude" }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file relative bare path", opts: { file: "bin/claude" }, code: "invalid_pty_opts", match: FILE_REFUSAL },

  // --- file is not a string at all: the refusal branch must never throw (F1) ---
  { name: "file null", opts: { file: null }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file number", opts: { file: 42 }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file boolean", opts: { file: true }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file object", opts: { file: {} }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file array", opts: { file: [] }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file function", opts: { file: () => {} }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  // JSON.stringify throws on these three: `Do not know how to serialize a BigInt`,
  // `Converting circular structure to JSON`, and caller `toJSON`. Rendering must be total.
  { name: "file bigint (JSON.stringify throws)", opts: { file: BigInt(42) }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  { name: "file circular (JSON.stringify throws)", opts: { file: circularFile }, code: "invalid_pty_opts", match: FILE_REFUSAL },
  {
    name: "file with throwing toJSON",
    opts: { file: { toJSON() { throw new Error("boom-toJSON") } } },
    code: "invalid_pty_opts",
    match: FILE_REFUSAL,
  },
  // Symbol used to render as the misleading `(got undefined)`.
  { name: "file symbol", opts: { file: Symbol("s") }, code: "invalid_pty_opts", match: FILE_REFUSAL },

  // --- args is not an array (bug in the agent-spec builder, never a `-l` fallback) ---
  { name: "args string", opts: { file: "/bin/echo", args: "oops" }, code: "invalid_pty_opts", match: /string\[\]/ },
  { name: "args number", opts: { file: "/bin/echo", args: 7 }, code: "invalid_pty_opts", match: /string\[\]/ },
  { name: "args boolean", opts: { file: "/bin/echo", args: true }, code: "invalid_pty_opts", match: /string\[\]/ },
  { name: "args object", opts: { file: "/bin/echo", args: { a: 1 } }, code: "invalid_pty_opts", match: /string\[\]/ },
  { name: "args null", opts: { file: "/bin/echo", args: null }, code: "invalid_pty_opts", match: /string\[\]/ },

  // --- args is a real array but an entry is empty / the payload is over ARG_MAX ---
  { name: "args with empty entry", opts: { file: "/bin/echo", args: [""] }, code: "invalid_pty_opts", match: /empty entry/ },
  { name: "args mixing a valid entry with an empty one", opts: { file: "/bin/echo", args: ["-p", ""] }, code: "invalid_pty_opts", match: /empty entry/ },
  {
    name: "args over the argv byte cap",
    opts: { file: "/bin/echo", args: ["x".repeat(128 * 1024 + 1)] },
    code: "invalid_pty_opts",
    match: /exceed/i,
  },
  {
    name: "args summing just over the argv byte cap",
    opts: { file: "/bin/echo", args: ["y".repeat(128 * 1024), "z"] },
    code: "invalid_pty_opts",
    match: /exceed/i,
  },

  // Guard order: the file refusal precedes the args refusal.
  { name: "invalid file and invalid args", opts: { file: 42, args: "oops" }, code: "invalid_pty_opts", match: FILE_REFUSAL },
]

/** The refusal path must return, not throw — resolve the result and fail loudly if it did not. */
function spawnRefused(c: RefusalCase): { ok: false; error: string; code?: string } {
  const opts = { ...TERMINAL_OPTS, id: `refuse-${c.name}`, ...c.opts } as Parameters<typeof pty.spawnPtySession>[0]
  try {
    return refusal(pty.spawnPtySession(opts))
  } catch (e: any) {
    assert.fail(`${c.name}: spawnPtySession must return {ok:false}, got throw: ${e?.message || String(e)}`)
  }
}

test("#502 pty spawn: every malformed file/args shape is refused before any spawn", () => {
  const previousShell = process.env.SHELL
  try {
    // `$SHELL` is valid here, so only the caller's malformed opts can explain a refusal.
    process.env.SHELL = "/bin/bash"
    for (const c of REFUSAL_CASES) {
      const calls = freshSpawn()
      const refused = spawnRefused(c)
      assert.equal(refused.code, c.code, `${c.name}: refusal code`)
      assert.match(refused.error, c.match, `${c.name}: refusal message`)
      assert.deepEqual(calls, [], `${c.name}: spawnFn must not be called`)
      assert.equal(pty.getLivePtyId(), null, `${c.name}: no live session`)
    }
  } finally {
    if (previousShell === undefined) delete process.env.SHELL
    else process.env.SHELL = previousShell
  }
})

/**
 * #502 C free-shell pin, with the spawn hook ARMED. Every other refusal test arms a *passive
 * recorder*, which absorbs the call and leaves `ok === false` satisfiable by a spawn that merely
 * failed — i.e. it cannot tell "refused before spawn" from "spawned and died". These cases arm the
 * hook with a throw instead, so a regression (guard removed / moved after `spawnFn`) can only end in
 * a `spawn_failed` carrying `SPAWN_MUST_NOT_BE_REACHED`, which the assertions below reject by name.
 * The hook is still injected (never `loadNodePty()`), so no real process — `$SHELL` included — can
 * be launched even if the guard regresses.
 */
const SPAWN_TRAP = "SPAWN_MUST_NOT_BE_REACHED"

/** Arm the injected spawn hook with a throw, so "reached spawn" is impossible to confuse with
 *  "spawn failed for a boring reason" (ENOENT, chdir, permissions are all replaced by the trap). */
function armSpawnTrap(): void {
  pty.__testResetPtySessions()
  pty.__testSetPtyPlatform("darwin")
  pty.__testSetPtySpawn(() => {
    throw new Error(SPAWN_TRAP)
  })
}

/**
 * The refusal must be the guard's own refusal, produced WITHOUT the trap firing. A real spawn
 * failure can never satisfy this: the only spawn that can run here throws `SPAWN_TRAP`, and the
 * guard's message is matched exactly while `spawn_failed` is a different code entirely.
 */
function assertRefusedBeforeArmedSpawn(label: string, opts: Record<string, unknown>, match: RegExp): void {
  armSpawnTrap()
  let result: ReturnType<typeof pty.spawnPtySession>
  try {
    result = pty.spawnPtySession({
      ...TERMINAL_OPTS,
      id: `armed-${label}`,
      ...opts,
    } as Parameters<typeof pty.spawnPtySession>[0])
  } catch (e: any) {
    // The trap escaping the function means the guard never ran at all: report it by name.
    assert.fail(`${label}: guard did not run; the armed spawn trap surfaced: ${e?.message || String(e)}`)
  }
  const refused = refusal(result)
  // Checked first so the mutation proof names the trap rather than only a code mismatch.
  assert.ok(
    !refused.error.includes(SPAWN_TRAP),
    `${label}: the armed spawn trap surfaced — the guard ran too late (code=${refused.code}, error=${refused.error})`,
  )
  assert.equal(refused.code, pty.INVALID_PTY_OPTS, `${label}: the guard's own code, never spawn_failed`)
  assert.match(refused.error, match, `${label}: the guard's own message`)
  assert.equal(pty.getLivePtyId(), null, `${label}: no live session`)
}

test("#502 pty spawn: free-shell refusal holds with the production spawn path armed", () => {
  const previousShell = process.env.SHELL
  try {
    // `$SHELL` is a real absolute path, so a regression would spawn it with the caller's argv
    // (the free-shell hole) rather than fail for an unrelated ENOENT.
    process.env.SHELL = "/bin/bash"
    // The reviewer's case: argv with no `file` used to turn `$SHELL` into a general injector.
    assertRefusedBeforeArmedSpawn("args-without-file", { args: ["-c", "echo pwned"] }, /explicit absolute file/)
    // Malformed `file` (relative): also must be refused with the guard's message, not a spawn try.
    assertRefusedBeforeArmedSpawn("malformed-file", { file: "claude" }, FILE_REFUSAL)
  } finally {
    if (previousShell === undefined) delete process.env.SHELL
    else process.env.SHELL = previousShell
  }
})

test("#502 pty spawn: refusal code and argv byte cap are pinned for the handler mapping", () => {
  // The WS handler maps these codes; the next task keys off the exported names, not prose.
  assert.equal(pty.INVALID_PTY_OPTS, "invalid_pty_opts")
  assert.equal(pty.MAX_PTY_ARGV_BYTES, 128 * 1024)
})

test("#502 pty spawn: omitted file/args keep $SHELL and login argv", () => {
  const previousShell = process.env.SHELL
  try {
    process.env.SHELL = "/bin/bash"
    const explicit = freshSpawn()
    assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "default" }).ok, true)
    assert.deepEqual(explicit, [{ file: "/bin/bash", args: ["-l"] }])

    // file omitted (undefined) + blank $SHELL → /bin/zsh. A *supplied* blank file is refused instead.
    for (const blank of ["", "   "]) {
      process.env.SHELL = blank
      const blanked = freshSpawn()
      assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "blank-shell" }).ok, true)
      assert.deepEqual(blanked, [{ file: "/bin/zsh", args: ["-l"] }])
    }

    delete process.env.SHELL
    const unset = freshSpawn()
    assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "unset-shell" }).ok, true)
    assert.deepEqual(unset, [{ file: "/bin/zsh", args: ["-l"] }])
  } finally {
    if (previousShell === undefined) delete process.env.SHELL
    else process.env.SHELL = previousShell
  }
})

test("#502 pty spawn: supplied file is used as given — never trimmed or repaired", () => {
  // A blank/leading-whitespace supplied file is refused by the refusal table above; an absolute
  // value is passed to spawnFn verbatim — trailing whitespace is NOT normalized away
  // (an absolute-but-nonexistent path falls through to the native errno, which is unchanged).
  const calls = freshSpawn()
  assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "verbatim-file", file: "/bin/zsh " }).ok, true)
  assert.deepEqual(calls, [{ file: "/bin/zsh ", args: [] }])
})

test("#502 pty spawn: padded $SHELL is trimmed before spawn, never a nonexistent path", () => {
  const previousShell = process.env.SHELL
  try {
    // `SHELL=" /bin/bash "` cannot exist as a path: the emptiness check trims, so the spawn value
    // must be the trimmed one too (a half-trimmed `$SHELL` is a guaranteed ENOENT).
    for (const padded of [" /bin/bash ", "\t/bin/bash"]) {
      process.env.SHELL = padded
      const calls = freshSpawn()
      assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "padded-shell" }).ok, true)
      assert.deepEqual(calls, [{ file: "/bin/bash", args: ["-l"] }])
    }
  } finally {
    if (previousShell === undefined) delete process.env.SHELL
    else process.env.SHELL = previousShell
  }
})

test("#502 pty spawn: explicit file with omitted args gets [], never the -l login flag", () => {
  // `-l` is a login-shell flag; handing it to an agent binary is meaningless. So the `-l` default
  // and a caller-supplied executable can never mix.
  const calls = freshSpawn()
  assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "file-no-args", file: "/bin/echo" }).ok, true)
  assert.deepEqual(calls, [{ file: "/bin/echo", args: [] }])
})

test("#502 pty spawn: explicit absolute file and argv reach spawnFn unchanged", () => {
  const calls = freshSpawn()
  const opened = pty.spawnPtySession({
    ...TERMINAL_OPTS,
    id: "agent",
    file: "/opt/homebrew/bin/claude",
    args: ["-p", "task file.md"],
  })
  assert.equal(opened.ok, true)
  assert.deepEqual(calls, [{ file: "/opt/homebrew/bin/claude", args: ["-p", "task file.md"] }])
})

test("#502 pty spawn: empty argv stays empty, never -l", () => {
  const calls = freshSpawn()
  assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "no-argv", file: "/bin/cat", args: [] }).ok, true)
  assert.deepEqual(calls, [{ file: "/bin/cat", args: [] }])
})

test("#502 pty spawn: junk entries inside a real argv array are dropped", () => {
  const calls = freshSpawn()
  const junk = [1, "ok", null, undefined, { a: 1 }] as unknown as string[]
  assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "junk-argv", file: "/bin/echo", args: junk }).ok, true)
  assert.deepEqual(calls, [{ file: "/bin/echo", args: ["ok"] }])
})

test("#502 pty spawn: all-junk argv collapses to an empty argv, never -l", () => {
  // Every entry is dropped, so the surviving argv is `[]` — the `-l` login flag belongs to the
  // `$SHELL` default and must not reappear here.
  const calls = freshSpawn()
  const junk = [1, null, undefined] as unknown as string[]
  assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "all-junk-argv", file: "/bin/echo", args: junk }).ok, true)
  assert.deepEqual(calls, [{ file: "/bin/echo", args: [] }])
})

test("#506 pty spawn: onPtyAgentSpawned fires for an explicit executable, never for $SHELL", () => {
  const previousShell = process.env.SHELL
  const seen: Array<{ id: string; threadId?: string; file: string }> = []
  const off = pty.onPtyAgentSpawned((info) => seen.push(info))
  try {
    process.env.SHELL = "/bin/bash"
    // The embed/agent shape: explicit absolute file → the event carries id + threadId + file.
    freshSpawn()
    assert.equal(
      pty.spawnPtySession({ ...TERMINAL_OPTS, id: "agent-ev", file: "/bin/echo", args: ["T"], threadId: "th-1" }).ok,
      true,
    )
    assert.deepEqual(seen, [{ id: "agent-ev", threadId: "th-1", file: "/bin/echo" }])

    // The login-shell default must NOT fire it — a subscriber (AcpManager) would otherwise move an
    // `embed_intent` session to "running" for a plain shell.
    freshSpawn()
    assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "shell-ev", threadId: "th-1" }).ok, true)
    assert.equal(seen.length, 1, "$SHELL -l never announces an agent spawn")

    // A refused spawn (busy slot) fires nothing.
    pty.__testSetPtyPlatform("darwin")
    assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "busy-ev", file: "/bin/echo" }).ok, false)
    assert.equal(seen.length, 1, "a spawn that never started fires no event")

    // Unsubscribe works; a throwing listener cannot fail a live spawn.
    off()
    const offThrowing = pty.onPtyAgentSpawned(() => {
      throw new Error("listener bug")
    })
    freshSpawn()
    assert.equal(pty.spawnPtySession({ ...TERMINAL_OPTS, id: "throw-ev", file: "/bin/echo" }).ok, true)
    assert.equal(seen.length, 1, "unsubscribed listeners are gone")
    offThrowing()
  } finally {
    off()
    if (previousShell === undefined) delete process.env.SHELL
    else process.env.SHELL = previousShell
  }
})
