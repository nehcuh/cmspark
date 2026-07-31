// Bottom context bar: mode-filtered tab strip + overflow「更多」.
// UIUX v2 §4.7 M1: panel state / loaders / mounts live in ContextPanelHost.
// This file is thin chrome that calls Host API. Strip delete is PR5 (not here).

import { useState, useRef, useEffect, useMemo } from "react"
import {
  contextBarTabsForLevel,
  contextBarOverflowTabsForLevel,
} from "../mode/mode-controller"
import type { CapabilityLevel } from "../types"
import {
  CONTEXT_PANEL_TABS,
  useContextPanelHost,
  type ContextPanelId,
} from "./ContextPanelHost"
import { tokens } from "../ui/tokens"
import { IconMore } from "../ui/icons"

export function BottomBar({ capabilityLevel }: { capabilityLevel: CapabilityLevel }) {
  const { activePanel, openPanel, closePanel } = useContextPanelHost()
  const [moreOpen, setMoreOpen] = useState(false)
  /** Fixed menu position (viewport coords) — avoids overflow clip + InputArea paint order. */
  const [moreMenuPos, setMoreMenuPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  const allowedIds = useMemo(
    () => new Set(contextBarTabsForLevel(capabilityLevel)),
    [capabilityLevel],
  )
  const overflowIds = useMemo(
    () => contextBarOverflowTabsForLevel(capabilityLevel),
    [capabilityLevel],
  )
  const tabs = useMemo(
    () => CONTEXT_PANEL_TABS.filter((t) => allowedIds.has(t.id)),
    [allowedIds],
  )
  const overflowTabs = useMemo(
    () => CONTEXT_PANEL_TABS.filter((t) => overflowIds.includes(t.id)),
    [overflowIds],
  )

  // L2 Panel: no permanent ContextBar (Cockpit owns power tools). Overflow still
  // available only if user needs packs/board edge access — keep a thin more menu.
  const isL2 = capabilityLevel === "computer"

  // Host-driven open (slash / chips) should dismiss overflow menu
  useEffect(() => {
    setMoreOpen(false)
    setMoreMenuPos(null)
  }, [activePanel])

  const computeMoreMenuPos = (): { top: number; left: number; minWidth: number } | null => {
    const btn = moreBtnRef.current
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    const minWidth = Math.max(160, r.width)
    const estimatedH = Math.min(240, 12 + overflowTabs.length * 36)
    let top = r.top - 4 - estimatedH
    if (top < 8) top = Math.min(r.bottom + 4, window.innerHeight - estimatedH - 8)
    let left = r.right - minWidth
    if (left < 8) left = 8
    if (left + minWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - minWidth - 8)
    return { top, left, minWidth }
  }

  const updateMoreMenuPos = () => {
    const pos = computeMoreMenuPos()
    if (pos) setMoreMenuPos(pos)
  }

  const toggleMore = () => {
    if (moreOpen) {
      setMoreOpen(false)
      setMoreMenuPos(null)
      return
    }
    const pos = computeMoreMenuPos()
    if (pos) setMoreMenuPos(pos)
    setMoreOpen(true)
  }

  useEffect(() => {
    if (!moreOpen) {
      setMoreMenuPos(null)
      return
    }
    updateMoreMenuPos()
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (moreRef.current?.contains(t)) return
      if (moreMenuRef.current?.contains(t)) return
      setMoreOpen(false)
    }
    const onReposition = () => updateMoreMenuPos()
    document.addEventListener("mousedown", onDoc)
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reposition reads overflowTabs.length via closure when open
  }, [moreOpen, overflowTabs.length])

  const handleTabClick = (id: ContextPanelId) => {
    openPanel(id)
    setMoreOpen(false)
    setMoreMenuPos(null)
  }

  const handleClosePanel = () => {
    closePanel()
    setMoreOpen(false)
    setMoreMenuPos(null)
  }

  const activeTabDef = activePanel
    ? CONTEXT_PANEL_TABS.find((t) => t.id === activePanel) ?? null
    : null
  /** Overflow panel open → promote a temporary tab so user can click once to collapse. */
  const overflowActiveTab =
    activePanel && overflowIds.includes(activePanel) ? activeTabDef : null

  const moreMenuEl =
    moreOpen && overflowTabs.length > 0 && moreMenuPos ? (
      <div
        ref={moreMenuRef}
        style={{
          ...styles.moreMenu,
          top: moreMenuPos.top,
          left: moreMenuPos.left,
          minWidth: moreMenuPos.minWidth,
        }}
        role="menu"
      >
        {activePanel && (
          <button
            type="button"
            role="menuitem"
            style={{
              ...styles.moreItem,
              color: tokens.textSecondary,
              borderBottom: `1px solid ${tokens.border}`,
              borderRadius: 0,
              marginBottom: 2,
              paddingBottom: 10,
            }}
            onClick={handleClosePanel}
          >
            <span aria-hidden>⌃</span>
            <span>收起面板</span>
            <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.7 }}>Esc</span>
          </button>
        )}
        {overflowTabs.map((tab) => {
          const Icon = tab.Icon
          const active = activePanel === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="menuitem"
              style={{
                ...styles.moreItem,
                ...(active ? { background: tokens.bgActive, color: tokens.accent } : {}),
              }}
              onClick={() => handleTabClick(tab.id)}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
              {active && <span style={{ marginLeft: "auto", fontSize: 10 }}>收起</span>}
            </button>
          )
        })}
      </div>
    ) : null

  const moreBtnActive =
    moreOpen || (activePanel != null && !allowedIds.has(activePanel))

  const renderTabBar = (opts: { justifyEnd?: boolean } = {}) => (
    <div style={{ ...styles.tabs, ...(opts.justifyEnd ? { justifyContent: "flex-end" } : {}) }}>
      {!opts.justifyEnd && (
        <div style={styles.tabsScroll}>
          {tabs.map((tab) => {
            const active = activePanel === tab.id
            const Icon = tab.Icon
            return (
              <button
                key={tab.id}
                type="button"
                style={{
                  ...styles.tabBtn,
                  background: active ? tokens.bgActive : "transparent",
                  color: active ? tokens.accent : tokens.textSecondary,
                  borderColor: active ? tokens.accentSoft : "transparent",
                  boxShadow: active ? tokens.shadowSm : "none",
                }}
                onClick={() => handleTabClick(tab.id)}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            )
          })}
          {overflowActiveTab && (() => {
            const Icon = overflowActiveTab.Icon
            return (
              <button
                key={`overflow-active-${overflowActiveTab.id}`}
                type="button"
                style={{
                  ...styles.tabBtn,
                  background: tokens.bgActive,
                  color: tokens.accent,
                  borderColor: tokens.accentSoft,
                  boxShadow: tokens.shadowSm,
                }}
                title={`收起「${overflowActiveTab.label}」`}
                onClick={() => handleTabClick(overflowActiveTab.id)}
              >
                <Icon size={14} />
                <span>{overflowActiveTab.label}</span>
                <span style={styles.tabCloseHint} aria-hidden>
                  ×
                </span>
              </button>
            )
          })()}
        </div>
      )}
      {overflowTabs.length > 0 && (
        <div ref={moreRef} style={styles.moreAnchor}>
          <button
            ref={moreBtnRef}
            type="button"
            style={{
              ...styles.moreBtn,
              ...(moreBtnActive
                ? {
                    background: tokens.bgActive,
                    color: tokens.accent,
                    borderColor: tokens.accentSoft,
                  }
                : {}),
            }}
            title={
              overflowActiveTab
                ? `更多面板（当前：${overflowActiveTab.label}）。点左侧标签或 Esc 可收起`
                : "任务包、任务板等低频入口"
            }
            aria-expanded={moreOpen}
            onClick={toggleMore}
          >
            <IconMore size={14} />
            <span>更多</span>
          </button>
        </div>
      )}
    </div>
  )

  // L2 with no primary tabs and collapsed more: hide entire bar to free vertical space
  if (isL2 && tabs.length === 0 && !activePanel && !moreOpen) {
    return (
      <div style={styles.container}>
        {renderTabBar({ justifyEnd: true })}
        {moreMenuEl}
      </div>
    )
  }

  return (
    <div style={styles.container}>
      {renderTabBar()}
      {moreMenuEl}
    </div>
  )
}

