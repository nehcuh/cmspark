import { test } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import {
  detectTemplates,
  pickTemplate,
  applyTemplate,
  substituteTemplateText,
  saveTemplates,
  loadCachedTemplates,
  isStrictlyInside,
  VaultTemplate,
} from "../src/obsidian/vault-templates"

function writeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  fs.mkdirSync(path.join(dir, ".obsidian"))
  fs.mkdirSync(path.join(dir, "Tpls"))
  fs.writeFileSync(path.join(dir, ".obsidian", "templates.json"), JSON.stringify({ folder: "Tpls" }))
  fs.writeFileSync(
    path.join(dir, "Tpls", "default.md"),
    "---\ntype: meeting\ntags: [会议]\ntitle: {{title}}\n---\n# {{title}}\n日期: {{date}}\n\n{{content}}",
  )
  fs.writeFileSync(
    path.join(dir, "Tpls", "other.md"),
    "---\n---\n<% tp.file.title %> <% tp.date.now(\"YYYY-MM-DD\") %> <% tp.unknown() %>",
  )
  return dir
}

test("detectTemplates: reads .obsidian/templates.json folder + parses templates", () => {
  const dir = writeVault()
  try {
    const t = detectTemplates(dir)
    assert.deepEqual(t.templates.map(x => x.name).sort(), ["default", "other"])
    const def = t.templates.find(x => x.name === "default")!
    assert.ok(def.frontmatterRaw.includes("type: meeting"))
    assert.ok(def.frontmatterRaw.includes("title: {{title}}")) // placeholder preserved raw, not YAML-mangled
    assert.ok(def.body.includes("{{content}}"))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("detectTemplates: falls back to templates/ folder when no .obsidian config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  try {
    fs.mkdirSync(path.join(dir, "templates"))
    fs.writeFileSync(path.join(dir, "templates", "note.md"), "---\n---\nbody")
    const t = detectTemplates(dir)
    assert.equal(t.templates.length, 1)
    assert.equal(t.templates[0].name, "note")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("detectTemplates: no template folder → empty (and pickTemplate null)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  try {
    const t = detectTemplates(dir)
    assert.equal(t.templates.length, 0)
    assert.equal(pickTemplate(t), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("pickTemplate: prefers default/默认, else first", () => {
  const mk = (names: string[]) => ({ vault_path: "/x", generated_at: "", templates: names.map(n => ({ name: n, frontmatterRaw: "", body: "" })) })
  assert.equal(pickTemplate(mk(["a", "default", "b"]) as any)!.name, "default")
  assert.equal(pickTemplate(mk(["a", "默认", "b"]) as any)!.name, "默认")
  assert.equal(pickTemplate(mk(["x", "y"]) as any)!.name, "x") // first when no default
})

test("substituteTemplateText: core {{...}} + common Templater; leaves unknown <% %>", () => {
  const vars = { title: "My Note", date: "2026-06-30", time: "1234", content: "X" }
  const s = substituteTemplateText(
    "{{title}} on {{date}} at {{time}} | <% tp.file.title %> <% tp.date.now(\"YYYY\") %> <% tp.unknown() %>",
    vars,
  )
  assert.ok(s.includes("My Note on 2026-06-30 at 1234"))
  assert.ok(s.includes("My Note")) // tp.file.title substituted
  assert.ok(s.includes("2026-06-30")) // tp.date.now substituted
  assert.ok(s.includes("<% tp.unknown() %>")) // unknown left as-is (no JS execution)
})

test("applyTemplate: substitutes placeholders + injects {{content}}", () => {
  const tpl: VaultTemplate = { name: "default", frontmatterRaw: "title: {{title}}\ntype: meeting", body: "# {{title}}\n\n{{content}}" }
  const applied = applyTemplate(tpl, { title: "RAG 笔记", date: "2026-06-30", time: "1200", content: "对话正文" })
  assert.equal(applied.frontmatter.title, "RAG 笔记")
  assert.equal(applied.frontmatter.type, "meeting")
  assert.ok(applied.body.includes("# RAG 笔记"))
  assert.ok(applied.body.includes("对话正文"))
})

test("applyTemplate: no {{content}} → content appended after template body", () => {
  const tpl: VaultTemplate = { name: "x", frontmatterRaw: "", body: "Header line" }
  const applied = applyTemplate(tpl, { title: "T", date: "2026-06-30", time: "1200", content: "BODY" })
  assert.ok(applied.body.startsWith("Header line"))
  assert.ok(applied.body.includes("BODY"))
})

test("applyTemplate: empty template body → content alone", () => {
  const tpl: VaultTemplate = { name: "x", frontmatterRaw: "", body: "" }
  const applied = applyTemplate(tpl, { title: "T", date: "2026-06-30", time: "1200", content: "BODY" })
  assert.equal(applied.body, "BODY")
})

test("saveTemplates / loadCachedTemplates: round-trip + vault_path gate", () => {
  const dir = writeVault()
  const file = path.join(dir, "templates.json")
  try {
    const t = detectTemplates(dir)
    saveTemplates(t, file)
    const loaded = loadCachedTemplates(dir, file)
    assert.ok(loaded)
    assert.equal(loaded!.templates.length, 2)
    assert.equal(loadCachedTemplates("/other", file), null)
    assert.equal(loadCachedTemplates(dir, path.join(dir, "nope.json")), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("applyTemplate: title with colon/URL does NOT drop other frontmatter keys (regression)", () => {
  const tpl: VaultTemplate = {
    name: "default",
    frontmatterRaw: "title: {{title}}\ntype: meeting\ntags: [note]\ndate: {{date}}",
    body: "{{content}}",
  }
  const applied = applyTemplate(tpl, { title: "How do I fix: error 500?", date: "2026-06-30", time: "1200", content: "BODY" })
  // ALL keys preserved (line parser — no yaml.load catch to swallow them)
  assert.equal(applied.frontmatter.title, "How do I fix: error 500?")
  assert.equal(applied.frontmatter.type, "meeting")
  assert.deepEqual(applied.frontmatter.tags, ["note"])
  assert.equal(applied.frontmatter.date, "2026-06-30") // stays string, not Date-coerced
})

test("detectTemplates: rejects ../ traversal in templates.json folder (containment)", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  const root = path.join(parent, "root")
  const sibling = path.join(parent, "sibling")
  fs.mkdirSync(root)
  fs.mkdirSync(sibling)
  fs.mkdirSync(path.join(root, ".obsidian"))
  fs.writeFileSync(path.join(root, ".obsidian", "templates.json"), JSON.stringify({ folder: "../sibling" }))
  fs.writeFileSync(path.join(sibling, "secret.md"), "---\ntoken: LEAKED\n---\nSECRET BODY")
  try {
    const t = detectTemplates(root)
    assert.equal(t.templates.length, 0) // traversal rejected → no templates
    assert.ok(!JSON.stringify(t).includes("LEAKED"), "must not read sibling files")
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test("detectTemplates: rejects a symlinked template folder that escapes the vault (realpath containment)", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  const root = path.join(parent, "root")
  const outside = path.join(parent, "outside")
  fs.mkdirSync(root)
  fs.mkdirSync(outside)
  fs.mkdirSync(path.join(root, ".obsidian"))
  fs.writeFileSync(path.join(outside, "secret.md"), "---\ntoken: LEAKED\n---\nSECRET BODY")
  // templates.json points to "Tpls", which is a symlink to a directory OUTSIDE the vault.
  fs.symlinkSync(outside, path.join(root, "Tpls"))
  fs.writeFileSync(path.join(root, ".obsidian", "templates.json"), JSON.stringify({ folder: "Tpls" }))
  try {
    const t = detectTemplates(root)
    assert.equal(t.templates.length, 0, "symlink escaping the vault must be rejected")
    assert.ok(!JSON.stringify(t).includes("LEAKED"), "must not read outside files via symlink")
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test("detectTemplates: rejects templates.json folder pointing at the vault root itself", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  const root = path.join(parent, "root")
  fs.mkdirSync(root)
  fs.mkdirSync(path.join(root, ".obsidian"))
  fs.writeFileSync(path.join(root, "a-root-note.md"), "---\ntitle: root note\n---\nbody")
  // folder "." resolves to the vault root — must be rejected (strictly-inside required).
  fs.writeFileSync(path.join(root, ".obsidian", "templates.json"), JSON.stringify({ folder: "." }))
  try {
    const t = detectTemplates(root)
    assert.equal(t.templates.length, 0, "vault root itself is not a valid templates folder")
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test("applyTemplate: CRLF template frontmatter does not leak \\r into values", () => {
  const tpl: VaultTemplate = {
    name: "default",
    frontmatterRaw: "title: {{title}}\r\ntype: meeting\r\n",
    body: "{{content}}",
  }
  const applied = applyTemplate(tpl, { title: "T", date: "2026-06-30", time: "1200", content: "BODY" })
  assert.equal(applied.frontmatter.title, "T")
  assert.equal(applied.frontmatter.type, "meeting")
  assert.ok(!JSON.stringify(applied.frontmatter).includes("\\r"), "no CR leaked into values")
})

test("isStrictlyInside: handles filesystem root '/' without producing '//' prefix", () => {
  assert.equal(isStrictlyInside("/templates", "/"), true)
  assert.equal(isStrictlyInside("/", "/"), false)
  assert.equal(isStrictlyInside("/tmp", "/"), true)
  assert.equal(isStrictlyInside("/templates/sub", "/templates"), true)
  assert.equal(isStrictlyInside("/templates", "/templates"), false)
})

test("detectTemplates: a file inside the template folder that is a symlink to outside is not read", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vault-internal-symlink-"))
  try {
    const root = path.join(parent, "root")
    const outside = path.join(parent, "outside")
    fs.mkdirSync(root)
    fs.mkdirSync(outside)
    fs.mkdirSync(path.join(root, "templates"))
    fs.writeFileSync(path.join(outside, "secret.md"), "---\ntoken: LEAKED\n---\nSECRET BODY")
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(root, "templates", "secret.md"))
    const t = detectTemplates(root)
    assert.equal(t.templates.length, 0, "internal file symlink to outside must not be read")
    assert.ok(!JSON.stringify(t).includes("LEAKED"), "outside secret not leaked via internal file symlink")
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

