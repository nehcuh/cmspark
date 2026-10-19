import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState, selectCodingSession } from "../src/sidepanel/store/agentStore"
import { parseCodingHistory, codingHistoryLabel } from "../src/sidepanel/coding-handoff/history"

const row = { session_id: "one", thread_id: "owner", agent_id: "inert", mode: "review_readonly",
  created_at: "2026-10-19T12:00:00.000Z", updated_at: "2026-10-19T12:00:00.000Z",
  observed_state: "running", source: "history", history_status: "interrupted" }
const message = { type: "acp.sessions.list_result", thread_id: "owner", request_id: "history:one", status: "ok", rows: [row] }
function request() {
  let state = agentReducer(initialState, { type: "SET_CONNECTION", state: "connected" })
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "owner" })
  return agentReducer(state, { type: "ACP_HISTORY_REQUEST", threadId: "owner", requestId: "history:one", selectionRevision: state.activeThreadSelectionRevision })
}

test("#732 fresh sidebar consumes read-only history without runtime-session hydration", () => {
  const result = agentReducer(request(), { type: "ACP_HISTORY_RESULT", message })
  assert.equal(result.codingHistory?.pending, false); assert.equal(result.codingHistory?.rows.length, 1)
  assert.equal(Object.keys(result.codingSessionsById).length, 0)
  assert.equal(Object.keys(result.codingSessionIdByThread).length, 0)
  assert.match(codingHistoryLabel(result.codingHistory!.rows[0]), /已中断/)
})

test("#732 same-event A→B→A invalidates the original history response", () => {
  let state = request()
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "other" })
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "owner" })
  assert.equal(agentReducer(state, { type: "ACP_HISTORY_RESULT", message }), state)
})

test("#732 disconnect/reconnect and disabled hide old historical content", () => {
  let state = request(); state = agentReducer(state, { type: "SET_CONNECTION", state: "disconnected" })
  state = agentReducer(state, { type: "SET_CONNECTION", state: "connected" })
  assert.equal(agentReducer(state, { type: "ACP_HISTORY_RESULT", message }), state)
  const filled = agentReducer(request(), { type: "ACP_HISTORY_RESULT", message })
  assert.equal(agentReducer(filled, { type: "SET_ACP_LIST", enabled: false, agents: [] }).codingHistory, null)
})
for (const [name, change] of [
  ["wrong owner", { thread_id: "foreign" }], ["old request", { request_id: "history:old" }],
  ["rich leaked field", { rows: [{ ...row, goal: "NEVER_RENDER" }] }],
  ["ghost running history", { rows: [{ ...row, history_status: "running" }] }],
  ["duplicate", { rows: [row, row] }], ["bad ISO", { rows: [{ ...row, created_at: "2026-02-30T00:00:00.000Z" }] }],
  ["disabled with rows", { status: "disabled" }], ["unknown status", { status: "ready" }],
] as const) test(`#732 consumer refuses ${name} without altering pending owner`, () => {
  const state = request(); assert.equal(agentReducer(state, { type: "ACP_HISTORY_RESULT", message: { ...message, ...change } }), state)
})

test("#732 missing optional protocol remains unavailable, no invented empty success", () => {
  assert.equal(parseCodingHistory({ type: "acp.list", agents: [] }), null)
  assert.equal(request().codingHistory?.status, "unavailable")
})

test("#732 master-disable invalidation also rejects an already-issued reply", () => {
  const state = agentReducer(request(), { type: "ACP_HISTORY_INVALIDATE" })
  assert.equal(state.codingHistory, null)
  assert.equal(agentReducer(state, { type: "ACP_HISTORY_RESULT", message }), state)
})

test("#732 authoritative add-thread and removal paths cannot resurrect an old history request", () => {
  let state = request()
  state = agentReducer(state, { type: "ADD_THREAD", thread: { id: "other", title: "synthetic" } as any })
  state = agentReducer(state, { type: "ADD_THREAD", thread: { id: "owner", title: "synthetic" } as any })
  assert.equal(state.codingHistory, null)
  assert.equal(agentReducer(state, { type: "ACP_HISTORY_RESULT", message }), state)
  state = agentReducer(request(), { type: "SET_THREADS", threads: [] })
  assert.equal(state.codingHistory, null)
})


