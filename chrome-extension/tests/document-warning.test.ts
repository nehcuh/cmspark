import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { agentReducer, initialState, type AgentState } from "../src/sidepanel/store/agentStore"
import { knowledgePreviewFromMessage, sanitizeHydratedMessages, shouldApplyStreamEvent } from "../src/sidepanel/hooks/useWebSocket"
import { parseDocumentNotices } from "../src/sidepanel/utils/document-warning"
import { DocumentWarning } from "../src/sidepanel/components/DocumentWarning"

// Captured by the actual handleMessage/chatCreate producers in the Companion
// office-import-entry test. Original response fields are not hand-authored.
const recorded = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/office-warning-614/router-responses.json"), "utf8"))

test("recorded chat notice survives live adoption, hydration and switching without entering content", () => {
  const chat = recorded.chat, files = parseDocumentNotices(chat.files)
  assert.equal(files?.[0].warning, "文档转换时缺少部分字体，布局可能与原文不同。")
  const message = { id: chat.message_id, thread_id: chat.thread_id, role: "user" as const, content: chat.content, created_at: "fixture", files }
  const optimistic = { ...message, id: "temp-client", content: "读取这份文档", files: undefined }
  let state: AgentState = { ...initialState, activeThreadId: chat.thread_id, messages: [optimistic] }
  state = agentReducer(state, { type: "ADD_MESSAGE", message: { ...message, client_message_id: optimistic.id } })
  assert.deepEqual(state.messages[0].files, files)
  state = agentReducer(state, { type: "ADD_MESSAGE", message: { ...message, files: undefined } })
  assert.deepEqual(state.messages[0].files, files, "field-less SW echoes do not discard persisted notices")
  const hydrated = sanitizeHydratedMessages([message])
  assert.deepEqual(hydrated[0].files, files)
  assert.ok(!hydrated[0].content.includes(files![0].warning))
  assert.equal(shouldApplyStreamEvent(chat.thread_id, "other-thread"), false)
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "other-thread" })
  assert.equal(state.messages.some(m => !!m.files), false)
  state = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: chat.thread_id })
  assert.deepEqual(state.messages[0].files, files)
  const html = renderToStaticMarkup(createElement(DocumentWarning, files![0]))
  assert.match(html, /role="status"/)
  assert.ok(html.includes(files![0].warning))
})

test("both recorded knowledge producers feed the real WS whitelist and clear notices on new/late requests", () => {
  for (const [payload, requestId] of [[recorded.previewUpload, "kp-font-upload"], [recorded.previewNative, "kp-font-native"]] as const) {
    // Upload router body has no id: ws/lifecycle echoes the request id on wire.
    let state = agentReducer(initialState, { type: "SET_KNOWLEDGE_PREVIEW", pendingId: requestId,
      preview: { title: "request", preview: "正在解析…", payload: { content: "original body" } } })
    state = agentReducer(state, { type: "SET_KNOWLEDGE_PREVIEW", replyId: requestId, preview: knowledgePreviewFromMessage(payload) })
    assert.equal(state.knowledgePreview?.warning, payload.warning)
    assert.ok(!state.knowledgePreview?.preview.includes(payload.warning))
    assert.ok(!state.knowledgePreview?.payload.content?.includes(payload.warning))
    state = agentReducer(state, { type: "SET_KNOWLEDGE_PREVIEW_SUGGESTED", replyId: requestId, suggested: { source: "llm", description: "parsed draft", tags: [] } })
    assert.equal(state.knowledgePreview?.warning, payload.warning)
    state = agentReducer(state, { type: "SET_KNOWLEDGE_PREVIEW", pendingId: "new-request", preview: { preview: "正在解析…", payload: {} } })
    assert.equal(state.knowledgePreview?.warning, undefined)
    const fresh = state
    state = agentReducer(state, { type: "SET_KNOWLEDGE_PREVIEW", replyId: requestId, preview: knowledgePreviewFromMessage(payload) })
    assert.equal(state, fresh, "late responses cannot reattach a previous document's notice")
    state = agentReducer(state, { type: "CLEAR_KNOWLEDGE_PREVIEW" })
    const closed = state
    assert.equal(agentReducer(closed, { type: "SET_KNOWLEDGE_PREVIEW", replyId: "new-request", preview: knowledgePreviewFromMessage(payload) }), closed)
  }
})

test("notice display is bounded plain text; absent or uncorrelated warning never displays", () => {
  const payload = recorded.previewUpload
  const { warning, ...clean } = payload
  assert.equal(knowledgePreviewFromMessage(clean).warning, undefined)
  assert.equal(renderToStaticMarkup(createElement(DocumentWarning, {})), "")
  const hostile = '<img src=x onerror="alert(1)">' + "x".repeat(2000)
  const files = parseDocumentNotices([{ ...recorded.chat.files[0], warning: hostile, content: "not notice metadata" }])!
  assert.equal(files[0].warning.length, 512)
  assert.deepEqual(Object.keys(files[0]).sort(), ["filename", "warning"])
  const html = renderToStaticMarkup(createElement(DocumentWarning, files[0]))
  assert.ok(!html.includes("<img")); assert.ok(html.includes("&lt;img"))
  assert.equal(parseDocumentNotices([{ filename: "clean.doc", warning: "\n\0\t" }]), undefined)
  let state = agentReducer(initialState, { type: "SET_KNOWLEDGE_PREVIEW", pendingId: "pending", preview: { payload: {}, preview: "正在解析…" } })
  state = agentReducer(state, { type: "SET_KNOWLEDGE_PREVIEW", preview: knowledgePreviewFromMessage(payload) })
  assert.equal(state.knowledgePreview?.warning, undefined, "id-less legacy frames cannot carry a document-bound notice")
})
