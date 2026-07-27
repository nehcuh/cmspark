// L1 ContextStrip (UI Mode P1) — current tab/target + user-initiated「展开工作区」.
// Spec: docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md §4 / D9′
// Expand is user-only; never auto-open Cockpit from step count.

import { useEffect, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { IconExternal, IconGlobe } from "../ui/icons"

export function formatTabLabel(tab: {
  title?: string | null
  url?: string | null
  id?: number
}): string {
  const title = (tab.title || "").trim()
  if (title) return title.length > 48 ? title.slice(0, 47) + "…" : title
  try {
    if (tab.url) {
      const u = new URL(tab.url)
      return u.hostname || tab.url.slice(0, 40)
    }
  } catch {
    /* ignore */
  }
  return typeof tab.id === "number" ? `标签 ${tab.id}` : "当前页"
}

export function formatTabHost(url?: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.protocol === "chrome:" || u.protocol === "chrome-extension:") return u.protocol.replace(":", "")
    return u.hostname || null
  } catch {
    return null
  }
}

export function ContextStrip() {
  const { state } = useAgentStore()
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null)

  const refresh = () => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        setActiveTab(null)
        return
      }
      setActiveTab(tabs[0] ?? null)
    })
  }

  useEffect(() => {
    refresh()
    const onActivated = () => refresh()
    const onUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (changeInfo.status === "complete" || changeInfo.title || changeInfo.url) {
        refresh()
      }
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    const id = setInterval(refresh, 4000)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      clearInterval(id)
    }
  }, [])

  // Prefer store tabList match for the active tab when available (after list_tabs)
  const fromList =
    activeTab?.id != null
      ? state.tabList.find((t) => t.id === activeTab.id) ?? activeTab
      : activeTab

  const label = fromList ? formatTabLabel(fromList) : "未检测到活动标签"
  const host = fromList ? formatTabHost(fromList.url) : null
  const pinned =
    fromList?.id != null && state.pinnedTabIds.includes(fromList.id)

  return (
    <div style={styles.wrap} role="region" aria-label="当前网页上下文">
      <span style={styles.iconBubble} aria-hidden>
        <IconGlobe size={13} style={{ color: tokens.accentText }} />
      </span>
      <div style={styles.meta}>
        <div style={styles.title} title={fromList?.title || fromList?.url || undefined}>
          {label}
          {pinned && <span style={styles.pin}>钉</span>}
        </div>
        {host && <div style={styles.host}>{host}</div>}
        {!fromList && (
          <div style={styles.host}>打开网页后，Agent 可针对当前标签操作</div>
        )}
      </div>
      <button
        type="button"
        style={styles.expandBtn}
        title="展开工作区（用户主动；不会自动弹出）"
        onClick={() => chrome.runtime.sendMessage({ type: "cockpit.open" })}
      >
        展开工作区
        <IconExternal size={12} />
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    background: tokens.modeBrowserBg,
    borderBottom: "1px solid #bfdbfe",
    fontFamily: tokens.font,
    flexShrink: 0,
  },
  iconBubble: {
    width: 22,
    height: 22,
    borderRadius: 6,
    background: tokens.bgElevated,
    border: `1px solid #bfdbfe`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: tokens.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  pin: {
    fontSize: 9,
    fontWeight: 700,
    color: tokens.accentText,
    background: tokens.accentSoft,
    borderRadius: 4,
    padding: "0 4px",
    flexShrink: 0,
  },
  host: {
    fontSize: 10,
    color: tokens.textMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    marginTop: 1,
  },
  expandBtn: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: `1px solid #bfdbfe`,
    background: tokens.bgElevated,
    color: tokens.accentText,
    borderRadius: tokens.radiusSm,
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
}
