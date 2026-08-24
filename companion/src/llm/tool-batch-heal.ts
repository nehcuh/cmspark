// Heal unpaired assistant.tool_calls on disk so the next rebuild is schema-valid
// without stripping successful tools. Pure helpers + a duck-typed persist.

import { redactToolPayloadForPersistence } from "../security/tool-persistence-redact"

export const INTERRUPTED_ERROR_CODE = "INTERRUPTED"

export function createToolResultMessage(
  threadId: string,
  toolCall: any,
  result: { success?: boolean; data?: any; error?: string; error_code?: string },
  params: any = {},
) {
  const toolName = String(toolCall.function?.name || toolCall.name || "")
  const { params: safeParams, result: safeResult } = redactToolPayloadForPersistence(
    toolName,
    params,
    result,
  )
  return {
    thread_id: threadId,
    role: "tool" as const,
    content: JSON.stringify(safeResult),
    tool_calls: [{
      id: toolCall.id,
      tool_name: toolName,
      params: safeParams,
      result: safeResult,
    }],
  }
}

export type DiskToolCall = {
  id?: string
  tool_name?: string
  name?: string
  function?: { name?: string; arguments?: string }
  arguments?: string
  params?: Record<string, unknown>
  result?: { success?: boolean; error?: string; error_code?: string; [k: string]: unknown }
}

export type DiskMessage = {
  id?: string
  thread_id?: string
  role: string
  content?: string | null
  tool_calls?: DiskToolCall[]
}

export type MissingToolCall = {
  id: string
  toolName: string
  args: string
}

export function unpairedToolCallsFromAssistant(
  assistant: DiskMessage,
  following: DiskMessage[],
): MissingToolCall[] {
  const tcs = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : []
  const have = new Set<string>()
  for (const row of following) {
    if (row.role !== "tool") break
    for (const tc of row.tool_calls || []) {
      if (tc.id) have.add(tc.id)
    }
  }
  const missing: MissingToolCall[] = []
  for (const tc of tcs) {
    if (!tc.id || have.has(tc.id)) continue
    missing.push({
      id: tc.id,
      toolName: String(tc.function?.name || tc.tool_name || tc.name || ""),
      args: String(tc.function?.arguments || tc.arguments || "{}"),
    })
  }
  return missing
}

export function buildInterruptedDiskRow(
  threadId: string,
  missing: MissingToolCall,
  error = "interrupted",
): DiskMessage {
  const result = { success: false, error, error_code: INTERRUPTED_ERROR_CODE }
  return {
    thread_id: threadId,
    role: "tool",
    content: JSON.stringify(result),
    tool_calls: [
      {
        id: missing.id,
        tool_name: missing.toolName,
        params: {},
        result,
      },
    ],
  }
}

export function newestUnpairedAssistantIndex(messages: DiskMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant" || !(messages[i].tool_calls?.length)) continue
    if (unpairedToolCallsFromAssistant(messages[i], messages.slice(i + 1)).length > 0) return i
  }
  return -1
}

/** First index after the assistant and its contiguous following tool rows. */
export function toolBlockInsertIndex(messages: DiskMessage[], assistantIdx: number): number {
  let i = assistantIdx + 1
  while (i < messages.length && messages[i].role === "tool") i++
  return i
}

export function healNewestUnpairedAssistant(
  messages: DiskMessage[],
  opts?: { threadId?: string; error?: string; assistantId?: string },
): { messages: DiskMessage[]; healed: number } {
  const idx =
    opts?.assistantId
      ? messages.findIndex((m) => m.id === opts.assistantId)
      : newestUnpairedAssistantIndex(messages)
  if (idx < 0) return { messages: [...messages], healed: 0 }
  if (messages[idx].role !== "assistant") return { messages: [...messages], healed: 0 }
  const missing = unpairedToolCallsFromAssistant(messages[idx], messages.slice(idx + 1))
  if (missing.length === 0) return { messages: [...messages], healed: 0 }
  const threadId = opts?.threadId || ""
  const extra = missing.map((m) => buildInterruptedDiskRow(threadId, m, opts?.error))
  const insertAt = toolBlockInsertIndex(messages, idx)
  return {
    messages: [...messages.slice(0, insertAt), ...extra, ...messages.slice(insertAt)],
    healed: extra.length,
  }
}

