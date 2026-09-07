import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

test("both enterprise missions install and apply through the existing Pack engine without host/ACP/worker authority", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-evidence-packs-"))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = root
  try {
    const { initDataDir } = await import("../src/config")
    await initDataDir()
    const { SkillEngine } = await import("../src/skills/skill-engine")
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const { validatePackDir } = await import("../src/packs/validator")
    const { parsePilotContract } = await import("../src/business-evidence/pilot-contract")
    const example = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/examples/pilot-contract.v1.json"), "utf8"))
    const contract = parsePilotContract(example).contract!
    assert.equal(contract.bindings.length, 7)
    assert.equal(Object.keys(contract.collection_scopes).length, 7)
    assert.equal(Object.keys(contract.source_bindings).length, 8)
    assert.deepEqual(contract.pass_values, ["passed"])
    assert.equal(contract.freshness?.runtime_ms, 900000)
    assert.equal(contract.source_bindings.criteria_cases.from.kind, "acceptance_criterion")
    const packs = await import("../src/packs/pack-engine")
    const skills = new SkillEngine(), manager = new ThreadManager()
    for (const id of ["change-material", "development-trace"]) {
      const dir = path.join(__dirname, "../../src/packs/builtin", id)
      const validated = validatePackDir(dir)
      assert.equal(validated.ok, true, JSON.stringify(validated))
      if (!validated.ok) continue
      assert.equal(validated.manifest.kind, "mission")
      assert.deepEqual(validated.manifest.requires_modules, [])
      const installed = packs.installPackFromDirectory(dir, skills, { force: true })
      assert.equal(installed.ok, true, JSON.stringify(installed))
      const thread = manager.create(id, `pack-${id}`)
      const applied = packs.applyPack(id, thread.id, manager, skills)
      assert.equal(applied.ok, true, JSON.stringify(applied))
      for (const tool of ["draft_create", "draft_update", "draft_read", "draft_render", "code_review_create", "code_review_read", "code_review_assess", "code_review_render", "get_page_text", "get_page_html"]) assert.equal(manager.isToolAllowed(thread.id, tool, { cruiseOpen: false }), true)
      for (const tool of ["shell_exec", "host_computer", "evaluate", "spawn_worker", "acp_start_session", "mcp__remote__write"]) assert.equal(manager.isToolAllowed(thread.id, tool, { cruiseOpen: false }), false)
      assert.equal(packs.unapplyPack(thread.id, manager, skills).ok, true)
    }
  } finally {
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = previous
    fs.rmSync(root, { recursive: true, force: true })
  }
})
