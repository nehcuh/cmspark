/**
 * MissionBoard P0 schema (ADR-016).
 *
 * Clean-room: Fact / Intent / Hint / trust tiers are CMspark designs.
 * Do not import or mirror third-party AGPL schema text.
 */

import { z } from "zod"
import { randomBytes } from "crypto"

// ── Schema caps (ADR-016 §2.2.3) ──────────────────────────────────────────

export const BOARD_CAPS = {
  max_facts: 200,
  max_intents: 50,
  max_hints: 50,
  max_claim_chars: 2000,
  max_evidence_per_fact: 16,
  max_evidence_value_chars: 4000,
  max_tags_per_fact: 16,
  max_board_json_bytes: 512_000,
  max_open_intents_per_worker: 3,
  max_open_intents_per_run: 15,
  max_description_chars: 2000,
  max_hint_chars: 2000,
  max_goal_chars: 4000,
  max_origin_chars: 4000,
  max_summary_chars: 4000,
} as const

export const BOARD_SCHEMA_VERSION = 1 as const

// ── Enums / leaf types ────────────────────────────────────────────────────

export const TrustTierSchema = z.enum(["llm_asserted", "tool_verified", "user_confirmed"])
export type TrustTier = z.infer<typeof TrustTierSchema>

export const ActorTypeSchema = z.enum(["worker", "orchestrator", "user", "system"])
export type ActorType = z.infer<typeof ActorTypeSchema>

export const BoardStatusSchema = z.enum(["open", "completed", "abandoned"])
export type BoardStatus = z.infer<typeof BoardStatusSchema>

export const IntentStatusSchema = z.enum(["open", "claimed", "done", "abandoned"])
export type IntentStatus = z.infer<typeof IntentStatusSchema>

export const IntentPrioritySchema = z.enum(["low", "normal", "high"])
export type IntentPriority = z.infer<typeof IntentPrioritySchema>

export const EvidenceKindSchema = z.enum([
  "url",
  "quote",
  "tool_result",
  "screenshot_ref",
  "message_ref",
  "other",
])
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"])
export type Severity = z.infer<typeof SeveritySchema>

export const HintVisibilitySchema = z.enum(["orchestrator_only", "run_visible"])
export type HintVisibility = z.infer<typeof HintVisibilitySchema>

// ── Provenance (server-stamped; clients must not be trusted) ───────────────

export const ProvenanceSchema = z.object({
  actor_type: ActorTypeSchema,
  thread_id: z.string().nullable(),
  worker_id: z.string().nullable(),
  orchestrator_run_id: z.string().nullable(),
  message_id: z.string().nullable(),
  tool_name: z.string().nullable(),
  at: z.string().min(1),
})
export type Provenance = z.infer<typeof ProvenanceSchema>

// ── Evidence / Fact / Intent / Hint ───────────────────────────────────────

export const EvidenceSchema = z.object({
  kind: EvidenceKindSchema,
  value: z.string().max(BOARD_CAPS.max_evidence_value_chars),
  tool_call_id: z.string().nullable().optional().default(null),
})
export type Evidence = z.infer<typeof EvidenceSchema>

export const FactSchema = z.object({
  id: z.string().min(1),
  claim: z.string().trim().min(1).max(BOARD_CAPS.max_claim_chars),
  evidence: z.array(EvidenceSchema).max(BOARD_CAPS.max_evidence_per_fact).default([]),
  trust: TrustTierSchema,
  tags: z.array(z.string().max(64)).max(BOARD_CAPS.max_tags_per_fact).default([]),
  related_intent_ids: z.array(z.string()).default([]),
  severity: SeveritySchema.nullable().default(null),
  provenance: ProvenanceSchema,
  created_at: z.string().min(1),
})
export type Fact = z.infer<typeof FactSchema>

export const IntentSchema = z.object({
  id: z.string().min(1),
  description: z.string().trim().min(1).max(BOARD_CAPS.max_description_chars),
  status: IntentStatusSchema.default("open"),
  priority: IntentPrioritySchema.default("normal"),
  claimed_by_worker_id: z.string().nullable().default(null),
  heartbeat_at: z.string().nullable().default(null),
  parent_fact_ids: z.array(z.string()).default([]),
  result_fact_ids: z.array(z.string()).default([]),
  provenance: ProvenanceSchema,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
})
export type Intent = z.infer<typeof IntentSchema>

