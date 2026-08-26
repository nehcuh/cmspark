// Knowledge CRUD family (Wave 3). Keep case labels in message-router.ts for lockstep.

import type { SkillEngine } from "../../skills/skill-engine"
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
