const sections = ["TL;DR", "决议", "待办", "风险 / 开放问题"] as const

function hasExcerpt(transcript: string, quoted: string): boolean {
  const text = quoted.trim()
  if (!text) return false
  if (transcript.includes(text)) return true
  // Providers sometimes add quotation marks inside the requested citation brackets.
  const pairs: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’", "「": "」", "«": "»" }
  const inner = text.slice(1, -1).trim()
  return !!inner && pairs[text[0]] === text.at(-1) && transcript.includes(inner)
}

/** Verify the provider's cited excerpts against the exact saved text. */
export function groundDefaultMinutes(markdown: string, transcript: string): string | undefined {
  const items = sections.map(() => [] as string[])
  let section = -1
  let omitted = 0
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{1,6}\s*(.*?)\s*$/.exec(line)
    if (heading) {
      section = sections.findIndex(title => title.toLowerCase() === heading[1].trim().toLowerCase())
      continue
    }
    if (section < 0) continue
    const item = line.trim().replace(/^[-*]\s*(?:\[[ xX]\]\s*)?/, "").trim()
    if (!item || /^(?:无|无明确记录|未提及|未指定)[。.!！]?$/.test(item)) continue
    const quotes = [...item.matchAll(/〔([^〔〕]+)〕/g)]
    const literal = quotes.length ? undefined : item.replace(/^["“「]|["”」]$/g, "")
    // Older Markdown providers sometimes return an exact transcript line without a citation.
    const supported = quotes.length
      ? quotes.every(match => hasExcerpt(transcript, match[1]))
      : !!literal && transcript.includes(literal)
    if (supported) items[section].push(item)
    else omitted++
  }
  if (!items.some(block => block.length)) return undefined
  const blocks = sections.map((title, i) => {
    const lines = items[i].map(item => `- ${i === 2 ? "[ ] " : ""}${item}`)
    return `### ${title}\n${lines.join("\n") || "无可核对的条目。"}`
  })
  if (omitted) blocks.push(`### 依据核对\n模型有 ${omitted} 条概括未附可在原文中找到的依据，已省略。可更换纪要模型后重新生成。`)
  return blocks.join("\n\n")
}
