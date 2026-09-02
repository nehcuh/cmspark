// #272 — knowledge AI draft extract, extension side (store-level, no WS mock).
// Spec: docs/superpowers/specs/2026-09-02-knowledge-ai-draft-extract-design.md
//
// Covers: source-tags prefill (AC-1 后半, the setTags("") gap), the extract-id
// lifecycle (extract_pending arms knowledgePreviewExtractId), user-dirty fill
// (AC-7), 跳过解读 (preview_cancel + heuristic draft stays), late-frame guard
// (复用 #271 pendingId 语义), and the reader-side knowledge.suggest state.

import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState, type AgentState } from "../src/sidepanel/store/agentStore"
import {
  fillKnowledgeDraftFromSuggestion,
  formatKnowledgeTagsInput,
  sanitizeKnowledgeSuggestion,
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
      payload: { file: { name: "notes.md", content: "QUJD" } },
    },
  })
}

function withParsedPreview(extractPending = true): AgentState {
  return agentReducer(withPendingPreview(), {
    type: "SET_KNOWLEDGE_PREVIEW",
    replyId: "kp-req-1",
    preview: {
      title: "竞品调研",
      description: "启发式说明",
      preview: "正文…",
      char_count: 100,
      tags: ["竞品", "news"],
      extract_pending: extractPending,
    },
  })
}

test("AC-1 后半: Phase-1 reply carries source frontmatter tags for the modal prefill", () => {
  const s = withParsedPreview()
  assert.deepEqual(s.knowledgePreview?.tags, ["竞品", "news"])
  // The modal prefill is formatKnowledgeTagsInput — was unconditional setTags("")
  assert.equal(formatKnowledgeTagsInput(s.knowledgePreview?.tags), "竞品, news")
  assert.equal(formatKnowledgeTagsInput(undefined), "")
  assert.equal(formatKnowledgeTagsInput("bogus"), "")
})

test("extract_pending arms the extract id; pending id is still consumed (#271)", () => {
  const s = withParsedPreview(true)
  assert.equal(s.knowledgePreviewPendingId, null)
  assert.equal(s.knowledgePreviewExtractId, "kp-req-1")
  assert.equal(s.knowledgePreview?.extractPending, true)
})

test("Phase-1 reply without extract_pending leaves the extract id unarmed", () => {
  const s = withParsedPreview(false)
  assert.equal(s.knowledgePreviewExtractId, null)
  assert.ok(!s.knowledgePreview?.extractPending)
})

test("a new preview request resets suggestion state from the previous attempt", () => {
  const s0 = withParsedPreview(true)
  const s1 = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW_SUGGESTED",
    replyId: "kp-req-1",
    suggested: { description: "AI 说明", tags: ["ai"], source: "llm" },
  })
  assert.equal(s1.knowledgePreview?.suggested?.description, "AI 说明")
  const s2 = agentReducer(s1, {
    type: "SET_KNOWLEDGE_PREVIEW",
    pendingId: "kp-req-2",
    preview: { title: "next", preview: "正在解析…", payload: { content: "x" } },
  })
  assert.equal(s2.knowledgePreview?.suggested, undefined)
  assert.equal(s2.knowledgePreview?.tags, undefined)
  assert.equal(s2.knowledgePreview?.extractPending, undefined)
  assert.equal(s2.knowledgePreviewExtractId, null)
})

test("AC-7: user-dirty fields are never overwritten by the suggestion", () => {
  const cur = { description: "用户手改的说明", tags: "" }
  const out = fillKnowledgeDraftFromSuggestion(cur, { description: true }, {
    description: "LLM 说明",
    tags: ["竞品"],
    source: "llm",
  })
  assert.equal(out.description, "用户手改的说明", "dirty description survives")
  assert.equal(out.tags, "竞品", "clean tags get filled")
  // All dirty → nothing changes
  const allDirty = fillKnowledgeDraftFromSuggestion(cur, { description: true, tags: true }, {
    description: "LLM 说明",
    tags: ["竞品"],
    source: "llm",
  })
  assert.deepEqual(allDirty, cur)
  // No suggestion → identity
  assert.deepEqual(fillKnowledgeDraftFromSuggestion(cur, {}, null), cur)
})

test("Phase-2 suggested frame applies while the extract id matches, then disarms", () => {
  const s0 = withParsedPreview(true)
  const s = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW_SUGGESTED",
    replyId: "kp-req-1",
    suggested: { description: "AI 说明", tags: ["竞品"], source: "llm" },
  })
  assert.equal(s.knowledgePreview?.suggested?.source, "llm")
  assert.equal(s.knowledgePreview?.extractPending, false)
  assert.equal(s.knowledgePreviewExtractId, null)
  // duplicate frame is ignored
  const dup = agentReducer(s, {
    type: "SET_KNOWLEDGE_PREVIEW_SUGGESTED",
    replyId: "kp-req-1",
    suggested: { description: "覆盖尝试", source: "llm" },
  })
  assert.equal(dup, s)
})

test("late-frame guard: suggested id mismatch is ignored (复用 #271 语义)", () => {
  const s0 = withParsedPreview(true)
  const s = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW_SUGGESTED",
    replyId: "kp-other",
    suggested: { description: "迟到", source: "llm" },
  })
  assert.equal(s, s0)
  assert.equal(s.knowledgePreview?.suggested, undefined)
  assert.equal(s.knowledgePreview?.extractPending, true)
})

