import { test } from "node:test"
import * as assert from "node:assert/strict"

import {
  buildSummaryTranscript,
  parseSummary,
  estimateTokens,
  NO_SUMMARY_CONTENT,
} from "../src/threads/summary-export"
import {
  serializeSummaryToMarkdown,
  type ExportMessage,
  type ObsidianExportConfig,
  type ThreadSummary,
} from "../src/threads/markdown-export"

// ---------- estimateTokens ----------

test("estimateTokens: CJK≈1.5/char, latin≈4chars/token", () => {
  assert.equal(estimateTokens("hello"), 2) // 5 latin → ceil(5/4)
  assert.equal(estimateTokens("你好"), 3) // 2 cjk → ceil(3.0)
  assert.equal(estimateTokens(""), 0)
})

// ---------- buildSummaryTranscript ----------

function msg(id: string, role: ExportMessage["role"], content: string): ExportMessage {
  return { id, role, content, created_at: "2026-01-01T00:00:00Z" }
}

test("buildSummaryTranscript: filters tool/system, keeps user/assistant only", () => {
  const t = buildSummaryTranscript([
    msg("s1", "system", "SYSTEM_PROMPT"),
    msg("u1", "user", "hello"),
    msg("a1", "assistant", "hi"),
    msg("tool1", "tool", "TOOL_RESULT"),
    msg("u2", "user", "again"),
    msg("a2", "assistant", "yes"),
  ])
  assert.ok(t)
  assert.ok(t!.includes("🧑: hello") && t!.includes("🤖: hi"))
  assert.ok(!t!.includes("SYSTEM_PROMPT"))
  assert.ok(!t!.includes("TOOL_RESULT"))
})

test("buildSummaryTranscript: too few turns (<4 user/assistant) → null", () => {
  assert.equal(
    buildSummaryTranscript([msg("u1", "user", "a"), msg("a1", "assistant", "b"), msg("u2", "user", "c")]),
    null,
  )
  // tool/system messages do NOT count toward the minimum
  assert.equal(
    buildSummaryTranscript([
      msg("s1", "system", "x"),
      msg("u1", "user", "a"),
      msg("a1", "assistant", "b"),
      msg("tool1", "tool", "y"),
    ]),
    null,
  )
})

test("buildSummaryTranscript: per-message content truncated to the cap", () => {
  const huge = "x".repeat(3000)
  const t = buildSummaryTranscript([
    msg("u1", "user", huge),
    msg("a1", "assistant", "short"),
    msg("u2", "user", "q"),
    msg("a2", "assistant", "a"),
  ])
  assert.ok(t)
  assert.ok(!t!.includes("x".repeat(3000)), "full oversized content must not be sent")
  assert.ok(t!.includes("…"), "truncation marker present")
})

test("buildSummaryTranscript: small thread fits budget → joined, no omission marker", () => {
  const t = buildSummaryTranscript([
    msg("u1", "user", "one"),
    msg("a1", "assistant", "two"),
    msg("u2", "user", "three"),
    msg("a2", "assistant", "four"),
  ])
  assert.ok(t)
  assert.ok(t!.includes("🧑: one") && t!.includes("🤖: four"))
  assert.ok(!t!.includes("已省略"))
})

test("buildSummaryTranscript: over-budget → head + marker + tail, middle omitted", () => {
  // 20 turns, each large enough that a tiny budget forces head+tail truncation.
  const turns: ExportMessage[] = Array.from({ length: 20 }, (_, i) =>
    msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", `message-number-${i}-` + "y".repeat(200)),
  )
  // contextWindow=600 → budget = min(240, 50000) = 240 tokens → head+tail fit, middle omitted.
  const t = buildSummaryTranscript(turns, 600)
  assert.ok(t, "should still return a transcript (not null)")
  assert.ok(t!.includes("已省略"), "omission marker present")
  assert.ok(t!.includes("message-number-0-"), "head (opening question) kept")
  assert.ok(t!.includes("message-number-19-"), "tail (last turn) kept")
  assert.ok(!t!.includes("message-number-10-"), "a middle message must be omitted")
})

// ---------- parseSummary ----------

test("parseSummary: extracts TITLE + TLDR + structured body", () => {
  const raw = "TITLE: RAG 与向量数据库\nTLDR: 讨论了检索增强生成。\n## 关键主题\n- RAG\n## 结论\n- 需要嵌入"
  const s = parseSummary(raw)
  assert.deepEqual(s, {
    title: "RAG 与向量数据库",
    tldr: "讨论了检索增强生成。",
    body: "## 关键主题\n- RAG\n## 结论\n- 需要嵌入",
  })
})

test("parseSummary: sentinel → null", () => {
  assert.equal(parseSummary(NO_SUMMARY_CONTENT), null)
  assert.equal(parseSummary("  " + NO_SUMMARY_CONTENT + "  "), null)
})

