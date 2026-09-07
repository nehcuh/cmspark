import { z } from "zod"
import * as fs from "node:fs"
import { createHash } from "node:crypto"
import { canonicalRequest, exactExcerpt, excerptSupportsValue } from "./content"
import { COLLECTION_FIELDS, DERIVED_RELATIONS, KNOWN_FIELDS, KNOWN_RELATIONS } from "./schema"
import type { Observation } from "./store"

const nonempty = z.string().trim().min(1).max(2048)
const endpoint = z.object({ system_key: nonempty, kind: nonempty, external_id: nonempty }).strict()
const endpointType = z.object({ system_key: nonempty, kind: nonempty }).strict()
const scope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document") }).strict(),
  z.object({ kind: z.literal("selector"), selector: nonempty }).strict(),
])
const contractSchema = z.object({
  schema_version: z.literal(1),
  bindings: z.array(z.object({ system_key: nonempty, environment: nonempty, origins: z.array(nonempty).min(1), environment_selector: nonempty.optional(), environment_literal: nonempty.optional() }).strict()),
  collection_scopes: z.record(z.object({ adapter_id: nonempty, adapter_version: nonempty, scope, empty_marker: nonempty, binding_system_key: nonempty }).strict()),
  source_bindings: z.record(z.object({ source_system_key: nonempty, from: endpointType, to: endpointType }).strict()),
  mappings: z.array(z.object({ id: nonempty, relation: nonempty, from: endpoint, to: endpoint, rationale: nonempty }).strict()),
  required_fields: z.array(nonempty),
  pass_values: z.array(nonempty).min(1),
  freshness: z.object({ mutable_ms: z.number().int().positive().safe().optional(), runtime_ms: z.number().int().positive().safe().optional(), tests_ms: z.number().int().positive().safe().optional() }).strict().optional(),
  runtime_not_applicable: z.object({ allowed: z.boolean(), rationale: nonempty }).strict().optional(),
}).strict()

export type PilotContract = z.infer<typeof contractSchema>
export interface LockedPilotContract { digest: string; contract: PilotContract | null }

export function validateLockedPilot(locked: LockedPilotContract): void {
  if (!locked || typeof locked !== "object") throw new Error("PILOT_CONTRACT_CORRUPT")
  const expected = locked.contract === null ? createHash("sha256").update("null").digest("hex") : parsePilotContract(locked.contract).digest
  if (locked.digest !== expected) throw new Error("PILOT_CONTRACT_CORRUPT")
}

export function exactContractOrigin(raw: string): string {
  const url = new URL(raw)
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.hostname.includes("*")) throw new Error("PILOT_CONTRACT_INVALID_ORIGIN")
  return url.origin
}

export function parsePilotContract(raw: unknown): LockedPilotContract {
  if ((raw as any)?.schema_version !== 1) throw new Error("PILOT_CONTRACT_SCHEMA_UNSUPPORTED")
  const contract = contractSchema.parse(raw)
  const platforms = new Set(contract.bindings.map(binding => binding.system_key))
  const origins = new Map<string, PilotContract["bindings"]>()
  for (const binding of contract.bindings) {
    if (Boolean(binding.environment_selector) !== Boolean(binding.environment_literal)) throw new Error("PILOT_CONTRACT_AMBIGUOUS_BINDING")
    binding.origins = binding.origins.map(exactContractOrigin)
    if (new Set(binding.origins).size !== binding.origins.length) throw new Error("PILOT_CONTRACT_DUPLICATE_ORIGIN")
    for (const origin of binding.origins) origins.set(origin, [...(origins.get(origin) || []), binding])
  }
  for (const rows of origins.values()) {
    if (rows.length < 2) continue
    // Shared-origin rows require a concrete scope+literal discriminator; actual
    // capture still rejects when more than one row matches the observed text.
    if (rows.some(row => !row.environment_selector || !row.environment_literal)
      || new Set(rows.map(row => JSON.stringify([row.environment_selector, row.environment_literal]))).size !== rows.length) throw new Error("PILOT_CONTRACT_AMBIGUOUS_BINDING")
  }
  for (const [field, adapter] of Object.entries(contract.collection_scopes)) {
    if (!COLLECTION_FIELDS.has(field) || !platforms.has(adapter.binding_system_key)) throw new Error("PILOT_CONTRACT_INVALID_COLLECTION")
  }
  for (const field of contract.required_fields) if (!KNOWN_FIELDS.has(field)) throw new Error("PILOT_CONTRACT_INVALID_FIELD")
  for (const [relation, binding] of Object.entries(contract.source_bindings)) {
    if (!KNOWN_RELATIONS.has(relation) || DERIVED_RELATIONS.has(relation) && relation !== "criteria_cases"
      || ![binding.source_system_key, binding.from.system_key, binding.to.system_key].every(key => platforms.has(key))) throw new Error("PILOT_CONTRACT_INVALID_RELATION")
  }
  const ids = new Set<string>()
  for (const mapping of contract.mappings) {
    if (ids.has(mapping.id) || !KNOWN_RELATIONS.has(mapping.relation) || DERIVED_RELATIONS.has(mapping.relation)
      || !platforms.has(mapping.from.system_key) || !platforms.has(mapping.to.system_key)) throw new Error("PILOT_CONTRACT_INVALID_MAPPING")
    ids.add(mapping.id)
  }
  return { contract, digest: createHash("sha256").update(canonicalRequest(contract), "utf8").digest("hex") }
}

export function loadPilotContract(file: string): LockedPilotContract {
  try {
    if (fs.statSync(file).size > 256 * 1024) throw new Error("PILOT_CONTRACT_CAPACITY")
    return parsePilotContract(JSON.parse(fs.readFileSync(file, "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { contract: null, digest: createHash("sha256").update("null").digest("hex") }
    throw error
  }
}

export function observationBinding(observation: Observation, contract: PilotContract) {
  const matches = contract.bindings.filter(row => {
    if (!row.origins.includes(observation.target.origin)) return false
    if (!row.environment_selector) return true
    const readScope = observation.provenance.scope as any
    if (readScope?.kind !== "selector" || readScope.selector !== row.environment_selector) return false
    const citation = { start: 0, end: Array.from(observation.content).length, excerpt: observation.content }
    return exactExcerpt(observation.content, citation) && excerptSupportsValue(observation.content, citation, row.environment_literal!, true)
  })
  return matches.length === 1 ? matches[0] : undefined
}

/** Only invoked before insertion. Never mutates an existing Observation. */
export function applyPilotCoverage(observation: Observation, locked: LockedPilotContract | undefined): Observation {
  if (!locked?.contract || observation.provenance.truncated !== false || observation.provenance.frame !== "top") return observation
  const binding = observationBinding(observation, locked.contract)
  if (!binding) return observation
  const matches = Object.values(locked.contract.collection_scopes).filter(adapter =>
    adapter.binding_system_key === binding.system_key && canonicalRequest(adapter.scope) === canonicalRequest(observation.provenance.scope))
  if (!matches.length || new Set(matches.map(adapter => JSON.stringify([adapter.adapter_id, adapter.adapter_version]))).size !== 1) return observation
  const adapter = matches[0]
  if (adapter.adapter_id !== "static_declaration_v1" || adapter.adapter_version !== "1") return observation
  return { ...observation, provenance: {
    ...observation.provenance, coverage: "complete_for_scope", complete_for_scope: true,
    pagination: "not_present", virtualization: "not_present", adapter_id: adapter.adapter_id,
    adapter_version: adapter.adapter_version, contract_digest: locked.digest, coverage_basis: "user_pilot_declaration",
  } }
}
