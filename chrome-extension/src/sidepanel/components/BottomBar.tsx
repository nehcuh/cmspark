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
            if (tab.id === "history") {
              chrome.runtime.sendMessage({ type: "history.query", limit: 50, thread_id: state.activeThreadId })
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
            onChange={() => dispatch({ type: "TOGGLE_PIN_TAB", tabId: tab.id! })}
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
  const groups = groupBy(state.operations, "thread_id")

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
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = (skillName: string) => {
    chrome.runtime.sendMessage({ type: "skill.export", skill_name: skillName }, (response) => {
      if (response?.content) {
        const blob = new Blob([response.content], { type: "text/markdown" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `${skillName}.md`
        a.click()
        URL.revokeObjectURL(url)
      }
    })
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith(".md")) {
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
            onChange={() => dispatch({ type: "TOGGLE_SKILL", skillId: skill.name })}
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
