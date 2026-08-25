import test from "node:test"
import assert from "node:assert/strict"
import { findRelatedKnowledge } from "../src/skills/knowledge-related"

test("findRelatedKnowledge returns at most 3 co-tag hits", () => {
  const docs = [
    { id: "a", title: "SSO 指南", tags: ["sso", "login"], description: "okta" },
    { id: "b", title: "登录排障", tags: ["sso"], description: "okta 超时" },
    { id: "c", title: "无关笔记", tags: ["hr"], description: "vacation" },
    { id: "d", title: "Okta runbook", tags: ["sso", "okta"], description: "login" },
    { id: "e", title: "另一登录", tags: ["sso", "login"], description: "mfa" },
  ]
  const hits = findRelatedKnowledge("a", docs, 3)
  assert.ok(hits.length <= 3)
  assert.ok(hits.every((h) => h.id !== "a"))
  assert.ok(hits.some((h) => h.id === "b" || h.id === "d" || h.id === "e"))
  assert.ok(!hits.some((h) => h.id === "c"))
})

test("findRelatedKnowledge hard-caps at 3 even when limit is huge", () => {
  const docs = [{ id: "seed", title: "sso", tags: ["sso"] }]
  for (let i = 0; i < 8; i++) {
    docs.push({ id: `x${i}`, title: `sso ${i}`, tags: ["sso"] })
  }
  const hits = findRelatedKnowledge("seed", docs, 99)
  assert.equal(hits.length, 3)
})

test("findRelatedKnowledge empty seed", () => {
  assert.deepEqual(findRelatedKnowledge("missing", [{ id: "a", title: "x" }]), [])
})

test("findRelatedKnowledge resolves legacy name when id differs", () => {
  const docs = [
    { id: "uuid-a", name: "legacy-sso", title: "SSO", tags: ["sso"] },
    { id: "uuid-b", name: "legacy-login", title: "登录", tags: ["sso"] },
  ]
  const hits = findRelatedKnowledge("legacy-sso", docs, 3)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, "uuid-b")
})
