// #270/#271 — knowledge import preview: request-id correlation, extended
// error-text fallback, send-failure visibility, and the skip/cancel
// late-reply guard. Store-level tests; no WS mock needed.

import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState, type AgentState } from "../src/sidepanel/store/agentStore"
import {
  knowledgePreviewErrorText,
  knowledgePreviewSendFailureText,
  newKnowledgePreviewRequestId,
} from "../src/sidepanel/utils/knowledge-preview"

function withPendingPreview(): AgentState {
  return agentReducer(initialState, {
    type: "SET_KNOWLEDGE_PREVIEW",
    pendingId: "kp-req-1",
    preview: {
      title: "notes",
      description: "",
      preview: "正在解析…",
      char_count: 0,
      payload: { file: { name: "notes.docx", content: "QUJD" } },
    },
  })
}

test("request id format: kp- prefix + uuid", () => {
  const id = newKnowledgePreviewRequestId()
  assert.match(id, /^kp-[0-9a-f-]{36}$/)
  assert.ok(newKnowledgePreviewRequestId() !== id)
})

test("sentinel dispatch records the pending request id", () => {
  const s = withPendingPreview()
  assert.equal(s.knowledgePreviewPendingId, "kp-req-1")
  assert.equal(s.knowledgePreview?.preview, "正在解析…")
})

test("#270 error frame with matching id routes to preview failure", () => {
  const s0 = withPendingPreview()
  const s = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW",
    replyId: "kp-req-1",
    preview: { preview: "预览失败：文件解析失败: boom" },
  })
  assert.equal(s.knowledgePreview?.preview, "预览失败：文件解析失败: boom")
  // payload/title survive the merge so 确认导入 keeps its gating data
  assert.equal(s.knowledgePreview?.title, "notes")
  assert.equal(s.knowledgePreview?.payload.file?.name, "notes.docx")
})

test("#270 a matched reply consumes the pending id; a duplicate frame is ignored", () => {
  const s0 = withPendingPreview()
  const s1 = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW",
    replyId: "kp-req-1",
    preview: { preview: "parsed body", description: "d" },
  })
  assert.equal(s1.knowledgePreviewPendingId, null)
  const s2 = agentReducer(s1, {
    type: "SET_KNOWLEDGE_PREVIEW",
    replyId: "kp-req-1",
    preview: { preview: "duplicate overwrite attempt" },
  })
  assert.equal(s2, s1)
})

test("#270 error frame with a different id is ignored", () => {
  const s0 = withPendingPreview()
  const s = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW",
    replyId: "kp-other",
    preview: { preview: "预览失败：unrelated" },
  })
  assert.equal(s, s0)
  assert.equal(s.knowledgePreview?.preview, "正在解析…")
})

test("#270 extended fallback regex catches companion's Chinese parse errors", () => {
  assert.equal(knowledgePreviewErrorText({ error: "文件解析失败: officeparser blew up" }), "文件解析失败: officeparser blew up")
  assert.equal(knowledgePreviewErrorText({ error: 'Office 文件被拒绝：条目 "x" 含路径穿越序列（zip-slip）' }), 'Office 文件被拒绝：条目 "x" 含路径穿越序列（zip-slip）')
  assert.equal(knowledgePreviewErrorText({ error: "不支持的文件类型: application/x-bin (a.bin)" }), "不支持的文件类型: application/x-bin (a.bin)")
  // old patterns still match
  assert.ok(knowledgePreviewErrorText({ error: "Failed to fetch knowledge: 404" }))
  // unrelated id-less errors still do not route to the modal
  assert.equal(knowledgePreviewErrorText({ error: "thread not found" }), null)
  assert.equal(knowledgePreviewErrorText({}), null)
})

test("#270 id-ful error frames pass through unconditionally (store correlates)", () => {
  assert.equal(knowledgePreviewErrorText({ id: "kp-1", error: "anything" }), "anything")
  assert.equal(knowledgePreviewErrorText({ id: "kp-1" }), null)
})

test("#270 background send failure maps to failure text; ok passes", () => {
  assert.equal(
    knowledgePreviewSendFailureText({ ok: false, error: "Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接" }),
    "Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接",
  )
  assert.equal(knowledgePreviewSendFailureText({ ok: false }), "发送失败")
  assert.equal(knowledgePreviewSendFailureText({ ok: true }), null)
  assert.equal(knowledgePreviewSendFailureText(undefined), null)
})

test("#270 send-failure dispatch applies while the request is pending", () => {
  const s0 = withPendingPreview()
  const resp = { ok: false, error: "Companion 未连接" }
  const failure = knowledgePreviewSendFailureText(resp)
  assert.ok(failure)
  const s = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW",
    replyId: "kp-req-1",
    preview: { preview: `预览失败：${failure}` },
  })
  assert.equal(s.knowledgePreview?.preview, "预览失败：Companion 未连接")
})

test("#271 skip blanks the loading sentinel, keeps title/payload, drops pending id", () => {
  const s0 = withPendingPreview()
  const s = agentReducer(s0, { type: "SKIP_KNOWLEDGE_PREVIEW_PARSE" })
  assert.equal(s.knowledgePreview?.preview, "")
  assert.equal(s.knowledgePreview?.title, "notes")
  assert.equal(s.knowledgePreview?.payload.file?.name, "notes.docx")
  assert.equal(s.knowledgePreviewPendingId, null)
})

test("#271 after skip, a late reply can neither revive nor overwrite", () => {
  const s0 = agentReducer(withPendingPreview(), { type: "SKIP_KNOWLEDGE_PREVIEW_PARSE" })
  const s = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW",
    replyId: "kp-req-1",
    preview: { title: "服务器标题", preview: "server body" },
  })
  assert.equal(s, s0)
  assert.equal(s.knowledgePreview?.preview, "")
})

test("#271 cancel clears pending so a late reply does not revive the modal", () => {
  const s0 = agentReducer(withPendingPreview(), { type: "CLEAR_KNOWLEDGE_PREVIEW" })
  assert.equal(s0.knowledgePreview, null)
  assert.equal(s0.knowledgePreviewPendingId, null)
  const s = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW",
    replyId: "kp-req-1",
    preview: { title: "迟到", preview: "late body" },
  })
  assert.equal(s, s0)
  assert.equal(s.knowledgePreview, null)
})

test("id-less dispatches still apply (local sentinels, older companion)", () => {
  const s0 = withPendingPreview()
  const s = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW",
    preview: { preview: "预览失败：Failed to fetch knowledge: 404" },
  })
  assert.equal(s.knowledgePreview?.preview, "预览失败：Failed to fetch knowledge: 404")
})

test("SKIP on empty preview is a no-op", () => {
  const s = agentReducer(initialState, { type: "SKIP_KNOWLEDGE_PREVIEW_PARSE" })
  assert.equal(s, initialState)
})