type ThreadTape = {
  getMessages: (threadId: string) => DiskMessage[]
  insertMessageAt: (threadId: string, index: number, message: any) => unknown
}

/** Persist interrupted rows immediately after the unpaired assistant's tool block. */
export function persistHealedToolRows(
  tm: ThreadTape,
  threadId: string,
  error?: string,
  assistantId?: string,
  onPersisted?: (
    missing: MissingToolCall,
    result: { success: false; error: string; error_code: string },
  ) => void,
): number {
  const history = tm.getMessages(threadId) as DiskMessage[]
  const idx = assistantId
    ? history.findIndex((m) => m.id === assistantId)
    : newestUnpairedAssistantIndex(history)
  if (idx < 0 || history[idx].role !== "assistant") return 0
  const missing = unpairedToolCallsFromAssistant(history[idx], history.slice(idx + 1))
  if (missing.length === 0) return 0
  const assistantIdResolved = history[idx].id
  let persisted = 0
  for (const m of missing) {
    // Re-read before EVERY insert: insertMessageAt cap-trim can shift indexes (so a
    // cached insertAt+1 could land after a later user), and under supersede the old
    // run's real tool result may have landed after `missing` was computed above.
    const now = tm.getMessages(threadId) as DiskMessage[]
    const asstNow = assistantIdResolved
      ? now.findIndex((row) => row.id === assistantIdResolved)
      : newestUnpairedAssistantIndex(now)
    if (asstNow < 0) {
      // The healed assistant itself was cap-trimmed between inserts. Remaining
      // fillers would land at EOF with no assistant to pair against (permanent
      // orphan — rebuild skips unpaired tool rows), so stop healing this batch.
      break
    }
    // Never write an INTERRUPTED filler for an id already on disk (a real result
    // from the old run, or a filler from a concurrent heal) — a duplicate id row
    // would orphan one of the two at rebuild.
    if (
      now.some(
        (row) => row.role === "tool" && (row.tool_calls || []).some((tc) => tc.id === m.id),
      )
    ) {
      continue
    }
    const result = {
      success: false as const,
      error: error || "interrupted",
      error_code: INTERRUPTED_ERROR_CODE,
    }
    tm.insertMessageAt(
      threadId,
      toolBlockInsertIndex(now, asstNow),
      createToolResultMessage(
        threadId,
        { id: m.id, function: { name: m.toolName, arguments: m.args } },
        result,
        {},
      ) as DiskMessage,
    )
    onPersisted?.(m, result)
    persisted++
  }
  return persisted
}

/**
 * Supersede race closer (entry heal vs in-process tool): the successor run's entry
 * heal may have persisted an INTERRUPTED filler for this tool_call_id while the old
 * run was still blocked in executeTool. Appending the real result at EOF would
 * orphan it (rebuild skips non-contiguous tool rows) and tell the model the call
 * was interrupted — inviting duplicate side effects. Replace the filler in place
 * instead (keeps the row id + position right after its assistant).
 * Returns true when a filler was found and replaced.
 */
export function replaceInterruptedFillerIfPresent(
  tm: {
    getMessages: (threadId: string) => DiskMessage[]
    updateMessage: (threadId: string, messageId: string, updates: Record<string, unknown>) => unknown
  },
  threadId: string,
  toolCallId: string,
  realRow: { content?: string | null; tool_calls?: unknown[] },
  assistantId?: string,
): boolean {
  const history = tm.getMessages(threadId) as DiskMessage[]
  let from = 0
  let until = history.length
  if (assistantId) {
    const asst = history.findIndex((m) => m.id === assistantId)
    if (asst < 0) return false
    from = asst + 1
    until = from
    while (until < history.length && history[until].role === "tool") until++
  }
  const filler = history.slice(from, until).find(
    (m) =>
      m.role === "tool" &&
      typeof m.id === "string" &&
      (m.tool_calls || []).some(
        (tc) => tc.id === toolCallId && tc.result?.error_code === INTERRUPTED_ERROR_CODE,
      ),
  )
  if (!filler || typeof filler.id !== "string") return false
  tm.updateMessage(threadId, filler.id, {
    content: realRow.content,
    tool_calls: realRow.tool_calls,
  })
  return true
}
