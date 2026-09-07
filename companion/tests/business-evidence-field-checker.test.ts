import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { EvidenceStore, type Observation } from "../src/business-evidence/store"
import { DraftRepository, type DraftRecord } from "../src/business-evidence/draft-repository"
import { parsePilotContract, type LockedPilotContract } from "../src/business-evidence/pilot-contract"
import { checkFields } from "../src/business-evidence/field-checker"
import { criterionIdentity } from "../src/business-evidence/content"
import { siteTargetFromBrowser } from "../src/site-context/target"

const now = Date.parse("2026-09-07T06:00:00Z")
const config = () => ({ schema_version: 1, bindings: [{ system_key: "devops", environment: "prod", origins: ["https://devops.example.test"] }],
  collection_scopes: Object.fromEntries(["requirement.acceptance_criteria", "story.acceptance_criteria", "tests.case_ids", "tests.criteria_mapping", "defects.ids"].map(name => [name,
    { adapter_id: "static_declaration_v1", adapter_version: "1", scope: { kind: "document" }, empty_marker: "No defects", binding_system_key: "devops" }])),
  source_bindings: { criteria_cases: { source_system_key: "devops", from: { system_key: "devops", kind: "acceptance_criterion" }, to: { system_key: "devops", kind: "test_case" } } },
  mappings: [], required_fields: [], pass_values: ["passed"] })

// All wire metadata comes from the actual producer recording. Each scenario
// substitutes only the page body (synthetic test content, not enterprise proof).
function fixture(text: string, kind: DraftRecord["kind"] = "development_trace.v1", locked = parsePilotContract(config())) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-field-check-"))
  const store = new EvidenceStore(root, { kind: "chat", threadId: "checker" })
  store.transaction(state => { state.locked_pilot = locked })
  const repo = new DraftRepository(store, path.join(root, "unused"), () => now)
  const draft = repo.create({ kind, title: "Review", target: { environment: "prod", business_system_id: "SYS-1" }, request_id: "create" })
  const wire = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/page-read-v1.json"), "utf8"))
  wire.data.text = text
  store.capture("read", "get_page_text", wire, now)
  const observation = store.read().observations[0]
  const cite = (excerpt = observation.content) => {
    const prefix = observation.content.slice(0, observation.content.indexOf(excerpt))
    const start = Array.from(prefix).length
    return { observation_id: observation.id, excerpt, start, end: start + Array.from(excerpt).length }
  }
  return { draft, observation, locked, cite, check: (obs: Observation[] = [observation], pilot: LockedPilotContract = locked) => checkFields(draft, obs, pilot, now), close: () => fs.rmSync(root, { recursive: true, force: true }) }
}

test("field checker accepts exact cited values but refuses missing, unrelated, cross-scope and clipped tokens", () => {
  const f = fixture("REQ-1 non-prod Café 😀")
  try {
    assert.equal(f.check()["requirement.id"].state, "missing")
    f.draft.fields["requirement.id"] = { value: "REQ-1", citations: [f.cite("REQ-1")] }
    assert.equal(f.check()["requirement.id"].state, "supported")
    assert.equal(f.check([])["requirement.id"].state, "unverified")
    f.draft.fields["requirement.id"] = { value: "prod", citations: [f.cite("prod")] }
    assert.equal(f.check()["requirement.id"].state, "unverified")
    f.draft.fields["requirement.id"] = { value: "REQ-1", citations: [{ ...f.cite("REQ-1"), end: 2 }] }
    assert.equal(f.check()["requirement.id"].state, "unverified")
    f.draft.fields["requirement.id"] = { value: null, citations: [] }
    assert.equal(f.check()["requirement.id"].state, "missing")
  } finally { f.close() }
})

test("bound wrong environment and inconsistent foreign keys are conflicts, not model-resolvable claims", () => {
  const f = fixture("REQ-1 REQ-2 abc def")
  try {
    f.draft.fields["requirement.id"] = { value: "REQ-1", citations: [f.cite()] }
    f.draft.fields["code.requirement_id"] = { value: "REQ-2", citations: [f.cite()] }
    assert.equal(f.check()["code.requirement_id"].state, "conflict")
    const other = config(); other.bindings[0].environment = "dev"
    assert.equal(f.check([f.observation], parsePilotContract(other))["requirement.id"].state, "conflict")
    f.draft.fields["code.commit_id"] = { value: "abc", citations: [f.cite()] }
    f.draft.fields["tests.commit_id"] = { value: "def", citations: [f.cite()] }
    assert.equal(f.check()["tests.commit_id"].state, "conflict")
  } finally { f.close() }
})

