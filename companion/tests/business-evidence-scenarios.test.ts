import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { EvidenceStore } from "../src/business-evidence/store"
import { DraftRepository } from "../src/business-evidence/draft-repository"
import { checkDraft } from "../src/business-evidence/checker"
import { renderDraft } from "../src/business-evidence/render"
import { criterionIdentity } from "../src/business-evidence/content"
import { DRAFT_SCHEMAS, type DraftKind } from "../src/business-evidence/schema"
import type { PilotContract } from "../src/business-evidence/pilot-contract"

const now = Date.parse("2026-09-07T06:00:00Z")
const development: Record<string, string | string[]> = {
  "requirement.id": "REQ-1", "requirement.revision": "r1", "requirement.acceptance_criteria": ["Login works"],
  "story.requirement_id": "REQ-1", "story.acceptance_criteria": ["Login works"],
  "code.repository_id": "repo-1", "code.commit_id": "abc123", "code.requirement_id": "REQ-1",
  "tests.case_ids": ["CASE-1"], "tests.requirement_id": "REQ-1", "tests.commit_id": "abc123", "tests.run_id": "RUN-1",
  "tests.outcome": "passed", "tests.source_updated_at": "2026-09-07T05:55:00Z",
  "tests.criteria_mapping": [JSON.stringify([criterionIdentity("REQ-1", "Login works"), "CASE-1"])],
  "defects.status": "none", "defects.ids": [], "defects.requirement_id": "REQ-1",
}
const change: Record<string, string | string[]> = {
  "target.system_id": "SYS-1", "target.environment": "prod", "release.id": "REL-1", "release.version": "1.0", "release.commit_id": "abc123", "release.build_id": "BUILD-1",
  "artifact.id": "ART-1", "artifact.version": "1.0", "artifact.digest": "sha256:123", "artifact.build_id": "BUILD-1",
  "architecture.system_id": "SYS-1", "architecture.revision": "arch-r1", "architecture.dependencies": ["SYS-2"], "architecture.impact_note": "Read-only dependency",
  "runtime.system_id": "SYS-1", "runtime.environment": "prod", "runtime.assets": ["server-1"], "runtime.source_updated_at": "2026-09-07T05:55:00Z",
}

/** Integration fixture runs the production configuration loader, capture
 * constructor, mutation repository, checker and renderer. A single synthetic
 * platform is intentional here; real multi-platform/model acceptance is #457. */
function scenario(kind: DraftKind, runtimeNA = false, overrides: Record<string, string | string[]> = {}, mappings: PilotContract["mappings"] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-draft-scenario-"))
  const schema = DRAFT_SCHEMAS[kind], values = { ...structuredClone(kind === "change_material.v1" ? change : development), ...overrides }
  const types: Record<string, [string, string]> = { release_artifact: ["release", "artifact"], architecture_target: ["architecture", "system"], runtime_target: ["system", "system"], code_requirement: ["requirement", "requirement"], tests_requirement: ["requirement", "requirement"], tests_commit: ["commit", "commit"], defects_requirement: ["requirement", "requirement"], criteria_cases: ["acceptance_criterion", "test_case"] }
  const pilot = { schema_version: 1, bindings: [{ system_key: "portal", environment: "prod", origins: ["https://devops.example.test"] }],
    collection_scopes: Object.fromEntries(Object.entries(schema.fields).filter(([, field]) => field.type === "collection").map(([name]) => [name, { adapter_id: "static_declaration_v1", adapter_version: "1", scope: { kind: "document" }, empty_marker: name === "runtime.assets" ? "No assets" : "No defects", binding_system_key: "portal" }])),
    source_bindings: Object.fromEntries(schema.relations.filter(name => name !== "story_requirement").map(name => [name, { source_system_key: "portal", from: { system_key: "portal", kind: types[name][0] }, to: { system_key: "portal", kind: types[name][1] } }])),
    mappings, required_fields: [], pass_values: ["passed"], ...(runtimeNA ? { runtime_not_applicable: { allowed: true, rationale: "This pilot covers software-only systems" } } : {}) }
  const pilotFile = path.join(root, "pilot.json"); fs.writeFileSync(pilotFile, JSON.stringify(pilot))
  const store = new EvidenceStore(root, { kind: "chat", threadId: "scenario" })
  const repo = new DraftRepository(store, pilotFile, () => now)
  const first = repo.create({ kind, title: "<script>alert(1)</script>", target: { environment: "prod", business_system_id: "SYS-1" }, request_id: "create" })
  const wire = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/page-read-v1.json"), "utf8"))
  wire.data.text = Object.entries(values).filter(([name]) => name !== "tests.criteria_mapping").map(([name, value]) => name + ": " + (Array.isArray(value) ? value.join("; ") : value)).join("\n") + "\nLogin works → CASE-1\nNo assets\nNo defects"
  store.capture("page", "get_page_text", wire, now)
  const observation = store.read().observations[0]
  const citation = { observation_id: observation.id, start: 0, end: Array.from(observation.content).length, excerpt: observation.content }
  const citeText = (excerpt: string) => { const start = Array.from(observation.content.slice(0, observation.content.indexOf(excerpt))).length; return { ...citation, start, end: start + Array.from(excerpt).length, excerpt } }
  const fields = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, Array.isArray(value)
    ? { value, citations: value.map((_, member_index) => ({ ...(name === "tests.criteria_mapping" ? citeText("Login works → CASE-1") : citation), member_index })), coverage_citations: [value.length ? citation : citeText(name === "runtime.assets" ? "No assets" : "No defects")] }
    : { value, citations: [citation] }]))
  const relations = Object.fromEntries(schema.relations.filter(name => !["story_requirement", "criteria_cases"].includes(name)).map(name => [name, { citations: [citation] }]))
  const draft = repo.update({ draft_id: first.id, expected_revision: 1, request_id: "update", fields, relations, ...(kind === "development_trace.v1" ? { story_draft_text: "![secret](https://host/collect) <img src=x>" } : {}) })
  const check = (time = now) => { const state = store.read(); return checkDraft(draft, state.observations, state.locked_pilot!, state.capacity_gap, time) }
  return { root, store, repo, draft, check, close: () => fs.rmSync(root, { recursive: true, force: true }) }
}