test("extract_error frame clears pending without a suggestion (不悬挂)", () => {
  const s0 = withParsedPreview(true)
  const s = agentReducer(s0, {
    type: "SET_KNOWLEDGE_PREVIEW_SUGGESTED",
    replyId: "kp-req-1",
    extractError: "extract timeout",
  })
  assert.equal(s.knowledgePreview?.extractPending, false)
  assert.equal(s.knowledgePreview?.extractError, "extract timeout")
  assert.equal(s.knowledgePreview?.suggested, undefined)
  assert.equal(s.knowledgePreviewExtractId, null)
})

test("跳过解读: clears extract state, keeps the heuristic draft; late suggested ignored", () => {
  const s0 = withParsedPreview(true)
  const s1 = agentReducer(s0, { type: "SKIP_KNOWLEDGE_PREVIEW_EXTRACT" })
  assert.equal(s1.knowledgePreview?.extractPending, false)
  assert.equal(s1.knowledgePreviewExtractId, null)
  // 启发式草稿与源文件 tags 保留
  assert.equal(s1.knowledgePreview?.description, "启发式说明")
  assert.deepEqual(s1.knowledgePreview?.tags, ["竞品", "news"])
  const s2 = agentReducer(s1, {
    type: "SET_KNOWLEDGE_PREVIEW_SUGGESTED",
    replyId: "kp-req-1",
    suggested: { description: "迟到的 AI 说明", source: "llm" },
  })
  assert.equal(s2, s1)
})

test("CLEAR / parse-skip also drop the extract id", () => {
  const s0 = withParsedPreview(true)
  const cleared = agentReducer(s0, { type: "CLEAR_KNOWLEDGE_PREVIEW" })
  assert.equal(cleared.knowledgePreviewExtractId, null)
  const skipped = agentReducer(withParsedPreview(true), { type: "SKIP_KNOWLEDGE_PREVIEW_PARSE" })
  assert.equal(skipped.knowledgePreviewExtractId, null)
  assert.equal(skipped.knowledgePreview?.extractPending, false)
})

test("sanitizeKnowledgeSuggestion: only well-shaped llm/heuristic payloads pass", () => {
  assert.deepEqual(sanitizeKnowledgeSuggestion({ description: "d", tags: ["a"], source: "llm" }), {
    description: "d",
    tags: ["a"],
    source: "llm",
  })
  assert.equal(sanitizeKnowledgeSuggestion({ description: "d", source: "heuristic-ish" }), null)
  assert.equal(sanitizeKnowledgeSuggestion({ source: "llm" }), null, "empty suggestion is dropped")
  assert.equal(sanitizeKnowledgeSuggestion({ description: 42, source: "llm" }), null)
  assert.equal(sanitizeKnowledgeSuggestion(null), null)
  assert.deepEqual(sanitizeKnowledgeSuggestion({ tags: ["a", "", 7], source: "llm" }), { tags: ["a"], source: "llm" })
})

test("M3: sanitizeKnowledgeSuggestion drops secret-shaped tags client-side (defense in depth)", () => {
  // Mirrors companion's SENSITIVE_TAG_RE — even if a compromised/buggy
  // companion pushed secret-shaped tags, the UI never shows them.
  assert.deepEqual(sanitizeKnowledgeSuggestion({ tags: ["sk-abc", "竞品", "api_key-x"], source: "llm" }), {
    tags: ["竞品"],
    source: "llm",
  })
  // A suggestion whose tags are ALL secret-shaped degrades to no-tags.
  assert.equal(sanitizeKnowledgeSuggestion({ tags: ["sk-only"], source: "llm" }), null)
})

// --- Reader-side knowledge.suggest ---

test("knowledge.suggest: pending → ok applies; wrong docId ignored; viewer switch clears", () => {
  const s0 = agentReducer(initialState, { type: "SET_KNOWLEDGE_SUGGEST", docId: "k1", status: "pending" })
  assert.equal(s0.knowledgeSuggest?.status, "pending")
  // late/stray terminal frame for another doc is ignored
  const wrong = agentReducer(s0, { type: "SET_KNOWLEDGE_SUGGEST", docId: "k2", status: "error", error: "x" })
  assert.equal(wrong, s0)
  const ok = agentReducer(s0, {
    type: "SET_KNOWLEDGE_SUGGEST",
    docId: "k1",
    status: "ok",
    suggested: { description: "AI 说明", tags: ["竞品"], source: "llm" },
  })
  assert.equal(ok.knowledgeSuggest?.status, "ok")
  assert.equal(ok.knowledgeSuggest?.suggested?.description, "AI 说明")
  // closing the viewer drops suggest state
  const closed = agentReducer(ok, { type: "SET_KNOWLEDGE_VIEWER", doc: null })
  assert.equal(closed.knowledgeSuggest, null)
})

test("knowledge.suggest: error terminal carries extract_error text", () => {
  const s0 = agentReducer(initialState, { type: "SET_KNOWLEDGE_SUGGEST", docId: "k1", status: "pending" })
  const s = agentReducer(s0, { type: "SET_KNOWLEDGE_SUGGEST", docId: "k1", status: "error", error: "companion_llm_not_configured" })
  assert.equal(s.knowledgeSuggest?.status, "error")
  assert.equal(s.knowledgeSuggest?.error, "companion_llm_not_configured")
  // terminal state is not re-applied without a new pending
  const again = agentReducer(s, { type: "SET_KNOWLEDGE_SUGGEST", docId: "k1", status: "ok", suggested: { description: "x", source: "llm" } })
  assert.equal(again, s)
})
