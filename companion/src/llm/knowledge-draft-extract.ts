// #272 — knowledge AI draft extract (草稿制，单篇路径).
// Spec: docs/superpowers/specs/2026-09-02-knowledge-ai-draft-extract-design.md
//
// One-shot LLM helper that drafts `description` + `tags` for a single
// knowledge doc. F-S-7: the output is a DRAFT — it lives only in
// knowledge.preview_suggested / knowledge.suggest responses and is never
// written to disk, listKnowledge, or the related bag by this module.
// Directory import and existing-library scans never call this (test spy
// asserted); there is no "backfill old docs" entry point.

import { llmExtract, type LlmExtractConfig } from "./llm-extract"
import { normalizeTags } from "../threads/digest"

/** Extraction input cap — body chars, distinct from the 6MiB parse cap. */
export const KNOWLEDGE_EXTRACT_INPUT_CAP = 8000
/** Extraction timeout — independent of the 30s parse bound. */
export const KNOWLEDGE_EXTRACT_TIMEOUT_MS = 15_000
/** description stays within the existing frontmatter budget (no new fields). */
const MAX_DESCRIPTION = 500

export interface KnowledgeDraftSuggestion {
  description?: string
  tags?: string[]
}

export const KNOWLEDGE_EXTRACT_SYSTEM_PROMPT = `你是知识库元数据助手。根据用户给出的文档正文，输出**仅一行 JSON**（不要 markdown 围栏、不要解释）:
{"description":"一句话说明≤120字，概括这篇文档讲什么、何时该用它","tags":["标签1","标签2"]}

规则:
- description 用文档的主要语言；客观概括，不要推销口吻
- tags 0–6 个短标签（中文或英文词，无 # 号，无密钥/token/口令）
- 正文太短或无实质内容时: {"description":"","tags":[]}
- 只输出 JSON 对象本身`

/**
 * Parse the LLM's raw reply into a draft suggestion. Tolerates code fences
 * and surrounding prose. Tags pass normalizeTags (SENSITIVE_TAG_RE drops
 * secret-shaped entries, max 8). Returns null when nothing usable came back.
 */
export function parseKnowledgeSuggestion(raw: string): KnowledgeDraftSuggestion | null {
  let text = (raw || "").trim()
  if (!text) return null
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null
  const data = obj as Record<string, unknown>
  const out: KnowledgeDraftSuggestion = {}
  if (typeof data.description === "string") {
    const d = data.description.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION)
    if (d) out.description = d
  }
  if (Array.isArray(data.tags)) {
    const tags = normalizeTags(data.tags)
    if (tags.length) out.tags = tags
  }
  return out.description || out.tags ? out : null
}

/**
 * Run the one-shot extraction. Throws on timeout / transport failure /
 * unparseable reply — callers map that to extract_error + heuristic fallback.
 */
export async function extractKnowledgeDraft(params: {
  body: string
  config: LlmExtractConfig
  signal?: AbortSignal
}): Promise<KnowledgeDraftSuggestion> {
  const input = params.body.slice(0, KNOWLEDGE_EXTRACT_INPUT_CAP)
  const raw = await llmExtract({
    systemPrompt: KNOWLEDGE_EXTRACT_SYSTEM_PROMPT,
    userContent: input,
    config: params.config,
    temperatureCap: 0.3,
    timeout: KNOWLEDGE_EXTRACT_TIMEOUT_MS,
    signal: params.signal,
  })
  const parsed = parseKnowledgeSuggestion(raw)
  if (!parsed) throw new Error("knowledge_extract_unparseable")
  return parsed
}
