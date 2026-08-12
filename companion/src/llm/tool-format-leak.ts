/**
 * Detect assistant *text* that looks like tool invocation markup but was not
 * delivered as structured tool_calls (e.g. DeepSeek DSML, XML invoke, mcp__… in prose).
 * Used to avoid silent chat.done when the model role-played tools.
 */

const LEAK_PATTERNS: RegExp[] = [
  /DSML/i,
  /<\s*\/?\s*tool_calls?\b/i,
  /<\s*invoke\b[^>]*\bname\s*=/i,
  // Bare DSML/xml style: invoke name="shell_exec" (no angle brackets)
  /\binvoke\s+name\s*=/i,
  /\bmcp__[a-zA-Z0-9_]+__[a-zA-Z0-9_]+/,
  /\bfunction_call\b/i,
  // Common native tool names only when framed as a call, not casual mention
  /\b(list_tabs|shell_exec|host_computer|navigate)\s*\(/i,
]

/**
 * @returns true if content likely encodes unexecuted tool intent
 */
export function detectTextToolIntentLeak(content: string | null | undefined): boolean {
  if (!content || typeof content !== "string") return false
  const s = content.trim()
  if (s.length < 8) return false
  return LEAK_PATTERNS.some((re) => re.test(s))
}

/** User-visible footer (Chinese) appended / sent as warning — keep short. */
export const TOOL_FORMAT_LEAK_USER_HINT_ZH =
  "⚠️ 本轮模型把工具调用写进了正文（未走结构化 tool_calls），**没有真正执行任何工具**。" +
  "请再说一次需求，或换支持稳定 function calling 的模型；勿把上面伪 XML/DSML 当已完成。"
