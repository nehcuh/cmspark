import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  isKnowledgeGraphTabUrl,
  KNOWLEDGE_GRAPH_PATH,
  KNOWLEDGE_GRAPH_SNAPSHOT_KEY,
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

test("SW bulk-forward 含 knowledge.graph；open/open_doc 有独立 case", () => {
  const bg = readFileSync(join(process.cwd(), "src/background/index.ts"), "utf8")
  const slice = bg.slice(
    bg.indexOf('case "knowledge.list"'),
    bg.indexOf('case "thread_graph.prepare"'),
  )
  assert.ok(slice.includes('case "knowledge.graph"'), "knowledge.graph 走 bulk-forward")
  assert.ok(bg.includes('case "knowledge_graph.open"'), "打开 tab 独立 case")
  assert.ok(bg.includes('case "knowledge_graph.open_doc"'), "点击节点打开文档")
  assert.ok(bg.includes('case "knowledge_graph.refresh"'), "rebuilding 自动刷新")
})
