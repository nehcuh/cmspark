#!/usr/bin/env node
/** Joint driver contract, not a mock-success smoke test. ITCra supplies its
 * authenticated UI/RBAC/real-SSO driver; missing instrumentation is failure. */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

export const CASES = Array.from({ length: 24 }, (_, i) => "A" + (i + 1))
export const CASE_NAMES = { "normal-no-prompt": "A16", "normal-restart-expiry": "A17", "sso-auto-resume": "A18", "danger-approve": "A19", "danger-deny-timeout": "A20", "approval-tamper-replay": "A21", "click-risk-classification": "A22", "login-and-approval-isolation": "A23", "unattended-end-to-end": "A24" }
export const INVARIANTS = {
  A1: { opened_target: true, coverage_present: true, evidence_store_written: true },
  A2: { scope_rejected: true, external_tabs_created: 0, data_returned: false },
  A3: { navigation_succeeded: true, export_rejected: true, data_returned: false },
  A4: { login_text_returned: false },
  A5: { same_origin_scope_verified: true, login_popup_supported_or_explicit: true, login_iframe_supported_or_explicit: true, false_ready_count: 0 },
  A6: { narrow_key_borrowed: false }, A7: { changed_evidence_discarded: true, navigation_error_reported: true },
  A8: { revoked_pending_effects: 0, revoked_data_returned: false, policy_change_stopped: true, expiry_stopped: true },
  A9: { cross_subject_data_returned: false, cross_subject_effects: 0 },
  A10: { wrong_tab_images: 0, inactive_cdp_failure_correct_or_explicit: true },
  A11: { duplicate_opens: 0, duplicate_effects: 0, late_approval_effects: 0, nonce_replay_effects: 0, disconnect_before_approval_effects: 0 },
  A12: { original_file_sha256_verified: true, all_sheets_and_rows_verified: true },
  A13: { forbidden_tool_executions: 0, permission_widened: false },
  A14: { legacy_human_gate_verified: true, personal_regression_verified: true },
  A15: { startup_downloads: 0, offline_restart_logout_expiry_verified: true },
  A16: { coverage_present: true, normal_expected_effects_verified: true },
  A17: { disclosure_expiry_independence_verified: true, policy_expiry_stop_verified: true, restart_no_prompt_verified: true },
  A18: { login_text_returned: false }, A19: { audit_present: true },
  A20: { deny_close_timeout_cancel_rbac_verified: true }, A21: { tamper_replay_expiry_cross_grant_verified: true },
  A22: { readonly_automatic_verified: true, dangerous_waits_human: true, credential_denied: true },
  A23: { cross_identity_image_returns: 0, cross_identity_approval_effects: 0, rbac_isolation_verified: true },
  A24: { local_operator_actions: 0, human_ui_only: true },
}
export function requiredCases(phase) {
  if (!["p0", "all"].includes(phase)) throw new Error("phase must be p0 or all")
  return CASES.filter(id => phase === "all" || id !== "A12")
}
export function requiredObservations(id) {
  const expected = { ...INVARIANTS[id] }
  if (["A1", "A4", "A16", "A17", "A18", "A19", "A24"].includes(id)) expected.local_confirmation_requests = 0
  if (["A1", "A16", "A17"].includes(id)) expected.itcra_authorization_popups = 0
  if (["A4", "A18", "A24"].includes(id)) Object.assign(expected, { real_enterprise_sso: true, same_session_resume: true, completed_stage_replays: 0 })
  if (id === "A19") Object.assign(expected, { effects_before_approval: 0, effects_after_approval: 1, itcra_authorization_popups: 1 })
  if (["A20", "A21"].includes(id)) expected.dangerous_effects = 0
  return expected
}
export function requiredEvidenceKinds(id) {
  const kinds = ["sanitized_trace"]
  if (["A4", "A5", "A18", "A19", "A23", "A24"].includes(id)) kinds.push("ui_observation")
  if (["A19", "A20", "A21", "A22", "A24"].includes(id)) kinds.push("site_effect_counter")
  if (id === "A12") kinds.push("workbook_coverage")
  if (id === "A15") kinds.push("offline_manifest")
  return kinds
}
export function validateCase(id, result, runId) {
  if (!result || result.case !== id || result.run_id !== runId || result.status !== "passed" || result.evidence_kind !== "real_enterprise") return { case: id, status: "failed", error_code: "MISSING_REAL_CASE_EVIDENCE" }
  if (!Array.isArray(result.checks) || !result.checks.length || result.checks.some(check => typeof check.name !== "string" || check.passed !== true)) return { case: id, status: "failed", error_code: "CASE_CHECKS_FAILED" }
  if (!Array.isArray(result.evidence) || !result.evidence.length || result.evidence.some(item => !/^[a-f0-9]{64}$/.test(item.sha256 || "") || !["sanitized_trace", "ui_observation", "site_effect_counter", "offline_manifest", "workbook_coverage"].includes(item.kind))) return { case: id, status: "failed", error_code: "CASE_EVIDENCE_INVALID" }
  const obs = result.observations || {}
  if (Object.entries(requiredObservations(id)).some(([key, value]) => obs[key] !== value)) return { case: id, status: "failed", error_code: "REQUIRED_OBSERVATION_MISSING_OR_FAILED" }
  if (["A1", "A4", "A16", "A17", "A18", "A19", "A24"].includes(id) && obs.local_confirmation_requests !== 0) return { case: id, status: "failed", error_code: "LOCAL_PROMPT_PRESENT_OR_UNMEASURED" }
  if (["A1", "A16", "A17"].includes(id) && obs.itcra_authorization_popups !== 0) return { case: id, status: "failed", error_code: "NORMAL_PROMPT_PRESENT_OR_UNMEASURED" }
  if (["A4", "A18", "A24"].includes(id) && (obs.real_enterprise_sso !== true || obs.same_session_resume !== true || obs.completed_stage_replays !== 0)) return { case: id, status: "failed", error_code: "SSO_RESUME_NOT_VERIFIED" }
  if (id === "A19" && (obs.effects_before_approval !== 0 || obs.effects_after_approval !== 1 || obs.itcra_authorization_popups !== 1)) return { case: id, status: "failed", error_code: "APPROVAL_EFFECT_NOT_VERIFIED" }
  if (["A20", "A21"].includes(id) && obs.dangerous_effects !== 0) return { case: id, status: "failed", error_code: "DENIAL_EFFECT_NOT_VERIFIED" }
  if (id === "A12" && (obs.original_file_sha256_verified !== true || obs.all_sheets_and_rows_verified !== true)) return { case: id, status: "failed", error_code: "WORKBOOK_INCOMPLETE" }
  // Report metadata only; never copy arbitrary driver output, URLs or images.
  return { case: id, status: "passed", evidence_kind: "real_enterprise", check_count: result.checks.length, evidence: result.evidence.map(item => ({ kind: item.kind, sha256: item.sha256 })) }
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]"
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}"
}
export async function archiveEvidence(result, runId, itcra, token, directory, fetcher = fetchJSON) {
  const measured = {}
  if (requiredEvidenceKinds(result.case).some(kind => !result.evidence.some(item => item.kind === kind))) throw new Error("REQUIRED_RECEIPT_MEASUREMENTS_MISSING")
  const allowedMeasurements = new Set([...Object.values(INVARIANTS).flatMap(value => Object.keys(value)), "local_confirmation_requests", "itcra_authorization_popups", "real_enterprise_sso", "same_session_resume", "completed_stage_replays", "effects_before_approval", "effects_after_approval", "dangerous_effects"])
  for (let i = 0; i < result.evidence.length; i++) {
    const item = result.evidence[i]
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(item.artifact_id || "")) throw new Error("missing evidence artifact")
    const record = await fetcher(itcra + "/api/cmspark/acceptance/evidence/" + item.artifact_id, token)
    if (!record || Object.keys(record).some(key => !["schema_version", "run_id", "case", "kind", "measurements"].includes(key)) || record.schema_version !== 1 || record.run_id !== runId || record.case !== result.case || record.kind !== item.kind || !record.measurements || Array.isArray(record.measurements) || typeof record.measurements !== "object") throw new Error("invalid evidence record")
    for (const [key, value] of Object.entries(record.measurements)) if (!allowedMeasurements.has(key) || (typeof value !== "boolean" && (!Number.isSafeInteger(value) || value < 0)) || result.observations[key] !== value) throw new Error("unsafe or inconsistent evidence record")
    Object.assign(measured, record.measurements)
    if (!Object.keys(record.measurements).length) throw new Error("empty evidence")
    const text = canonical(record), hash = crypto.createHash("sha256").update(text).digest("hex")
    if (hash !== item.sha256) throw new Error("evidence hash mismatch")
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, result.case + "-" + i + ".json"), text + "\n", { mode: 0o600 })
  }
  if (Object.entries(requiredObservations(result.case)).some(([key, value]) => measured[key] !== value)) throw new Error("REQUIRED_RECEIPT_MEASUREMENTS_MISSING")
  return Object.fromEntries(Object.keys(requiredObservations(result.case)).map(key => [key, measured[key]]))
}
export function makeReport(phase, records, runId) {
  const required_cases = requiredCases(phase)
  const results = required_cases.map(id => {
    const matches = records.filter(record => record.case === id)
    return matches.length === 1 ? matches[0] : { case: id, status: "failed", error_code: matches.length ? "DUPLICATE_CASE" : "MISSING_CASE" }
  })
  return { schema_version: 1, run_id: runId, phase, required_cases, passed: results.every(result => result.status === "passed"), results, created_at: new Date().toISOString() }
}
function restrictedJSON(file) {
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size > 64 * 1024 || (process.platform !== "win32" && (stat.mode & 0o077))) throw new Error("credential file must be private (0600)")
  return JSON.parse(fs.readFileSync(file, "utf8"))
}
function tokenFile(file) {
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size > 4096 || (process.platform !== "win32" && (stat.mode & 0o077))) throw new Error("token file must be private (0600)")
  return fs.readFileSync(file, "utf8").trim()
}
async function fetchJSON(url, token, body) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000), headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) })
  if (!response.ok) throw new Error("HTTP_" + response.status)
  const reader = response.body.getReader(), chunks = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 256 * 1024) { await reader.cancel(); throw new Error("RESPONSE_TOO_LARGE") }
    chunks.push(Buffer.from(value))
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}
export async function main(argv = process.argv.slice(2)) {
  const allowed = ["itcra-url", "cmspark-url", "phase", "case", "report", "credentials-file"]
  const opts = {}
  for (let i = 0; i < argv.length; i += 2) { const key = argv[i]?.replace(/^--/, ""); if (!allowed.includes(key) || !argv[i + 1] || opts[key]) throw new Error("invalid arguments"); opts[key] = argv[i + 1] }
  const phase = opts.phase || "p0", required = requiredCases(phase), runId = crypto.randomUUID()
  const selected = opts.case && opts.case !== "all" ? [CASE_NAMES[opts.case] || opts.case] : required
  if (selected.some(id => !required.includes(id))) throw new Error("case not in phase")
  const records = []
  const reportPath = path.resolve(opts.report || "artifacts/itcra-browser-acceptance/report.json")
  let prerequisites
  try {
    const credentials = restrictedJSON(opts["credentials-file"] || process.env.ITCRA_ACCEPTANCE_CREDENTIALS_FILE)
    const cmspark = new URL(opts["cmspark-url"]), itcra = new URL(opts["itcra-url"])
    if ([cmspark, itcra].some(url => !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)) throw new Error("URLs must be origins")
    const grant = tokenFile(credentials.grant_file), driver = tokenFile(credentials.itcra_driver_token_file)
    const capabilities = await fetchJSON(cmspark.origin + "/outbound-mcp/v1/enterprise/capabilities?subject=" + encodeURIComponent(credentials.subject), grant)
    if (!capabilities.ok || capabilities.data?.contract_version !== 1 || capabilities.data.subject !== credentials.subject) throw new Error("INCOMPATIBLE_ENTERPRISE_CONTRACT")
    prerequisites = "passed"
    for (const id of selected) {
      if (id === "A12" && capabilities.data.workbook_export !== true) { records.push({ case: id, status: "failed", error_code: "WORKBOOK_EXPORT_UNSUPPORTED" }); continue }
      try {
        const result = await fetchJSON(itcra.origin + "/api/cmspark/acceptance/run-case", driver, { case: id, phase, run_id: runId, cmspark_origin: cmspark.origin })
        const validated = validateCase(id, result, runId)
        if (validated.status === "passed") validated.measurements = await archiveEvidence(result, runId, itcra.origin, driver, path.join(path.dirname(reportPath), "evidence", runId))
        records.push(validated)
      } catch (error) { records.push({ case: id, status: "failed", error_code: error.message === "REQUIRED_RECEIPT_MEASUREMENTS_MISSING" ? error.message : "JOINT_DRIVER_UNAVAILABLE" }) }
    }
  } catch { prerequisites = "failed" }
  const report = { ...makeReport(phase, records, runId), prerequisites, scope: selected.length === required.length ? "phase" : "single-case-incomplete-phase" }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 })
  process.stdout.write(JSON.stringify({ passed: report.passed, phase, report: reportPath }) + "\n")
  return report.passed ? 0 : 1
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => { process.exitCode = code }).catch(() => { process.stderr.write("Acceptance invocation failed; check arguments and private credential-file permissions.\n"); process.exitCode = 2 })
