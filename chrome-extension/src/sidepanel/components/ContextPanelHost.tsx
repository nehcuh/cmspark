// ContextPanelHost — single owner of context panel state, loaders, mounts,
// and cmspark:open-context-panel (UIUX v2 §4.7 M1). Host is SoT for panels.
// PR5: permanent BottomBar tab strip gated by ui.bottomBarStrip (default false).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import { useAgentStore } from "../store/agentStore"
import {
  contextBarTabsForLevel,
  contextBarOverflowTabsForLevel,
} from "../mode/mode-controller"
import type { CapabilityLevel } from "../types"
import { KnowledgeSubPanel } from "./KnowledgeSubPanel"
import { McpPanel } from "./McpPanel"
import { AppsPanel } from "./AppsPanel"
import { PacksPanel } from "./PacksPanel"
import { BoardPanel } from "./BoardPanel"
import { MeetingPanel } from "./MeetingPanel"
import { tokens } from "../ui/tokens"
import {
  IconTabs,
  IconHistory,
  IconSkills,
  IconKnowledge,
  IconMcp,
  IconApps,
} from "../ui/icons"

// ── Registry ───────────────────────────────────────────────────────────────

export type ContextPanelId =
  | "tabs"
  | "history"
  | "skills"
  | "knowledge"
  | "packs"
  | "board"
  | "mcp"
  | "apps"
  | "meeting"

export type ContextPanelTabDef = {
  id: ContextPanelId
  label: string
  Icon: ComponentType<{ size?: number }>
}

/** Canonical panel registry (labels + icons). Strip and Host share this. */
export const CONTEXT_PANEL_TABS: ContextPanelTabDef[] = [
  { id: "tabs", label: "标签", Icon: IconTabs },
  { id: "history", label: "历史", Icon: IconHistory },
  { id: "skills", label: "技能", Icon: IconSkills },
  { id: "knowledge", label: "知识", Icon: IconKnowledge },
  { id: "packs", label: "场景", Icon: IconSkills },
  { id: "meeting", label: "会议", Icon: IconSkills },
  { id: "board", label: "任务板", Icon: IconSkills },
  { id: "mcp", label: "MCP", Icon: IconMcp },
  { id: "apps", label: "应用", Icon: IconApps },
]

const KNOWN_IDS = new Set(CONTEXT_PANEL_TABS.map((t) => t.id))

export function isContextPanelId(id: string): id is ContextPanelId {
  return KNOWN_IDS.has(id as ContextPanelId)
}

export function contextPanelLabel(id: ContextPanelId): string {
  return CONTEXT_PANEL_TABS.find((t) => t.id === id)?.label ?? id
}

// ── Loaders ────────────────────────────────────────────────────────────────

export function loadPanelData(
  id: ContextPanelId,
  activeThreadId: string | null,
  dispatch: ReturnType<typeof useAgentStore>["dispatch"],
) {
  if (id === "tabs") {
    chrome.tabs.query({}, (tabs) => {
      dispatch({ type: "SET_TAB_LIST", tabs })
    })
  }
  if (id === "history") {
    chrome.runtime.sendMessage({ type: "history.query", limit: 50, thread_id: activeThreadId })
  }
  if (id === "skills") {
    // Force rescan when opening Skills — picks up Finder drops / external edits
    // even if mtime fingerprint was edge-case stale; cheap after ensureFresh path.
    chrome.runtime.sendMessage({ type: "skill.refresh" })
  }
  if (id === "knowledge") {
    chrome.runtime.sendMessage({ type: "knowledge.list" })
  }
  if (id === "packs") {
    chrome.runtime.sendMessage({ type: "pack.list" })
    chrome.runtime.sendMessage({ type: "modules.list" })
  }
  if (id === "mcp") {
    chrome.runtime.sendMessage({ type: "mcp.list" })
  }
  if (id === "apps") {
    chrome.runtime.sendMessage({ type: "apps.list" })
  }
}

// ── Host API context ───────────────────────────────────────────────────────

export type ContextPanelHostApi = {
  activePanel: ContextPanelId | null
  /** Toggle: same id closes; different id opens + loads. */
  openPanel: (id: ContextPanelId) => void
  /** Force-open (no toggle) — used by slash / custom events. */
  openPanelForce: (id: ContextPanelId) => void
  closePanel: () => void
}

