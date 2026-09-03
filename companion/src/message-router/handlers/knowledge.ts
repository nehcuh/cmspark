// Knowledge CRUD family (Wave 3). Keep case labels in message-router.ts for lockstep.

import { KNOWLEDGE_TRUNCATED_BODY_UPDATE_ERROR, type SkillEngine } from "../../skills/skill-engine"
import { attachRelatedTitles } from "../../skills/knowledge-related"

function summonerDenied(type: string) {
  return {
    type: "error",
    error: `SUMMONER_ACL: ${type} not allowed on summoner surface`,
    error_code: "SUMMONER_ACL",
  }
}

export function knowledgeListDocs(skillEngine: SkillEngine, stampedSurface: unknown) {
  const docs = skillEngine.listKnowledge()
  if (stampedSurface === "summoner") return docs
  return attachRelatedTitles(
    docs.map((d) => ({
      ...d,
      id: d.id || d.name,
    })),
  )
}

/**
 * #274: folder rows for the panel. Withheld on the summoner surface (same
 * minimization as related titles); the overlay gets folders through neither
 * this nor any new verb.
 */
export function knowledgeListFolders(skillEngine: SkillEngine, stampedSurface: unknown) {
  if (stampedSurface === "summoner") return undefined
  return skillEngine.listKnowledgeFolders()
}

/**
 * #273 Wave B §6.4: 派生分布（knowledge.list 顶层 distribution?）。
 * 严于 attachRelatedTitles 先例——related 只剥 summoner，分布**两面都剥**。
 *
 * 放行谓词看 **handshake 的 `session.surface === "panel"`**（lifecycle 从
 * wsAuth 写入真值），不看 stamp 后的 `__cmspark_surface`——生产 stamp
 * （composer-lease.stampCmsparkSurface）的词汇表只有 "summoner"|"tray"，
 * "panel" 会被压成 "tray"，看 stamp 等于永远不放行（Gate9 BLOCK-1）。
 * overlay 骑 summoner socket（surface === "summoner"，无独立 overlay
 * token），天然被剥；tray 同样缺席。不是新 WS 动词，不进文档 SoT。
 */
export function knowledgeListDistribution(
  skillEngine: SkillEngine,
  session: unknown,
): ReturnType<SkillEngine["getKnowledgeDistribution"]> | undefined {
  const surface = (session as { surface?: unknown } | undefined)?.surface
  if (surface !== "panel") return undefined
  return skillEngine.getKnowledgeDistribution() ?? undefined
}

/** 单点附加：distribution 允许且可用时才在帧上出现该键（缺席 = 剥）。 */
export function attachKnowledgeListDistribution<T extends Record<string, unknown>>(
  frame: T,
  skillEngine: SkillEngine,
  session: unknown,
): T {
  const dist = knowledgeListDistribution(skillEngine, session)
  if (dist == null) return frame
  return { ...frame, distribution: dist }
}

export function handleKnowledgeCrud(
  type: string,
  rest: Record<string, unknown>,
  skillEngine: SkillEngine,
  stampedSurface: unknown,
): Record<string, unknown> | null {
  if (type !== "knowledge.get" && type !== "knowledge.update" && type !== "knowledge.export") {
    return null
  }
  if (stampedSurface === "summoner") return summonerDenied(type)
  if ((type === "knowledge.update" || type === "knowledge.export") && rest.user_gesture !== true) {
    return { type: "error", error: `${type} requires user_gesture:true (Side Panel only)` }
  }
  const id = typeof rest.id === "string" ? rest.id : ""
  try {
    if (type === "knowledge.get") {
      const doc = skillEngine.getKnowledge(id)
      if (!doc) return { type: "error", error: `Knowledge not found: ${id}` }
      return { type: "knowledge.doc", doc }
    }
    if (type === "knowledge.update") {
      const patch = {
        title: typeof rest.title === "string" ? rest.title : undefined,
        description: typeof rest.description === "string" ? rest.description : undefined,
        tags: Array.isArray(rest.tags) ? rest.tags.map((t) => String(t)) : undefined,
        body: typeof rest.body === "string" ? rest.body : undefined,
      }
      // Pin 11 / B1: last get truncated / no full-read → refuse body. Title/tags ok.
      if (patch.body !== undefined) {
        const current = skillEngine.getKnowledge(id)
        if (!current) return { type: "error", error: `Knowledge not found: ${id}` }
        if (current.truncated) {
          return { type: "error", error: KNOWLEDGE_TRUNCATED_BODY_UPDATE_ERROR }
        }
      }
      const updated = skillEngine.updateKnowledge(id, patch)
      return { type: "knowledge.updated", ...updated }
    }
    const exported = skillEngine.exportKnowledge(id)
    return { type: "knowledge.exported", ...exported }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { type: "error", error: message }
  }
}
