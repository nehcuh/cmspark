/** Real producer-recorded legacy entries, explicit clock/content mutations.
 * No invented tool-result keys or native/human acceptance claims. */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  resetSiteOpMemoryForTests, hydratePersistedSiteOpExperience, refreshPersistedSiteOpExperience,
  peekSiteOpBan, recordSiteOpFailure, getOriginFailCount, getReadOnlyOriginFailCount, autoSiteOpExperienceLine, locatorKeyForTool,
} from "../src/tool/site-op-memory"
import { siteExperienceIdentity } from "../src/skills/site-experience-identity"
import { SkillEngine } from "../src/skills/skill-engine"
import { initDataDir } from "../src/config"

const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-site-provenance-535-"))
before(async () => { process.env.CMSPARK_DATA_DIR = owned; await initDataDir() })
after(() => fs.rmSync(owned, { recursive: true, force: true }))
function historical() {
  // Populated from the actual RED adapter/SkillEngine producer, then timestamp
  // refreshed explicitly for a portable legacy replay rather than fake freshness.
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../tests/fixtures/site-op-channel-535-recorded.json"), "utf8"))
  return fixture.map((entry: any) => ({ ...entry, recorded_at: new Date().toISOString() }))
}

test("#535 legacy and selected hydrate cannot turn known channel health into locator ban", () => {
  resetSiteOpMemoryForTests()
  const entries = historical()
  assert.equal(hydratePersistedSiteOpExperience("legacy", "channel-fixture.test", entries), 0)
  assert.equal(refreshPersistedSiteOpExperience("selected", "https://channel-fixture.test", entries), 0)
  for (const scope of ["legacy", "selected"]) {
    assert.equal(peekSiteOpBan(scope, "wait_for", { tabId: 7, selector: "#fixture-0" }, "https://channel-fixture.test/page").banned, false)
    assert.equal(getOriginFailCount(scope, "https://channel-fixture.test"), 0)
  }
})

test("#535 mixed historical locator proofs remain live; stale selected evidence does not return", () => {
  resetSiteOpMemoryForTests()
  const origin = "https://channel-fixture.test"
  const recorded = historical()
  const locator = { ...recorded[0], content: autoSiteOpExperienceLine(origin, "get_element_info", locatorKeyForTool("get_element_info", { selector: "#known-missing" }), "ELEMENT_NOT_FOUND") }
  const entries = [...recorded, locator]
  assert.equal(refreshPersistedSiteOpExperience("mixed", origin, entries), 1)
  assert.equal(peekSiteOpBan("mixed", "click", { tabId: 7, selector: "#known-missing" }, origin).banned, true)
  assert.equal(refreshPersistedSiteOpExperience("mixed", origin, entries.map(e => ({ ...e, stale: true }))), 0)
  assert.equal(peekSiteOpBan("mixed", "click", { tabId: 7, selector: "#known-missing" }, origin).banned, false)
  for (let i=0;i<4;i++)recordSiteOpFailure("opaque", "wait_for", { tabId: 7, selector: `#opaque-${i}` }, undefined, origin)
  assert.equal(getReadOnlyOriginFailCount("opaque", origin), 4, "UNKNOWN remains a real conservative read-only health signal")
  assert.equal(getOriginFailCount("opaque", origin), 0, "read-only UNKNOWN must not consume the interaction budget")
})

test("#535 current knowledge projection suppresses channel-only auto summary and raw-body fallback", () => {
  const se = new SkillEngine(), identity = siteExperienceIdentity("channel-fixture.test")
  se.createExperienceSkill(identity.id, "site_knowledge", "channel-fixture.test", ["site-op-memory", "auto"], historical()[0])
  const file = se.get(identity.id)!.source_file
  const before = fs.readFileSync(file, "utf8")
  for (const routeByGroup of [false, true]) {
    const out = se.buildSystemPromptWithSources("projection", "channel-fixture.test", [], [identity.id], "controlled probe", { knowledgeMode:"manual", knowledgeRouteByGroup:routeByGroup, includeKnowledgeBlocks:true })
    assert.doesNotMatch(out.prompt, /WAIT_PROBE_FAILED|DO NOT retry wait_for/)
    assert.equal(out.knowledge_blocks?.length, 0)
  }
  const legacySelection = se.buildSystemPromptWithSources("legacy-projection", "channel-fixture.test")
  assert.doesNotMatch(legacySelection.prompt, /WAIT_PROBE_FAILED|DO NOT retry wait_for/, "legacy hostname selection must not inject the raw Markdown body")
  assert.equal(fs.readFileSync(file, "utf8"), before, "projection must not silently rewrite audit history")
})

