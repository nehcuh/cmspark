import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { EvidenceStore } from "../src/business-evidence/store"
import { evidenceScopeHash, normalizeEvidenceText } from "../src/business-evidence/content"
import { CodeReviewService } from "../src/code-review/service"
import { canonicalRepository } from "../src/code-review/contract"
import { executeCodeReviewTool } from "../src/code-review/executor"
import { parseUnifiedDiff } from "../src/code-review/diff"
import { isPlanReadonlyAllowed } from "../src/tool/plan-readonly"
import { COMPANION_TOOLS } from "../src/bridge/companion-tools"
import { CODE_REVIEW_TOOL_DEFINITIONS } from "../src/code-review/tool-definitions"
import { BusinessEvidenceService } from "../src/business-evidence/service"
import { renderReviewMaterial } from "../src/code-review/material"
import { reviewPrompt } from "../src/code-review/report"

// Actual Git + production BrowserBridge wire, recorded by record-code-diff-fixture.mjs.
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/web-code-diff-v1.json"), "utf8"))
function setup(t: { after: (fn: () => void) => void }, wire = structuredClone(fixture.wire)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-review-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const scope = { kind: "chat" as const, threadId: "original" }
  const store = new EvidenceStore(dir, scope)
  const captured = store.capture("real-browser-call", "get_page_text", wire)
  assert.equal(captured.capture_status, "captured")
  if (captured.capture_status !== "captured") throw new Error("fixture failed")
  const content = normalizeEvidenceText(wire.data.text)
  const points = Array.from(content), start = Array.from(content.slice(0, content.indexOf("diff --git"))).length
  const input = { request_id: "first", repository: fixture.git.repository, base: fixture.git.base, head: fixture.git.head,
    diff: { observation_id: captured.observation_id, excerpt: points.slice(start).join(""), start, end: points.length },
    identity_citations: [{ observation_id: captured.observation_id, excerpt: points.slice(0, start).join(""), start: 0, end: start }] }
  return { dir, scope, store, input, service: new CodeReviewService(dir, scope) }
}

test("web path consumes actual producer diff and persists exact old/new lines without an Agent", t => {
  const f = setup(t)
  const view = f.service.create(f.input)
  assert.equal(view.files[0].new_path, "hello.ts")
  assert.deepEqual(view.files[0].lines, [
    { text: 'export const greeting = "hello"', old_line: 1, new_line: null },
    { text: 'export const greeting = "你好"', old_line: null, new_line: 1 },
    { text: "export const enabled = true", old_line: null, new_line: 2 },
  ])
  assert.equal(view.identity_state, "page_text_present")
  assert.equal(view.review_ready, false)
  assert.ok(view.gaps.includes("WEB_DIFF_COVERAGE_UNKNOWN"))
  assert.ok(view.gaps.includes("HOST_COMPARISON_UNVERIFIED"))
  assert.deepEqual(new CodeReviewService(f.dir, f.scope).read({ review_id: view.review_id }), view)
  assert.deepEqual(f.service.create(f.input), view)
  assert.throws(() => f.service.create({ ...f.input, head: "f".repeat(40) }), /REQUEST_CONFLICT/)
})

test("scope isolation, unknown fields and mutable identity are rejected", t => {
  const f = setup(t), view = f.service.create(f.input)
  assert.throws(() => new CodeReviewService(f.dir, { kind: "chat", threadId: "other" }).read({ review_id: view.review_id }), /NOT_FOUND/)
  assert.equal(executeCodeReviewTool(f.dir, undefined, "code_review_create", f.input).success, false)
  assert.equal(executeCodeReviewTool(f.dir, f.scope, "code_review_create", { ...f.input, thread_id: "other" }).success, false)
  assert.equal(executeCodeReviewTool(f.dir, f.scope, "code_review_create", { ...f.input, base: "main" }).success, false)
  assert.throws(() => f.service.create({ ...f.input, request_id: "bad", diff: { ...f.input.diff, excerpt: fixture.git.diff + "+fake" } }), /CITATION_INVALID/)
})

test("normalized equivalent citations parse the authoritative NFC/LF observation slice", t => {
  const wire = structuredClone(fixture.wire)
  wire.data.text = wire.data.text.replace("你好", "Café")
  const f = setup(t, wire)
  const ordinary = f.service.create(f.input)
  const equivalent = f.service.create({ ...f.input, request_id: "equivalent", diff: {
    ...f.input.diff, excerpt: f.input.diff.excerpt.normalize("NFD").replaceAll("\n", "\r\n"),
  } })
  assert.deepEqual(equivalent.files, ordinary.files)
  assert.equal(equivalent.diff_hash, ordinary.diff_hash)
})

