// Bottom context bar: Tabs, History, Skills panels (mode-split by capability level)

import { useState, useRef, useEffect, useMemo, type ComponentType } from "react"
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
import { tokens } from "../ui/tokens"
import {
  IconTabs,
  IconHistory,
  IconSkills,
  IconKnowledge,
  IconMcp,
  IconApps,
  IconMore,
} from "../ui/icons"

type Panel = "tabs" | "history" | "skills" | "knowledge" | "packs" | "board" | "mcp" | "apps"

type TabDef = {
  id: Panel
  label: string
  Icon: ComponentType<{ size?: number }>
}

const ALL_TABS: TabDef[] = [
  { id: "tabs", label: "标签", Icon: IconTabs },
  { id: "history", label: "历史", Icon: IconHistory },
  { id: "skills", label: "技能", Icon: IconSkills },
  { id: "knowledge", label: "知识", Icon: IconKnowledge },
  { id: "packs", label: "任务包", Icon: IconSkills },
  { id: "board", label: "任务板", Icon: IconSkills },
  { id: "mcp", label: "MCP", Icon: IconMcp },
  { id: "apps", label: "应用", Icon: IconApps },
]

function loadPanelData(id: Panel, activeThreadId: string | null, dispatch: ReturnType<typeof useAgentStore>["dispatch"]) {
  if (id === "tabs") {
    chrome.tabs.query({}, (tabs) => {
      dispatch({ type: "SET_TAB_LIST", tabs })
    })
  }
  if (id === "history") {
    chrome.runtime.sendMessage({ type: "history.query", limit: 50, thread_id: activeThreadId })
  }
  if (id === "skills") {
    chrome.runtime.sendMessage({ type: "skill.list" })
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

export function BottomBar({ capabilityLevel }: { capabilityLevel: CapabilityLevel }) {
  const [activePanel, setActivePanel] = useState<Panel | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  /** Fixed menu position (viewport coords) — avoids overflow clip + InputArea paint order. */
  const [moreMenuPos, setMoreMenuPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const { state, dispatch } = useAgentStore()

  const allowedIds = useMemo(
    () => new Set(contextBarTabsForLevel(capabilityLevel)),
    [capabilityLevel],
  )
  const overflowIds = useMemo(
    () => contextBarOverflowTabsForLevel(capabilityLevel),
    [capabilityLevel],
  )
  const tabs = useMemo(
    () => ALL_TABS.filter((t) => allowedIds.has(t.id)),
    [allowedIds],
  )
  const overflowTabs = useMemo(
    () => ALL_TABS.filter((t) => overflowIds.includes(t.id)),
    [overflowIds],
  )

  // L2 Panel: no permanent ContextBar (Cockpit owns power tools). Overflow still
  // available only if user needs packs/board edge access — keep a thin more menu.
  const isL2 = capabilityLevel === "computer"

  // Close open panel if it is no longer primary or overflow for this level
  useEffect(() => {
    if (activePanel == null) return
    if (!allowedIds.has(activePanel) && !overflowIds.includes(activePanel)) {
      setActivePanel(null)
      setMoreOpen(false)
    }
  }, [activePanel, allowedIds, overflowIds])

  // S1: slash meta commands (/packs /board /mcp) open panels via soft event
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ panel?: string }>).detail?.panel as Panel | undefined
      if (!id) return
      const known = ALL_TABS.some((t) => t.id === id)
      if (!known) return
      setActivePanel(id)
      setMoreOpen(false)
      loadPanelData(id, state.activeThreadId, dispatch)
    }
    window.addEventListener("cmspark:open-context-panel", onOpen as EventListener)
    return () => window.removeEventListener("cmspark:open-context-panel", onOpen as EventListener)
  }, [state.activeThreadId, dispatch])

  const computeMoreMenuPos = (): { top: number; left: number; minWidth: number } | null => {
    const btn = moreBtnRef.current
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    // Open upward, right-aligned to the button; clamp within viewport.
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
    // Side panel height changes when chat scrolls — keep menu anchored
    window.addEventListener("scroll", onReposition, true)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reposition reads overflowTabs.length via closure when open
  }, [moreOpen, overflowTabs.length])

  const openPanel = (id: Panel) => {
    if (activePanel === id) {
      setActivePanel(null)
      setMoreOpen(false)
      return
    }
    setActivePanel(id)
    setMoreOpen(false)
    loadPanelData(id, state.activeThreadId, dispatch)
  }

  // Fixed-position menu: escapes overflow + paints above InputArea (z-index 1000).
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
              onClick={() => openPanel(tab.id)}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
    ) : null

  const moreBtnActive =
    moreOpen || (activePanel != null && !allowedIds.has(activePanel))

  // L2 with no primary tabs and collapsed more: hide entire bar to free vertical space
  if (isL2 && tabs.length === 0 && !activePanel && !moreOpen) {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.tabs, justifyContent: "flex-end" }}>
          <div ref={moreRef} style={styles.moreAnchor}>
            <button
              ref={moreBtnRef}
              type="button"
              style={styles.moreBtn}
              title="更多面板（任务包 / 任务板等）"
              aria-expanded={moreOpen}
              onClick={toggleMore}
            >
              <IconMore size={14} />
              <span>更多</span>
            </button>
          </div>
        </div>
        {moreMenuEl}
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.tabs}>
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
                  borderColor: active ? "#bfdbfe" : "transparent",
                  boxShadow: active ? tokens.shadowSm : "none",
                }}
                onClick={() => openPanel(tab.id)}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
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
                      borderColor: "#bfdbfe",
                    }
                  : {}),
              }}
              title="任务包、任务板等低频入口"
              aria-expanded={moreOpen}
              onClick={toggleMore}
            >
              <IconMore size={14} />
              <span>更多</span>
            </button>
          </div>
        )}
      </div>
      {moreMenuEl}

      {activePanel && (
        <div style={styles.panel}>
          {activePanel === "tabs" && <TabsPanel />}
          {activePanel === "history" && <HistoryPanel />}
          {activePanel === "skills" && <SkillsPanel />}
          {activePanel === "knowledge" && <KnowledgeSubPanel />}
          {activePanel === "packs" && <PacksPanel />}
          {activePanel === "board" && <BoardPanel />}
          {activePanel === "mcp" && <McpPanel />}
          {activePanel === "apps" && <AppsPanel />}
        </div>
      )}
    </div>
  )
}

