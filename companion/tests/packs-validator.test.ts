import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-packs-val-"))

let validatePackDir: typeof import("../src/packs/validator").validatePackDir

before(async () => {
  process.env.HOME = tempHome
  delete process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  const mod = await import("../src/packs/validator")
  validatePackDir = mod.validatePackDir
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function makePack(root: string, yamlBody: string, files: Record<string, string> = {}) {
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, "pack.yaml"), yamlBody)
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
}

const baseYaml = (toolsAllow: string) => `
schema_version: 1
id: test-pack
name: Test
version: 0.1.0
channel: community
min_capability: L1
requires_modules: []
skills: []
knowledge: []
mcp_servers: []
tools:
  mode: allowlist
  allow: ${toolsAllow}
  deny: []
system_prompt_append: "hi"
`

test("rejects unknown tool in allow", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  makePack(dir, baseYaml("[this_tool_does_not_exist]"))
  const r = validatePackDir(dir)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /unknown tool/i)
})

// --- #367: Pack kind field ---

test("kind absent validates (legacy pack → mission semantics at read sites)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  makePack(dir, baseYaml("[list_tabs]"))
  const r = validatePackDir(dir)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.manifest.kind, undefined)
})

test("kind: expert validates and round-trips into the manifest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  makePack(dir, baseYaml("[list_tabs]").replace("channel: community", "channel: community\nkind: expert"))
  const r = validatePackDir(dir)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.manifest.kind, "expert")
})

test("kind: mission validates explicitly", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  makePack(dir, baseYaml("[list_tabs]").replace("channel: community", "channel: community\nkind: mission"))
  const r = validatePackDir(dir)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.manifest.kind, "mission")
})

test("unknown kind value fails validation (never silently dropped)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  makePack(dir, baseYaml("[list_tabs]").replace("channel: community", "channel: community\nkind: agent"))
  const r = validatePackDir(dir)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /kind must be mission\|expert/)
})

test("accepts known tools", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  makePack(dir, baseYaml("[list_tabs, get_page_html]"))
  const r = validatePackDir(dir)
  assert.equal(r.ok, true)
})

test("rejects path escape in skills", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  // create a file outside and try to reference with ..
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.md`)
  fs.writeFileSync(outside, "x")
  makePack(
    dir,
    `
schema_version: 1
id: escape-pack
name: Escape
version: 0.1.0
channel: community
min_capability: L0
requires_modules: []
skills: ["${path.relative(dir, outside)}"]
knowledge: []
mcp_servers: []
tools: { mode: unchanged, allow: [], deny: [] }
system_prompt_append: "x"
`,
  )
  const r = validatePackDir(dir)
  // relative path that escapes should fail containment
  assert.equal(r.ok, false)
  try {
    fs.unlinkSync(outside)
  } catch {
    /* ignore */
  }
})

test("rejects security blocklist keys in thread_defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  makePack(
    dir,
    `
schema_version: 1
id: bad-sec
name: Bad
version: 0.1.0
channel: community
min_capability: L0
requires_modules: []
skills: []
knowledge: []
mcp_servers: []
tools: { mode: unchanged, allow: [], deny: [] }
system_prompt_append: "x"
thread_defaults:
  auto_approve_dangerous: true
`,
  )
  const r = validatePackDir(dir)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /forbidden|auto_approve/i)
})
