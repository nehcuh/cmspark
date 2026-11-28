import assert from "node:assert/strict"
import test from "node:test"
import * as store from "../src/sidepanel/store/agentStore"
import { buildOptimisticUploadBubble } from "../src/sidepanel/utils/upload-send"
import { mountPanel, type Frame } from "./helpers/mount-sidepanel"

test("chat.user shows its bubble and busy state together in the active conversation", () => {
  const panel = mountPanel()
  panel.select("A")
  panel.receive({ type: "chat.user", thread_id: "A", message_id: "mA", content: "own turn" })
  assert.deepEqual(panel.state().messages.map(row => row.content), ["own turn"])
  assert.equal(panel.state().isProcessing, true)
  assert.equal(panel.state().threadBusyById.A, true)
})

test("an exact upload receipt during a queued switch reconciles only the cached thread", () => {
  const panel = mountPanel()
  panel.select("A")
  const upload = buildOptimisticUploadBubble({ threadId: "A", userMessage: "look", fileNames: ["shot.png"] })
  panel.addLocal(upload.message)
  panel.select("B", false)
  const stored = { ...upload.message, id: "stored-upload", attachments: [{ kind: "image", name: "shot.png", mime: "image/png" }] }
  panel.receive({ type: "chat.user", thread_id: "A", message_id: stored.id, content: stored.content,
    client_message_id: upload.clientMessageId, attachments: stored.attachments })
  assert.deepEqual(panel.state().messages, [])
  assert.equal(panel.state().isProcessing, false)
  assert.equal(panel.state().threadBusyById.B, undefined)
  panel.select("A")
  assert.deepEqual(panel.state().messages.map(row => row.id), [stored.id])
  for (let i = 0; i < 2; i++) {
    panel.receive({ type: "thread.messages", thread_id: "A", messages: [stored] })
    assert.deepEqual(panel.state().messages.map(row => [row.id, row.attachments?.[0]?.name]), [[stored.id, "shot.png"]])
  }
})

test("ordinary errors still appear in the active conversation", () => {
  const panel = mountPanel()
  panel.select("B")
  panel.receive({ type: "error", error: "Service is temporarily unavailable" })
  const message = panel.state().messages.at(-1)
  assert.equal(message?.thread_id, "B")
  assert.match(message?.content ?? "", /Service is temporarily unavailable/)
})

const lateFailures = [
  { label: "owned selection", reply: { request_type: "thread.select", thread_id: "A", id: "thread-select:A" } },
  { label: "legacy echoed request id", reply: { id: "thread-select:A" } },
  { label: "legacy owner in the error text", reply: {} },
]

for (const { label, reply } of lateFailures) {
  test(`late history error (${label}) leaves the newly selected conversation intact`, () => {
    const panel = mountPanel()
    panel.select("A")
    panel.select("B")
    panel.receive({ type: "thread.messages", thread_id: "B", messages: [
      { id: "msg-B", thread_id: "B", role: "user", content: "Question B", created_at: "t" },
    ] })
    panel.receive({ type: "chat.token", thread_id: "B", content: "Reply in progress" })
    const before = panel.state()
    const requests = [...panel.requests]
    assert.equal(before.threadBusyById.B, true)
    assert.equal(before.streamingContent, "Reply in progress")
    assert.equal(before.messages[0]?.content, "Question B")

    panel.receive({ type: "error", error: "Thread not found: A", ...reply })

    const after = panel.state()
    assert.deepEqual({
      threadId: after.activeThreadId, busy: after.threadBusyById.B,
      token: after.streamingContent, messages: after.messages, requests: panel.requests,
    }, {
      threadId: "B", busy: true, token: before.streamingContent, messages: before.messages, requests,
    })
  })
}

test("the selected thread retries a missing history once and reports a second failure", () => {
  const panel = mountPanel()
  panel.select("A")
  const missing = { type: "error", id: "thread-select:A", error: "Thread not found: A" }
  const selectCount = () => panel.requests.filter(request => request.type === "thread.select" && request.threadId === "A").length
  panel.receive(missing)
  assert.equal(selectCount(), 2)
  panel.receive(missing)
  assert.equal(selectCount(), 2)
  assert.equal(panel.state().processingStatus, "加载失败")
  assert.equal(panel.state().messages.length, 0)
  panel.receive({ type: "thread.messages", thread_id: "A", messages: [] })
  assert.equal(panel.state().processingStatus, null)
  panel.receive(missing)
  assert.equal(selectCount(), 3)
})

test("an untagged failure for a deleted row gives feedback without changing a queued selection", () => {
  const panel = mountPanel()
  panel.select("A")
  panel.receive({ type: "thread.messages", thread_id: "A", messages: [] })
  panel.select("B", false)
  panel.receive({ type: "error", error: "Thread not found: A" })
  assert.deepEqual(panel.notices, ["找不到对话 A"])
  assert.equal(panel.state().activeThreadId, "B")
  assert.equal(panel.state().processingStatus, "加载中")
  assert.equal(panel.state().hydrating, true)
  assert.deepEqual(panel.state().messages, [])
})

function transcript(threadId: string, content: string): Frame {
  return { type: "thread.messages", thread_id: threadId, messages: [
    { id: `msg-${threadId}`, thread_id: threadId, role: "user", content, created_at: "t" },
  ] }
}

function panelWithThreads() {
  const panel = mountPanel()
  panel.receive({ type: "connected" })
  panel.receive({ type: "thread.list", list_scope: "active", threads: ["A", "B", "C", "D"].map(id => ({
    id, alias: id, created_at: "t", updated_at: "t", pinned_tabs: [], active_skill_ids: [],
  })) })
  return panel
}

