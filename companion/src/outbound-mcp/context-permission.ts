import { z } from "zod"

export const OUTBOUND_CONTEXT_PROFILE = "outbound_context_v1"
const origin = z.string().min(1).max(2048).transform(raw => {
  const url = new URL(raw)
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.hostname.includes("*")) throw new Error("CONTEXT_ORIGIN_INVALID")
  return url.origin
})
const permissionSchema = z.object({
  allow_context_export: z.boolean().default(false),
  context_origins: z.array(origin).max(64).default([]),
  context_knowledge_ids: z.array(z.string().min(1).max(256).refine(value => value === value.trim())).max(64).default([]),
}).strict().refine(value => !value.allow_context_export || value.context_origins.length > 0, "context export requires exact origins")

export type ContextPermission = z.infer<typeof permissionSchema>
export function parseContextPermission(input: unknown): ContextPermission {
  const parsed = permissionSchema.parse(input)
  if (new Set(parsed.context_origins).size !== parsed.context_origins.length || new Set(parsed.context_knowledge_ids).size !== parsed.context_knowledge_ids.length) throw new Error("CONTEXT_SCOPE_DUPLICATE")
  return parsed
}

/** Legacy/malformed persisted permissions deny only this new capability. */
export function contextPermissionFromRecord(record: Record<string, unknown>): ContextPermission {
  try { return parseContextPermission({ allow_context_export: record.allow_context_export ?? false,
    context_origins: record.context_origins ?? [], context_knowledge_ids: record.context_knowledge_ids ?? [] }) }
  catch { return { allow_context_export: false, context_origins: [], context_knowledge_ids: [] } }
}

export interface LiveContextGrant extends ContextPermission { id: string; caller_id: string; profile: string; expires_at: string | null; revoked_at: string | null }
export type GrantLookup = (id: string) => LiveContextGrant | undefined
export function requireLiveGrant(lookup: GrantLookup, id: string, callerId: string, now = Date.now()): LiveContextGrant {
  const grant = lookup(id)
  if (!grant || grant.id !== id || grant.caller_id !== callerId || grant.revoked_at
    || grant.expires_at !== null && (!Number.isFinite(Date.parse(grant.expires_at)) || Date.parse(grant.expires_at) <= now)) throw new Error("GRANT_DENIED")
  return grant
}
export function requireContextGrant(lookup: GrantLookup, id: string, callerId: string, now = Date.now()): LiveContextGrant {
  const grant = requireLiveGrant(lookup, id, callerId, now)
  if (grant.profile !== OUTBOUND_CONTEXT_PROFILE || grant.allow_context_export !== true) throw new Error("GRANT_DENIED")
  return grant
}
