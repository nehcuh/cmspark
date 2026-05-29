// Logging and summarization helpers for server tool execution

import { URL } from "url"

export function getDomainFromUrl(urlString: string): string {
  try {
    return new URL(urlString).hostname
  } catch {
    return ""
  }
}

export function summarizeToolParams(params: any): Record<string, unknown> {
  const safeParams = params || {}
  const summary: Record<string, unknown> = { keys: Object.keys(safeParams) }
  for (const key of ["tabId", "url", "domain", "selector", "threadId", "thread_id"]) {
    if (safeParams[key] !== undefined) summary[key] = safeParams[key]
  }
  if (safeParams.code !== undefined) summary.code_length = String(safeParams.code).length
  if (safeParams.expression !== undefined) summary.expression_length = String(safeParams.expression).length
  return summary
}

export function summarizeToolResult(result: any): Record<string, unknown> {
  if (!result) return { success: false }
  return {
    success: result.success,
    has_data: !!result.data,
    data_type: result.data ? typeof result.data : "none",
    data_size: result.data && typeof result.data === "string" ? result.data.length : "N/A",
    has_error: !!result.error,
    error_preview: result.error ? String(result.error).substring(0, 80) : undefined,
  }
}

export function summarizeMessage(msg: any): Record<string, unknown> {
  if (!msg) return { type: "null" }
  const summary: Record<string, unknown> = {}
  for (const key of ["id", "type", "thread_id", "tool_call_id", "tool_name", "alias", "skill_name"]) {
    if (msg[key] !== undefined) summary[key] = msg[key]
  }
  if (msg.params) {
    summary.params = summarizeToolParams(msg.params)
  }
  if (msg.result) {
    summary.result = summarizeToolResult(msg.result)
  }
  if (msg.content) {
    summary.content_length = typeof msg.content === "string" ? msg.content.length : JSON.stringify(msg.content).length
  }
  return summary
}

export function logToolFinish(
  log: (level: string, source: string, event: string, data: Record<string, unknown>) => void,
  toolCallId: string,
  toolName: string,
  durationMs: number,
  result: any,
  error?: string,
) {
  log("info", "tool_executor", "tool.finish", {
    tool_call_id: toolCallId,
    tool_name: toolName,
    duration_ms: durationMs,
    ...summarizeToolResult(result),
    error_preview: error ? error.substring(0, 80) : undefined,
  })
}
