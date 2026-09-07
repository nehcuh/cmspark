import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parsePilotContract, observationBinding } from "../src/business-evidence/pilot-contract"
import { EvidenceStore } from "../src/business-evidence/store"

// Configuration input is authored by the pilot owner; browser result fixture
// is recorded from BrowserBridge.execute by record-page-read-fixture.mjs.
const config = () => ({
  schema_version: 1,
  bindings: [{ system_key: "devops", environment: "prod", origins: ["https://devops.example.test:443/"] }],
  collection_scopes: {
    "requirement.acceptance_criteria": { adapter_id: "static_declaration_v1", adapter_version: "1", scope: { kind: "document" }, empty_marker: "No criteria", binding_system_key: "devops" },
    "story.acceptance_criteria": { adapter_id: "static_declaration_v1", adapter_version: "1", scope: { kind: "document" }, empty_marker: "No criteria", binding_system_key: "devops" },
  },
  source_bindings: {}, mappings: [], required_fields: [], pass_values: ["passed"],
})
const wire = () => JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/page-read-v1.json"), "utf8"))

test("pilot import normalizes origins, rejects unknown versions, duplicates and ambiguous namespaces", () => {
  const locked = parsePilotContract(config())
  assert.deepEqual(locked.contract?.bindings[0].origins, ["https://devops.example.test"])
  assert.match(locked.digest, /^[a-f0-9]{64}$/)
  assert.equal(parsePilotContract({ ...config(), schema_version: 1 }).digest, locked.digest)
  assert.throws(() => parsePilotContract({ ...config(), schema_version: 2 }), /PILOT_CONTRACT_SCHEMA_UNSUPPORTED/)
  const duplicate = config()
  duplicate.bindings[0].origins.push("https://devops.example.test")
  assert.throws(() => parsePilotContract(duplicate), /DUPLICATE_ORIGIN/)
  for (const invalid of ["http://u:p@devops.example.test", "https://devops.example.test/path", "https://devops.example.test?secret=x", "https://*.example.test"]) {
    const input = config(); input.bindings[0].origins = [invalid]
    assert.throws(() => parsePilotContract(input), /INVALID_ORIGIN/)
  }
  const ambiguous = config(); ambiguous.bindings.push({ ...ambiguous.bindings[0], environment: "dev" })
  assert.throws(() => parsePilotContract(ambiguous), /AMBIGUOUS_BINDING/)
})

test("coverage freezes only on post-lock successful reads; identical field adapters are compatible", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-pilot-"))
  try {
    const store = new EvidenceStore(root, { kind: "chat", threadId: "pilot" })
    assert.equal(store.capture("before", "get_page_text", wire()).capture_status, "captured")
    const locked = parsePilotContract(config())
    store.transaction(state => { state.locked_pilot = locked })
    assert.equal(store.capture("after", "get_page_text", wire()).capture_status, "captured")
    const [before, after] = store.read().observations
    assert.equal(before.provenance.coverage, "unknown")
    assert.equal(after.provenance.complete_for_scope, true)
    assert.equal(after.provenance.coverage_basis, "user_pilot_declaration")
    assert.equal(after.provenance.contract_digest, locked.digest)
    assert.throws(() => store.transaction(state => { state.locked_pilot = undefined }), /PILOT_CONTRACT_IMMUTABLE/)
    const changed = config(); changed.pass_values = ["success"]
    assert.throws(() => store.transaction(state => { state.locked_pilot = parsePilotContract(changed) }), /PILOT_CONTRACT_IMMUTABLE/)
    assert.equal(store.read().observations[0].provenance.coverage, "unknown")
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test("unknown adapter, clipped read and conflicting adapter versions never claim completeness", () => {
  for (const variant of ["unknown", "clipped", "conflicting"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-pilot-negative-"))
    try {
      const input = config()
      if (variant === "unknown") for (const adapter of Object.values(input.collection_scopes)) adapter.adapter_id = "unknown"
      if (variant === "conflicting") input.collection_scopes["story.acceptance_criteria"].adapter_version = "2"
      const store = new EvidenceStore(root, { kind: "chat", threadId: "negative" })
      store.transaction(state => { state.locked_pilot = parsePilotContract(input) })
      const result = wire()
      if (variant === "clipped") result.data.provenance.truncated = true
      assert.equal(store.capture("call", "get_page_text", result).capture_status, "captured")
      assert.equal(store.read().observations[0].provenance.complete_for_scope, false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  }
})

test("same-origin environments require exact observed scope and complete literal match", () => {
  const input = config()
  const rows = ["prod", "non-prod"].map(environment => ({ system_key: "devops", environment, origins: ["https://devops.example.test"], environment_selector: "#environment", environment_literal: environment }))
  const locked = parsePilotContract({ ...input, bindings: rows })
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-pilot-env-"))
  try {
    const store = new EvidenceStore(root, { kind: "chat", threadId: "environment" })
    const result = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/page-read-html-v1.json"), "utf8"))
    store.capture("env", "get_page_html", result)
    const observation = store.read().observations[0]
    assert.equal(observationBinding(observation, locked.contract!)?.environment, "non-prod")
    observation.provenance.scope = { kind: "document" }
    assert.equal(observationBinding(observation, locked.contract!), undefined)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
