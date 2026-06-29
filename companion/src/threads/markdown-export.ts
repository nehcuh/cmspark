// Thread → Markdown exporter for Obsidian (and any markdown vault).
//
// Pure functions: no IO, no LLM, no file writes. Input = messages + thread meta +
// config, output = { filename, content }. Deliberately decoupled from adapter.ts's
// LLM-context assembly (that builds OpenAI ChatCompletionMessageParam[]; we build
// human-readable markdown) — we reuse only the assistant↔tool pairing *idea*.
//
// Noise handling is the core concern: tool_call/tool_result JSON, base64 blobs, full
// page HTML, and skill manuals must be folded + truncated so the exported note stays
// readable AND the rendered JSON stays structurally valid. See renderJsonBounded.

import * as yaml from "js-yaml"

/** Structurally compatible with thread-manager's (private) Message — no export coupling. */
export interface ExportMessage {
  id: string
  role: "user" | "assistant" | "tool" | "system"
  content: string
  tool_calls?: any[]
  created_at?: string
}

export interface ObsidianExportConfig {
  /** Filename template. Placeholders: {{date}} {{time}} {{thread_alias}} {{first_user_line}}. */
  name_template: string
  /** Merged into frontmatter, e.g. { tags: ["cmspark"] }. Reserved keys below always win. */
  default_frontmatter: Record<string, any>
  /** Future: auto-write target. P0 ignores (UI-download only). */
  vault_path?: string | null
  /** Future: vault-profile cache path. P0 ignores. */
  profile_path?: string
}

export type ExportScope = "single" | "qa_pair" | "thread"

export interface ExportThreadMeta {
  id: string
  alias: string
  created_at: string
  updated_at: string
}

export interface ExportOptions {
  scope: ExportScope
  anchorMessageId?: string
  config: ObsidianExportConfig
  thread: ExportThreadMeta
}

export interface ExportResult {
  filename: string
  content: string
  format: "markdown"
}

// --- tunables (named constants; hoist to config if user customization is needed) ---
const MAX_FIELD_LEN = 400 // trim any single string field (kills base64, full HTML, manuals)
const MAX_ARRAY_LEN = 30 // cap arrays inside tool results
const MAX_DEPTH = 10
const MAX_RESULT_JSON_LEN = 2000 // hard cap on a rendered tool block (args/result)
const FIRST_LINE_LIMIT = 40
const FILENAME_MAX = 60
const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|\n\r\t]/g

/**
 * Serialize (a slice of) a thread to a single markdown document with YAML frontmatter.
 */
export function serializeThreadToMarkdown(
  messages: ExportMessage[],
  options: ExportOptions,
): ExportResult {
  const selected = selectMessages(messages, options.scope, options.anchorMessageId)
  const blocks = pairBlocks(selected)
  const body = renderBody(blocks)
  const firstUserLine = computeFirstUserLine(selected)
  const frontmatter = buildFrontmatter(options, firstUserLine)
  const filename =
    applyNameTemplate(options.config.name_template, options.thread, firstUserLine) + ".md"
  return { filename, content: frontmatter + body, format: "markdown" }
}

// ---------------- selection ----------------

function selectMessages(
  messages: ExportMessage[],
  scope: ExportScope,
  anchorMessageId?: string,
): ExportMessage[] {
  if (scope === "thread") return messages.filter(m => m.role !== "system")

  const anchorIdx = messages.findIndex(m => m.id === anchorMessageId)
  if (anchorIdx < 0) return messages.filter(m => m.role !== "system") // defensive fallback
  if (scope === "single") return [messages[anchorIdx]]

  // qa_pair: the turn spanning [nearest preceding user (or anchor) .. next user)
  let start = anchorIdx
  if (messages[anchorIdx].role !== "user") {
    let u = anchorIdx - 1
    while (u >= 0 && messages[u].role !== "user") u--
    start = u >= 0 ? u : anchorIdx
  }
  let end = messages.length
  for (let k = start + 1; k < messages.length; k++) {
    if (messages[k].role === "user") {
      end = k
      break
    }
  }
  return messages.slice(start, end).filter(m => m.role !== "system")
}

// ---------------- pairing (assistant ↔ tool results) ----------------
//
// We ALWAYS consume consecutive tool messages following an assistant that emitted
// tool_calls, and pair per-call by id. This handles the production-reachable case where
// adapter.ts persists the assistant (full tool_calls) before the tool-exec loop, then
// breaks early (security stop / loop limit / exception) after only k<N results were
// saved: the k real results render as info callouts and the missing ones as warnings,
// instead of discarding the whole turn. Any consumed result not matched to a call
// (e.g. a null id) is still rendered via the safety net — never silently dropped.

type Block =
  | { type: "user"; msg: ExportMessage }
  | { type: "assistant_text"; msg: ExportMessage }
  | {
      type: "assistant_tool"
      msg: ExportMessage
      calls: any[]
      results: any[] // ordered consumed tool-result entries
      byId: Map<string, any>
    }

