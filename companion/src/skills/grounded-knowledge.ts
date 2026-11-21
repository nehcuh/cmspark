import { neutralizeKnowledgeBoundary, sanitizeKnowledgeContent } from "./content-sanitizer"
import { tokenize } from "./semantic-match"

const EXCERPT_CHARS = 900
const OVERLAP_CHARS = 100
const QUESTION_WORDS = new Set(["how", "what", "where", "when", "which", "who", "why", "does", "please"])
const QUESTION_PHRASES = /怎么处理|该怎么办|怎么|如何|请问|是什么|有哪些|有没有|是否/g

export type GroundedKnowledgeHit = { text: string; index: number; matches: number }

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase()
}

export function knowledgeQueryTerms(query: string): Set<string> {
  return new Set(tokenize(normalize(query.slice(0, 2048)).replace(QUESTION_PHRASES, " "))
    .filter(term => term.length > 1 && !QUESTION_WORDS.has(term)))
}

export function findGroundedKnowledgeHit(content: string, terms: ReadonlySet<string>): GroundedKnowledgeHit | undefined {
  if (!terms.size || !content) return undefined
  const queryTerms = [...terms]
  const required = Math.min(terms.size, Math.max(2, Math.ceil(terms.size / 3)))
  const hasOverlap = (text: string) => queryTerms.filter(term => text.includes(term)).length >= required
  const searchText = normalize(content)
  if (!hasOverlap(searchText)) return undefined
  const sanitized = sanitizeKnowledgeContent(content)

  let best: GroundedKnowledgeHit | undefined
  const stride = EXCERPT_CHARS - OVERLAP_CHARS
  for (let offset = 0; offset < sanitized.length; offset += stride) {
    const end = Math.min(offset + EXCERPT_CHARS, sanitized.length)
    const text = sanitized.slice(offset, end).trim()
    const body = normalize(neutralizeKnowledgeBoundary(text))
    if (hasOverlap(body)) {
      // Token membership keeps English substring matches out. Chinese bigrams
      // can cross the tokenizer's position in a sentence, so match them literally.
      const tokens = new Set(tokenize(body))
      const matches = queryTerms.filter(term =>
        /^[\u4e00-\u9fff]{2}$/.test(term) ? body.includes(term) : tokens.has(term),
      ).length
      if (matches >= required && (!best || matches > best.matches)) {
        best = { text, index: offset / stride, matches }
        if (matches === terms.size) break
      }
    }
    if (end === sanitized.length) break
  }
  return best
}
