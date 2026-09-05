import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  clearGraphRequests,
  graphRequestInFlight,
  isKnowledgeGraphTabUrl,
  KNOWLEDGE_GRAPH_PATH,
  KNOWLEDGE_GRAPH_SNAPSHOT_KEY,
  knowledgeGraphErrorById,
  knowledgeGraphErrorPayload,
  knowledgeGraphUrl,
  trackGraphRequest,
  untrackGraphRequest,
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
  // handler throw 文本是原始 message（几乎不含动词）——此处为合成 fixture，
  // 仅钉 seam 行为「文本带动词才映射」，不代表生产中会出现该串（复审 MAJOR-1）
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

// --- #374: error 帧按请求 id 精确关联（替代文本 seam 为主；文本 seam 仅兜底） ---

test("#374: 在途请求注册表 track/untrack/clear 基本语义", () => {
  const id = "kg.test.1"
  assert.equal(graphRequestInFlight(id), false)
  trackGraphRequest(id)
  assert.equal(graphRequestInFlight(id), true)
  untrackGraphRequest(id)
  assert.equal(graphRequestInFlight(id), false)
  trackGraphRequest("kg.a")
  trackGraphRequest("kg.b")
  clearGraphRequests()
  assert.equal(graphRequestInFlight("kg.a"), false)
  assert.equal(graphRequestInFlight("kg.b"), false)
  // 防御：undefined/null/空串不登记
  trackGraphRequest(undefined)
  trackGraphRequest(null)
  trackGraphRequest("")
  assert.equal(graphRequestInFlight(undefined), false)
  assert.equal(graphRequestInFlight(""), false)
})

test("#374: 在途 id 命中才映射（handler-throw 文本不含动词也能命中）；命中即注销", () => {
  const id = "kg.hit.1"
  // 未登记 → 不映射（任何 error 帧不因带任意 id 就误伤）
  assert.equal(knowledgeGraphErrorById({ type: "error", error: "boom", id }), null)
  trackGraphRequest(id)
  // 文本不含 "knowledge.graph" 动词——文本 seam 命中不到的路径（#374 主价值）
  const hit = knowledgeGraphErrorById({ type: "error", error: "boom", id })
  assert.ok(hit)
  assert.equal(hit!.status, "error")
  assert.equal(hit!.error, "boom")
  assert.equal(graphRequestInFlight(id), false, "一次响应后注销，防重复消费")
})

test("#374: 非 error 帧 / 缺 id / 未知 id 不命中；命中后未消费的其它请求不受影响", () => {
  trackGraphRequest("kg.other.1")
  // 非 error 帧
  assert.equal(knowledgeGraphErrorById({ type: "knowledge.graph", status: "rebuilding" }), null)
  // 缺 id
  assert.equal(knowledgeGraphErrorById({ type: "error", error: "boom" }), null)
  // error 但 id 不在注册表（如其它请求的错误帧）
  assert.equal(knowledgeGraphErrorById({ type: "error", error: "boom", id: "kg.unknown.9" }), null)
  // 未命中不注销
  assert.equal(graphRequestInFlight("kg.other.1"), true)
  clearGraphRequests()
})

test("#374: SW 接线——请求带 id 并登记、按 id 命中优先、断线清空", () => {
  const bg = readFileSync(join(process.cwd(), "src/background/index.ts"), "utf8")
  // 请求侧：builder 调用带 id 参数且登记在途
  assert.ok(bg.includes("trackGraphRequest(reqId)"), "发请求前登记在途 id")
  assert.ok(bg.includes("id: reqId"), "请求帧携带 id")
  assert.ok(bg.includes("untrackGraphRequest(reqId)"), "未发出时立即注销")
  // 响应侧：id 精确关联优先于文本兜底
  assert.ok(bg.includes("knowledgeGraphErrorById(msg) ?? knowledgeGraphErrorPayload(msg)"), "id 关联为主、文本 seam 兜底")
  // 成功帧与断线都注销/清空
  assert.ok(bg.includes("untrackGraphRequest(msg?.id)"), "成功 knowledge.graph 帧到达即注销")
  assert.ok(bg.includes("clearGraphRequests()"), "断线清空在途注册表")
})
