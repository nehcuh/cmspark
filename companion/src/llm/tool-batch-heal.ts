// Heal unpaired assistant.tool_calls on disk so the next rebuild is schema-valid
// without stripping successful tools. Pure helpers + a duck-typed persist.

export const INTERRUPTED_ERROR_CODE = "INTERRUPTED"

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
): number {
  const history = tm.getMessages(threadId) as DiskMessage[]
  const idx = assistantId
    ? history.findIndex((m) => m.id === assistantId)
    : newestUnpairedAssistantIndex(history)
  if (idx < 0 || history[idx].role !== "assistant") return 0
  const missing = unpairedToolCallsFromAssistant(history[idx], history.slice(idx + 1))
  if (missing.length === 0) return 0
  let rowFor: (m: MissingToolCall) => DiskMessage
  try {
    const { createToolResultMessage } = require("./adapter") as typeof import("./adapter")
    rowFor = (m) =>
      createToolResultMessage(
        threadId,
        { id: m.id, function: { name: m.toolName, arguments: m.args } },
        { success: false, error: error || "interrupted", error_code: INTERRUPTED_ERROR_CODE },
        {},
      ) as DiskMessage
  } catch {
    rowFor = (m) => buildInterruptedDiskRow(threadId, m, error)
  }
  const assistantIdResolved = history[idx].id
  let insertAt = toolBlockInsertIndex(history, idx)
  for (const m of missing) {
    tm.insertMessageAt(threadId, insertAt, rowFor(m))
    // Re-read: cap-trim can shift indexes so insertAt++ would land after a later user.
    const now = tm.getMessages(threadId) as DiskMessage[]
    const asstNow = assistantIdResolved
      ? now.findIndex((row) => row.id === assistantIdResolved)
      : newestUnpairedAssistantIndex(now)
    insertAt = asstNow < 0 ? now.length : toolBlockInsertIndex(now, asstNow)
  }
  return missing.length
}
