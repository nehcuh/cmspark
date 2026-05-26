// Slash command autocomplete popover — triggered by typing "/" in chat input

import { useEffect, useRef, useMemo, useState, useCallback } from "react"
import type { SkillMeta } from "../types"

export interface SlashCommandPopoverProps {
  skills: SkillMeta[]
  searchText: string     // the text after "/", e.g. "bro"
  visible: boolean
  anchorEl: HTMLElement | null  // textarea element for positioning
  onSelect: (skill: SkillMeta) => void
  onDismiss: () => void
}

interface MatchResult {
  skill: SkillMeta
  score: number         // lower = better match
  nameRanges: [number, number][]  // highlight ranges in name
  descRanges: [number, number][]  // highlight ranges in description
}

export function SlashCommandPopover({
  skills,
  searchText,
  visible,
  anchorEl,
  onSelect,
  onDismiss,
}: SlashCommandPopoverProps) {
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const popoverRef = useRef<HTMLDivElement>(null)

  const query = searchText.toLowerCase().trim()

  const matches = useMemo(() => {
    if (!query) {
      return skills.map(s => ({
        skill: s,
        score: s.builtin ? 1 : 0, // user skills first when no query
        nameRanges: [] as [number, number][],
        descRanges: [] as [number, number][],
      }))
    }

    const results: MatchResult[] = []
    for (const skill of skills) {
      const nameLower = skill.name.toLowerCase()
      const descLower = skill.description.toLowerCase()

      let score = 999
      const nameRanges: [number, number][] = []
      const descRanges: [number, number][] = []

      const nameIdx = nameLower.indexOf(query)
      const descIdx = descLower.indexOf(query)

      if (nameIdx === 0) {
        score = 1 // prefix match on name
        nameRanges.push([nameIdx, nameIdx + query.length])
      } else if (nameIdx > 0) {
        score = 2 // contains match on name
        nameRanges.push([nameIdx, nameIdx + query.length])
      } else if (descIdx >= 0) {
        score = 3 // match in description
        descRanges.push([descIdx, descIdx + query.length])
      }

      if (score < 999) {
        results.push({ skill, score, nameRanges, descRanges })
      }
    }

    results.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      // secondary: builtin skills at bottom
      if (a.skill.builtin !== b.skill.builtin) return a.skill.builtin ? 1 : -1
      return a.skill.name.localeCompare(b.skill.name)
    })

    return results
  }, [skills, query])

  // Reset highlight when matches change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [matches.length])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!visible) return

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlightedIndex(prev => (prev + 1) % Math.max(matches.length, 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlightedIndex(prev => (prev - 1 + matches.length) % Math.max(matches.length, 1))
        break
      case "Enter":
        e.preventDefault()
        if (matches[highlightedIndex]) {
          onSelect(matches[highlightedIndex].skill)
        }
        break
      case "Escape":
        e.preventDefault()
        onDismiss()
        break
    }
  }, [visible, matches, highlightedIndex, onSelect, onDismiss])

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  // Click outside to dismiss
  useEffect(() => {
    if (!visible) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onDismiss()
      }
    }
    // Delay to avoid the same click that opened it
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handler)
    }
  }, [visible, onDismiss])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!popoverRef.current) return
    const item = popoverRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
    if (item) {
      item.scrollIntoView({ block: "nearest" })
    }
  }, [highlightedIndex])

  if (!visible) return null

  // Show empty skills state
  if (skills.length === 0) {
    return (
      <div style={{ ...calcPopoverStyle(anchorEl), padding: "12px", textAlign: "center" }} className="cmspark-popover">
        <style>{animCSS}</style>
        <div style={styles.emptyText}>暂无可用技能</div>
        <div style={styles.emptyHint}>在 Skills 面板中导入或创建技能</div>
      </div>
    )
  }

  // Show empty state when query has no matches
  if (matches.length === 0) {
    return (
      <div style={{ ...calcPopoverStyle(anchorEl), padding: "12px", textAlign: "center" }} className="cmspark-popover">
        <style>{animCSS}</style>
        <div style={styles.emptyText}>无匹配技能</div>
        <div style={styles.emptyHint}>输入 / 查看全部可用技能</div>
      </div>
    )
  }

  const popoverStyle = calcPopoverStyle(anchorEl)

  return (
    <div style={popoverStyle} ref={popoverRef} className="cmspark-popover">
      <style>{animCSS}</style>
      {/* Builtin skills group */}
      {matches.some(m => m.skill.builtin) && (
        <>
          <div style={styles.groupHeader}>内置技能</div>
          {matches.filter(m => m.skill.builtin).map((m, i) => {
            const globalIdx = matches.indexOf(m)
            return (
              <SkillItem
                key={m.skill.name}
                match={m}
                query={query}
                highlighted={globalIdx === highlightedIndex}
                index={globalIdx}
                onClick={() => onSelect(m.skill)}
                onHover={() => setHighlightedIndex(globalIdx)}
              />
            )
          })}
        </>
      )}

      {/* User skills group */}
      {matches.some(m => !m.skill.builtin) && (
        <>
          <div style={styles.groupHeader}>用户技能</div>
          {matches.filter(m => !m.skill.builtin).map((m, i) => {
            const globalIdx = matches.indexOf(m)
            return (
              <SkillItem
                key={m.skill.name}
                match={m}
                query={query}
                highlighted={globalIdx === highlightedIndex}
                index={globalIdx}
                onClick={() => onSelect(m.skill)}
                onHover={() => setHighlightedIndex(globalIdx)}
              />
            )
          })}
        </>
      )}
    </div>
  )
}

