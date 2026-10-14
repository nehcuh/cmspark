import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { agentReducer, initialState, selectCodingSession, selectCodingOperationError } from "../src/sidepanel/store/agentStore"
import { codingControlAction } from "../src/sidepanel/utils/coding-control-message"

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/coding-control-522.json"), "utf8"))
const started = () => agentReducer(agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: fixture.progress.thread_id }), { type: "ACP_SESSION_EVENT", event: fixture.progress })

test("actual producer command survives mapping; only matching Companion receipt confirms Stop", () => {
  let state = started()
  assert.equal(selectCodingSession(state)?.terminalCommandLine, fixture.progress.terminal_command_line)
  assert.equal(selectCodingSession(state)?.cancelConfirmed, undefined)
  assert.equal(codingControlAction({ ok: true }), null, "runtime forwarding is not a Companion receipt")
  assert.equal(codingControlAction({ ...fixture.receipt, thread_id: undefined }), null)
  const wrong = codingControlAction({ ...fixture.receipt, thread_id: "wrong-owner" })!
  assert.equal(agentReducer(state, wrong), state)
  const receipt = codingControlAction(fixture.receipt)!
  state = agentReducer(state, receipt)
  assert.equal(selectCodingSession(state)?.state, "closed")
  assert.equal(selectCodingSession(state)?.cancelConfirmed, true)
  assert.equal(agentReducer(state, receipt), state, "repeat ack is idempotent")
  assert.equal(agentReducer(state, { type: "ACP_SESSION_EVENT", event: fixture.progress }), state, "late running payload cannot undo an acknowledged Stop")
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: fixture.stopped })
  assert.ok(selectCodingSession(state)?.timeline?.some(row => row.label?.includes("监视已停止")))
})

test("actual refusal is visible only on immutable matching owner; retry clears it without claiming success", () => {
  let state = started()
  const refused = codingControlAction(fixture.refused)!
  state = agentReducer(state, refused)
  assert.equal(selectCodingSession(state)?.state, "running")
  assert.equal(selectCodingSession(state)?.controlError, fixture.refused.error)
  const other = codingControlAction({ ...fixture.refused, thread_id: "wrong-owner" })!
  assert.equal(agentReducer(state, other), state)
  state = agentReducer(state, { type: "ACP_CONTROL_REQUEST", sessionId: fixture.receipt.session_id, threadId: fixture.receipt.thread_id })
  assert.equal(selectCodingSession(state)?.controlError, undefined)
  assert.equal(selectCodingSession(state)?.cancelConfirmed, undefined)
})

test("actual closed followup/prompt/apply refusals remain visible without reopening or undoing cancellation", () => {
  let state = agentReducer(started(), codingControlAction(fixture.receipt)!)
  for (const error of [fixture.followupRefused, fixture.promptRefused, fixture.applyRefused]) {
    state = agentReducer(state, codingControlAction(error)!)
    assert.equal(selectCodingOperationError(state, selectCodingSession(state)), error.error)
    assert.equal(selectCodingSession(state)?.state, "closed")
    assert.equal(selectCodingSession(state)?.cancelConfirmed, true)
    assert.equal(agentReducer(state, codingControlAction({ ...error, thread_id: "wrong-owner" })!), state)
  }
})

test("a real non-Stop refusal cannot clear an outstanding Stop request; actual Stop refusal can", () => {
  let state = agentReducer(started(), { type: "ACP_CONTROL_REQUEST", sessionId: fixture.receipt.session_id, threadId: fixture.receipt.thread_id })
  state = agentReducer(state, codingControlAction(fixture.livePromptRefused)!)
  assert.equal(selectCodingSession(state)?.stopPending, true)
  assert.equal(selectCodingOperationError(state, selectCodingSession(state)), fixture.livePromptRefused.error)
  state = agentReducer(state, codingControlAction(fixture.refused)!)
  assert.equal(selectCodingSession(state)?.stopPending, false)
  assert.equal(selectCodingSession(state)?.controlError, fixture.refused.error)
})

test("actual plain closed event is terminal even before the cancel ack arrives", () => {
  const state = agentReducer(started(), { type: "ACP_SESSION_EVENT", event: fixture.stopped })
  assert.equal(selectCodingSession(state)?.cancelConfirmed, undefined)
  assert.equal(agentReducer(state, { type: "ACP_SESSION_EVENT", event: fixture.progress }), state)
  assert.equal(selectCodingSession(state)?.state, "closed")
})

