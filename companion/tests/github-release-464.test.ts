import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { captureLocalPageResult } from "../src/business-evidence/executor"
import { EvidenceStore } from "../src/business-evidence/store"
const fixture = require(path.join(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../tests/fixtures" : "./fixtures", "github-release-dom-464.cjs"))
const scope = { kind: "chat" as const, threadId: "release-464" }
const head = "4158cffe5ed6ccb847a4151df7006fd0ecc5ef74"
function owned(t: { after: (fn: () => void) => void }) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-release-464-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return { dir, store: new EvidenceStore(dir, scope) } }
test("actual serialized release header survives production capture and fresh reload as observed platform data", async t => {
  const f = owned(t), wire = await fixture.read()
  assert.equal(wire.data.releaseRelation?.head, head)
  const result = captureLocalPageResult(f.dir, scope, "owned-release", "get_page_html", wire)
  assert.equal(result.data.releaseRelation, undefined)
  assert.equal(result.data.evidence_capture.release_adapter, "github_tagged_release.v1")
  const observation = new EvidenceStore(f.dir, scope).read().observations[0]
  assert.equal((observation as any).release_relation.head, head)
  assert.equal(observation.provenance.complete_for_scope, false)
  assert.equal(observation.code_comparison, undefined)
})

import { BusinessEvidenceService } from "../src/business-evidence/service"
import { CodeReviewService } from "../src/code-review/service"
import { renderReviewMaterial } from "../src/code-review/material"
import { evidenceScopeHash } from "../src/business-evidence/content"

for (const [name, mutate] of [
  ["duplicate metadata", (s: string) => s + s],
  ["cut commit", (s: string) => s.replace(/<a data-hovercard-type="commit"[\s\S]*?<\/a>/, '')],
  ["extra commit alternative", (s: string) => s.replace(/<\/div>\s*$/, '<a href="/nehcuh/cmspark/commit/d18e703868d7b24afa0ea4abbccae6527c779ad1">notes</a></div>')],
  ["wrong repository", (s: string) => s.replaceAll('/nehcuh/cmspark/commit/', '/other/cmspark/commit/')],
  ["wrong tag", (s: string) => s.replaceAll('/tree/v0.6.11', '/tree/v0.6.12')],
  ["short commit URL", (s: string) => s.replaceAll('/commit/' + head, '/commit/' + head.slice(0, 7))],
  ["hidden metadata", (s: string) => s.replace('class="d-flex', 'hidden="" class="d-flex')],
  ["notes pretending to be header", (s: string) => '<article class="markdown-body">' + s + '</article>'],
  ["sanitizer alteration", (s: string) => s.replace('<relative-time', '<script>untrusted</script><relative-time')],
] as const) test(`serialized platform relation stays absent: ${name}`, async t => {
  const f = owned(t), wire = await fixture.read({ html: mutate(fixture.source) })
  assert.equal(wire.data.releaseRelation, undefined)
  captureLocalPageResult(f.dir, scope, name, "get_page_html", wire)
  assert.equal((f.store.read().observations[0] as any)?.release_relation, undefined)
})
for (const [name, options] of [
  ["query URL", { currentUrl: fixture.url + '?changed=1' }],
  ["wrong page tag", { currentUrl: fixture.url.replace('v0.6.11', 'v0.6.12') }],
  ["other origin", { currentUrl: fixture.url.replace('github.com', 'example.com') }],
  ["changed navigation", { changedUrl: fixture.url + '#changed' }],
  ["DOM fallback channel", { channel: 'dom' }],
  ["truncated result", { truncated: true }],
] as const) test(`capture cannot promote ${name}`, async t => {
  const f = owned(t), wire = await fixture.read(options)
  captureLocalPageResult(f.dir, scope, name, "get_page_html", wire)
  assert.equal((f.store.read().observations[0] as any)?.release_relation, undefined)
})

async function material(t: { after: (fn: () => void) => void }, options: { id?: string; version?: string; commit?: string; reviewHead?: string; repository?: string; mixed?: boolean; generic?: boolean; noPilot?: boolean } = {}) {
  const f = owned(t)
  if (!options.noPilot) fs.writeFileSync(path.join(f.dir, 'pilot-contract.json'), JSON.stringify({ schema_version: 1,
    bindings: [{ system_key: 'github', environment: 'prod', origins: ['https://github.com'] }], collection_scopes: {}, source_bindings: {}, mappings: [], required_fields: [], pass_values: ['PASS'] }))
  const wire = await fixture.read()
  if (options.generic) delete wire.data.releaseRelation
  const captured = captureLocalPageResult(f.dir, scope, 'release', 'get_page_html', wire)
  const observation = f.store.read().observations[0]
  const citation = { observation_id: captured.data.observation_id, excerpt: observation.content, start: 0, end: Array.from(observation.content).length }
  const drafts = new BusinessEvidenceService(f.dir, scope), draft = drafts.create({ kind: 'change_material.v1', title: 'Observed release', target: { environment: 'prod', business_system_id: 'SYS' }, request_id: 'create' })
  let idCitation = citation
  if (options.mixed) {
    const second = captureLocalPageResult(f.dir, scope, 'second', 'get_page_html', await fixture.read())
    idCitation = { ...citation, observation_id: second.data.observation_id }
  }
  const updated = drafts.update({ draft_id: draft.draft_id, expected_revision: 1, request_id: 'fields', fields: {
    'release.id': { value: options.id ?? 'v0.6.11', citations: [idCitation] },
    'release.version': { value: options.version ?? 'v0.6.11', citations: [citation] },
    'release.commit_id': { value: options.commit ?? head, citations: [citation] },
  } })
  const review = new CodeReviewService(f.dir, scope).create({ request_id: 'review', repository: options.repository ?? 'https://github.com/nehcuh/cmspark', base: '30f4aa867ca1b9970f0fa4d72fc993a13af49972', head: options.reviewHead ?? head, materials: [{ draft_id: draft.draft_id, revision: updated.revision }] })
  const render = () => renderReviewMaterial(f.dir, scope, { review_id: review.review_id, draft_id: draft.draft_id })
  return { ...f, drafts, draft, updated, review, render, citation }
}
test("material records only observed release relation through actual store/draft/pilot/citation/reload", async t => {
  const f = await material(t), rendered = f.render()
  assert.equal(rendered.json.draft.fields['release.commit_id'].state, 'supported')
  assert.equal(rendered.json.release_relation?.status, 'observed_platform_relation')
  assert.equal(rendered.json.release_relation?.head, head)
  assert.equal(rendered.json.release_relation?.source.url, fixture.url)
  assert.equal(rendered.json.release_relation?.limitation, 'BUILD_ARTIFACT_AUTHENTICITY_UNVERIFIED')
  assert.ok(!rendered.json.gaps.includes('RELEASE_REPOSITORY_NOT_VERIFIED'))
  assert.ok(rendered.json.gaps.includes('RELEASE_BUILD_ARTIFACT_AUTHENTICITY_NOT_VERIFIED'))
  assert.notEqual(rendered.json.draft.relations.release_artifact.state, 'supported')
  assert.equal(rendered.json.review_ready, false)
  assert.equal(rendered.json.combined_ready, false)
  assert.match(rendered.markdown, /仅观测关系/)
  assert.deepEqual(f.render().json.release_relation, rendered.json.release_relation)
  f.drafts.update({ draft_id: f.draft.draft_id, expected_revision: f.updated.revision, request_id: 'new-revision', fields: {} })
  assert.equal(f.render().json.release_relation, null)
  assert.ok(f.render().json.gaps.includes('CODE_REVIEW_MATERIAL_REVISION_CHANGED'))
})
for (const [name, options] of [
  ['numeric release id absent from page', { id: '399686945' }],
  ['URL absent from relative-HTML scalar citation', { id: fixture.url }],
  ['wrong release', { id: 'v0.6.12' }],
  ['wrong version', { version: 'v0.6.12' }],
  ['wrong selected head', { reviewHead: 'd18e703868d7b24afa0ea4abbccae6527c779ad1' }],
  ['same SHA in other repository', { repository: 'https://github.com/other/cmspark' }],
  ['mixed observations', { mixed: true }],
  ['generic old observation', { generic: true }],
  ['no locked pilot', { noPilot: true }],
] as const) test(`material stays unverified: ${name}`, async t => {
  const f = await material(t, options), rendered = f.render()
  assert.equal(rendered.json.release_relation, null)
  assert.ok(rendered.json.gaps.includes('RELEASE_REPOSITORY_NOT_VERIFIED'))
  assert.equal(rendered.json.combined_ready, false)
})
test("tampered persisted metadata or content-bound digest fails before material render", async t => {
  const f = await material(t), file = path.join(f.dir, 'business-evidence-v1', evidenceScopeHash(scope) + '.json')
  const bytes = fs.readFileSync(file, 'utf8'), saved = JSON.parse(bytes)
  saved.observations[0].release_relation.head = 'a'.repeat(40); fs.writeFileSync(file, JSON.stringify(saved))
  assert.throws(f.render, /EVIDENCE_CORRUPT/)
  fs.writeFileSync(file, bytes)
  const changed = JSON.parse(bytes); changed.observations[0].release_relation_digest = 'f'.repeat(64); fs.writeFileSync(file, JSON.stringify(changed))
  assert.throws(f.render, /EVIDENCE_CORRUPT/)
})
test("caller sidecars are removed without scope; missing/cancelled readonly scope cannot publish relations", async t => {
  const f = owned(t), wire = await fixture.read()
  wire.data.release_relation = { head: 'forged' }; wire.data.release_relation_digest = 'forged'
  const unscoped = captureLocalPageResult(f.dir, undefined, 'none', 'get_page_html', wire)
  for (const name of ['releaseRelation', 'release_relation', 'release_relation_digest']) assert.equal(unscoped.data[name], undefined)
  const controller = new AbortController(); controller.abort()
  assert.equal(captureLocalPageResult(f.dir, scope, 'cancel', 'get_page_html', wire, controller.signal).data.evidence_capture.capture_status, 'skipped')
  assert.equal(captureLocalPageResult(f.dir, scope, 'readonly', 'get_page_html', wire, undefined, false).data.evidence_capture.capture_status, 'skipped')
  assert.equal(f.store.read().observations.length, 0)
})
test("typed release uses original combined64KiB budget and strict schema; no free authority fields", async t => {
  for (const mutate of [
    (wire: any) => { wire.data.releaseRelation.complete = true },
    (wire: any) => { wire.data.releaseRelation.release_url += '?changed=1' },
    (wire: any) => { wire.data.releaseRelation.repository = 'https://github.com/other/cmspark' },
    (wire: any) => { wire.data.releaseRelation.head = 'main' },
  ]) {
    const f = owned(t), wire = await fixture.read(); mutate(wire)
    captureLocalPageResult(f.dir, scope, 'corrupt', 'get_page_html', wire)
    assert.equal((f.store.read().observations[0] as any).release_relation, undefined)
  }
  const f = owned(t), wire = await fixture.read(); wire.data.html = 'x'.repeat(65536)
  assert.equal(f.store.capture('capacity', 'get_page_html', wire).capture_status, 'skipped')
})
test("private pilot mismatch never borrows a supported platform relation", async t => {
  const f = await material(t)
  const sourceFile = path.join(f.dir, 'business-evidence-v1', evidenceScopeHash(scope) + '.json')
  const saved = JSON.parse(fs.readFileSync(sourceFile, 'utf8')); saved.locked_pilot.digest = 'f'.repeat(64)
  fs.writeFileSync(sourceFile, JSON.stringify(saved))
  assert.throws(f.render, /PILOT_CONTRACT_CORRUPT/)
})
test("serialized release preflights the original64KiB admission before interpreting a large metadata row", async t => {
  const f = owned(t), wire = await fixture.read({ html: fixture.source.replace('released this', 'released this' + 'x'.repeat(65536)) })
  assert.equal(wire.data.releaseRelation, undefined)
  assert.equal(wire.data.release_refusal, 'RELEASE_CAPACITY')
  assert.equal(captureLocalPageResult(f.dir, scope, 'large-row', 'get_page_html', wire).data.evidence_capture.capture_status, 'skipped')
})
