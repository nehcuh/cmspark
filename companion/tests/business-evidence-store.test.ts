import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { EvidenceStore, EVIDENCE_LIMITS } from "../src/business-evidence/store"
import { evidenceScopeHash } from "../src/business-evidence/content"

// Recorded from production BrowserBridge.execute. Regenerate via the extension's
// scripts/record-page-read-fixture.mjs; no hand-authored wire shape here.
const browserResult = () => JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/page-read-v1.json"), "utf8"))

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-evidence-store-"))
  const scope = { kind: "chat" as const, threadId: "../thread" }
  return {
    root, store: new EvidenceStore(root, scope),
    file: path.join(root, "business-evidence-v1", evidenceScopeHash(scope) + ".json"),
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

test("new evidence scopes are empty and independent; snapshots preserve extension fields", () => {
  const f = fixture()
  try {
    assert.deepEqual(f.store.read(), { schema_version: 1, observations: [], drafts: [], capacity_gap: false })
    assert.equal(fs.existsSync(f.file), false)
    f.store.transaction(state => { state.extension = { future: true } })
    const snapshot = f.store.read()
    snapshot.extension = { changed: true }
    f.store.transaction(state => { state.counter = 1 })
    assert.deepEqual(f.store.read().extension, { future: true })
    assert.equal(new EvidenceStore(f.root, { kind: "mcp", grantId: "../thread", sessionId: "one" }).read().counter, undefined)
    if (process.platform !== "win32") assert.equal(fs.statSync(f.file).mode & 0o777, 0o600)
  } finally { f.close() }
})

test("failed transactions and capacity overflow never partially rewrite a snapshot", () => {
  const f = fixture()
  try {
    f.store.transaction(state => { state.marker = "original" })
    const before = fs.readFileSync(f.file, "utf8")
    assert.throws(() => f.store.transaction(state => { state.marker = "new"; throw new Error("stop") }), /stop/)
    assert.equal(fs.readFileSync(f.file, "utf8"), before)
    assert.throws(() => f.store.transaction(state => { state.large = "x".repeat(EVIDENCE_LIMITS.scopeBytes) }), /EVIDENCE_CAPACITY/)
    assert.equal(fs.readFileSync(f.file, "utf8"), before)
    assert.throws(() => f.store.transaction(state => { state.drafts = Array.from({ length: 17 }, () => ({})) }), /EVIDENCE_CAPACITY/)
    assert.equal(fs.readFileSync(f.file, "utf8"), before)
    assert.throws(() => f.store.transaction(async state => { state.marker = "async" }), /ASYNC_EVIDENCE_MUTATION/)
    assert.equal(fs.readFileSync(f.file, "utf8"), before)
  } finally { f.close() }
})

test("unknown schema and damaged files fail closed without replacing the original", () => {
  const f = fixture()
  try {
    f.store.transaction(() => undefined)
    for (const [contents, error] of [
      [JSON.stringify({ schema_version: 2, observations: [], drafts: [] }), "EVIDENCE_SCHEMA_UNSUPPORTED"],
      ["{invalid", "EVIDENCE_CORRUPT"],
      [JSON.stringify({ schema_version: 1, observations: "bad", drafts: [] }), "EVIDENCE_CORRUPT"],
    ]) {
      fs.writeFileSync(f.file, contents)
      assert.throws(() => f.store.read(), new RegExp(error))
      assert.throws(() => f.store.transaction(state => { state.marker = "overwrite" }), new RegExp(error))
      assert.equal(fs.readFileSync(f.file, "utf8"), contents)
    }
  } finally { f.close() }
})

test("two service instances serialize synchronous mutations without stale cached state", async () => {
  const f = fixture()
  try {
    const other = new EvidenceStore(f.root, { kind: "chat", threadId: "../thread" })
    await Promise.all(Array.from({ length: 32 }, (_, i) => Promise.resolve().then(() => {
      ;(i % 2 ? f.store : other).transaction(state => { state.counter = Number(state.counter || 0) + 1 })
    })))
    assert.equal(f.store.read().counter, 32)
  } finally { f.close() }
})

test("failed, arbitrary external and provenance-free results do not consume evidence capacity", () => {
  const f = fixture()
  try {
    assert.equal(f.store.capture("call", "mcp_external", { success: true }).capture_status, "skipped")
    assert.equal(f.store.capture("call", "get_page_text", { success: false }).capture_status, "skipped")
    assert.equal(f.store.capture("call", "get_page_text", { success: true }).capture_status, "skipped")
    assert.equal(f.store.read().observations.length, 0)
    assert.equal(f.store.read().capacity_gap, false)
    assert.equal(fs.existsSync(f.file), false)
  } finally { f.close() }
})

test("real producer wire creates immutable normalized evidence with server clock and identity", () => {
  const f = fixture()
  try {
    const result = browserResult()
    const now = Date.parse("2026-09-07T06:00:00Z")
    result.data.provenance.complete_for_scope = true // Browser claims cannot grant completeness.
    result.data.provenance.untrusted_extra = "must-not-persist"
    const captured = f.store.capture("actual-local-call", "get_page_text", result, now)
    assert.equal(captured.capture_status, "captured")
    assert.ok("observation_id" in captured)
    const observation = f.store.read().observations[0]
    assert.equal(observation.id, "observation_id" in captured ? captured.observation_id : undefined)
    assert.equal(observation.observed_at, new Date(now).toISOString())
    assert.equal(observation.content, "Release REL-1\nEnvironment prod\nCommit abc123\n😀 Café")
    assert.equal(observation.target.origin, "https://devops.example.test")
    assert.equal(observation.provenance.complete_for_scope, false)
    assert.equal(observation.provenance.untrusted_extra, undefined)
    assert.doesNotMatch(fs.readFileSync(f.file, "utf8"), /token=|secret|private|must-not-persist/)
    const before = fs.readFileSync(f.file, "utf8")
    assert.throws(() => f.store.transaction(state => { state.observations[0].content = "edited" }), /OBSERVATION_IMMUTABLE/)
    assert.throws(() => f.store.transaction(state => { state.observations.shift() }), /OBSERVATION_IMMUTABLE/)
    assert.equal(fs.readFileSync(f.file, "utf8"), before)
  } finally { f.close() }
})

test("record count and UTF-8 content limits reject appends without evicting any evidence", () => {
  const f = fixture()
  try {
    const tooLarge = browserResult()
    tooLarge.data.text = "😀".repeat(16385)
    assert.deepEqual(f.store.capture("oversize", "get_page_text", tooLarge), { capture_status: "skipped", reason: "CAPACITY" })
    assert.equal(f.store.read().observations.length, 0)
    assert.equal(f.store.read().capacity_gap, true)
    for (let i = 0; i < EVIDENCE_LIMITS.observations; i++) {
      assert.equal(f.store.capture(`call-${i}`, "get_page_text", browserResult()).capture_status, "captured")
    }
    const before = fs.readFileSync(f.file, "utf8")
    assert.deepEqual(f.store.capture("overflow", "get_page_text", browserResult()), { capture_status: "skipped", reason: "CAPACITY" })
    assert.equal(fs.readFileSync(f.file, "utf8"), before)
    assert.equal(f.store.read().observations[0].tool_call_id, "call-0")
  } finally { f.close() }
})

test("changed targets and leaky target metadata cannot become persisted evidence", () => {
  const f = fixture()
  try {
    for (const change of ["TARGET_CHANGED", "TARGET_UNAVAILABLE"]) {
      const result = browserResult()
      result.data.provenance.capture_status = change
      assert.deepEqual(f.store.capture("call", "get_page_text", result), { capture_status: "skipped", reason: change })
    }
    const result = browserResult()
    result.data.provenance.target.url += "?token=private"
    assert.deepEqual(f.store.capture("call", "get_page_text", result), { capture_status: "skipped", reason: "PROVENANCE_UNAVAILABLE" })
    assert.equal(f.store.read().observations.length, 0)
  } finally { f.close() }
})
