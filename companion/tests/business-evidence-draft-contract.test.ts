import test from "node:test"
import assert from "node:assert/strict"
import { parseDraftCreate, parseDraftId, parseDraftUpdate } from "../src/business-evidence/draft-contract"

const base = { draft_id: "draft", expected_revision: 1, request_id: "update-1" }
const citation = { observation_id: "read", excerpt: "Café", start: 0, end: 4 }

test("draft commands accept only bounded business schemas and never caller scope or verification", () => {
  const request = { kind: "change_material.v1", title: "Change", target: { business_system_id: "SYS", environment: "prod" }, request_id: "create-1" }
  assert.equal(parseDraftCreate(request).kind, "change_material.v1")
  for (const extra of [{ scope: "other" }, { owner: "other" }, { supported: true }, { observation_id: "invented" }]) {
    assert.throws(() => parseDraftCreate({ ...request, ...extra }))
  }
  assert.throws(() => parseDraftCreate({ ...request, kind: "arbitrary_graph" }))
  assert.throws(() => parseDraftCreate({ ...request, request_id: " " }))
  assert.throws(() => parseDraftCreate({ ...request, request_id: "x".repeat(129) }))
  assert.throws(() => parseDraftCreate({ ...request, target: { environment: "prod" } }), /BUSINESS_SYSTEM_REQUIRED/)
  assert.equal(parseDraftId({ draft_id: "one" }), "one")
  assert.throws(() => parseDraftId({ draft_id: "one", scope: "other" }))
})

test("field updates preserve explicit null, normalize candidates and refuse invented states", () => {
  const parsed = parseDraftUpdate({ ...base, fields: { "release.id": { value: "Cafe\u0301", citations: [citation] } } }, "change_material.v1")
  assert.equal(parsed.fields?.["release.id"].value, "Café")
  assert.equal(parseDraftUpdate({ ...base, fields: { "release.id": { value: null, citations: [] } } }, "change_material.v1").fields?.["release.id"].value, null)
  for (const invalid of [
    { fields: { unknown: { value: "x", citations: [] } } },
    { fields: { "release.id": { value: "x", citations: [], state: "supported" } } },
    { fields: { "release.id": { value: "x", citations: [{ ...citation, member_index: 0 }] } } },
    { fields: { "release.id": { value: "x", citations: [{ ...citation, start: 1.5 }] } } },
    { expected_revision: 0 }, { scope: "other" },
  ]) assert.throws(() => parseDraftUpdate({ ...base, ...invalid }, "change_material.v1"))
})

test("collection members require unique normalized values and valid explicit member indexes", () => {
  const candidate = { value: ["Café"], citations: [{ ...citation, member_index: 0 }], coverage_citations: [citation] }
  assert.deepEqual(parseDraftUpdate({ ...base, fields: { "requirement.acceptance_criteria": candidate } }, "development_trace.v1").fields?.["requirement.acceptance_criteria"].value, ["Café"])
  for (const invalid of [
    { ...candidate, value: ["Café", "Cafe\u0301"] },
    { ...candidate, value: [" "] },
    { ...candidate, citations: [{ ...citation, member_index: 1 }] },
    { ...candidate, citations: [citation] },
    { ...candidate, value: null },
  ]) assert.throws(() => parseDraftUpdate({ ...base, fields: { "requirement.acceptance_criteria": invalid } }, "development_trace.v1"))
  assert.deepEqual(parseDraftUpdate({ ...base, fields: { "defects.ids": { value: [], citations: [], coverage_citations: [citation] } } }, "development_trace.v1").fields?.["defects.ids"].value, [])
})

test("story text stays creative and derived relationships cannot be forged or human-confirmed by model", () => {
  assert.equal(parseDraftUpdate({ ...base, story_draft_text: "A story without citations" }, "development_trace.v1").story_draft_text, "A story without citations")
  assert.throws(() => parseDraftUpdate({ ...base, story_draft_text: "wrong kind" }, "change_material.v1"), /STORY_DRAFT_NOT_APPLICABLE/)
  for (const name of ["criteria_cases", "story_requirement", "unknown"]) {
    assert.throws(() => parseDraftUpdate({ ...base, relations: { [name]: { citations: [], mapping_id: "invented" } } }, "development_trace.v1"), /INVALID_RELATION/)
  }
  assert.throws(() => parseDraftUpdate({ ...base, relations: { code_requirement: { citations: [], user_confirmed: true } } }, "development_trace.v1"))
})
