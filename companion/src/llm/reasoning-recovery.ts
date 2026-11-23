import type { LlmConfig } from "../config"
import { isBenignStreamTailClose } from "./transport-error"
import { classifyGenerationLimit, isContextOverflowError } from "./overflow"
import type { CanonicalChatMessage, CanonicalStreamEvent, LlmProvider, StreamChatParams } from "./provider"
import { effortLevels, modelSpec, reasoningWireEffort } from "./reasoning-effort"

/** Only stop sustained, verbatim loops. Long or slow thinking alone is valid. */
export function repeatedReasoningTail(tail: string): boolean {
  if (tail.length < 4096) return false
  const end = tail.length
  const marker = tail.slice(-64)
  const previous = tail.lastIndexOf(marker, end - 65)
  if (previous < 0) return false
  const period = end - 64 - previous
  const span = Math.max(4096, period * 4)
  if (span > end) return false
  return tail.slice(end - span, end - period) === tail.slice(end - span + period)
}

const recoveryInstruction = "Give a concise answer to the current request within the existing output limit. Keep deliberation brief. Use a tool only if still needed."

function recoveryMessages(messages: CanonicalChatMessage[]): CanonicalChatMessage[] {
  const index = messages.findIndex(message => message.role === "system")
  if (index < 0) return [{ role: "system", content: recoveryInstruction }, ...messages]
  return messages.map((message, i) => i === index && message.role === "system"
    ? { ...message, content: message.content + "\n\n" + recoveryInstruction } : message)
}

export class ReasoningRecoveryError extends Error {}

type RecoveryEvent = { type: "reasoning_reset"; cause: "loop" | "limit" | "empty" | "transport"; effort?: string; chars: number; completionTokens?: number; reasoningTokens?: number }

/** Retry only this provider step. No tools are executed or history written here. */
export async function* streamChatWithRecovery(provider: LlmProvider, params: StreamChatParams, config: LlmConfig):
  AsyncGenerator<CanonicalStreamEvent | RecoveryEvent> {
  const spec = modelSpec(config.protocol, config.base_url, params.model ?? config.model_name)
  const support = spec?.support ?? "unsupported"
  const levels = effortLevels[support]
  const current = reasoningWireEffort(support, config.reasoning_effort)
  const index = levels.findIndex(level => level === current)
  const lower = levels[Math.max(0, index - 1)]
  for (let attempt = 0; attempt < 2; attempt++) {
    params.signal?.throwIfAborted()
    const stop = new AbortController()
    const signal = params.signal ? AbortSignal.any([params.signal, stop.signal]) : stop.signal
    let hasAnswerOrTool = false
    let sawReasoning = false
    let chars = 0
    let tail = ""
    let nextCheck = 8192
    let completionTokens: number | undefined
    let reasoningTokens: number | undefined
    let cause: RecoveryEvent["cause"] | undefined
    try {
      for await (const event of provider.streamChat({
        ...params, signal, ...(attempt ? { messages: recoveryMessages(params.messages), reasoning_effort: lower } : {}),
      })) {
        if ((event.type === "token" && event.text.trim()) || event.type === "tool_call_delta") hasAnswerOrTool = true
        if (event.type === "reasoning" && !hasAnswerOrTool) {
          sawReasoning ||= event.text.length > 0
          chars = (event.replace ? 0 : chars) + event.text.length
          tail = ((event.replace ? "" : tail) + event.text).slice(-8192)
          if (event.replace) nextCheck = 8192
          if (chars >= nextCheck) {
            nextCheck = chars + 512
            if (repeatedReasoningTail(tail)) {
              cause = "loop"
              stop.abort()
              break
            }
          }
        } else if (event.type === "usage") {
          completionTokens = event.completion_tokens ?? completionTokens
          reasoningTokens = event.reasoning_tokens ?? reasoningTokens
          sawReasoning ||= (reasoningTokens ?? 0) > 0
        } else if (event.type === "done" && !hasAnswerOrTool) {
          const limit = classifyGenerationLimit(event.finish_reason, {
            officialOpenAI: spec?.provider === "OpenAI", sentTokens: params.max_tokens, completionTokens,
          })
          if (limit === "context_window" && (sawReasoning || attempt > 0)) {
            throw new ReasoningRecoveryError("已到模型上下文上限，本轮未生成正文或工具调用。")
          }
          const emptyEnd = event.finish_reason == null || event.finish_reason === "stop" || event.finish_reason === "end_turn"
          if (emptyEnd && (attempt > 0 || sawReasoning)) {
            cause = "empty"
            break
          }
          if (limit === "output_budget" || (limit === "length" && sawReasoning)) {
            cause = "limit"
            break
          }
        }
        yield event
      }
    } catch (error) {
      if (params.signal?.aborted || (error instanceof Error && error.name === "AbortError") || hasAnswerOrTool || !sawReasoning) throw error
      const code = (error as { code?: unknown } | null)?.code
      if (classifyGenerationLimit(code) === "context_window" || isContextOverflowError(error instanceof Error ? error.message : String(error))) {
        throw new ReasoningRecoveryError("已到模型上下文上限，本轮未生成正文或工具调用。")
      }
      if (!isBenignStreamTailClose(error)) throw error
      cause = "transport"
    } finally {
      // Also closes a live HTTP stream when the outer consumer stops early.
      stop.abort()
    }
    params.signal?.throwIfAborted()
    if (!cause) return
    if (attempt) throw new ReasoningRecoveryError(cause === "loop"
      ? "重试后模型仍在重复思考，已停止本轮生成。"
      : cause === "transport" ? "模型在重试时再次中断，已停止本轮生成。"
      : cause === "empty" ? "重试后模型仍只返回了思考过程，已停止本轮生成。"
      : "重试后模型仍未在单次输出上限内给出正文或工具调用，已停止本轮生成。")
    yield { type: "reasoning_reset", cause, effort: lower, chars, completionTokens, reasoningTokens }
  }
}
