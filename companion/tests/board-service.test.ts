import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-board-svc-"))

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let ensureBoard: typeof import("../src/board/service").ensureBoard
let readBoard: typeof import("../src/board/service").readBoard
let applyHandbackPayload: typeof import("../src/board/service").applyHandbackPayload
let addHint: typeof import("../src/board/service").addHint
let isBoardHostThread: typeof import("../src/board/service").isBoardHostThread

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
  readBoard = board.readBoard
  applyHandbackPayload = board.applyHandbackPayload
  addHint = board.addHint
  isBoardHostThread = board.isBoardHostThread
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

test("Thread create defaults mission_board null and board_mode false", () => {
  const tm = new ThreadManager()
  const t = tm.create("board-defaults")
  assert.equal(t.mission_board, null)
  assert.equal(t.board_mode, false)
  const got = tm.get(t.id)!
  assert.equal(got.mission_board, null)
  assert.equal(got.board_mode, false)
})

test("ensureBoard skips when board_mode off", async () => {
  const tm = new ThreadManager()
  const t = tm.create("no-mode")
  const r = await ensureBoard(tm, t.id, { goal: "x" })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "BOARD_MODE_OFF")
  assert.equal(readBoard(tm, t.id), null)
})

test("ensureBoard initializes when board_mode true + audits", async () => {
  const tm = new ThreadManager()
  const t = tm.create("mode-on")
  tm.update(t.id, { board_mode: true } as any)
  const ap = auditPath()
  const r = await ensureBoard(tm, t.id, {
    goal: "Review PRD for threats",
    origin: "https://app.example/prd",
    auditPath: ap,
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.board.goal, "Review PRD for threats")
  assert.equal(r.board.origin, "https://app.example/prd")
  assert.equal(r.board.status, "open")
  const persisted = tm.get(t.id)!.mission_board
  assert.ok(persisted)
  assert.equal(persisted!.goal, "Review PRD for threats")
  const events = readAudit(ap)
  assert.ok(events.some((e) => e.type === "board.initialized"))
})

test("default trust is llm_asserted on handback fact", async () => {
  const tm = new ThreadManager()
  const t = tm.create("trust-default")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true })
  const ap = auditPath()
  const r = await applyHandbackPayload(
    tm,
    t.id,
    {
      schema_version: 1,
      facts: [{ claim: "Missing CSRF token on /settings" }],
      intents: [],
    },
    { actor_type: "worker", worker_id: "w1", thread_id: "w1" },
    { auditPath: ap, workerThreadId: "w1" },
  )
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.board.facts.length, 1)
  assert.equal(r.board.facts[0].trust, "llm_asserted")
  assert.equal(r.board.facts[0].provenance.actor_type, "worker")
  // client id/trust stripped — server stamped id
  assert.match(r.board.facts[0].id, /^fact_/)
  const events = readAudit(ap)
  assert.ok(events.some((e) => e.type === "board.fact_added" && e.trust === "llm_asserted"))
  assert.ok(events.some((e) => e.type === "board.handback_applied"))
})

test("client trust user_confirmed from worker is REJECTED (not demoted)", async () => {
  const tm = new ThreadManager()
  const t = tm.create("trust-reject")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true })
  const ap = auditPath()
  const r = await applyHandbackPayload(
    tm,
    t.id,
    {
      schema_version: 1,
      facts: [
        {
          claim: "I confirm this is real",
          trust: "user_confirmed",
        },
      ],
    },
    { actor_type: "worker", worker_id: "w2" },
    { auditPath: ap },
  )
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error_code, "BOARD_TRUST_REJECTED")
  const board = readBoard(tm, t.id)
  assert.equal(board?.facts.length ?? 0, 0)
  const events = readAudit(ap)
  assert.ok(events.some((e) => e.type === "board.trust_rejected"))
})

test("tool_verified without resolvable tool_call_id rejected", async () => {
  const tm = new ThreadManager()
  const t = tm.create("tv-reject")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true })
  const r = await applyHandbackPayload(
    tm,
    t.id,
    {
      schema_version: 1,
      facts: [
        {
          claim: "Tool said so",
          trust: "tool_verified",
          evidence: [{ kind: "tool_result", value: "ok", tool_call_id: "tc_missing" }],
        },
      ],
    },
    { actor_type: "orchestrator", thread_id: t.id },
    { resolveToolCall: () => false },
  )
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "BOARD_TRUST_REJECTED")
})

