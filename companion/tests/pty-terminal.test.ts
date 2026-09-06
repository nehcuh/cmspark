/**
 * #432 P0 companion: terminal.* wire, L2, plan_readonly, cwd, ack watermark, kill.
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

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
  pid = 4242
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
  assert.equal(ok.pid, 4242)
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

test("#432 env: strip CMSPARK_* and api keys, keep PATH", () => {
  process.env.CMSPARK_OUTBOUND_GRANT = "secret"
  process.env.DEEPSEEK_API_KEY = "sk-leak"
  process.env.ws_secret = "ws-leak"
  const env = buildTerminalEnv()
  assert.equal(env.CMSPARK_OUTBOUND_GRANT, undefined)
  assert.equal(env.DEEPSEEK_API_KEY, undefined)
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

test("#432 load-native source uses createRequire(execPath)", () => {
  const root = path.resolve(__dirname, "..", "..")
  const src = fs.readFileSync(path.join(root, "src", "pty", "load-native.ts"), "utf8")
  assert.ok(src.includes("createRequire(process.execPath)"))
  const args = fs.readFileSync(path.join(root, "scripts", "esbuild-bundle-args.json"), "utf8")
  assert.ok(args.includes("@lydell/node-pty"))
})
