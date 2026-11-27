import { useMemo, useRef } from "react"
import { marked } from "marked"
import DOMPurify from "dompurify"
import type { FrameSource } from "../voice/meeting-visual-client"

import { linkMeetingQuotes, type MeetingTurn } from "../voice/meeting-chapters"

export { turnTime, type MeetingTurn } from "../voice/meeting-chapters"

/** Render the saved Markdown, including custom templates. Only application-created
 * citation buttons can navigate to one of this meeting's verified sources. */
export function MeetingMinutesDocument({ title, markdown, generated, turns, sources, onFrame, onTurn }: {
  title: string; markdown: string; generated?: string; turns: MeetingTurn[]; sources?: FrameSource[]
  onFrame: (frame: FrameSource) => void; onTurn: (index: number) => void
}) {
  const body = useRef<HTMLDivElement>(null)
  const document = useMemo(() => {
    const fragment = DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string, {
      RETURN_DOM_FRAGMENT: true, ALLOW_DATA_ATTR: false,
      ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code", "hr", "table", "thead", "tbody", "tr", "td", "th", "input"],
      ALLOWED_ATTR: ["type", "checked", "disabled", "start"],
    })
    const container = window.document.createElement("div")
    container.append(fragment)
    container.querySelectorAll("input").forEach(input => { input.type = "checkbox"; input.disabled = true })
    const headings = Array.from(container.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    for (const heading of headings) if (heading.textContent === "TL;DR") heading.textContent = "会议概览"
    linkMeetingQuotes(container, turns, sources)
    return { html: container.innerHTML, outline: headings.map(h => h.textContent || "") }
  }, [markdown, sources, turns])

  return <article className="meeting-document">
    <header><h2>{title || "会议纪要"}</h2>
      {generated && Number.isFinite(Date.parse(generated)) && <time dateTime={generated}>{new Date(generated).toLocaleString()}</time>}
    </header>
    {document.outline.length > 1 && <details className="meeting-outline"><summary>纪要大纲</summary>
      {document.outline.map((heading, index) => <button key={index} type="button" onClick={() =>
        body.current?.querySelectorAll("h1,h2,h3,h4,h5,h6")[index]?.scrollIntoView({ block: "start" })}>{heading}</button>)}
    </details>}
    <div ref={body} className="meeting-document-body" onClick={e => {
      const button = (e.target as HTMLElement).closest("button")
      if (button?.dataset.frame !== undefined && sources) onFrame(sources[Number(button.dataset.frame)])
      if (button?.dataset.turn !== undefined) onTurn(Number(button.dataset.turn))
    }} dangerouslySetInnerHTML={{ __html: document.html }} />
  </article>
}
