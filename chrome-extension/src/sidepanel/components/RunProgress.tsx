// L0 chat-column checklist. Copy: 「本轮步骤」; draft rows 「草稿」.
// Spec: docs/superpowers/plans/2026-08-26-slice-6-match-idf-runprogress.md Task 5
// Overlay has no edit. Not Mission Board.

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
  if (!items || items.length === 0) return null

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
      <div style={styles.title}>本轮步骤</div>
      <ul style={styles.list}>
        {items.map((it) => {
          const draft = it.source === "model_draft"
          return (
            <li key={it.id} style={styles.row}>
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
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    margin: "0 0 10px",
    padding: "8px 10px",
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    fontFamily: tokens.font,
  },
  title: {
    fontSize: 11,
    fontWeight: 600,
    color: tokens.textSecondary,
    marginBottom: 6,
    letterSpacing: "0.02em",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  row: {
    margin: 0,
    padding: 0,
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
