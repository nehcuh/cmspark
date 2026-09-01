// @ thread autocomplete — mirror SlashCommandPopover for cross-thread refs (P1.5)

import { useEffect, useRef, useMemo, useState, useCallback } from "react"
import type { Thread } from "../types"
import { displayThreadTitle, threadRecency } from "../utils/thread-timeline"
import { tokens } from "../ui/tokens"

export type AtThreadChoice = {
  id: string
  title: string
}

export interface AtThreadPopoverProps {
  threads: Thread[]
  /** Exclude current active thread */
  excludeId?: string | null
  searchText: string
  visible: boolean
  anchorEl: HTMLElement | null
  onSelect: (choice: AtThreadChoice) => void
  onDismiss: () => void
}

export function AtThreadPopover({
  threads,
  excludeId,
  searchText,
  visible,
  anchorEl,
  onSelect,
  onDismiss,
}: AtThreadPopoverProps) {
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const popoverRef = useRef<HTMLDivElement>(null)
  const query = searchText.toLowerCase().trim()

  const matches = useMemo(() => {
    const pool = (Array.isArray(threads) ? threads : []).filter(
      (t) => t.id !== excludeId && !t.trashed_at,
    )
    // Recent first (last_message_at || created_at) when no query
    const sorted = [...pool].sort((a, b) => {
      const ta = Date.parse(threadRecency(a) || "") || 0
      const tb = Date.parse(threadRecency(b) || "") || 0
      return tb - ta
    })
    if (!query) return sorted.slice(0, 12)

    const scored: Array<{ t: Thread; score: number }> = []
    for (const t of sorted) {
      const title = displayThreadTitle(t).toLowerCase()
      const id = (t.id || "").toLowerCase()
      const preview = (t.first_user_preview || "").toLowerCase()
      const tags = (t.digest?.tags || []).join(" ").toLowerCase()
      let score = 999
      if (title.startsWith(query) || id.startsWith(query)) score = 1
      else if (title.includes(query) || id.includes(query)) score = 2
      else if (preview.includes(query) || tags.includes(query)) score = 3
      if (score < 999) scored.push({ t, score })
    }
    scored.sort((a, b) => a.score - b.score)
    return scored.map((s) => s.t).slice(0, 12)
  }, [threads, excludeId, query])

  useEffect(() => {
    setHighlightedIndex(0)
  }, [matches.length, query])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setHighlightedIndex((prev) => (prev + 1) % Math.max(matches.length, 1))
          break
        case "ArrowUp":
          e.preventDefault()
          setHighlightedIndex(
            (prev) => (prev - 1 + Math.max(matches.length, 1)) % Math.max(matches.length, 1),
          )
          break
        case "Enter":
          e.preventDefault()
          if (matches[highlightedIndex]) {
            const t = matches[highlightedIndex]
            onSelect({ id: t.id, title: displayThreadTitle(t) })
          }
          break
        case "Escape":
          e.preventDefault()
          onDismiss()
          break
      }
    },
    [visible, matches, highlightedIndex, onSelect, onDismiss],
  )

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    if (!visible) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onDismiss()
      }
    }
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handler)
    }
  }, [visible, onDismiss])

  if (!visible) return null

  const style = calcPopoverStyle(anchorEl)

  if (matches.length === 0) {
    return (
      <div style={{ ...style, padding: 12, textAlign: "center" }} ref={popoverRef}>
        <div style={{ fontSize: 12, color: tokens.textSecondary }}>无匹配会话</div>
      </div>
    )
  }

  return (
    <div style={style} ref={popoverRef} role="listbox" aria-label="引用会话">
      <div
        style={{
          padding: "6px 10px",
          fontSize: 10,
          fontWeight: 600,
          color: tokens.textMuted,
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        引用会话 @
      </div>
      {matches.map((t, i) => {
        const title = displayThreadTitle(t)
        const active = i === highlightedIndex
        return (
          <div
            key={t.id}
            role="option"
            aria-selected={active}
            data-index={i}
            style={{
              padding: "8px 10px",
              cursor: "pointer",
              background: active ? tokens.accentSoft : "transparent",
              borderBottom: `1px solid ${tokens.border}`,
            }}
            onClick={() => onSelect({ id: t.id, title })}
            onMouseEnter={() => setHighlightedIndex(i)}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </div>
            <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 2 }}>
              #{t.id}
              {t.digest?.tags?.length ? ` · ${t.digest.tags.slice(0, 3).map((x) => `#${x}`).join(" ")}` : ""}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function calcPopoverStyle(anchorEl: HTMLElement | null): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "fixed",
    zIndex: 200,
    width: 280,
    maxHeight: 240,
    overflowY: "auto",
    background: tokens.bgElevated,
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
    fontFamily: tokens.font,
  }
  if (!anchorEl) {
    return { ...base, bottom: 80, left: 16 }
  }
  const rect = anchorEl.getBoundingClientRect()
  return {
    ...base,
    left: Math.max(8, rect.left),
    bottom: Math.max(8, window.innerHeight - rect.top + 6),
  }
}
