import { test } from "node:test"
import * as assert from "node:assert/strict"

import {
  serializeThreadToMarkdown,
  renderJsonBounded,
  ExportMessage,
  ExportOptions,
  ObsidianExportConfig,
} from "../src/threads/markdown-export"

const cfg: ObsidianExportConfig = {
  name_template: "{{date}} {{first_user_line}}",
  default_frontmatter: { tags: ["cmspark"] },
  vault_path: null,
}
const thread = { id: "t1", alias: "My Thread", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }

function opt(scope: ExportOptions["scope"], anchorMessageId?: string): ExportOptions {
  return { scope, anchorMessageId, config: cfg, thread }
}

function msg(partial: Partial<ExportMessage> & { id: string; role: ExportMessage["role"] }): ExportMessage {
  return { content: "", created_at: "2026-01-01T00:00:00Z", ...partial }
}

test("frontmatter: well-formed YAML with source/scope/tags", () => {
  const r = serializeThreadToMarkdown(
    [msg({ id: "u1", role: "user", content: "hello" })],
    opt("single", "u1"),
  )
  assert.ok(r.content.startsWith("---\n"))
  assert.match(r.content, /source: cmspark:\/\/thread\/t1/)
  assert.match(r.content, /thread_id: t1/)
  assert.match(r.content, /scope: single/)
  assert.match(r.content, /tags:\n\s+- cmspark/)
  assert.match(r.content, /^---\n[\s\S]*\n---\n\n/) // closing fence + blank line
})

test("filename: ends with .md, contains date + sanitized first user line", () => {
  const r = serializeThreadToMarkdown(
    [msg({ id: "u1", role: "user", content: "How do I export?" })],
    opt("single", "u1"),
  )
  assert.ok(r.filename.endsWith(".md"))
  assert.match(r.filename, /^\d{4}-\d{2}-\d{2} /)
  assert.ok(r.filename.includes("How do I export"))
})

test("filename: illegal chars sanitized (/, ?, etc.)", () => {
  const c: ObsidianExportConfig = { ...cfg, name_template: "{{thread_alias}} — {{first_user_line}}" }
  const r = serializeThreadToMarkdown(
    [msg({ id: "u1", role: "user", content: "what now?" })],
    { scope: "single", anchorMessageId: "u1", config: c, thread: { ...thread, alias: "Repo/Notes" } },
  )
  assert.ok(!r.filename.includes("/"))
  assert.ok(!r.filename.includes("?"))
  assert.ok(r.filename.includes("Repo-Notes"))
})

test("plain user→assistant: both rendered, no tool artifacts", () => {
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "ping" }),
      msg({ id: "a1", role: "assistant", content: "pong" }),
    ],
    opt("thread"),
  )
  assert.match(r.content, /\*\*🧑 提问\*\*\n\nping/)
  assert.match(r.content, /\*\*🤖 回答\*\*\n\npong/)
  assert.ok(!r.content.includes("[!info]"))
})

test("assistant(tool_calls)→tool(result): result folded into callout, not a standalone JSON dump", () => {
  const bigResult = { success: true, data: { title: "Example", text: "page body" } }
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "fetch it" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", type: "function", function: { name: "get_page_text", arguments: '{"tabId":123}' } }],
      }),
      msg({
        id: "tool1",
        role: "tool",
        content: JSON.stringify(bigResult),
        tool_calls: [{ id: "c1", tool_name: "get_page_text", params: { tabId: 123 }, result: bigResult }],
      }),
    ],
    opt("thread"),
  )
  // tool call rendered as a collapsed Obsidian callout
  assert.match(r.content, /> \[!info\]- 🔧 get_page_text/)
  assert.match(r.content, /> \*\*参数\*\*/)
  assert.match(r.content, /> \*\*结果\*\*/)
  // the tool message's raw content (JSON) must NOT appear as a bare (unquoted) paragraph
  assert.ok(!r.content.includes("\n" + JSON.stringify(bigResult) + "\n"))
  // empty assistant prose → "工具调用" label
  assert.match(r.content, /\*\*🤖 回答 · 工具调用\*\*/)
})

test("broken pairing: assistant has tool_calls but no following tool message → warning, no throw", () => {
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "go" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "trying",
        tool_calls: [{ id: "c1", function: { name: "navigate", arguments: "{}" } }],
      }),
    ],
    opt("thread"),
  )
  assert.match(r.content, /> \[!warning\] 🔧 navigate/)
  assert.ok(r.content.includes("trying"))
})

test("huge tool result: truncated, full payload absent", () => {
  const huge = { success: true, data: "x".repeat(5000) }
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "go" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", function: { name: "get_page_text", arguments: "{}" } }],
      }),
      msg({
        id: "tool1",
        role: "tool",
        content: "{}",
        tool_calls: [{ id: "c1", tool_name: "get_page_text", params: {}, result: huge }],
      }),
    ],
    opt("thread"),
  )
  assert.ok(!r.content.includes("x".repeat(5000)))
  assert.match(r.content, /…\(/)
})

