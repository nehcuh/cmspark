import test from "node:test"
import assert from "node:assert/strict"
import { validateWsMessage } from "../src/ws/validate"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"
import { SUMMONER_WEB_DISPATCH_ALLOW } from "../src/summoner-web"
import { handleKnowledgeCrud } from "../src/message-router/handlers/knowledge"

test("validate: knowledge.get requires id", () => {
  assert.equal(validateWsMessage({ type: "knowledge.get" }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.get", id: "abc" }).valid, true)
})

test("validate: knowledge.update/export/delete require id and user_gesture", () => {
  for (const type of ["knowledge.update", "knowledge.export", "knowledge.delete"] as const) {
    assert.equal(validateWsMessage({ type, id: "abc" }).valid, false, type)
    assert.equal(validateWsMessage({ type, id: "abc", user_gesture: true }).valid, true, type)
    assert.equal(validateWsMessage({ type, name: "abc", user_gesture: true }).valid, false, `${type} name-only`)
  }
})

test("validate: knowledge.import_directory does not require path; requires user_gesture", () => {
  assert.equal(validateWsMessage({ type: "knowledge.import_directory", path: "/tmp" }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.import_directory", user_gesture: true }).valid, true)
})

test("summoner ACL denies knowledge.get/update/export", () => {
  for (const t of ["knowledge.get", "knowledge.update", "knowledge.export"]) {
    assert.equal(assertSummonerAllowed("summoner", t).ok, false, t)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has(t), false, t)
  }
  assert.equal(assertSummonerAllowed("summoner", "knowledge.list").ok, true)
})

function mockEngine(opts: {
  truncated: boolean
  onUpdate?: (id: string, patch: { body?: string; title?: string }) => { id: string; title: string }
}) {
  let updateCalls = 0
  let lastPatch: { body?: string; title?: string } | undefined
  const se = {
    getKnowledge: (id: string) => ({
      id,
      name: id,
      title: "t",
      description: "d",
      type: "domain_knowledge",
      builtin: false,
      body: opts.truncated ? "x".repeat(512 * 1024) : "hello",
      char_count: opts.truncated ? 512 * 1024 + 50 : 5,
      truncated: opts.truncated,
      related: [],
    }),
    updateKnowledge: (id: string, patch: { body?: string; title?: string }) => {
      updateCalls += 1
      lastPatch = patch
      return opts.onUpdate ? opts.onUpdate(id, patch) : { id, title: patch.title || "t" }
    },
    updateCalls: () => updateCalls,
    lastPatch: () => lastPatch,
  }
  return se
}

test("B1 handler: truncated get rejects body update and does not write", () => {
  const se = mockEngine({ truncated: true })
  const res = handleKnowledgeCrud(
    "knowledge.update",
    { id: "k1", user_gesture: true, body: "x".repeat(512 * 1024) },
    se as never,
    "panel",
  )
  assert.ok(res)
  assert.equal(res.type, "error")
  assert.match(String(res.error), /截断/)
  assert.equal(String(res.error).includes("无法下载"), false)
  assert.equal(se.updateCalls(), 0)
})

test("B1 handler: untruncated short body update proceeds", () => {
  const se = mockEngine({ truncated: false })
  const res = handleKnowledgeCrud(
    "knowledge.update",
    { id: "k1", user_gesture: true, body: "hi" },
    se as never,
    "panel",
  )
  assert.ok(res)
  assert.equal(res.type, "knowledge.updated")
  assert.equal(se.updateCalls(), 1)
  assert.equal(se.lastPatch()?.body, "hi")
})

test("B1 handler: truncated title-only update proceeds without body", () => {
  const se = mockEngine({ truncated: true })
  const res = handleKnowledgeCrud(
    "knowledge.update",
    { id: "k1", user_gesture: true, title: "revised" },
    se as never,
    "panel",
  )
  assert.ok(res)
  assert.equal(res.type, "knowledge.updated")
  assert.equal(se.updateCalls(), 1)
  assert.equal(se.lastPatch()?.body, undefined)
  assert.equal(se.lastPatch()?.title, "revised")
})
