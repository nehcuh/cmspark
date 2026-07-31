// StatusRail — Zone A (UIUX v2 PR1)
// Mode badge + pin · connection (token colors) · thread switcher · ⋯ menu

import { useState, useRef, useEffect, type CSSProperties } from "react"
import { ThreadList } from "./ThreadList"
import { useAgentStore } from "../store/agentStore"
import type { ConnectionState, CapabilityLevel } from "../types"
import {
  tokens,
  connectionColor,
  connectionLabel,
  connectionDotShadow,
} from "../ui/tokens"
import { ModeBadge } from "../ui/ModeBadge"
import {
  IconCraft,
  IconDownload,
  IconNotebook,
  IconSave,
  IconBrain,
  IconLogs,
  IconSettings,
  IconAlert,
  IconSpinner,
  IconMore,
} from "../ui/icons"

export function StatusRail({
  connectionState,
  capabilityLevel,
  badgeLabel,
  onCraft,
  onToggleLogs,
  onOpenNotebooklmImporter,
  onToast,
}: {
  connectionState: ConnectionState
  capabilityLevel: CapabilityLevel
  badgeLabel: string
  onCraft: () => void
  onToggleLogs: () => void
  onOpenNotebooklmImporter: () => void
  onToast?: (msg: string) => void
}) {
  const { state, dispatch } = useAgentStore()
  const pinned = state.modePin === capabilityLevel
  const togglePin = () => {
    if (pinned) {
      dispatch({ type: "SET_MODE_PIN", pin: null })
      onToast?.("已取消钉住 — 层级可自动降级")
    } else {
      dispatch({ type: "SET_MODE_PIN", pin: capabilityLevel })
      onToast?.(`已钉住「${badgeLabel}」— 阻止自动降级`)
    }
  }
  const hasMessages = state.messages.length > 0 && !!state.activeThreadId
  const [nbState, setNbState] = useState<"idle" | "working" | "warning">("idle")
  const [nbTooltip, setNbTooltip] = useState<string>(
    "离线导出当前页为 Markdown（拖入 NotebookLM 作为来源）",
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // useRef lock is mandatory: React state updates are async, so a rapid second click
  // within the same tick can pass the `nbState === "working"` guard before the first
  // setNbState commits — both fire sendMessage → double download. The ref is synchronous.
  const nbInflightRef = useRef(false)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [menuOpen])

  const resetNbIdle = (delay: number, immediate?: boolean) => {
    if (immediate) {
      setNbState("idle")
      setNbTooltip("离线导出当前页为 Markdown（拖入 NotebookLM 作为来源）")
      nbInflightRef.current = false
      return
    }
    setTimeout(() => {
      setNbState("idle")
      setNbTooltip("离线导出当前页为 Markdown（拖入 NotebookLM 作为来源）")
      nbInflightRef.current = false
    }, delay)
  }

  const runNotebooklmExport = async () => {
    if (nbInflightRef.current) return
    nbInflightRef.current = true
    setNbState("working")
    setNbTooltip("正在抽取页面内容…")

    // Race against a 30s timeout: if the service worker is killed mid-extraction
    // (MV3 lifecycle), the sendMessage promise may never resolve. Without this,
    // the button stays disabled forever. (Phase 4 review catch.)
    const timeout = new Promise<{ _timeout: true }>((resolve) =>
      setTimeout(() => resolve({ _timeout: true }), 30_000),
    )

    type ExportResponse = {
      ok?: boolean
      content?: string
      filename?: string
      truncated?: boolean
      error?: string
    }
    type RaceResult = ExportResponse | { _timeout: true } | undefined

    try {
      const res = (await Promise.race<RaceResult>([
        chrome.runtime.sendMessage({ type: "page.import_notebooklm" }) as Promise<ExportResponse>,
        timeout,
      ])) as RaceResult

      if (res && typeof res === "object" && "_timeout" in res) {
        setNbState("warning")
        setNbTooltip("导出超时（30s）— service worker 可能被挂起，请重试")
        resetNbIdle(6000)
        return
      }

      const r = res as ExportResponse | undefined
      if (r && r.ok && r.content) {
        const blob = new Blob([new TextEncoder().encode(r.content)], {
          type: "text/markdown",
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = r.filename || "notebooklm-export.md"
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        if (r.truncated) {
          setNbState("warning")
          setNbTooltip("已导出（内容超过 200k 字符，已截断）")
          resetNbIdle(6000)
        } else {
          setNbTooltip("已导出 ✓")
          resetNbIdle(2500)
        }
      } else {
        const err = (r && r.error) || "导出失败"
        setNbState("warning")
        setNbTooltip(err)
        resetNbIdle(6000)
      }
    } catch (e: any) {
      setNbState("warning")
      setNbTooltip(`导出失败: ${e?.message || String(e)}`)
      resetNbIdle(6000)
    }
  }

  const closeMenu = () => setMenuOpen(false)
  const connLabel = connectionLabel(connectionState)

  // G1: no full-rail mode fill — badge carries mode; L1/L2 get a 3px accent line only.
  const modeLine =
    capabilityLevel === "browser"
      ? tokens.modeBrowserLine
      : capabilityLevel === "computer"
        ? tokens.modeComputerLine
        : null

  return (
    <div
      role="banner"
      aria-label="状态栏"
      style={{
        ...railStyles.rail,
        ...(modeLine
          ? { boxShadow: `inset 0 -3px 0 ${modeLine}, 0 1px 0 rgba(255,255,255,0.85) inset` }
          : {}),
      }}
    >
      <ThreadList />
      <div style={railStyles.title}>CMspark</div>
      <ModeBadge
        level={capabilityLevel}
        label={badgeLabel}
        pinned={pinned}
        onTogglePin={togglePin}
      />
      <div
        role="status"
        aria-label={connLabel}
        title={connLabel}
        style={{
          ...railStyles.statusDot,
          background: connectionColor(connectionState),
          boxShadow: connectionDotShadow(connectionState),
        }}
      />
      {/* Power actions in ⋯ menu — not permanent icon strip */}
      <div ref={menuRef} style={{ position: "relative", flexShrink: 0, marginLeft: 2 }}>
        <button
          type="button"
          style={{
            ...railStyles.iconBtn,
            ...(menuOpen || nbState === "warning"
              ? {
                  background: nbState === "warning" ? tokens.warningSoft : tokens.bgActive,
                  borderColor: nbState === "warning" ? "#fcd34d" : "#bfdbfe",
                }
              : {}),
          }}
          onClick={() => setMenuOpen((v) => !v)}
          title="更多工具与设置"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          {nbState === "working" ? <IconSpinner size={15} /> : <IconMore size={15} />}
        </button>
        {menuOpen && (
          <div style={railStyles.menu} role="menu">
            <button
              type="button"
              role="menuitem"
              style={{
                ...railStyles.menuItem,
                opacity: hasMessages ? 1 : 0.45,
                cursor: hasMessages ? "pointer" : "not-allowed",
              }}
              disabled={!hasMessages}
              onClick={() => {
                if (!hasMessages) return
                closeMenu()
                onCraft()
              }}
            >
              <IconCraft size={14} />
              <span>提取技能</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={{
                ...railStyles.menuItem,
                opacity: hasMessages ? 1 : 0.45,
                cursor: hasMessages ? "pointer" : "not-allowed",
              }}
              disabled={!hasMessages}
              onClick={() => {
                if (!hasMessages || !state.activeThreadId) return
                closeMenu()
                chrome.runtime.sendMessage({
                  type: "thread.export_obsidian",
                  thread_id: state.activeThreadId,
                  scope: "thread",
                })
              }}
            >
              <IconDownload size={14} />
              <span>导出线程 (Obsidian)</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={{
                ...railStyles.menuItem,
                opacity: hasMessages ? 1 : 0.45,
                cursor: hasMessages ? "pointer" : "not-allowed",
              }}
              disabled={!hasMessages || state.summarizingThreadId === state.activeThreadId}
              onClick={() => {
                if (!hasMessages || !state.activeThreadId) return
                closeMenu()
                dispatch({ type: "SET_SUMMARIZING_THREAD", threadId: state.activeThreadId })
                chrome.runtime.sendMessage({
                  type: "thread.export_obsidian",
                  thread_id: state.activeThreadId,
                  scope: "summary",
                })
              }}
            >
              <IconBrain size={14} />
              <span>
                {state.summarizingThreadId === state.activeThreadId
                  ? "摘要导出中…"
                  : "导出摘要"}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={railStyles.menuItem}
              onClick={() => {
                closeMenu()
                onOpenNotebooklmImporter()
              }}
            >
              <IconNotebook size={14} />
              <span>NotebookLM 导入</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={railStyles.menuItem}
              disabled={nbState === "working"}
              title={nbTooltip}
              onClick={() => {
                closeMenu()
                void runNotebooklmExport()
              }}
            >
              {nbState === "warning" ? <IconAlert size={14} /> : <IconSave size={14} />}
              <span>导出当前页 (NB)</span>
            </button>
            <div style={railStyles.menuDivider} />
            <button
              type="button"
              role="menuitem"
              style={railStyles.menuItem}
              onClick={() => {
                closeMenu()
                onToggleLogs()
              }}
            >
              <IconLogs size={14} />
              <span>日志</span>
            </button>
            <button
              type="button"
              role="menuitem"
              style={railStyles.menuItem}
              onClick={() => {
                closeMenu()
                dispatch({ type: "TOGGLE_SETTINGS" })
              }}
            >
              <IconSettings size={14} />
              <span>设置</span>
            </button>
            <div style={railStyles.menuDivider} />
            <button
              type="button"
              role="menuitem"
              style={{ ...railStyles.menuItem, color: tokens.textMuted, fontSize: 11 }}
              onClick={() => {
                closeMenu()
                onToast?.(
                  "任务包 / 任务板已移至底栏「更多」— 主栏仅保留当前模式高频入口",
                )
              }}
            >
              <span>关于「更多」面板</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const railStyles: Record<string, CSSProperties> = {
  rail: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderBottom: `1px solid ${tokens.border}`,
    background: "rgba(255, 255, 255, 0.72)",
    backdropFilter: "saturate(1.35) blur(14px)",
    WebkitBackdropFilter: "saturate(1.35) blur(14px)",
    flexShrink: 0,
    minHeight: 40,
    boxShadow: "0 1px 0 rgba(255,255,255,0.85) inset",
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: tokens.textSecondary,
  },
  menu: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 6px)",
    minWidth: 212,
    maxHeight: 360,
    overflowY: "auto",
    background: tokens.bgElevated,
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: tokens.radiusMenu,
    boxShadow: tokens.shadowLg,
    zIndex: 50,
    padding: 6,
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  menuItem: {
    border: "none",
    background: "transparent",
    borderRadius: tokens.radiusMd,
    padding: "9px 11px",
    fontSize: 12,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 9,
    color: tokens.text,
    textAlign: "left" as const,
    width: "100%",
    fontFamily: tokens.font,
    fontWeight: 500,
  },
  menuDivider: {
    height: 1,
    background: tokens.border,
    margin: "5px 8px",
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    color: tokens.textSecondary,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    boxShadow: tokens.shadowSm,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
}
