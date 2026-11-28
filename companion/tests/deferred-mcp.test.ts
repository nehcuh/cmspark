import test from "node:test"
import assert from "node:assert/strict"
import { activeMcpSchemas, mcpSearchTool, SEARCH_MCP, searchMcpCatalog, supportsMcpSearch } from "../src/llm/deferred-mcp"
import { streamOpenAIResponses } from "../src/llm/providers/openai-responses"
import { buildAnthropicRequestBody } from "../src/llm/providers/anthropic-convert"
import type { CanonicalChatMessage, CanonicalToolDefinition } from "../src/llm/provider"
import { wrapUntrusted } from "../src/llm/text-sanitize"

function tool(name: string): CanonicalToolDefinition {
  return { type: "function", function: { name, description: "Read a test value", parameters: { type: "object", properties: {} } } }
}
const clock = tool("mcp__test__clock"), other = tool("mcp__test__thermometer"), builtin = tool("get_page_text")
const tools = [builtin, clock, other, mcpSearchTool]
const result = searchMcpCatalog(tools, clock.function.name)
const opening: CanonicalChatMessage[] = [{ role: "user", content: "Check the clock" }]
const history: CanonicalChatMessage[] = [...opening,
  { role: "assistant", tool_calls: [{ id: "search-1", type: "function", function: { name: SEARCH_MCP, arguments: JSON.stringify({ query: clock.function.name }) } }] },
  { role: "tool", tool_call_id: "search-1", name: SEARCH_MCP, content: wrapUntrusted(JSON.stringify(result), "search-1", SEARCH_MCP) },
]

test("MCP discovery is restricted to the documented direct model, and searches the supplied catalog", () => {
  assert.equal(supportsMcpSearch("openai", "https://api.deepseek.com/v1", "deepseek-flash"), true)
  assert.equal(supportsMcpSearch("anthropic", "https://api.deepseek.com/anthropic", "deepseek-flash"), true)
  for (const [endpoint, model] of [["https://relay.invalid/v1", "deepseek-flash"], ["https://api.deepseek.com/v1", "deepseek-v4-pro"]]) {
    assert.equal(supportsMcpSearch("openai", endpoint, model), false)
  }
  assert.equal(result.data!.tools[0], clock.function.name)
  assert.deepEqual(searchMcpCatalog([builtin], "get_page_text").data!.tools, [])
  assert.equal(searchMcpCatalog(tools, {}).success, false)
})

test("Responses loads schemas at the matched search output, keeping the opening prompt stable", async () => {
  const requests: any[] = []
  const client = { responses: { async *create(body: object) {
    requests.push(body)
    yield { type: "response.reasoning_text.delta", delta: "Finding tools" }
    const regularCall = { type: "function_call", call_id: "ordinary-1", name: builtin.function.name, arguments: "{}" }
    yield { type: "response.output_item.added", output_index: 1, item: regularCall }
    yield { type: "response.completed", response: { status: "completed", usage: { input_tokens: 384, output_tokens: 7, total_tokens: 391, input_tokens_details: { cached_tokens: 256 } },
      output: [{ type: "tool_search_call", execution: "client", call_id: "search-1", arguments: { query: "clock" } }, regularCall] } }
  } } }
  for (const [messages, catalog] of [[opening, tools], [history, tools], [history, [builtin, mcpSearchTool]]] as const) {
    const events = []
    for await (const ev of streamOpenAIResponses(client as any, "deepseek-flash", "none", { messages, tools: [...catalog], temperature: 0 })) events.push(ev)
    assert.ok(events.some(ev => ev.type === "reasoning" && ev.text === "Finding tools"))
    assert.ok(events.some(ev => ev.type === "tool_call_delta" && ev.id === "search-1" && ev.index === 0))
    assert.ok(events.some(ev => ev.type === "tool_call_delta" && ev.id === "ordinary-1" && ev.index === 1))
    assert.ok(events.some(ev => ev.type === "usage" && ev.cached_input_tokens === 256))
  }
  assert.deepEqual(activeMcpSchemas(opening, tools), [builtin, mcpSearchTool])
  assert.deepEqual(activeMcpSchemas(history, tools), [builtin, clock, mcpSearchTool])
  assert.deepEqual(requests[0].tools.map((t: any) => t.type), ["function", "tool_search"])
  assert.equal(requests[0].temperature, 0)
  assert.deepEqual(requests[0].tools, requests[1].tools)
  assert.deepEqual(requests[1].input.slice(0, 1), requests[0].input)
  assert.equal(requests[1].input[1].type, "tool_search_call")
  assert.equal(requests[1].input[2].tools[0].name, clock.function.name)
  assert.deepEqual(requests[2].input[2].tools, [])
})

