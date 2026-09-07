import { exactExcerpt, excerptSupportsValue } from "./content"
import type { DraftRecord } from "./draft-repository"
import { checkFields, type CheckedFields } from "./field-checker"
import { observationBinding, validateLockedPilot, type LockedPilotContract } from "./pilot-contract"
import { DRAFT_SCHEMAS, type FieldState } from "./schema"
import type { Observation } from "./store"

export interface Endpoint { system_key: string; kind: string; external_id: string }
export interface CheckedRelation { state: FieldState; reasons: string[]; confirmation?: "tool_verified" | "user_confirmed"; from?: Endpoint; to?: Endpoint }
export type PublicDraft = Pick<DraftRecord, "schema_version" | "id" | "kind" | "title" | "target" | "revision" | "created_at" | "updated_at" | "pilot_digest" | "fields" | "relations" | "story_draft_text"> & Record<string, unknown>
export interface CheckedDraft { draft: PublicDraft; fields: CheckedFields; relations: Record<string, CheckedRelation>; ready: boolean; gaps: string[]; draft_text_present: boolean; coverage_basis: string[]; checked_at: string; runtime_exemption?: { rationale: string; basis: "locked_pilot_contract" } }
type RelationRule = { from: string[]; to: string[]; fromKind: string; toKind: string; context?: string[] }
const rules: Record<string, RelationRule> = {
  release_artifact: { from: ["release.id"], to: ["artifact.id"], fromKind: "release", toKind: "artifact", context: ["release.build_id", "artifact.build_id"] },
  architecture_target: { from: ["architecture.system_id", "architecture.revision"], to: ["target.system_id"], fromKind: "architecture", toKind: "system" },
  runtime_target: { from: ["runtime.system_id"], to: ["target.system_id"], fromKind: "system", toKind: "system", context: ["runtime.environment", "target.environment"] },
  // These links relate a platform's native requirement/commit reference to the
  // selected object. Namespaces remain distinct even when the native IDs agree.
  code_requirement: { from: ["code.requirement_id"], to: ["requirement.id"], fromKind: "requirement", toKind: "requirement", context: ["code.repository_id", "code.commit_id"] },
  tests_requirement: { from: ["tests.requirement_id"], to: ["requirement.id"], fromKind: "requirement", toKind: "requirement", context: ["tests.run_id"] },
  tests_commit: { from: ["tests.commit_id"], to: ["code.commit_id"], fromKind: "commit", toKind: "commit", context: ["tests.run_id"] },
  defects_requirement: { from: ["defects.requirement_id"], to: ["requirement.id"], fromKind: "requirement", toKind: "requirement", context: ["defects.status", "defects.ids"] },
}
const sameEndpoint = (left: Endpoint, right: Endpoint) => left.system_key === right.system_key && left.kind === right.kind && left.external_id === right.external_id