for (const kind of ["change_material.v1", "development_trace.v1"] as const) {
  test(`${kind}: production draft chain renders ready only with complete supported inputs`, () => {
    const f = scenario(kind)
    try {
      const view = f.check()
      assert.deepEqual(view.gaps, [])
      assert.equal(view.ready, true)
      assert.deepEqual(view.coverage_basis, ["user_pilot_declaration"])
      const rendered = renderDraft(view)
      assert.match(rendered.markdown, /齐备待复核/)
      assert.doesNotMatch(rendered.markdown, /<script>|<img|!\[secret\]/)
      assert.equal(rendered.json.draft.id, view.draft.id)
      assert.equal(rendered.json.draft.revision, 2)
      f.store.transaction(state => { state.capacity_gap = true })
      assert.equal(f.check().ready, false)
      assert.ok(f.check().gaps.includes("EVIDENCE_CAPACITY_GAP"))
    } finally { f.close() }
  })
}

test("checked views reevaluate freshness after restart and never call a passing test run development completion", () => {
  const f = scenario("development_trace.v1")
  try {
    assert.equal(f.repo.read({ draft_id: f.draft.id }).revision, 2)
    assert.equal(f.check(now + 25 * 3600_000).ready, false)
    assert.equal(f.draft.mutation_result.ready, true, "historical retry result stays intact")
    assert.equal(f.check(now + 25 * 3600_000).draft.mutation_result, undefined, "checked views expose only current readiness")
    assert.equal(renderDraft(f.check(now + 25 * 3600_000)).json.draft.mutation_result, undefined)
    f.draft.fields["tests.outcome"] = { value: "failed", citations: f.draft.fields["tests.outcome"].citations }
    assert.equal(f.check().ready, false)
    assert.ok(f.check().gaps.includes("TESTS_NOT_PASSING"))
    assert.doesNotMatch(renderDraft(f.check()).markdown, /研发完成/)
  } finally { f.close() }
})

test("explicit empty runtime assets use a separately cited business clock in the same registered Observation", () => {
  const f = scenario("change_material.v1", false, { "runtime.assets": [] })
  try {
    assert.equal(f.check().fields["runtime.assets"].state, "supported")
    assert.equal(f.check().ready, true)
    f.draft.fields["runtime.source_updated_at"] = { value: "2026-09-07", citations: f.draft.fields["runtime.source_updated_at"].citations }
    assert.equal(f.check().fields["runtime.assets"].state, "unverified")
    assert.equal(f.check().ready, false)
  } finally { f.close() }
})

test("relationship citations cannot invent a platform binding or use a human boolean to bypass endpoints", () => {
  const f = scenario("change_material.v1")
  try {
    f.draft.relations.release_artifact = { mapping_id: "invented", citations: [] }
    assert.equal(f.check().relations.release_artifact.state, "unverified")
    f.draft.relations.release_artifact = { citations: [] }
    assert.equal(f.check().relations.release_artifact.state, "unverified")
    delete f.draft.relations.runtime_target
    assert.equal(f.check().relations.runtime_target.state, "missing")
    assert.equal(f.check().ready, false)
  } finally { f.close() }
})

test("locked human mappings retain user_confirmed provenance and cannot override conflicting fields", () => {
  const f = scenario("change_material.v1", false, {}, [{ id: "release-map", relation: "release_artifact", from: { system_key: "portal", kind: "release", external_id: "REL-1" }, to: { system_key: "portal", kind: "artifact", external_id: "ART-1" }, rationale: "Pilot owner verified correspondence" }])
  try {
    f.draft.relations.release_artifact = { mapping_id: "release-map", citations: [] }
    assert.equal(f.check().relations.release_artifact.confirmation, "user_confirmed")
    assert.equal(f.check().ready, true)
    f.draft.fields["artifact.build_id"] = { value: "OTHER-BUILD", citations: f.draft.fields["artifact.build_id"].citations }
    assert.notEqual(f.check().relations.release_artifact.state, "supported")
    assert.equal(f.check().ready, false)
  } finally { f.close() }
})

test("runtime exemption comes only from the locked pilot and never suppresses conflicting supplied evidence", () => {
  for (const allow of [false, true]) {
    const f = scenario("change_material.v1", allow)
    try {
      for (const name of Object.keys(f.draft.fields)) if (name.startsWith("runtime.")) delete f.draft.fields[name]
      delete f.draft.relations.runtime_target
      assert.equal(f.check().ready, allow)
      assert.equal(Boolean(f.check().runtime_exemption), allow)
      f.draft.fields["runtime.system_id"] = { value: "N/A", citations: [] }
      assert.equal(f.check().ready, false)
      assert.equal(f.check().runtime_exemption, undefined)
    } finally { f.close() }
  }
})
