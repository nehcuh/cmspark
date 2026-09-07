import { randomUUID } from "node:crypto"
import { canonicalRequest, evidenceDigest } from "./content"
import { parseDraftCreate, parseDraftId, parseDraftUpdate, type DraftCreateRequest, type FactCandidate, type RelationCandidate } from "./draft-contract"
import { loadPilotContract, validateLockedPilot, type LockedPilotContract } from "./pilot-contract"
import { EvidenceStore, type EvidenceFile } from "./store"
import { DRAFT_SCHEMAS, type DraftKind } from "./schema"
import { checkDraft } from "./checker"

export interface DraftRecord extends Record<string, unknown> {
  schema_version: 1
  id: string
  kind: DraftKind
  title: string
  target: DraftCreateRequest["target"]
  revision: number
  created_at: string
  updated_at: string
  pilot_digest: string
  fields: Record<string, FactCandidate>
  relations: Record<string, RelationCandidate>
  story_draft_text?: string | null
  /** Historical mutation reply for exact retries; read/render recompute status. */
  mutation_result: { draft_id: string; revision: number; ready: boolean; gaps: string[]; checked_at: string }
}
interface Replay { request_id: string; digest: string; result: DraftRecord }

/** Validate persisted candidates on read, preserving unknown schema-1 extensions.
 * Current status is recomputed; mutation_result is only a historical retry reply. */
function draftRecord(raw: Record<string, unknown>, pilot: LockedPilotContract | undefined): DraftRecord {
  if (raw.schema_version !== 1) throw new Error("DRAFT_SCHEMA_UNSUPPORTED")
  if (typeof raw.kind !== "string" || !Object.prototype.hasOwnProperty.call(DRAFT_SCHEMAS, raw.kind)
    || typeof raw.id !== "string" || !raw.id || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1
    || typeof raw.created_at !== "string" || !Number.isFinite(Date.parse(raw.created_at))
    || typeof raw.updated_at !== "string" || !Number.isFinite(Date.parse(raw.updated_at))
    || !pilot || raw.pilot_digest !== pilot.digest || !raw.fields || !raw.relations) throw new Error("DRAFT_CORRUPT")
  const reply = raw.mutation_result as DraftRecord["mutation_result"] | undefined
  if (!reply || reply.draft_id !== raw.id || reply.revision !== raw.revision || typeof reply.ready !== "boolean"
    || !Array.isArray(reply.gaps) || reply.gaps.some(gap => typeof gap !== "string")
    || typeof reply.checked_at !== "string" || !Number.isFinite(Date.parse(reply.checked_at))) throw new Error("DRAFT_CORRUPT")
  parseDraftCreate({ kind: raw.kind, title: raw.title, target: raw.target, request_id: "validate" })
  parseDraftUpdate({ draft_id: raw.id, expected_revision: raw.revision, request_id: "validate", fields: raw.fields, relations: raw.relations,
    ...(raw.story_draft_text !== undefined ? { story_draft_text: raw.story_draft_text } : {}) }, raw.kind as DraftKind)
  return raw as DraftRecord
}

function records(state: EvidenceFile) {
  const drafts = state.drafts.map(raw => draftRecord(raw, state.locked_pilot))
  if (new Set(drafts.map(draft => draft.id)).size !== drafts.length) throw new Error("DRAFT_CORRUPT")
  const cache = state.draft_requests ?? []
  if (!Array.isArray(cache)) throw new Error("DRAFT_REPLAY_CORRUPT")
  const ids = new Set<string>()
  for (const replay of cache) {
    if (!replay || typeof replay.request_id !== "string" || !replay.request_id.trim() || replay.request_id.length > 128
      || ids.has(replay.request_id) || typeof replay.digest !== "string" || !/^[a-f0-9]{64}$/.test(replay.digest)
      || !replay.result || typeof replay.result !== "object") throw new Error("DRAFT_REPLAY_CORRUPT")
    const result = draftRecord(replay.result, state.locked_pilot)
    const current = drafts.find(draft => draft.id === result.id)
    if (!current || current.kind !== result.kind || result.revision > current.revision) throw new Error("DRAFT_REPLAY_CORRUPT")
    ids.add(replay.request_id)
  }
  return { drafts, cache: cache as Replay[] }
}