test("Messages only produces references for paired local search results still in the catalog", () => {
  const body = (messages: CanonicalChatMessage[], catalog = tools) =>
    buildAnthropicRequestBody({ model: "deepseek-flash", contextWindow: 65536, messages, tools: [...catalog] })
  assert.deepEqual(body(opening).tools!.filter(t => t.defer_loading).map(t => t.name), [clock.function.name, other.function.name])
  const blocks = body(history).messages.at(-1)!.content as any[]
  assert.deepEqual(blocks[0].content[0], { type: "tool_reference", tool_name: clock.function.name })
  const revoked = body(history, [builtin, mcpSearchTool]).messages.at(-1)!.content as any[]
  assert.equal(revoked[0].content, "No matching MCP tools are available.")
  const disabled = body(history, [builtin]).messages.at(-1)!.content as any[]
  assert.equal(disabled[0].content, revoked[0].content)
  const unrelated = [...history]
  unrelated[1] = { role: "assistant", tool_calls: [{ type: "function", id: "search-1", function: { name: builtin.function.name, arguments: "{}" } }] }
  const output = body(unrelated).messages.at(-1)!.content as any[]
  assert.equal(typeof output[0].content, "string")
})

test("chatCreate discovers only the selected MCP server and executes the returned tool through its usual dispatcher", async t => {
  const { initDataDir } = await import("../src/config")
  const { getMcpManager } = await import("../src/mcp")
  const { ThreadManager } = await import("../src/threads/thread-manager")
  const { SkillEngine } = await import("../src/skills/skill-engine")
  const { HistoryStore } = await import("../src/history/store")
  const { chatCreate } = await import("../src/llm/adapter")
  const dns = await import("node:dns")
  await initDataDir()
  const tm = new ThreadManager(), thread = tm.create("owned tool search")
  tm.update(thread.id, { mcp_selection_mode: "manual", active_mcp_server_ids: ["fixture"] })
  const engine = new SkillEngine()
  engine.bindThreadManager(tm)
  const manager = getMcpManager()
  let liveClock = clock
  t.mock.method(manager, "getAggregatedToolsForServers", (ids: Set<string>) => ids.has("fixture") ? [liveClock] : [])
  t.mock.method(dns.promises, "lookup", async () => [{ address: "8.8.8.8", family: 4 }])
  const requests: any[] = []
  const executed: string[] = []
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    requests.push(body)
    const round = requests.length
    if (round === 1) liveClock = { ...clock, function: { ...clock.function,
      parameters: { type: "object", properties: { zone: { type: "string" } }, required: ["zone"] } } }
    if (round === 3) tm.update(thread.id, { execution_policy: "plan_readonly" })
    const name = round === 1 ? SEARCH_MCP : clock.function.name
    const frames = round <= 2 ? [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", name, id: "fixture-"+round } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: round === 1 ? '{"query":"clock"}' : '{"zone":"UTC"}' } },
    ] : round === 3 ? [{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "checking" } }]
      : [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "fixture success" } }]
    const messages = [...frames, { type: "message_delta", delta: { stop_reason: round <= 2 ? "tool_use" : round === 3 ? "max_tokens" : "end_turn" } }]
    return new Response(messages.map(f => "data: "+JSON.stringify(f)+"\n\n").join(""))
  })
  const run = () => chatCreate({ threadId: thread.id, message: "read the test clock", config: { protocol: "anthropic",
    base_url: "https://api.deepseek.com/anthropic", model_name: "deepseek-flash", api_key: "fixture", temperature: 0, context_window: 65536 },
    skillIds: [], knowledgeIds: [], threadManager: tm, skillEngine: engine, historyStore: new HistoryStore(),
    executeTool: async (_id, name) => { executed.push(name); return { success: true, data: { value: 7231 } } }, sendToExtension() {} })
  await run()
  assert.equal(requests.length, 4)
  assert.deepEqual(executed, [clock.function.name])
  assert.equal(requests[0].tools.find((t: any) => t.name === clock.function.name).defer_loading, true)
  const searchResult = requests[1].messages.at(-1).content.find((b: any) => b.type === "tool_result")
  assert.deepEqual(searchResult.content, [{ type: "tool_reference", tool_name: clock.function.name }])
  assert.deepEqual(requests[1].tools.find((t: any) => t.name === clock.function.name).input_schema.required, ["zone"])
  assert.ok(requests[2].tools.some((t: any) => t.name === clock.function.name))
  assert.ok(!requests[3].tools.some((t: any) => t.name === clock.function.name))
  await run()
  assert.ok(!requests[4].tools.some((t: any) => [SEARCH_MCP, clock.function.name].includes(t.name)))
})
