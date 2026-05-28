// CJK-aware tokenizer for semantic skill matching
// Ported from VibeSOP core/matching/tokenizers.py

const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/

function containsCJK(text: string): boolean {
  return CJK_RE.test(text)
}

/** Tokenize CJK text with overlapping 2-char tokens.
 *  "做实验" → ["做实", "实", "实验", "验"]
 */
function tokenizeCJK(segment: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < segment.length) {
    if (i + 1 < segment.length) {
      const twoChar = segment.substring(i, i + 2)
      if (/^[\u4e00-\u9fff]{2}$/.test(twoChar)) {
        tokens.push(twoChar)
        i += 1
        continue
      }
    }
    tokens.push(segment[i])
    i += 1
  }
  return tokens
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
  "to", "was", "will", "with", "this", "but", "they", "have",
  "use", "can", "get", "make", "go", "do",
])

export function tokenize(text: string): string[] {
  if (!text) return []

  const lower = text.toLowerCase()
  // Remove punctuation, keep word chars + whitespace + CJK
  const cleaned = lower.replace(/[^\w\s\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, " ")

  const tokens: string[] = []
  const segments = cleaned.split(/\s+/)

  for (const seg of segments) {
    if (seg.length < 1) continue

    if (containsCJK(seg)) {
      tokens.push(...tokenizeCJK(seg))
    } else {
      if (!STOP_WORDS.has(seg)) {
        tokens.push(seg)
      }
    }
  }

  return tokens
}

/** Convert token list to frequency map (normalized TF). */
export function tokensToVec(tokens: string[]): Record<string, number> {
  if (tokens.length === 0) return {}
  const counts: Record<string, number> = {}
  for (const t of tokens) {
    counts[t] = (counts[t] || 0) + 1
  }
  const total = tokens.length
  const vec: Record<string, number> = {}
  for (const [k, v] of Object.entries(counts)) {
    vec[k] = v / total
  }
  return vec
}

/** Cosine similarity between two token frequency vectors. */
export function cosineSimilarity(
  vec1: Record<string, number>,
  vec2: Record<string, number>,
): number {
  if (Object.keys(vec1).length === 0 || Object.keys(vec2).length === 0) return 0

  const allTerms = new Set([...Object.keys(vec1), ...Object.keys(vec2)])
  let dotProduct = 0
  for (const term of allTerms) {
    dotProduct += (vec1[term] || 0) * (vec2[term] || 0)
  }

  const mag1 = Math.sqrt(Object.values(vec1).reduce((s, v) => s + v * v, 0))
  const mag2 = Math.sqrt(Object.values(vec2).reduce((s, v) => s + v * v, 0))

  if (mag1 === 0 || mag2 === 0) return 0
  return dotProduct / (mag1 * mag2)
}
