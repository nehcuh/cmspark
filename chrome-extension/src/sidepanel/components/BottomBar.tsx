// Bottom context bar: Tabs, History, Skills panels

import { useState, useRef } from "react"
import { useAgentStore } from "../store/agentStore"

type Panel = "tabs" | "history" | "skills"

export function BottomBar() {
  const [activePanel, setActivePanel] = useState<Panel | null>(null)
  const { state, dispatch } = useAgentStore()

  const tabs = [
    { id: "tabs" as const, label: "Tabs", icon: "📎" },
    { id: "history" as const, label: "Hist", icon: "📋" },
    { id: "skills" as const, label: "Skills", icon: "🧩" },
  ]

  return (
    <div style={styles.container}>
      <div style={styles.tabs}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            style={{
              ...styles.tabBtn,
              background: activePanel === tab.id ? "#e8f0fe" : "transparent",
              color: activePanel === tab.id ? "#4A90D9" : "#666",
            }}
            onClick={() => {
            if (activePanel === tab.id) { setActivePanel(null); return }
            setActivePanel(tab.id)
            if (tab.id === "tabs") {
              chrome.tabs.query({}, (tabs) => {
                dispatch({ type: "SET_TAB_LIST", tabs })
              })
            }
            if (tab.id === "history") {
              chrome.runtime.sendMessage({ type: "history.query", limit: 50, thread_id: state.activeThreadId })
            }
            if (tab.id === "skills") {
              chrome.runtime.sendMessage({ type: "skill.list" })
            }
          }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activePanel && (
        <div style={styles.panel}>
          {activePanel === "tabs" && <TabsPanel />}
          {activePanel === "history" && <HistoryPanel />}
          {activePanel === "skills" && <SkillsPanel />}
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
              <span style={{ color: op.success ? "#4CAF50" : "#F44336" }}>
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

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

  return (
    <div style={styles.panelContent}>
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
        {state.skills.length === 0 && (
          <div style={styles.emptyText}>暂无技能，拖拽 .md 文件或点击导入</div>
        )}
      </div>

      {/* Skill list */}
      {state.skills.map(skill => (
        <div key={skill.name} style={{
          ...styles.skillRow,
          background: state.activeSkillIds.includes(skill.name) ? "#e8f0fe" : "transparent",
        }}>
          <input
            type="checkbox"
            checked={state.activeSkillIds.includes(skill.name)}
            onChange={() => {
              const activeSkillIds = state.activeSkillIds.includes(skill.name)
                ? state.activeSkillIds.filter(id => id !== skill.name)
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
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{skill.name}</div>
            <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {skill.description}
            </div>
          </div>
          {skill.builtin && <span style={styles.badge}>内置</span>}
          {!skill.builtin && (
            <div style={{ position: "relative" }}>
              <button
                style={styles.menuBtn}
                onClick={() => setMenuOpen(menuOpen === skill.name ? null : skill.name)}
              >
                ···
              </button>
              {menuOpen === skill.name && (
                <div style={styles.menuDropdown}>
                  <button style={styles.menuItem} onClick={() => handleExport(skill.name)}>导出</button>
                  <button style={{ ...styles.menuItem, color: "#F44336" }} onClick={() => handleDelete(skill.name)}>删除</button>
                </div>
              )}
            </div>
          )}
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

// --- Styles ---

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderTop: "1px solid #eee",
    flexShrink: 0,
  },
  tabs: {
    display: "flex",
    gap: 4,
    padding: "4px 12px",
    borderBottom: "1px solid #f0f0f0",
  },
  tabBtn: {
    border: "none",
    borderRadius: 4,
    padding: "3px 10px",
    fontSize: 11,
    cursor: "pointer",
  },
  panel: {
    borderBottom: "1px solid #eee",
    maxHeight: 200,
    overflowY: "auto",
  },
  panelContent: {
    padding: "8px 12px",
  },
  emptyText: {
    color: "#999",
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
    fontFamily: "monospace",
    color: "#4A90D9",
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
    borderBottom: "1px solid #f5f5f5",
  },
  badge: {
    fontSize: 10,
    background: "#e0e0e0",
    color: "#666",
    padding: "1px 6px",
    borderRadius: 3,
  },
  skillToolbar: {
    display: "flex",
    gap: 6,
    marginBottom: 8,
  },
  skillToolbarBtn: {
    border: "1px solid #ddd",
    borderRadius: 4,
    background: "#fff",
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
}