// ── Strip-only styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderTop: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    flexShrink: 0,
  },
  tabs: {
    display: "flex",
    gap: 4,
    padding: "6px 10px",
    alignItems: "center",
  },
  tabsScroll: {
    display: "flex",
    gap: 4,
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    overflowX: "auto",
  },
  tabBtn: {
    border: "1px solid transparent",
    borderRadius: tokens.radiusPill,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    whiteSpace: "nowrap",
    transition: `background ${tokens.transitionFast} ease, color ${tokens.transitionFast} ease`,
    fontFamily: tokens.font,
  },
  moreAnchor: {
    flexShrink: 0,
    marginLeft: 2,
  },
  moreBtn: {
    border: "1px solid transparent",
    borderRadius: tokens.radiusPill,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    whiteSpace: "nowrap",
    color: tokens.textSecondary,
    background: "transparent",
    fontFamily: tokens.font,
  },
  moreMenu: {
    position: "fixed",
    maxHeight: 240,
    overflowY: "auto",
    background: tokens.bgElevated,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    boxShadow: tokens.shadowMd,
    zIndex: 1000,
    padding: 4,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  moreItem: {
    border: "none",
    background: "transparent",
    borderRadius: tokens.radiusSm,
    padding: "8px 10px",
    fontSize: 12,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: tokens.text,
    textAlign: "left",
    width: "100%",
    fontFamily: tokens.font,
  },
  tabCloseHint: {
    fontSize: 13,
    lineHeight: 1,
    opacity: 0.65,
    marginLeft: 2,
  },
}
