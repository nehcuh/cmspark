// Knowledge sub-panel: browse global and site knowledge docs

import { useState, useRef, useEffect } from "react"
import { useAgentStore } from "../store/agentStore"

export function KnowledgeSubPanel() {
  const { state, dispatch } = useAgentStore()
  const [importUrl, setImportUrl] = useState("")
  const [showUrlImport, setShowUrlImport] = useState(false)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [currentHostname, setCurrentHostname] = useState<string>("")
  const [status, setStatus] = useState<string>("")
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showStatus = (msg: string) => {
    setStatus(msg)
    setTimeout(() => setStatus(""), 3000)
  }

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

  const handleModeChange = (mode: "auto" | "all" | "manual") => {
    dispatch({ type: "SET_KNOWLEDGE_SELECTION_MODE", mode })
    if (state.activeThreadId) {
      chrome.runtime.sendMessage({
        type: "thread.update",
        threadId: state.activeThreadId,
        updates: { knowledge_selection_mode: mode },
      })
    }
  }

  const handleDelete = (name: string) => {
    if (confirm(`确定删除知识文档 "${name}"？`)) {
      showStatus(`正在删除 "${name}"...`)
      chrome.runtime.sendMessage({ type: "knowledge.delete", name })
    }
    setMenuOpen(null)
  }

  const handleImportFiles = (files: FileList | null) => {
    if (!files) return
    // Wrap everything in a try/catch — a single unexpected throw inside a
    // FileReader callback would otherwise bubble up and kill the side panel
    // (or worse, in MV3 service-worker memory-pressure scenarios, take Chrome
    // down with it). Multi-select file input is untrusted at scale.
    try {
      const allowedExts = new Set([
        "md", "markdown", "docx", "pdf", "xlsx", "pptx", "odt", "rtf", "txt", "csv", "html", "htm",
      ])
      // Per-file size cap. Base64 expansion is 4/3 plus JSON overhead, so 6MB raw
      // keeps each WS frame well under companion's 10MB hard limit. Files above
      // this are skipped (not crashed on) with a counted report at the end.
      const MAX_FILE_SIZE = 6 * 1024 * 1024
      // HARD refusal threshold for multi-select file input. Each file is base64'd
      // in the SW and shipped as a separate chrome.runtime.sendMessage — past 30,
      // peak SW memory and message-queue depth get risky. Users who legitimately
      // need to import a whole folder should use the "导入文件夹" button, which
      // routes through companion's native picker and walks the directory server-side
      // (no base64 round-trip, scales to 200 notes).
      const HARD_REFUSE_LIMIT = 30

      // Cheap length check FIRST — don't materialize / iterate a huge
      // FileList just to filter it.
      const total = files.length
      if (total > HARD_REFUSE_LIMIT) {
        showStatus(
          `⚠ 选中 ${total} 个文件，超过 ${HARD_REFUSE_LIMIT} 上限。` +
          ` 导入整个文件夹请改用「导入文件夹」按钮——那套走 Companion 原生 picker，可处理 200 篇笔记。`
        )
        return
      }

      // Pass 1: filter by extension/dotfile.
      const candidates = Array.from(files).filter(f => {
        const ext = f.name.split(".").pop()?.toLowerCase() || ""
        return allowedExts.has(ext) && !f.name.startsWith(".")
      })
      if (!candidates.length) {
        showStatus("没有可导入的文件")
        return
      }

      // Pass 2: separate by size; count skipped oversized files.
      const oversized: string[] = []
      const list = candidates.filter(f => {
        if (f.size > MAX_FILE_SIZE) {
          oversized.push(f.name)
          return false
        }
        return true
      })

      // Build the user-facing status *before* we start so they see what's happening.
      const pieces: string[] = [`正在导入 ${list.length} 个文件`]
      if (oversized.length > 0) pieces.push(`跳过 ${oversized.length} 个 >6MB（如 ${oversized[0]}）`)
      showStatus(pieces.join(" · "))

      // Sequential import (not concurrent) — concurrent FileReader on many
      // files spikes MV3 service-worker memory. Sequential keeps peak memory
      // flat. Each read starts only after the previous base64 was handed off.
      const queue = [...list]
      let imported = 0
      let failed = 0
      const processNext = (): void => {
        const file = queue.shift()
        if (!file) {
          const done: string[] = [`完成：导入 ${imported}`]
          if (failed > 0) done.push(`失败 ${failed}`)
          if (oversized.length > 0) done.push(`跳过 ${oversized.length}`)
          showStatus(done.join(" · "))
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          try {
            const arrayBuffer = reader.result as ArrayBuffer
            const bytes = new Uint8Array(arrayBuffer)
            // Chunked base64: building a single JS string by concatenating one
            // char per byte balloons to ~3x the file size in heap and trips V8's
            // string-length cap on large files. Process in 64KB chunks instead.
            const CHUNK = 0x8000
            let base64 = ""
            for (let i = 0; i < bytes.length; i += CHUNK) {
              const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
              base64 += btoa(String.fromCharCode.apply(null, Array.from(slice) as unknown as number[]))
            }
            chrome.runtime.sendMessage({
              type: "knowledge.import",
              file: { name: file.name, content: base64 },
            })
            imported += 1
          } catch (err) {
            console.error("[KnowledgeSubPanel] import failed for", file.name, err)
            failed += 1
          }
          processNext()
        }
        reader.onerror = () => {
          console.error("[KnowledgeSubPanel] FileReader error for", file.name, reader.error)
          failed += 1
          processNext()
        }
        reader.readAsArrayBuffer(file)
      }
      processNext()
    } catch (err) {
      // Last-resort safety net — any unexpected throw above must not crash the
      // panel. Surface a short status and redirect to the safe folder-import path.
      console.error("[KnowledgeSubPanel] handleImportFiles top-level error:", err)
      showStatus("导入失败：文件可能过大或格式不支持。请改用「导入文件夹」按钮（走 Companion 原生 picker）")
    }
  }

  const handleUrlImport = () => {
    if (importUrl.trim()) {
      showStatus("正在从 URL 导入...")
      chrome.runtime.sendMessage({ type: "knowledge.import", url: importUrl.trim() })
      setImportUrl("")
      setShowUrlImport(false)
    }
  }

  const handleFilePick = () => {
    fileInputRef.current?.click()
  }

  const handleFolderPick = () => {
    // Route through companion's native folder picker. The previous <input webkitdirectory>
    // approach crashed Chromium 149's main process (SIGSEGV at 0x38 on CrBrowserMain)
    // when picking iCloud-synced folders like 笨牛棚 — the crash is in native code
    // BEFORE our JS runs, so any extension-side guard (file count, size, try/catch)
    // is too late. Companion walks the dir safely (skips dotfiles, caps at 200 files,
    // 6MB per file) and imports each note directly to the knowledge store.
    showStatus("正在打开文件夹选择器…")
    chrome.runtime.sendMessage({ type: "knowledge.import_directory" })
  }

  // Group knowledge docs by site, with current site first
  const groupedDocs = groupKnowledgeBySite(state.knowledgeDocs, currentHostname)

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
              background: state.knowledgeSelectionMode === mode ? "#4A90D9" : "#fff",
              color: state.knowledgeSelectionMode === mode ? "#fff" : "#666",
              borderColor: state.knowledgeSelectionMode === mode ? "#4A90D9" : "#ddd",
            }}
            onClick={() => handleModeChange(mode)}
            title={mode === "auto" ? "自动匹配当前站点" : mode === "all" ? "注入所有知识索引" : "仅使用勾选知识"}
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>

      {/* Import toolbar */}
      <div style={styles.toolbar}>
        <button style={styles.toolbarBtn} onClick={handleFilePick} title="导入单个或多个文件（≤30 个）">
          导入文件
        </button>
        <button
          style={styles.toolbarBtn}
          onClick={handleFolderPick}
          title="通过 Companion 原生选择器导入整个文件夹（支持 Obsidian / iCloud vault，最多 200 篇笔记）"
        >
          导入文件夹
        </button>
        <button style={styles.toolbarBtn} onClick={() => setShowUrlImport(!showUrlImport)} title="从 URL 导入">
          导入 URL
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.markdown,.docx,.pdf,.xlsx,.pptx,.odt,.rtf,.txt,.csv,.html"
          style={{ display: "none" }}
          onChange={(e) => {
            handleImportFiles(e.target.files)
            e.currentTarget.value = ""
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

      {/* Status feedback */}
      {status && (
        <div style={{ fontSize: 11, color: "#4A90D9", marginBottom: 8, padding: "2px 4px" }}>
          {status}
        </div>
      )}
      {state.knowledgeImportStatus && (
        <div style={{
          fontSize: 11,
          color: state.knowledgeImportStatus.ok ? "#4CAF50" : "#F44336",
          marginBottom: 8,
          padding: "2px 4px",
        }}>
          {state.knowledgeImportStatus.message}
        </div>
      )}

      {/* Grouped knowledge list */}
      {groupedDocs.map(([groupName, docs]) => (
        <div key={groupName}>
          <div style={styles.sectionHeader}>{groupName}</div>
          {docs.map((doc) => (
            <div key={doc.name} style={{
              ...styles.docRow,
              background: state.activeKnowledgeIds.includes(doc.name) ? "#e8f0fe" : "transparent",
              opacity: state.knowledgeSelectionMode === "all" ? 0.6 : 1,
            }}>
              <input
                type="checkbox"
                checked={state.activeKnowledgeIds.includes(doc.name)}
                disabled={state.knowledgeSelectionMode === "all"}
                onChange={() => {
                  const activeKnowledgeIds = state.activeKnowledgeIds.includes(doc.name)
                    ? state.activeKnowledgeIds.filter((id) => id !== doc.name)
                    : [...state.activeKnowledgeIds, doc.name]
                  dispatch({ type: "TOGGLE_KNOWLEDGE", knowledgeId: doc.name })
                  if (state.activeThreadId) {
                    chrome.runtime.sendMessage({
                      type: "thread.update",
                      threadId: state.activeThreadId,
                      updates: { active_knowledge_ids: activeKnowledgeIds },
                    })
                  }
                }}
                style={{ marginRight: 8 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                  {doc.name}
                  {doc.site && <span style={styles.siteBadge}>{doc.site}</span>}
                </div>
                <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {doc.description}
                </div>
              </div>
              {doc.builtin && <span style={styles.badge}>内置</span>}
              {!doc.builtin && (
                <div style={{ position: "relative" }} ref={menuOpen === doc.name ? menuRef : undefined}>
                  <button
                    style={styles.menuBtn}
                    onClick={() => setMenuOpen(menuOpen === doc.name ? null : doc.name)}
                    title="更多操作"
                  >
                    ···
                  </button>
                  {menuOpen === doc.name && (
                    <div style={styles.menuDropdown}>
                      <button style={{ ...styles.menuItem, color: "#F44336" }} onClick={() => handleDelete(doc.name)}>
                        删除
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {state.knowledgeDocs.length === 0 && (
        <div style={styles.emptyText}>暂无知识文档</div>
      )}
    </div>
  )
}

function groupKnowledgeBySite(docs: any[], currentHostname: string): [string, any[]][] {
  const globalDocs = docs.filter((d) => !d.site)
  const siteGroups = new Map<string, any[]>()
  for (const doc of docs.filter((d) => d.site)) {
    const key = doc.site!
    if (!siteGroups.has(key)) siteGroups.set(key, [])
    siteGroups.get(key)!.push(doc)
  }
  const result: [string, any[]][] = []
  if (globalDocs.length > 0) {
    result.push(["全局", globalDocs])
  }
  // Sort: current hostname match first, then alphabetical
  const sortedSites = Array.from(siteGroups.entries()).sort((a, b) => {
    const aMatch = currentHostname && matchesSite(a[0], currentHostname) ? -1 : 0
    const bMatch = currentHostname && matchesSite(b[0], currentHostname) ? -1 : 0
    if (aMatch !== bMatch) return aMatch - bMatch
    return a[0].localeCompare(b[0])
  })
  for (const [site, siteDocs] of sortedSites) {
    result.push([site, siteDocs])
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

const styles: Record<string, React.CSSProperties> = {
  panelContent: {
    padding: "8px 12px",
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
    fontFamily: "monospace",
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
  siteBadge: {
    fontSize: 9,
    background: "#e3f2fd",
    color: "#1976d2",
    padding: "0px 4px",
    borderRadius: 3,
    fontWeight: 400,
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