test("tool_verified with resolvable tool_call_id accepted", async () => {
  const tm = new ThreadManager()
  const t = tm.create("tv-ok")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true })
  const r = await applyHandbackPayload(
    tm,
    t.id,
    {
      schema_version: 1,
      facts: [
        {
          claim: "Response had X-Frame-Options DENY",
          trust: "tool_verified",
          evidence: [{ kind: "tool_result", value: "DENY", tool_call_id: "call_abc" }],
        },
      ],
    },
    { actor_type: "worker", worker_id: "w" },
    { resolveToolCall: (id) => id === "call_abc" },
  )
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.board.facts[0].trust, "tool_verified")
})

test("prose-only handback rejected with HANDBACK_MISSING_STRUCTURE + audit", async () => {
  const tm = new ThreadManager()
  const t = tm.create("prose")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true })
  const ap = auditPath()
  const r = await applyHandbackPayload(
    tm,
    t.id,
    "All done, scanned everything, no problems!",
    { actor_type: "worker", worker_id: "w" },
    { auditPath: ap, workerThreadId: "w" },
  )
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.error_code, "HANDBACK_MISSING_STRUCTURE")
    assert.equal(r.recoverable, true)
  }
  const events = readAudit(ap)
  assert.ok(events.some((e) => e.type === "board.handback_rejected"))
})

test("addHint by orchestrator persists + audits; worker forbidden", async () => {
  const tm = new ThreadManager()
  const t = tm.create("hints")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true })
  const ap = auditPath()
  const ok = await addHint(
    tm,
    t.id,
    "Focus on auth flows first",
    { actor_type: "orchestrator", thread_id: t.id },
    { auditPath: ap },
  )
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.board.hints.length, 1)
    assert.equal(ok.board.hints[0].provenance.actor_type, "orchestrator")
  }
  const bad = await addHint(tm, t.id, "worker hint", { actor_type: "worker", worker_id: "w" })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.error_code, "BOARD_HINT_FORBIDDEN")
  assert.ok(readAudit(ap).some((e) => e.type === "board.hint_added"))
})

test("worker thread cannot host mission_board via update", () => {
  const tm = new ThreadManager()
  const parent = tm.create("orch")
  const worker = tm.create("worker")
  tm.update(worker.id, {
    agent_role: "worker",
    parent_thread_id: parent.id,
    orchestrator_run_id: "run1",
  } as any)
  assert.throws(() => {
    tm.update(worker.id, {
      mission_board: {
        schema_version: 1,
        origin: null,
        goal: "x",
        status: "open",
        facts: [],
        intents: [],
        hints: [],
        updated_at: new Date().toISOString(),
      },
    } as any)
  }, /workers cannot host mission_board/)
  assert.equal(isBoardHostThread(tm.get(worker.id) as any), false)
  assert.equal(isBoardHostThread(tm.get(parent.id) as any), true)
})

test("complete_proposal in handback does not mutate board status", async () => {
  const tm = new ThreadManager()
  const t = tm.create("complete-prop")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true, goal: "done?" })
  const r = await applyHandbackPayload(
    tm,
    t.id,
    {
      schema_version: 1,
      facts: [{ claim: "one fact" }],
      complete_proposal: {
        goal_summary: "we're done",
        supporting_fact_ids: [],
        empty_complete: true,
      },
    },
    { actor_type: "worker" },
  )
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.board.status, "open")
})

test("ensureBoard does not wipe existing facts", async () => {
  const tm = new ThreadManager()
  const t = tm.create("no-wipe")
  tm.update(t.id, { board_mode: true } as any)
  await ensureBoard(tm, t.id, { force: true, goal: "g1" })
  await applyHandbackPayload(
    tm,
    t.id,
    { schema_version: 1, facts: [{ claim: "keep me" }] },
    { actor_type: "orchestrator", thread_id: t.id },
  )
  await ensureBoard(tm, t.id, { goal: "g2-should-not-replace", origin: "o2" })
  const b = readBoard(tm, t.id)!
  assert.equal(b.facts.length, 1)
  assert.equal(b.facts[0].claim, "keep me")
  assert.equal(b.goal, "g1") // only fill when null
})
