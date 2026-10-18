import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vm from "node:vm"
import { createRequire } from "node:module"
import * as ts from "typescript"
import { SkillEngine } from "../src/skills/skill-engine"
import { skillInstallOverwritePreview } from "../src/skills/skill-install"
import { scanVault, parseVaultProfile } from "../src/obsidian/vault-profiler"
import { detectTemplates } from "../src/obsidian/vault-templates"

const requireHere = createRequire(__filename)
const engines = requireHere("gray-matter/lib/engines")
const payload = (language = "js") => `---${language}\n({name:"owned-passive",description:"owned",type:"prompt_template"})\n---\nOwned body\n`
const sourceRoot = path.resolve(__dirname, "../../src")
const compiledRoot = path.resolve(__dirname, "../src")

function owned(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-passive-701-"))
  const original = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = fs.realpathSync(dir)
  try { run(fs.realpathSync(dir)) } finally {
    if (original === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = original
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function noJavascript(run: () => void): void {
  const original = engines.javascript.parse
  let calls = 0
  engines.javascript.parse = (...args: unknown[]) => { calls++; return original(...args) }
  try { run(); assert.equal(calls, 0, "untrusted frontmatter reached the executable engine") }
  finally { engines.javascript.parse = original }
}

// Resolve the actual import in each consumer, including the pre-fix import in RED.
function parserFor(relative: string): typeof import("gray-matter") {
  const text = fs.readFileSync(path.join(sourceRoot, relative), "utf8")
  const file = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true)
  const imports = file.statements.filter(ts.isImportDeclaration)
    .filter(n => n.importClause?.name?.text === "matter")
  assert.equal(imports.length, 1)
  const imported = createRequire(path.join(compiledRoot, relative.replace(/\.ts$/, ".js")))
    ((imports[0].moduleSpecifier as ts.StringLiteral).text)
  return imported.default || imported
}

// These private pack helpers are evaluated from their real TS function bodies;
// the router uses its real _folder.md try/catch. No server or pack authority runs.
function actualFunction(relative: string, name: string, bindings: Record<string, unknown>): (...args: any[]) => any {
  const text = fs.readFileSync(path.join(sourceRoot, relative), "utf8")
  const file = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true)
  const nodes = file.statements.filter(ts.isFunctionDeclaration).filter(n => n.name?.text === name)
  assert.equal(nodes.length, 1)
  const js = ts.transpileModule(nodes[0].getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return vm.runInNewContext(`${js}\n${name}`, { ...bindings, matter: parserFor(relative) })
}

test("701 SkillEngine public imports, preview, refresh and read never evaluate language frontmatter", () => owned(dir => {
  const engine = new SkillEngine()
  noJavascript(() => {
    assert.throws(() => engine.importSkill(payload()))
    // Knowledge retains its existing malformed-frontmatter-as-body fallback.
    const imported = engine.importKnowledge(payload(), "Owned fallback")
    assert.ok(engine.getKnowledge(imported.id)?.body.includes("---js"))
    assert.ok(engine.previewKnowledge(payload()).body.includes("---js"))
    fs.mkdirSync(path.join(dir, "skills"), { recursive: true })
    fs.writeFileSync(path.join(dir, "skills/owned-js.md"), payload())
    engine.refresh()
    assert.equal(engine.get("owned-passive"), undefined)
    engine.refresh()
    assert.ok(engine.getKnowledge(imported.id))
  })
}))

test("701 skill_install previews preserve null-name fallback without executing content/path/zip", () => owned(dir => {
  const AdmZip = requireHere("adm-zip")
  const zip = new AdmZip()
  zip.addFile("SKILL.md", Buffer.from(payload()))
  const zipPath = path.join(dir, "owned.zip")
  zip.writeZip(zipPath)
  const file = path.join(dir, "owned.md")
  fs.writeFileSync(file, payload())
  fs.mkdirSync(path.join(dir, "skill"))
  fs.writeFileSync(path.join(dir, "skill/SKILL.md"), payload())
  noJavascript(() => {
    for (const params of [{ content: payload() }, { path: file }, { path: path.join(dir, "skill") }, { zip_path: zipPath }]) {
      assert.equal(skillInstallOverwritePreview(params).name, null)
    }
  })
}))

test("701 pack name fallback and both copy helpers reject executable frontmatter before writing", () => owned(dir => {
  const relative = "packs/pack-engine.ts"
  let writes = 0
  const bindings = { fs, path, yaml: requireHere("js-yaml"), writeRestrictedFile: () => { writes++ } }
  const source = path.join(dir, "owned.md")
  fs.writeFileSync(source, payload())
  noJavascript(() => {
    assert.equal(actualFunction(relative, "extractFrontmatterName", bindings)(source), "owned")
    for (const name of ["rewriteSkillWithNamespacedName", "copyKnowledge"]) {
      assert.throws(() => actualFunction(relative, name, bindings)(source, path.join(dir, "out.md"), "owned-copy"))
    }
    assert.equal(writes, 0)
  })
}))

test("701 message-router actual folder metadata branch ignores executable header", () => owned(dir => {
  const relative = "message-router.ts"
  const text = fs.readFileSync(path.join(sourceRoot, relative), "utf8")
  const file = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true)
  const matches: ts.TryStatement[] = []
  function visit(n: ts.Node): void {
    if (ts.isTryStatement(n) && n.tryBlock.getText(file).includes('const parsed = matter(fs.readFileSync(full, "utf-8"))')) matches.push(n)
    ts.forEachChild(n, visit)
  }
  visit(file)
  assert.equal(matches.length, 1)
  const full = path.join(dir, "_folder.md")
  const carry = new Map()
  const js = ts.transpileModule(matches[0].getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const run = () => vm.runInNewContext(js, { fs, path, full, vaultPath: dir, folderMetaCarry: carry,
    folderForRelDir: () => ({ folder: "owned" }), matter: parserFor(relative) })
  noJavascript(() => { fs.writeFileSync(full, payload()); run(); assert.equal(carry.size, 0) })
  fs.writeFileSync(full, "---\ndescription: safe metadata\n---\n")
  run()
  assert.equal(carry.get("owned").description, "safe metadata")
}))

test("701 vault profiler skips malformed notes and returns null profile without evaluation", () => owned(dir => {
  fs.writeFileSync(path.join(dir, "owned.md"), payload())
  noJavascript(() => {
    const scan = scanVault(dir)
    assert.equal(scan.fileCount, 1)
    assert.equal(scan.samples.length, 0)
    assert.equal(parseVaultProfile(payload()), null)
  })
}))

test("701 vault template detection skips executable headers without evaluation", () => owned(dir => {
  fs.mkdirSync(path.join(dir, ".obsidian"))
  fs.mkdirSync(path.join(dir, "templates"))
  fs.writeFileSync(path.join(dir, ".obsidian/templates.json"), JSON.stringify({ folder: "templates" }))
  fs.writeFileSync(path.join(dir, "templates/owned.md"), payload())
  noJavascript(() => assert.equal(detectTemplates(dir).templates.length, 0))
}))

test("701 shared consumer parser preserves YAML/JSON/plain bodies, rejects JS aliases and ignores unsafe cache", () => {
  const parse = parserFor("skills/skill-engine.ts")
  noJavascript(() => {
    const originalEngine = engines.javascript.parse
    for (const language of ["js", "javascript", "JS", "JavaScript", " js "]) assert.throws(() => parse(payload(language)))
    assert.equal(engines.javascript.parse, originalEngine, "parser must not mutate global engines")
    for (const eol of ["\n", "\r\n"]) {
      const raw = ["---", "name: safe", "tags: [one, two]", "---", "Body", ""].join(eol)
      assert.equal(parse(raw).data.name, "safe")
      assert.equal(parse(raw).content, `Body${eol}`)
    }
    assert.equal(parse('---json\n{"name":"safe-json"}\n---\nBody').data.name, "safe-json")
    for (const language of ["yaml", "yml"]) assert.equal(parse(`---${language}\nname: safe-yaml\n---\nBody`).data.name, "safe-yaml")
    assert.throws(() => parse("---coffee\nname: unsupported\n---\nBody"))
    assert.equal(parse("# Plain body\n").content, "# Plain body\n")
    assert.throws(() => parse("---\nname: [\n---\nBody"))
    const originalMatter = requireHere("gray-matter")
    const cached = originalMatter.cache[payload()]
    originalMatter.cache[payload()] = { data: { name: "unsafe-cached" }, content: "cached" }
    try { assert.throws(() => parse(payload())) }
    finally { if (cached === undefined) delete originalMatter.cache[payload()]; else originalMatter.cache[payload()] = cached }
  })
})
