import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  KNOWLEDGE_TOO_BIG_DOWNLOAD_COPY,
  KNOWLEDGE_TRUNCATED_BODY_SAVE_COPY,
  buildKnowledgeUpdateMessage,
} from "../src/sidepanel/utils/knowledge-save"

test("B1: truncated save omits body; short save still sends body", () => {
  const truncated = buildKnowledgeUpdateMessage({
    id: "k1",
    truncated: true,
    title: "t",
    description: "d",
    tags: ["a"],
    body: "prefix-only",
  })
  assert.equal(truncated.type, "knowledge.update")
  assert.equal(truncated.user_gesture, true)
  assert.equal("body" in truncated, false)
  assert.equal(truncated.title, "t")
  assert.deepEqual(truncated.tags, ["a"])

  const short = buildKnowledgeUpdateMessage({
    id: "k2",
    truncated: false,
    title: "t2",
    description: "d2",
    tags: [],
    body: "hi",
  })
  assert.equal(short.body, "hi")
})

test("B1: save copy is not the download copy", () => {
  assert.match(KNOWLEDGE_TOO_BIG_DOWNLOAD_COPY, /无法下载/)
  assert.equal(KNOWLEDGE_TRUNCATED_BODY_SAVE_COPY.includes("无法下载"), false)
  assert.match(KNOWLEDGE_TRUNCATED_BODY_SAVE_COPY, /截断/)
})

test("B1: KnowledgeSubPanel uses helper and does not POST truncated body", () => {
  const src = readFileSync(
    join(process.cwd(), "src/sidepanel/components/KnowledgeSubPanel.tsx"),
    "utf8",
  )
  assert.match(src, /buildKnowledgeUpdateMessage\(\{/)
  assert.match(src, /truncated:\s*!!doc\.truncated/)
  assert.match(src, /KNOWLEDGE_TRUNCATED_BODY_SAVE_COPY/)
  assert.match(src, /KNOWLEDGE_TOO_BIG_DOWNLOAD_COPY/)
  assert.equal(src.includes("无法下载"), false, "download copy lives in the helper, not inlined as save error")
  assert.equal(src.includes('type: "knowledge.update"'), false)
})
