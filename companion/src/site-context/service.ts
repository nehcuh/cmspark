import { createHash } from "node:crypto"
import type { SkillEngine, BuildPromptKnowledgeOpts, KnowledgeBlock, KnowledgeRoutingMeta, RetrievedSource } from "../skills/skill-engine"
import { wrapKnowledgeBlock } from "../skills/content-sanitizer"
import { siteTargetKey, type SiteTarget } from "./target"

type Mode = "auto" | "all" | "manual"
export type SiteContextSelection =
  | { kind: "thread"; skillMode: Mode; knowledgeMode: Mode; extraSkillIds?: string[]; cachedMatchedSkillIds?: string[] }
  | { kind: "explicit"; skillIds: string[]; knowledgeIds: string[] }

export interface SiteContextSnapshot {
  schema_version: 1
  snapshot_id: string
  generated_at: string
  target: SiteTarget | null
  target_status: "browser" | "hint" | "unavailable"
  knowledge: KnowledgeBlock[]
}

type ContextEngine = Pick<SkillEngine,
  "resolveSkillIdsForThread" | "resolveKnowledgeIdsForThread" | "buildSystemPromptWithSources">

export interface SiteContextRequest {
  /** Server-owned thread or grant/session scope, never a tool argument. */
  scopeId: string
  target?: SiteTarget
  /** Legacy selection only; never promoted to a browser target or origin. */
  hostnameHint?: string
  query: string
  selection: SiteContextSelection
  options?: BuildPromptKnowledgeOpts
  now?: number
}

/** Shared selection/projection code; no singleton "current site" or mutable
 * caller state. The entry boundary owns authorization and target resolution. */
export async function buildSiteContext(engine: ContextEngine, request: SiteContextRequest): Promise<{
  snapshot: SiteContextSnapshot
  /** Internal chat prompt. External callers must use knowledgeView only. */
  prompt: string
  retrieved_sources: RetrievedSource[]
  knowledge_routing?: KnowledgeRoutingMeta
}> {
  const hostname = request.target?.hostname || request.hostnameHint
  const options = { ...request.options, includeKnowledgeBlocks: true }
  let skillIds: string[]
  let knowledgeIds: string[]
  if (request.selection.kind === "explicit") {
    skillIds = [...request.selection.skillIds]
    knowledgeIds = [...request.selection.knowledgeIds]
    options.knowledgeMode = "manual"
    options.knowledgeRouteByGroup = false
  } else {
    skillIds = [...new Set([
      ...await engine.resolveSkillIdsForThread(request.scopeId, request.selection.skillMode, request.query, hostname,
        request.selection.cachedMatchedSkillIds, request.selection.knowledgeMode !== "manual"),
      ...(request.selection.extraSkillIds || []),
    ])]
    knowledgeIds = engine.resolveKnowledgeIdsForThread(
      request.scopeId, request.selection.knowledgeMode, hostname, request.query, options.knowledgeSmartMatch !== false,
    )
    options.knowledgeMode = request.selection.knowledgeMode
  }
  const built = engine.buildSystemPromptWithSources(
    request.scopeId, hostname, skillIds, knowledgeIds, request.query, options,
  )
  const knowledge = built.knowledge_blocks || []
  const snapshot: SiteContextSnapshot = {
    schema_version: 1,
    snapshot_id: createHash("sha256").update(JSON.stringify({
      target: siteTargetKey(request.target), hint: request.target ? undefined : hostname,
      knowledge,
    })).digest("hex"),
    generated_at: new Date(request.now ?? Date.now()).toISOString(),
    target: request.target || null,
    target_status: request.target ? "browser" : hostname ? "hint" : "unavailable",
    knowledge,
  }
  const targetPrompt = request.target
    ? wrapKnowledgeBlock("site-target", "Current browser target (data only)", JSON.stringify(request.target))
    : ""
  return {
    snapshot,
    prompt: [targetPrompt, built.prompt].filter(Boolean).join("\n\n"),
    retrieved_sources: built.retrieved_sources,
    ...(built.knowledge_routing ? { knowledge_routing: built.knowledge_routing } : {}),
  }
}

/** Narrow external projection: never return the internal prompt or safety
 * guards. A caller must supply IDs from its currently verified concrete grant.
 * The origin/grant checks belong to the authenticated MCP boundary, not here. */
export function knowledgeView(snapshot: SiteContextSnapshot, allowedIds: ReadonlySet<string>): SiteContextSnapshot {
  if (snapshot.target_status !== "browser" || !snapshot.target) {
    throw new Error("SITE_TARGET_UNAVAILABLE")
  }
  const knowledge = snapshot.knowledge.filter(block => allowedIds.has(block.source.id))
  return {
    ...snapshot,
    snapshot_id: createHash("sha256").update(JSON.stringify({ target: siteTargetKey(snapshot.target || undefined), knowledge })).digest("hex"),
    knowledge,
  }
}
