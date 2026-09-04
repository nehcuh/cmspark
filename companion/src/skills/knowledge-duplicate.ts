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

/**
 * #293: parsePdf stamps `# <filename>.pdf` as the first heading of extracted
 * text, so the same PDF under different names hashed differently (#281 false
 * negative). Strip that heading before hashing — applied symmetrically to
 * the incoming body and every stored body. Real markdown headings (no .pdf
 * suffix) are kept in the hash.
 */
export function stripPdfFilenameHeading(body: string): string {
  // Leading whitespace tolerated: the skill loader leaves a residual "\n"
  // after the frontmatter close, so the heading is not always at index 0.
  return (body || "").replace(/^\s*#.*\.pdf[ \t]*\r?\n/i, "")
}
