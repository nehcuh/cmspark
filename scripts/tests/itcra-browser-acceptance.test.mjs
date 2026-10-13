import test from "node:test"
import assert from "node:assert/strict"
import { makeReport, requiredCases, validateCase, archiveEvidence, main, requiredObservations, requiredEvidenceKinds } from "../itcra-browser-acceptance.mjs"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
test("required phase sets never drop missing/failed/skipped cases or promote mocks", () => {
  assert.equal(requiredCases("p0").length, 23); assert.equal(requiredCases("all").length, 24)
  assert.equal(makeReport("p0", [{ case: "A16", status: "passed" }], "run").passed, false)
  for (const status of ["failed", "skipped", "missing"]) assert.equal(makeReport("p0", requiredCases("p0").map(id => ({ case: id, status: id === "A18" ? status : "passed" })), "run").passed, false)
  assert.equal(makeReport("all", requiredCases("p0").map(id => ({ case: id, status: "passed" })), "run").passed, false)
  assert.equal(validateCase("A18", { case: "A18", run_id: "run", status: "passed", evidence_kind: "simulated" }, "run").status, "failed")
  assert.throws(() => requiredCases("smoke"))
})
test("joint receipts must be retrieved, hash verified and scalar-only; labels/hashes alone do not pass", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-itcra-receipt-"))
  const record = { case: "A2", kind: "sanitized_trace", measurements: { data_returned: false, external_tabs_created: 0, scope_rejected: true }, run_id: "run", schema_version: 1 }
  const text = JSON.stringify(record)
  const sha256 = crypto.createHash("sha256").update(text).digest("hex")
  const result = { case: "A2", observations: record.measurements, evidence: [{ artifact_id: "receipt-1", kind: "sanitized_trace", sha256 }] }
  try {
    await archiveEvidence(result, "run", "http://itcra.test", "token", directory, async () => record)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "A2-0.json"), "utf8")), record)
    await assert.rejects(archiveEvidence(result, "run", "http://itcra.test", "token", directory, async () => ({ ...record, image_base64: "PRIVATE" })), /invalid evidence/)
    await assert.rejects(archiveEvidence(result, "run", "http://itcra.test", "token", directory, async () => ({ ...record, measurements: { effects_after_approval: "PRIVATE" } })), /unsafe or inconsistent/)
    await assert.rejects(archiveEvidence({ ...result, evidence: [{ ...result.evidence[0], sha256: "b".repeat(64) }] }, "run", "http://itcra.test", "token", directory, async () => record), /hash mismatch/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
test("actual entry point cannot promote incomplete receipts or absent workbook capability to full acceptance", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-itcra-driver-")), previous = globalThis.fetch
  const canonical = value => value && typeof value === "object" ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}" : JSON.stringify(value)
  const grant = path.join(directory, "grant"), token = path.join(directory, "driver"), credentials = path.join(directory, "credentials.json")
  fs.writeFileSync(grant, "cmg_" + "a".repeat(64), { mode: 0o600 }); fs.writeFileSync(token, "driver-token", { mode: 0o600 })
  fs.writeFileSync(credentials, JSON.stringify({ subject: "user-a", grant_file: grant, itcra_driver_token_file: token }), { mode: 0o600 })
  let incomplete = false, workbook = false, driverCases = []
  const receipts = new Map()
  globalThis.fetch = async (url, opts) => {
    const route = new URL(url).pathname
    if (route.endsWith("/capabilities")) return new Response(JSON.stringify({ ok: true, data: { contract_version: 1, subject: "user-a", workbook_export: workbook } }))
    if (route.endsWith("/run-case")) {
      const request = JSON.parse(opts.body), observations = requiredObservations(request.case)
      driverCases.push(request.case)
      const evidence = requiredEvidenceKinds(request.case).map((kind, i) => {
        const artifact_id = request.case + "_" + i
        const record = { schema_version: 1, run_id: request.run_id, case: request.case, kind, measurements: incomplete ? { local_confirmation_requests: 0 } : observations }
        if (incomplete) observations.local_confirmation_requests = 0
        receipts.set(artifact_id, record)
        return { kind, artifact_id, sha256: crypto.createHash("sha256").update(canonical(record)).digest("hex") }
      })
      return new Response(JSON.stringify({ case: request.case, run_id: request.run_id, status: "passed", evidence_kind: "real_enterprise", checks: [{ name: "observer", passed: true }], observations, evidence }))
    }
    return new Response(JSON.stringify(receipts.get(route.split("/").at(-1))))
  }
  const invoke = phase => main(["--itcra-url", "http://itcra.test", "--cmspark-url", "http://cmspark.test", "--phase", phase, "--credentials-file", credentials, "--report", path.join(directory, "report.json")])
  try {
    assert.equal(await invoke("p0"), 0)
    const p0 = JSON.parse(fs.readFileSync(path.join(directory, "report.json")))
    assert.equal(p0.results.find(row => row.case === "A19").measurements.effects_after_approval, 1)
    driverCases = []; assert.equal(await invoke("all"), 1)
    const all = JSON.parse(fs.readFileSync(path.join(directory, "report.json")))
    assert.equal(all.results.find(row => row.case === "A12").error_code, "WORKBOOK_EXPORT_UNSUPPORTED")
    assert.ok(!driverCases.includes("A12"))
    incomplete = true; workbook = true
    assert.equal(await invoke("all"), 1)
    const bad = JSON.parse(fs.readFileSync(path.join(directory, "report.json")))
    assert.equal(bad.results.find(row => row.case === "A18").error_code, "REQUIRED_RECEIPT_MEASUREMENTS_MISSING")
    assert.equal(bad.results.find(row => row.case === "A19").status, "failed")
    assert.equal(bad.results.find(row => row.case === "A12").status, "failed")
  } finally { globalThis.fetch = previous; fs.rmSync(directory, { recursive: true, force: true }) }
})
test("fresh case evidence must measure confirmation counts and actual SSO/effect invariants; output is metadata only", () => {
  const input = { case: "A19", run_id: "run", status: "passed", evidence_kind: "real_enterprise", checks: [{ name: "effects", passed: true }], evidence: [{ kind: "site_effect_counter", sha256: "a".repeat(64), secret: "PRIVATE" }], observations: { audit_present: true, effects_before_approval: 0, effects_after_approval: 1, itcra_authorization_popups: 1, local_confirmation_requests: 0 }, image_base64: "PRIVATE" }
  assert.equal(validateCase("A19", input, "other-run").status, "failed")
  const output = validateCase("A19", input, "run")
  assert.equal(output.status, "passed"); assert.ok(!JSON.stringify(output).includes("PRIVATE"))
  assert.equal(validateCase("A19", { ...input, observations: { ...input.observations, effects_after_approval: 2 } }, "run").status, "failed")
  assert.equal(validateCase("A19", { ...input, observations: { ...input.observations, local_confirmation_requests: undefined } }, "run").status, "failed")
})