test("matching native IDs in two bound platforms do not merge into a supported scalar", () => {
  const config2 = config(); config2.bindings.push({ system_key: "code", environment: "prod", origins: ["https://code.example.test"] })
  const f = fixture("REQ-1", "development_trace.v1", parsePilotContract(config2))
  try {
    const second = { ...structuredClone(f.observation), id: "second-platform", target: siteTargetFromBrowser(8, "https://code.example.test/requirements", now)! }
    f.draft.fields["requirement.id"] = { value: "REQ-1", citations: [f.cite(), { ...f.cite(), observation_id: second.id }] }
    assert.deepEqual(f.check([f.observation, second])["requirement.id"].reasons, ["SOURCE_NAMESPACE_MISMATCH"])
  } finally { f.close() }
})

test("source business time is required in the same observation and cited range; collection coverage is independently required", () => {
  const f = fixture("SYS-1 prod server-1 2026-09-07T05:55:00Z", "change_material.v1")
  try {
    f.draft.fields["runtime.system_id"] = { value: "SYS-1", citations: [f.cite()] }
    assert.equal(f.check()["runtime.system_id"].state, "unverified")
    f.draft.fields["runtime.source_updated_at"] = { value: "2026-09-07T05:55:00Z", citations: [f.cite()] }
    assert.equal(f.check()["runtime.system_id"].state, "supported")
    f.draft.fields["runtime.system_id"] = { value: "SYS-1", citations: [f.cite("SYS-1")] }
    assert.equal(f.check()["runtime.system_id"].state, "unverified")
    f.draft.fields["runtime.assets"] = { value: ["server-1"], citations: [{ ...f.cite(), member_index: 0 }], coverage_citations: [f.cite()] }
    assert.equal(f.check()["runtime.assets"].state, "unverified")
  } finally { f.close() }
})

test("valid old times are stale, future times unverified, and scalar truncation does not imply collection completeness", () => {
  const f = fixture("REQ-1 No defects")
  try {
    f.draft.fields["requirement.id"] = { value: "REQ-1", citations: [f.cite()] }
    f.draft.fields["defects.ids"] = { value: [], citations: [], coverage_citations: [f.cite("No defects")] }
    assert.equal(f.check()["defects.ids"].state, "supported")
    const old = structuredClone(f.observation); old.observed_at = new Date(now - 25 * 3600_000).toISOString()
    assert.equal(f.check([old])["requirement.id"].state, "stale")
    const future = structuredClone(f.observation); future.observed_at = new Date(now + 6 * 60_000).toISOString()
    assert.equal(f.check([future])["requirement.id"].state, "unverified")
    const partial = structuredClone(f.observation); partial.provenance.complete_for_scope = false; partial.provenance.coverage = "partial"; partial.provenance.truncated = true
    assert.equal(f.check([partial])["requirement.id"].state, "supported")
    assert.equal(f.check([partial])["defects.ids"].state, "unverified")
    f.draft.fields["defects.ids"] = { value: [], citations: [], coverage_citations: [f.cite()] }
    assert.equal(f.check()["defects.ids"].state, "unverified")
  } finally { f.close() }
})

test("criteria mapping derives IDs from exact standards and requires all standards, known cases and locked namespaces", () => {
  const f = fixture("REQ-1\nCafé 😀 works → CASE-1\nOther criterion → CASE-2")
  try {
    f.draft.fields["requirement.id"] = { value: "REQ-1", citations: [f.cite()] }
    const criteria = ["Café 😀 works", "Other criterion"]
    f.draft.fields["requirement.acceptance_criteria"] = { value: criteria, citations: criteria.map((_, member_index) => ({ ...f.cite(), member_index })), coverage_citations: [f.cite()] }
    f.draft.fields["tests.case_ids"] = { value: ["CASE-1", "CASE-2"], citations: [0, 1].map(member_index => ({ ...f.cite(), member_index })), coverage_citations: [f.cite()] }
    const mapping = { value: criteria.map((text, i) => JSON.stringify([criterionIdentity("REQ-1", text), "CASE-" + (i + 1)])), citations: [0, 1].map(member_index => ({ ...f.cite(criteria[member_index] + " → CASE-" + (member_index + 1)), member_index })), coverage_citations: [f.cite()] }
    f.draft.fields["tests.criteria_mapping"] = mapping
    assert.equal(f.check()["tests.criteria_mapping"].state, "supported")
    const original = structuredClone(mapping)
    mapping.value = criteria.map((text, i) => JSON.stringify([criterionIdentity("REQ-1", text), "CASE-" + (2 - i)]))
    mapping.citations = [0, 1].map(member_index => ({ ...f.cite(), member_index }))
    assert.equal(f.check()["tests.criteria_mapping"].state, "unverified", "whole-page co-occurrence must not prove swapped relationships")
    Object.assign(mapping, original)
    mapping.value[0] = JSON.stringify([criterionIdentity("REQ-1", criteria[0]), "CASE-9"])
    assert.equal(f.check()["tests.criteria_mapping"].state, "unverified")
    mapping.value = [JSON.stringify([criterionIdentity("REQ-1", criteria[0]), "CASE-1"])]; mapping.citations = [mapping.citations[0]]
    assert.equal(f.check()["tests.criteria_mapping"].state, "unverified")
  } finally { f.close() }
})