export const HintSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1).max(BOARD_CAPS.max_hint_chars),
  visibility: HintVisibilitySchema.default("orchestrator_only"),
  provenance: ProvenanceSchema,
  created_at: z.string().min(1),
})
export type Hint = z.infer<typeof HintSchema>

export const MissionBoardSchema = z.object({
  schema_version: z.literal(BOARD_SCHEMA_VERSION),
  origin: z.string().max(BOARD_CAPS.max_origin_chars).nullable().default(null),
  goal: z.string().max(BOARD_CAPS.max_goal_chars).nullable().default(null),
  status: BoardStatusSchema.default("open"),
  facts: z.array(FactSchema).max(BOARD_CAPS.max_facts).default([]),
  intents: z.array(IntentSchema).max(BOARD_CAPS.max_intents).default([]),
  hints: z.array(HintSchema).max(BOARD_CAPS.max_hints).default([]),
  completed_at: z.string().nullable().optional().default(null),
  completed_by: ProvenanceSchema.nullable().optional().default(null),
  /** User opt-in: allow complete with empty goal (default false). */
  empty_goal_ok: z.boolean().optional().default(false),
  updated_at: z.string().min(1),
})
export type MissionBoard = z.infer<typeof MissionBoardSchema>

// ── Client handback / write drafts (trust/provenance stripped) ─────────────

/** Fact contribution from LLM/worker payload — no trusted identity fields. */
export const HandbackFactDraftSchema = z.object({
  claim: z.string().trim().min(1).max(BOARD_CAPS.max_claim_chars),
  evidence: z
    .array(
      z.object({
        kind: EvidenceKindSchema.default("other"),
        value: z.string().max(BOARD_CAPS.max_evidence_value_chars),
        tool_call_id: z.string().nullable().optional(),
      }),
    )
    .max(BOARD_CAPS.max_evidence_per_fact)
    .optional()
    .default([]),
  tags: z.array(z.string().max(64)).max(BOARD_CAPS.max_tags_per_fact).optional().default([]),
  related_intent_ids: z.array(z.string()).optional().default([]),
  severity: SeveritySchema.nullable().optional().default(null),
  // Client may send these; server always strips/ignores.
  trust: z.unknown().optional(),
  provenance: z.unknown().optional(),
  id: z.unknown().optional(),
})
export type HandbackFactDraft = z.infer<typeof HandbackFactDraftSchema>

export const HandbackIntentDraftSchema = z.object({
  description: z.string().trim().min(1).max(BOARD_CAPS.max_description_chars),
  status: z.enum(["open", "done", "abandoned"]).optional().default("open"),
  priority: IntentPrioritySchema.optional().default("normal"),
  parent_fact_ids: z.array(z.string()).optional().default([]),
  // stripped
  trust: z.unknown().optional(),
  provenance: z.unknown().optional(),
  id: z.unknown().optional(),
  claimed_by_worker_id: z.unknown().optional(),
})
export type HandbackIntentDraft = z.infer<typeof HandbackIntentDraftSchema>

export const HandbackPayloadSchema = z.object({
  schema_version: z.literal(BOARD_SCHEMA_VERSION).or(z.number().int().positive()),
  facts: z.array(HandbackFactDraftSchema).max(BOARD_CAPS.max_facts).optional().default([]),
  intents: z.array(HandbackIntentDraftSchema).max(BOARD_CAPS.max_intents).optional().default([]),
  summary: z.string().max(BOARD_CAPS.max_summary_chars).optional().nullable(),
  complete_proposal: z.unknown().optional().nullable(),
  empty_ok: z.boolean().optional().default(false),
})
export type HandbackPayload = z.infer<typeof HandbackPayloadSchema>

export const HANDBACK_MISSING_STRUCTURE = "HANDBACK_MISSING_STRUCTURE" as const

// ── ID helpers ────────────────────────────────────────────────────────────

