// File chunker — split large files into searchable chunks with keyword extraction

export interface FileChunk {
  index: number
  text: string
  tokenEstimate: number
  keywords: string[]
}

export interface ChunkedFile {
  filename: string
  chunks: FileChunk[]
  totalTokens: number
}

const CHUNK_SIZE_TOKENS = 2000
const OVERLAP_CHARS = 100

const STOP_WORDS = new Set([
  "的", "了", "是", "在", "有", "和", "就", "不", "人", "都", "一", "一个",
  "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看",
  "好", "自己", "这", "那", "他", "她", "它", "们", "the", "a", "an", "is",
  "are", "was", "were", "be", "been", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "can", "shall",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into",
  "through", "during", "before", "after", "and", "but", "or", "not", "no",
])

export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[一-鿿㐀-䶿]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars * 1.5 + otherChars / 4)
}

function extractKeywords(text: string, maxKeywords = 10): string[] {
  const words = text.split(/[\s,，。；;：:、！!？?()（）\[\]【】{}"''""「」\n\r\t]+/)
  const freq = new Map<string, number>()

  for (const word of words) {
    if (word.length < 2) continue
    if (STOP_WORDS.has(word)) continue
    freq.set(word, (freq.get(word) || 0) + 1)
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word)
}

export function chunkFile(filename: string, content: string, maxTokens: number): ChunkedFile {
  const totalTokens = estimateTokens(content)

  if (totalTokens <= maxTokens) {
    return {
      filename,
      chunks: [{ index: 0, text: content, tokenEstimate: totalTokens, keywords: extractKeywords(content) }],
      totalTokens,
    }
  }

  const chunks: FileChunk[] = []
  const paragraphs = content.split(/\n\n+/)
  let currentChunk = ""
  let currentTokens = 0
  let chunkIndex = 0

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para)

    if (currentTokens + paraTokens > CHUNK_SIZE_TOKENS && currentChunk) {
      chunks.push({
        index: chunkIndex++,
        text: currentChunk,
        tokenEstimate: currentTokens,
        keywords: extractKeywords(currentChunk),
      })

      const overlap = currentChunk.slice(-OVERLAP_CHARS)
      currentChunk = overlap + "\n\n" + para
      currentTokens = estimateTokens(currentChunk)
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para
      currentTokens += paraTokens
    }
  }

  if (currentChunk) {
    chunks.push({
      index: chunkIndex,
      text: currentChunk,
      tokenEstimate: currentTokens,
      keywords: extractKeywords(currentChunk),
    })
  }

  return { filename, chunks, totalTokens }
}

export function searchChunks(chunks: FileChunk[], query: string, topK = 3): FileChunk[] {
  const queryKeywords = extractKeywords(query, 5)

  const scored = chunks.map(chunk => {
    const keywordMatch = chunk.keywords.filter(kw => queryKeywords.includes(kw)).length
    const textMatch = queryKeywords.filter(kw => chunk.text.includes(kw)).length
    return { chunk, score: keywordMatch * 2 + textMatch }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(s => s.score > 0)
    .map(s => s.chunk)
}
