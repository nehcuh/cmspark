import { sanitizeUserTags } from "./user-tags"
import { sanitizeTopicFolder } from "./distill"

/** Existing metadata only; never pass arbitrary thread policy/config through HTTP. */
export function summonerThreadMetadata(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("分类必须是对象")
  const fields = body as Record<string, unknown>
  const keys = Object.keys(fields)
  if (!keys.length || keys.some(key => !["alias", "user_tags", "topic_folder"].includes(key))) {
    throw new Error("仅支持修改名称、人工标签和手动分组")
  }
  const result: Record<string, unknown> = {}
  if ("alias" in fields) {
    if (typeof fields.alias !== "string" || !fields.alias.trim()) throw new Error("名称不能为空")
    const alias = fields.alias.normalize("NFC").replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 200)
    if (!alias) throw new Error("名称不能为空")
    result.alias = alias
  }
  if ("user_tags" in fields) result.user_tags = sanitizeUserTags(fields.user_tags)
  if ("topic_folder" in fields) {
    if (fields.topic_folder !== null && typeof fields.topic_folder !== "string") throw new Error("分组必须是名称或空值")
    result.topic_folder = sanitizeTopicFolder(fields.topic_folder)
  }
  return result
}