export function checkDraft(draft: DraftRecord, observations: readonly Observation[], locked: LockedPilotContract, capacityGap: boolean, now = Date.now()): CheckedDraft {
  validateLockedPilot(locked)
  if (locked.digest !== draft.pilot_digest) throw new Error("PILOT_CONTRACT_MISMATCH")
  const contract = locked.contract
  const fields = checkFields(draft, observations, locked, now)
  const relations: Record<string, CheckedRelation> = {}
  const schema = DRAFT_SCHEMAS[draft.kind]
  const getValue = (name: string) => draft.fields[name]?.value
  const endpoint = (names: string[], kind: string): Endpoint | undefined => {
    const sources = names.flatMap(name => fields[name]?.sources || [])
    const systems = new Set(sources.map(source => source.system_key))
    if (systems.size !== 1 || names.some(name => fields[name]?.state !== "supported" || typeof getValue(name) !== "string")
      || names.length > 1 && names.some(name => String(getValue(name)).includes("@"))) return undefined
    return { system_key: sources[0].system_key, kind, external_id: names.map(name => getValue(name)).join("@") }
  }
  for (const name of schema.relations) {
    if (name === "story_requirement" || name === "criteria_cases") continue
    const candidate = draft.relations[name]
    if (!candidate) { relations[name] = { state: "missing", reasons: ["NO_RELATION"] }; continue }
    const rule = rules[name]
    const from = endpoint(rule.from, rule.fromKind), to = endpoint(rule.to, rule.toKind)
    const dependencies = [...rule.from, ...rule.to, ...(rule.context || [])]
    if (!from || !to || dependencies.some(key => fields[key]?.state !== "supported")) {
      const state = dependencies.some(key => fields[key]?.state === "conflict") ? "conflict" : dependencies.some(key => fields[key]?.state === "stale") ? "stale" : "unverified"
      relations[name] = { state, reasons: ["ENDPOINTS_UNVERIFIED"] }; continue
    }
    const fail = (reason: string, state: FieldState = "unverified") => { relations[name] = { state, reasons: [reason], from, to } }
    if (candidate.mapping_id) {
      const mapping = contract?.mappings.find(item => item.id === candidate.mapping_id && item.relation === name)
      if (!mapping || !sameEndpoint(mapping.from, from) || !sameEndpoint(mapping.to, to)) { fail("MAPPING_MISMATCH"); continue }
      relations[name] = { state: "supported", confirmation: "user_confirmed", reasons: [], from, to }; continue
    }
    const binding = contract?.source_bindings[name]
    if (!binding || binding.from.system_key !== from.system_key || binding.from.kind !== from.kind
      || binding.to.system_key !== to.system_key || binding.to.kind !== to.kind || !candidate.citations.length) { fail("RELATION_SOURCE_UNBOUND"); continue }
    let valid = true, stale = false
    for (const citation of candidate.citations) {
      const observation = observations.find(item => item.id === citation.observation_id)
      const source = observation && contract ? observationBinding(observation, contract) : undefined
      if (!observation || !source || source.system_key !== binding.source_system_key || !exactExcerpt(observation.content, citation)
        || source.environment !== draft.target.environment && (source.environment !== "agnostic" || name === "runtime_target")) { valid = false; break }
      const values = dependencies.flatMap(key => {
        const value = getValue(key)
        return Array.isArray(value) ? value : typeof value === "string" ? [value] : []
      })
      if (values.some(value => !excerptSupportsValue(observation.content, citation, value, true))) { valid = false; break }
      // Relation references also have a clock; a stale linkage cannot borrow a
      // recent timestamp from independently supported endpoint fields.
      const timestamp = name === "runtime_target" ? getValue("runtime.source_updated_at") : observation.observed_at
      if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp)) || Date.parse(timestamp) > now + 5 * 60_000
        || name === "runtime_target" && !excerptSupportsValue(observation.content, citation, timestamp, false)) { valid = false; break }
      const window = name === "runtime_target" ? contract!.freshness?.runtime_ms ?? 15 * 60_000 : contract!.freshness?.mutable_ms ?? 24 * 3600_000
      stale ||= now - Date.parse(timestamp) > window
    }
    if (!valid) fail("RELATION_CITATION_UNVERIFIED")
    else if (stale) fail("RELATION_STALE", "stale")
    else relations[name] = { state: "supported", confirmation: "tool_verified", reasons: [], from, to }
  }

  const draftTextPresent = Boolean(draft.story_draft_text?.trim())
  if (draft.kind === "development_trace.v1") {
    const names = ["requirement.id", "requirement.acceptance_criteria", "story.requirement_id", "story.acceptance_criteria"]
    const requirementSources = new Set(fields["requirement.id"].sources.map(source => source.system_key))
    const storySourceMatches = ["story.requirement_id", "story.acceptance_criteria"].every(name => fields[name].sources.every(source => requirementSources.has(source.system_key)))
    relations.story_requirement = names.every(name => fields[name].state === "supported") && draftTextPresent && storySourceMatches
      ? { state: "supported", confirmation: "tool_verified", reasons: [] } : { state: "unverified", reasons: ["STORY_SOURCE_UNVERIFIED"] }
    relations.criteria_cases = fields["tests.criteria_mapping"].state === "supported"
      ? { state: "supported", confirmation: "tool_verified", reasons: [] } : { state: fields["tests.criteria_mapping"].state, reasons: ["CRITERIA_MAPPING_UNVERIFIED"] }
  }
  const gaps: string[] = []
  const runtimeExemption = draft.kind === "change_material.v1" && contract?.runtime_not_applicable?.allowed === true
    && Object.keys(schema.fields).filter(name => name.startsWith("runtime.")).every(name => fields[name].state === "missing")
    && !draft.relations.runtime_target ? { rationale: contract.runtime_not_applicable.rationale, basis: "locked_pilot_contract" as const } : undefined
  if (!contract) gaps.push("PILOT_CONTRACT_MISSING")
  if (capacityGap) gaps.push("EVIDENCE_CAPACITY_GAP")
  for (const [name, definition] of Object.entries(schema.fields)) {
    if (runtimeExemption && name.startsWith("runtime.")) continue
    if ((definition.required || contract?.required_fields.includes(name) || draft.fields[name]?.value != null) && fields[name].state !== "supported") gaps.push(`${name}:${fields[name].state}`)
  }
  if (contract?.required_fields.some(name => !Object.prototype.hasOwnProperty.call(schema.fields, name))) gaps.push("PILOT_FIELDS_SCHEMA_MISMATCH")
  for (const name of schema.relations) if (!(runtimeExemption && name === "runtime_target") && relations[name].state !== "supported") gaps.push(`${name}:${relations[name].state}`)
  if (draft.kind === "development_trace.v1") {
    if (!draftTextPresent) gaps.push("STORY_DRAFT_MISSING")
    if (!contract?.pass_values.includes(String(getValue("tests.outcome") ?? ""))) gaps.push("TESTS_NOT_PASSING")
  }
  const referenced = new Set(Object.values(draft.fields).flatMap(field => [...field.citations, ...("coverage_citations" in field ? field.coverage_citations : [])]).map(citation => citation.observation_id))
  const { mutation_result: _historicalReply, ...publicDraft } = structuredClone(draft)
  return { draft: publicDraft, fields, relations, ready: gaps.length === 0, gaps, draft_text_present: draftTextPresent,
    coverage_basis: [...new Set(observations.filter(observation => referenced.has(observation.id)).map(observation => observation.provenance.coverage_basis).filter((basis): basis is string => typeof basis === "string"))],
    checked_at: new Date(now).toISOString(), ...(runtimeExemption ? { runtime_exemption: runtimeExemption } : {}) }
}
