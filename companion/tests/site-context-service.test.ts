import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildSiteContext, knowledgeView } from "../src/site-context/service"
import { siteTargetFromBrowser } from "../src/site-context/target"

test("real engine projection preserves prompt and restricts export to selected knowledge", async () => {
  const root = mkdtempSync(join(tmpdir(), "cmspark-context-contract-"))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = root
  try {
    const { initDataDir } = await import("../src/config")
    await initDataDir()
    const { SkillEngine } = await import("../src/skills/skill-engine")
    const dir = join(root, "skills")
    mkdirSync(dir, { recursive: true })
    for (const [name, body] of [["selected", "Selected release instructions"], ["secret", "UNSELECTED_PRIVATE_DOCUMENT"]]) {
      writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ntype: site_knowledge\nsite: example.com\ndescription: ${name}\n---\n${body}\n`)
    }
    const engine = new SkillEngine()
    engine.createExperienceSkill("unknown-schema", "site_knowledge", "example.com", ["auto", "site-op-memory"], {
      schema_version: 2, id: "future", category: "problem", content: "future record",
      recorded_at: new Date().toISOString(), confirmed_at: null, stale: false, stale_reason: "", replaced_by: "",
    })
    engine.markEntryStale("unknown-schema", "future", "retain version on edit")
    engine.refresh()
    assert.equal(engine.get("unknown-schema")?.entries?.[0].schema_version, 2)

    const plain = engine.buildSystemPromptWithSources("scope", "example.com", [], ["selected"], "release", { knowledgeMode: "manual", knowledgeRouteByGroup: false })
    const projected = engine.buildSystemPromptWithSources("scope", "example.com", [], ["selected"], "release", { knowledgeMode: "manual", knowledgeRouteByGroup: false, includeKnowledgeBlocks: true })
    assert.equal(projected.prompt, plain.prompt)
    assert.deepEqual(projected.retrieved_sources, plain.retrieved_sources)
    assert.equal(plain.knowledge_blocks, undefined)
    assert.equal(projected.knowledge_blocks?.length, 1)
    const target = siteTargetFromBrowser(4, "https://example.com/releases?token=private", 1000)!
    const request = { scopeId: "scope", target, query: "release", selection: { kind: "explicit" as const, skillIds: [], knowledgeIds: ["selected"] }, options: { knowledgeMode: "auto" as const, knowledgeRouteByGroup: true }, now: 1000 }
    const built = await buildSiteContext(engine, request)
    assert.deepEqual(built.snapshot.knowledge, projected.knowledge_blocks)
    assert.ok(built.prompt.includes(plain.prompt))
    const view = knowledgeView(built.snapshot, new Set(["selected"]))
    const serialized = JSON.stringify(view)
    assert.equal(view.knowledge.length, 1)
    assert.ok(!serialized.includes("UNSELECTED_PRIVATE_DOCUMENT"))
    assert.ok(!serialized.includes("Safety Guard"))
    assert.ok(!serialized.includes("token=private"))
    assert.equal(knowledgeView(built.snapshot, new Set()).knowledge.length, 0)
    assert.equal((await buildSiteContext(engine, { ...request, now: 2000 })).snapshot.snapshot_id, built.snapshot.snapshot_id)
    writeFileSync(join(dir, "selected.md"), "---\nname: selected\ntype: site_knowledge\nsite: example.com\n---\nChanged release instructions\n")
    engine.refresh()
    assert.notEqual((await buildSiteContext(engine, request)).snapshot.snapshot_id, built.snapshot.snapshot_id)
    const hint = await buildSiteContext(engine, { ...request, target: undefined, hostnameHint: "example.com" })
    assert.equal(hint.snapshot.target_status, "hint")
    assert.throws(() => knowledgeView(hint.snapshot, new Set(["selected"])), /SITE_TARGET_UNAVAILABLE/)
  } finally {
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("thread selection is resolved afresh per target and does not mix concurrent scopes", async () => {
  const seen: string[] = []
  const fake = {
    resolveSkillIdsForThread: async (scope: string, _mode: unknown, _query: unknown, host?: string) => {
      seen.push(`${scope}:${host}`)
      await Promise.resolve()
      return [`skill:${scope}:${host}`]
    },
    resolveKnowledgeIdsForThread: (scope: string, _mode: unknown, host?: string) => [`knowledge:${scope}:${host}`],
    buildSystemPromptWithSources: (_scope: string, _host?: string, skills?: string[], ids?: string[]) => ({
      prompt: JSON.stringify(skills),
      retrieved_sources: [],
      knowledge_blocks: (ids || []).map(id => ({ source: { id, title: id, chars: 4 }, content: "data", document_version: "v1", content_kind: "summary" as const, truncated_by_budget: false })),
    }),
  }
  const selection = { kind: "thread" as const, skillMode: "auto" as const, knowledgeMode: "auto" as const, extraSkillIds: ["manual-skill"] }
  const [a, b] = await Promise.all([
    buildSiteContext(fake, { scopeId: "a", target: siteTargetFromBrowser(1, "https://one.test", 1000), query: "", selection }),
    buildSiteContext(fake, { scopeId: "b", target: siteTargetFromBrowser(2, "https://two.test", 1000), query: "", selection }),
  ])
  assert.deepEqual(a.snapshot.knowledge.map(k => k.source.id), ["knowledge:a:one.test"])
  assert.deepEqual(b.snapshot.knowledge.map(k => k.source.id), ["knowledge:b:two.test"])
  assert.ok(a.prompt.includes("manual-skill"))
  const changed = await buildSiteContext(fake, { scopeId: "a", target: siteTargetFromBrowser(1, "https://two.test", 2000), query: "", selection })
  assert.deepEqual(changed.snapshot.knowledge.map(k => k.source.id), ["knowledge:a:two.test"])
  assert.ok(!changed.prompt.includes("one.test"))
  assert.deepEqual(seen, ["a:one.test", "b:two.test", "a:two.test"])
})
