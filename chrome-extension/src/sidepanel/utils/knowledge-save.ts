/** Download-disabled copy for >512KiB docs (export path). */
export const KNOWLEDGE_TOO_BIG_DOWNLOAD_COPY = "正文超过 512KiB，无法下载"

/** Save-body honesty when get returned truncated. Must not reuse the download copy. */
export const KNOWLEDGE_TRUNCATED_BODY_SAVE_COPY =
  "正文已截断，保存不会覆盖未显示的尾部。仅可改标题、说明和标签。"

export type KnowledgeSaveFields = {
  id: string
  truncated: boolean
  title: string
  description: string
  tags: string[]
  body: string
}

export type KnowledgeUpdateMessage = {
  type: "knowledge.update"
  id: string
  user_gesture: true
  title: string
  description: string
  tags: string[]
  body?: string
}

/** Pin 11 / B1: truncated docs must not POST body (title/tags/description only). */
export function buildKnowledgeUpdateMessage(fields: KnowledgeSaveFields): KnowledgeUpdateMessage {
  const msg: KnowledgeUpdateMessage = {
    type: "knowledge.update",
    id: fields.id,
    user_gesture: true,
    title: fields.title,
    description: fields.description,
    tags: fields.tags,
  }
  if (!fields.truncated) msg.body = fields.body
  return msg
}
