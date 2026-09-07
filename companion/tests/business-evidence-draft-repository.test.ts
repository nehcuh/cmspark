import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { EvidenceStore, EVIDENCE_LIMITS } from "../src/business-evidence/store"
import { DraftRepository } from "../src/business-evidence/draft-repository"
import { evidenceScopeHash } from "../src/business-evidence/content"
import { BusinessEvidenceService } from "../src/business-evidence/service"

const create = (request_id = "create") => ({ kind: "development_trace.v1", title: "Story", target: { environment: "prod" }, request_id })
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-draft-repo-"))
  const scope = { kind: "chat" as const, threadId: "thread" }
  const store = new EvidenceStore(root, scope)
  const pilot = path.join(root, "pilot.json")
  return { root, scope, store, pilot, repo: new DraftRepository(store, pilot, () => Date.parse("2026-09-07T00:00:00Z")),
    file: path.join(root, "business-evidence-v1", evidenceScopeHash(scope) + ".json"),
    close: () => fs.rmSync(root, { recursive: true, force: true }) }
}

test("drafts lock missing configuration, keep independent scope, and preserve the lock after configuration changes", () => {
  const f = fixture()
  try {
    const first = f.repo.create(create())
    assert.equal(first.revision, 1)
    assert.deepEqual(first.fields, {})
    assert.equal(f.store.read().locked_pilot?.contract, null)
    fs.writeFileSync(f.pilot, '{"schema_version":999}')
    assert.equal(f.repo.create(create("second")).pilot_digest, first.pilot_digest)
    const other = new DraftRepository(new EvidenceStore(f.root, { kind: "mcp", grantId: "thread", sessionId: "thread" }), f.pilot)
    assert.throws(() => other.read({ draft_id: first.id }), /DRAFT_NOT_FOUND/)
    assert.throws(() => other.update({ draft_id: first.id, expected_revision: 1, request_id: "update" }), /DRAFT_NOT_FOUND/)
    assert.throws(() => other.create(create()), /PILOT_CONTRACT_SCHEMA_UNSUPPORTED/)
    assert.equal(new EvidenceStore(f.root, { kind: "mcp", grantId: "thread", sessionId: "thread" }).read().drafts.length, 0)
  } finally { f.close() }
})

test("idempotency returns the original revision before stale-revision checks and conflicts on changed parameters", () => {
  const f = fixture()
  try {
    const first = f.repo.create(create())
    const update = { draft_id: first.id, expected_revision: 1, request_id: "update", fields: { "requirement.id": { value: "REQ-1", citations: [] } } }
    const second = f.repo.update(update)
    assert.equal(second.revision, 2)
    const third = f.repo.update({ draft_id: first.id, expected_revision: 2, request_id: "third", story_draft_text: "Creative" })
    assert.equal(third.revision, 3)
    assert.deepEqual(f.repo.update(update), second)
    assert.deepEqual(f.repo.create(create()), first)
    assert.throws(() => f.repo.update({ ...update, expected_revision: 3 }), /IDEMPOTENCY_CONFLICT/)
    assert.throws(() => f.repo.update({ ...update, request_id: "stale" }), /DRAFT_REVISION_CONFLICT/)
    assert.throws(() => f.repo.create({ ...create(), title: "Changed" }), /IDEMPOTENCY_CONFLICT/)
    second.fields["requirement.id"].value = "mutated by caller"
    assert.equal(f.repo.update(update).fields["requirement.id"].value, "REQ-1")
    assert.equal(f.repo.read({ draft_id: first.id }).revision, 3)
  } finally { f.close() }
})

test("fresh repository instances serialize competing revisions without losing fields or extension data", async () => {
  const f = fixture()
  try {
    const first = f.repo.create(create())
    f.store.transaction(state => { state.drafts[0].future_extension = { keep: true } })
    const other = new DraftRepository(new EvidenceStore(f.root, f.scope), f.pilot)
    const outcomes = await Promise.allSettled([f.repo, other].map((repo, i) => Promise.resolve().then(() => repo.update({ draft_id: first.id, expected_revision: 1, request_id: "race-" + i, story_draft_text: "story-" + i }))))
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1)
    assert.match(String((outcomes.find(outcome => outcome.status === "rejected") as PromiseRejectedResult).reason), /DRAFT_REVISION_CONFLICT/)
    const result = other.update({ draft_id: first.id, expected_revision: 2, request_id: "delete", story_draft_text: null, fields: { "requirement.id": { value: null, citations: [] } } })
    assert.equal(result.story_draft_text, null)
    assert.equal(result.fields["requirement.id"].value, null)
    assert.deepEqual(result.future_extension, { keep: true })
  } finally { f.close() }
})

test("mutation overflow preserves bytes, references and replay; draft count never evicts older drafts", () => {
  const f = fixture()
  try {
    const first = f.repo.create(create())
    let before = fs.readFileSync(f.file, "utf8")
    assert.throws(() => f.repo.update({ draft_id: first.id, expected_revision: 1, request_id: "huge", story_draft_text: "x".repeat(EVIDENCE_LIMITS.scopeBytes) }), /EVIDENCE_CAPACITY/)
    assert.equal(fs.readFileSync(f.file, "utf8"), before)
    for (let i = 1; i < 16; i++) f.repo.create(create(String(i)))
    before = fs.readFileSync(f.file, "utf8")
    assert.throws(() => f.repo.create(create("overflow")), /EVIDENCE_CAPACITY/)
    assert.equal(fs.readFileSync(f.file, "utf8"), before)
    assert.deepEqual(f.repo.create(create()), first)
    assert.equal(f.store.read().drafts.length, 16)
  } finally { f.close() }
})

test("unknown draft versions, malformed replay and duplicate identities fail closed without overwriting", () => {
  const f = fixture()
  try {
    const first = f.repo.create(create())
    const original = fs.readFileSync(f.file, "utf8")
    const corruptions = [
      (state: any) => { state.drafts[0].schema_version = 2 },
      (state: any) => { state.drafts.push(state.drafts[0]) },
      (state: any) => { state.draft_requests[0].digest = "bad" },
      (state: any) => { state.drafts[0].fields["invented"] = { value: "x", citations: [] } },
    ]
    for (const corrupt of corruptions) {
      const state = JSON.parse(original); corrupt(state)
      const bad = JSON.stringify(state); fs.writeFileSync(f.file, bad)
      assert.throws(() => f.repo.read({ draft_id: first.id }))
      assert.throws(() => f.repo.create(create("another")))
      assert.equal(fs.readFileSync(f.file, "utf8"), bad)
    }
  } finally { f.close() }
})

test("public service mutation replies replay exactly while read/render uses the current clock", () => {
  const f = fixture()
  try {
    let clock = Date.parse("2026-09-07T00:00:00Z")
    const service = new BusinessEvidenceService(f.root, f.scope, () => clock)
    const first = service.create(create())
    assert.equal(first.ready, false)
    const request = { draft_id: first.draft_id, expected_revision: 1, request_id: "edit", story_draft_text: "Story" }
    const edited = service.update(request)
    clock += 24 * 3600_000
    assert.deepEqual(service.create(create()), first)
    assert.deepEqual(service.update(request), edited)
    assert.notEqual(service.read({ draft_id: first.draft_id }).checked_at, edited.checked_at)
    assert.equal(service.render({ draft_id: first.draft_id }).json.draft.revision, 2)
  } finally { f.close() }
})
