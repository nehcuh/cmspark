import test from "node:test"
import assert from "node:assert/strict"
import { filterKnowledgeNodes, fitKnowledgeCamera, shortKnowledgeTitle } from "../src/knowledge-graph/explorer"
import { parseKnowledgeGraphPayload } from "../src/knowledge-graph/wire"

test("knowledge search intersects group and preserves original graph data", () => {
  const nodes = [
    { id: "one", title: "发布流程", folder: "DevOps", group_key: "c:release" },
    { id: "two", title: "运行手册", folder: "DevOps", group_key: "" },
  ]
  assert.deepEqual(filterKnowledgeNodes(nodes, " devops ", "c:release"), [nodes[0]])
  assert.deepEqual(filterKnowledgeNodes(nodes, "", "u:ungrouped"), [nodes[1]])
  assert.deepEqual(filterKnowledgeNodes(nodes, "不存在", ""), [])
  assert.equal(nodes.length, 2)
  assert.deepEqual(filterKnowledgeNodes([], "", ""), [])
})

test("camera fits sparse extremes on narrow and wide canvases without an artificial minimum zoom", () => {
  const nodes = [{ x: -1200, y: -700, r: 8 }, { x: 2400, y: 1800, r: 10 }]
  for (const [w, h] of [[320, 280], [1000, 800]]) {
    const camera = fitKnowledgeCamera(nodes, w, h)
    for (const n of nodes) {
      assert.ok((n.x - n.r) * camera.scale + camera.x >= 0)
      assert.ok((n.x + n.r) * camera.scale + camera.x <= w)
      assert.ok((n.y - n.r) * camera.scale + camera.y >= 0)
      assert.ok((n.y + n.r) * camera.scale + camera.y <= h)
    }
  }
  assert.deepEqual(fitKnowledgeCamera([], 320, 280), { scale: 1, x: 0, y: 0 })
  const one = fitKnowledgeCamera([{ x: 800, y: 600, r: 5 }], 320, 280)
  assert.equal(800 * one.scale + one.x, 160)
  assert.equal(600 * one.scale + one.y, 140)
})

test("canvas titles truncate whole Unicode code points and fall back to document identity", () => {
  assert.equal(shortKnowledgeTitle(" 😀知识流程 ", "id", 3), "😀知识…")
  assert.equal(shortKnowledgeTitle("", "knowledge-id"), "knowledge-id")
  assert.equal(shortKnowledgeTitle("发布流程", "id"), "发布流程")
})

test("job state is optional for old servers and false survives parsing", () => {
  const payload = { status: "ok", nodes: [], edges: [], labels: {}, truncated: false }
  assert.equal(parseKnowledgeGraphPayload(payload)?.organizing, undefined)
  assert.equal(parseKnowledgeGraphPayload({ ...payload, organizing: true })?.organizing, true)
  assert.equal(parseKnowledgeGraphPayload({ ...payload, organizing: false })?.organizing, false)
  assert.equal(parseKnowledgeGraphPayload({ ...payload, organizing: "false" })?.organizing, undefined)
})