/** Owns persistence and optimistic concurrency only. Public tools must use the
 * checked view, not label a candidate returned here as a verified fact. */
export class DraftRepository {
  constructor(private readonly store: EvidenceStore, private readonly pilotFile: string, private readonly now: () => number = Date.now) {}

  private mutate(request: { request_id: string }, operation: string, update: (state: EvidenceFile, drafts: DraftRecord[]) => DraftRecord): DraftRecord {
    const { request_id, ...parameters } = request
    const digest = evidenceDigest(canonicalRequest({ operation, parameters }))
    return this.store.transaction(state => {
      const { drafts, cache } = records(state)
      const replay = cache.find(entry => entry.request_id === request_id)
      if (replay) {
        if (replay.digest !== digest) throw new Error("IDEMPOTENCY_CONFLICT")
        return structuredClone(replay.result)
      }
      const result = update(state, drafts)
      const view = checkDraft(result, state.observations, state.locked_pilot!, state.capacity_gap, this.now())
      result.mutation_result = { draft_id: result.id, revision: result.revision, ready: view.ready, gaps: view.gaps, checked_at: view.checked_at }
      // This snapshot is immutable by convention and is not a pointer to the
      // current draft: a retry returns the original revision, even after edits.
      state.draft_requests = [...cache, { request_id, digest, result: structuredClone(result) }]
      return structuredClone(result)
    })
  }

  create(input: unknown): DraftRecord {
    const request = parseDraftCreate(input)
    return this.mutate(request, "draft_create", state => {
      if (!state.locked_pilot) state.locked_pilot = loadPilotContract(this.pilotFile)
      validateLockedPilot(state.locked_pilot)
      const timestamp = new Date(this.now()).toISOString()
      const result: DraftRecord = { schema_version: 1, id: randomUUID(), kind: request.kind, title: request.title,
        target: request.target, revision: 1, created_at: timestamp, updated_at: timestamp,
        pilot_digest: state.locked_pilot.digest, fields: {}, relations: {},
        mutation_result: { draft_id: "", revision: 1, ready: false, gaps: [], checked_at: timestamp } }
      state.drafts.push(result)
      return result
    })
  }

  update(input: unknown): DraftRecord {
    // The read only selects the fixed schema. Revision and replay checks are
    // repeated inside the transaction; a caller cannot choose another schema.
    const id = parseDraftId({ draft_id: (input as any)?.draft_id })
    const prior = this.read({ draft_id: id })
    const request = parseDraftUpdate(input, prior.kind)
    return this.mutate(request, "draft_update", (state, drafts) => {
      const index = drafts.findIndex(draft => draft.id === request.draft_id)
      if (index < 0) throw new Error("DRAFT_NOT_FOUND")
      const current = drafts[index]
      if (request.expected_revision !== current.revision) throw new Error("DRAFT_REVISION_CONFLICT")
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error("DRAFT_REVISION_LIMIT")
      const result: DraftRecord = { ...current, revision: current.revision + 1, updated_at: new Date(this.now()).toISOString(),
        fields: { ...current.fields, ...request.fields }, relations: { ...current.relations, ...request.relations },
        ...(request.story_draft_text !== undefined ? { story_draft_text: request.story_draft_text } : {}) }
      state.drafts[index] = result
      return result
    })
  }

  read(input: unknown): DraftRecord {
    const id = parseDraftId(input)
    const result = records(this.store.read()).drafts.find(draft => draft.id === id)
    if (!result) throw new Error("DRAFT_NOT_FOUND")
    return structuredClone(result)
  }
}
