/**
 * ADR-016 G5/G6/G9/G13 — canComplete matrix, board_complete path, abandon intents
 */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-board-complete-"))

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let ensureBoard: typeof import("../src/board/service").ensureBoard
let applyHandbackPayload: typeof import("../src/board/service").applyHandbackPayload
let canComplete: typeof import("../src/board/service").canComplete
let completeBoard: typeof import("../src/board/service").completeBoard
let abandonWorkerIntents: typeof import("../src/board/service").abandonWorkerIntents
let readBoard: typeof import("../src/board/service").readBoard
let mutateMissionBoard: typeof import("../src/board/service").mutateMissionBoard

before(async () => {
  process.env.HOME = tempHome
  delete process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  const config = await import("../src/config")
  await config.initDataDir()
  const tmMod = await import("../src/threads/thread-manager")
  ThreadManager = tmMod.ThreadManager
  const board = await import("../src/board/service")
  ensureBoard = board.ensureBoard
  applyHandbackPayload = board.applyHandbackPayload
  canComplete = board.canComplete
  completeBoard = board.completeBoard
  abandonWorkerIntents = board.abandonWorkerIntents
  readBoard = board.readBoard
  mutateMissionBoard = board.mutateMissionBoard
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function auditPath(): string {
  return path.join(tempHome, `audit-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
}

function readAudit(p: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(p)) return []
  return fs
    .readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

async function seedBoardWithFact(
  tm: InstanceType<typeof ThreadManager>,
  trust: "llm_asserted" | "tool_verified" | "user_confirmed" = "llm_asserted",
) {
  const t = tm.create("complete-host")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true, goal: "Review PRD for threats" })
  const r = await applyHandbackPayload(
    tm,
    t.id,
    {
      schema_version: 1,
      facts: [
        {
          claim: "Finding A",
          trust: trust === "llm_asserted" ? undefined : trust,
          evidence:
            trust === "tool_verified"
              ? [{ kind: "tool_result", value: "ok", tool_call_id: "tc1" }]
              : [],
        },
      ],
    },
    trust === "user_confirmed"
      ? { actor_type: "user", thread_id: t.id }
      : { actor_type: "worker", worker_id: "w1", thread_id: "w1" },
    {
      resolveToolCall: trust === "tool_verified" ? (id) => id === "tc1" : undefined,
    },
  )
  assert.equal(r.ok, true)
  return { host: t, board: r.ok ? r.board : null }
}

test("canComplete: empty board / no supporting ids rejected", async () => {
  const tm = new ThreadManager()
  const t = tm.create("empty")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true, goal: "g" })
  const board = readBoard(tm, t.id)!
  const r = canComplete(board, { supporting_fact_ids: [] })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "BOARD_SUPPORTING_FACTS_REQUIRED")
})

test("canComplete: all llm_asserted supporting facts rejected", async () => {
  const tm = new ThreadManager()
  const { board } = await seedBoardWithFact(tm, "llm_asserted")
  assert.ok(board)
  const r = canComplete(board!, {
    supporting_fact_ids: [board!.facts[0].id],
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "BOARD_TRUST_INSUFFICIENT")
})

test("canComplete: tool_verified supporting fact accepted", async () => {
  const tm = new ThreadManager()
  const { board } = await seedBoardWithFact(tm, "tool_verified")
  assert.ok(board)
  const r = canComplete(board!, {
    supporting_fact_ids: [board!.facts[0].id],
  })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.path, "supporting_facts")
})

test("canComplete: empty_complete without reason rejected", async () => {
  const tm = new ThreadManager()
  const { board } = await seedBoardWithFact(tm, "llm_asserted")
  const r = canComplete(board!, { empty_complete: true, empty_complete_reason: "  " })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "BOARD_EMPTY_COMPLETE_REASON")
})

test("canComplete: empty_complete with reason accepted", async () => {
  const tm = new ThreadManager()
  const { board } = await seedBoardWithFact(tm, "llm_asserted")
  const r = canComplete(board!, {
    empty_complete: true,
    empty_complete_reason: "User confirmed no further findings after review",
  })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.path, "empty_complete")
})

test("canComplete: missing goal rejected unless empty_goal_ok", async () => {
  const tm = new ThreadManager()
  const t = tm.create("nogoal")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true })
  const board = readBoard(tm, t.id)!
  assert.equal(board.goal, null)
  const r = canComplete(board, {
    empty_complete: true,
    empty_complete_reason: "done",
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "BOARD_GOAL_REQUIRED")
})

test("completeBoard sets status completed via complete path + audit", async () => {
  const tm = new ThreadManager()
  const { host, board } = await seedBoardWithFact(tm, "tool_verified")
  const ap = auditPath()
  const r = await completeBoard(
    tm,
    host.id,
    {
      supporting_fact_ids: [board!.facts[0].id],
      residual_risks: ["residual X"],
      goal_summary: "Threats catalogued",
    },
    { actor_type: "orchestrator", thread_id: host.id },
    { auditPath: ap },
  )
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.board.status, "completed")
  assert.ok(r.board.completed_at)
  assert.equal(r.board.completed_by?.actor_type, "orchestrator")
  const events = readAudit(ap)
  assert.ok(events.some((e) => e.type === "board.completed" && e.empty_complete === false))
})

test("completeBoard empty_complete path audits empty_complete true", async () => {
  const tm = new ThreadManager()
  const { host } = await seedBoardWithFact(tm, "llm_asserted")
  const ap = auditPath()
  const r = await completeBoard(
    tm,
    host.id,
    {
      empty_complete: true,
      empty_complete_reason: "Confirmed empty after human review",
      residual_risks: [],
    },
    { actor_type: "orchestrator", thread_id: host.id },
    { auditPath: ap },
  )
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.board.status, "completed")
  assert.ok(readAudit(ap).some((e) => e.type === "board.completed" && e.empty_complete === true))
})

test("workers cannot completeBoard", async () => {
  const tm = new ThreadManager()
  const { host, board } = await seedBoardWithFact(tm, "tool_verified")
  const r = await completeBoard(
    tm,
    host.id,
    { supporting_fact_ids: [board!.facts[0].id] },
    { actor_type: "worker", worker_id: "w" },
  )
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "BOARD_COMPLETE_FORBIDDEN")
})

test("status completed cannot be set outside complete path", async () => {
  const tm = new ThreadManager()
  const { host } = await seedBoardWithFact(tm, "llm_asserted")
  const r = await mutateMissionBoard(tm, host.id, (board) => ({
    ok: true,
    board: {
      ...board,
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: null as any,
    },
  }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "BOARD_STATUS_INVALID")
  assert.equal(readBoard(tm, host.id)!.status, "open")
})

test("abandonWorkerIntents marks worker open intents abandoned (G13)", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("orch-ab")
  tm.update(parent.id, { board_mode: true } as any)
  await ensureBoard(tm, parent.id, { force: true, goal: "g" })
  const worker = tm.create("w-ab")
  tm.update(worker.id, {
    agent_role: "worker",
    parent_thread_id: parent.id,
  } as any)
  // Handback with intent from worker
  const applied = await applyHandbackPayload(
    tm,
    parent.id,
    {
      schema_version: 1,
      facts: [{ claim: "f1" }],
      intents: [{ description: "still exploring", status: "open" }],
    },
    { actor_type: "worker", worker_id: worker.id, thread_id: worker.id, message_id: "m1" },
    { workerThreadId: worker.id },
  )
  assert.equal(applied.ok, true)
  const before = readBoard(tm, parent.id)!
  assert.equal(before.intents[0].status, "open")
  const ap = auditPath()
  const ab = await abandonWorkerIntents(tm, worker.id, {
    reason: "worker_cancel",
    auditPath: ap,
  })
  assert.equal(ab.abandoned, 1)
  const after = readBoard(tm, parent.id)!
  assert.equal(after.intents[0].status, "abandoned")
  assert.ok(readAudit(ap).some((e) => e.type === "board.intents_abandoned"))
})

test("L2 binding includes board_complete payload", async () => {
  const { SecurityPolicy } = await import("../src/security-policy")
  const binding = SecurityPolicy.bindingPayloadFor("board_complete", {
    empty_complete: true,
    supporting_fact_ids: ["f1"],
    empty_complete_reason: "why",
  })
  assert.match(binding, /board_complete/)
  assert.match(binding, /empty=1/)
  assert.match(binding, /f1/)
})

test("buildBoardCompleteDigest has goal trust histogram claim previews residual empty flag", async () => {
  const { buildBoardCompleteDigest } = await import("../src/board/schema")
  const tm = new ThreadManager()
  const { board } = await seedBoardWithFact(tm, "tool_verified")
  const digest = buildBoardCompleteDigest(board!, {
    supporting_fact_ids: [board!.facts[0].id],
    residual_risks: ["r1"],
    empty_complete: false,
  })
  assert.equal(digest.goal, "Review PRD for threats")
  assert.ok(digest.trust_histogram.tool_verified >= 1)
  assert.equal(digest.claim_previews.length, 1)
  assert.match(digest.claim_previews[0].trust_label, /tool_verified/)
  assert.deepEqual(digest.residual_risks, ["r1"])
  assert.equal(digest.empty_complete, false)
})
