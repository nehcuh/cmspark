import { z } from "zod"
import { normalizeEvidenceText } from "./content"
import { DRAFT_SCHEMAS, DERIVED_RELATIONS, type DraftKind } from "./schema"

const text = z.string().transform(normalizeEvidenceText)
const requestId = z.string().min(1).max(128).refine(value => Boolean(value.trim()), "request_id must not be blank")
export const citationSchema = z.object({
  observation_id: z.string().min(1), excerpt: text,
  start: z.number().int().safe().nonnegative(), end: z.number().int().safe().positive(),
}).strict().refine(value => value.end > value.start, "empty/reversed excerpt range")
const memberCitation = z.object({
  observation_id: z.string().min(1), excerpt: text,
  start: z.number().int().safe().nonnegative(), end: z.number().int().safe().positive(), member_index: z.number().int().safe().nonnegative(),
}).strict().refine(value => value.end > value.start, "empty/reversed excerpt range")
const scalarSchema = z.object({ value: text.nullable(), citations: z.array(citationSchema) }).strict()
const collectionSchema = z.object({ value: z.array(text).nullable(), citations: z.array(memberCitation), coverage_citations: z.array(citationSchema) }).strict()
const relationSchema = z.object({ citations: z.array(citationSchema), mapping_id: z.string().min(1).optional() }).strict()

export type Citation = z.infer<typeof citationSchema>
export type ScalarCandidate = z.infer<typeof scalarSchema>
export type CollectionCandidate = z.infer<typeof collectionSchema>
export type FactCandidate = ScalarCandidate | CollectionCandidate
export type RelationCandidate = z.infer<typeof relationSchema>

const createSchema = z.object({
  kind: z.enum(["change_material.v1", "development_trace.v1"]),
  title: text.refine(value => Boolean(value.trim()), "title must not be blank"),
  target: z.object({ business_system_id: text.optional(), environment: text.refine(value => Boolean(value.trim())) }).strict(),
  request_id: requestId,
}).strict()

export function parseDraftCreate(input: unknown) {
  const request = createSchema.parse(input)
  if (request.kind === "change_material.v1" && !request.target.business_system_id?.trim()) throw new Error("BUSINESS_SYSTEM_REQUIRED")
  return request
}
export type DraftCreateRequest = ReturnType<typeof parseDraftCreate>

const updateSchema = z.object({
  draft_id: z.string().min(1), expected_revision: z.number().int().safe().positive(), request_id: requestId,
  fields: z.record(z.unknown()).optional(), relations: z.record(z.unknown()).optional(),
  story_draft_text: text.nullable().optional(),
}).strict()

export function parseDraftUpdate(input: unknown, kind: DraftKind) {
  const request = updateSchema.parse(input)
  const schema = Object.prototype.hasOwnProperty.call(DRAFT_SCHEMAS, kind) ? DRAFT_SCHEMAS[kind] : undefined
  if (!schema) throw new Error("DRAFT_SCHEMA_UNSUPPORTED")
  const fields: Record<string, FactCandidate> = Object.create(null)
  const relations: Record<string, RelationCandidate> = Object.create(null)
  for (const [name, value] of Object.entries(request.fields || {})) {
    const definition = Object.prototype.hasOwnProperty.call(schema.fields, name) ? schema.fields[name] : undefined
    if (!definition) throw new Error("INVALID_FIELD")
    if (definition.type === "scalar") fields[name] = scalarSchema.parse(value)
    else {
      const candidate = collectionSchema.parse(value)
      if (candidate.value !== null && (candidate.value.some(item => !item.trim()) || new Set(candidate.value).size !== candidate.value.length)) throw new Error("INVALID_COLLECTION_MEMBERS")
      if (candidate.citations.some(citation => candidate.value === null || citation.member_index >= candidate.value.length)) throw new Error("INVALID_MEMBER_INDEX")
      fields[name] = candidate
    }
  }
  for (const [name, value] of Object.entries(request.relations || {})) {
    if (!schema.relations.includes(name) || DERIVED_RELATIONS.has(name)) throw new Error("INVALID_RELATION")
    relations[name] = relationSchema.parse(value)
  }
  if (request.story_draft_text !== undefined && kind !== "development_trace.v1") throw new Error("STORY_DRAFT_NOT_APPLICABLE")
  return {
    draft_id: request.draft_id, expected_revision: request.expected_revision, request_id: request.request_id,
    ...(request.fields !== undefined ? { fields: { ...fields } } : {}),
    ...(request.relations !== undefined ? { relations: { ...relations } } : {}),
    ...(request.story_draft_text !== undefined ? { story_draft_text: request.story_draft_text } : {}),
  }
}
export type DraftUpdateRequest = ReturnType<typeof parseDraftUpdate>

export function parseDraftId(input: unknown) { return z.object({ draft_id: z.string().min(1) }).strict().parse(input).draft_id }
