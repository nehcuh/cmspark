import type OpenAI from "openai"
import type { Response, ResponseInput, ResponseReasoningItem, ResponseOutputMessage, ResponseFunctionToolCall, ResponseCreateParamsStreaming } from "openai/resources/responses/responses"
import type { CanonicalChatMessage, CanonicalStreamEvent, StreamChatParams } from "../provider"
import type { ReasoningEffort } from "../reasoning-effort"

export const liveResponseItems = Symbol("liveResponseItems")
export type LiveResponseItem = ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall

function responsesInput(messages: CanonicalChatMessage[]): ResponseInput {
  const input: ResponseInput = []
  for (const msg of messages) {
    if (msg.role === "tool") {
      input.push({ type: "function_call_output", call_id: msg.tool_call_id, output: msg.content })
    } else if (msg.role === "assistant") {
      const live = msg[liveResponseItems]
      if (live) { input.push(...live); continue }
      if (msg.content) input.push({ role: "assistant", content: msg.content })
      for (const call of msg.tool_calls ?? []) {
        input.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments })
      }
    } else if (typeof msg.content === "string") {
      input.push({ role: msg.role, content: msg.content })
    } else {
      input.push({ role: "user", content: msg.content.map(part => part.type === "text"
        ? { type: "input_text", text: part.text } : { type: "input_image", image_url: part.image_url.url, detail: "auto" }) })
    }
  }
  return input
}

/** GPT-6 tool use requires Responses. Preserve the ordered opaque items for the next tool step only. */
export async function* streamOpenAIResponses(client: OpenAI, model: string, effort: ReasoningEffort | undefined,
  params: StreamChatParams): AsyncGenerator<CanonicalStreamEvent> {
  const body: ResponseCreateParamsStreaming = {
    model, input: responsesInput(params.messages), stream: true, store: false, include: ["reasoning.encrypted_content"],
    tools: params.tools?.map(({ function: fn }) => ({ type: "function", name: fn.name, description: fn.description, parameters: fn.parameters, strict: false })),
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
  const items = response.output.filter((item): item is LiveResponseItem =>
    item.type === "reasoning" || item.type === "message" || item.type === "function_call")
  for (const [position, item] of response.output.entries()) {
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
