// @-thread chips above the composer — cut out of App.tsx InputArea in #321 PR-7.
// Pure move: same pill chrome and token-sync on dismiss.

import type { AtThreadChoice } from "./AtThreadPopover"
import { tokens } from "../ui/tokens"

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export type ThreadRefChipsProps = {
  threadRefs: AtThreadChoice[]
  onDismiss: (id: string) => void
}

export function ThreadRefChips({ threadRefs, onDismiss }: ThreadRefChipsProps) {
  if (threadRefs.length === 0) return null
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        padding: "6px 12px 0",
      }}
      aria-label="引用的会话"
    >
      {threadRefs.map((r) => (
        <span
          key={r.id}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            background: tokens.bgMuted,
            borderRadius: tokens.radiusPill,
            fontSize: 11,
            color: tokens.textSecondary,
            maxWidth: 180,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            @{r.title}
          </span>
          <span
            role="button"
            onClick={() => onDismiss(r.id)}
            style={{ cursor: "pointer", fontWeight: "bold", flexShrink: 0 }}
          >
            {"\u00d7"}
          </span>
        </span>
      ))}
    </div>
  )
}