test("#535 manual knowledge and true locator summaries are not blanket-filtered", () => {
  const se = new SkillEngine(), entry = historical()[0]
  se.createExperienceSkill("manual-535", "site_knowledge", "channel-fixture.test", ["manual"], entry)
  assert.match(se.getEntriesSummary("manual-535"), /WAIT_PROBE_FAILED/)
  assert.match(se.buildSystemPromptWithSources("manual-projection", "channel-fixture.test", [], ["manual-535"]).prompt, /WAIT_PROBE_FAILED/)
  const identity = siteExperienceIdentity("locator-projection.test")
  se.createExperienceSkill(identity.id, "site_knowledge", "locator-projection.test", ["site-op-memory","auto"], {
    ...entry, content:autoSiteOpExperienceLine("https://locator-projection.test", "click", "css:#missing", "ELEMENT_NOT_FOUND"),
  })
  assert.match(se.getEntriesSummary(identity.id), /ELEMENT_NOT_FOUND/)
  assert.match(se.buildSystemPromptWithSources("locator-projection", "locator-projection.test").prompt, /ELEMENT_NOT_FOUND/)
})

test("#535 r2 real serializer and reload preserve human Markdown alongside genuine locator evidence", () => {
  const se = new SkillEngine(), host = "human-note-535.test", identity = siteExperienceIdentity(host)
  const row = { ...historical()[0], content: autoSiteOpExperienceLine(`https://${host}`, "click", locatorKeyForTool("click", { selector: "#missing" }), "ELEMENT_NOT_FOUND") }
  se.createExperienceSkill(identity.id, "site_knowledge", host, ["auto", "site-op-memory"], row)
  const file = se.get(identity.id)!.source_file
  fs.appendFileSync(file, "\n\n# Human explanation\nThe approved documentation version is v7.\n")
  se.refresh()
  const before = fs.readFileSync(file, "utf8")
  const out = se.buildSystemPromptWithSources("human-note", host)
  assert.match(out.prompt, /The approved documentation version is v7\./)
  assert.match(out.prompt, /ELEMENT_NOT_FOUND/)
  assert.match(out.prompt, /source="knowledge"/)
  assert.equal(fs.readFileSync(file, "utf8"), before)
})

test("#535 r2 mixed serialized channel records retire only machine rows while human body and RAG survive", () => {
  const se = new SkillEngine(), host = "mixed-body-535.test", identity = siteExperienceIdentity(host)
  const recorded = historical()[0]
  se.createExperienceSkill(identity.id, "site_knowledge", host, ["auto", "site-op-memory"], recorded)
  // Declared code mutations of the real recorded producer shape; actual add/stale
  // serializer creates repeated historical blocks, not a fabricated Markdown row.
  for (const [i, code] of ["CDP_ATTACH_FAILED", "WRONG_ORIGIN", "ELEMENT_NOT_FOUND"].entries()) {
    se.addEntry(identity.id, { ...recorded, id: `mixed-${i}`, content: autoSiteOpExperienceLine(`https://${host}`, "click", locatorKeyForTool("click", { selector: `#mixed-${i}` }), code) })
  }
  se.markEntryStale(identity.id, recorded.id, "controlled historical channel")
  se.refresh()
  se.markEntryStale(identity.id, recorded.id, "updated historical explanation")
  const file = se.get(identity.id)!.source_file
  // Above the real 1000-token RAG threshold, below the unchanged total prompt
  // budget: an oversized indivisible paragraph must not make this test demand
  // that existing truncation limits be widened to reach its final needle.
  fs.appendFileSync(file, "\n\n# Human explanation\nReview the operator documentation version v7.\n" + ("controlled neutral paragraph. ".repeat(150)) + "\n\nneedle535manual human explanation remains searchable.\n")
  se.refresh()
  const before = fs.readFileSync(file, "utf8")
  for (const query of [undefined, "needle535manual"]) {
    const out = se.buildSystemPromptWithSources("mixed-body", host, undefined, undefined, query)
    assert.doesNotMatch(out.prompt, /last (WAIT_PROBE_FAILED|CDP_ATTACH_FAILED|WRONG_ORIGIN)/)
    assert.match(out.prompt, query ? /needle535manual/ : /operator documentation version v7/)
    assert.match(out.prompt, /source="knowledge"/)
  }
  assert.match(se.getEntriesSummary(identity.id), /WAIT_PROBE_FAILED/, "audit history is preserved")
  assert.equal(fs.readFileSync(file, "utf8"), before)
})

