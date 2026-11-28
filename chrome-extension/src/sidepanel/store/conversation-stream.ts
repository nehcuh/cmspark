import type { AgentState } from "./agentStore"
import { addTranscriptMessage } from "./transcript"
import type { Message } from "../types"

/** Stream updates require an explicit owner matching the receiving view. */
export function shouldApplyStreamEvent(
  threadId: string | undefined | null,
  selectedThreadId: string | undefined | null,
): boolean {
  return !!threadId && threadId === selectedThreadId
}

/** The inspect drawer shows the most recent portion of the worker's answer. */
export function inspectTailSlice(content: unknown, max = 800): string {
  if (typeof content !== "string") return ""
  return content.length > max ? content.slice(-max) : content
}

export type ThreadStreamEvent =
  | { type: "chat.token"; content: string }
  | { type: "chat.reasoning"; content: string; retrying: boolean }
  | { type: "chat.done"; message: Omit<Message, "content"> & { content?: string }; roundLimit: boolean }
  | { type: "chat.assistant"; message: Message }
  | { type: "tool.start"; fallback: Message; tool: Message; browser: boolean }
  | { type: "chat.aborted"; message: Message; clearBusy: boolean }
  | { type: "chat.error"; message: Message | null; standby: string | null }
  | { type: "file.upload_status"; label: string }
  | { type: "file.uploaded" }
  | { type: "file.upload_error" | "error"; message: Message }

export function withoutRunTerminal(state: AgentState, threadId: string): AgentState {
  if (!threadId || !state.runTerminalByThreadId[threadId]) return state
  const { [threadId]: _dropped, ...rest } = state.runTerminalByThreadId
  return { ...state, runTerminalByThreadId: rest }
}

export function setThreadBusy(state: AgentState, threadId: string, busy: boolean): AgentState {
  if (!threadId) return state
  if (busy) {
    const base = withoutRunTerminal(state, threadId)
    if (base.threadBusyById[threadId]) return base
    return { ...base, threadBusyById: { ...base.threadBusyById, [threadId]: true } }
  }
  if (!state.threadBusyById[threadId]) return state
  const { [threadId]: _dropped, ...rest } = state.threadBusyById
  return { ...state, threadBusyById: rest }
}

function append(state: AgentState, message: Message): AgentState {
  const messages = addTranscriptMessage(state.messages, message)
  return messages === state.messages ? state : { ...state, messages }
}

function finish(state: AgentState): AgentState {
  return { ...state, streamingContent: "", streamingReasoning: "", processingStatus: null, isProcessing: false }
}

// A final or intermediate commit consumes only the selected transcript's accumulated stream.
function commit(state: AgentState, message: Omit<Message, "content"> & { content?: string }, done: boolean): AgentState {
  const content = done ? message.content ?? state.streamingContent : message.content || state.streamingContent
  const reasoning = message.reasoning_content || state.streamingReasoning
  const next = done ? finish(state) : { ...state, streamingContent: "", streamingReasoning: "" }
  if (!content && !reasoning && !(done && (message.truncated || message.generation_limit ||
      message.incomplete_tools || message.finish_reason !== undefined || message.retrieved_sources?.length))) return next
  return append(next, { ...message, content, ...(reasoning ? { reasoning_content: reasoning } : {}) })
}

