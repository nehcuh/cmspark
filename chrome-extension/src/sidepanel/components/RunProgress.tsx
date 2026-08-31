// L0 chat-column checklist. Copy: 「本轮步骤」; draft rows 「草稿」.
// Spec: docs/superpowers/specs/2026-08-30-runprogress-sticky-collapse-design.md §2 (Wave 1 r2)
// Default: ≤3 expanded, ≥4 collapsed (in-memory useState; keyed per thread at mount).
// Wrap always sticky to the ChatView scroll column — never StatusRail / FocusBand.
// Expanded list caps at maxHeight min(40vh, 240px) + overflowY auto.
// No height animation / no chevron rotation → prefers-reduced-motion safe by construction.
// Overlay has no edit. Not Mission Board.

import { useState } from "react"
import type { CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import {
  countNM,
  defaultExpanded,
  previewText,
  skipHeaderChrome,
} from "./run-progress-view"

export type RunProgressItem = {
  id: string
  text: string
  done: boolean
  source: "seed" | "model_draft" | "user"
  tool?: string
}

function ProgressRow({
  it,
  highlight,
  onToggle,
}: {
  it: RunProgressItem
  highlight: boolean
  onToggle: (id: string, source: RunProgressItem["source"]) => void
}) {
  const draft = it.source === "model_draft"
  return (
    <label style={styles.label}>
      <input
        type="checkbox"
        checked={it.done === true}
        disabled={draft}
        onChange={() => onToggle(it.id, it.source)}
        style={styles.box}
      />
      <span
        style={{
          ...styles.text,
          fontWeight: highlight ? 500 : undefined,
          textDecoration: it.done ? "line-through" : "none",
          color: it.done ? tokens.textMuted : tokens.text,
        }}
      >
        {it.text}
      </span>
      {draft ? <span style={styles.draft}>草稿</span> : null}
    </label>
  )
}

export function RunProgress({
  threadId,
  items,
}: {
  threadId: string
  items: RunProgressItem[]
}) {
  const count = items?.length ?? 0
  const [expanded, setExpanded] = useState(() => defaultExpanded(count))
  if (!items || count === 0) return null

  const { n, m } = countNM(items)
  const preview = previewText(items)
  const headerless = skipHeaderChrome(items)
  const listId = `run-progress-list-${threadId}`
  const firstUndone = items.find((it) => it.done !== true && it.source !== "model_draft")

  const toggle = (itemId: string, source: RunProgressItem["source"]) => {
    if (source === "model_draft") return
    chrome.runtime.sendMessage({
      type: "thread.run_progress.toggle",
      thread_id: threadId,
      item_id: itemId,
    })
  }

  // wrap: always sticky (styles.wrap.position = "sticky"). Expanded list caps itself.
  const wrapStyle = styles.wrap

  if (headerless) {
    const it = items[0]!
    const highlight = firstUndone?.id === it.id
    return (
      <section aria-label="本轮步骤" style={wrapStyle}>
        <div style={highlight ? { ...styles.row, ...styles.rowCurrent } : styles.row}>
          <ProgressRow it={it} highlight={highlight} onToggle={toggle} />
        </div>
      </section>
    )
  }

  return (
    <section aria-label="本轮步骤" style={wrapStyle}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((v) => !v)}
        style={styles.header}
      >
        <span style={styles.title}>本轮步骤</span>
        <span style={styles.count}>
          {n}/{m}
        </span>
        <span aria-hidden style={styles.chevron}>
          {expanded ? "▴" : "▾"}
        </span>
      </button>
      {!expanded ? (
        preview ? (
          <div style={styles.currentLine} title={preview}>
            {preview}
          </div>
        ) : null
      ) : (
        <ul id={listId} style={styles.list}>
          {items.map((it) => {
            const highlight = firstUndone?.id === it.id
            return (
              <li
                key={it.id}
                style={highlight ? { ...styles.row, ...styles.rowCurrent } : styles.row}
              >
                <ProgressRow it={it} highlight={highlight} onToggle={toggle} />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    // Sticky 相对 ChatView 滚动列顶；实心底 bgMuted，消息不得透上来；
    // zIndex 只压过同列消息，低于 FocusBand / StatusRail（铬层不参与本列）。
    position: "sticky",
    top: 0,
    zIndex: 1,
    margin: "0 0 10px",
    padding: "8px 10px",
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    fontFamily: tokens.font,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    margin: 0,
    padding: 0,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: tokens.font,
    textAlign: "left",
  },
  title: {
    fontSize: 11,
    fontWeight: 600,
    color: tokens.textSecondary,
    letterSpacing: "0.02em",
  },
  count: {
    marginLeft: "auto",
    fontSize: 11,
    color: tokens.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  chevron: {
    fontSize: 10,
    color: tokens.textMuted,
    lineHeight: 1,
  },
  currentLine: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 1.4,
    color: tokens.text,
    // 收起态预览单行截断（companion 侧已 cap 120 字）。
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  list: {
    listStyle: "none",
    margin: "6px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxHeight: "min(40vh, 240px)",
    overflowY: "auto",
  },
  row: {
    margin: 0,
    padding: 0,
  },
  // 展开态未勾第一条：2px accent 左条（附加于字重，非只靠颜色）。
  rowCurrent: {
    borderLeft: `2px solid ${tokens.accent}`,
    paddingLeft: 6,
  },
  label: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1.4,
  },
  box: {
    marginTop: 2,
    flexShrink: 0,
  },
  text: {
    flex: 1,
    minWidth: 0,
    wordBreak: "break-word",
  },
  draft: {
    flexShrink: 0,
    fontSize: 10,
    color: tokens.textMuted,
    background: tokens.bgElevated,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    padding: "0 5px",
    lineHeight: "16px",
  },
}
