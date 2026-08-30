// L0 chat-column checklist. Copy: 「本轮步骤」; draft rows 「草稿」.
// Spec: docs/superpowers/specs/2026-08-30-runprogress-sticky-collapse-design.md §2 (Wave 1)
// Default collapsed (in-memory useState only; keyed per thread at mount site).
// Sticky to the top of the ChatView scroll column — never StatusRail / FocusBand.
// No height animation / no chevron rotation → prefers-reduced-motion safe by construction.
// Overlay has no edit. Not Mission Board.

import { useState } from "react"
import type { CSSProperties } from "react"
import { tokens } from "../ui/tokens"

export type RunProgressItem = {
  id: string
  text: string
  done: boolean
  source: "seed" | "model_draft" | "user"
  tool?: string
}

export function RunProgress({
  threadId,
  items,
}: {
  threadId: string
  items: RunProgressItem[]
}) {
  // 默认收起；换线程由挂载点的 key={threadId} 重挂回到收起。状态只存内存。
  const [expanded, setExpanded] = useState(false)

  if (!items || items.length === 0) return null

  const total = items.length
  const doneCount = items.filter((it) => it.done === true).length
  // 当前步 = 第一条未完成且非草稿；全勾完或只剩草稿时不伪造当前条。
  const current = items.find((it) => it.done !== true && it.source !== "model_draft")
  const firstDraft = items.find((it) => it.source === "model_draft")
  const listId = `run-progress-list-${threadId}`

  const toggle = (itemId: string, source: RunProgressItem["source"]) => {
    if (source === "model_draft") return
    chrome.runtime.sendMessage({
      type: "thread.run_progress.toggle",
      thread_id: threadId,
      item_id: itemId,
    })
  }

  return (
    <section aria-label="本轮步骤" style={styles.wrap}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((v) => !v)}
        style={styles.header}
      >
        <span style={styles.title}>本轮步骤</span>
        <span style={styles.count}>
          {doneCount}/{total}
        </span>
        <span aria-hidden style={styles.chevron}>
          {expanded ? "▴" : "▾"}
        </span>
      </button>
      {!expanded ? (
        current ? (
          <div style={styles.currentLine} title={current.text}>
            {current.text}
          </div>
        ) : firstDraft ? (
          <div style={styles.currentLine} title={firstDraft.text}>
            草稿 · {firstDraft.text}
          </div>
        ) : null
      ) : (
        <ul id={listId} style={styles.list}>
          {items.map((it) => {
            const draft = it.source === "model_draft"
            const isCurrent = current?.id === it.id
            return (
              <li
                key={it.id}
                style={isCurrent ? { ...styles.row, ...styles.rowCurrent } : styles.row}
                aria-current={isCurrent ? "step" : undefined}
              >
                <label style={styles.label}>
                  <input
                    type="checkbox"
                    checked={it.done === true}
                    disabled={draft}
                    onChange={() => toggle(it.id, it.source)}
                    style={styles.box}
                  />
                  <span
                    style={{
                      ...styles.text,
                      textDecoration: it.done ? "line-through" : "none",
                      color: it.done ? tokens.textMuted : tokens.text,
                    }}
                  >
                    {it.text}
                  </span>
                  {draft ? <span style={styles.draft}>草稿</span> : null}
                </label>
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
    // 收起态当前步单行截断（companion 侧已 cap 120 字）。
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
  },
  row: {
    margin: 0,
    padding: 0,
  },
  // 展开态当前步：2px accent 左条（附加于 aria-current，非只靠颜色）。
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