test("base64-ish field: redacted via MAX_FIELD_LEN, not leaked in full", () => {
  const b64 = "a".repeat(2000)
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "go" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", function: { name: "screenshot", arguments: "{}" } }],
      }),
      msg({
        id: "tool1",
        role: "tool",
        content: "{}",
        tool_calls: [{ id: "c1", tool_name: "screenshot", params: {}, result: { success: true, image: b64 } }],
      }),
    ],
    opt("thread"),
  )
  assert.ok(!r.content.includes(b64))
  assert.ok(r.content.includes("…(2000 字符)"))
})

test("qa_pair with assistant anchor: includes preceding user, excludes following turn", () => {
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "first" }),
      msg({ id: "a1", role: "assistant", content: "A1" }),
      msg({ id: "u2", role: "user", content: "second" }),
      msg({
        id: "a2",
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", function: { name: "navigate", arguments: "{}" } }],
      }),
      msg({
        id: "tool1",
        role: "tool",
        content: "{}",
        tool_calls: [{ id: "c1", tool_name: "navigate", params: {}, result: { success: true } }],
      }),
      msg({ id: "u3", role: "user", content: "third" }),
    ],
    opt("qa_pair", "a2"),
  )
  assert.ok(r.content.includes("second"))
  assert.ok(r.content.includes("🔧 navigate"))
  assert.ok(!r.content.includes("first"))
  assert.ok(!r.content.includes("third"))
})

test("single scope: only the anchored message", () => {
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "first" }),
      msg({ id: "a1", role: "assistant", content: "A1" }),
    ],
    opt("single", "u1"),
  )
  assert.ok(r.content.includes("first"))
  assert.ok(!r.content.includes("A1"))
})

test("<document> wrapper stripped and labeled", () => {
  const r = serializeThreadToMarkdown(
    [
      msg({
        id: "u1",
        role: "user",
        content: `see this\n\n<document filename="notes.md">\nhello world\n</document>`,
      }),
    ],
    opt("single", "u1"),
  )
  assert.ok(r.content.includes("**📎 附件：notes.md**"))
  assert.ok(r.content.includes("hello world"))
  assert.ok(!r.content.includes("<document"))
})

test("orphan tool message (no preceding assistant tool_calls) is skipped", () => {
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "hi" }),
      msg({
        id: "tool1",
        role: "tool",
        content: "ORPHAN_NOISE",
        tool_calls: [{ id: "cX", tool_name: "ghost", params: {}, result: { ok: true } }],
      }),
    ],
    opt("thread"),
  )
  assert.ok(r.content.includes("hi"))
  assert.ok(!r.content.includes("ORPHAN_NOISE"))
  assert.ok(!r.content.includes("🔧 ghost"))
})

test("system messages are dropped", () => {
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "s1", role: "system", content: "SYSTEM_PROMPT_NOISE" }),
      msg({ id: "u1", role: "user", content: "hi" }),
    ],
    opt("thread"),
  )
  assert.ok(!r.content.includes("SYSTEM_PROMPT_NOISE"))
})

test("PARTIAL pairing: assistant with 2 calls but only 1 persisted result → keep the real result, warn on the missing", () => {
  // Reproduces the production-reachable case: adapter saves the assistant (full tool_calls)
  // then breaks early after only the first result persisted.
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "go" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "navigate", arguments: "{}" } },
          { id: "c2", type: "function", function: { name: "get_page_text", arguments: "{}" } },
        ],
      }),
      msg({
        id: "tool1",
        role: "tool",
        content: "{}",
        tool_calls: [{ id: "c1", tool_name: "navigate", params: {}, result: { success: true, landed: "YES" } }],
      }),
    ],
    opt("thread"),
  )
  // the real c1 result is preserved as an info callout
  assert.match(r.content, /> \[!info\]- 🔧 navigate/)
  assert.ok(r.content.includes("landed"))
  assert.ok(r.content.includes("YES"))
  // the missing c2 is a warning, not a silent drop
  assert.match(r.content, /> \[!warning\] 🔧 get_page_text/)
})

test("renderJsonBounded: large array → valid (parseable) JSON, bounded, array-cap marker present", () => {
  const bigArr = Array.from({ length: 80 }, (_, i) => ({ i, t: "item" + i }))
  const { json, truncated } = renderJsonBounded(bigArr, 2000)
  assert.ok(truncated)
  assert.doesNotThrow(() => JSON.parse(json)) // structurally valid (closed brackets)
  assert.ok(json.includes("共 80 项"))
  assert.ok(!json.includes("item75")) // tail dropped by array cap
})

