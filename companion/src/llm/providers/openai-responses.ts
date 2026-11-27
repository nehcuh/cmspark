import type OpenAI from "openai"
import type { Response, ResponseInput, ResponseReasoningItem, ResponseOutputMessage, ResponseFunctionToolCall, ResponseCreateParamsStreaming } from "openai/resources/responses/responses"
import type { CanonicalChatMessage, CanonicalStreamEvent, StreamChatParams } from "../provider"
import { loadedMcpTools, SEARCH_MCP } from "../deferred-mcp"
import type { CanonicalToolDefinition } from "../provider"
import type { ReasoningEffort } from "../reasoning-effort"

export const liveResponseItems = Symbol("liveResponseItems")
type ToolSearchCall = { type: "tool_search_call"; call_id: string; execution: "client"; arguments: { query?: string } }
export type LiveResponseItem = ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | ToolSearchCall

function functionTool({ function: fn }: CanonicalToolDefinition) {
  return { type: "function" as const, name: fn.name, description: fn.description, parameters: fn.parameters, strict: false }
}

function searchArguments(raw: string): { query?: string } {
  try { const parsed = JSON.parse(raw); return typeof parsed?.query === "string" ? { query: parsed.query } : {} }
  catch { return {} }
}

function responsesInput(messages: CanonicalChatMessage[], catalog?: CanonicalToolDefinition[]): ResponseInput {
  // The installed SDK predates tool_search. Construct the documented wire
  // shapes here and keep them separate from ordinary function_call outputs.
  const input: Array<ResponseInput[number] | ToolSearchCall | {
    type: "tool_search_output"; call_id: string; tools: ReturnType<typeof functionTool>[]
  }> = []
  const searches = new Set<string>()
  for (const msg of messages) {
    if (msg.role === "tool") {
      if (catalog && searches.delete(msg.tool_call_id)) {
        input.push({ type: "tool_search_output", call_id: msg.tool_call_id, tools: loadedMcpTools(msg.content, catalog).map(functionTool) })
      } else input.push({ type: "function_call_output", call_id: msg.tool_call_id, output: msg.content })
    } else if (msg.role === "assistant") {
      searches.clear()
      for (const call of msg.tool_calls ?? []) if (catalog && call.function.name === SEARCH_MCP) searches.add(call.id)
      const live = msg[liveResponseItems]
      if (live) { input.push(...live); continue }
      if (msg.content) input.push({ role: "assistant", content: msg.content })
      for (const call of msg.tool_calls ?? []) {
        if (searches.has(call.id)) input.push({ type: "tool_search_call", call_id: call.id, execution: "client", arguments: searchArguments(call.function.arguments) })
        else input.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments })
      }
    } else if (typeof msg.content === "string") {
      input.push({ role: msg.role, content: msg.content })
    } else {
      input.push({ role: "user", content: msg.content.map(part => part.type === "text"
        ? { type: "input_text", text: part.text } : { type: "input_image", image_url: part.image_url.url, detail: "auto" }) })
    }
  }
  return input as ResponseInput
}

/** GPT-6 tool use requires Responses. Preserve the ordered opaque items for the next tool step only. */
export async function* streamOpenAIResponses(client: OpenAI, model: string, effort: ReasoningEffort | undefined,
  params: StreamChatParams): AsyncGenerator<CanonicalStreamEvent> {
  const search = params.tools?.find(t => t.function.name === SEARCH_MCP)
  const regular = params.tools?.filter(t => !search || (t !== search && !t.function.name.startsWith("mcp__"))).map(functionTool)
  const wireTools = search ? [...regular ?? [], { type: "tool_search", execution: "client", description: search.function.description, parameters: search.function.parameters }] : regular
  const body: ResponseCreateParamsStreaming = {
    model, input: responsesInput(params.messages, search ? params.tools : undefined), stream: true, store: false, include: ["reasoning.encrypted_content"],
    tools: wireTools as ResponseCreateParamsStreaming["tools"],
    ...(params.max_tokens ? { max_output_tokens: params.max_tokens } : {}),
  }
  // The installed SDK predates xhigh and max. The model catalog validates the wire value.
  if (effort) Object.assign(body, { reasoning: { effort } })
  const stream = await client.responses.create(body, { signal: params.signal })
  const calls = new Map<number, { index: number; args: string }>()
  let response: Response | undefined
  let visibleText = false
  for await (const event of stream) {
    if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
      visibleText ||= !!event.delta
      yield { type: "token", text: event.delta }
    } else if (event.type === "response.reasoning_summary_text.delta") {
      yield { type: "reasoning", text: event.delta }
    } else if (event.type === "response.output_item.added" && event.item.type === "function_call") {
      const index = calls.size
      calls.set(event.output_index, { index, args: "" })
      yield { type: "tool_call_delta", index, id: event.item.call_id, name: event.item.name }
    } else if (event.type === "response.function_call_arguments.delta") {
      const call = calls.get(event.output_index)
      if (call) {
        call.args += event.delta
        yield { type: "tool_call_delta", index: call.index, arguments: event.delta }
      }
    } else if (event.type === "response.completed" || event.type === "response.incomplete") {
      response = event.response
      break
    } else if (event.type === "error" || event.type === "response.failed") {
      throw new Error(event.type === "error" ? event.message : event.response.error?.message ?? "Responses request failed")
    }
  }
  if (!response) throw new Error("Responses stream closed before completion")
  if (response.usage) {
    const u = response.usage
    yield { type: "usage", prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens,
      cached_input_tokens: u.input_tokens_details?.cached_tokens,
      total_tokens: u.total_tokens, reasoning_tokens: u.output_tokens_details?.reasoning_tokens }
  }
  const output = response.output as Array<Response["output"][number] | ToolSearchCall>
  const items: LiveResponseItem[] = []
  for (const item of output) {
    if (item.type === "tool_search_call" && search) {
      items.push({ type: item.type, call_id: item.call_id, execution: "client", arguments: item.arguments })
    } else if (item.type === "reasoning" || item.type === "message" || item.type === "function_call") items.push(item)
  }
  for (const [position, item] of output.entries()) {
    if (search && item.type === "tool_search_call") {
      const index = calls.size, args = JSON.stringify(item.arguments)
      calls.set(position, { index, args })
      yield { type: "tool_call_delta", index, id: item.call_id, name: SEARCH_MCP, arguments: args }
      continue
    }
    if (item.type !== "function_call") continue
    const call = calls.get(position)
    if (!call) {
      const index = calls.size
      calls.set(position, { index, args: item.arguments })
      yield { type: "tool_call_delta", index, id: item.call_id, name: item.name, arguments: item.arguments }
    } else if (item.arguments !== call.args) {
      if (!item.arguments.startsWith(call.args)) throw new Error("Responses tool arguments changed after streaming")
      yield { type: "tool_call_delta", index: call.index, arguments: item.arguments.slice(call.args.length) }
    }
  }
  if (!visibleText) for (const item of items) {
    if (item.type === "message") for (const part of item.content) {
      yield { type: "token", text: part.type === "output_text" ? part.text : part.refusal }
    }
  }
  if (response.status === "incomplete") {
    if (response.incomplete_details?.reason !== "max_output_tokens") throw new Error("Responses generation stopped before completion")
    yield { type: "done", finish_reason: "max_output_tokens" }
  } else {
    yield { type: "done", finish_reason: calls.size ? "tool_calls" : "stop", ...(calls.size ? { responseItems: items } : {}) }
  }
}
