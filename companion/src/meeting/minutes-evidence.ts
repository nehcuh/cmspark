import type { MeetingVisualEvidence } from "./meeting-visual-evidence"

const sections = ["TL;DR", "决议", "待办", "风险 / 开放问题"] as const

/** Only text and its attribution go to the minutes model, never image bytes or service credentials. */
export function visualMinutesMaterial(evidence: readonly MeetingVisualEvidence[], includePrefix = true) {
  return evidence.map(({ frameId, timeMs, model, analyzedAt, recognizedText, description, uncertainties }, index) => ({
    frameId, timeMs, model, analyzedAt, recognizedText, description, uncertainties,
    ...(includePrefix ? { frameNumber: index + 1, citationPrefix: `〔画面:${frameId}@${timeMs}ms｜` } : {}),
  }))
}

export function visualSourceList(evidence: readonly MeetingVisualEvidence[]) {
  return evidence.map(({ recordingId, frameId, timeMs, sha256 }) => ({ recordingId, frameId, timeMs, sha256 }))
}

function matchingExcerpt(transcript: string, quoted: string): string | undefined {
  const text = quoted.trim()
  if (!text) return undefined
  if (transcript.includes(text)) return text
  // Providers sometimes add quotation marks inside the requested citation brackets.
  const pairs: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’", "「": "」", "«": "»" }
  const inner = text.slice(1, -1).trim()
  return inner && pairs[text[0]] === text.at(-1) && transcript.includes(inner) ? inner : undefined
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
      ? quotes.every(match => matchingExcerpt(transcript, match[1]))
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

function verifiedSources(item: string, transcript: string, frames: ReadonlyMap<string, MeetingVisualEvidence>) {
  const quotes = [...item.matchAll(/〔([^〔〕]+)〕/g)]
  // An unclosed or nested citation must not piggyback on a real excerpt.
  if (/[〔〕]/u.test(item.replace(/〔[^〔〕]+〕/g, ""))) return null
  let visual = false
  let spoken = !quotes.length && transcript.includes(item)
  for (const [, quote] of quotes) {
    if (!quote.startsWith("画面:")) {
      const excerpt = matchingExcerpt(transcript, quote)
      if (!excerpt) return null
      spoken = true
      continue
    }
    const citation = /^画面:([A-Za-z0-9_-]+)@(\d+)ms｜(.+)$/u.exec(quote)
    if (!citation) return null
    const [, frameId, timeMs, excerpt] = citation
    const frame = frames.get(frameId)
    if (!frame || String(frame.timeMs) !== timeMs || !excerpt.trim() ||
        ![frame.recognizedText, frame.description, ...frame.uncertainties].some(text => text.includes(excerpt))) return null
    visual = true
  }
  return { visual, spoken }
}

const visualSections = { tldr: "TL;DR", decisions: "决议", actions: "待办", risks: "风险 / 开放问题", screen: "画面要点" }

const cleanField = (value: unknown): value is string => typeof value === "string" &&
  !!value.trim() && !/[〔〕\r\n\u2028\u2029\u0000]/u.test(value)

/** null means no decision; a string is the verified decision clause to quote instead of a model paraphrase. */
function decisionClause(transcript: string, quote: string): string | null | undefined {
  // A partial "批准发布" cannot acquire the opposite polarity of its actual source clause.
  const pending = /(?:尚未|并未|没有|还没|还未|仍未|暂未|未经|未)[^，,。.!！？?；;\n]{0,10}(?:批[准复]|审批|同意|决定|确定|通过)|(?:尚待|有待|等待|待)审批|\b(?:not\s+(?:yet\s+)?approved|pending\s+approval|awaiting\s+approval)\b/iu
  if (!quote) return null
  if (!pending.test(transcript)) return undefined
  const clauses = [...transcript.matchAll(/[^，,。.!！？?；;\r\n]+/gu)]
  let clauseIndex = 0
  for (let at = transcript.indexOf(quote); at >= 0; at = transcript.indexOf(quote, at + quote.length)) {
    const end = at + quote.length
    while (clauseIndex < clauses.length && clauses[clauseIndex].index! + clauses[clauseIndex][0].length <= at) clauseIndex++
    const parts: { clause: string; fragment: string }[] = []
    for (let i = clauseIndex; i < clauses.length && clauses[i].index! < end; i++) {
      const start = clauses[i].index!
      parts.push({ clause: clauses[i][0], fragment: transcript.slice(Math.max(at, start), Math.min(end, start + clauses[i][0].length)) })
    }
    if (parts.length && parts.every(part => !pending.test(part.clause))) return undefined
    for (const { clause, fragment } of parts) {
      // Keep the actual vote or choice. An ambiguous mixed sentence never authorizes the model's wording.
      const explicit = /决定|同意|表决|投票|\b(?:decided|agreed|voted)\b/iu.exec(fragment)
      if (!explicit) continue
      if (!pending.test(clause)) return fragment.trim()
      const scope = pending.exec(clause)!
      const markerAt = clause.indexOf(fragment) + explicit.index
      if (markerAt >= scope.index) continue
      if (/(?:表决|投票)(?:结果)?未通过|voted\s+(?:against|to reject)/iu.test(fragment) ||
          /(?:决定|同意|decided|agreed)[^。.!?]{0,24}(?:等待|等候|推迟|暂缓|延期|wait|defer|postpone)/iu.test(fragment)) return fragment.trim()
    }
  }
  return null
}

function structuredFrameCitations(frame: MeetingVisualEvidence | undefined, quote: unknown): string | undefined {
  if (!frame || typeof quote !== "string" || !quote.trim() ||
      ![frame.recognizedText, frame.description, ...frame.uncertainties].some(text => text.includes(quote))) return undefined
  const cells = quote.split(/\r\n|[\r\n]/).filter(cell => cell.trim())
  if (!cells.length || !cells.every(cleanField)) return undefined
  return cells.map(cell => ` 〔画面:${frame.frameId}@${frame.timeMs}ms｜${cell}〕`).join("")
}

/** The model selects sources; only this renderer supplies frame identities and Markdown citations. */
export function groundDefaultVisualMinutes(output: string, transcript: string, evidence: readonly MeetingVisualEvidence[]): string | undefined {
  if (/^#{1,6}\s/m.test(output) && !/^(?:\{|\[|```json)/i.test(output.trimStart())) {
    return groundVisualMinutes(output, transcript, evidence, "", true)
  }
  const json = output.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1")
  let data: Record<string, unknown>
  try { data = JSON.parse(json) } catch { return undefined }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some(key => !Object.hasOwn(visualSections, key))) return undefined
  const blocks: string[] = []
  let spoken = false
  let screened = false
  let omitted = 0
  for (const [key, title] of Object.entries(visualSections)) {
    const rows = data[key]
    if (!Array.isArray(rows) || rows.length > 100) return undefined
    const lines: string[] = []
    for (const row of rows) {
      if (!row || typeof row !== "object" || !cleanField(row.claim)) { omitted++; continue }
      const needsSpeech = key !== "screen"
      const needsFrame = key === "screen" || (key === "risks" && ("frameNumber" in row || "frameQuote" in row))
      const fields = ["claim", ...(needsSpeech ? ["transcriptQuote"] : []), ...(needsFrame ? ["frameNumber", "frameQuote"] : [])]
      const frame = needsFrame && Number.isSafeInteger(row.frameNumber) ? evidence[row.frameNumber - 1] : undefined
      const frameCitation = needsFrame ? structuredFrameCitations(frame, row.frameQuote) : ""
      if (Object.keys(row).some(field => !fields.includes(field)) ||
          (needsSpeech && (!cleanField(row.transcriptQuote) || !transcript.includes(row.transcriptQuote))) ||
          frameCitation === undefined) {
        omitted++; continue
      }
      const verifiedDecision = key === "decisions" ? decisionClause(transcript, row.transcriptQuote) : undefined
      if (verifiedDecision === null) { omitted++; continue }
      spoken ||= needsSpeech
      screened ||= needsFrame
      const speechCitation = needsSpeech ? ` 〔${verifiedDecision ?? row.transcriptQuote}〕` : ""
      const line = `- ${key === "actions" ? "[ ] " : ""}${verifiedDecision ?? row.claim.trim()}${speechCitation}${frameCitation}`
      if (!lines.includes(line)) lines.push(line)
    }
    blocks.push(`### ${title}\n${lines.join("\n") || "无可核对的条目。"}`)
  }
  if (!spoken || !screened) return undefined
  if (omitted) blocks.push(`### 依据核对\n有 ${omitted} 条概括缺少可核对的对应来源，已省略。`)
  return blocks.join("\n\n")
}

