// Integration test: R1 (plan §E.6.2) — global single-task mutex for
// coordinate computer tasks (WP2 review MUST-FIX).
//
// The invariant: at most ONE host_computer task executes process-wide,
// across threadIds. Two enforcement points, both verified here through the
// REAL createToolExecutor + WS harness (mirrors app-launch-gate.test.ts):
//   ① pre-dialog gate: a second task is refused BEFORE the L2 dialog while
//     one is executing (no queue, no wait) — [COMPUTER_TASK_BUSY];
//   ② handler check-and-set (authoritative): closes the race where BOTH
//     tasks passed the gate inside their own L2 dialogs — the loser is
//     refused with data.error_code COMPUTER_TASK_BUSY AFTER approval,
//     BEFORE the estop preflight (so it can never clearEstopFlag from
//     under the running task).
// Plus the release property: abnormal exit (estop preflight refusal) frees
// the slot via the handler's finally, and the next task is admitted.
//
// The estop preflight is substituted via setComputerEstopEnsureForTests so
// no real ps helper is spawned and no injection ever happens. All tests are
// win32-only (the gate skips host_computer elsewhere).

import "./_security-gates-setup.js"
import test, { before, after, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"
import { WebSocketServer, WebSocket } from "ws"

import {
  createToolExecutor,
  handleToolResult,
  applyConnectionCloseGracePeriod,
  pendingToolCalls,
  securityConfirmations,
  getComputerTaskRegistryForTests,
  setComputerEstopEnsureForTests,
} from "../../src/server.js"
import { saveConfig, getConfig, replaceAppsEntries } from "../../src/config.js"
import type { AppEntry } from "../../src/apps/types.js"

const WIN = process.platform === "win32"
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mutex-"))

let wss: WebSocketServer
let serverSideWs: WebSocket
let clientSideWs: WebSocket
let serverPort: number

const COMPUTER_PARAMS = {
  task: "click the button",
  app: "win.app.mutex",
  actions: [{ action: "click", x: 100, y: 100 }],
}

function computerEntry(): AppEntry {
  return {
    token: "win.app.mutex",
    kind: "gui",
    display_name: "Mutex Test",
    source: "user",
    policy: "manual",
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    exe: { path: "C:\\Program Files\\MutexTest\\app.exe", signer: "CN=Mutex", user_writable_dir: false },
    coordinateAllowed: true,
  } as AppEntry
}

before(() => {
  process.env.HOME = tempDir
  delete process.env.CMSPARK_DATA_DIR
})

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(async () => {
  for (const id of Array.from(pendingToolCalls.keys())) {
    const pending = pendingToolCalls.get(id)!
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
  }
  securityConfirmations.rejectAll("disconnect")
  getComputerTaskRegistryForTests().clear()
  setComputerEstopEnsureForTests(null)
  replaceAppsEntries({ "win.app.mutex": computerEntry() })
  saveConfig({
    trusted_domains: [],
    auto_approved_domains: [],
    security: { ...getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false },
    computer: { coordinateEnabled: true },
  } as any)

  await new Promise<void>((resolve) => {
    wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => resolve())
  })
  serverPort = (wss.address() as { port: number }).port

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("client connect timeout")), 2000)
    wss.once("connection", (ws) => {
      clearTimeout(timeout)
      serverSideWs = ws
      ws.on("error", () => { /* expected during teardown */ })
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type === "security.confirmation.response") {
            securityConfirmations.respond(String(msg.confirmation_id || ""), msg.approved === true)
          } else if (msg.type === "tool.result") {
            handleToolResult(msg)
          }
        } catch { /* ignore malformed */ }
      })
      resolve()
    })
    clientSideWs = new WebSocket(`ws://127.0.0.1:${serverPort}`)
    clientSideWs.on("error", () => { /* expected during teardown */ })
  })
})

afterEach(async () => {
  for (const id of Array.from(pendingToolCalls.keys())) {
    const pending = pendingToolCalls.get(id)!
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
  }
  applyConnectionCloseGracePeriod()
  securityConfirmations.rejectAll("disconnect")
  getComputerTaskRegistryForTests().clear()
  setComputerEstopEnsureForTests(null)
  const safeTerminate = (ws: WebSocket | undefined) => { try { (ws as any)?.terminate?.() } catch { /* */ } }
  safeTerminate(clientSideWs)
  safeTerminate(serverSideWs)
  try { wss?.clients.forEach((c) => safeTerminate(c)) } catch { /* */ }
  await new Promise<void>((resolve) => {
    try { wss?.close(() => resolve()) } catch { resolve() }
  })
})

/** Subscribe to a client message type — call BEFORE the producing action. */
function expectClientMessage(type: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs)
    const handler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === type) {
          clearTimeout(timeout)
          clientSideWs.off("message", handler)
          resolve(msg)
        }
      } catch { /* ignore */ }
    }
    clientSideWs.on("message", handler)
  })
}

/** Assert NO message of the given type arrives within `stabilizationMs`. */
function expectNoClientMessage(type: string, stabilizationMs = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === type) {
          clientSideWs.off("message", handler)
          reject(new Error(`unexpected ${type} arrived: ${JSON.stringify(msg).slice(0, 200)}`))
        }
      } catch { /* ignore */ }
    }
    clientSideWs.on("message", handler)
    setTimeout(() => {
      clientSideWs.off("message", handler)
      resolve()
    }, stabilizationMs)
  })
}

function approve(confirmationId: string) {
  clientSideWs.send(JSON.stringify({
    type: "security.confirmation.response",
    confirmation_id: confirmationId,
    approved: true,
  }))
}

