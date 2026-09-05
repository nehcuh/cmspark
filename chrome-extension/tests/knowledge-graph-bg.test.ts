import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  isKnowledgeGraphTabUrl,
  KNOWLEDGE_GRAPH_PATH,
  KNOWLEDGE_GRAPH_SNAPSHOT_KEY,
  knowledgeGraphErrorPayload,
  knowledgeGraphUrl,
} from "../src/background/knowledge-graph"

test("KNOWLEDGE_GRAPH_PATH is plasmo tab html", () => {
  assert.equal(KNOWLEDGE_GRAPH_PATH, "tabs/knowledge-graph.html")
})

test("knowledgeGraphUrl 镜像 thread-graph：runtime URL + 可选 focus", () => {
  const orig = globalThis.chrome
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` },
  }
  try {
    assert.equal(knowledgeGraphUrl(), "chrome-extension://abc/tabs/knowledge-graph.html")
    assert.equal(
      knowledgeGraphUrl("doc-1"),
      "chrome-extension://abc/tabs/knowledge-graph.html?focus=doc-1",
    )
  } finally {
    if (orig) (globalThis as { chrome?: unknown }).chrome = orig
    else delete (globalThis as { chrome?: unknown }).chrome
  }
})

test("isKnowledgeGraphTabUrl matches graph tab", () => {
  const base = "chrome-extension://abc/tabs/knowledge-graph.html"
  assert.equal(isKnowledgeGraphTabUrl(base, base), true)
  assert.equal(isKnowledgeGraphTabUrl(base + "?focus=x", base), true)
  assert.equal(isKnowledgeGraphTabUrl("chrome-extension://abc/tabs/thread-graph.html", base), false)
})

test("snapshot key 独立于会话关系图，不复用 thread snapshot", () => {
  assert.equal(KNOWLEDGE_GRAPH_SNAPSHOT_KEY, "cmspark.knowledge_graph_snapshot")
  assert.ok(!KNOWLEDGE_GRAPH_SNAPSHOT_KEY.includes("thread_graph"))
})

test("SW open/open_doc/refresh 有独立 case；knowledge.graph 不走 bulk-forward（无生产者）", () => {
  const bg = readFileSync(join(process.cwd(), "src/background/index.ts"), "utf8")
  const slice = bg.slice(
    bg.indexOf('case "knowledge.list"'),
    bg.indexOf('case "thread_graph.prepare"'),
  )
  assert.ok(!slice.includes('case "knowledge.graph"'), "knowledge.graph bulk-forward 是死分支（复审 NIT-4），不得回归")
  assert.ok(bg.includes('case "knowledge_graph.open"'), "打开 tab 独立 case")
  assert.ok(bg.includes('case "knowledge_graph.open_doc"'), "点击节点打开文档")
  assert.ok(bg.includes('case "knowledge_graph.refresh"'), "rebuilding 自动刷新")
  // MAJOR-1 契约钉：帧构建走 buildKnowledgeGraphRequest（regen_labels 权威在服务端）
  assert.ok(bg.includes("buildKnowledgeGraphRequest({"), "frame 由共享 helper 构建")
})

// --- #356: knowledge.graph error 帧 → error 态快照（不再无限「重建中」） ---

test("#356: knowledgeGraphErrorPayload — 动词文本命中才映射，其他 error 帧不误伤", () => {
  // panel-only 门拒（message-router 原文）
  const rejected = knowledgeGraphErrorPayload({
    type: "error",
    error: "knowledge.graph is panel-only (Side Panel knowledge panel)",
  })
  assert.ok(rejected)
  assert.equal(rejected!.status, "error")
  assert.equal(rejected!.error, "knowledge.graph is panel-only (Side Panel knowledge panel)")
  assert.deepEqual(rejected!.nodes, [])
  assert.deepEqual(rejected!.edges, [])
  // handler throw（family=knowledge 但文本带不动词时不动；带动词才映射）
  const thrown = knowledgeGraphErrorPayload({
    type: "error",
    error: "knowledge.graph handler failed: boom",
    family: "knowledge",
  })
  assert.ok(thrown && thrown.status === "error")
  // 其他 knowledge.* error（knowledge.get 等）不得把图谱 tab 打成 error
  assert.equal(
    knowledgeGraphErrorPayload({ type: "error", error: "Thread not found: t1" }),
    null,
  )
  assert.equal(
    knowledgeGraphErrorPayload({ type: "error", error: "Unhandled knowledge type: knowledge.get" }),
    null,
  )
  // 非 error 帧 / 缺 error 文本
  assert.equal(knowledgeGraphErrorPayload({ type: "knowledge.graph", status: "rebuilding" }), null)
  assert.equal(knowledgeGraphErrorPayload({ type: "error" }), null)
  assert.equal(knowledgeGraphErrorPayload(null), null)
})

test("#356: SW 把 knowledge.graph error 帧写成 error 态快照", () => {
  const bg = readFileSync(join(process.cwd(), "src/background/index.ts"), "utf8")
  assert.ok(bg.includes("knowledgeGraphErrorPayload(msg)"), "handleCompanionMessage 调用映射")
  const slice = bg.slice(bg.indexOf('if (msg.type === "knowledge.graph")'), bg.indexOf('if (msg.type === "knowledge.graph")') + 700)
  assert.ok(slice.includes("knowledgeGraphErrorPayload"), "映射紧跟 knowledge.graph 快照分支")
  assert.ok(slice.includes("writeKnowledgeGraphSnapshot(graphError"), "error 快照落 session storage")
})
