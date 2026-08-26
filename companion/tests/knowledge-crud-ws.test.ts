import test from "node:test"
import assert from "node:assert/strict"
import { validateWsMessage } from "../src/ws/validate"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"
import { SUMMONER_WEB_DISPATCH_ALLOW } from "../src/summoner-web"

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