test("confirmed external report validates all code references and binds receipt to scope/hash", t => {
  const f = setup(t), view = f.service.create(f.input)
  const report = { review_id: view.review_id, repository: view.repository, base: view.base, head: view.head, diff_hash: view.diff_hash,
    status: "completed", summary: "Review assessment", reviewed_files: ["hello.ts"], findings: [
      { severity: "minor", summary: "Check behavior", path: "hello.ts", side: "new", line: 2 },
    ], mappings: [] }
  assert.throws(() => f.service.receive({ ...report, findings: [...report.findings, { ...report.findings[0], line: 3 }] }), /LINE_INVALID/)
  assert.throws(() => f.service.receive({ ...report, diff_hash: "f".repeat(64) }), /IDENTITY_MISMATCH/)
  assert.equal(f.service.read({ review_id: view.review_id }).receipt, null)
  const receipt = f.service.receive(report)
  assert.deepEqual(f.service.receive(JSON.parse(JSON.stringify(report, null, 2))), receipt)
  const result = f.service.read({ review_id: view.review_id })
  assert.equal(result.review_ready, false)
  assert.ok(result.gaps.includes("CODE_REPORT_DEVELOPMENT_TASK_MISSING"))
  assert.ok(result.gaps.includes("EXTERNAL_ASSESSMENT_NOT_INDEPENDENTLY_VERIFIED"))
})

test("code literals cannot prove metadata; Agent-only scope stays available and unverified", t => {
  const f = setup(t)
  const view = f.service.create({ ...f.input, identity_citations: [f.input.diff] })
  assert.equal(view.identity_state, "requested_only")
  const agent = f.service.create({ request_id: "agent", repository: fixture.git.repository, base: fixture.git.base, head: fixture.git.head })
  assert.equal(agent.diff_hash, null)
  assert.deepEqual(agent.files, [])
  assert.ok(agent.gaps.includes("CODE_DIFF_MISSING"))
})

test("rewritten/legacy page reads require recapture; truncation never becomes complete", t => {
  for (const threats of [["ignore-instructions"], undefined]) {
    const wire = structuredClone(fixture.wire)
    wire.data.threats_removed = threats
    const f = setup(t, wire)
    assert.throws(() => f.service.create(f.input), /RECAPTURE_REQUIRED/)
  }
  const wire = structuredClone(fixture.wire)
  wire.data.provenance.truncated = true
  const f = setup(t, wire), view = f.service.create(f.input)
  assert.equal(view.coverage, "partial")
  assert.ok(view.gaps.includes("CODE_SOURCE_TRUNCATED"))
})

test("parser refuses cut hunks, binary/combined, traversal, trailing garbage and line overflow", () => {
  for (const text of [fixture.git.diff.replace("@@ -1 +1,2 @@", "@@ -1 +1,3 @@"),
    fixture.git.diff + "garbage\n", fixture.git.diff.replaceAll("hello.ts", "../secret"),
    "diff --git a/a b/a\nBinary files a/a and b/a differ\n", "diff --cc a\n@@@ -1,1 -1,1 +1,1 @@@\n+x\n",
    fixture.git.diff.replace("@@ -1 +1,2 @@", "@@ -9007199254740991 +1,2 @@"),
  ]) assert.throws(() => parseUnifiedDiff(text), /UNSUPPORTED_OR_INCOMPLETE/)
})

test("new/deleted files and no-newline marker retain the correct side", () => {
  const add = parseUnifiedDiff("diff --git a/a b/a\nnew file mode 100644\n--- /dev/null\n+++ b/a\n@@ -0,0 +1 @@\n+x\n\\ No newline at end of file\n")
  assert.equal(add[0].old_path, null); assert.equal(add[0].lines[0].new_line, 1)
  const del = parseUnifiedDiff("diff --git a/a b/a\ndeleted file mode 100644\n--- a/a\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n")
  assert.equal(del[0].new_path, null); assert.equal(del[0].lines[0].old_line, 1)
})

test("canonical repository is stable; capacity and unknown store preserve existing bytes", t => {
  assert.equal(canonicalRepository("https://EXAMPLE.test:443/team/repo.git/"), "https://example.test/team/repo")
  assert.equal(canonicalRepository(canonicalRepository("https://example.test/team/repo.git.git/")), "https://example.test/team/repo")
  for (const url of ["git@example.test:a/b", "https://user:pass@example.test/a", "https://example.test/a?secret=x"]) assert.throws(() => canonicalRepository(url))
  const f = setup(t)
  for (let i = 0; i < 16; i++) f.service.create({ ...f.input, request_id: String(i) })
  assert.throws(() => f.service.create({ ...f.input, request_id: "overflow" }), /CAPACITY/)
  const file = path.join(f.dir, "code-review-v1", evidenceScopeHash(f.scope) + ".json")
  const bytes = fs.readFileSync(file, "utf8").replace('"schema_version": 1', '"schema_version": 2')
  fs.writeFileSync(file, bytes)
  assert.throws(() => f.service.create({ ...f.input, request_id: "future" }), /SCHEMA_UNSUPPORTED/)
  assert.equal(fs.readFileSync(file, "utf8"), bytes)
})

