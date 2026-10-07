import test from "node:test"
import assert from "node:assert/strict"
import { redactAssistantToolCallsForPersistence, archiveToolPayload } from "../src/security/tool-persistence-redact"
import { rebuildMessagesFromHistory } from "../src/llm/adapter"
import { wrapUntrusted } from "../src/llm/text-sanitize"

test("real archived ACP parameters never become callable examples or assistant prose", () => {
  const raw = JSON.stringify({ agent_id: "kimi", goal: "review the changes" })
  const calls = redactAssistantToolCallsForPersistence([{ id: "proposal", type: "function", function: { name: "acp_propose_session", arguments: raw } }], { persistFull: false })
  const stored = archiveToolPayload("acp_propose_session", JSON.parse(raw), { success: false, error: "confirmation timed out" }, false)
  const history = [{ id: "a", role: "assistant", content: "Creating a review", tool_calls: calls },
    { role: "tool", tool_calls: [{ id: "proposal", tool_name: "acp_propose_session", result: stored.result }] }]
  const rebuilt = rebuildMessagesFromHistory(history)
  assert.equal(rebuilt.some(m => m.role === "assistant" && m.tool_calls?.length), false)
  assert.equal(rebuilt.some(m => m.role === "tool"), false, "no orphan API tool results")
  assert.equal(rebuilt[0].content, "Creating a review", "assistant prose contains only the original response")
  assert.ok(rebuilt[1].role === "user", "historical diagnostics use a data-only context row")
  assert.match(String(rebuilt[1].content), /confirmation timed out/, "keep diagnostic history")
  assert.match(String(rebuilt[1].content), /untrusted/)
  assert.doesNotMatch(JSON.stringify(rebuilt), /sha256|omission|参数未保存|占位符不是调用参数/)
  assert.ok(!JSON.stringify(rebuilt).includes('"agent_id":"kimi"'), "do not invent unavailable arguments")
  const live = { assistantToolCalls: new Map([["a", [{ id: "proposal", name: "acp_propose_session", arguments: raw }]]]) }
  const restored = rebuildMessagesFromHistory(history, live)
  assert.ok(restored[0].role === "assistant")
  assert.equal(restored[0].tool_calls?.[0].function.arguments, raw)
  assert.equal(restored[1].role, "tool", "live calls retain real arguments and pairing")
})

test("mixed archived/live calls preserve API pairing and archived diagnostics", () => {
  const archived = redactAssistantToolCallsForPersistence([{ id: "old", type: "function", function: {
    name: "acp_propose_session", arguments: '{"agent_id":"kimi","goal":"review"}',
  } }], { persistFull: false })
  const history = [{ id: "mixed", role: "assistant", tool_calls: [...archived,
    { id: "real", function: { name: "acp_list_agents", arguments: "{}" } }] },
    { role: "tool", tool_calls: [{ id: "old", tool_name: "acp_propose_session", result: { success: false, error: "timeout" } },
      { id: "real", tool_name: "acp_list_agents", result: { success: true, data: { agents: [{ id: "kimi" }] } } }] }]
  const rebuilt = rebuildMessagesFromHistory(history)
  assert.ok(rebuilt[0].role === "assistant")
  assert.deepEqual(rebuilt[0].tool_calls?.map(tc => tc.id), ["real"])
  assert.equal(rebuilt[0].content, null)
  assert.ok(rebuilt[1].role === "tool")
  assert.equal(rebuilt[1].tool_call_id, "real")
  assert.equal(rebuilt.length, 3)
  assert.ok(rebuilt[2].role === "user", "no diagnostic row interleaved before pending tool responses")
  assert.match(String(rebuilt[2].content), /timeout/)
})

test("successful archive fingerprints and a previously echoed internal note are omitted from model history", () => {
  const raw = "{}"
  const calls = redactAssistantToolCallsForPersistence([{ id: "list", type: "function", function: {
    name: "acp_list_agents", arguments: raw,
  } }], { persistFull: false })
  const stored = archiveToolPayload("acp_list_agents", {}, { success: true, data: { agents: [{ id: "kimi" }] } }, false)
  const echoed = "先确认可用 agent：\n[历史工具调用参数未保存：acp_list_agents。占位符不是调用参数；重试须按当前工具定义重新提供完整参数。]\n"
    + wrapUntrusted(JSON.stringify(stored.result), "list", "acp_list_agents")
  const history = [{ role: "assistant", content: "先确认可用 agent：", tool_calls: calls },
    { role: "tool", tool_calls: [{ id: "list", tool_name: "acp_list_agents", result: stored.result }] },
    { role: "assistant", content: echoed },
    { role: "user", content: "用 Kimi 创建新的编程接力" }]
  const rebuilt = rebuildMessagesFromHistory(history)
  assert.doesNotMatch(JSON.stringify(rebuilt), /redacted|sha256|omission|参数未保存|untrusted/)
  assert.equal(rebuilt.at(-1)?.content, "用 Kimi 创建新的编程接力")
  assert.equal(rebuilt.filter(m => m.role === "assistant").length, 2)
})