test("retirement preserves the minimal real cancelled outcome when no cancel ack was received", () => {
  let state = agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: "other" })
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: fixture.stopped })
  for (let i = 0; i < 20; i++) state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { ...fixture.stopped, session_id: `z-${i}`, thread_id: `z-owner-${i}` } })
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: fixture.stopped.thread_id })
  assert.equal(selectCodingSession(state)?.cacheCompacted, true)
  assert.equal(selectCodingSession(state)?.error, undefined, "rich error text is retired")
  assert.equal(selectCodingSession(state)?.cancelConfirmed, undefined)
  assert.equal(selectCodingSession(state)?.cancelled, true)
})

test("legacy untyped ACP errors retain the original processingStatus route instead of guessing Stop", () => {
  const legacy = { ...fixture.followupRefused }
  delete legacy.request_type
  assert.equal(codingControlAction(legacy), null)
})

test("actual compacted-owner followup refusal is visible without restoring records or selection", () => {
  let state = agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: "other" })
  state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: fixture.stopped })
  for (let i = 0; i < 20; i++) state = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { ...fixture.stopped, session_id: `z-retire-${i}`, thread_id: `z-retire-owner-${i}` } })
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: fixture.stopped.thread_id })
  assert.equal(selectCodingSession(state)?.cacheCompacted, true)
  const records = state.codingSessionsById, selection = state.codingSessionIdByThread
  const next = agentReducer(state, codingControlAction(fixture.followupRefused)!)
  assert.equal(next.codingOperationError?.error, fixture.followupRefused.error)
  assert.equal(next.codingSessionsById, records)
  assert.equal(next.codingSessionIdByThread, selection)
  assert.equal(selectCodingSession(next)?.cacheCompacted, true)
})


test("operation notice is bounded and follows only the current selected immutable owner", () => {
  let state = agentReducer(started(), codingControlAction(fixture.livePromptRefused)!)
  const request = { type: "ACP_OPERATION_REQUEST" as const, sessionId: fixture.progress.session_id, threadId: fixture.progress.thread_id }
  state = agentReducer(state, request)
  assert.equal(selectCodingOperationError(state, selectCodingSession(state)), undefined)
  state = agentReducer(state, codingControlAction({ ...fixture.livePromptRefused, error: "x".repeat(1001) })!)
  assert.equal(selectCodingOperationError(state, selectCodingSession(state))?.length, 1000)
  const other = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "other-owner" })
  assert.equal(other.codingOperationError, null)
  assert.equal(agentReducer(other, codingControlAction(fixture.livePromptRefused)!), other)
  assert.equal(selectCodingOperationError(other, selectCodingSession(state)), undefined)
  const newer = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { ...fixture.progress, session_id: "new-owned-session" } })
  assert.equal(newer.codingOperationError, null)
  assert.equal(agentReducer(newer, codingControlAction(fixture.livePromptRefused)!), newer)
  assert.equal(agentReducer(state, { type: "SET_THREADS", threads: [] }).codingOperationError, null)
  assert.equal(agentReducer(state, { type: "REMOVE_THREAD", threadId: fixture.progress.thread_id }).codingOperationError, null)
  assert.equal(agentReducer(state, { type: "REMOVE_THREADS", threadIds: [fixture.progress.thread_id] }).codingOperationError, null)
  const dismissed = agentReducer(state, { type: "CLEAR_CODING_SESSION", sessionId: fixture.progress.session_id })
  assert.equal(dismissed.codingOperationError, null)
  assert.equal(agentReducer(dismissed, codingControlAction(fixture.livePromptRefused)!), dismissed)
})

test("unknown or structured request metadata retains original flow without coercion", () => {
  for (const request_type of [undefined, null, 1, ["acp.session.followup"], { toString: "acp.session.followup" }, "unknown.operation"])
    assert.equal(codingControlAction({ ...fixture.followupRefused, request_type }), null)
  assert.equal(codingControlAction({ ...fixture.followupRefused, request_type: { toString() { throw new Error("must not coerce") } } }), null)
})