export function reduceThreadStream(state: AgentState, threadId: string, event: ThreadStreamEvent): AgentState {
  const selected = shouldApplyStreamEvent(threadId, state.activeThreadId)
  // Older upload replies and unclassified errors belong to the selection at dispatch time.
  // Ownerless chat terminal frames historically update only its busy/limit marker.
  const legacyOwner = threadId || state.activeThreadId || ""
  switch (event.type) {
    case "chat.token": {
      let next = setThreadBusy(state, threadId, true)
      if (shouldApplyStreamEvent(threadId, next.inspectedWorkerId)) {
        const tail = inspectTailSlice(event.content)
        if (tail !== next.inspectTokenTail) next = { ...next, inspectTokenTail: tail }
      }
      return selected ? { ...next, streamingContent: event.content, processingStatus: null } : next
    }
    case "chat.reasoning": {
      const next = setThreadBusy(state, threadId, true)
      return selected ? { ...next, streamingReasoning: event.content, isProcessing: true,
        processingStatus: event.retrying ? "模型尚未给出答案，正在重试…" : null } : next
    }
    case "chat.done": {
      let next = setThreadBusy(state, legacyOwner, false)
      if (event.roundLimit && legacyOwner && next.runTerminalByThreadId[legacyOwner] !== "round_limit") {
        next = { ...next, runTerminalByThreadId: { ...next.runTerminalByThreadId, [legacyOwner]: "round_limit" } }
      }
      return selected ? commit(next, event.message, true) : next
    }
    case "chat.assistant": {
      const next = setThreadBusy(state, legacyOwner, true)
      return selected ? commit(next, event.message, false) : next
    }
    case "tool.start": {
      let next = setThreadBusy(state, threadId, true)
      const name = event.tool.tool_calls?.[0]?.tool_name
      if (shouldApplyStreamEvent(threadId, next.inspectedWorkerId) && name && name !== next.inspectLatestTool) {
        next = { ...next, inspectLatestTool: name }
      }
      if (!selected) return next
      if (next.streamingContent || next.streamingReasoning) next = commit(next, event.fallback, false)
      next = append(next, event.tool)
      return event.browser ? { ...next, lastBrowserToolAt: Date.parse(event.tool.created_at) } : next
    }
    case "chat.aborted": {
      const next = event.clearBusy ? setThreadBusy(state, legacyOwner, false) : state
      return selected ? append(finish(next), event.message) : next
    }
    case "chat.error": {
      const next = setThreadBusy(state, legacyOwner, false)
      if (!selected) return next
      const stopped = { ...finish(next), overlayStandby: event.standby ? { label: event.standby } : null }
      return event.message ? append(stopped, event.message) : stopped
    }
    case "file.upload_status": {
      if (threadId && !selected) return state
      return { ...setThreadBusy(state, legacyOwner, true), isProcessing: true, processingStatus: event.label }
    }
    case "file.uploaded":
    case "file.upload_error": {
      let next = setThreadBusy(state, legacyOwner, false)
      const pending = next.pendingUploads[legacyOwner]
      if (pending) {
        const { [legacyOwner]: _acknowledged, ...pendingUploads } = next.pendingUploads
        next = { ...next, pendingUploads }
      }
      if (event.type === "file.uploaded") {
        next = { ...next, composerUploadClearSeq: next.composerUploadClearSeq + 1 }
        if (!shouldApplyStreamEvent(legacyOwner, next.activeThreadId)) return next
        return { ...next, processingStatus: null,
          isProcessing: !!(next.streamingContent || next.streamingReasoning) && next.isProcessing }
      }
      if (!legacyOwner || legacyOwner !== next.activeThreadId) {
        const cached = next.messagesByThreadId[legacyOwner]
        if (!pending || !cached?.some(row => row.id === pending.messageId)) return next
        return { ...next, messagesByThreadId: { ...next.messagesByThreadId,
          [legacyOwner]: cached.filter(row => row.id !== pending.messageId) } }
      }
      if (pending) {
        next = { ...next, messages: next.messages.filter(row => row.id !== pending.messageId) }
        if (pending.composerText) next = { ...next, composerRestore: {
          text: pending.composerText, token: (next.composerRestore?.token ?? 0) + 1,
        } }
      }
      return append(finish(next), { ...event.message, thread_id: legacyOwner })
    }
    case "error": {
      let next = setThreadBusy(state, legacyOwner, false)
      if (next.summarizingThreadId && (!threadId || threadId === next.summarizingThreadId)) {
        next = { ...next, summarizingThreadId: null }
      }
      if (threadId && !selected) return next
      return append(finish(next), { ...event.message, thread_id: legacyOwner })
    }
  }
}
