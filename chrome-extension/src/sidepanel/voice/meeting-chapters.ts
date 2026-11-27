export type MeetingTurn = { text: string; speaker?: string; t0?: number; segment_id?: string }

export function turnTime(seconds: number) {
  const value = Math.floor(seconds)
  return [Math.floor(value / 60), value % 60].map(n => String(n).padStart(2, "0")).join(":")
}

/** A chapter points to the first verified utterance supporting an overview item.
 * Older summaries without source quotes still open as normal documents. */
export function meetingChapters(markdown: string, turns: readonly { text: string; t0?: number }[]) {
  const chapters: { title: string; index: number; time: number }[] = []
  let overview = false
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+)/.exec(line)
    if (heading) { overview = /^(TL;DR|会议概览|会议概要)$/i.test(heading[1].trim()); continue }
    if (!overview) continue
    const passage = /〔([^〔〕]+)〕/u.exec(line)
    if (!passage) continue
    const index = turns.findIndex(turn => typeof turn.t0 === "number" && turn.text.includes(passage[1]))
    const title = line.slice(0, passage.index).replace(/^\s*[-*]\s*/, "").trim()
    if (index >= 0 && title && !chapters.some(chapter => chapter.index === index)) {
      chapters.push({ title, index, time: turns[index].t0! })
    }
  }
  return chapters.sort((a, b) => a.index - b.index)
}

export function linkMeetingQuotes(container: HTMLElement, turns: readonly MeetingTurn[], sources?: readonly { frameId: string; timeMs: number }[]) {
  const walker = window.document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) if (walker.currentNode.textContent?.includes("〔")) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const parts = node.data.split(/(〔[^〔〕\n]+〕)/u)
    const replacements = parts.map(part => {
      if (!part.startsWith("〔")) return part
      const quote = part.slice(1, -1)
      const frame = /^画面:([^@]+)@(\d+)ms｜(.+)$/u.exec(quote)
      const index = frame ? sources?.findIndex(s => s.frameId === frame[1] && s.timeMs === Number(frame[2])) ?? -1
        : turns.findIndex(turn => turn.text.includes(quote))
      if (index < 0) return part
      const button = window.document.createElement("button")
      button.type = "button"
      button.dataset[frame ? "frame" : "turn"] = String(index)
      const time = frame ? Number(frame[2]) / 1000 : turns[index].t0
      button.textContent = (frame ? "画面" : "原文") + (typeof time === "number" ? " " + turnTime(time) : "")
      button.title = frame ? frame[3] : quote
      return button
    })
    node.replaceWith(...replacements)
  }
}