test("#535 r2 human prose, standalone rows and fenced serializer examples remain untrusted data", () => {
  const se = new SkillEngine(), host = "literal-body-535.test", identity = siteExperienceIdentity(host), row = historical()[0]
  se.createExperienceSkill(identity.id, "site_knowledge", host, ["auto", "site-op-memory"], row)
  const file = se.get(identity.id)!.source_file
  const machineRow = `- 🐛 ${row.content}`
  const note = `# Human explanation\nOperator notes mention WAIT_PROBE_FAILED.\n${machineRow}\n\n\`\`\`markdown\n# 记录列表\n\n${machineRow}\n\`\`\`\n`
  fs.appendFileSync(file, `\n\n${note}`); se.refresh()
  const before = fs.readFileSync(file, "utf8")
  const out = se.buildSystemPromptWithSources("literal-body", host)
  assert.match(out.prompt, /Operator notes mention WAIT_PROBE_FAILED\./)
  assert.ok(out.prompt.includes(note.trim()), "human literal examples must survive byte-for-byte before the existing sanitizer/wrapper")
  assert.equal(out.prompt.split(machineRow).length - 1, 2, "only the real serializer record block is retired")
  assert.match(out.prompt, /source="knowledge"/)
  assert.equal(fs.readFileSync(file, "utf8"), before)
})

test("#535 r3 actual repeated stale serialization accepts free-form marker and multiline reasons", async t => {
  for (const [variant, reason] of [["quoted-marker", "old note quotes [已过期: copied text]"], ["multiline", "old explanation\ncontinued note"]]) {
    for (const code of ["WAIT_PROBE_FAILED", "CDP_ATTACH_FAILED", "WRONG_ORIGIN"]) {
      await t.test(`${variant} ${code}`, () => {
        const se = new SkillEngine(), host = `r3-${variant}-${code.toLowerCase().replaceAll("_", "-")}.test`, identity = siteExperienceIdentity(host)
        const recorded = historical()[0], row = { ...recorded, content: autoSiteOpExperienceLine(`https://${host}`, "wait_for", locatorKeyForTool("wait_for", { selector: "#fixture" }), code) }
        se.createExperienceSkill(identity.id, "site_knowledge", host, ["auto", "site-op-memory"], row)
        se.markEntryStale(identity.id, row.id, reason); se.refresh()
        se.markEntryStale(identity.id, row.id, "new explanation"); se.refresh()
        const file = se.get(identity.id)!.source_file
        fs.appendFileSync(file, "\n\n# Human explanation\nThe operator note remains unchanged.\n")
        se.refresh()
        const before = fs.readFileSync(file, "utf8")
        const out = se.buildSystemPromptWithSources("r3-legacy", host)
        assert.ok(!out.prompt.includes(row.content), "retired actual serializer rule cannot re-enter through a previous free-form reason")
        assert.match(out.prompt, /The operator note remains unchanged\./)
        assert.match(se.getEntriesSummary(identity.id), new RegExp(code), "audit record remains")
        assert.equal(fs.readFileSync(file, "utf8"), before)
      })
    }
  }
})