export function newBoardEntityId(prefix: "fact" | "intent" | "hint"): string {
  const t = Date.now().toString(36)
  const r = randomBytes(6).toString("hex")
  return `${prefix}_${t}${r}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function stampProvenance(
  partial: Partial<Provenance> & { actor_type: ActorType },
): Provenance {
  return {
    actor_type: partial.actor_type,
    thread_id: partial.thread_id ?? null,
    worker_id: partial.worker_id ?? null,
    orchestrator_run_id: partial.orchestrator_run_id ?? null,
    message_id: partial.message_id ?? null,
    tool_name: partial.tool_name ?? null,
    at: partial.at ?? nowIso(),
  }
}

export function createEmptyMissionBoard(overrides?: {
  origin?: string | null
  goal?: string | null
}): MissionBoard {
  const now = nowIso()
  return MissionBoardSchema.parse({
    schema_version: BOARD_SCHEMA_VERSION,
    origin: overrides?.origin ?? null,
    goal: overrides?.goal ?? null,
    status: "open",
    facts: [],
    intents: [],
    hints: [],
    completed_at: null,
    completed_by: null,
    empty_goal_ok: false,
    updated_at: now,
  })
}

/**
 * Validate a fully-formed board document (e.g. after load).
 * Returns parsed board or a structured error.
 */
export function parseMissionBoard(raw: unknown):
  | { ok: true; board: MissionBoard }
  | { ok: false; error: string } {
  const r = MissionBoardSchema.safeParse(raw)
  if (!r.success) {
    return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }
  }
  const bytes = Buffer.byteLength(JSON.stringify(r.data), "utf-8")
  if (bytes > BOARD_CAPS.max_board_json_bytes) {
    return { ok: false, error: `board exceeds max_board_json_bytes (${BOARD_CAPS.max_board_json_bytes})` }
  }
  return { ok: true, board: r.data }
}

/**
 * Parse structured handback payload. Prose-only / empty / non-object → missing structure.
 */
export function parseHandbackPayload(raw: unknown):
  | { ok: true; payload: HandbackPayload }
  | { ok: false; error_code: typeof HANDBACK_MISSING_STRUCTURE; error: string; recoverable: true } {
  if (raw == null) {
    return {
      ok: false,
      error_code: HANDBACK_MISSING_STRUCTURE,
      error: "handback payload is null/undefined",
      recoverable: true,
    }
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) {
      return {
        ok: false,
        error_code: HANDBACK_MISSING_STRUCTURE,
        error: "handback payload is empty string",
        recoverable: true,
      }
    }
    // Try JSON extract: whole string or first fenced / braced object
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
      const candidate = fence ? fence[1].trim() : extractFirstJsonObject(trimmed)
      if (!candidate) {
        return {
          ok: false,
          error_code: HANDBACK_MISSING_STRUCTURE,
          error: "prose-only handback; no JSON structure",
          recoverable: true,
        }
      }
      try {
        parsed = JSON.parse(candidate)
      } catch {
        return {
          ok: false,
          error_code: HANDBACK_MISSING_STRUCTURE,
          error: "handback JSON parse failed",
          recoverable: true,
        }
      }
    }
    return parseHandbackPayload(parsed)
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error_code: HANDBACK_MISSING_STRUCTURE,
      error: "handback must be a JSON object",
      recoverable: true,
    }
  }

  const r = HandbackPayloadSchema.safeParse(raw)
  if (!r.success) {
    return {
      ok: false,
      error_code: HANDBACK_MISSING_STRUCTURE,
      error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      recoverable: true,
    }
  }

  const { facts, intents, empty_ok } = r.data
  if (facts.length === 0 && intents.length === 0 && !empty_ok) {
    return {
      ok: false,
      error_code: HANDBACK_MISSING_STRUCTURE,
      error: "facts and intents both empty and empty_ok is false",
      recoverable: true,
    }
  }

  return { ok: true, payload: r.data }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) {
        esc = false
      } else if (c === "\\") {
        esc = true
      } else if (c === '"') {
        inStr = false
      }
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Wrap claim text for injection into model context (ADR-016 §2.3.7).
 */
export function formatUntrustedFactFrame(fact: Pick<Fact, "id" | "trust" | "claim">): string {
  return (
    `<<<UNTRUSTED_BOARD_FACT trust=${fact.trust} id=${fact.id}>>>\n` +
    `${fact.claim}\n` +
    `<<<END_UNTRUSTED_BOARD_FACT>>>`
  )
}

export function formatUntrustedHintFrame(hint: Pick<Hint, "id" | "text">): string {
  return (
    `<<<UNTRUSTED_BOARD_HINT id=${hint.id}>>>\n` +
    `${hint.text}\n` +
    `<<<END_UNTRUSTED_BOARD_HINT>>>`
  )
}
