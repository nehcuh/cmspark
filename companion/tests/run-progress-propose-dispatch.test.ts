/**
 * #265 Task 3: run_progress_propose dispatch + handshake ACL.
 * Overlay ACL is handshakeSurface from WS auth, NEVER params.surface.
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-rp-propose-dispatch-"))
process.env.HOME = tmp
process.env.CMSPARK_DATA_DIR = tmp

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let bindCompanionDispatchRuntime: typeof import("../src/tool/companion-dispatch").bindCompanionDispatchRuntime
let executeCompanionTool: typeof import("../src/tool/companion-dispatch").executeCompanionTool

const ITEMS = [
  { text: "打开列表", tool: "navigate" },
  { text: "点第一封", tool: "click" },
]

before(async () => {
  const config = await import("../src/config")
  await config.initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  const dispatch = await import("../src/tool/companion-dispatch")
  bindCompanionDispatchRuntime = dispatch.bindCompanionDispatchRuntime
  executeCompanionTool = dispatch.executeCompanionTool
})

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function bindTm(tm: InstanceType<typeof ThreadManager>) {
  bindCompanionDispatchRuntime({
    getThreadManager: () => tm,
    getSkillEngine: () => null as any,
    getCachedTabUrl: () => undefined,
    getTabUrlCache: () => new Map(),
    computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any,
    getComputerRateLimiterSingleton: () => null,
    securityConfirmations: {
      request: async () => ({ confirmationId: "", approved: false, reason: "disconnect" as const }),
    } as any,
    getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0,
    hasPendingForTab: () => false,
    rejectPendingForTab: () => 0,
  })
}

function readSrc(...parts: string[]): string {
  const candidates = [
    path.join(__dirname, "..", "src", ...parts),
    path.join(__dirname, "../src", ...parts),
    path.join(process.cwd(), "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8")
  }
  throw new Error("src not found: " + parts.join("/"))
}

test("handshakeSurface summoner + params.surface tray → SUMMONER_ACL no write", async () => {
  const tm = new ThreadManager()
  const th = tm.create("rp-spoof-tray")
  bindTm(tm)
  const broadcasts: unknown[] = []

  const r = await executeCompanionTool(
    "run_progress_propose",
    { __thread_id: th.id, items: ITEMS, surface: "tray" },
    "tc-spoof",
    { handshakeSurface: "summoner", broadcast: (d) => broadcasts.push(d) },
  )

  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, "SUMMONER_ACL")
  assert.match(String(r.error || ""), /SUMMONER_ACL/)
  assert.equal(tm.get(th.id)?.run_progress, undefined)
  assert.equal(broadcasts.length, 0)
})

test("handshakeSurface undefined → SUMMONER_ACL no write", async () => {
  const tm = new ThreadManager()
  const th = tm.create("rp-no-handshake")
  bindTm(tm)
  const broadcasts: unknown[] = []

  const r = await executeCompanionTool(
    "run_progress_propose",
    { __thread_id: th.id, items: ITEMS, surface: "tray" },
    "tc-undef",
    { broadcast: (d) => broadcasts.push(d) },
  )

  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, "SUMMONER_ACL")
  assert.match(String(r.error || ""), /SUMMONER_ACL/)
  assert.equal(tm.get(th.id)?.run_progress, undefined)
  assert.equal(broadcasts.length, 0)
})

test("handshakeSurface tray writes seed items and broadcasts thread.updated once", async () => {
  const tm = new ThreadManager()
  const th = tm.create("rp-tray-write")
  bindTm(tm)
  const broadcasts: any[] = []

  const r = await executeCompanionTool(
    "run_progress_propose",
    { __thread_id: th.id, items: ITEMS, surface: "summoner" },
    "tc-tray",
    { handshakeSurface: "tray", broadcast: (d) => broadcasts.push(d) },
  )

  assert.equal(r.success, true, r.error || "propose ok")
  assert.equal(r.data?.written, 2)
  const got = tm.get(th.id)
  assert.equal(got?.run_progress?.items.length, 2)
  assert.equal(got?.run_progress?.items[0]!.id, "live:0")
  assert.equal(got?.run_progress?.items[0]!.source, "seed")
  assert.equal(got?.run_progress?.items[0]!.done, false)
  assert.equal(got?.run_progress?.items[0]!.tool, "navigate")
  assert.equal(got?.run_progress?.items[1]!.id, "live:1")
  assert.equal(broadcasts.length, 1)
  assert.equal(broadcasts[0].type, "thread.updated")
  assert.equal(broadcasts[0].thread.id, th.id)
  assert.equal(broadcasts[0].thread.run_progress.items.length, 2)
})

test("worker thread → WORKER_DENIED no write", async () => {
  const tm = new ThreadManager()
  const th = tm.create("rp-worker")
  tm.update(th.id, { agent_role: "worker" })
  bindTm(tm)
  const broadcasts: unknown[] = []

  const r = await executeCompanionTool(
    "run_progress_propose",
    { __thread_id: th.id, items: ITEMS },
    "tc-worker",
    { handshakeSurface: "tray", broadcast: (d) => broadcasts.push(d) },
  )

  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, "WORKER_DENIED")
  assert.match(String(r.error || ""), /workers cannot propose/)
  assert.equal(tm.get(th.id)?.run_progress, undefined)
  assert.equal(broadcasts.length, 0)
})

test("missing __thread_id → THREAD_REQUIRED", async () => {
  const tm = new ThreadManager()
  const th = tm.create("rp-no-tid")
  bindTm(tm)
  const broadcasts: unknown[] = []

  const r = await executeCompanionTool(
    "run_progress_propose",
    { items: ITEMS },
    "tc-no-tid",
    { handshakeSurface: "tray", broadcast: (d) => broadcasts.push(d) },
  )

  assert.equal(r.success, false)
  assert.equal(r.data?.error_code, "THREAD_REQUIRED")
  assert.match(String(r.error || ""), /thread required/)
  assert.equal(tm.get(th.id)?.run_progress, undefined)
  assert.equal(broadcasts.length, 0)
})

test("source: dispatch ACL uses handshakeSurface not params.surface", () => {
  const dispatch = readSrc("tool", "companion-dispatch.ts")
  assert.match(dispatch, /case ["']run_progress_propose["']/)
  assert.match(dispatch, /handshakeSurface === ["']summoner["']/)
  assert.match(dispatch, /handshakeSurface == null/)
  assert.doesNotMatch(dispatch, /params\.surface/)
  assert.match(dispatch, /error_code:\s*["']SUMMONER_ACL["']/)
  assert.match(dispatch, /error_code:\s*["']WORKER_DENIED["']/)
  assert.match(dispatch, /error_code:\s*["']THREAD_REQUIRED["']/)
})

test("source: server passes handshakeSurface from getWsAuthState and strips params.surface", () => {
  const server = readSrc("server.ts")
  assert.match(server, /handshakeSurface:\s*\(\(\)\s*=>/)
  assert.match(
    server,
    /st\.surface === ["']summoner["']\s*\?\s*["']summoner["']\s*:\s*["']tray["']/,
  )
  const companionBlock = server.slice(server.indexOf("if (isCompanionTool(toolName))"))
  assert.match(companionBlock, /toolName === ["']run_progress_propose["']/)
  assert.match(companionBlock, /delete [\s\S]{0,80}surface/)
  assert.match(companionBlock, /getWsAuthState\(ws\)/)
})
