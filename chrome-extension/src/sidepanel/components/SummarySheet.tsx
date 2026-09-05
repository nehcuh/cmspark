// 上下文工作记忆 / 压缩摘要 sheet — cut out of ChatView.tsx in #321 PR-5
// round-2 (review MAJOR-1: the 摘要 modal was the third sheet named by the
// FINAL-SYNTHESIS PR-5 list). Was an inline hand-rolled role="dialog" card
// with no Escape / no focus trap; now rides the shared BottomSheet primitive
// (ui/Modal → useModalDialog). Purely presentational — no gesture chain, no
// side effects; Escape / scrim click / ✕ all take the same onClose path.
// All copy (titles, redaction notes, footer) preserved verbatim.

import { tokens } from "../ui/tokens"
import { BottomSheet } from "./ui/BottomSheet"

export interface SummaryHandoff {
  goals?: unknown[]
  decisions?: unknown[]
  constraints?: unknown[]
  open_todos?: unknown[]
  artifacts?: unknown[]
}

export type SummarySheetProps = {
  open: boolean
  onClose: () => void
  rollingSummary: string
  handoff: SummaryHandoff | null
}

export function SummarySheet({ open, onClose, rollingSummary, handoff }: SummarySheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="上下文工作记忆">
      <div
        style={{
          padding: "0 12px",
          fontSize: 12,
          lineHeight: 1.5,
          color: tokens.text,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <strong style={{ fontSize: 12 }}>
            {handoff ? "工作记忆（结构化 · 脱敏）" : "压缩摘要（脱敏 · 仅供回顾）"}
          </strong>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 14,
              color: tokens.textMuted,
            }}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        {handoff ? (
          <div style={{ maxHeight: 260, overflow: "auto" }}>
            {(
              [
                ["目标", handoff.goals],
                ["决策", handoff.decisions],
                ["约束", handoff.constraints],
                ["待办", handoff.open_todos],
                ["产物", handoff.artifacts],
              ] as const
            ).map(([label, items]) =>
              items && items.length > 0 ? (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>【{label}】</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {items.map((t, i) => (
                      <li key={i}>{typeof t === "string" ? t : t && typeof t === "object" && "text" in t ? String((t as { text?: string }).text ?? "") : ""}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        ) : (
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
              fontSize: 12,
              maxHeight: 220,
              overflow: "auto",
            }}
          >
            {rollingSummary}
          </pre>
        )}
        <div style={{ marginTop: 8, fontSize: 10, color: tokens.textMuted }}>
          工作记忆仅服务当前请求路径；不进入导出默认路径，也不跨会话注入。磁盘全文仍保留。
        </div>
      </div>
    </BottomSheet>
  )
}
