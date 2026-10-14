import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { isProject, matchingProjectReply, requestProject } from "../src/sidepanel/utils/project-request"
import { projectMetadataSenderAllowed } from "../src/background/project-metadata"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"

const recorded = JSON.parse(fs.readFileSync("tests/fixtures/project-metadata-641.json", "utf8"))

test("canonical explicit selection revision observes A-to-B-to-A even when React batches renders", () => {
  const a = agentReducer(initialState, { type: "SET_ACTIVE_THREAD", threadId: recorded.bound.thread.id })
  const same = agentReducer(a, { type: "SET_ACTIVE_THREAD", threadId: recorded.bound.thread.id })
  assert.equal(same.activeThreadSelectionRevision, a.activeThreadSelectionRevision)
  const b = agentReducer(a, { type: "SET_ACTIVE_THREAD", threadId: "owned-other" })
  const back = agentReducer(b, { type: "SET_ACTIVE_THREAD", threadId: recorded.bound.thread.id })
  assert.equal(back.activeThreadId, a.activeThreadId)
  assert.equal(back.activeThreadSelectionRevision, a.activeThreadSelectionRevision + 2)
})

test("actual production router JSON is accepted; private creation provenance cannot enter public Project DTO", () => {
  assert.equal(matchingProjectReply(recorded.created, "project.create", recorded.createRequest), true)
  assert.equal(matchingProjectReply(recorded.bound, "thread.project.set", recorded.bindRequest), true)
  assert.equal(matchingProjectReply(recorded.state, "project.list", {}), true)
  assert.equal(isProject({ ...recorded.created.project, creation_operation_id: recorded.createRequest.operation_id }), false)
  assert.equal("creation_operation_id" in recorded.created.project, false)
  assert.equal("creation_name" in recorded.created.project, false)
  assert.equal("workspace_root" in recorded.created.project, false)
  assert.equal("project_id" in recorded.bound.thread, true)
})

test("wrong owner/project/operation/fields cannot complete a persisted-save waiter", () => {
  const data = recorded.bindRequest
  for (const invalid of [{ ...recorded.bound, thread_id: "other" }, { ...recorded.bound, operation_id: "other" },
    { ...recorded.bound, project_id: null }, { ...recorded.bound, thread: { ...recorded.bound.thread, id: "other" } },
    { ...recorded.bound, thread: { ...recorded.bound.thread, project_id: null } }, { ...recorded.bound, revision: NaN }]) {
    assert.equal(matchingProjectReply(invalid, "thread.project.set", data), false)
  }
  assert.equal(matchingProjectReply({ ...recorded.created, project: { ...recorded.created.project, name: "other" } }, "project.create", recorded.createRequest), false)
})

test("transport ACK and forged late replies are ignored until the actual matching receipt", async () => {
  const listeners = new Set<(message: any) => void>();let sent: any
  ;(globalThis as any).chrome = { runtime: { onMessage: { addListener: (f: any) => listeners.add(f), removeListener: (f: any) => listeners.delete(f) }, sendMessage: (message: any) => { sent = message; return Promise.resolve({ ok: true }) } } }
  const controller = new AbortController();let settled = false
  const waiting = requestProject("thread.project.set", recorded.bindRequest, controller.signal).then(result => { settled = true; return result })
  await Promise.resolve();assert.equal(settled, false)
  listeners.forEach(f => f({ ...recorded.bound, id: sent.id, thread_id: "other" }))
  await Promise.resolve();assert.equal(settled, false)
  listeners.forEach(f => f({ ...recorded.bound, id: "old request" }))
  await Promise.resolve();assert.equal(settled, false)
  listeners.forEach(f => f({ type: "project.error", id: sent.id, operation_id: "other operation", error: "wrong operation" }))
  await Promise.resolve();assert.equal(settled, false)
  listeners.forEach(f => f({ ...recorded.bound, id: sent.id }))
  assert.equal((await waiting).thread.id, recorded.bound.thread.id)
  assert.equal(listeners.size, 0)
})

test("abort cleans listeners and reports unknown outcome, without sending or replaying another operation", async () => {
  const listeners = new Set<(message: any) => void>();let sends = 0
  ;(globalThis as any).chrome = { runtime: { onMessage: { addListener: (f: any) => listeners.add(f), removeListener: (f: any) => listeners.delete(f) }, sendMessage: () => { sends++; return Promise.resolve({ ok: true }) } } }
  const controller = new AbortController(), waiting = requestProject("project.create", recorded.createRequest, controller.signal)
  controller.abort()
  const failure = await waiting.then(() => null, error => error)
  assert.ok(failure instanceof Error && /刷新核实/.test(failure.message))
  assert.equal(sends, 1);assert.equal(listeners.size, 0)
})

test("new metadata family rejects content, foreign, framed, omitted sender; sidepanel/popout allowed", () => {
  const id = "ownedextension"
  for (const sender of [undefined, { id, url: "https://fixture.invalid" }, { id: "other", url: `chrome-extension://${id}/sidepanel.html` },
    { id, url: `chrome-extension://${id}/sidepanel.html`, frameId: 1 }, { id, url: `chrome-extension://${id}/content.html` }]) assert.equal(projectMetadataSenderAllowed(sender, id), false)
  assert.equal(projectMetadataSenderAllowed({ id, url: `chrome-extension://${id}/sidepanel.html`, frameId: 0 }, id), true)
  assert.equal(projectMetadataSenderAllowed({ id, url: `chrome-extension://${id}/sidepanel.html?popout=1` }, id), true)
})