test("parseSummary: empty / whitespace → null", () => {
  assert.equal(parseSummary(""), null)
  assert.equal(parseSummary("   \n  "), null)
})

test("parseSummary: code-fence-wrapped output is unwrapped and parsed", () => {
  const raw = "```\nTITLE: 被包裹的标题\nTLDR: 摘要\n## 关键主题\n- A\n```"
  const s = parseSummary(raw)
  assert.equal(s!.title, "被包裹的标题")
  assert.equal(s!.tldr, "摘要")
  assert.ok(s!.body.includes("## 关键主题"))
})

test("parseSummary: missing TITLE → empty title, body still returned", () => {
  const raw = "## 关键主题\n- A\n## 结论\n- B"
  const s = parseSummary(raw)
  assert.equal(s!.title, "")
  assert.ok(s!.body.includes("## 关键主题"))
  assert.equal(s!.tldr, undefined)
})

test("parseSummary: only a TITLE line, no body → null (emptiness guard)", () => {
  assert.equal(parseSummary("TITLE: 只有标题"), null)
  assert.equal(parseSummary("TITLE: x\nTLDR: y"), null)
})

test("parseSummary: TLDR optional; full-width colon tolerated", () => {
  const s = parseSummary("TITLE：全角冒号标题\n## 关键主题\n- A")
  assert.equal(s!.title, "全角冒号标题")
  assert.equal(s!.tldr, undefined)
})

// ---------- serializeSummaryToMarkdown ----------

const cfg: ObsidianExportConfig = {
  name_template: "{{date}} {{first_user_line}}",
  default_frontmatter: { tags: ["cmspark"] },
  vault_path: null,
}
const thread = { id: "t1", alias: "My Thread", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }
const convo: ExportMessage[] = [
  msg("u1", "user", "how does RAG work"),
  msg("a1", "assistant", "RAG retrieves relevant context"),
  msg("u2", "user", "and the vector db?"),
  msg("a2", "assistant", "it stores embeddings"),
]
const summary: ThreadSummary = {
  title: "RAG 与向量数据库",
  tldr: "讨论了 RAG 检索增强生成的原理与向量存储。",
  body: "## 关键主题\n- RAG\n- 向量数据库\n## 结论\n- RAG 需要嵌入模型",
}