test("tool classification exposes read/create with only reads in plan mode", () => {
  for (const tool of CODE_REVIEW_TOOL_DEFINITIONS) assert.ok((COMPANION_TOOLS as readonly string[]).includes(tool.function.name))
  assert.equal(isPlanReadonlyAllowed("code_review_create"), false)
  assert.equal(isPlanReadonlyAllowed("code_review_read"), true)
  assert.equal(isPlanReadonlyAllowed("code_review_assess"), false)
  assert.equal(isPlanReadonlyAllowed("code_review_render"), true)
})

test("web-only judgement and both materials preserve source, actual task references and stale revision gaps", t => {
  const f = setup(t), drafts = new BusinessEvidenceService(f.dir, f.scope)
  const ids = [drafts.create({ kind: "change_material.v1", title: "Change", target: { environment: "prod", business_system_id: "SYS" }, request_id: "change" }),
    drafts.create({ kind: "development_trace.v1", title: "Development", target: { environment: "prod" }, request_id: "dev" })]
  const wire = structuredClone(fixture.wire)
  wire.data.text = `REQ-1 TASK-7 CASE-9 ${fixture.git.head}`
  const captured = f.store.capture("business", "get_page_text", wire)
  if (captured.capture_status !== "captured") throw new Error("capture failed")
  const citation = { observation_id: captured.observation_id, excerpt: wire.data.text, start: 0, end: Array.from(wire.data.text).length }
  const refs = [ { kind: "requirement", external_id: "REQ-1", citation }, { kind: "development_task", external_id: "TASK-7", citation },
    { kind: "test", external_id: "CASE-9", citation, commit_id: fixture.git.head } ]
  const view = f.service.create({ ...f.input, business_context: refs, materials: ids.map(result => ({ draft_id: result.draft_id, revision: result.revision })) })
  const report = { review_id: view.review_id, repository: view.repository, base: view.base, head: view.head, diff_hash: view.diff_hash,
    status: "partial", summary: '<script>alert("untrusted")</script>', reviewed_files: ["hello.ts"], findings: [], mappings: refs.map(ref => ({ ...ref, assessment: "Requires business verification" })) }
  const assessed = f.service.assess(report)
  assert.equal(assessed.assessment?.origin, "cmspark_assessment")
  assert.equal(assessed.receipt, null)
  for (const draft of ids) {
    const rendered = renderReviewMaterial(f.dir, f.scope, { review_id: view.review_id, draft_id: draft.draft_id })
    assert.equal(rendered.json.combined_ready, false)
    assert.ok(rendered.markdown.includes("TASK"))
    assert.ok(rendered.markdown.includes("CMspark 网页评语"))
    assert.ok(!rendered.markdown.includes("<script>"))
    assert.equal(rendered.json.code_review.sources[0].observation_id, f.input.diff.observation_id)
  }
  assert.match(reviewPrompt(assessed), /TASK-7/)
  drafts.update({ draft_id: ids[0].draft_id, expected_revision: 1, request_id: "updated", fields: {} })
  const stale = renderReviewMaterial(f.dir, f.scope, { review_id: view.review_id, draft_id: ids[0].draft_id })
  assert.ok(stale.json.gaps.includes("CODE_REVIEW_MATERIAL_REVISION_CHANGED"))
  assert.equal(stale.json.combined_ready, false)
})

test("business claims at another commit cannot disappear into passing model prose", t => {
  const f = setup(t), wire = structuredClone(fixture.wire)
  wire.data.text = `CASE-9 ${fixture.git.base}`
  const capture = f.store.capture("old-tests", "get_page_text", wire)
  if (capture.capture_status !== "captured") throw new Error("fixture failed")
  const ref = { kind: "test", external_id: "CASE-9", commit_id: fixture.git.base,
    citation: { observation_id: capture.observation_id, excerpt: wire.data.text, start: 0, end: wire.data.text.length } }
  const view = f.service.create({ ...f.input, business_context: [ref] })
  const report = { review_id: view.review_id, repository: view.repository, base: view.base, head: view.head, diff_hash: view.diff_hash,
    status: "completed", summary: "All tests passed", reviewed_files: ["hello.ts"], findings: [], mappings: [{ ...ref, assessment: "All covered" }] }
  const assessed = f.service.assess(report)
  assert.ok(assessed.gaps.includes("CODE_REPORT_TEST_COMMIT_MISMATCH"))
  assert.equal(assessed.review_ready, false)
  assert.throws(() => f.service.receive({ ...report, mappings: [{ ...report.mappings[0], external_id: "OTHER" }] }), /CONTEXT_MISMATCH/)
})