async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("until() timeout")
    await new Promise((r) => setTimeout(r, 10))
  }
}

test("R1 gate: second task refused BEFORE the L2 dialog while one is executing; first untouched", { skip: !WIN }, async () => {
  const registry = getComputerTaskRegistryForTests()
  registry.set("fake-running-task", false) // task A already in flight
  const executeTool = createToolExecutor(serverSideWs)
  const noConfirm = expectNoClientMessage("security.confirmation.request", 300)
  const result = await executeTool("tc_busy_gate", "host_computer", { ...COMPUTER_PARAMS })
  await noConfirm
  assert.equal(result.success, false)
  assert.match(result.error!, /COMPUTER_TASK_BUSY/)
  // The running task's registry entry is NOT disturbed by the refusal.
  assert.equal(registry.size, 1)
  assert.ok(registry.has("fake-running-task"))
})

test("R1 gate: with no task running the task is admitted to the L2 dialog (sequential)", { skip: !WIN }, async () => {
  const registry = getComputerTaskRegistryForTests()
  const executeTool = createToolExecutor(serverSideWs)
  const confirmationPromise = expectClientMessage("security.confirmation.request")
  const resultPromise = executeTool("tc_free_gate", "host_computer", { ...COMPUTER_PARAMS })
  const confirmation = await confirmationPromise
  assert.equal(confirmation.tool_name, "host_computer")
  // Deny at L2 — the handler never runs, nothing is ever registered.
  clientSideWs.send(JSON.stringify({
    type: "security.confirmation.response",
    confirmation_id: confirmation.confirmation_id,
    approved: false,
  }))
  const result = await resultPromise
  assert.equal(result.success, false)
  assert.doesNotMatch(result.error!, /COMPUTER_TASK_BUSY/)
  assert.equal(registry.size, 0)
})

test("R1 property: concurrent loser refused by handler check-and-set; abnormal exit releases; next admitted", { skip: !WIN }, async () => {
  const registry = getComputerTaskRegistryForTests()
  // A's estop preflight parks on a latch we control — A holds the single-task
  // slot WITHOUT any real ps helper / injection ever happening.
  let releaseA: (s: { ok: boolean; reason?: string }) => void = () => {}
  let estopCalls = 0
  setComputerEstopEnsureForTests(() => {
    estopCalls++
    return new Promise((resolve) => { releaseA = resolve })
  })
  try {
    const executeA = createToolExecutor(serverSideWs)
    const executeB = createToolExecutor(serverSideWs)
    // BOTH tasks pass the pre-dialog gate while the registry is EMPTY — the
    // exact race the handler-level check-and-set must close.
    const confAPromise = expectClientMessage("security.confirmation.request")
    const resultAPromise = executeA("tc_race_A", "host_computer", { ...COMPUTER_PARAMS })
    const confA = await confAPromise
    const confBPromise = expectClientMessage("security.confirmation.request")
    const resultBPromise = executeB("tc_race_B", "host_computer", { ...COMPUTER_PARAMS })
    const confB = await confBPromise

    // Approve A first: its handler registers the slot, then parks at the
    // estop latch (still "executing" from the invariant's perspective).
    approve(confA.confirmation_id)
    await until(() => estopCalls === 1)
    assert.equal(registry.size, 1, "A must hold the single-task slot")

    // Approve B: gate already passed, so the HANDLER check-and-set fires —
    // typed BUSY, and A is completely unaffected.
    approve(confB.confirmation_id)
    const resultB = await resultBPromise
    assert.equal(resultB.success, false)
    assert.match(resultB.error!, /COMPUTER_TASK_BUSY/)
    assert.equal(resultB?.data?.error_code, "COMPUTER_TASK_BUSY")
    assert.equal(registry.size, 1, "A's slot must be untouched by B's refusal")
    assert.equal(estopCalls, 1, "B must be refused BEFORE the estop preflight (no clearEstopFlag window)")

    // A exits abnormally (estop preflight refusal) — the handler's finally
    // must release the slot even though the task never ran a single action.
    releaseA({ ok: false, reason: "test-no-helper" })
    const resultA = await resultAPromise
    assert.equal(resultA.success, false)
    assert.equal(resultA?.data?.error_code, "EMERGENCY_STOP_UNAVAILABLE")
    assert.equal(registry.size, 0, "abnormal exit must release the slot")

    // Next task admitted: passes BOTH busy checks and reaches the (still
    // substituted) estop preflight — refused there, never with BUSY.
    let estopCallsC = 0
    setComputerEstopEnsureForTests(async () => {
      estopCallsC++
      return { ok: false, reason: "test-c" }
    })
    const executeC = createToolExecutor(serverSideWs)
    const confCPromise = expectClientMessage("security.confirmation.request")
    const resultCPromise = executeC("tc_race_C", "host_computer", { ...COMPUTER_PARAMS })
    const confC = await confCPromise
    approve(confC.confirmation_id)
    const resultC = await resultCPromise
    assert.equal(resultC.success, false)
    assert.doesNotMatch(resultC.error!, /COMPUTER_TASK_BUSY/)
    assert.equal(resultC?.data?.error_code, "EMERGENCY_STOP_UNAVAILABLE")
    assert.equal(estopCallsC, 1, "C must reach the estop preflight — the slot was free")
    assert.equal(registry.size, 0, "C's refusal must also release the slot")
  } finally {
    setComputerEstopEnsureForTests(null)
    registry.clear()
  }
})