function TabsPanel() {
  const { state, dispatch } = useAgentStore()

  const handleTogglePin = (tabId: number) => {
    const pinnedTabIds = state.pinnedTabIds.includes(tabId)
      ? state.pinnedTabIds.filter(id => id !== tabId)
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
      {state.tabList.map(tab => (
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
          {ops.map(op => (
            <div key={op.id} style={styles.historyRow}>
              <span style={{ color: op.success ? tokens.success : tokens.danger }}>
                {op.success ? "✓" : "✗"}
              </span>
              <span style={{ flex: 1, marginLeft: 6, fontFamily: "monospace", fontSize: 11 }}>
                {op.tool_name}
              </span>
              <span style={{ color: "#999", fontSize: 11 }}>
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

  // Get current tab hostname for site grouping
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url
      if (url) {
        try {
          const hostname = new URL(url).hostname
          setCurrentHostname(hostname)
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

  // Close dropdown when clicking outside
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

  // Read all files from a dropped/picked folder
  const handleFolderFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    if (fileArr.length === 0) return

    // Find SKILL.md among the files
    const hasSkillMd = fileArr.some(f => f.name === "SKILL.md" || f.webkitRelativePath.endsWith("/SKILL.md"))
    if (!hasSkillMd) {
      alert("文件夹中未找到 SKILL.md 文件")
      return
    }

    const payload: { path: string; content: string }[] = []
    for (const file of fileArr) {
      const content = await file.text()
      const filePath = file.webkitRelativePath || file.name
      // Strip leading folder name from webkitRelativePath
      const parts = filePath.split("/")
      const relPath = parts.length > 1 ? parts.slice(1).join("/") : parts[0]
      payload.push({ path: relPath, content })
    }

    chrome.runtime.sendMessage({ type: "skill.import-files", files: payload })
  }

  const handleFolderPick = () => {
    setShowPathImport(!showPathImport)
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
      // Strip "data:application/zip;base64," prefix
      const base64 = dataUrl.split(",")[1]
      if (base64) {
        chrome.runtime.sendMessage({ type: "skill.import-folder", zip_data: base64 })
      }
    }
    reader.readAsDataURL(file)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()

    // Check for folder drop via webkitGetAsEntry
    const items = e.dataTransfer.items
    if (items && items.length > 0) {
      const entry = items[0].webkitGetAsEntry()
      if (entry && entry.isDirectory) {
        const files = await readDirectoryEntry(entry as any)
        if (files.length > 0) {
          handleFolderFiles(files)
        }
        return
      }
    }

    // Regular file drop
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

  const handleFilePick = () => {
    fileInputRef.current?.click()
  }

  // Group skills by site, with current site first
  const skillList = Array.isArray(state.skills) ? state.skills : []
  const groupedSkills = groupSkillsBySite(skillList, currentHostname)

  const modeLabels: Record<string, string> = { auto: "自动", all: "全选", manual: "按需" }

  return (
    <div style={styles.panelContent}>
      {/* Mode switcher */}
      <div style={styles.modeSwitcher}>
        {(["auto", "all", "manual"] as const).map((mode) => (
          <button
            key={mode}
            style={{
              ...styles.modeBtn,
              background: state.skillSelectionMode === mode ? tokens.accent : tokens.bgElevated,
              color: state.skillSelectionMode === mode ? "#fff" : tokens.textSecondary,
              borderColor: state.skillSelectionMode === mode ? tokens.accent : tokens.border,
            }}
            onClick={() => handleModeChange(mode)}
            title={mode === "auto" ? "自动匹配当前站点和消息" : mode === "all" ? "注入所有技能索引" : "仅使用勾选技能"}
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>

      {/* Import toolbar */}
      <div style={styles.skillToolbar}>
        <button style={styles.skillToolbarBtn} onClick={handleFilePick} title="从文件导入 .md">
          📁 导入
        </button>
        <button style={styles.skillToolbarBtn} onClick={() => zipInputRef.current?.click()} title="从 ZIP 导入文件夹技能">
          📦 导入 ZIP
        </button>
        <button style={styles.skillToolbarBtn} onClick={handleFolderPick} title="从文件夹导入">
          📂 导入文件夹
        </button>
        <button style={styles.skillToolbarBtn} onClick={() => setShowUrlImport(!showUrlImport)} title="从 URL 导入">
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

      {/* URL import field */}
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
          <button style={styles.skillToolbarBtn} onClick={handleUrlImport}>安装</button>
        </div>
      )}

      {showPathImport && (
        <div style={styles.urlImportRow}>
          <input
            style={styles.urlImportInput}
            type="text"
            placeholder="~/.config/skills/slash-evaluate"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handlePathImport()}
          />
          <button style={styles.skillToolbarBtn} onClick={handlePathImport}>导入</button>
        </div>
      )}

      {/* Drop zone hint */}
      <div
        style={styles.dropZone}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {skillList.length === 0 && (
          <div style={styles.emptyText}>暂无技能，拖拽 .md 文件或点击导入</div>
        )}
      </div>

      {/* Grouped skill list */}
      {groupedSkills.map(([groupName, skills]) => (
        <div key={groupName}>
          <div style={styles.groupHeader}>{groupName}</div>
          {skills.map((skill) => (
            <div key={skill.name} style={{
              ...styles.skillRow,
              background: state.activeSkillIds.includes(skill.name) ? "#e8f0fe" : "transparent",
              opacity: state.skillSelectionMode === "all" ? 0.6 : 1,
            }}>
              <input
                type="checkbox"
                checked={state.activeSkillIds.includes(skill.name)}
                disabled={state.skillSelectionMode === "all"}
                onChange={() => {
                  const activeSkillIds = state.activeSkillIds.includes(skill.name)
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
                style={{ marginRight: 8 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                  {skill.name}
                  {skill.site && <span style={styles.siteBadge}>{skill.site}</span>}
                </div>
                <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {skill.description}
                </div>
              </div>
              {skill.builtin && <span style={styles.badge}>内置</span>}
              {!skill.builtin && (
                <div style={{ position: "relative" }} ref={menuOpen === skill.name ? menuRef : undefined}>
                  <button
                    style={styles.menuBtn}
                    onClick={() => setMenuOpen(menuOpen === skill.name ? null : skill.name)}
                    title="更多操作"
                  >
                    ···
                  </button>
                  {menuOpen === skill.name && (
                    <div style={styles.menuDropdown}>
                      <button style={styles.menuItem} onClick={() => handleExport(skill.name)}>📤 导出</button>
                      <button style={{ ...styles.menuItem, color: tokens.danger }} onClick={() => handleDelete(skill.name)}>删除</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// --- Helpers ---

// Recursively read files from a dropped directory entry
// Sets webkitRelativePath with folder name as prefix, consistent with file picker behavior
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
            (e as FileSystemFileEntry).file(resolve)
          })
          // Use folderName as prefix to match file picker webkitRelativePath format
          ;(file as any).webkitRelativePath = prefix + e.name
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

function base64ToBlob(base64: string, mimeType: string): Blob {
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = String(item[key] ?? "unknown")
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {} as Record<string, T[]>)
}

function groupSkillsBySite(skills: any[], currentHostname: string): [string, any[]][] {
  const list = Array.isArray(skills) ? skills : []
  const globalSkills = list.filter((s) => !s.site)
  const siteGroups = new Map<string, any[]>()
  for (const skill of list.filter((s) => s.site)) {
    const key = skill.site!
    if (!siteGroups.has(key)) siteGroups.set(key, [])
    siteGroups.get(key)!.push(skill)
  }
  const result: [string, any[]][] = []
  if (globalSkills.length > 0) {
    result.push(["全局", globalSkills])
  }
  // Sort: current hostname match first, then alphabetical
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

// --- Styles ---

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
  /** Primary tabs only — horizontal scroll; more button stays outside this box. */
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
    transition: "background 0.12s ease, color 0.12s ease",
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
  /** Viewport-fixed; top/left/minWidth set per open from button getBoundingClientRect. */
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
  panel: {
    borderTop: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    // Apps「添加应用」needs room for search + policy + short list; 200px buried
    // the policy row under an unfiltered candidate list (direct pick looked dead).
    maxHeight: 320,
    overflowY: "auto",
  },
  panelContent: {
    padding: "10px 12px",
  },
  emptyText: {
    color: tokens.textMuted,
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
    color: "#999",
    fontSize: 10,
    fontFamily: "monospace",
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
    borderRadius: 3,
  },
  skillToolbar: {
    display: "flex",
    gap: 6,
    marginBottom: 8,
  },
  skillToolbarBtn: {
    border: `1px solid ${tokens.border}`,
    borderRadius: 4,
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
    border: "1px solid #ddd",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 11,
    fontFamily: "monospace",
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
    color: "#999",
  },
  menuDropdown: {
    position: "absolute",
    right: 0,
    top: "100%",
    background: "#fff",
    border: "1px solid #e0e0e0",
    borderRadius: 6,
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    zIndex: 10,
    overflow: "hidden",
  },
  menuItem: {
    display: "block",
    width: "100%",
    border: "none",
    background: "#fff",
    padding: "6px 14px",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left" as const,
    whiteSpace: "nowrap" as const,
  },
  modeSwitcher: {
    display: "flex",
    gap: 0,
    marginBottom: 8,
    borderRadius: 4,
    overflow: "hidden",
    border: "1px solid #ddd",
  },
  modeBtn: {
    flex: 1,
    border: "none",
    borderRight: "1px solid #ddd",
    padding: "4px 0",
    fontSize: 11,
    cursor: "pointer",
    background: "#fff",
  },
  siteBadge: {
    fontSize: 9,
    background: "#e3f2fd",
    color: "#1976d2",
    padding: "0px 4px",
    borderRadius: 3,
    fontWeight: 400,
  },
}
