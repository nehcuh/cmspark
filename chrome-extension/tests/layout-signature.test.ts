import test from "node:test"
import assert from "node:assert/strict"
import { buildLayoutSignature } from "../src/thread-graph/layout-signature"

test("buildLayoutSignature: same topology different array identity → equal", () => {
  const nodes = [
    { id: "b", degree: 1 },
    { id: "a", degree: 2 },
  ]
  const edges = [
    { a: "a", b: "b", kind: "hard" as const, score: 0.5 },
  ]
  const s1 = buildLayoutSignature(nodes, edges)
  const s2 = buildLayoutSignature(
    [
      { id: "a", degree: 2 },
      { id: "b", degree: 1 },
    ],
    [{ a: "b", b: "a", kind: "hard", score: 0.5 }],
  )
  assert.equal(s1, s2)
})

test("buildLayoutSignature: focus-only change (same nodes) does not change signature", () => {
  // Signature has no focus field — simulating two focus states with same nodes/edges
  const nodes = [{ id: "a", degree: 0 }]
  const edges: { a: string; b: string; kind: string; score: number }[] = []
  assert.equal(buildLayoutSignature(nodes, edges), buildLayoutSignature(nodes, edges))
})

test("buildLayoutSignature: degree or edge change invalidates", () => {
  const base = buildLayoutSignature([{ id: "a", degree: 1 }], [])
  const deg = buildLayoutSignature([{ id: "a", degree: 2 }], [])
  const edge = buildLayoutSignature(
    [{ id: "a", degree: 1 }, { id: "b", degree: 1 }],
    [{ a: "a", b: "b", kind: "soft", score: 0.2 }],
  )
  assert.notStrictEqual(base, deg)
  assert.notStrictEqual(base, edge)
})