/** With screen input, reserve visual-only support for the clearly attributed screen section. */
export function groundVisualMinutes(markdown: string, transcript: string, evidence: readonly MeetingVisualEvidence[], template: string, checkDecisions = false): string | undefined {
  const screenHeading = "画面要点"
  const riskHeading = "风险 / 开放问题"
  const headings = template
    ? [...template.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map(match => match[1])
    : [...sections]
  // A text-only template may contain prose instructions instead of a heading outline.
  const permitted = new Set([...(headings.length ? headings : sections), screenHeading, riskHeading])
  const templateRows = template.split(/\r?\n/).map(row => row.trim())
  const isTableDivider = (row: string) => /^\|(?:\s*:?-+:?\s*\|)+$/.test(row)
  const tableStructure = new Set(templateRows.filter((row, index) => row.startsWith("|") &&
    (isTableDivider(row) || isTableDivider(templateRows[index + 1] ?? ""))))
  const blocks = new Map<string, { heading: string; lines: string[] }>()
  if (!template) for (const title of [...sections, screenHeading]) blocks.set(title, { heading: "### " + title, lines: [] })
  const frames = new Map(evidence.map(frame => [frame.frameId, frame]))
  let title: string | undefined = template ? "" : undefined
  if (template) blocks.set("", { heading: "", lines: [] })
  let citedFrame = false
  let citedTranscript = false
  let omitted = 0
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      title = permitted.has(heading[2]) ? heading[2] : undefined
      if (title && !blocks.has(title)) blocks.set(title, { heading: line.trim(), lines: [] })
      continue
    }
    if (title === undefined) continue
    if (tableStructure.has(line.trim())) {
      blocks.get(title)!.lines.push(line)
      continue
    }
    const item = line.trim().replace(/^[-*]\s*(?:\[[ xX]\]\s*)?/, "").trim()
    if (!item || /^(?:无|无明确记录|无可核对的条目|未提及|未指定)[。.!！]?$/.test(item)) continue
    const sources = verifiedSources(item, transcript, frames)
    if (!sources || (title === screenHeading ? !sources.visual : !sources.spoken || (sources.visual && title !== riskHeading))) {
      omitted++
      continue
    }
    let renderedItem = item
    if (checkDecisions && title === "决议") {
      const quotes = [...item.matchAll(/〔([^〔〕]+)〕/g)].map(match => matchingExcerpt(transcript, match[1])!)
      const decisions = (quotes.length ? quotes : [item]).map(quote => decisionClause(transcript, quote))
      if (decisions.includes(null)) { omitted++; continue }
      const canonical = decisions.filter((decision): decision is string => typeof decision === "string")
      if (canonical.length) renderedItem = canonical.map(clause => clause + " 〔" + clause + "〕").join("；")
    }
    citedFrame ||= sources.visual
    citedTranscript ||= sources.spoken
    const renderedLines = blocks.get(title)!.lines
    const text = template ? line : `- ${title === "待办" ? "[ ] " : ""}${renderedItem}`
    if (!checkDecisions || !renderedLines.includes(text)) renderedLines.push(text)
  }
  if (!citedFrame || !citedTranscript) return undefined
  const rendered = [...blocks.values()].filter(({ heading, lines }) => heading || lines.length)
    .map(({ heading, lines }) => (heading ? heading + "\n" : "") + (lines.join("\n") || "无可核对的条目。"))
  if (omitted) rendered.push(`### 依据核对\n有 ${omitted} 条概括缺少可核对的对应来源，已省略。`)
  return rendered.join("\n\n")
}