function SkillItem({
  match,
  query,
  highlighted,
  index,
  onClick,
  onHover,
}: {
  match: MatchResult
  query: string
  highlighted: boolean
  index: number
  onClick: () => void
  onHover: () => void
}) {
  const { skill, nameRanges, descRanges } = match

  return (
    <div
      style={{
        ...styles.item,
        background: highlighted ? "#E8F0FE" : "transparent",
      }}
      data-index={index}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      <div style={styles.itemHeader}>
        <span style={styles.itemIcon}>{skill.builtin ? "🔧" : "📋"}</span>
        <span style={styles.itemName}>{highlightText(skill.name, nameRanges)}</span>
        <span style={styles.itemType}>{skill.type === "tool_chain" ? "流程" : skill.type === "sub_agent" ? "子Agent" : "模板"}</span>
      </div>
      <div style={styles.itemDesc}>
        {highlightText(skill.description || "暂无描述", descRanges)}
      </div>
    </div>
  )
}

function highlightText(text: string, ranges: [number, number][]) {
  if (ranges.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let lastEnd = 0

  for (const [start, end] of ranges) {
    if (start > lastEnd) {
      parts.push(text.substring(lastEnd, start))
    }
    parts.push(<strong key={start} style={styles.highlight}>{text.substring(start, end)}</strong>)
    lastEnd = end
  }
  if (lastEnd < text.length) {
    parts.push(text.substring(lastEnd))
  }

  return <>{parts}</>
}

function calcPopoverStyle(anchorEl: HTMLElement | null): React.CSSProperties {
  if (!anchorEl) {
    return { ...styles.popover, bottom: "100%", left: 0, right: 0 }
  }

  // Position absolutely within the parent container, above the textarea
  const parentRect = anchorEl.parentElement?.getBoundingClientRect()
  const elRect = anchorEl.getBoundingClientRect()

  if (!parentRect) return { ...styles.popover, bottom: "100%", left: 0, right: 0 }

  const left = elRect.left - parentRect.left
  const width = elRect.width
  const spaceAbove = elRect.top - parentRect.top

  // Position above the textarea if there's room; otherwise below
  return {
    ...styles.popover,
    left: `${left}px`,
    width: `${width}px`,
    bottom: spaceAbove >= 120 ? `${parentRect.bottom - elRect.top + 8}px` : "auto",
    top: spaceAbove >= 120 ? "auto" : `${elRect.bottom - parentRect.top + 8}px`,
    animation: "cmspark-popover-in 150ms ease-out",
  }
}

const animCSS = `
  @keyframes cmspark-popover-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .cmspark-popover::-webkit-scrollbar { width: 4px; }
  .cmspark-popover::-webkit-scrollbar-thumb { background: #d0d0d0; border-radius: 2px; }
  .cmspark-popover::-webkit-scrollbar-track { background: transparent; }
`

const styles: Record<string, React.CSSProperties> = {
  popover: {
    position: "absolute",
    zIndex: 1000,
    background: "#fff",
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
    maxHeight: 240,
    overflowY: "auto",
    padding: "4px 0",
  },
  groupHeader: {
    padding: "4px 12px 2px",
    fontSize: 10,
    fontWeight: 600,
    color: "#999",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  item: {
    padding: "6px 12px",
    cursor: "pointer",
    borderBottom: "1px solid #f5f5f5",
  },
  itemHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  itemIcon: {
    fontSize: 12,
    flexShrink: 0,
  },
  itemName: {
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "monospace",
    color: "#333",
  },
  itemType: {
    fontSize: 9,
    color: "#999",
    background: "#f0f0f0",
    padding: "1px 5px",
    borderRadius: 3,
    marginLeft: "auto",
    flexShrink: 0,
  },
  itemDesc: {
    fontSize: 11,
    color: "#666",
    marginLeft: 18,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  highlight: {
    fontWeight: 700,
    color: "#1a73e8",
  },
  emptyText: {
    fontSize: 13,
    color: "#999",
  },
  emptyHint: {
    fontSize: 11,
    color: "#bbb",
    marginTop: 4,
  },
}