test("#535 r4 actual multi-record serializer continuations cannot release later channel rows", async t => {
  const reasons = [
    ["multiline", "old explanation\ncontinued note", "new explanation\ncontinued note"],
    ["heading", "old note quotes [已过期: copied text]\n# 说明\n\n# 记录列表\ncontinued note", "new explanation\n# 说明\n\n# 记录列表\ncontinued note"],
    ["fence", "old explanation\n```markdown\n# 说明\n```\ncontinued note", "new explanation\n```markdown\n# 记录列表\n```\ncontinued note"],
  ]
  for (const [variant, oldReason, newReason] of reasons) {
    for (const first of ["channel", "locator", "manual-multiline"]) {
      await t.test(`${variant} first=${first}`, () => {
        const se = new SkillEngine(), host = `r4-${variant}-${first}.test`, identity = siteExperienceIdentity(host)
        const recorded = historical()[0]
        const a = { ...recorded, content: first === "manual-multiline" ? "Manual first record\nmanual continuation remains." : autoSiteOpExperienceLine(`https://${host}`, "wait_for", locatorKeyForTool("wait_for", { selector: "#first" }), first === "channel" ? "WAIT_PROBE_FAILED" : "ELEMENT_NOT_FOUND") }
        const b = { ...recorded, id: `r4-${variant}-${first}-second`, content: autoSiteOpExperienceLine(`https://${host}`, "wait_for", locatorKeyForTool("wait_for", { selector: "#second" }), "WAIT_PROBE_FAILED") }
        se.createExperienceSkill(identity.id, "site_knowledge", host, ["auto", "site-op-memory"], a)
        se.addEntry(identity.id, b); se.refresh()
        se.markEntryStale(identity.id, a.id, oldReason); se.refresh()
        se.markEntryStale(identity.id, a.id, newReason); se.refresh()
        const file = se.get(identity.id)!.source_file
        fs.appendFileSync(file, "\n\n# Human explanation\nThe approved operator note remains intact.\n")
        se.refresh()
        const before = fs.readFileSync(file, "utf8"), out = se.buildSystemPromptWithSources("r4-legacy", host)
        assert.ok(!out.prompt.includes(b.content), "later actual generated channel entry must not become outside-section prose")
        if (first === "channel") assert.ok(!out.prompt.includes(a.content))
        else assert.ok(out.prompt.includes(a.content), "genuine locator/manual entry survives with its continuation")
        assert.match(out.prompt, /The approved operator note remains intact\./)
        assert.match(out.prompt, /continued note/, "free-form reason continuation is retained as untrusted text")
        assert.ok(se.getEntriesSummary(identity.id).includes(b.content), "public audit is unchanged")
        assert.equal(fs.readFileSync(file, "utf8"), before)
      })
    }
  }
})

test("#535 r4 multi-record projection preserves later human standalone and fenced copies", () => {
  const se = new SkillEngine(), host = "r4-human-boundary.test", identity = siteExperienceIdentity(host), recorded = historical()[0]
  const a = { ...recorded, content: autoSiteOpExperienceLine(`https://${host}`, "click", "css:#first", "ELEMENT_NOT_FOUND") }
  const b = { ...recorded, id: "r4-human-second", content: autoSiteOpExperienceLine(`https://${host}`, "wait_for", "css:#second", "WAIT_PROBE_FAILED") }
  se.createExperienceSkill(identity.id, "site_knowledge", host, ["auto", "site-op-memory"], a)
  se.addEntry(identity.id, b); se.refresh()
  se.markEntryStale(identity.id, a.id, "old explanation\n# 说明\ncontinued note"); se.refresh()
  se.markEntryStale(identity.id, a.id, "new explanation\ncontinued note"); se.refresh()
  const file = se.get(identity.id)!.source_file, literal = `- 🐛 ${b.content}`
  const note = `# Human explanation\nHuman standalone example follows.\n${literal}\n\n\`\`\`markdown\n# 记录列表\n\n${literal}\n\`\`\`\n`
  fs.appendFileSync(file, `\n\n${note}`); se.refresh()
  const before = fs.readFileSync(file, "utf8"), out = se.buildSystemPromptWithSources("r4-boundary", host)
  assert.ok(out.prompt.includes(note.trim()))
  assert.equal(out.prompt.split(literal).length - 1, 2, "only the two declared human examples survive, not generated B rows")
  assert.ok(out.prompt.includes(a.content))
  assert.equal(fs.readFileSync(file, "utf8"), before)
})

