import { test } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import {
  scanVault,
  parseVaultProfile,
  resolveVaultPath,
  saveProfile,
  loadCachedProfile,
  sanitizeTemplateName,
  VaultProfile,
} from "../src/obsidian/vault-profiler"

function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  fs.mkdirSync(path.join(dir, "notes"), { recursive: true })
  fs.mkdirSync(path.join(dir, ".obsidian"), { recursive: true })
  fs.writeFileSync(path.join(dir, "a.md"), "---\ntags: [项目/a]\ntitle: Apple\n---\n# Apple\nbody text one")
  fs.writeFileSync(path.join(dir, "notes", "b.md"), "---\ntags: [项目/b]\ncreated: 2026-01-01\n---\n# Banana\nbody two")
  fs.writeFileSync(path.join(dir, ".obsidian", "app.json"), "{}") // dot-dir → skipped
  fs.writeFileSync(path.join(dir, "readme.txt"), "not md") // non-md → skipped
  return dir
}

test("scanVault: collects .md, skips dot-dirs + non-md, parses frontmatter/body", () => {
  const dir = makeFixture()
  try {
    const { samples, fileCount } = scanVault(dir)
    assert.equal(fileCount, 2) // a.md + notes/b.md
    assert.equal(samples.length, 2)
    assert.deepEqual(
      samples.map(s => s.relPath).sort(),
      ["a.md", "notes/b.md"],
    )
    const a = samples.find(s => s.relPath === "a.md")!
    assert.deepEqual(a.frontmatter, { tags: ["项目/a"], title: "Apple" })
    assert.ok(a.bodyPreview.includes("Apple"))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("scanVault: counts ALL .md in fingerprint but caps samples at maxNotes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  try {
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `n${i}.md`), `# ${i}`)
    const { samples, fileCount, newestMtimeMs } = scanVault(dir, { maxNotes: 2 })
    assert.equal(fileCount, 5) // fingerprint counts all
    assert.equal(samples.length, 2) // sampling capped
    assert.ok(newestMtimeMs > 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("scanVault: empty/nonexistent vault returns empty samples, no throw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  try {
    const r = scanVault(dir)
    assert.equal(r.samples.length, 0)
    assert.equal(r.fileCount, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  // nonexistent dir: readdirSync fails → swallowed → empty
  const r2 = scanVault(path.join(os.tmpdir(), "definitely-not-here-" + Date.now()))
  assert.equal(r2.samples.length, 0)
})

test("parseVaultProfile: parses schema/tags/template from sample LLM output", () => {
  const llmOutput = `---
frontmatter_schema:
  - name: tags
    type: array
  - name: created
    type: date
tag_conventions:
  - 项目/
naming_pattern: YYYY-MM-DD 标题
note_name_template: "{{date}} {{first_user_line}}"
folder_structure: notes/ 存放主题笔记
wikilink_style: 频繁用 [[ ]] 互链
---`
  const p = parseVaultProfile(llmOutput)!
  assert.ok(p)
  assert.equal(p.frontmatter_schema.length, 2)
  assert.equal(p.frontmatter_schema[0].name, "tags")
  assert.equal(p.frontmatter_schema[0].type, "array")
  assert.equal(p.note_name_template, "{{date}} {{first_user_line}}")
  assert.ok(p.tag_conventions.includes("项目/"))
})

test("parseVaultProfile: strips code-block wrapping", () => {
  const wrapped = "```yaml\n---\nfrontmatter_schema: []\nnaming_pattern: flat\n---\n```"
  const p = parseVaultProfile(wrapped)
  assert.ok(p)
  assert.equal(p!.naming_pattern, "flat")
})

test("parseVaultProfile: sentinel + empty → null", () => {
  assert.equal(parseVaultProfile("NO_VAULT_STRUCTURE"), null)
  assert.equal(parseVaultProfile(""), null)
})

test("resolveVaultPath: rejects empty / null-byte, resolves absolute", () => {
  assert.throws(() => resolveVaultPath(""))
  assert.throws(() => resolveVaultPath("   "))
  assert.throws(() => resolveVaultPath("foo\0bar"))
  assert.ok(path.isAbsolute(resolveVaultPath("/tmp/x")))
})

test("parseVaultProfile: tolerates leading prose before a fenced frontmatter block (regression)", () => {
  const prose = "好的，这是我对 vault 的分析：\n```yaml\n---\nfrontmatter_schema:\n  - name: tags\n    type: array\nnaming_pattern: YYYY-MM-DD 标题\nwikilink_style: 常用 [[ ]]\n---\n```"
  const p = parseVaultProfile(prose)!
  assert.ok(p, "should parse despite leading prose + fence")
  assert.equal(p.frontmatter_schema.length, 1)
  assert.equal(p.frontmatter_schema[0].name, "tags")
  assert.equal(p.naming_pattern, "YYYY-MM-DD 标题")
})

test("parseVaultProfile: all-empty extraction → null (no garbage cached)", () => {
  // gray-matter parses but yields no recognized fields
  assert.equal(parseVaultProfile("---\nfoo: bar\n---\n"), null)
  // pure prose with no frontmatter → null
  assert.equal(parseVaultProfile("抱歉，这些笔记我分析不出结构。"), null)
})

test("parseVaultProfile: whitespace-only fields → null (no whitespace garbage cached)", () => {
  const ws = "---\nnaming_pattern: '   '\nfolder_structure: '   '\nwikilink_style: ' '\n---\n"
  assert.equal(parseVaultProfile(ws), null)
  // a real field alongside whitespace → kept (not nulled), whitespace trimmed
  const mixed = "---\nnaming_pattern: '  YYYY-MM-DD  '\nfolder_structure: ' '\n---\n"
  const p = parseVaultProfile(mixed)!
  assert.ok(p)
  assert.equal(p.naming_pattern, "YYYY-MM-DD")
})

test("sanitizeTemplateName: strips path separators / control chars / non-allowlist placeholders", () => {
  // path separators stripped → traversal neutralized (no / or \ can remain)
  const t1 = sanitizeTemplateName("../../../etc/passwd")
  assert.ok(t1 !== undefined)
  assert.ok(!t1!.includes("/"))
  assert.ok(!t1!.includes("\\"))
  // control chars (newline/tab) stripped
  assert.equal(sanitizeTemplateName("a\nb\tc"), "abc")
  // non-allowlist placeholder dropped; allowed kept
  assert.equal(sanitizeTemplateName("{{evil}} {{date}}"), "{{date}}")
  // result empty after sanitize → undefined
  assert.equal(sanitizeTemplateName("{{evil}}"), undefined)
  assert.equal(sanitizeTemplateName(""), undefined)
  // a legit template survives intact
  assert.equal(sanitizeTemplateName("{{date}} {{first_user_line}}"), "{{date}} {{first_user_line}}")
})

test("saveProfile/loadCachedProfile: vault_path resolved — trailing slash on load still matches", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  const profileFile = path.join(dir, "profile.json")
  try {
    const profile: VaultProfile = {
      vault_path: path.resolve(dir), // stored canonical (as profileVault now does)
      generated_at: "2026-01-01T00:00:00Z",
      files_sampled: 1,
      fingerprint: { file_count: 1, newest_mtime_ms: 0 },
      frontmatter_schema: [],
      tag_conventions: [],
      naming_pattern: "x",
      folder_structure: "",
      wikilink_style: "",
    }
    saveProfile(profile, profileFile)
    // load with a trailing slash — path.resolve normalizes → still matches
    assert.ok(loadCachedProfile(dir + "/", profileFile))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("saveProfile / loadCachedProfile: round-trip + vault_path match gate (tmp file, no user-data pollution)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  const profileFile = path.join(dir, "profile.json")
  try {
    const profile: VaultProfile = {
      vault_path: dir,
      generated_at: "2026-01-01T00:00:00Z",
      files_sampled: 1,
      fingerprint: { file_count: 1, newest_mtime_ms: 0 },
      frontmatter_schema: [{ name: "tags", type: "array" }],
      tag_conventions: [],
      naming_pattern: "x",
      folder_structure: "",
      wikilink_style: "",
    }
    saveProfile(profile, profileFile)
    const loaded = loadCachedProfile(dir, profileFile)
    assert.ok(loaded)
    assert.equal(loaded!.frontmatter_schema[0].name, "tags")
    // mismatch vault_path → null
    assert.equal(loadCachedProfile("/some/other/path", profileFile), null)
    // missing file → null
    assert.equal(loadCachedProfile(dir, path.join(dir, "nope.json")), null)
    // null vault → null
    assert.equal(loadCachedProfile(null, profileFile), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
