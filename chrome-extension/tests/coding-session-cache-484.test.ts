import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState, selectCodingSession, type AgentState } from "../src/sidepanel/store/agentStore"

const send = (state: AgentState, event: Record<string, unknown>) => agentReducer(state, { type: "ACP_SESSION_EVENT", event })
const bytes = (row: unknown) => new TextEncoder().encode(JSON.stringify(row)).length

test("inactive terminal rich rows obey both count and UTF-8 byte budgets without deleting owners", () => {
  let state = agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: "current-owner" })
  state = send(state, { session_id: "current", thread_id: "current-owner", state: "closed", handback: "current result" })
  state = send(state, { session_id: "active", thread_id: "active-owner", state: "running", progress_tail: "active output" })
  state = send(state, { session_id: "diff", thread_id: "diff-owner", state: "closed", pending_diffs: [{ applyable: true }], handback: "diff source" })
  for (let i = 0; i < 100; i++) state = send(state, { session_id: `closed-${i}`, thread_id: `owner-${i}`, state: "closed", handback: "中文证据".repeat(1500) })
  const rows = Object.entries(state.codingSessionsById).filter(([id]) => id.startsWith("closed-"))
  const rich = rows.filter(([, row]) => !row.cacheCompacted)
  assert.ok(rich.length <= 16, `rich count ${rich.length}`)
  assert.ok(rich.reduce((sum, [, row]) => sum + bytes(row), 0) <= 256 * 1024)
  assert.equal(rows.length, 100, "minimal owner markers remain for stale-event refusal")
  assert.equal(selectCodingSession(state)?.handback, "current result")
  assert.equal(state.codingSessionsById.active.progressTail, "active output")
  assert.equal(state.codingSessionsById.diff.handback, "diff source")
  assert.equal(state.codingSessionsById.diff.hasPendingDiff, true)
})

test("a single UTF-8 oversized inactive result compacts and owner return does not invent content", () => {
  let state = agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: "a" })
  state = send(state, { session_id: "oversized", thread_id: "b", state: "closed", handback: "🧪".repeat(65536) })
  assert.equal(state.codingSessionsById.oversized.cacheCompacted, true)
  assert.equal(state.codingSessionsById.oversized.handback, undefined)
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "b" })
  assert.equal(selectCodingSession(state)?.sessionId, "oversized")
  assert.equal(selectCodingSession(state)?.handback, undefined)
})

test("clear compacts terminal bulk; late closed/running events cannot restore or reselect it", () => {
  let state = agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: "a" })
  state = send(state, { session_id: "old", thread_id: "a", state: "closed", handback: "old report", progress_tail: "old output" })
  state = agentReducer(state, { type: "CLEAR_CODING_SESSION", sessionId: "old" })
  assert.equal(state.codingSessionsById.old.cacheCompacted, true)
  for (const status of ["closed", "running"]) {
    state = send(state, { session_id: "old", thread_id: "a", state: status, handback: "late big report".repeat(10000) })
    assert.equal(state.codingSessionsById.old.state, "closed")
    assert.equal(state.codingSessionsById.old.handback, undefined)
    assert.equal(selectCodingSession(state), null)
  }
  const original = state
  assert.equal(send(state, { session_id: "old", thread_id: "b", state: "running" }), original)
  state = send(state, { session_id: "new", thread_id: "a", state: "running", progress_tail: "new output" })
  assert.equal(selectCodingSession(state)?.sessionId, "new")
})

test("switching away retires oversized closed current data but protects unresolved states", () => {
  let state = agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: "a" })
  state = send(state, { session_id: "current", thread_id: "a", state: "closed", handback: "x".repeat(300000) })
  for (const status of ["offered", "confirmed", "running", "unknown-future"]) state = send(state, { session_id: status, thread_id: status, state: status, progress_tail: "retained" })
  assert.equal(state.codingSessionsById.current.handback?.length, 300000)
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "b" })
  assert.equal(state.codingSessionsById.current.cacheCompacted, true)
  for (const status of ["offered", "confirmed", "running", "unknown-future"]) assert.equal(state.codingSessionsById[status].progressTail, "retained")
})