function pairBlocks(messages: ExportMessage[]): Block[] {
  const blocks: Block[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === "system" || msg.role === "tool") continue // tool handled inline below; orphan tool → skipped
    if (msg.role === "user") {
      blocks.push({ type: "user", msg })
      continue
    }
    // assistant
    const calls = msg.tool_calls || []
    if (calls.length === 0) {
      blocks.push({ type: "assistant_text", msg })
      continue
    }
    // Consume all consecutive tool messages, collect results (ordered + by id).
    const results: any[] = []
    const byId = new Map<string, any>()
    let p = i + 1
    while (p < messages.length && messages[p].role === "tool") {
      for (const tc of messages[p].tool_calls || []) {
        if (!tc) continue
        results.push(tc)
        if (tc.id != null) byId.set(tc.id, tc)
      }
      p++
    }
    i = p - 1
    blocks.push({ type: "assistant_tool", msg, calls, results, byId })
  }
  return blocks
}

// ---------------- rendering ----------------

function renderBody(blocks: Block[]): string {
  const parts: string[] = []
  blocks.forEach((b, idx) => {
    if (b.type === "user" && idx > 0) parts.push("---")
    parts.push(renderBlock(b))
  })
  const body = parts.join("\n\n").trim()
  return body ? body + "\n" : ""
}

function renderBlock(b: Block): string {
  switch (b.type) {
    case "user":
      return `**🧑 提问**\n\n${stripDocuments(b.msg.content || "")}`
    case "assistant_text":
      return `**🤖 回答**\n\n${(b.msg.content || "").trim()}`.trimEnd()
    case "assistant_tool": {
      const prose = (b.msg.content || "").trim()
      const head = prose ? `**🤖 回答**\n\n${prose}` : `**🤖 回答 · 工具调用**`
      const callouts: string[] = []
      const used = new Set<any>()
      for (const call of b.calls) {
        const matched = call?.id != null ? b.byId.get(call.id) : undefined
        if (matched) {
          used.add(matched)
          callouts.push(renderToolEntry(toolNameOf(call), parseArgs(call), matched.result))
        } else {
          callouts.push(renderToolWarning(toolNameOf(call)))
        }
      }
      // Safety net: a consumed result that didn't match any call (e.g. null id) — never drop it.
      for (const r of b.results) {
        if (!used.has(r)) {
          callouts.push(renderToolEntry(r.tool_name || r.name || "tool", r.params ?? {}, r.result))
        }
      }
      return [head, ...callouts].join("\n\n")
    }
  }
}

function renderToolEntry(name: string, args: any, result: any): string {
  const argsR = renderJsonBounded(args, MAX_RESULT_JSON_LEN)
  const resultR = renderJsonBounded(result, MAX_RESULT_JSON_LEN)
  // Fences must be longer than any backtick run inside the JSON, else embedded ``` (e.g.
  // markdown scraped by get_page_text) would close the code block mid-content.
  const argsFence = fenceFor(argsR.json)
  const resultFence = fenceFor(resultR.json)
  let inner = [
    "**参数**",
    argsFence + "json",
    argsR.json,
    argsFence,
    "**结果**",
    resultFence + "json",
    resultR.json,
    resultFence,
  ].join("\n")
  if (argsR.truncated || resultR.truncated) inner += "\n_（部分内容过大，已自动缩减）_"
  return quote(`[!info]- 🔧 ${name}\n${inner}`)
}

/** A code fence longer than any backtick run in the content (min 3). */
function fenceFor(content: string): string {
  return "`".repeat(Math.max(3, maxBacktickRun(content) + 1))
}

function maxBacktickRun(s: string): number {
  let max = 0
  let cur = 0
  for (const ch of s) {
    if (ch === "`") {
      cur++
      if (cur > max) max = cur
    } else {
      cur = 0
    }
  }
  return max
}

function renderToolWarning(name: string): string {
  return quote(`[!warning] 🔧 ${name} · 调用未完成（无结果）`)
}

/** Prefix every line with "> " so the block renders as an Obsidian callout. */
function quote(text: string): string {
  return text
    .split("\n")
    .map(l => (l.length ? `> ${l}` : ">"))
    .join("\n")
}

function toolNameOf(tc: any): string {
  return tc?.function?.name || tc?.name || tc?.tool_name || "tool"
}

function parseArgs(tc: any): any {
  const raw = tc?.function?.arguments ?? tc?.arguments ?? "{}"
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return raw // fall back to raw string if unparseable
    }
  }
  return raw ?? {}
}

/**
 * Render a value as pretty JSON that always fits under maxLen AND stays structurally
 * valid (never sliced mid-token). Strategy: redact (trim long strings, cap arrays),
 * then iteratively tighten caps until it fits; final fallback is a valid summary string.
 * Returns { json, truncated } where `truncated` means any trimming happened.
 */
