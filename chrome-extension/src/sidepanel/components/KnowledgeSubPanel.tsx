// Knowledge sub-panel: browse global and site knowledge docs

import { useState, useRef, useEffect, useMemo } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { SectionHeader } from "../ui/SectionHeader"

export function KnowledgeSubPanel() {
  const { state, dispatch } = useAgentStore()
  const [importUrl, setImportUrl] = useState("")
  const [showUrlImport, setShowUrlImport] = useState(false)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [currentHostname, setCurrentHostname] = useState<string>("")
  const [status, setStatus] = useState<string>("")
  /** Filter list when many docs */
  const [query, setQuery] = useState("")
  /** Bulk-delete mode: checkboxes select docs to remove (not inject) */
  const [manageMode, setManageMode] = useState(false)
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set())
  const [relatedById, setRelatedById] = useState<Record<string, Array<{ id: string; title: string }>>>({})
  const [focusId, setFocusId] = useState<string | null>(null)
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

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (!d?.id || !Array.isArray(d.related)) return
      setRelatedById((prev) => ({ ...prev, [d.id]: d.related }))
    }
    window.addEventListener("cmspark:knowledge_related", h as EventListener)
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (!id) return
      setQuery("")
      setFocusId(id)
      requestAnimationFrame(() => {
        const safe = id.replace(/["\\]/g, "")
        document.querySelector(`[data-knowledge-id="${safe}"]`)?.scrollIntoView({ block: "nearest" })
      })
    }
    window.addEventListener("cmspark:focus-knowledge", onFocus as EventListener)
    return () => {
      window.removeEventListener("cmspark:knowledge_related", h as EventListener)
      window.removeEventListener("cmspark:focus-knowledge", onFocus as EventListener)
    }
  }, [])

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
    const doc = state.knowledgeDocs.find((d) => d.name === name)
    const label = doc?.title || name
    if (confirm(`确定删除知识文档 "${label}"？`)) {
      showStatus(`正在删除 "${label}"...`)
      chrome.runtime.sendMessage({ type: "knowledge.delete", name })
    }
    setMenuOpen(null)
  }

  const exitManageMode = () => {
    setManageMode(false)
    setSelectedForDelete(new Set())
  }

  const toggleDeleteSelect = (name: string) => {
    setSelectedForDelete((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleBulkDelete = () => {
    const names = Array.from(selectedForDelete)
    if (names.length === 0) {
      showStatus("请先勾选要删除的文档")
      return
    }
    if (
      !confirm(
        `确定删除选中的 ${names.length} 篇知识文档？\n（内置文档会跳过）\n此操作不可恢复。`,
      )
    ) {
      return
    }
    let skippedBuiltin = 0
    let queued = 0
    for (const name of names) {
      const doc = state.knowledgeDocs.find((d) => d.name === name)
      if (doc?.builtin) {
        skippedBuiltin += 1
        continue
      }
      chrome.runtime.sendMessage({ type: "knowledge.delete", name })
      queued += 1
    }
    const parts = [`已请求删除 ${queued} 篇`]
    if (skippedBuiltin > 0) parts.push(`跳过内置 ${skippedBuiltin}`)
    showStatus(parts.join(" · "))
    exitManageMode()
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
      const pieces: string[] = [`已选 ${list.length} 个文件，请确认第一篇（其余请再次导入）`]
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
            dispatch({
              type: "SET_KNOWLEDGE_PREVIEW",
              preview: {
                title: file.name.replace(/\.[^.]+$/, ""),
                description: "",
                preview: "正在解析…",
                char_count: 0,
                payload: { file: { name: file.name, content: base64 } },
              },
            })
            chrome.runtime.sendMessage({
              type: "knowledge.preview",
              file: { name: file.name, content: base64 },
            })
            imported += 1
            queue.length = 0
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
      showStatus("正在预览 URL…")
      dispatch({
        type: "SET_KNOWLEDGE_PREVIEW",
        preview: {
          title: "",
          description: "",
          preview: "正在抓取…",
          char_count: 0,
          payload: { url: importUrl.trim() },
        },
      })
      chrome.runtime.sendMessage({ type: "knowledge.preview", url: importUrl.trim() })
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
    // 6MB per file). Confirm first — native picker is not per-note extracted preview.
    if (!window.confirm("将用系统对话框选择文件夹并导入其中的笔记（每篇不单独预览，最多 200 个文件）。继续？")) {
      return
    }
    showStatus("正在打开文件夹选择器…")
    chrome.runtime.sendMessage({ type: "knowledge.import_directory", user_gesture: true })
  }

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return state.knowledgeDocs
    return state.knowledgeDocs.filter((d) => {
      const bag = [d.title || "", d.name, d.description || "", d.site || ""].join(" ").toLowerCase()
      return bag.includes(q)
    })
  }, [state.knowledgeDocs, query])

  // Group knowledge docs by site, with current site first
  const groupedDocs = groupKnowledgeBySite(filteredDocs, currentHostname)

  const modeLabels: Record<string, string> = { auto: "自动", all: "全选", manual: "按需" }
  const selectionMode = state.knowledgeSelectionMode || "auto"
  const isManual = selectionMode === "manual"
  const deletableFiltered = filteredDocs.filter((d) => !d.builtin)
  const allFilteredSelected =
    deletableFiltered.length > 0 && deletableFiltered.every((d) => selectedForDelete.has(d.name))

  const modeHint =
    selectionMode === "auto"
      ? "自动：按当前站点匹配知识，列表勾选不生效。"
      : selectionMode === "all"
        ? "全选：注入全部知识索引，无需（也无法）单独勾选。"
        : "按需：仅勾选的知识会参与本对话。"

  return (
    <div style={styles.panelContent}>
      {/* Mode switcher */}
      <div style={styles.modeSwitcher}>
        {(["auto", "all", "manual"] as const).map((mode) => (
          <button
            key={mode}
            style={{
              ...styles.modeBtn,
              background: selectionMode === mode ? tokens.accent : tokens.bgElevated,
              color: selectionMode === mode ? "#fff" : tokens.textSecondary,
              borderColor: selectionMode === mode ? tokens.accent : tokens.border,
            }}
            onClick={() => handleModeChange(mode)}
            title={mode === "auto" ? "自动匹配当前站点" : mode === "all" ? "注入所有知识索引" : "仅使用勾选知识"}
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>
      <div style={styles.modeHint}>{modeHint}</div>

      {/* Search + manage */}
      <div style={styles.searchRow}>
        <input
          style={styles.searchInput}
          type="search"
          placeholder="筛选知识（名称 / 描述 / 站点）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="筛选知识文档"
        />
        <button
          type="button"
          style={styles.toolbarBtn}
          onClick={() => {
            // Force skill-engine rescan (knowledge shares the same cache)
            chrome.runtime.sendMessage({ type: "skill.refresh" })
            chrome.runtime.sendMessage({ type: "knowledge.list" })
            showStatus("已重新扫描知识库")
          }}
          title="重新扫描知识目录（含外部文件变更）"
        >
          ↻ 刷新
        </button>
        <button
          type="button"
          style={{
            ...styles.toolbarBtn,
            ...(manageMode
              ? { background: tokens.dangerSoft, borderColor: "rgba(220,38,38,0.35)", color: tokens.danger }
              : {}),
          }}
          onClick={() => (manageMode ? exitManageMode() : setManageMode(true))}
          title={manageMode ? "退出批量管理" : "批量勾选并删除知识"}
        >
          {manageMode ? "完成" : "批量删除"}
        </button>
      </div>

      {manageMode && (
        <div style={styles.bulkBar}>
          <button
            type="button"
            style={styles.toolbarBtn}
            onClick={() => {
              if (allFilteredSelected) {
                setSelectedForDelete((prev) => {
                  const next = new Set(prev)
                  for (const d of deletableFiltered) next.delete(d.name)
                  return next
                })
              } else {
                setSelectedForDelete((prev) => {
                  const next = new Set(prev)
                  for (const d of deletableFiltered) next.add(d.name)
                  return next
                })
              }
            }}
            disabled={deletableFiltered.length === 0}
          >
            {allFilteredSelected ? "取消全选筛选结果" : "全选筛选结果"}
          </button>
          <button
            type="button"
            style={{
              ...styles.toolbarBtn,
              background: selectedForDelete.size ? tokens.dangerSoft : tokens.bgElevated,
              color: selectedForDelete.size ? tokens.danger : tokens.textMuted,
              borderColor: selectedForDelete.size ? "rgba(220,38,38,0.35)" : tokens.border,
            }}
            disabled={selectedForDelete.size === 0}
            onClick={handleBulkDelete}
          >
            删除选中 ({selectedForDelete.size})
          </button>
          <span style={styles.bulkMeta}>
            显示 {filteredDocs.length}/{state.knowledgeDocs.length}
          </span>
        </div>
      )}

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
        <div style={{ fontSize: 11, color: tokens.accent, marginBottom: 8, padding: "2px 4px" }}>
          {status}
        </div>
      )}
      {state.knowledgeImportStatus && (
        <div style={{
          fontSize: 11,
          color: state.knowledgeImportStatus.ok ? tokens.success : tokens.danger,
          marginBottom: 8,
          padding: "2px 4px",
        }}>
          {state.knowledgeImportStatus.message}
        </div>
      )}

      {/* Grouped knowledge list */}
      {groupedDocs.map(([groupName, docs]) => (
        <div key={groupName}>
          <SectionHeader title={groupName} meta={docs.length} />
          {docs.map((doc) => {
            const active = state.activeKnowledgeIds.includes(doc.name)
            const rowBg = manageMode
              ? selectedForDelete.has(doc.name)
                ? tokens.dangerSoft
                : "transparent"
              : isManual && active
                ? tokens.bgActive
                : "transparent"
            return (
              <div
                key={doc.name}
                data-knowledge-id={doc.id || doc.name}
                style={{
                  ...styles.docRow,
                  background: rowBg,
                  outline: focusId && (focusId === doc.id || focusId === doc.name) ? `2px solid ${tokens.accent}` : undefined,
                }}
              >
                {manageMode ? (
                  <input
                    type="checkbox"
                    checked={selectedForDelete.has(doc.name)}
                    disabled={!!doc.builtin}
                    title={doc.builtin ? "内置文档不可删除" : "勾选以批量删除"}
                    onChange={() => toggleDeleteSelect(doc.name)}
                    style={{ marginRight: 8, flexShrink: 0 }}
                  />
                ) : isManual ? (
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => {
                      const activeKnowledgeIds = active
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
                    style={{ marginRight: 8, flexShrink: 0 }}
                    title="勾选后参与本对话"
                  />
                ) : (
                  <span
                    style={styles.modeGlyph}
                    title={
                      selectionMode === "all"
                        ? "全选模式：全部参与索引"
                        : "自动模式：由站点匹配决定"
                    }
                    aria-hidden
                  >
                    {selectionMode === "all" ? "◎" : "◇"}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                    {doc.title || doc.name}
                    {doc.site && <span style={styles.siteBadge}>{doc.site}</span>}
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
                    {doc.description}
                  </div>
                  {(relatedById[doc.name] || relatedById[doc.id || ""] || []).length > 0 && (
                    <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 2 }}>
                      相关：{(relatedById[doc.name] || relatedById[doc.id || ""] || []).slice(0, 3).map((r) => r.title).join(" · ")}
                    </div>
                  )}
                </div>
                {doc.builtin && <span style={styles.badge}>内置</span>}
                {!manageMode && (
                  <button
                    type="button"
                    style={{ ...styles.menuBtn, fontSize: 10, padding: "2px 6px" }}
                    onClick={() =>
                      chrome.runtime.sendMessage({ type: "knowledge.related", id: doc.id || doc.name })
                    }
                    title="查询相关知识（最多 3 条）"
                  >
                    相关
                  </button>
                )}
                {!doc.builtin && !manageMode && (
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
                        <button
                          style={{ ...styles.menuItem, color: tokens.danger }}
                          onClick={() => handleDelete(doc.name)}
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

      {state.knowledgeDocs.length === 0 && (
        <div style={styles.emptyText}>暂无知识文档</div>
      )}
      {state.knowledgeDocs.length > 0 && filteredDocs.length === 0 && (
        <div style={styles.emptyText}>无匹配「{query}」的知识</div>
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
    marginBottom: 6,
    borderRadius: tokens.radiusSm,
    overflow: "hidden",
    border: `1px solid ${tokens.borderStrong}`,
  },
  modeBtn: {
    flex: 1,
    border: "none",
    borderRight: `1px solid ${tokens.border}`,
    padding: "5px 0",
    fontSize: 11,
    cursor: "pointer",
    background: tokens.bgElevated,
    fontFamily: tokens.font,
  },
  modeHint: {
    fontSize: 10,
    color: tokens.textMuted,
    lineHeight: 1.4,
    marginBottom: 8,
  },
  searchRow: {
    display: "flex",
    gap: 6,
    marginBottom: 6,
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: tokens.radiusSm,
    padding: "5px 8px",
    fontSize: 11,
    fontFamily: tokens.font,
    background: tokens.bgElevated,
    color: tokens.text,
    outline: "none",
  },
  bulkBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
    marginBottom: 8,
    padding: "6px 8px",
    background: tokens.bgMuted,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.border}`,
  },
  bulkMeta: {
    fontSize: 10,
    color: tokens.textMuted,
    marginLeft: "auto",
  },
  toolbar: {
    display: "flex",
    gap: 6,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  toolbarBtn: {
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: tokens.radiusSm,
    background: tokens.bgElevated,
    padding: "4px 10px",
    fontSize: 11,
    cursor: "pointer",
    fontFamily: tokens.font,
    color: tokens.text,
  },
  urlImportRow: {
    display: "flex",
    gap: 4,
    marginBottom: 8,
  },
  urlImportInput: {
    flex: 1,
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: tokens.radiusSm,
    padding: "4px 8px",
    fontSize: 11,
    fontFamily: tokens.fontMono,
    outline: "none",
    background: tokens.bgElevated,
    color: tokens.text,
  },
  emptyText: {
    color: tokens.textSecondary,
    fontSize: 12,
    textAlign: "center",
    padding: 12,
  },
  docRow: {
    display: "flex",
    alignItems: "center",
    padding: "6px 0",
    borderBottom: `1px solid ${tokens.border}`,
    gap: 8,
    borderRadius: tokens.radiusSm,
  },
  modeGlyph: {
    width: 16,
    textAlign: "center",
    color: tokens.textMuted,
    fontSize: 11,
    flexShrink: 0,
    marginRight: 4,
  },
  badge: {
    fontSize: 10,
    background: tokens.bgMuted,
    color: tokens.textSecondary,
    padding: "1px 6px",
    borderRadius: 3,
    flexShrink: 0,
  },
  siteBadge: {
    fontSize: 9,
    background: tokens.accentSoft,
    color: tokens.accentText,
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
}
