import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { agentReducer, initialState, selectCodingSession, selectCodingManualEntry } from "../src/sidepanel/store/agentStore"
import { codingManualEntryAction } from "../src/sidepanel/utils/coding-manual-entry-message"

// Recorded successful AcpManager spawn -> actual owner-scoped handler, not a guessed envelope.
const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/coding-manual-entry-522.json"), "utf8"))
const started = () => agentReducer(agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: fixture.progress.thread_id }),
  { type: "ACP_SESSION_EVENT", event: fixture.progress })
const request = { type: "ACP_MANUAL_ENTRY_REQUEST" as const, sessionId: fixture.prepared.session_id,
  threadId: fixture.prepared.thread_id, requestId: fixture.prepared.request_id, threadRevision: started().activeThreadSelectionRevision, selectionRevision: started().activeCodingSelectionRevision }
const pending = () => agentReducer(started(), request)

test("recorded closed default-off session receives only its explicitly requested private command", () => {
  const state = started()
  assert.equal(selectCodingSession(state)?.state, "closed")
  assert.equal(selectCodingSession(state)?.terminalCommandLine, undefined)
  const result = codingManualEntryAction(fixture.prepared)!
  assert.equal(agentReducer(state, result), state, "unsolicited command is not an entry")
  const next = agentReducer(pending(), result)
  assert.equal(selectCodingManualEntry(next, selectCodingSession(next))?.commandLine, fixture.prepared.command_line)
  assert.equal(next.codingSessionsById[request.sessionId].terminalCommandLine, undefined)
  assert.equal(agentReducer(next, result), next, "receipt replay cannot replace a consumed request")
})

test("matching real refusal stays visible; wrong request, owner or selection cannot publish a command", () => {
  const state = pending()
  const refused = agentReducer(state, codingManualEntryAction(fixture.wrong)!)
  assert.equal(selectCodingManualEntry(refused, selectCodingSession(refused))?.error, fixture.wrong.error)
  assert.equal(selectCodingManualEntry(refused, selectCodingSession(refused))?.commandLine, undefined)
  for (const patch of [{ request_id: "old-request" }, { thread_id: "other-owner" }, { session_id: "other-session" }]) {
    assert.equal(agentReducer(state, codingManualEntryAction({ ...fixture.prepared, ...patch })!), state)
  }
  const switched = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "other-owner" })
  assert.equal(switched.codingManualEntry, null)
  assert.equal(agentReducer(switched, codingManualEntryAction(fixture.prepared)!), switched)
  assert.equal(selectCodingManualEntry(switched, selectCodingSession(state)), null)
  const observed = agentReducer(state, { type: "ACP_SESSION_EVENT", event: { ...fixture.progress, session_id: "new-session" } })
  assert.equal(observed.codingManualEntry, state.codingManualEntry, "unrelated metadata cannot steal pending selected entry")
  const replaced = agentReducer(observed, { type: "ACP_SELECT_SESSION", sessionId: "new-session", threadId: request.threadId, threadRevision: observed.activeThreadSelectionRevision })
  assert.equal(replaced.codingManualEntry, null)
  assert.equal(agentReducer(replaced, codingManualEntryAction(fixture.prepared)!), replaced)
})

test("clear, thread teardown and retry fence late real replies without restoring closed rows", () => {
  const state = pending()
  for (const action of [
    { type: "CLEAR_CODING_SESSION" as const, sessionId: request.sessionId },
    { type: "REMOVE_THREAD" as const, threadId: request.threadId },
    { type: "REMOVE_THREADS" as const, threadIds: [request.threadId] },
    { type: "SET_THREADS" as const, threads: [] },
  ]) {
    const cleared = agentReducer(state, action)
    assert.equal(cleared.codingManualEntry, null)
    assert.equal(agentReducer(cleared, codingManualEntryAction(fixture.prepared)!), cleared)
  }
  const retry = agentReducer(state, { ...request, requestId: "new-request" })
  assert.equal(agentReducer(retry, codingManualEntryAction(fixture.prepared)!), retry)
  assert.equal(retry.codingManualEntry?.pending, true)
})

test("malformed recorded replies and unrelated ACP errors cannot become executable-looking UI text", () => {
  for (const patch of [{ session_id: {} }, { thread_id: null }, { request_id: "bad request" }, { request_id: "x".repeat(101) }])
    assert.equal(codingManualEntryAction({ ...fixture.prepared, ...patch }), null)
  for (const patch of [{ command_line: "" }, { command_line: {} }, { command_line: "中".repeat(12000) }, { shell: "unknown" }]) {
    const reply = codingManualEntryAction({ ...fixture.prepared, ...patch })!
    const state = agentReducer(pending(), reply)
    assert.equal(state.codingManualEntry?.commandLine, undefined)
    assert.ok(state.codingManualEntry?.error)
  }
  assert.equal(codingManualEntryAction({ ...fixture.wrong, request_type: "acp.apply_diff" }), null)
  assert.equal(codingManualEntryAction({ ...fixture.wrong, request_type: undefined }), null)
  assert.equal(codingManualEntryAction({ ok: true }), null)
  const bounded = agentReducer(pending(), codingManualEntryAction({ ...fixture.wrong, error: "x".repeat(2000) })!)
  assert.equal(bounded.codingManualEntry?.error?.length, 1000)
})
