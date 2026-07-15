import test from "node:test"
import assert from "node:assert/strict"
import {
  buildMarkdown,
  slugify,
  escapeYaml,
  flattenTitle,
  timestampSlug,
} from "../src/notebooklm/markdown-builder"

test("slugify: ASCII title", () => {
  assert.equal(slugify("Hello World"), "hello-world")
})

test("slugify: CJK preserved", () => {
  assert.equal(slugify(" NotebookLM 导入测试 1 "), "notebooklm-导入测试-1")
})

test("slugify: empty falls back to 'untitled'", () => {
  assert.equal(slugify(""), "untitled")
  assert.equal(slugify("   "), "untitled")
  assert.equal(slugify("!!!"), "untitled")
})

test("slugify: path separators neutralized", () => {
  // CRITICAL: a title with '/' would corrupt the download path; slug must kill it.
  assert.equal(slugify("a/b\\c"), "a-b-c")
})

test("slugify: collapses runs of separators", () => {
  assert.equal(slugify("a   b---c"), "a-b-c")
})

test("slugify: caps at 40 chars", () => {
  const long = "a".repeat(200)
  assert.equal(slugify(long).length, 40)
})

test("escapeYaml: double-quote and backslash escaped", () => {
  assert.equal(escapeYaml('hello "world"'), '"hello \\"world\\""')
  assert.equal(escapeYaml("back\\slash"), '"back\\\\slash"')
})

test("escapeYaml: newlines flattened to single space (YAML injection guard)", () => {
  // Without this, a title like "evil\nmalicious: true\nleak:" would inject keys.
  const evil = "evil\nmalicious: true\nleak: yes"
  const out = escapeYaml(evil)
  assert.equal(out.includes("\n"), false)
  assert.equal(out.startsWith('"'), true)
})

test("escapeYaml: caps at 500 chars (plus escaping overhead)", () => {
  const long = "a".repeat(2000)
  const out = escapeYaml(long)
  // The inner content (between quotes) should be capped.
  const inner = out.slice(1, -1)
  assert.equal(inner.length <= 500, true)
})

test("escapeYaml: C0 control chars (tab/ESC/NUL) replaced with space (Phase 4 catch)", () => {
  // Without this, NotebookLM's YAML parser may reject the frontmatter.
  const dirty = "a\tb\x1bc\x00d"
  const out = escapeYaml(dirty)
  assert.equal(out.includes("\t"), false)
  assert.equal(out.includes("\x1b"), false)
  assert.equal(out.includes("\x00"), false)
})

test("flattenTitle: collapses whitespace and caps at 200", () => {
  assert.equal(flattenTitle("hello\n\n  world"), "hello world")
  const long = "a".repeat(500)
  assert.equal(flattenTitle(long).length, 200)
})

test("timestampSlug: YYYYMMDD-HHMMSS-mmm, all digits, UTC", () => {
  const d = new Date("2026-07-14T03:42:11.123Z")
  assert.equal(timestampSlug(d), "20260714-034211-123")
})

test("buildMarkdown: produces frontmatter + H1 + body + footer", () => {
  const result = buildMarkdown({
    title: "My Article",
    url: "https://example.com/article",
    text: "Body content here.",
    extractedAt: new Date("2026-07-14T03:42:11.123Z"),
  })
  assert.equal(result.content.startsWith('---\ntitle: "My Article"'), true)
  assert.equal(result.content.includes('source_url: "https://example.com/article"'), true)
  assert.equal(result.content.includes("# My Article"), true)
  assert.equal(result.content.includes("Body content here."), true)
  assert.equal(result.content.includes("NotebookLM]"), true)
  assert.equal(result.filename, "notebooklm-20260714-034211-123-my-article.md")
})

test("buildMarkdown: filename path-injection safe (title with slash)", () => {
  const result = buildMarkdown({
    title: "evil/path",
    url: "https://x.com",
    text: "x",
    extractedAt: new Date("2026-07-14T03:42:11.123Z"),
  })
  assert.equal(result.filename.includes("/"), false)
  assert.equal(result.filename.includes("evil-path"), true)
})

test("buildMarkdown: YAML-injection title stays single-line value", () => {
  const evil = "x\nmalicious: true\nleak:"
  const result = buildMarkdown({
    title: evil,
    url: "https://x.com",
    text: "body",
    extractedAt: new Date("2026-07-14T03:42:11.123Z"),
  })
  // The YAML block is between the first two '---' lines. The title value is wrapped in
  // double quotes (escapeYaml), so YAML sees one string — not three injected keys.
  // Assert by counting non-empty key lines: must be exactly the 4 known keys.
  const yamlBlock = result.content.split("---\n")[1]
  const keyLines = yamlBlock
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
  // Each line must start with one of the known keys (followed by ':').
  const knownKeys = ["title:", "source_url:", "extracted_at:", "extracted_via:"]
  for (const line of keyLines) {
    const matchesKnown = knownKeys.some(k => line.startsWith(k))
    assert.equal(matchesKnown, true, `unexpected YAML line: ${line}`)
  }
  assert.equal(keyLines.length, 4)
})

test("buildMarkdown: long body preserved verbatim", () => {
  const body = "line1\nline2\n\nline3"
  const result = buildMarkdown({
    title: "t",
    url: "u",
    text: body,
    extractedAt: new Date("2026-07-14T03:42:11.123Z"),
  })
  assert.equal(result.content.includes(body), true)
})
