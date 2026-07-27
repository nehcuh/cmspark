/**
 * ADR-016 Task 3: collectWorkerHandback path tests
 * — free-form when board off; structured merge; prose reject with HANDBACK_MISSING_STRUCTURE
 */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-board-collect-"))

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let collectWorkerHandback: typeof import("../src/board/service").collectWorkerHandback
let boardReadForTool: typeof import("../src/board/service").boardReadForTool
let hostRequiresStructuredHandback: typeof import("../src/board/service").hostRequiresStructuredHandback
let readBoard: typeof import("../src/board/service").readBoard
let ensureBoard: typeof import("../src/board/service").ensureBoard
let HANDBACK_MISSING_STRUCTURE: typeof import("../src/board/schema").HANDBACK_MISSING_STRUCTURE

before(async () => {
  process.env.HOME = tempHome
  delete process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  const config = await import("../src/config")
  await config.initDataDir()
  const tmMod = await import("../src/threads/thread-manager")
  ThreadManager = tmMod.ThreadManager
  const board = await import("../src/board/service")
  collectWorkerHandback = board.collectWorkerHandback
  boardReadForTool = board.boardReadForTool
  hostRequiresStructuredHandback = board.hostRequiresStructuredHandback
  readBoard = board.readBoard
  ensureBoard = board.ensureBoard
  const schema = await import("../src/board/schema")
  HANDBACK_MISSING_STRUCTURE = schema.HANDBACK_MISSING_STRUCTURE
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

function seedWorker(tm: InstanceType<typeof ThreadManager>, parentId: string, content: string) {
  const worker = tm.create("worker")
  tm.update(worker.id, {
    agent_role: "worker",
    parent_thread_id: parentId,
    orchestrator_run_id: "run-test",
  } as any)
  tm.addMessage(worker.id, { role: "assistant", content, thread_id: worker.id })
  return worker
}

test("hostRequiresStructuredHandback: board_mode or mission_board", async () => {
  const tm = new ThreadManager()
  const t = tm.create("req")
  assert.equal(hostRequiresStructuredHandback(t as any), false)
  tm.update(t.id, { board_mode: true } as any)
  assert.equal(hostRequiresStructuredHandback(tm.get(t.id) as any), true)
  tm.update(t.id, { board_mode: false } as any)
  await ensureBoard(tm, t.id, { force: true })
  assert.equal(hostRequiresStructuredHandback(tm.get(t.id) as any), true)
})

test("collect_handback board-off keeps free-form last_assistant", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("orch-off")
  const worker = seedWorker(tm, parent.id, "All done, prose only, no JSON")
  const r = await collectWorkerHandback(tm, { workerId: worker.id, callerThreadId: parent.id })
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.board_mode, false)
  assert.equal(r.data.last_assistant?.content, "All done, prose only, no JSON")
  assert.equal(r.data.facts, undefined)
  assert.equal(readBoard(tm, parent.id), null)
})

test("collect_handback board_mode on rejects prose with HANDBACK_MISSING_STRUCTURE", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("orch-prose")
  tm.update(parent.id, { board_mode: true } as any)
  const ap = auditPath()
  const worker = seedWorker(tm, parent.id, "Scanned everything. No issues found. Complete.")
  const r = await collectWorkerHandback(tm, {
    workerId: worker.id,
    callerThreadId: parent.id,
    auditPath: ap,
  })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error_code, HANDBACK_MISSING_STRUCTURE)
  assert.equal(r.recoverable, true)
  assert.equal(r.data?.board_mode, true)
  assert.ok(r.data?.last_assistant?.content.includes("Scanned everything"))
  assert.ok(readAudit(ap).some((e) => e.type === "board.handback_rejected"))
})

test("collect_handback structured JSON merges facts into host board", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("orch-ok")
  tm.update(parent.id, { board_mode: true } as any)
  const ap = auditPath()
  const payload = {
    schema_version: 1,
    facts: [
      {
        claim: "Login form has no CSRF token",
        evidence: [{ kind: "quote", value: "<form action=/login>" }],
        tags: ["stride:T"],
        severity: "high",
      },
    ],
    intents: [{ description: "Check cookie flags on session", status: "open" }],
    summary: "one finding",
  }
  const worker = seedWorker(
    tm,
    parent.id,
    `Here is the report.\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`,
  )
  const r = await collectWorkerHandback(tm, {
    workerId: worker.id,
    callerThreadId: parent.id,
    auditPath: ap,
  })
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.board_mode, true)
  assert.equal(r.data.facts?.length, 1)
  assert.equal(r.data.facts![0].trust, "llm_asserted")
  assert.match(r.data.facts![0].framed_claim, /UNTRUSTED_BOARD_FACT/)
  assert.match(r.data.facts![0].framed_claim, /Login form has no CSRF token/)
  assert.match(r.data.facts![0].trust_label, /NOT confirmed/)
  assert.equal(r.data.intents?.length, 1)
  assert.equal(r.data.board?.fact_count, 1)
  assert.equal(r.data.summary, "one finding")
  assert.ok(r.data.data_not_instruction)
  const board = readBoard(tm, parent.id)!
  assert.equal(board.facts.length, 1)
  assert.equal(board.intents.length, 1)
  assert.ok(readAudit(ap).some((e) => e.type === "board.handback_applied"))
})

test("collect_handback mission_board present without board_mode still requires structure", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("orch-mb")
  // board_mode false, but mission_board already initialized
  await ensureBoard(tm, parent.id, { force: true, goal: "review" })
  assert.equal(tm.get(parent.id)!.board_mode, false)
  assert.ok(tm.get(parent.id)!.mission_board)
  const worker = seedWorker(tm, parent.id, "just prose")
  const r = await collectWorkerHandback(tm, { workerId: worker.id, callerThreadId: parent.id })
  assert.equal(r.success, false)
  if (!r.success) assert.equal(r.error_code, HANDBACK_MISSING_STRUCTURE)
})

