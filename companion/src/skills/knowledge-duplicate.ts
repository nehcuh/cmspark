// #281 exact-duplicate import: hash the parsed markdown body (not frontmatter,
// not MD5). Placeholder / empty bodies are exempt so scanned PDFs with the
// same basename+page-count are not silently skipped.

import { createHash } from "node:crypto"

/** parsePdf placeholder bodies (file-parser.ts 340/350/354). */
export const KNOWLEDGE_SCAN_PLACEHOLDER_RE =
  /^# .+\n\n\[(?:PDF 已渲染 \d+\/\d+ 页为图片，等待视觉分析|此 PDF 为扫描件或图片 PDF，无法提取文本内容。页数: \d+)\]\s*$/

export function knowledgeDuplicateExempt(body: string): boolean {
  const t = (body || "").trim()
  if (!t) return true
  return KNOWLEDGE_SCAN_PLACEHOLDER_RE.test(t)
}

export function hashKnowledgeBody(body: string): string {
  return createHash("sha256").update((body || "").trim(), "utf8").digest("hex")
}