test("renderJsonBounded: nested huge strings → valid JSON, fields trimmed, no mid-token cut", () => {
  const obj = { ok: true, blob: "x".repeat(5000), list: ["y".repeat(3000), "z".repeat(3000)] }
  const { json, truncated } = renderJsonBounded(obj, 2000)
  assert.ok(truncated)
  assert.doesNotThrow(() => JSON.parse(json))
  assert.ok(!json.includes("x".repeat(5000)))
  assert.ok(json.length <= 2000)
})

test("filename: no leading dot (avoids hidden file on Unix)", () => {
  const c: ObsidianExportConfig = { ...cfg, name_template: "{{first_user_line}}" }
  const r = serializeThreadToMarkdown(
    [msg({ id: "u1", role: "user", content: ".secret" })],
    { scope: "single", anchorMessageId: "u1", config: c, thread },
  )
  assert.ok(!/^\.+/.test(r.filename.replace(/\.md$/, "")))
})

test("filename: all-illegal input falls back to 'export', never all-dashes", () => {
  const c: ObsidianExportConfig = { ...cfg, name_template: "{{first_user_line}}" }
  const r = serializeThreadToMarkdown(
    [msg({ id: "u1", role: "user", content: "???///" })],
    { scope: "single", anchorMessageId: "u1", config: c, thread },
  )
  assert.ok(r.filename.startsWith("export"))
})

test("renderJsonBounded: undefined/function/symbol top-level value does not crash", () => {
  const u = renderJsonBounded(undefined, 100)
  assert.equal(u.json, "null")
  const f = renderJsonBounded(function foo() {}, 100)
  assert.doesNotThrow(() => JSON.parse(f.json))
})

test("qa_pair filename + title reflect the EXPORTED slice, not the thread's first user line", () => {
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "first question" }),
      msg({ id: "a1", role: "assistant", content: "A1" }),
      msg({ id: "u2", role: "user", content: "second question" }),
      msg({ id: "a2", role: "assistant", content: "A2" }),
    ],
    opt("qa_pair", "a2"),
  )
  assert.ok(r.filename.includes("second question"), "filename should use the pair's user line")
  assert.ok(!r.filename.includes("first question"))
  // title is scope-aware: slice exports use the slice's first user line, not the thread alias
  assert.match(r.content, /title: second question/)
  assert.ok(!r.content.includes("My Thread"))
})

test("thread-scope title prefers the thread alias", () => {
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "some question" }),
      msg({ id: "a1", role: "assistant", content: "A1" }),
    ],
    opt("thread"),
  )
  assert.match(r.content, /title: My Thread/)
})

test("profile: note_name_template overrides config name_template", () => {
  const c: ObsidianExportConfig = { ...cfg, name_template: "SHOULD-NOT-USE" }
  const r = serializeThreadToMarkdown(
    [msg({ id: "u1", role: "user", content: "hello world" })],
    {
      scope: "single", anchorMessageId: "u1", config: c, thread,
      profile: { note_name_template: "{{date}} {{first_user_line}}" },
    },
  )
  assert.ok(r.filename.includes("hello world"))
  assert.ok(!r.filename.includes("SHOULD-NOT-USE"))
})

test("profile: frontmatter_schema adds date + aliases keys; speculative keys not auto-added; reserved win", () => {
  const r = serializeThreadToMarkdown(
    [msg({ id: "u1", role: "user", content: "topic" })],
    {
      scope: "thread", config: cfg, thread,
      profile: {
        frontmatter_schema: [
          { name: "created", type: "date" },
          { name: "aliases", type: "array" },
          { name: "type", type: "string" }, // speculative — must NOT be auto-added
        ],
      },
    },
  )
  assert.match(r.content, /created: '?\d{4}-\d{2}-\d{2}/)
  assert.match(r.content, /aliases:\n\s+- /)
  // speculative "type" is not auto-guessed into frontmatter
  assert.ok(!/\ntype:/.test(r.content))
  // reserved provenance keys still present
  assert.match(r.content, /source: cmspark:\/\/thread\/t1/)
})

test("tool result containing triple-backtick markdown uses a longer fence (no premature close)", () => {
  const r = serializeThreadToMarkdown(
    [
      msg({ id: "u1", role: "user", content: "go" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", function: { name: "get_page_text", arguments: "{}" } }],
      }),
      msg({
        id: "tool1",
        role: "tool",
        content: "{}",
        tool_calls: [
          {
            id: "c1",
            tool_name: "get_page_text",
            params: {},
            result: { code: "```js\n1+1\n```" },
          },
        ],
      }),
    ],
    opt("thread"),
  )
  // the inner content has a 3-backtick run, so the wrapping fence must be 4+ backticks
  assert.match(r.content, /````json/)
  assert.ok(r.content.includes("```js"))
})