test("collect_handback empty assistant when board mode → recoverable missing structure", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("orch-empty")
  tm.update(parent.id, { board_mode: true } as any)
  const worker = tm.create("w-empty")
  tm.update(worker.id, {
    agent_role: "worker",
    parent_thread_id: parent.id,
  } as any)
  // no messages
  const r = await collectWorkerHandback(tm, { workerId: worker.id, callerThreadId: parent.id })
  assert.equal(r.success, false)
  if (!r.success) {
    assert.equal(r.error_code, HANDBACK_MISSING_STRUCTURE)
    assert.equal(r.recoverable, true)
  }
})

test("board_read returns framed projection + export trust labels (G4/G12)", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("orch-read")
  tm.update(parent.id, { board_mode: true } as any)
  const payload = JSON.stringify({
    schema_version: 1,
    facts: [{ claim: "X-Frame-Options missing" }],
  })
  const worker = seedWorker(tm, parent.id, payload)
  await collectWorkerHandback(tm, { workerId: worker.id, callerThreadId: parent.id })
  const read = boardReadForTool(tm, parent.id)
  assert.equal(read.success, true)
  assert.equal(read.data?.board?.facts.length, 1)
  assert.equal(read.data?.board?.facts[0].trust, "llm_asserted")
  assert.match(read.data!.board!.facts[0].framed_claim, /UNTRUSTED_BOARD_FACT/)
  assert.match(read.data!.board!.facts[0].trust_label, /NOT confirmed/)
  assert.match(read.data!.export_summary, /NOT confirmed/)
  assert.ok(read.data?.data_not_instruction)
  assert.equal(read.data?.raw_board?.facts[0].claim, "X-Frame-Options missing")
  assert.equal(read.data?.host_thread_id, parent.id)
  // worker path resolves to parent host
  const fromWorker = boardReadForTool(tm, worker.id)
  assert.equal(fromWorker.success, true)
  assert.equal(fromWorker.data?.host_thread_id, parent.id)
  assert.match(fromWorker.data!.board!.facts[0].framed_claim, /X-Frame-Options missing/)
})

test("ORCHESTRATOR_TOOL_ALLOWLIST includes board_read, board_complete, collect_handback", async () => {
  const { ORCHESTRATOR_TOOL_ALLOWLIST } = await import("../src/orchestrator/constants")
  assert.ok(ORCHESTRATOR_TOOL_ALLOWLIST.includes("collect_handback"))
  assert.ok(ORCHESTRATOR_TOOL_ALLOWLIST.includes("board_read"))
  assert.ok(ORCHESTRATOR_TOOL_ALLOWLIST.includes("board_complete"))
})

test("tool definitions expose collect_handback + board_read + board_complete", async () => {
  const { getToolDefinitions } = await import("../src/bridge/tool-definitions")
  const names = getToolDefinitions().map((t) => t.function.name)
  assert.ok(names.includes("collect_handback"))
  assert.ok(names.includes("board_read"))
  assert.ok(names.includes("board_complete"))
})

test("collect_handback is idempotent by worker message_id", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("orch-idem")
  tm.update(parent.id, { board_mode: true } as any)
  const payload = JSON.stringify({
    schema_version: 1,
    facts: [{ claim: "once only" }],
  })
  const worker = seedWorker(tm, parent.id, payload)
  const r1 = await collectWorkerHandback(tm, { workerId: worker.id, callerThreadId: parent.id })
  assert.equal(r1.success, true)
  const r2 = await collectWorkerHandback(tm, { workerId: worker.id, callerThreadId: parent.id })
  assert.equal(r2.success, true)
  if (r2.success) assert.equal(r2.data.idempotent_replay, true)
  const board = readBoard(tm, parent.id)!
  assert.equal(board.facts.length, 1)
})

test("live resolveToolCall accepts recorded tool_result id on worker", async () => {
  const tm = new ThreadManager()
  const parent = tm.create("orch-tv")
  tm.update(parent.id, { board_mode: true } as any)
  const worker = tm.create("w-tv")
  tm.update(worker.id, {
    agent_role: "worker",
    parent_thread_id: parent.id,
    orchestrator_run_id: "run-tv",
  } as any)
  // Record a tool result on the worker thread
  tm.addMessage(worker.id, {
    role: "tool",
    content: JSON.stringify({ success: true, data: { header: "DENY" } }),
    thread_id: worker.id,
    tool_calls: [{ id: "call_live_1", tool_name: "get_page_text", params: {}, result: { success: true } }],
  } as any)
  const payload = JSON.stringify({
    schema_version: 1,
    facts: [
      {
        claim: "XFO DENY present",
        trust: "tool_verified",
        evidence: [{ kind: "tool_result", value: "DENY", tool_call_id: "call_live_1" }],
      },
    ],
  })
  tm.addMessage(worker.id, { role: "assistant", content: payload, thread_id: worker.id })
  const { resolveToolCallFromThreadMessages } = await import("../src/board/service")
  const resolver = resolveToolCallFromThreadMessages(tm, worker.id, parent.id)
  assert.equal(resolver("call_live_1"), true)
  assert.equal(resolver("call_missing"), false)
  const r = await collectWorkerHandback(tm, {
    workerId: worker.id,
    callerThreadId: parent.id,
    resolveToolCall: resolver,
  })
  assert.equal(r.success, true)
  if (r.success) {
    assert.equal(r.data.facts?.[0].trust, "tool_verified")
  }
  const board = readBoard(tm, parent.id)!
  assert.equal(board.facts[0].trust, "tool_verified")
})
