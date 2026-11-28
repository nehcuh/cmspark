import { useEffect, useRef, useState } from "react"
import { useSiteGroups } from "../hooks/useSiteGroups"
import { useAgentStore } from "../store/agentStore"
import { contextPanelLabel, useContextPanelHost } from "./ContextPanelHost"
import { KnowledgeSubPanel } from "./KnowledgeSubPanel"
import { McpPanel } from "./McpPanel"
import { AppsPanel } from "./AppsPanel"
import { PacksPanel } from "./PacksPanel"
import { BoardPanel } from "./BoardPanel"
import { MeetingPanel } from "./MeetingPanel"
import { tokens } from "../ui/tokens"

/**
 * Renders the open context panel body (header + body). Place above ComposerDock
 * (Host is SoT for panels).
 */
export function ContextPanelBody() {
  const { activePanel, closePanel, registerBeforeClose } = useContextPanelHost()
  const meetingCaptureActive = useAgentStore().state.meetingCaptureActive
  const panelRef = useRef<HTMLDivElement>(null)
  // A mounted context panel can be hidden behind conversation management.
  useEffect(() => {
    if (!activePanel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !panelRef.current?.getClientRects().length) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      e.preventDefault()
      closePanel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activePanel, closePanel])

  if (!activePanel) return null

  const label = contextPanelLabel(activePanel)
  const closeEndsMeeting = activePanel === "meeting" && meetingCaptureActive

  return (
    <div ref={panelRef} className="cm-context-panel" style={styles.panel} data-testid="context-panel-host">
      <div style={styles.panelHeader}>
        <span style={styles.panelTitle}>{label}</span>
        {closeEndsMeeting ? (
          <button
            type="button"
            style={styles.panelCloseBtn}
            title="结束并收起"
            aria-label="结束并收起"
            onClick={closePanel}
          >
            结束并收起
          </button>
        ) : (
          <button
            type="button"
            style={styles.panelCloseBtn}
            title="收起面板 (Esc)"
            aria-label="收起面板"
            onClick={closePanel}
          >
            收起
          </button>
        )}
      </div>
      {activePanel === "tabs" && <TabsPanel />}
      {activePanel === "history" && <HistoryPanel />}
      {activePanel === "skills" && <SkillsPanel />}
      {activePanel === "knowledge" && <KnowledgeSubPanel />}
      {activePanel === "packs" && <PacksPanel />}
      {activePanel === "meeting" && (
        <MeetingPanel
          onClose={closePanel}
          registerBeforeClose={registerBeforeClose}
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
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

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
  const groupedSkills = useSiteGroups(skillList)

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
    fontSize: 15,
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
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },
  skillToolbarBtn: {
    whiteSpace: "nowrap",
    minHeight: 32,
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
