import test from "node:test"
import assert from "node:assert/strict"
import { summonerThreadMetadata } from "../src/threads/metadata-patch"
import { applySummonerPayloadPolicy } from "../src/ws/summoner-acl"

test("HTTP and summoner WS share an exact metadata boundary", () => {
  const input = { alias: "  回顾\u0000  ", user_tags: ["Review", "review", "支付"], topic_folder: "收入/支付" }
  const expected = { alias: "回顾", user_tags: ["Review", "支付"], topic_folder: "收入支付" }
  assert.deepEqual(summonerThreadMetadata({ alias: "e\u0301" }), { alias: "é" })
  assert.deepEqual(summonerThreadMetadata(input), expected)
  const msg: Record<string, unknown> = { type: "thread.update", thread_id: "t1", updates: input }
  assert.deepEqual(applySummonerPayloadPolicy("summoner", msg), { ok: true })
  assert.deepEqual(msg.updates, expected)
  assert.deepEqual(summonerThreadMetadata({ user_tags: [], topic_folder: null }), { user_tags: [], topic_folder: null })
})

test("metadata cannot carry policy, project, path or model changes even with a valid alias", () => {
  for (const key of ["workspace_root", "project_id", "config_override", "tool_whitelist", "active_skill_ids", "execution_policy", "digest", "__proto__", "constructor"]) {
    const input = JSON.parse(JSON.stringify({ alias: "safe", [key]: "unsafe" }))
    assert.throws(() => summonerThreadMetadata(input))
    assert.equal(applySummonerPayloadPolicy("summoner", { type: "thread.update", updates: input }).ok, false)
  }
  for (const input of [null, [], {}, { alias: "\u0000" }, { user_tags: Array(21).fill("x") }, { topic_folder: {} }]) assert.throws(() => summonerThreadMetadata(input))
})
