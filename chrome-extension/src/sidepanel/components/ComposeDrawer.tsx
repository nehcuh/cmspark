// 装配 P0 — bottom-sheet section list (Composition plane only).
// Full section UIs land in P1; entry + Host open is P0 (UIUX v2 §4.5 / K9).
// Board / Fleet / multi-worker are Autonomy — never listed here.

import { useEffect, useRef, type CSSProperties } from "react"
import {
  COMPOSE_SECTIONS,
  type ComposeSection,
} from "../composer/meta-slash"
import type { ContextPanelId } from "./ContextPanelHost"
import type { CapabilityLevel } from "../types"
import { tokens } from "../ui/tokens"

const SURFACE_LX: Record<CapabilityLevel, string> = {
  chat: "L0 聊",
  browser: "L1 网页",
  computer: "L2 计算机",
}

export type ComposeDrawerProps = {
  open: boolean
  onClose: () => void
  /** Open Host panel and close drawer. */
  onOpenSection: (panelId: ContextPanelId) => void
  /** Current Surface level for §4.5 “挂到 … Surface Lx” copy (Pi nit). */
  capabilityLevel?: CapabilityLevel
}

export function ComposeDrawer({
  open,
  onClose,
  onOpenSection,
  capabilityLevel = "chat",
}: ComposeDrawerProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const firstBtnRef = useRef<HTMLButtonElement>(null)

  // Esc peels 装配 (priority stack §4.9 layer 2)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, onClose])

  // Focus first section for a11y
  useEffect(() => {
    if (!open) return
    const t = requestAnimationFrame(() => firstBtnRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [open])

  if (!open) return null

  const handleSection = (section: ComposeSection) => {
    onOpenSection(section.panelId)
  }

  return (
    <div
      style={styles.backdrop}
      role="presentation"
      data-testid="compose-drawer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={sheetRef}
        style={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="装配"
      >
        <div style={styles.handle} aria-hidden />
        <div style={styles.header}>
          <div>
            <div style={styles.title}>装配</div>
            <div style={styles.subtitle}>
              组合能力 · 挂到当前线程 · Surface {SURFACE_LX[capabilityLevel]}
            </div>
          </div>
          <button
            type="button"
            style={styles.closeBtn}
            onClick={onClose}
            aria-label="关闭装配"
          >
            关闭
          </button>
        </div>
        <ul style={styles.list} role="list">
          {COMPOSE_SECTIONS.map((section, i) => (
            <li key={section.id} style={styles.listItem}>
              <button
                ref={i === 0 ? firstBtnRef : undefined}
                type="button"
                style={styles.sectionBtn}
                onClick={() => handleSection(section)}
                data-testid={`compose-section-${section.id}`}
              >
                <span style={styles.sectionLabel}>{section.label}</span>
                <span style={styles.sectionHint}>{section.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <p style={styles.footNote}>
          任务板 / 编排不在装配内 — 使用 /board 或 ⋯「编排」
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 250,
    background: "rgba(15, 23, 42, 0.28)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
  },
  sheet: {
    background: tokens.bgElevated,
    borderTopLeftRadius: tokens.radiusLg,
    borderTopRightRadius: tokens.radiusLg,
    boxShadow: tokens.shadowMd,
    maxHeight: "70vh",
    overflowY: "auto",
    padding: "8px 0 12px",
    fontFamily: tokens.font,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: tokens.radiusPill,
    background: tokens.borderStrong,
    margin: "4px auto 10px",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    padding: "0 14px 10px",
    borderBottom: `1px solid ${tokens.border}`,
  },
  title: {
    fontSize: 15,
    fontWeight: 650,
    color: tokens.text,
  },
  subtitle: {
    fontSize: 11,
    color: tokens.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusPill,
    background: tokens.bgMuted,
    color: tokens.textSecondary,
    fontSize: 11,
    fontWeight: 500,
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: tokens.font,
    flexShrink: 0,
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: "6px 8px",
  },
  listItem: {
    margin: 0,
  },
  sectionBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    width: "100%",
    textAlign: "left",
    border: "none",
    borderRadius: tokens.radiusMd,
    background: "transparent",
    padding: "10px 10px",
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: tokens.text,
  },
  sectionHint: {
    fontSize: 11,
    color: tokens.textSecondary,
  },
  footNote: {
    margin: "4px 14px 0",
    fontSize: 10,
    color: tokens.textMuted,
    lineHeight: 1.4,
  },
}
