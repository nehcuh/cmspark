/**
 * OpenAI-canonical ↔ Anthropic Messages wire conversion (P0 / NODE2).
 *
 * - tools[].function → tools[] + input_schema
 * - system messages → top-level `system`
 * - assistant.tool_calls[] → content tool_use blocks
 * - role:tool → role:user + tool_result (contiguous merge)
 * - tool_call.id sanitized to ^[a-zA-Z0-9_-]+$ (deterministic for result pairing)
 * - reasoning_content dropped on wire (M7)
 */

import type {
  CanonicalChatMessage,
  CanonicalToolCall,
  CanonicalToolDefinition,
  UserContentPart,
} from "../provider"

/** Anthropic tool definition on the wire. */
export interface AnthropicTool {
  name: string
  description: string
  input_schema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }

export interface AnthropicMessage {
  role: "user" | "assistant"
  content: string | AnthropicContentBlock[]
}

export interface AnthropicRequestBody {
  model: string
  max_tokens: number
  messages: AnthropicMessage[]
  system?: string
  temperature?: number
  tools?: AnthropicTool[]
  stream?: boolean
}

/**
 * Deterministic max_tokens (Pi M4):
 * min(8192, max(256, floor(context_window / 8)))
 *
 * Note: openai path currently omits max_tokens; anthropic requires an output cap.
 */
export function computeMaxTokens(contextWindow: number): number {
  const cw = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 8192
  return Math.min(8192, Math.max(256, Math.floor(cw / 8)))
}

/**
 * Normalize tool_call / tool_use ids for Anthropic: ^[a-zA-Z0-9_-]+$
 * Deterministic so the same id on tool_result after resume stays aligned.
 * OpenAI `call_…` already matches; only strip illegal chars.
 */
export function sanitizeToolCallId(id: string | undefined | null): string {
  if (id == null || typeof id !== "string" || id.length === 0) {
    return "tool_call"
  }
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_")
  if (cleaned.length === 0) return "tool_call"
  // Anthropic allows long ids; keep a reasonable upper bound for safety
  return cleaned.length > 128 ? cleaned.slice(0, 128) : cleaned
}

/** Convert OpenAI-style tools to Anthropic tools (input_schema). */
export function convertToolsToAnthropic(
  tools: CanonicalToolDefinition[] | undefined | null,
): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map((t) => {
    const fn = t.function
    const params = fn.parameters ?? { type: "object", properties: {} }
    const { type: rawType, ...rest } = params
    const input_schema: AnthropicTool["input_schema"] = {
      ...rest,
      type: typeof rawType === "string" && rawType ? rawType : "object",
    }
    return {
      name: fn.name,
      description: fn.description ?? "",
      input_schema,
    }
  })
}

/** Parse `data:<mime>;base64,<data>` only. http(s) and other URLs are skipped (no fetch). */
function parseDataImageUrl(url: string | undefined | null): { mediaType: string; data: string } | null {
  if (!url || typeof url !== "string") return null
  const m = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(url)
  if (!m) return null
  return { mediaType: m[1], data: m[2] }
}

function userContentToAnthropicBlocks(
  content: string | UserContentPart[] | undefined | null,
): AnthropicContentBlock[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : []
  }
  if (!Array.isArray(content)) return []
  const blocks: AnthropicContentBlock[] = []
  for (const part of content) {
    if (part.type === "text") {
      if (part.text) blocks.push({ type: "text", text: part.text })
      continue
    }
    if (part.type === "image_url") {
      const parsed = parseDataImageUrl(part.image_url?.url)
      if (parsed) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
        })
      }
    }
  }
  return blocks
}

function parseToolArguments(args: string | undefined): Record<string, unknown> {
  if (!args || !args.trim()) return {}
  try {
    const parsed = JSON.parse(args)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { value: parsed }
  } catch {
    // Invalid JSON mid-stream is not expected here (complete args only)
    return { _raw: args }
  }
}

function assistantContentFromMessage(
  content: string | null | undefined,
  toolCalls: CanonicalToolCall[] | undefined,
): string | AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = []
  if (content != null && content !== "") {
    blocks.push({ type: "text", text: content })
  }
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      blocks.push({
        type: "tool_use",
        id: sanitizeToolCallId(tc.id),
        name: tc.function?.name || "unknown",
        input: parseToolArguments(tc.function?.arguments),
      })
    }
  }
  if (blocks.length === 0) {
    // Anthropic rejects empty content; empty assistant text turn → empty string is invalid
    // Use a single empty text block only if absolutely needed — prefer " " for schema validity.
    return [{ type: "text", text: "" }]
  }
  return blocks
}

