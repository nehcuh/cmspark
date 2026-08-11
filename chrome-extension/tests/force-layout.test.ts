import test from "node:test"
import assert from "node:assert/strict"
import {
  forceLayoutTick,
  runForceLayout,
  seedLayoutNodes,
} from "../src/thread-graph/force-layout"

test("seedLayoutNodes: ring positions finite and distinct", () => {
  const nodes = seedLayoutNodes(["a", "b", "c"], 400, 300)
  assert.equal(nodes.length, 3)
  for (const n of nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y))
  }
  assert.notStrictEqual(nodes[0].x, nodes[1].x)
})

test("runForceLayout: energy finite and nodes stay in bounds", () => {
  const nodes = seedLayoutNodes(["a", "b", "c", "d"], 500, 400)
  const edges = [
    { a: "a", b: "b", score: 0.5 },
    { b: "c", a: "b", score: 0.3 },
  ]
  const e = runForceLayout(nodes, edges, { width: 500, height: 400 }, 80)
  assert.ok(Number.isFinite(e))
  assert.ok(e >= 0)
  for (const n of nodes) {
    assert.ok(n.x >= 0 && n.x <= 500)
    assert.ok(n.y >= 0 && n.y <= 400)
    assert.ok(Number.isFinite(n.vx) && Number.isFinite(n.vy))
  }
})

test("forceLayoutTick: pinned node does not move", () => {
  const nodes = seedLayoutNodes(["a", "b"], 400, 400)
  nodes[0].pinned = true
  const x0 = nodes[0].x
  const y0 = nodes[0].y
  for (let i = 0; i < 30; i++) {
    forceLayoutTick(nodes, [{ a: "a", b: "b", score: 1 }], {
      width: 400,
      height: 400,
    })
  }
  assert.equal(nodes[0].x, x0)
  assert.equal(nodes[0].y, y0)
})