const ContextPanelHostContext = createContext<ContextPanelHostApi | null>(null)

export function useContextPanelHost(): ContextPanelHostApi {
  const ctx = useContext(ContextPanelHostContext)
  if (!ctx) {
    throw new Error("useContextPanelHost must be used within ContextPanelHostProvider")
  }
  return ctx
}

/** Soft read for optional chrome that may render outside provider in tests. */
export function useContextPanelHostOptional(): ContextPanelHostApi | null {
  return useContext(ContextPanelHostContext)
}

// ── Provider ───────────────────────────────────────────────────────────────

export function ContextPanelHostProvider({
  capabilityLevel,
  children,
}: {
  capabilityLevel: CapabilityLevel
  children: ReactNode
}) {
  const [activePanel, setActivePanel] = useState<ContextPanelId | null>(null)
  const pendingKnowledgeFocus = useRef<string | null>(null)
  const { state, dispatch } = useAgentStore()
  const activeThreadId = state.activeThreadId

  const allowedIds = useMemo(
    () => new Set(contextBarTabsForLevel(capabilityLevel)),
    [capabilityLevel],
  )
  const overflowIds = useMemo(
    () => contextBarOverflowTabsForLevel(capabilityLevel),
    [capabilityLevel],
  )

  const closePanel = useCallback(() => {
    setActivePanel(null)
  }, [])

  const openPanelForce = useCallback(
    (id: ContextPanelId) => {
      setActivePanel(id)
      loadPanelData(id, activeThreadId, dispatch)
    },
    [activeThreadId, dispatch],
  )

  const openPanel = useCallback(
    (id: ContextPanelId) => {
      if (activePanel === id) {
        setActivePanel(null)
        return
      }
      setActivePanel(id)
      loadPanelData(id, activeThreadId, dispatch)
    },
    [activePanel, activeThreadId, dispatch],
  )

  // Close open panel if it is no longer primary or overflow for this level
  useEffect(() => {
    if (activePanel == null) return
    if (!allowedIds.has(activePanel) && !overflowIds.includes(activePanel)) {
      setActivePanel(null)
    }
  }, [activePanel, allowedIds, overflowIds])

  // S1: slash meta commands (/packs /board /mcp) open panels via soft event
  useEffect(() => {
    const onOpen = (e: Event) => {
      const raw = (e as CustomEvent<{ panel?: string }>).detail?.panel
      if (!raw || !isContextPanelId(raw)) return
      setActivePanel(raw)
      loadPanelData(raw, activeThreadId, dispatch)
    }
    window.addEventListener("cmspark:open-context-panel", onOpen as EventListener)
    const onKnowledge = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (id) pendingKnowledgeFocus.current = id
      setActivePanel("knowledge")
      loadPanelData("knowledge", activeThreadId, dispatch)
    }
    window.addEventListener("cmspark:open-knowledge", onKnowledge as EventListener)
    const onGraphDoc = (msg: { type?: string; id?: string }) => {
      if (msg?.type !== "knowledge_graph.doc_selected" || !msg.id) return
      pendingKnowledgeFocus.current = msg.id
      setActivePanel("knowledge")
      loadPanelData("knowledge", activeThreadId, dispatch)
    }
    chrome.runtime.onMessage.addListener(onGraphDoc)
    return () => {
      window.removeEventListener("cmspark:open-context-panel", onOpen as EventListener)
      window.removeEventListener("cmspark:open-knowledge", onKnowledge as EventListener)
      chrome.runtime.onMessage.removeListener(onGraphDoc)
    }
  }, [activeThreadId, dispatch])

  useEffect(() => {
    if (activePanel !== "knowledge") return
    const id = pendingKnowledgeFocus.current
    if (!id) return
    pendingKnowledgeFocus.current = null
    window.dispatchEvent(new CustomEvent("cmspark:focus-knowledge", { detail: { id } }))
  }, [activePanel])

  // Esc collapses any open context panel (priority stack §4.9 layer 2)
  useEffect(() => {
    if (!activePanel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      e.preventDefault()
      setActivePanel(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activePanel])

  const api = useMemo<ContextPanelHostApi>(
    () => ({ activePanel, openPanel, openPanelForce, closePanel }),
    [activePanel, openPanel, openPanelForce, closePanel],
  )

  return (
    <ContextPanelHostContext.Provider value={api}>
      {children}
    </ContextPanelHostContext.Provider>
  )
}

// ── Panel body mount ───────────────────────────────────────────────────────

/**
 * Renders the open context panel body (header + body). Place above ComposerDock
 * (strip optional via ui.bottomBarStrip; Host is SoT regardless).
 */
export function ContextPanelHost() {
  const { activePanel, closePanel } = useContextPanelHost()
  if (!activePanel) return null

  const label = contextPanelLabel(activePanel)

  return (
    <div style={styles.panel} data-testid="context-panel-host">
      <div style={styles.panelHeader}>
        <span style={styles.panelTitle}>{label}</span>
        <button
          type="button"
          style={styles.panelCloseBtn}
          title="收起面板 (Esc)"
          aria-label="收起面板"
          onClick={closePanel}
        >
          收起
        </button>
      </div>
      {activePanel === "tabs" && <TabsPanel />}
      {activePanel === "history" && <HistoryPanel />}
      {activePanel === "skills" && <SkillsPanel />}
      {activePanel === "knowledge" && <KnowledgeSubPanel />}
      {activePanel === "packs" && <PacksPanel />}
      {activePanel === "meeting" && (
        <MeetingPanel
          onClose={closePanel}
          onSendToDraft={(text) => {
            window.dispatchEvent(
              new CustomEvent("cmspark:fill-composer", { detail: { text } }),
            )
            closePanel()
          }}
        />
      )}
      {activePanel === "board" && <BoardPanel />}
      {activePanel === "mcp" && <McpPanel />}
      {activePanel === "apps" && <AppsPanel />}
    </div>
  )
}

// ── Built-in panel bodies (moved from BottomBar) ───────────────────────────

function TabsPanel() {
  const { state, dispatch } = useAgentStore()

  const handleTogglePin = (tabId: number) => {
    const pinnedTabIds = state.pinnedTabIds.includes(tabId)
      ? state.pinnedTabIds.filter((id) => id !== tabId)
      : [...state.pinnedTabIds, tabId]

    dispatch({ type: "SET_PINNED_TABS", tabIds: pinnedTabIds })

    if (state.activeThreadId) {
      chrome.runtime.sendMessage({
        type: "thread.update",
        threadId: state.activeThreadId,
        updates: { pinned_tabs: pinnedTabIds },
      })
    }
  }

  return (
    <div style={styles.panelContent}>
      {state.tabList.length === 0 && (
        <div style={styles.emptyText}>暂无标签页数据</div>
      )}
      {state.tabList.map((tab) => (
        <label key={tab.id} style={styles.tabRow}>
          <input
            type="checkbox"
            checked={state.pinnedTabIds.includes(tab.id!)}
            onChange={() => handleTogglePin(tab.id!)}
            style={{ marginRight: 8 }}
          />
          <span style={styles.tabTitle}>{tab.title || tab.url}</span>
          <span style={styles.tabUrl}>{tab.id}</span>
        </label>
      ))}
    </div>
  )
}

function HistoryPanel() {
  const { state } = useAgentStore()
  const operations = state.operations || []
  const groups = groupBy(operations, "thread_id")

  return (
    <div style={styles.panelContent}>
      {state.operations.length === 0 && (
        <div style={styles.emptyText}>暂无操作历史</div>
      )}
      {Object.entries(groups).map(([threadId, ops]) => (
        <div key={threadId} style={{ marginBottom: 8 }}>
          <div style={styles.groupHeader}>#{threadId}</div>
          {ops.map((op) => (
            <div key={op.id} style={styles.historyRow}>
              <span style={{ color: op.success ? tokens.success : tokens.danger }}>
                {op.success ? "✓" : "✗"}
              </span>
              <span style={{ flex: 1, marginLeft: 6, fontFamily: "monospace", fontSize: 11 }}>
                {op.tool_name}
              </span>
              <span style={{ color: tokens.textMuted, fontSize: 11 }}>
                {op.created_at?.slice(11, 19)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function SkillsPanel() {
  const { state, dispatch } = useAgentStore()
  const [importUrl, setImportUrl] = useState("")
  const [showUrlImport, setShowUrlImport] = useState(false)
  const [showPathImport, setShowPathImport] = useState(false)
  const [pathInput, setPathInput] = useState("")
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [currentHostname, setCurrentHostname] = useState<string>("")
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url
      if (url) {
        try {
          setCurrentHostname(new URL(url).hostname)
        } catch {
          setCurrentHostname("")
        }
      }
    })
  }, [state.tabList])

  const handleModeChange = (mode: "auto" | "all" | "manual") => {
    dispatch({ type: "SET_SKILL_SELECTION_MODE", mode })
    if (state.activeThreadId) {
      chrome.runtime.sendMessage({
        type: "thread.update",
        threadId: state.activeThreadId,
        updates: { skill_selection_mode: mode },
      })
    }
  }

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [menuOpen])

  const handleFolderFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    if (fileArr.length === 0) return

    const hasSkillMd = fileArr.some(
      (f) => f.name === "SKILL.md" || f.webkitRelativePath.endsWith("/SKILL.md"),
    )
    if (!hasSkillMd) {
      alert("文件夹中未找到 SKILL.md 文件")
      return
    }

    const payload: { path: string; content: string }[] = []
    for (const file of fileArr) {
      const content = await file.text()
      const filePath = file.webkitRelativePath || file.name
      const parts = filePath.split("/")
      const relPath = parts.length > 1 ? parts.slice(1).join("/") : parts[0]
      payload.push({ path: relPath, content })
    }

    chrome.runtime.sendMessage({ type: "skill.import-files", files: payload })
  }

  const handlePathImport = () => {
    if (pathInput.trim()) {
      chrome.runtime.sendMessage({ type: "skill.import-path", dir_path: pathInput.trim() })
      setPathInput("")
      setShowPathImport(false)
    }
  }

  const handleExport = (skillName: string) => {
    chrome.runtime.sendMessage({ type: "skill.export", skill_name: skillName })
    setMenuOpen(null)
  }

  const handleDelete = (skillName: string) => {
    if (confirm(`确定删除技能 "${skillName}"？`)) {
      chrome.runtime.sendMessage({ type: "skill.delete", skill_name: skillName })
    }
    setMenuOpen(null)
  }

  const handleImportFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const content = reader.result as string
      chrome.runtime.sendMessage({ type: "skill.import", content })
    }
    reader.readAsText(file)
  }

  const handleImportZip = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(",")[1]
      if (base64) {
        chrome.runtime.sendMessage({ type: "skill.import-folder", zip_data: base64 })
      }
    }
    reader.readAsDataURL(file)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()

    const items = e.dataTransfer.items
    if (items && items.length > 0) {
      const entry = items[0].webkitGetAsEntry()
      if (entry && entry.isDirectory) {
        const files = await readDirectoryEntry(entry as FileSystemDirectoryEntry)
        if (files.length > 0) {
          handleFolderFiles(files)
        }
        return
      }
    }

    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.name.endsWith(".zip")) {
      handleImportZip(file)
    } else if (file.name.endsWith(".md") || file.name.endsWith(".markdown")) {
      handleImportFile(file)
    }
  }

  const handleUrlImport = () => {
    if (importUrl.trim()) {
      chrome.runtime.sendMessage({ type: "skill.import", url: importUrl.trim() })
      setImportUrl("")
      setShowUrlImport(false)
    }
  }

  const skillList = Array.isArray(state.skills) ? state.skills : []
  const groupedSkills = groupSkillsBySite(skillList, currentHostname)

  const modeLabels: Record<string, string> = { auto: "自动", all: "全选", manual: "按需" }
  const skillMode = state.skillSelectionMode || "auto"
  const skillManual = skillMode === "manual"
  const skillModeHint =
    skillMode === "auto"
      ? "自动：按站点/消息匹配技能，列表勾选不生效（未勾选 ≠ 不会调用）。"
      : skillMode === "all"
        ? "全选：全部技能参与索引，无需单独勾选。"
        : "按需：仅勾选的技能会参与本对话。"

  return (
    <div style={styles.panelContent}>
      <div style={styles.modeSwitcher}>
        {(["auto", "all", "manual"] as const).map((mode) => (
          <button
            key={mode}
            style={{
              ...styles.modeBtn,
              background: skillMode === mode ? tokens.accent : tokens.bgElevated,
              color: skillMode === mode ? "#fff" : tokens.textSecondary,
              borderColor: skillMode === mode ? tokens.accent : tokens.border,
            }}
            onClick={() => handleModeChange(mode)}
            title={
              mode === "auto"
                ? "自动匹配当前站点和消息"
                : mode === "all"
                  ? "注入所有技能索引"
                  : "仅使用勾选技能"
            }
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>
      <div
        style={{
          fontSize: 10,
          color: tokens.textMuted,
          lineHeight: 1.4,
          marginBottom: 8,
        }}
      >
        {skillModeHint}
      </div>

      <div
        style={{
          fontSize: 10,
          color: tokens.textSecondary,
          lineHeight: 1.4,
          marginBottom: 8,
          padding: "6px 8px",
          background: tokens.accentSoft,
          borderRadius: tokens.radiusSm,
          border: `1px solid ${tokens.border}`,
        }}
      >
        <strong style={{ color: tokens.accentText }}>安装技能（推荐）</strong>
        <div style={{ marginTop: 3 }}>
          GitHub 仓库：下载 ZIP → <strong>导入 ZIP</strong>；或解压后用{" "}
          <strong>导入文件夹</strong>。单文件 skill 用「导入」.md。
        </div>
        <div style={{ marginTop: 3, color: tokens.textMuted }}>
          勿用「场景」里的「应用安全审查」装技能 — 那会限制本对话工具。
        </div>
      </div>

      <div style={styles.skillToolbar}>
        <button
          style={styles.skillToolbarBtn}
          onClick={() => chrome.runtime.sendMessage({ type: "skill.refresh" })}
          title="重新扫描技能目录（含 ~/.cmspark-agent/skills 外部变更）"
        >
          ↻ 刷新
        </button>
        <button
          style={styles.skillToolbarBtn}
          onClick={() => fileInputRef.current?.click()}
          title="从文件导入 .md"
        >
          📁 导入
        </button>
        <button
          style={styles.skillToolbarBtn}
          onClick={() => zipInputRef.current?.click()}
          title="从 ZIP 导入文件夹技能"
        >
          📦 导入 ZIP
        </button>
        <button
          style={styles.skillToolbarBtn}
          onClick={() => setShowPathImport(!showPathImport)}
          title="从文件夹导入"
        >
          📂 导入文件夹
        </button>
        <button
          style={styles.skillToolbarBtn}
          onClick={() => setShowUrlImport(!showUrlImport)}
          title="从 URL 导入"
        >
          🔗 URL
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImportFile(file)
          }}
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImportZip(file)
          }}
        />
      </div>

      {showUrlImport && (
        <div style={styles.urlImportRow}>
          <input
            style={styles.urlImportInput}
            type="url"
            placeholder="https://...skill.md"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUrlImport()}
          />
          <button style={styles.skillToolbarBtn} onClick={handleUrlImport}>
            安装
          </button>
        </div>
      )}

      {showPathImport && (
        <div style={styles.urlImportRow}>
          <input
            style={styles.urlImportInput}
            type="text"
            placeholder="~/.claude/skills/datayes-api-search 或绝对路径"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handlePathImport()}
          />
          <button style={styles.skillToolbarBtn} onClick={handlePathImport}>
            导入
          </button>
        </div>
      )}

      <div
        style={styles.dropZone}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {skillList.length === 0 && (
          <div style={styles.emptyText}>暂无技能，拖拽 .md 文件或点击导入</div>
        )}
      </div>

      {groupedSkills.map(([groupName, skills]) => (
        <div key={groupName}>
          <div style={styles.groupHeader}>{groupName}</div>
          {skills.map((skill) => {
            const active = state.activeSkillIds.includes(skill.name)
            return (
              <div
                key={skill.name}
                style={{
                  ...styles.skillRow,
                  background: skillManual && active ? tokens.bgActive : "transparent",
                }}
              >
                {skillManual ? (
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => {
                      const activeSkillIds = active
                        ? state.activeSkillIds.filter((id) => id !== skill.name)
                        : [...state.activeSkillIds, skill.name]
                      dispatch({ type: "TOGGLE_SKILL", skillId: skill.name })
                      if (state.activeThreadId) {
                        chrome.runtime.sendMessage({
                          type: "thread.update",
                          threadId: state.activeThreadId,
                          updates: { active_skill_ids: activeSkillIds },
                        })
                      }
                    }}
                    style={{ marginRight: 8, flexShrink: 0 }}
                    title="勾选后参与本对话"
                  />
                ) : (
                  <span
                    style={{
                      width: 16,
                      textAlign: "center",
                      color: tokens.textMuted,
                      fontSize: 11,
                      flexShrink: 0,
                      marginRight: 4,
                    }}
                    title={
                      skillMode === "all"
                        ? "全选模式：全部参与索引"
                        : "自动模式：由匹配决定，与勾选无关"
                    }
                    aria-hidden
                  >
                    {skillMode === "all" ? "◎" : "◇"}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {skill.name}
                    {skill.site && <span style={styles.siteBadge}>{skill.site}</span>}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: tokens.textSecondary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {skill.description}
                  </div>
                </div>
                {skill.builtin && <span style={styles.badge}>内置</span>}
                {!skill.builtin && (
                  <div
                    style={{ position: "relative" }}
                    ref={menuOpen === skill.name ? menuRef : undefined}
                  >
                    <button
                      style={styles.menuBtn}
                      onClick={() => setMenuOpen(menuOpen === skill.name ? null : skill.name)}
                      title="更多操作"
                    >
                      ···
                    </button>
                    {menuOpen === skill.name && (
                      <div style={styles.menuDropdown}>
                        <button style={styles.menuItem} onClick={() => handleExport(skill.name)}>
                          📤 导出
                        </button>
                        <button
                          style={{ ...styles.menuItem, color: tokens.danger }}
                          onClick={() => handleDelete(skill.name)}
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function readDirectoryEntry(dirEntry: FileSystemDirectoryEntry): Promise<File[]> {
  const files: File[] = []
  const folderName = dirEntry.name

  async function readDir(entry: FileSystemDirectoryEntry, prefix: string): Promise<void> {
    const reader = entry.createReader()
    const readBatch = (): Promise<FileSystemEntry[]> => {
      return new Promise((resolve) => {
        reader.readEntries((entries) => resolve(entries))
      })
    }

    let batch = await readBatch()
    while (batch.length > 0) {
      for (const e of batch) {
        if (e.isFile) {
          const file = await new Promise<File>((resolve) => {
            ;(e as FileSystemFileEntry).file(resolve)
          })
          ;(file as File & { webkitRelativePath: string }).webkitRelativePath = prefix + e.name
          files.push(file)
        } else if (e.isDirectory) {
          await readDir(e as FileSystemDirectoryEntry, prefix + e.name + "/")
        }
      }
      batch = await readBatch()
    }
  }

  await readDir(dirEntry, folderName + "/")
  return files
}

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce(
    (acc, item) => {
      const k = String(item[key] ?? "unknown")
      if (!acc[k]) acc[k] = []
      acc[k].push(item)
      return acc
    },
    {} as Record<string, T[]>,
  )
}

type SkillListItem = {
  name: string
  description?: string
  site?: string
  builtin?: boolean
}

function groupSkillsBySite(
  skills: SkillListItem[],
  currentHostname: string,
): [string, SkillListItem[]][] {
  const list = Array.isArray(skills) ? skills : []
  const globalSkills = list.filter((s) => !s.site)
  const siteGroups = new Map<string, SkillListItem[]>()
  for (const skill of list.filter((s) => s.site)) {
    const key = skill.site!
    if (!siteGroups.has(key)) siteGroups.set(key, [])
    siteGroups.get(key)!.push(skill)
  }
  const result: [string, SkillListItem[]][] = []
  if (globalSkills.length > 0) {
    result.push(["全局", globalSkills])
  }
  const sortedSites = Array.from(siteGroups.entries()).sort((a, b) => {
    const aMatch = currentHostname && matchesSite(a[0], currentHostname) ? -1 : 0
    const bMatch = currentHostname && matchesSite(b[0], currentHostname) ? -1 : 0
    if (aMatch !== bMatch) return aMatch - bMatch
    return a[0].localeCompare(b[0])
  })
  for (const [site, siteSkills] of sortedSites) {
    result.push([site, siteSkills])
  }
  return result
}

function matchesSite(pattern: string, hostname: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2)
    return hostname === suffix || hostname.endsWith("." + suffix)
  }
  return hostname === pattern
}

// ── Styles (panel body only) ───────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    borderTop: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    // Apps「添加应用」needs room for search + policy + short list
    maxHeight: 320,
    overflowY: "auto",
    flexShrink: 0,
  },
  panelHeader: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "6px 12px",
    background: tokens.bgElevated,
    borderBottom: `1px solid ${tokens.border}`,
  },
  panelTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: tokens.text,
    fontFamily: tokens.font,
  },
  panelCloseBtn: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusPill,
    background: tokens.bgMuted,
    color: tokens.textSecondary,
    fontSize: 11,
    fontWeight: 500,
    padding: "3px 10px",
    cursor: "pointer",
    fontFamily: tokens.font,
    flexShrink: 0,
  },
  panelContent: {
    padding: "10px 12px",
  },
  emptyText: {
    color: tokens.textSecondary,
    fontSize: 12,
    textAlign: "center",
    padding: 12,
  },
  tabRow: {
    display: "flex",
    alignItems: "center",
    padding: "3px 0",
    cursor: "pointer",
    fontSize: 12,
  },
  tabTitle: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tabUrl: {
    color: tokens.textMuted,
    fontSize: 10,
    fontFamily: tokens.fontMono,
  },
  groupHeader: {
    fontSize: 11,
    fontWeight: 600,
    fontFamily: tokens.fontMono,
    color: tokens.accent,
    marginBottom: 2,
  },
  historyRow: {
    display: "flex",
    alignItems: "center",
    padding: "2px 0",
  },
  skillRow: {
    display: "flex",
    alignItems: "center",
    padding: "6px 0",
    borderBottom: `1px solid ${tokens.bgMuted}`,
  },
  badge: {
    fontSize: 10,
    background: tokens.bgMuted,
    color: tokens.textSecondary,
    padding: "1px 6px",
    borderRadius: tokens.radiusSm,
  },
  skillToolbar: {
    display: "flex",
    gap: 6,
    marginBottom: 8,
  },
  skillToolbarBtn: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    background: tokens.bgElevated,
    padding: "3px 10px",
    fontSize: 11,
    cursor: "pointer",
  },
  urlImportRow: {
    display: "flex",
    gap: 4,
    marginBottom: 8,
  },
  urlImportInput: {
    flex: 1,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    padding: "4px 8px",
    fontSize: 11,
    fontFamily: tokens.fontMono,
    outline: "none",
  },
  dropZone: {
    minHeight: 24,
  },
  menuBtn: {
    background: "none",
    border: "none",
    fontSize: 14,
    cursor: "pointer",
    padding: "0 4px",
    color: tokens.textMuted,
  },
  menuDropdown: {
    position: "absolute",
    right: 0,
    top: "100%",
    background: tokens.bgElevated,
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: tokens.radiusMenu,
    boxShadow: tokens.shadowLg,
    zIndex: 10,
    overflow: "hidden",
    padding: 4,
    minWidth: 120,
  },
  menuItem: {
    display: "block",
    width: "100%",
    border: "none",
    background: "transparent",
    borderRadius: tokens.radiusMd,
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left" as const,
    whiteSpace: "nowrap" as const,
    color: tokens.text,
    fontFamily: tokens.font,
  },
  modeSwitcher: {
    display: "flex",
    gap: 0,
    marginBottom: 8,
    borderRadius: tokens.radiusSm,
    overflow: "hidden",
    border: `1px solid ${tokens.border}`,
  },
  modeBtn: {
    flex: 1,
    border: "none",
    borderRight: `1px solid ${tokens.border}`,
    padding: "4px 0",
    fontSize: 11,
    cursor: "pointer",
    background: tokens.bgElevated,
  },
  siteBadge: {
    fontSize: 9,
    background: tokens.accentSoft,
    color: tokens.accentText,
    padding: "0px 4px",
    borderRadius: tokens.radiusSm,
    fontWeight: 400,
  },
}