test("#535 r5 actual historical reason cannot forge a serializer frame boundary", async t => {
  for (const [variant, oldReason, newReason] of [
    ["extra-blank", "old note quotes [已过期: copied text]\n\n# 说明\n\n# 记录列表\ncontinued note", "new explanation\n# 说明\n\n# 记录列表\ncontinued note"],
    ["frame-at-end", "old [已过期: quoted]\n\n# 说明\n\n# 记录列表", "new [已过期: quoted]\n\n# 说明\n\n# 记录列表"],
  ]) {
    for (const first of ["channel", "locator", "manual"]) await t.test(`${variant} first=${first}`, () => {
      const se = new SkillEngine(), host = `r5-${variant}-${first}.test`, identity = siteExperienceIdentity(host), recorded = historical()[0]
      const a = { ...recorded, content: first === "manual" ? "Manual first record\nmanual continuation remains." : autoSiteOpExperienceLine(`https://${host}`, "wait_for", locatorKeyForTool("wait_for", { selector: "#first" }), first === "channel" ? "WAIT_PROBE_FAILED" : "ELEMENT_NOT_FOUND") }
      const b = { ...recorded, id: `r5-${variant}-${first}-second`, content: autoSiteOpExperienceLine(`https://${host}`, "wait_for", locatorKeyForTool("wait_for", { selector: "#second" }), "WAIT_PROBE_FAILED") }
      se.createExperienceSkill(identity.id, "site_knowledge", host, ["auto", "site-op-memory"], a)
      se.addEntry(identity.id, b); se.refresh()
      se.markEntryStale(identity.id, a.id, oldReason); se.refresh()
      se.markEntryStale(identity.id, a.id, newReason); se.refresh()
      const file = se.get(identity.id)!.source_file
      fs.appendFileSync(file, "\n\n# Human explanation\nThe original operator note remains intact.\n")
      se.refresh()
      const before = fs.readFileSync(file, "utf8"), prompt = se.buildSystemPromptWithSources("r5-legacy", host).prompt
      assert.ok(!prompt.includes(b.content), "a free-form reason cannot make actual later B escape its owned record list")
      assert.equal(prompt.includes(a.content), first !== "channel")
      assert.match(prompt, /The original operator note remains intact\./)
      assert.ok(se.getEntriesSummary(identity.id).includes(b.content))
      assert.equal(fs.readFileSync(file, "utf8"), before)
    })
  }
})

test("#535 r5 owned ordering continues after a non-first stale record across four actual entries", () => {
  const se = new SkillEngine(), host = "r5-ordered-four.test", identity = siteExperienceIdentity(host), recorded = historical()[0]
  const a = { ...recorded, content: "Manual ordered first entry remains." }
  const b = { ...recorded, id: "ordered-b", content: autoSiteOpExperienceLine(`https://${host}`, "wait_for", "css:#b", "WAIT_PROBE_FAILED") }
  const c = { ...recorded, id: "ordered-c", content: autoSiteOpExperienceLine(`https://${host}`, "click", "css:#c", "ELEMENT_NOT_FOUND") }
  const d = { ...recorded, id: "ordered-d", content: autoSiteOpExperienceLine(`https://${host}`, "wait_for", "css:#d", "WRONG_ORIGIN") }
  se.createExperienceSkill(identity.id, "site_knowledge", host, ["auto", "site-op-memory"], a)
  for (const row of [b,c,d]) se.addEntry(identity.id, row)
  se.refresh()
  se.markEntryStale(identity.id, b.id, "old [已过期: quoted]\n\n# 说明\n\n# 记录列表\ncontinued"); se.refresh()
  se.markEntryStale(identity.id, b.id, "new [已过期: quoted]\n\n# 说明\n\n# 记录列表\ncontinued"); se.refresh()
  const file = se.get(identity.id)!.source_file
  fs.appendFileSync(file, "\n\n# Human explanation\nThe four-entry human note remains.\n"); se.refresh()
  const before = fs.readFileSync(file, "utf8"), skill = se.get(identity.id)!
  // Inspect the actual production projection before its existing truncation/RAG
  // budgets; this is not a second body implementation or a widened prompt cap.
  const projected = (se as any).projectAutomaticSiteExperienceBody(skill, skill.content) as string
  assert.ok(projected.includes(a.content)); assert.ok(projected.includes(c.content))
  assert.ok(!projected.includes(b.content)); assert.ok(!projected.includes(d.content))
  assert.match(projected, /The four-entry human note remains\./)
  const prompt = se.buildSystemPromptWithSources("r5-ordered", host, undefined, undefined, "four-entry human note").prompt
  assert.ok(!prompt.includes(b.content)); assert.ok(!prompt.includes(d.content))
  assert.ok(se.getEntriesSummary(identity.id).includes(b.content))
  assert.equal(fs.readFileSync(file, "utf8"), before)
})