export function renderJsonBounded(obj: any, maxLen: number): { json: string; truncated: boolean } {
  if (typeof obj === "string") {
    if (obj.length <= maxLen) return { json: JSON.stringify(obj), truncated: false }
    return {
      json: JSON.stringify(obj.slice(0, maxLen) + `…(${obj.length} 字符)`),
      truncated: true,
    }
  }
  const box = { trimmed: false }
  let fieldLen = MAX_FIELD_LEN
  let arrayLen = MAX_ARRAY_LEN
  for (let attempt = 0; attempt < 4; attempt++) {
    const redacted = redact(obj, fieldLen, arrayLen, box)
    let s: string
    try {
      s = JSON.stringify(redacted, null, 2)
    } catch {
      s = "null"
    }
    // JSON.stringify returns undefined (no throw) for undefined/function/symbol top-level values.
    if (typeof s !== "string") s = "null"
    if (s.length <= maxLen) return { json: s, truncated: box.trimmed }
    fieldLen = Math.max(60, Math.floor(fieldLen / 2))
    arrayLen = Math.max(3, Math.floor(arrayLen / 2))
  }
  return { json: `"（内容过大，已省略展示）"`, truncated: true }
}

/** Recursively trim oversized strings and cap arrays/depth. Sets box.trimmed if anything was cut. */
function redact(obj: any, fieldLen: number, arrayLen: number, box: { trimmed: boolean }, depth = 0): any {
  if (depth > MAX_DEPTH) {
    box.trimmed = true
    return "…"
  }
  if (typeof obj === "string") {
    if (obj.length > fieldLen) {
      box.trimmed = true
      return obj.slice(0, fieldLen) + `…(${obj.length} 字符)`
    }
    return obj
  }
  if (Array.isArray(obj)) {
    const arr = obj.slice(0, arrayLen).map(x => redact(x, fieldLen, arrayLen, box, depth + 1))
    if (obj.length > arrayLen) {
      box.trimmed = true
      arr.push(`…(共 ${obj.length} 项)`)
    }
    return arr
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = redact(v, fieldLen, arrayLen, box, depth + 1)
    return out
  }
  return obj
}

/** Convert the adapter-injected <document filename="…">…</document> wrapper into a label + body. */
function stripDocuments(content: string): string {
  return content.replace(
    /<document filename="([^"]*)">([\s\S]*?)<\/document>/g,
    (_, name, inner) => `**📎 附件：${name}**\n\n${inner.trim()}`,
  )
}

// ---------------- frontmatter + filename ----------------

function buildFrontmatter(options: ExportOptions, firstUserLine: string): string {
  const { thread, scope, config } = options
  // default_frontmatter first so reserved provenance keys cannot be silently overridden.
  // title granularity matches the export scope: whole-thread exports use the thread alias;
  // slice exports (single/qa_pair) use the slice's first user line. Thread provenance is
  // already carried by source/thread_id, so title is free to describe the exported content.
  const title =
    scope === "thread"
      ? thread.alias || firstUserLine || "CMspark 对话"
      : firstUserLine || thread.alias || "CMspark 对话"
  const fm: Record<string, any> = {
    ...config.default_frontmatter,
    source: `cmspark://thread/${thread.id}`,
    thread_id: thread.id,
    scope,
    exported_at: new Date().toISOString(),
    title,
  }
  return `---\n${yaml.dump(fm, { lineWidth: -1, sortKeys: false })}---\n\n`
}

function applyNameTemplate(
  template: string,
  thread: ExportThreadMeta,
  firstUserLine: string,
): string {
  const now = new Date()
  const iso = now.toISOString()
  const date = iso.slice(0, 10) // YYYY-MM-DD
  const time = iso.slice(11, 16).replace(":", "") // HHmm
  const out = (template || "{{date}} {{first_user_line}}")
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{thread_alias\}\}/g, thread.alias || "")
    .replace(/\{\{first_user_line\}\}/g, firstUserLine || "")
  return sanitizeFilename(out)
}

function sanitizeFilename(s: string): string {
  let cleaned = s.replace(ILLEGAL_FILENAME_CHARS, "-").replace(/\s+/g, " ").trim()
  cleaned = cleaned.replace(/^\.+/, "") // no leading dot (would be a hidden file on Unix)
  if (!cleaned || /^-*$/.test(cleaned)) return "export" // empty / all-dashes → fallback
  return cleaned.slice(0, FILENAME_MAX)
}

function computeFirstUserLine(messages: ExportMessage[]): string {
  for (const m of messages) {
    if (m.role === "user") {
      const stripped = stripDocuments(m.content || "").trim()
      const line = stripped.split("\n")[0].trim()
      return line.replace(/\s+/g, " ").slice(0, FIRST_LINE_LIMIT)
    }
  }
  return ""
}
