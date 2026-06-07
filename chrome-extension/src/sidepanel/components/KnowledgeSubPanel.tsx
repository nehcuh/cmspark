// Knowledge sub-panel: browse global and site knowledge docs

import { useState, useRef, useEffect } from "react"
import { useAgentStore } from "../store/agentStore"

export function KnowledgeSubPanel() {
  const { state, dispatch } = useAgentStore()
  const [importUrl, setImportUrl] = useState("")
  const [showUrlImport, setShowUrlImport] = useState(false)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const globalDocs = state.knowledgeDocs.filter(d => !d.site)
  const siteDocs = state.knowledgeDocs.filter(d => !!d.site)

  const handleDelete = (name: string) => {
    if (confirm(`确定删除知识文档 "${name}"？`)) {
      chrome.runtime.sendMessage({ type: "knowledge.delete", name })
    }
    setMenuOpen(null)
  }

  const handleImportFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const content = reader.result as string
      chrome.runtime.sendMessage({ type: "knowledge.import", content })
    }
    reader.readAsText(file)
  }

  const handleUrlImport = () => {
    if (importUrl.trim()) {
      chrome.runtime.sendMessage({ type: "knowledge.import", url: importUrl.trim() })
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
      <div style={styles.toolbar}>
        <button style={styles.toolbarBtn} onClick={handleFilePick} title="从文件导入 .md">
          导入文件
        </button>
        <button style={styles.toolbarBtn} onClick={() => setShowUrlImport(!showUrlImport)} title="从 URL 导入">
          导入 URL
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
            placeholder="https://...knowledge.md"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUrlImport()}
          />
          <button style={styles.toolbarBtn} onClick={handleUrlImport}>安装</button>
        </div>
      )}

      {/* Global knowledge */}
      <div style={styles.sectionHeader}>全局知识</div>
      {globalDocs.length === 0 && (
        <div style={styles.emptyText}>暂无全局知识文档</div>
      )}
      {globalDocs.map(doc => (
        <KnowledgeDocRow
          key={doc.name}
          doc={doc}
          menuOpen={menuOpen}
          menuRef={menuRef}
          onMenuToggle={setMenuOpen}
          onDelete={handleDelete}
        />
      ))}

      {/* Site knowledge */}
      {siteDocs.length > 0 && (
        <div style={styles.sectionHeader}>站点知识</div>
      )}
      {siteDocs.map(doc => (
        <KnowledgeDocRow
          key={doc.name}
          doc={doc}
          menuOpen={menuOpen}
          menuRef={menuRef}
          onMenuToggle={setMenuOpen}
          onDelete={handleDelete}
        />
      ))}
    </div>
  )
}

function KnowledgeDocRow({
  doc,
  menuOpen,
  menuRef,
  onMenuToggle,
  onDelete,
}: {
  doc: { name: string; description: string; site?: string; builtin: boolean }
  menuOpen: string | null
  menuRef: React.RefObject<HTMLDivElement>
  onMenuToggle: (name: string | null) => void
  onDelete: (name: string) => void
}) {
  return (
    <div style={styles.docRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{doc.name}</div>
        <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {doc.description}
        </div>
        {doc.site && (
          <div style={{ fontSize: 10, color: "#4A90D9", marginTop: 2 }}>
            {doc.site}
          </div>
        )}
      </div>
      {doc.builtin && <span style={styles.badge}>内置</span>}
      {!doc.builtin && (
        <div style={{ position: "relative" }} ref={menuOpen === doc.name ? menuRef : undefined}>
          <button
            style={styles.menuBtn}
            onClick={() => onMenuToggle(menuOpen === doc.name ? null : doc.name)}
            title="更多操作"
          >
            ···
          </button>
          {menuOpen === doc.name && (
            <div style={styles.menuDropdown}>
              <button style={{ ...styles.menuItem, color: "#F44336" }} onClick={() => onDelete(doc.name)}>
                删除
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panelContent: {
    padding: "8px 12px",
  },
  toolbar: {
    display: "flex",
    gap: 6,
    marginBottom: 8,
  },
  toolbarBtn: {
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
  sectionHeader: {
    fontSize: 11,
    fontWeight: 600,
    color: "#4A90D9",
    marginTop: 8,
    marginBottom: 4,
    paddingBottom: 2,
    borderBottom: "1px solid #f0f0f0",
  },
  emptyText: {
    color: "#999",
    fontSize: 12,
    textAlign: "center",
    padding: 12,
  },
  docRow: {
    display: "flex",
    alignItems: "center",
    padding: "6px 0",
    borderBottom: "1px solid #f5f5f5",
    gap: 8,
  },
  badge: {
    fontSize: 10,
    background: "#e0e0e0",
    color: "#666",
    padding: "1px 6px",
    borderRadius: 3,
    flexShrink: 0,
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