const deletionCases = [
  { label: "trash the active thread with a cold fallback", cached: false, frame: { type: "thread.trashed", thread_id: "A" } },
  { label: "delete the active thread with a cached fallback", cached: true, frame: { type: "thread.deleted", thread_id: "A" } },
  { label: "batch delete the active thread with a cold fallback", cached: false, frame: { type: "thread.batch_deleted", mode: "trash", ok: ["A", "C"], failed: [] } },
]

for (const { label, cached, frame } of deletionCases) {
  test(`${label} and request the replacement history once`, () => {
    const panel = panelWithThreads()
    if (cached) {
      panel.select("B")
      panel.receive(transcript("B", "Cached B"))
    }
    panel.select("A")
    panel.receive(transcript("A", "Previous A"))
    const requestsBeforeRemoval = panel.requests.length

    panel.receive(frame)

    assert.equal(panel.state().activeThreadId, "B")
    assert.equal(panel.state().hydrating, !cached)
    assert.deepEqual(panel.state().messages.map(row => row.content), cached ? ["Cached B"] : [])
    const newSelections = () => panel.requests.slice(requestsBeforeRemoval)
      .filter(request => request.type === "thread.select").map(request => request.threadId)
    assert.deepEqual(newSelections(), ["B"])

    panel.receive(frame)
    panel.receive({ type: "thread.deleted", thread_id: "D" })
    assert.deepEqual(newSelections(), ["B"])
    panel.receive(transcript("B", "Current B"))
    assert.equal(panel.state().hydrating, false)
    assert.deepEqual(panel.state().messages.map(row => row.content), ["Current B"])
    assert.deepEqual(newSelections(), ["B"])
  })
}

test("deletion broadcasts queued together only fetch the surviving selection", () => {
  const panel = panelWithThreads()
  panel.select("A")
  const previous = panel.requests.length
  panel.receive({ type: "thread.trashed", thread_id: "A" }, false)
  panel.receive({ type: "thread.trashed", thread_id: "B" })
  assert.equal(panel.state().activeThreadId, "C")
  assert.deepEqual(panel.requests.slice(previous).filter(request => request.type === "thread.select").map(request => request.threadId), ["C"])
})

test("a thread.updated queued after selecting B applies the settings to A only", () => {
  const panel = panelWithThreads()
  panel.select("A")
  panel.select("B", false)
  panel.receive({ type: "thread.updated", thread: {
    id: "A", skill_selection_mode: "manual", knowledge_selection_mode: "all",
    knowledge_smart_match: false, knowledge_route_by_group: true,
  } })
  const settings = () => {
    const state = panel.state()
    return [state.skillSelectionMode, state.knowledgeSelectionMode, state.knowledgeSmartMatch, state.knowledgeRouteByGroup]
  }
  assert.deepEqual(settings(), ["auto", "auto", true, false])
  panel.select("A")
  assert.deepEqual(settings(), ["manual", "all", false, true])
  panel.receive({ type: "thread.updated", thread: { id: "A", skill_selection_mode: "auto" } })
  assert.deepEqual(settings(), ["auto", "all", false, true])
})

test("an active list queued with the deletion keeps the replacement and its refresh", () => {
  const panel = panelWithThreads()
  panel.select("A")
  const before = panel.requests.length
  panel.receive({ type: "thread.trashed", thread_id: "A" }, false)
  panel.receive({ type: "thread.list", list_scope: "active", threads: [{ id: "B" }, { id: "C" }] })
  assert.equal(panel.state().activeThreadId, "B")
  assert.deepEqual(panel.requests.slice(before).filter(request => request.type === "thread.select").map(request => request.threadId), ["B"])
})

test("active lists keep project navigation and restore only a remembered, available thread", () => {
  const panel = mountPanel({ ...store.initialState, navigationRemembered: "B" })
  const list = { type: "thread.list", list_scope: "active", threads: [{ id: "A" }, { id: "B" }] }
  panel.receive({ type: "thread.list" })
  assert.equal(panel.state().threadListArrived, false)
  panel.receive(list)
  panel.receive(list)
  assert.equal(panel.state().activeThreadId, "B")
  assert.deepEqual(panel.requests.filter(frame => frame.type === "thread.select").map(frame => frame.threadId), ["B"])
  panel.receive({ ...list, threads: [{ id: "A" }] })
  assert.equal(panel.state().activeThreadId, null)
  assert.equal(panel.state().navigationLayer, "projects")
})

test("an old untagged error retries a pending cache refresh once and preserves the cached rows", () => {
  const panel = panelWithThreads()
  panel.select("B")
  panel.receive(transcript("B", "Cached B"))
  panel.select("A")
  const before = panel.requests.length
  panel.receive({ type: "thread.deleted", thread_id: "A" })
  const missing = { type: "error", error: "Thread not found: B" }
  panel.receive(missing)
  panel.receive(missing)
  assert.equal(panel.state().processingStatus, "加载失败")
  assert.deepEqual(panel.state().messages.map(row => row.content), ["Cached B"])
  assert.deepEqual(panel.requests.slice(before).filter(frame => frame.type === "thread.select").map(frame => frame.threadId), ["B", "B"])
  panel.receive(transcript("B", "Updated B"))
  panel.receive(missing)
  assert.deepEqual(panel.state().messages.map(row => row.content), ["Updated B"])
  assert.equal(panel.state().processingStatus, null)
  assert.equal(panel.requests.slice(before).filter(frame => frame.type === "thread.select").length, 2)
})