/**
 * Convert OpenAI-canonical messages to Anthropic Messages API shape.
 *
 * - Hoists consecutive leading / interspersed system strings into top-level `system`
 *   (joined with "\n\n"). Non-leading system messages are also collected into system
 *   (Anthropic has no mid-conversation system role).
 * - Drops `reasoning_content` on the wire.
 * - Merges contiguous tool results into a single user message with tool_result blocks.
 * - Sanitizes tool ids consistently for tool_use / tool_result pairing.
 */
export function convertMessagesToAnthropic(messages: CanonicalChatMessage[]): {
  system?: string
  messages: AnthropicMessage[]
} {
  const systemParts: string[] = []
  const out: AnthropicMessage[] = []

  let i = 0
  while (i < messages.length) {
    const msg = messages[i]

    if (msg.role === "system") {
      if (msg.content) systemParts.push(msg.content)
      i++
      continue
    }

    if (msg.role === "user") {
      // Merge consecutive user turns (omit notice + next user, including image parts)
      // to avoid Anthropic 400. All-text → joined string; any image → block array.
      const blocks: AnthropicContentBlock[] = [...userContentToAnthropicBlocks(msg.content)]
      i++
      while (i < messages.length && messages[i].role === "user") {
        const next = messages[i] as Extract<CanonicalChatMessage, { role: "user" }>
        blocks.push(...userContentToAnthropicBlocks(next.content))
        i++
      }
      const hasImage = blocks.some((b) => b.type === "image")
      if (hasImage) {
        out.push({ role: "user", content: blocks })
      } else {
        const text = blocks
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n\n")
        out.push({ role: "user", content: text })
      }
      continue
    }

    if (msg.role === "assistant") {
      // reasoning_content intentionally dropped (M7)
      const content = assistantContentFromMessage(msg.content, msg.tool_calls)
      out.push({ role: "assistant", content })
      i++
      continue
    }

    if (msg.role === "tool") {
      // Merge contiguous tool results into one user message, then any following
      // canonical user turns (abort-keep + next chatCreate would otherwise emit
      // consecutive users → Anthropic 400).
      const toolResults: AnthropicContentBlock[] = []
      while (i < messages.length && messages[i].role === "tool") {
        const t = messages[i] as Extract<CanonicalChatMessage, { role: "tool" }>
        toolResults.push({
          type: "tool_result",
          tool_use_id: sanitizeToolCallId(t.tool_call_id),
          content: t.content ?? "",
        })
        i++
      }
      const extra: AnthropicContentBlock[] = []
      while (i < messages.length && messages[i].role === "user") {
        const next = messages[i] as Extract<CanonicalChatMessage, { role: "user" }>
        extra.push(...userContentToAnthropicBlocks(next.content))
        i++
      }
      out.push({
        role: "user",
        content: extra.length > 0 ? [...toolResults, ...extra] : toolResults,
      })
      continue
    }

    // Unknown role — skip
    i++
  }

  // Anthropic requires messages to start with user (or empty). If first is assistant
  // (resume edge), leave as-is — API may 400; callers should prepend user when needed.
  const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined
  return system !== undefined ? { system, messages: out } : { messages: out }
}

/**
 * Build full Anthropic request body from canonical params.
 */
export function buildAnthropicRequestBody(opts: {
  model: string
  contextWindow: number
  messages: CanonicalChatMessage[]
  tools?: CanonicalToolDefinition[]
  temperature?: number
  stream?: boolean
}): AnthropicRequestBody {
  const { system, messages } = convertMessagesToAnthropic(opts.messages)
  const body: AnthropicRequestBody = {
    model: opts.model,
    max_tokens: computeMaxTokens(opts.contextWindow),
    messages,
    stream: opts.stream ?? false,
  }
  if (system !== undefined) body.system = system
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  const tools = convertToolsToAnthropic(opts.tools)
  if (tools) body.tools = tools
  return body
}

/**
 * Normalize base URL → Anthropic Messages endpoint.
 * - strip trailing slashes
 * - if already ends with /messages → as-is
 * - if ends with /v1 → append /messages (no /v1/v1)
 * - else append /v1/messages
 */
export function resolveAnthropicMessagesUrl(baseUrl: string): string {
  const raw = (baseUrl || "").trim()
  if (!raw) {
    throw new Error("llm.base_url is required for Anthropic protocol")
  }
  let base = raw.replace(/\/+$/, "")
  if (base.endsWith("/messages")) {
    return base
  }
  if (/\/v1$/i.test(base)) {
    return `${base}/messages`
  }
  return `${base}/v1/messages`
}
