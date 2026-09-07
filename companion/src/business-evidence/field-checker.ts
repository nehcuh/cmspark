import { canonicalRequest, criterionIdentity, exactExcerpt, excerptSupportsValue } from "./content"
import type { Citation, CollectionCandidate, FactCandidate, ScalarCandidate } from "./draft-contract"
import type { DraftRecord } from "./draft-repository"
import { observationBinding, type LockedPilotContract } from "./pilot-contract"
import { DRAFT_SCHEMAS, type FieldDefinition, type FieldState } from "./schema"
import type { Observation } from "./store"

export interface CheckedSource { observation_id: string; system_key: string; environment: string; origin: string; url: string; observed_at: string }
export interface CheckedField { state: FieldState; reasons: string[]; sources: CheckedSource[] }
export type CheckedFields = Record<string, CheckedField>
const result = (state: FieldState, reason: string, sources: CheckedSource[] = []): CheckedField => ({ state, reasons: [reason], sources })
const scalarValue = (draft: DraftRecord, name: string) => typeof draft.fields[name]?.value === "string" ? draft.fields[name].value as string : undefined
const businessTimestamp = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))

/** Only checks registered candidates against immutable local Observations. It
 * does not infer semantic truth from an LLM score or from an uncited URL. */
export function checkFields(draft: DraftRecord, observations: readonly Observation[], locked: LockedPilotContract, now: number): CheckedFields {
  const schema = DRAFT_SCHEMAS[draft.kind]
  const contract = locked.contract
  const index = new Map(observations.map(observation => [observation.id, observation]))
  const fields: CheckedFields = {}
  const resolve = (citation: Citation) => {
    const observation = index.get(citation.observation_id)
    if (!observation || !contract || !exactExcerpt(observation.content, citation)) return undefined
    const binding = observationBinding(observation, contract)
    return binding ? { observation, binding } : undefined
  }
  const source = (resolved: NonNullable<ReturnType<typeof resolve>>): CheckedSource => ({ observation_id: resolved.observation.id,
    system_key: resolved.binding.system_key, environment: resolved.binding.environment, origin: resolved.observation.target.origin,
    url: resolved.observation.target.url, observed_at: resolved.observation.observed_at })

  function validateCitations(name: string, candidate: FactCandidate, definition: FieldDefinition): CheckedField {
    if (candidate.value === null || typeof candidate.value === "string" && !candidate.value.trim()) return result("missing", "NO_CANDIDATE")
    const collection = definition.type === "collection" ? candidate as CollectionCandidate : undefined
    const citations: Citation[] = collection ? [...collection.citations, ...collection.coverage_citations] : candidate.citations
    if (!citations.length) return result("unverified", "NO_CITATIONS")
    const sources: CheckedSource[] = []
    for (const citation of citations) {
      const resolved = resolve(citation)
      if (!resolved) return result("unverified", "INVALID_OR_UNBOUND_CITATION")
      sources.push(source(resolved))
    }
    if (sources.some(item => item.environment !== draft.target.environment &&
      (item.environment !== "agnostic" || name.startsWith("runtime.") || name.startsWith("target.")))) return result("conflict", "ENVIRONMENT_MISMATCH", sources)
    // A field cannot silently merge same-number objects from distinct platforms.
    if (new Set(sources.map(item => item.system_key)).size !== 1) return result("conflict", "SOURCE_NAMESPACE_MISMATCH", sources)
    if (collection) {
      if (collection.value!.some((value, member_index) => !collection.citations.some(citation => citation.member_index === member_index))) return result("unverified", "UNCITED_MEMBER", sources)
      for (const citation of collection.citations) {
        if (name === "tests.criteria_mapping") continue // Derived member semantics below, after prerequisite fields.
        if (!excerptSupportsValue(index.get(citation.observation_id)!.content, citation, collection.value![citation.member_index], definition.token)) return result("unverified", "UNSUPPORTED_MEMBER", sources)
      }
    } else if (candidate.citations.some(citation => !excerptSupportsValue(index.get(citation.observation_id)!.content, citation, candidate.value as string, definition.token))) {
      return result("unverified", "UNSUPPORTED_VALUE", sources)
    }
    if (name.endsWith(".source_updated_at") && (typeof candidate.value !== "string" || !businessTimestamp(candidate.value)
      || candidate.citations.some(citation => !excerptSupportsValue(index.get(citation.observation_id)!.content, citation, candidate.value as string, true)))) return result("unverified", "SOURCE_TIME_UNVERIFIED", sources)
    return { state: "supported", reasons: [], sources }
  }

  function freshness(name: string, candidate: FactCandidate, definition: FieldDefinition): string | undefined {
    if (definition.clock === "immutable") return undefined
    const window = definition.clock === "runtime" ? contract?.freshness?.runtime_ms ?? 15 * 60_000
      : definition.clock === "tests" ? contract?.freshness?.tests_ms ?? 24 * 3600_000 : contract?.freshness?.mutable_ms ?? 24 * 3600_000
    const citations = [...candidate.citations, ...("coverage_citations" in candidate ? candidate.coverage_citations : [])]
    for (const citation of citations) {
      const observation = index.get(citation.observation_id)!
      let timestamp = Date.parse(observation.observed_at)
      if (definition.clock === "runtime" || definition.clock === "tests") {
        const clockName = definition.clock === "runtime" ? "runtime.source_updated_at" : "tests.source_updated_at"
        const time = scalarValue(draft, clockName)
        const clock = draft.fields[clockName] as ScalarCandidate | undefined
        // Empty coverage excerpts must equal the fixed empty_marker. Its clock
        // is separately cited within this same Observation's registered scope;
        // coverage() still requires that exact full scope and frozen adapter.
        const explicitEmpty = Array.isArray(candidate.value) && candidate.value.length === 0
        if (!time || !businessTimestamp(time) || !clock?.citations.some(ref => ref.observation_id === observation.id && exactExcerpt(observation.content, ref) && excerptSupportsValue(observation.content, ref, time, true))
          || !explicitEmpty && !excerptSupportsValue(observation.content, citation, time, true)) return "SOURCE_TIME_UNVERIFIED"
        timestamp = Date.parse(time)
      }
      if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000) return "SOURCE_TIME_UNVERIFIED"
      if (now - timestamp > window) return "STALE"
    }
    return undefined
  }

  function coverage(name: string, candidate: CollectionCandidate): string | undefined {
    const adapter = contract?.collection_scopes[name]
    if (!adapter || !candidate.coverage_citations.length) return "COVERAGE_UNKNOWN"
    for (const citation of [...candidate.citations, ...candidate.coverage_citations]) {
      const observation = index.get(citation.observation_id)!
      const p = observation.provenance
      if (p.coverage !== "complete_for_scope" || p.complete_for_scope !== true || p.truncated !== false
        || p.pagination !== "not_present" || p.virtualization !== "not_present" || p.frame !== "top"
        || p.contract_digest !== locked.digest || p.adapter_id !== adapter.adapter_id || p.adapter_version !== adapter.adapter_version
        || p.coverage_basis !== "user_pilot_declaration" || canonicalRequest(p.scope) !== canonicalRequest(adapter.scope)
        || observationBinding(observation, contract!)?.system_key !== adapter.binding_system_key) return "COVERAGE_UNKNOWN"
    }
    if (candidate.value!.length === 0 && candidate.coverage_citations.some(citation => citation.excerpt !== adapter.empty_marker)) return "EMPTY_NOT_EXPLICIT"
    return undefined
  }

  for (const [name, definition] of Object.entries(schema.fields)) {
    const candidate = draft.fields[name]
    fields[name] = candidate ? validateCitations(name, candidate, definition) : result("missing", "NO_CANDIDATE")
  }
  const conflict = (names: string[], reason: string) => {
    for (const name of names) if (fields[name]?.state === "supported") fields[name] = result("conflict", reason, fields[name].sources)
  }
  const equal = (left: string, right: string) => {
    if (fields[left]?.state === "supported" && fields[right]?.state === "supported" && scalarValue(draft, left) !== scalarValue(draft, right)) conflict([left, right], "FOREIGN_KEY_MISMATCH")
  }
  if (draft.kind === "change_material.v1") {
    for (const [name, expected] of [["target.system_id", draft.target.business_system_id], ["target.environment", draft.target.environment]] as const) {
      if (fields[name].state === "supported" && scalarValue(draft, name) !== expected) conflict([name], "REQUESTED_TARGET_MISMATCH")
    }
    equal("release.build_id", "artifact.build_id")
    equal("target.system_id", "architecture.system_id")
    equal("target.system_id", "runtime.system_id")
    equal("target.environment", "runtime.environment")
  } else {
    for (const name of ["story.requirement_id", "code.requirement_id", "tests.requirement_id", "defects.requirement_id"]) equal("requirement.id", name)
    equal("code.commit_id", "tests.commit_id")
    if (fields["story.acceptance_criteria"].state === "supported" && fields["requirement.acceptance_criteria"].state === "supported") {
      const left = (draft.fields["story.acceptance_criteria"].value as string[]).slice().sort()
      const right = (draft.fields["requirement.acceptance_criteria"].value as string[]).slice().sort()
      if (JSON.stringify(left) !== JSON.stringify(right)) conflict(["story.acceptance_criteria"], "ACCEPTANCE_CRITERIA_MISMATCH")
    }
  }
  for (const [name, definition] of Object.entries(schema.fields)) {
    if (fields[name].state !== "supported") continue
    const candidate = draft.fields[name]
    const time = freshness(name, candidate, definition)
    const gap = time || (definition.type === "collection" ? coverage(name, candidate as CollectionCandidate) : undefined)
    if (gap) fields[name] = result(gap === "STALE" ? "stale" : "unverified", gap, fields[name].sources)
  }

  const contextualIdentities: Record<string, string[]> = draft.kind === "change_material.v1" ? {
    "release.commit_id": ["release.id", "release.version"], "artifact.digest": ["artifact.id", "artifact.version"],
    "architecture.revision": ["architecture.system_id"],
  } : { "code.commit_id": ["code.repository_id", "code.requirement_id"], "tests.commit_id": ["tests.run_id", "tests.requirement_id"] }
  for (const [name, dependencies] of Object.entries(contextualIdentities)) {
    if (fields[name]?.state !== "supported") continue
    if (dependencies.some(key => fields[key].state !== "supported") || draft.fields[name].citations.some(citation => dependencies.some(key =>
      !excerptSupportsValue(index.get(citation.observation_id)!.content, citation, scalarValue(draft, key) || "", true)))) {
      fields[name] = result("unverified", "IDENTITY_CONTEXT_UNVERIFIED", fields[name].sources)
    }
  }
  // An optional PR is still a factual claim; its own source must expose the
  // selected head commit. A pasted link alone never establishes this relation.
  if (fields["code.pr_id"]?.state === "supported") {
    if (fields["code.commit_id"].state !== "supported" || draft.fields["code.pr_id"].citations.some(citation =>
      !excerptSupportsValue(index.get(citation.observation_id)!.content, citation, scalarValue(draft, "code.commit_id") || "", true))) {
      fields["code.pr_id"] = result("unverified", "PR_HEAD_UNVERIFIED", fields["code.pr_id"].sources)
    }
  }

  // This derived field uses the standard text and case ID, never asks a page
  // to contain a locally invented hash or treats arbitrary JSON as evidence.
  if (fields["tests.criteria_mapping"]?.state === "supported") {
    const name = "tests.criteria_mapping", candidate = draft.fields[name] as CollectionCandidate
    const prerequisites = ["requirement.id", "requirement.acceptance_criteria", "tests.case_ids"]
    const binding = contract?.source_bindings.criteria_cases
    let valid = prerequisites.every(key => fields[key].state === "supported") && Boolean(binding)
    const criteria = draft.fields["requirement.acceptance_criteria"]?.value as string[] | undefined
    const caseIds = draft.fields["tests.case_ids"]?.value as string[] | undefined
    const ids = new Map((criteria || []).map(text => [criterionIdentity(scalarValue(draft, "requirement.id") || "", text), text]))
    const covered = new Set<string>()
    if (binding) valid &&= fields["requirement.id"].sources.every(s => s.system_key === binding.from.system_key)
      && fields["tests.case_ids"].sources.every(s => s.system_key === binding.to.system_key)
      && binding.from.kind === "acceptance_criterion" && binding.to.kind === "test_case"
    for (let i = 0; i < candidate.value!.length && valid; i++) {
      const value = candidate.value![i]
      let pair: unknown
      try { pair = JSON.parse(value) } catch { valid = false; break }
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some(item => typeof item !== "string") || JSON.stringify(pair) !== value || !ids.has(pair[0]) || !caseIds?.includes(pair[1])) { valid = false; break }
      const [id, caseId] = pair as string[]
      for (const citation of candidate.citations.filter(ref => ref.member_index === i)) {
        const resolved = resolve(citation)!
        valid &&= resolved.binding.system_key === binding!.source_system_key
          && excerptSupportsValue(resolved.observation.content, citation, ids.get(id)!, false)
          && excerptSupportsValue(resolved.observation.content, citation, caseId, true)
          // A whole page mentioning A→1 and B→2 cannot prove A→2. Require one
          // textual relationship row with no competing known standard/case.
          && !citation.excerpt.includes("\n")
          && [...ids.entries()].every(([otherId, text]) => otherId === id || !excerptSupportsValue(resolved.observation.content, citation, text, false))
          && (caseIds || []).every(otherCase => otherCase === caseId || !excerptSupportsValue(resolved.observation.content, citation, otherCase, true))
      }
      covered.add(id)
    }
    if (!valid || !ids.size || [...ids.keys()].some(id => !covered.has(id))) fields[name] = result("unverified", "CRITERIA_MAPPING_UNVERIFIED", fields[name].sources)
  }
  return fields
}
