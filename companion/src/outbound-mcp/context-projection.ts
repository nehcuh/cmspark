import { z } from "zod"
import type { SkillEngine } from "../skills/skill-engine"
import { buildSiteContext, knowledgeView } from "../site-context/service"
import { siteTargetFromBridge, type SiteTarget } from "../site-context/target"
import { evidenceScopeHash } from "../business-evidence/content"
import { requireContextGrant, type GrantLookup } from "./context-permission"
import type { ContextSessionRegistry } from "./context-session"

const requestSchema = z.object({ tabId: z.number().int().safe().positive(), query: z.string().max(2048).default("") }).strict()
export type ContextOmission = { id?: string; reason: "GRANT_DENIED" | "SCOPE_DENIED" | "NOT_FOUND" | "BUDGET" | "REDACTED" | "CAPACITY" }
type ContextEngine = Pick<SkillEngine, "refresh" | "getKnowledgeVersion" | "resolveSkillIdsForThread" | "resolveKnowledgeIdsForThread" | "buildSystemPromptWithSources">

/** Local knowledge projection only. No business store/history/prompt export.
 * Authorization is read twice from the same concrete grant and all async target
 * work completes before the final synchronous permission/version filter. */
export async function projectOutboundContext(input: unknown, identity: { grantId: string; callerId: string; sessionHandle: string }, deps: {
  lookupGrant: GrantLookup
  sessions: ContextSessionRegistry
  engine: ContextEngine
  resolveTarget: (tabId: number) => Promise<SiteTarget | undefined>
}) {
  const request = requestSchema.parse(input)
  const firstGrant = structuredClone(requireContextGrant(deps.lookupGrant, identity.grantId, identity.callerId))
  const scope = deps.sessions.scope(identity.sessionHandle, identity.grantId, identity.callerId)
  const target = await deps.resolveTarget(request.tabId)
  if (!target || !siteTargetFromBridge(target)) throw new Error("SITE_TARGET_UNAVAILABLE")
  if (!firstGrant.context_origins.includes(target.origin)) throw new Error("SCOPE_DENIED")
  requireContextGrant(deps.lookupGrant, identity.grantId, identity.callerId)
  deps.engine.refresh()
  const permitted = firstGrant.context_knowledge_ids.filter(id => deps.engine.getKnowledgeVersion(id) !== undefined)
  const built = await buildSiteContext(deps.engine, { scopeId: `outbound-context:${evidenceScopeHash(scope)}`, target, query: request.query,
    selection: { kind: "explicit", skillIds: [], knowledgeIds: permitted } })
  const afterTarget = await deps.resolveTarget(request.tabId)
  if (!afterTarget || afterTarget.tab_id !== target.tab_id || afterTarget.origin !== target.origin || afterTarget.navigation_key !== target.navigation_key) throw new Error("TARGET_CHANGED")
  // No await after these checks: a revoke/document removal cannot race the
  // returned projection within this single Companion event-loop transaction.
  const current = requireContextGrant(deps.lookupGrant, identity.grantId, identity.callerId)
  deps.sessions.resolve(identity.sessionHandle, identity.grantId, identity.callerId)
  if (!current.context_origins.includes(target.origin)) throw new Error("SCOPE_DENIED")
  deps.engine.refresh()
  const allowed = new Set(current.context_knowledge_ids)
  const omitted: ContextOmission[] = []
  const authorizedIds = new Set<string>()
  for (const id of firstGrant.context_knowledge_ids) {
    if (!allowed.has(id)) { omitted.push({ id, reason: "GRANT_DENIED" }); continue }
    const version = deps.engine.getKnowledgeVersion(id)
    if (!version) { omitted.push({ id, reason: "NOT_FOUND" }); continue }
    const block = built.snapshot.knowledge.find(item => item.source.id === id)
    if (!block) { omitted.push({ id, reason: "BUDGET" }); continue }
    if (block.document_version !== version) { omitted.push({ id, reason: "REDACTED" }); continue }
    authorizedIds.add(id)
    if (block.truncated_by_budget) omitted.push({ id, reason: "BUDGET" })
  }
  return { ...knowledgeView(built.snapshot, authorizedIds), omitted }
}