function runningRequest() {
  let state = request()
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: {
    session_id: "one", thread_id: "owner", agent_id: "inert", state: "running",
  } })
  state = agentReducer(state, { type: "SET_CONNECTION", state: "disconnected" })
  state = agentReducer(state, { type: "SET_CONNECTION", state: "connected" })
  return agentReducer(state, { type: "ACP_HISTORY_REQUEST", threadId: "owner", requestId: "history:one", selectionRevision: state.activeThreadSelectionRevision })
}

test("#732 a current history-only reply retires pre-restart live controls without hydrating history", () => {
  const before = runningRequest()
  assert.equal(selectCodingSession(before)?.state, "running")
  const state = agentReducer(before, { type: "ACP_HISTORY_RESULT", message })
  assert.equal(state.codingHistory?.rows[0].history_status, "interrupted")
  assert.equal(selectCodingSession(state), null)
  assert.equal(state.codingSessionsById.one, before.codingSessionsById.one)
  assert.equal(state.codingHistory?.runtimeAtRequest, undefined)
})

test("#732 live results and unavailable history do not retire a genuine current session", () => {
  for (const reply of [{ ...message, rows: [{ ...row, source: "live", history_status: "running" }] },
    { ...message, status: "unavailable", rows: [] }]) {
    const before = runningRequest()
    const state = agentReducer(before, { type: "ACP_HISTORY_RESULT", message: reply })
    assert.equal(selectCodingSession(state), before.codingSessionsById.one)
  }
})

test("#732 a newer same-ID event wins over a delayed history-only reply, including equal timestamps", () => {
  let state = runningRequest()
  const requested = state.codingSessionsById.one
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { session_id: "one", thread_id: "owner", state: "running" } })
  state = { ...state, codingSessionsById: { ...state.codingSessionsById,
    one: { ...state.codingSessionsById.one, updatedAt: requested.updatedAt } } }
  const current = selectCodingSession(state)
  assert.notStrictEqual(current, requested)
  state = agentReducer(state, { type: "ACP_HISTORY_RESULT", message })
  assert.equal(selectCodingSession(state), current)
})

test("#732 a newer selected session and another thread remain untouched", () => {
  let state = runningRequest()
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { session_id: "other-thread", thread_id: "other", state: "running" } })
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { session_id: "new", thread_id: "owner", state: "running" } })
  const current = selectCodingSession(state), other = state.codingSessionIdByThread.other
  state = agentReducer(state, { type: "ACP_HISTORY_RESULT", message })
  assert.equal(selectCodingSession(state), current)
  assert.equal(state.codingSessionIdByThread.other, other)
})

test("#732 stale, invalid and disconnected replies cannot retire live controls", () => {
  for (const variant of ["old-request", "invalid", "disconnected", "aba"] as const) {
    let state = runningRequest()
    const reply = variant === "old-request" ? { ...message, request_id: "history:old" } :
      variant === "invalid" ? { ...message, rows: [{ ...row, history_status: "running" }] } : message
    if (variant === "disconnected") state = agentReducer(state, { type: "SET_CONNECTION", state: "disconnected" })
    if (variant === "aba") {
      state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "other" })
      state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "owner" })
    }
    const current = selectCodingSession(state)
    state = agentReducer(state, { type: "ACP_HISTORY_RESULT", message: reply })
    assert.equal(selectCodingSession(state), current)
  }
})

test("#732 late events update only their retired record and cannot reselect historical controls", () => {
  let state = agentReducer(runningRequest(), { type: "ACP_HISTORY_RESULT", message })
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { session_id: "one", thread_id: "owner", state: "closed" } })
  assert.equal(selectCodingSession(state), null)
  assert.equal(state.codingSessionsById.one.state, "closed")
})
