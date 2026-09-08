import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState, selectCodingSession, codingSessionBelongsToThread, type AgentState, type CodingSessionEvent } from "../src/sidepanel/store/agentStore"
import { codingMessageTargetsThread } from "../src/sidepanel/hooks/useWebSocket"

function event(state: AgentState, value: CodingSessionEvent): AgentState {
  return agentReducer(state, { type: "ACP_SESSION_EVENT", event: value })
}
function switchTo(state: AgentState, threadId: string): AgentState {
  return agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId })
}

test("A task remains in A when creating B; background handback updates A and return restores it", () => {
  let state = event(switchTo(initialState, "a"), {
    session_id: "sa", thread_id: "a", state: "running", workspace_root: "/repo/a", goal: "review A",
  })
  state = switchTo(state, "b")
  assert.equal(selectCodingSession(state), null)
  state = event(state, { session_id: "sa", thread_id: "a", state: "closed", handback: "A findings", pending_diffs: [{ applyable: true }] })
  assert.equal(selectCodingSession(state), null)
  state = switchTo(state, "a")
  assert.equal(selectCodingSession(state)?.handback, "A findings")
  assert.equal(selectCodingSession(state)?.workspaceRoot, "/repo/a")
  assert.equal(selectCodingSession(state)?.hasPendingDiff, true)
})

test("a new session never inherits another session's mode, diff, workspace or terminal flags", () => {
  let state = event(switchTo(initialState, "a"), {
    session_id: "sa", thread_id: "a", state: "closed", mode: "propose_diff", workspace_root: "/repo/a", handback: "private A", pending_diffs: [{ applyable: true }], open_local_terminal: true,
  })
  state = event(switchTo(state, "b"), { session_id: "sb", thread_id: "b", state: "running" })
  const selected = selectCodingSession(state)!
  for (const key of ["mode", "hasPendingDiff", "workspaceRoot", "handback", "openLocalTerminal"] as const) assert.equal(selected[key], undefined)
  assert.equal(selected.threadId, "b")
})

test("late prior-session events and stale dismiss timers cannot replace or dismiss a newer session", () => {
  let state = event(switchTo(initialState, "a"), { session_id: "old", thread_id: "a", state: "closed" })
  state = event(state, { session_id: "new", thread_id: "a", state: "running" })
  state = event(state, { session_id: "old", thread_id: "a", state: "closed", handback: "late" })
  state = agentReducer(state, { type: "CLEAR_CODING_SESSION", sessionId: "old" })
  assert.equal(selectCodingSession(state)?.sessionId, "new")
  assert.equal(state.codingSessionsById.old.handback, "late")
})

test("unknown ownerless events are ignored; known partial events use only their existing owner", () => {
  const active = switchTo(initialState, "b")
  assert.equal(event(active, { session_id: "unknown", state: "running" }), active)
  let state = event(active, { session_id: "sa", thread_id: "a", state: "running" })
  state = event(state, { session_id: "sa", progress_tail: "progress" })
  assert.equal(selectCodingSession(state), null)
  assert.equal(state.codingSessionsById.sa.threadId, "a")
  assert.equal(event(state, { session_id: "sa", thread_id: "b", handback: "forged ownership" }), state)
})

test("dismiss is scoped and late progress cannot resurrect a dismissed session", () => {
  let state = event(switchTo(initialState, "a"), { session_id: "sa", thread_id: "a", state: "closed" })
  state = event(state, { session_id: "sb", thread_id: "b", state: "running" })
  state = agentReducer(state, { type: "CLEAR_CODING_SESSION", sessionId: "sa" })
  state = event(state, { session_id: "sa", state: "closed" })
  assert.equal(selectCodingSession(state), null)
  assert.equal(selectCodingSession(state, "b")?.sessionId, "sb")
})

test("commands and result feedback require an exact nonempty conversation owner", () => {
  const state = event(switchTo(initialState, "a"), { session_id: "sa", thread_id: "a", state: "running" })
  const session = selectCodingSession(state)
  assert.equal(codingSessionBelongsToThread(session, "a"), true)
  assert.equal(codingSessionBelongsToThread(session, "b"), false)
  assert.equal(codingSessionBelongsToThread(session, null), false)
  assert.equal(codingMessageTargetsThread({ thread_id: "a" }, "a"), true)
  assert.equal(codingMessageTargetsThread({ thread_id: "a" }, "b"), false)
  assert.equal(codingMessageTargetsThread({}, "b"), false)
  assert.equal(codingMessageTargetsThread({ thread_id: "" }, null), false)
})


test("first background B event before thread-list hydration remains in B and restores on navigation", () => {
  let state = event(switchTo(initialState, "a"), { session_id: "sa", thread_id: "a", state: "running" })
  assert.deepEqual(state.threads, [], "thread.list is not required to admit authenticated session events")
  state = event(state, { session_id: "sb", thread_id: "b", state: "running", workspace_root: "/repo/b", goal: "background B" })
  assert.equal(selectCodingSession(state)?.sessionId, "sa")
  state = event(state, { session_id: "sb", progress_tail: "B progress before hydration" })
  assert.equal(selectCodingSession(state)?.sessionId, "sa")
  state = switchTo(state, "b")
  assert.equal(selectCodingSession(state)?.sessionId, "sb")
  assert.equal(selectCodingSession(state)?.workspaceRoot, "/repo/b")
  assert.equal(selectCodingSession(state)?.progressTail, "B progress before hydration")
  const conflict = event(state, { session_id: "sb", thread_id: "a", progress_tail: "rebind attempt" })
  assert.equal(conflict, state, "the stored session owner remains immutable")
})