test("serializeSummaryToMarkdown: frontmatter scope=summary + title + source; summary section + folded appendix", () => {
  const r = serializeSummaryToMarkdown(summary, convo, { config: cfg, thread })
  assert.match(r.content, /scope: summary/)
  assert.match(r.content, /title: RAG 与向量数据库/)
  assert.match(r.content, /source: cmspark:\/\/thread\/t1/)
  // summary section
  assert.match(r.content, /^# RAG 与向量数据库$/m)
  assert.match(r.content, /> 讨论了 RAG 检索增强生成/) // tldr blockquote
  assert.match(r.content, /## 关键主题/)
  // folded full-conversation appendix
  assert.match(r.content, /> \[!note\]- 完整对话/)
  assert.ok(r.content.includes("how does RAG work"), "appendix contains the real conversation")
  assert.ok(r.filename.endsWith(".md"))
})

test("serializeSummaryToMarkdown: footer wikilinks + template skeleton wrap; reserved source wins", () => {
  const r = serializeSummaryToMarkdown(summary, convo, {
    config: cfg,
    thread,
    relatedNotes: ["RAG 入门"],
    template: { name: "default", frontmatterRaw: "type: 对话摘要笔记", body: "# {{title}}\n\n{{content}}" },
  })
  assert.match(r.content, /## 相关笔记/)
  assert.match(r.content, /\[\[RAG 入门\]\]/)
  assert.match(r.content, /type: 对话摘要笔记/) // template frontmatter contributed
  assert.match(r.content, /source: cmspark:\/\/thread\/t1/) // reserved provenance wins
  // template provides the single H1 (no duplicate from the summary section)
  const h1matches = r.content.match(/^# .+$/gm)
  assert.ok(h1matches && h1matches.length === 1, `expected exactly one H1, got ${h1matches?.length}`)
})

test("serializeSummaryToMarkdown: empty summary.title falls back to thread alias", () => {
  const noTitle: ThreadSummary = { title: "", body: "## 关键主题\n- X" }
  const r = serializeSummaryToMarkdown(noTitle, convo, { config: cfg, thread })
  assert.match(r.content, /title: My Thread/)
  assert.match(r.content, /^# My Thread$/m)
})

test("serializeSummaryToMarkdown: no conversation messages → summary only, no appendix", () => {
  const r = serializeSummaryToMarkdown(summary, [], { config: cfg, thread })
  assert.match(r.content, /## 关键主题/)
  assert.ok(!r.content.includes("[!note]- 完整对话"), "no appendix when there are no messages")
})

// ---------- adversarial regression tests (P3-G1 review) ----------

test("buildSummaryTranscript: tiny budget still includes the opening question (never marker-only)", () => {
  // budget = min(floor(1000*0.4), 50000) = 400 < ~500 tokens/message → nothing would fit
  // under the old gate, but the opening question MUST still be sent.
  const t = buildSummaryTranscript(
    [
      msg("u1", "user", "x".repeat(2000)),
      msg("a1", "assistant", "y".repeat(2000)),
      msg("u2", "user", "z".repeat(2000)),
      msg("a2", "assistant", "w".repeat(2000)),
    ],
    1000,
  )
  assert.ok(t, "must return a transcript, not null")
  assert.match(t!, /🧑: /, "the opening question is always included")
})

test("buildSummaryTranscript: keeps small messages even when a neighbor is oversized (budget fill)", () => {
  const t = buildSummaryTranscript(
    [
      msg("u1", "user", "small1"),
      msg("a1", "assistant", "LARGE-" + "x".repeat(500)),
      msg("u2", "user", "small2"),
      msg("a2", "assistant", "LARGE-" + "x".repeat(500)),
      msg("u3", "user", "small3"),
      msg("a3", "assistant", "LARGE-" + "x".repeat(500)),
      msg("u4", "user", "small4"),
      msg("a4", "assistant", "LARGE-" + "x".repeat(500)),
    ],
    600,
  ) // budget = 240
  assert.ok(t!.includes("small2"), "a small message that fits must not be dropped for an oversized neighbor")
})

test("parseSummary: interior code block in body is preserved (no spurious fence unwrap)", () => {
  const raw = "TITLE: 调试脚本\nTLDR: 用如下脚本\n## 代码\n```bash\necho hi\n```\n## 结论\n- ok"
  const s = parseSummary(raw)
  assert.equal(s!.title, "调试脚本")
  assert.equal(s!.tldr, "用如下脚本")
  assert.ok(s!.body.includes("```bash"), "interior code fence preserved")
  assert.ok(s!.body.includes("## 结论"), "content after the code block preserved")
})

test("parseSummary: outer fence stripped while a nested code block survives", () => {
  const raw = "```\nTITLE: t\n## 代码\n```bash\necho hi\n```\n## 结论\n- ok\n```"
  const s = parseSummary(raw)
  assert.equal(s!.title, "t")
  assert.ok(s!.body.includes("```bash"))
  assert.ok(s!.body.includes("## 结论"))
})

test("parseSummary: leading preamble before TITLE is discarded; TITLE/TLDR still extracted", () => {
  const raw = "好的,这是摘要:\nTITLE: x\nTLDR: y\n## A\n- B"
  const s = parseSummary(raw)
  assert.equal(s!.title, "x")
  assert.equal(s!.tldr, "y")
  assert.equal(s!.body, "## A\n- B")
  assert.ok(!s!.body.includes("好的"), "preamble discarded from body")
})

test("parseSummary: fence opener with a digit / trailing space is still stripped", () => {
  const a = parseSummary("```markdown2\nTITLE: x\n## A\n- B\n```")
  assert.equal(a!.title, "x")
  assert.ok(a!.body.includes("## A"))
  const b = parseSummary("``` \nTITLE: x\n## A\n- B\n```")
  assert.equal(b!.title, "x")
})

test("parseSummary: CR-only (classic Mac) line endings are split correctly", () => {
  const s = parseSummary("TITLE: x\rTLDR: y\r## A\r- B")
  assert.equal(s!.title, "x")
  assert.equal(s!.tldr, "y")
  assert.equal(s!.body, "## A\n- B")
})

test("serializeSummaryToMarkdown: strips a leading H1 from the LLM body (single H1 in note)", () => {
  const s: ThreadSummary = { title: "T", body: "# My Own Heading\n\n## 关键主题\n- X" }
  const r = serializeSummaryToMarkdown(s, convo, { config: cfg, thread })
  const h1 = r.content.match(/^# .+$/gm)
  assert.ok(h1 && h1.length === 1, `expected exactly one H1, got ${h1?.length}`)
  assert.ok(!r.content.includes("My Own Heading"), "stray leading body H1 stripped")
})

test("serializeSummaryToMarkdown: filename falls back to summary title when no user message", () => {
  const s: ThreadSummary = { title: "Important Summary", body: "## X\n- Y" }
  const r = serializeSummaryToMarkdown(s, [msg("a1", "assistant", "assistant only")], { config: cfg, thread })
  assert.ok(
    r.filename.includes("Important Summary"),
    `filename should carry the title; got ${r.filename}`,
  )
})

