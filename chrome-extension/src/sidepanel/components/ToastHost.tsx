// #321 PR-3: single toast queue host.
// - One queue (`useToastQueue`) replaces the three App setToast paths.
// - A burst is bounded (TOAST_MAX_VISIBLE) and rendered as a vertical column
//   with per-row gaps → rows never overlap ("不叠罗汉"), each auto-dismisses.
// - The host carries NO rail-height offset; App anchors it below the rail via a
//   zero-height slot, so the old `top:52` rail-avoidance magic is gone.
import { useCallback, useEffect, useState, type CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import {
  dismissToast,
  makeToast,
  pushToast,
  type ToastItem,
  type ToastKind,
} from "../ui/toastQueue"

export const TOAST_DURATION_MS = 4000
export const TOAST_MAX_VISIBLE = 3

export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((message: string, kind: ToastKind = "info") => {
    if (!message) return
    const t = makeToast(message, kind)
    setToasts((prev) => pushToast(prev, t, TOAST_MAX_VISIBLE))
  }, [])

  const closeToast = useCallback((id: number) => {
    setToasts((prev) => dismissToast(prev, id))
  }, [])

  return { toasts, showToast, closeToast }
}

const palette: Record<ToastKind, { bg: string; color: string; border: string }> = {
  info: { bg: tokens.text, color: tokens.userBubbleText, border: "transparent" },
  warning: { bg: tokens.warning, color: "#ffffff", border: "transparent" },
  error: { bg: tokens.danger, color: "#ffffff", border: "transparent" },
}

function ToastRow({ toast, onClose }: { toast: ToastItem; onClose: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onClose(toast.id), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [toast.id, onClose])

  const p = palette[toast.kind]
  return (
    <div
      role="status"
      data-testid={`toast-${toast.kind}`}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        background: p.bg,
        color: p.color,
        border: `1px solid ${p.border}`,
        padding: "8px 10px",
        borderRadius: tokens.radiusMd,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.45,
        boxShadow: tokens.shadowMd,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{toast.message}</span>
      <button
        type="button"
        aria-label="关闭通知"
        onClick={() => onClose(toast.id)}
        style={{
          border: "none",
          background: "transparent",
          color: "inherit",
          opacity: 0.7,
          cursor: "pointer",
          fontSize: 12,
          lineHeight: 1,
          padding: 2,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}

/**
 * Renders the bounded queue as a spaced column; App places this inside a
 * zero-height relative slot directly under StatusRail so the top edge is the
 * rail's bottom edge regardless of rail height.
 */
export function ToastHost({
  toasts,
  onClose,
}: {
  toasts: readonly ToastItem[]
  onClose: (id: number) => void
}) {
  if (toasts.length === 0) return null

  const stack: CSSProperties = {
    position: "absolute",
    top: 8,
    left: 10,
    right: 10,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    zIndex: 300,
  }

  return (
    <div style={stack} data-testid="toast-stack">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onClose={onClose} />
      ))}
    </div>
  )
}
