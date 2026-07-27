import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-intent-"))
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
process.env.HOME = tempHome

let ThreadManager: any
let claimIntent: any
let heartbeatIntent: any
let reapStaleIntents: any
let ensureBoard: any
let applyHandbackPayload: any

before(async () => {
  const configMod = await import("../src/config")
  await configMod.initDataDir()
  configMod.clearConfigCache()
  const tmMod = await import("../src/threads/thread-manager")
  ThreadManager = tmMod.ThreadManager
  const claim = await import("../src/board/intent-claim")
  claimIntent = claim.claimIntent
  heartbeatIntent = claim.heartbeatIntent
  reapStaleIntents = claim.reapStaleIntents
  const board = await import("../src/board")
  ensureBoard = board.ensureBoard
  applyHandbackPayload = board.applyHandbackPayload
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("claimIntent: open → claimed exclusive", async () => {
  const tm = new ThreadManager()
  const host = tm.create("orch")
  tm.update(host.id, { agent_role: "orchestrator", board_mode: true } as any)
  await ensureBoard(tm, host.id, {
    actor_type: "system",
    thread_id: host.id,
  })
  await applyHandbackPayload(
    tm,
    host.id,
    {
      schema_version: 1,
      facts: [],
      intents: [{ description: "Check auth bypass", status: "open" }],
      empty_ok: false,
    },
    {
      actor_type: "orchestrator",
      thread_id: host.id,
      worker_id: null,
    },
    { messageId: "m1", resolveToolCall: () => false },
  )
  const board = tm.get(host.id).mission_board
  const intentId = board.intents[0].id
  const w = tm.create("w1")
  tm.update(w.id, { agent_role: "worker", parent_thread_id: host.id } as any)

  const c1 = await claimIntent(tm, {
    hostThreadId: host.id,
    intentId,
    workerThreadId: w.id,
  })
  assert.equal(c1.ok, true)
  if (c1.ok) {
    assert.equal(c1.intent.status, "claimed")
    assert.equal(c1.intent.claimed_by_worker_id, w.id)
  }

  const w2 = tm.create("w2")
  tm.update(w2.id, { agent_role: "worker", parent_thread_id: host.id } as any)
  const c2 = await claimIntent(tm, {
    hostThreadId: host.id,
    intentId,
    workerThreadId: w2.id,
  })
  assert.equal(c2.ok, false)
  if (!c2.ok) assert.equal(c2.error_code, "INTENT_BUSY")
})

test("heartbeat + reap stale claimed intent", async () => {
  const tm = new ThreadManager()
  const host = tm.create("orch2")
  tm.update(host.id, { agent_role: "orchestrator", board_mode: true } as any)
  await ensureBoard(tm, host.id, { actor_type: "system", thread_id: host.id })
  await applyHandbackPayload(
    tm,
    host.id,
    {
      schema_version: 1,
      facts: [],
      intents: [{ description: "Stale path", status: "open" }],
    },
    { actor_type: "orchestrator", thread_id: host.id, worker_id: null },
    { messageId: "m2", resolveToolCall: () => false },
  )
  const intentId = tm.get(host.id).mission_board.intents[0].id
  const w = tm.create("ww")
  tm.update(w.id, { agent_role: "worker", parent_thread_id: host.id } as any)
  await claimIntent(tm, { hostThreadId: host.id, intentId, workerThreadId: w.id })

  const hb = await heartbeatIntent(tm, {
    hostThreadId: host.id,
    intentId,
    workerThreadId: w.id,
  })
  assert.equal(hb.ok, true)

  // Force stale heartbeat
  await (await import("../src/board")).mutateMissionBoard(tm, host.id, (board) => {
    const intents = board.intents.map((i) =>
      i.id === intentId
        ? { ...i, heartbeat_at: new Date(Date.now() - 999_999_999).toISOString() }
        : i,
    )
    return { ok: true, board: { ...board, intents } }
  })

  const reaped = await reapStaleIntents(tm, host.id, { staleMs: 1000 })
  assert.ok(reaped.reaped >= 1)
  const after = tm.get(host.id).mission_board.intents.find((i: any) => i.id === intentId)
  assert.equal(after.status, "abandoned")
})
