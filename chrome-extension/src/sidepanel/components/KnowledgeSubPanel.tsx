// Knowledge sub-panel: browse global and site knowledge docs

import { useState, useRef, useEffect, useMemo } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { SectionHeader } from "../ui/SectionHeader"
import {
  KNOWLEDGE_TOO_BIG_DOWNLOAD_COPY,
  KNOWLEDGE_TRUNCATED_BODY_SAVE_COPY,
  buildKnowledgeUpdateMessage,
} from "../utils/knowledge-save"
import {
  fillKnowledgeDraftFromSuggestion,
  knowledgePreviewSendFailureText,
  newKnowledgePreviewRequestId,
} from "../utils/knowledge-preview"
import { knowledgeImportSelectionCopy } from "../utils/knowledge-import-copy"
import {
  buildKnowledgeFolderTree,
  filterKnowledgeDocs,
  knowledgeMoveTargets,
  type KnowledgeFolderNode,
} from "../utils/knowledge-folders"
import {
  KNOWLEDGE_DISTRIBUTION_HONESTY_COPY,
  KNOWLEDGE_DISTRIBUTION_OVER_CAP_COPY,
  KNOWLEDGE_ROUTE_BY_GROUP_EXPLAIN_COPY,
  distributionChips,
  distributionFilterIds,
  distributionOverCap,
} from "../utils/knowledge-distribution"
import { KnowledgeGraphEntryButton } from "../../knowledge-graph/chrome"

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
  const [focusId, setFocusId] = useState<string | null>(null)
  /** #274: 视图切换 站点|文件夹（默认文件夹 — 用户要的组织维度）。 */
  const [viewMode, setViewMode] = useState<"folder" | "site">("folder")
  /** #274: 手风琴展开状态（文件夹路径集合）。 */
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  /** #274: 文件夹行菜单（path 标识）。 */
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null)
  /** #273 Wave B: 分布过滤 chip（label；null = 不过滤）。点击 = 过滤列表，纯只读。 */
  const [distFilter, setDistFilter] = useState<string | null>(null)
  /**
   * #274: 内联编辑行（320px 不另开 sheet）：
   * create = 新建文件夹（path 输入）· rename = 重命名 · describe = 编辑说明
   * （建议说明草稿也落这里，保存才写 _folder.md）· move = 文档「移到…」。
   */
  const [folderEdit, setFolderEdit] = useState<
    | { mode: "create"; bucket: "global" | "sites"; value: string }
    | { mode: "rename"; bucket: "global" | "sites"; path: string; value: string }
    | { mode: "describe"; bucket: "global" | "sites"; path: string; value: string }
    | { mode: "move"; docId: string; value: string }
    | null
  >(null)
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
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (!id) return
      setQuery("")
      setFocusId(id)
      chrome.runtime.sendMessage({ type: "knowledge.get", id })
      requestAnimationFrame(() => {
        const safe = id.replace(/[^a-zA-Z0-9._:-]/g, "")
        if (!safe) return
        document.querySelector(`[data-knowledge-id="${safe}"]`)?.scrollIntoView({ block: "nearest" })
      })
    }
    window.addEventListener("cmspark:focus-knowledge", onFocus as EventListener)
    return () => {
      window.removeEventListener("cmspark:focus-knowledge", onFocus as EventListener)
    }
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!menuOpen && !folderMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null)
        setFolderMenuOpen(null)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [menuOpen, folderMenuOpen])

  // #274: folder_suggest 草稿到达 → 落进说明编辑行（用户编辑保存才写 _folder.md）。
  // Gate8 N-8: user-dirty — 编辑行已有该夹未保存输入时不覆盖草稿。
  const folderSuggest = state.knowledgeFolderSuggest
  useEffect(() => {
    if (!folderSuggest || folderSuggest.status !== "ok") return
    setFolderEdit((prev) => {
      // Any open editor row (esp. a describe row the user has typed into —
      // #272 user-dirty semantics) wins over an arriving draft.
      if (prev) return prev
      return { mode: "describe", bucket: folderSuggest.bucket, path: folderSuggest.path, value: folderSuggest.description || "" }
    })
  }, [folderSuggest])

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // #274: 文件夹/移动操作统一出口（皆 user_gesture；companion 回 knowledge.list 刷新）。
  // Gate8 M-6: 不乐观播报 — 先查 SW 回包（ok:false = 发送失败），companion 侧
  // 拒绝经 family:"knowledge_folder" 错误帧落到状态条（useWebSocket）。
  const submitFolderEdit = () => {
    if (!folderEdit) return
    const value = folderEdit.value.trim()
    let msg: Record<string, unknown>
    let successText: string
    if (folderEdit.mode === "create") {
      if (!value) return
      msg = { type: "knowledge.folder_create", bucket: folderEdit.bucket, path: value, user_gesture: true }
      successText = `已请求创建文件夹 ${value}`
    } else if (folderEdit.mode === "rename") {
      if (!value) return
      msg = { type: "knowledge.folder_rename", bucket: folderEdit.bucket, path: folderEdit.path, new_path: value, user_gesture: true }
      successText = `已请求重命名为 ${value}`
    } else if (folderEdit.mode === "describe") {
      msg = { type: "knowledge.folder_update", bucket: folderEdit.bucket, path: folderEdit.path, description: value, user_gesture: true }
      successText = "已请求保存文件夹说明"
    } else {
      // knowledge.move 无 bucket 参数：目标文件夹相对文档自身桶解析（跨桶不可表达，F-I-8）。
      msg = { type: "knowledge.move", id: folderEdit.docId, folder: value, user_gesture: true }
      successText = value ? `已请求移到 ${value}` : "已请求移到桶根"
    }
    chrome.runtime
      .sendMessage(msg)
      .then((resp: unknown) => {
        const failure = knowledgePreviewSendFailureText(resp)
        showStatus(failure ? `操作失败：${failure}` : successText)
      })
      .catch(() => showStatus("操作失败：扩展后台未响应，请重载扩展后重试"))
    setFolderEdit(null)
  }

  const handleFolderSuggest = (bucket: "global" | "sites", folderPath: string) => {
    dispatch({ type: "SET_KNOWLEDGE_FOLDER_SUGGEST", path: folderPath, bucket, status: "pending" })
    showStatus("正在生成建议说明…")
    chrome.runtime
      .sendMessage({ type: "knowledge.folder_suggest", bucket, path: folderPath, user_gesture: true })
      .then((resp: unknown) => {
        const failure = knowledgePreviewSendFailureText(resp)
        if (failure) {
          dispatch({ type: "SET_KNOWLEDGE_FOLDER_SUGGEST", path: folderPath, status: "error", error: failure })
        }
      })
      .catch(() => {
        dispatch({ type: "SET_KNOWLEDGE_FOLDER_SUGGEST", path: folderPath, status: "error", error: "扩展后台未响应，请重载扩展后重试" })
      })
  }

  const handleFolderDelete = (bucket: "global" | "sites", folderPath: string, hasDocs: boolean) => {
    const msg: Record<string, unknown> = hasDocs
      ? { type: "knowledge.folder_delete", bucket, path: folderPath, mode: "move_to_parent", user_gesture: true }
      : { type: "knowledge.folder_delete", bucket, path: folderPath, mode: "reject_if_docs", user_gesture: true }
    if (hasDocs) {
      if (!confirm(`文件夹 ${folderPath} 里还有文档。确定把文档上提一层并删除该文件夹？`)) return
    } else {
      if (!confirm(`确定删除空文件夹 ${folderPath}？`)) return
    }
    chrome.runtime
      .sendMessage(msg)
      .then((resp: unknown) => {
        const failure = knowledgePreviewSendFailureText(resp)
        showStatus(failure ? `删除失败：${failure}` : `已请求删除文件夹 ${folderPath}`)
      })
      .catch(() => showStatus("删除失败：扩展后台未响应，请重载扩展后重试"))
  }

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

  // #273 Wave A: 智能匹配开关（关 = 回到「站点+勾选」旧选择，预算仍是安全网）
  const handleSmartMatchChange = (enabled: boolean) => {
    dispatch({ type: "SET_KNOWLEDGE_SMART_MATCH", enabled })
    if (state.activeThreadId) {
      chrome.runtime.sendMessage({
        type: "thread.update",
        threadId: state.activeThreadId,
        updates: { knowledge_smart_match: enabled },
      })
    }
  }

  // #273 Wave B: 「按堆选文」开关（可选路由，默认关；只作用于自动模式；
  // 智能匹配关掉时同样不生效——关了智能却仍按堆选文，禁止）
  const handleRouteByGroupChange = (enabled: boolean) => {
    dispatch({ type: "SET_KNOWLEDGE_ROUTE_BY_GROUP", enabled })
    if (state.activeThreadId) {
      chrome.runtime.sendMessage({
        type: "thread.update",
        threadId: state.activeThreadId,
        updates: { knowledge_route_by_group: enabled },
      })
    }
  }

  const handleDelete = (doc: { id?: string; name: string; title?: string }) => {
    const id = doc.id || doc.name
    const label = doc.title || doc.name
    if (confirm(`确定删除知识文档 "${label}"？`)) {
      showStatus(`正在删除 "${label}"...`)
      chrome.runtime.sendMessage({ type: "knowledge.delete", id, user_gesture: true })
    }
    setMenuOpen(null)
  }

  const openDoc = (id: string) => {
    setFocusId(id)
    chrome.runtime.sendMessage({ type: "knowledge.get", id })
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
      const doc = state.knowledgeDocs.find((d) => d.name === name || d.id === name)
      if (doc?.builtin) {
        skippedBuiltin += 1
        continue
      }
      chrome.runtime.sendMessage({ type: "knowledge.delete", id: doc?.id || name, user_gesture: true })
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

      // #285: all-oversized must not say "已选 0 个请确认第一篇".
      showStatus(knowledgeImportSelectionCopy(list.length, oversized))
      if (list.length === 0) return

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
            // Same encoding as composer attachments (App.tsx readFileAsBase64):
            // FileReader.readAsDataURL of the whole file. Do NOT concatenate
            // per-chunk btoa — CHUNK=0x8000 is not a multiple of 3, so each
            // chunk is padded and the joined string is not valid PDF bytes
            // (companion pdf-parse: "Invalid PDF structure").
            const dataUrl = typeof reader.result === "string" ? reader.result : ""
            const base64 = dataUrl.split(",")[1] || ""
            // #270: correlate the preview request with a unique id so the
            // companion reply/error routes back to THIS modal, and surface a
            // background send failure ({ok:false}) instead of spinning forever.
            const requestId = newKnowledgePreviewRequestId()
            dispatch({
              type: "SET_KNOWLEDGE_PREVIEW",
              pendingId: requestId,
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
              id: requestId,
              file: { name: file.name, content: base64 },
            }).then((resp: unknown) => {
              const failure = knowledgePreviewSendFailureText(resp)
              if (failure) {
                dispatch({
                  type: "SET_KNOWLEDGE_PREVIEW",
                  replyId: requestId,
                  preview: { preview: `预览失败：${failure}` },
                })
              }
            }).catch(() => {
              dispatch({
                type: "SET_KNOWLEDGE_PREVIEW",
                replyId: requestId,
                preview: { preview: "预览失败：扩展后台未响应，请重载扩展后重试" },
              })
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
        reader.readAsDataURL(file)
      }
      processNext()
    } catch (err) {
      // Last-resort safety net — any unexpected throw above must not crash the
      // panel. Surface a short status and redirect to the safe folder-import path.
      console.error("[KnowledgeSubPanel] handleImportFiles top-level error:", err)
      showStatus("导入失败：文件可能过大或格式不支持。超过 6MB 请改用「导入大文件」（Companion 原生选择，最大 10MB）。")
    }
  }

  const handleUrlImport = () => {
    if (importUrl.trim()) {
      showStatus("正在预览 URL…")
      const requestId = newKnowledgePreviewRequestId()
      dispatch({
        type: "SET_KNOWLEDGE_PREVIEW",
        pendingId: requestId,
        preview: {
          title: "",
          description: "",
          preview: "正在抓取…",
          char_count: 0,
          payload: { url: importUrl.trim() },
        },
      })
      chrome.runtime.sendMessage({ type: "knowledge.preview", id: requestId, url: importUrl.trim() })
        .then((resp: unknown) => {
          const failure = knowledgePreviewSendFailureText(resp)
          if (failure) {
            dispatch({
              type: "SET_KNOWLEDGE_PREVIEW",
              replyId: requestId,
              preview: { preview: `预览失败：${failure}` },
            })
          }
        })
        .catch(() => {
          dispatch({
            type: "SET_KNOWLEDGE_PREVIEW",
            replyId: requestId,
            preview: { preview: "预览失败：扩展后台未响应，请重载扩展后重试" },
          })
        })
      setImportUrl("")
      setShowUrlImport(false)
    }
  }

  const handleFilePick = () => {
    fileInputRef.current?.click()
  }

  const handleLargeFilePick = () => {
    // #285: companion native single-file picker — no base64 WS round-trip, so
    // the cap is parseFile's 10MB, not the browser 6MB frame budget.
    const requestId = newKnowledgePreviewRequestId()
    dispatch({
      type: "SET_KNOWLEDGE_PREVIEW",
      pendingId: requestId,
      preview: {
        title: "",
        description: "",
        preview: "正在打开文件选择器…",
        char_count: 0,
        payload: {},
      },
    })
    showStatus("正在打开文件选择器…")
    chrome.runtime.sendMessage({
      type: "knowledge.import_local_file",
      id: requestId,
      user_gesture: true,
    }).then((resp: unknown) => {
      const failure = knowledgePreviewSendFailureText(resp)
      if (failure) {
        dispatch({
          type: "SET_KNOWLEDGE_PREVIEW",
          replyId: requestId,
          preview: { preview: `预览失败：${failure}` },
        })
      }
    }).catch(() => {
      dispatch({
        type: "SET_KNOWLEDGE_PREVIEW",
        replyId: requestId,
        preview: { preview: "预览失败：扩展后台未响应，请重载扩展后重试" },
      })
    })
  }

  const handleFolderPick = () => {
    // Route through companion's native folder picker. The previous <input webkitdirectory>
    // approach crashed Chromium 149's main process (SIGSEGV at 0x38 on CrBrowserMain)
    // when picking iCloud-synced folders like 笨牛棚 — the crash is in native code
    // BEFORE our JS runs, so any extension-side guard (file count, size, try/catch)
    // is too late. Companion walks the dir safely (skips dotfiles, caps at 200 files,
    // 10MB per file). Confirm first — native picker is not per-note extracted preview.
    if (!window.confirm("将保留文件夹结构（最多 3 级，200 个文件）。每篇不单独解读。继续？")) {
      return
    }
    showStatus("正在打开文件夹选择器…")
    chrome.runtime.sendMessage({ type: "knowledge.import_directory", user_gesture: true })
  }

  // #274 AC-10: 筛选 bag 补 tags + folder（util 与测试共用同一份实现）
  // #273 Wave B: 分布 chip 过滤再叠一层（点击 = 过滤列表，与视图切换正交）
  const distFilteredIds = useMemo(
    () => distributionFilterIds(state.knowledgeDistribution, distFilter),
    [state.knowledgeDistribution, distFilter],
  )
  const filteredDocs = useMemo(
    () => {
      const base = filterKnowledgeDocs(state.knowledgeDocs, query)
      if (!distFilteredIds) return base
      return base.filter((d) => distFilteredIds.has(d.id || d.name))
    },
    [state.knowledgeDocs, query, distFilteredIds],
  )
  // #273 Wave B: 分布 chips（可渲染态）与超 cap 诚实文案
  const distChips = useMemo(() => distributionChips(state.knowledgeDistribution), [state.knowledgeDistribution])
  const distOverCap = distributionOverCap(state.knowledgeDistribution)

  // Group knowledge docs by site, with current site first
  const groupedDocs = groupKnowledgeBySite(filteredDocs, currentHostname)
  // #274: 文件夹视图数据（docs 的 folder 字段 + companion folders 元数据）
  const folderTree = useMemo(
    () => buildKnowledgeFolderTree(filteredDocs, state.knowledgeFolders),
    [filteredDocs, state.knowledgeFolders],
  )
  const moveTargets = useMemo(
    () => knowledgeMoveTargets(state.knowledgeDocs, state.knowledgeFolders),
    [state.knowledgeDocs, state.knowledgeFolders],
  )

  const modeLabels: Record<string, string> = { auto: "自动", all: "全选", manual: "按需" }
  const selectionMode = state.knowledgeSelectionMode || "auto"
  const isManual = selectionMode === "manual"
  const smartMatch = state.knowledgeSmartMatch ?? true
  const deletableFiltered = filteredDocs.filter((d) => !d.builtin)
  const allFilteredSelected =
    deletableFiltered.length > 0 && deletableFiltered.every((d) => selectedForDelete.has(d.name))

  const modeHint = (() => {
    const base =
      selectionMode === "auto"
        ? "自动：按这轮问题选相关知识；已钉的优先。当前站点加权。"
        : selectionMode === "all"
          ? "全选：在全库里检索，仍受条数/长度上限。"
          : "按需：只注入勾选的；超预算时从末尾截断并在芯片上可见。"
    if (smartMatch) return base
    // 智能匹配已关：诚实说明退回的选择行为（预算仍生效）
    if (selectionMode === "auto") return `${base}（已关智能匹配：按当前站点+勾选注入。）`
    if (selectionMode === "all") return `${base}（已关智能匹配：不检索，按列表序注入，超预算截断。）`
    return base
  })()

  // #274: 文档行渲染（站点视图与文件夹手风琴共用同一份）。
  const renderDocRow = (doc: (typeof filteredDocs)[number]) => {
    const key = doc.id || doc.name
    const active = state.activeKnowledgeIds.includes(key) || state.activeKnowledgeIds.includes(doc.name)
    const rowBg = manageMode
      ? selectedForDelete.has(doc.name)
        ? tokens.dangerSoft
        : "transparent"
      : isManual && active
        ? tokens.bgActive
        : "transparent"
    const related = (doc.related || []).slice(0, 3)
    const tags = (doc.tags || []).slice(0, 4)
    return (
      <div
        key={key}
        data-knowledge-id={key}
        style={{
          ...styles.docRow,
          background: rowBg,
          outline: focusId && (focusId === doc.id || focusId === doc.name) ? `2px solid ${tokens.accent}` : undefined,
          cursor: manageMode ? "default" : "pointer",
        }}
        onClick={() => {
          if (!manageMode) openDoc(key)
        }}
      >
        {manageMode ? (
          <input
            type="checkbox"
            checked={selectedForDelete.has(doc.name)}
            disabled={!!doc.builtin}
            title={doc.builtin ? "内置文档不可删除" : "勾选以批量删除"}
            onChange={() => toggleDeleteSelect(doc.name)}
            onClick={(e) => e.stopPropagation()}
            style={{ marginRight: 8, flexShrink: 0 }}
          />
        ) : isManual ? (
          <input
            type="checkbox"
            checked={active}
            onClick={(e) => e.stopPropagation()}
            onChange={() => {
              const pin = key
              const activeKnowledgeIds = active
                ? state.activeKnowledgeIds.filter((id) => id !== pin && id !== doc.name)
                : [...state.activeKnowledgeIds, pin]
              dispatch({ type: "TOGGLE_KNOWLEDGE", knowledgeId: pin })
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
          <div style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {doc.title || doc.name}
            {doc.site && <span style={styles.siteBadge}>{doc.site}</span>}
            {tags.map((t: string) => (
              <span key={t} style={styles.siteBadge}>{t}</span>
            ))}
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
          {related.length > 0 && (
            <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 4 }}>
              相关
              {related.map((r: { id: string; title: string }) => (
                <button
                  key={r.id}
                  type="button"
                  style={styles.relatedChip}
                  onClick={(e) => {
                    e.stopPropagation()
                    openDoc(r.id)
                  }}
                >
                  {r.title}
                </button>
              ))}
            </div>
          )}
        </div>
        {doc.builtin && <span style={styles.badge}>内置</span>}
        {!doc.builtin && !manageMode && (
          <div style={{ position: "relative" }} ref={menuOpen === doc.name ? menuRef : undefined}>
            <button
              style={styles.menuBtn}
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(menuOpen === doc.name ? null : doc.name)
              }}
              title="更多操作"
            >
              ···
            </button>
            {menuOpen === doc.name && (
              <div style={styles.menuDropdown}>
                {/* #274: 「移到…」是验收必须项（id 不变，同桶内移动） */}
                <button
                  style={styles.menuItem}
                  onClick={(e) => {
                    e.stopPropagation()
                    setFolderEdit({ mode: "move", docId: key, value: doc.folder || "" })
                    setMenuOpen(null)
                  }}
                >
                  移到…
                </button>
                <button
                  style={styles.menuItem}
                  onClick={(e) => {
                    e.stopPropagation()
                    chrome.runtime.sendMessage({ type: "knowledge.export", id: key, user_gesture: true })
                    setMenuOpen(null)
                  }}
                >
                  下载 .md
                </button>
                <button
                  style={{ ...styles.menuItem, color: tokens.danger }}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(doc)
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // #274: 文件夹手风琴行（3 级）。说明灰字，空则「添加说明」；指纹变化标「可能过期」。
  const renderFolderNode = (node: KnowledgeFolderNode, depth: number): React.ReactNode => {
    const expanded = expandedFolders.has(node.path)
    const docCount = node.docs.length + node.children.reduce((s, c) => s + c.docs.length, 0)
    return (
      <div key={`${node.bucket}:${node.path}`}>
        <div
          style={{ ...styles.docRow, cursor: "pointer", paddingLeft: depth * 12 }}
          onClick={() => toggleFolder(node.path)}
          title={node.description || "添加说明"}
        >
          <span style={styles.modeGlyph} aria-hidden>{expanded ? "▾" : "▸"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>
              📁 {node.name}
              <span style={{ fontSize: 10, color: tokens.textMuted, marginLeft: 6 }}>{docCount} 篇</span>
              {node.stale && <span style={{ ...styles.siteBadge, marginLeft: 6 }}>可能过期</span>}
            </div>
            <div
              style={{
                fontSize: 11,
                color: tokens.textSecondary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              onClick={(e) => {
                if (node.description) return
                e.stopPropagation()
                setFolderEdit({ mode: "describe", bucket: node.bucket, path: node.path, value: "" })
              }}
            >
              {node.description || "添加说明"}
            </div>
          </div>
          {!manageMode && (
            <div style={{ position: "relative" }} ref={folderMenuOpen === node.path ? menuRef : undefined}>
              <button
                style={styles.menuBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  setFolderMenuOpen(folderMenuOpen === node.path ? null : node.path)
                }}
                title="文件夹操作"
              >
                ···
              </button>
              {folderMenuOpen === node.path && (
                <div style={styles.menuDropdown}>
                  <button
                    style={styles.menuItem}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleFolderSuggest(node.bucket, node.path)
                      setFolderMenuOpen(null)
                    }}
                  >
                    建议说明
                  </button>
                  <button
                    style={styles.menuItem}
                    onClick={(e) => {
                      e.stopPropagation()
                      setFolderEdit({ mode: "describe", bucket: node.bucket, path: node.path, value: node.description })
                      setFolderMenuOpen(null)
                    }}
                  >
                    编辑说明
                  </button>
                  {node.path.split("/").length < 3 && (
                    <button
                      style={styles.menuItem}
                      onClick={(e) => {
                        e.stopPropagation()
                        setFolderEdit({ mode: "create", bucket: node.bucket, value: `${node.path}/` })
                        setFolderMenuOpen(null)
                      }}
                    >
                      新建子文件夹
                    </button>
                  )}
                  <button
                    style={styles.menuItem}
                    onClick={(e) => {
                      e.stopPropagation()
                      setFolderEdit({ mode: "rename", bucket: node.bucket, path: node.path, value: node.path })
                      setFolderMenuOpen(null)
                    }}
                  >
                    重命名
                  </button>
                  <button
                    style={{ ...styles.menuItem, color: tokens.danger }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleFolderDelete(node.bucket, node.path, docCount > 0)
                      setFolderMenuOpen(null)
                    }}
                  >
                    删除文件夹
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {expanded && (
          <div>
            {node.docs.map(renderDocRow)}
            {node.children.map((c) => renderFolderNode(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

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
            title={mode === "auto" ? "按这轮问题选相关知识，当前站点加权" : mode === "all" ? "在全库里检索，有总量上限" : "仅使用勾选知识"}
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>
      {/* #273 Wave A: 智能匹配开关（manual 模式下勾选即全部语义，不显示） */}
      {!isManual && (
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: tokens.textSecondary, cursor: "pointer", marginBottom: 4 }}
          title="开：按这轮问题从知识库打分选文；关：按站点+勾选（全选模式为按列表序），注入总量上限仍生效"
        >
          <input
            type="checkbox"
            checked={smartMatch}
            onChange={(e) => handleSmartMatchChange(e.target.checked)}
            aria-label="智能匹配"
          />
          智能匹配
        </label>
      )}
      {/* #273 Wave B: 「按堆选文」开关（可选路由、默认关、只作用于自动模式——
          all/按需下不显示；智能匹配关掉时禁用并注明不生效）。
          2026-09-03 开闸后补可读的原理说明（开关下方灰字，用户知情决定）。 */}
      {selectionMode === "auto" && (
        <div style={{ marginBottom: 4 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: smartMatch ? tokens.textSecondary : tokens.textMuted,
              cursor: smartMatch ? "pointer" : "not-allowed",
            }}
            title={
              smartMatch
                ? "开：自动模式下先按分组粗选候选、再按这轮问题选文；关：直接按问题选文"
                : "智能匹配已关，按堆选文不生效（先打开智能匹配）"
            }
          >
            <input
              type="checkbox"
              checked={state.knowledgeRouteByGroup === true && smartMatch}
              disabled={!smartMatch}
              onChange={(e) => handleRouteByGroupChange(e.target.checked)}
              aria-label="按堆选文"
            />
            按堆选文
          </label>
          <div style={{ fontSize: 10, color: tokens.textMuted, lineHeight: 1.5, marginTop: 2, paddingLeft: 20 }}>
            {KNOWLEDGE_ROUTE_BY_GROUP_EXPLAIN_COPY}
          </div>
        </div>
      )}
      <div style={styles.modeHint}>{modeHint}</div>

      {/* Search + manage */}
      <div style={styles.searchRow}>
        <input
          style={styles.searchInput}
          type="search"
          placeholder="筛选知识（名称 / 描述 / 站点 / 标签 / 文件夹）"
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
        <button style={styles.toolbarBtn} onClick={handleFilePick} title="导入单个或多个文件（≤30 个，每篇 ≤6MB）">
          导入文件
        </button>
        <button
          style={styles.toolbarBtn}
          onClick={handleLargeFilePick}
          title="通过 Companion 原生选择器导入单个大文件（不经浏览器，最大 10MB）"
        >
          导入大文件
        </button>
        <button
          style={styles.toolbarBtn}
          onClick={handleFolderPick}
          title="通过 Companion 原生选择器导入整个文件夹（支持 Obsidian / iCloud vault，最多 200 篇笔记，每篇 ≤10MB）"
        >
          导入文件夹
        </button>
        <button style={styles.toolbarBtn} onClick={() => setShowUrlImport(!showUrlImport)} title="从 URL 导入">
          导入 URL
        </button>
        <button
          style={styles.toolbarBtn}
          onClick={() => setFolderEdit({ mode: "create", bucket: "global", value: "" })}
          title="在知识库里建文件夹（用 / 分层，最多 3 级）"
        >
          新建文件夹
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
      {/* #274 Gate8 N-1: 建议说明失败如实可见，不静默 */}
      {state.knowledgeFolderSuggest?.status === "error" && (
        <div style={{ fontSize: 11, color: tokens.danger, marginBottom: 8, padding: "2px 4px" }}>
          建议说明不可用{state.knowledgeFolderSuggest.error ? `（${state.knowledgeFolderSuggest.error}）` : ""}，可点「编辑说明」手动填写
        </div>
      )}

      {/* #274: 视图切换 站点|文件夹（默认文件夹） */}
      <div style={{ ...styles.modeSwitcher, marginBottom: 8 }}>
        {(["folder", "site"] as const).map((v) => (
          <button
            key={v}
            style={{
              ...styles.modeBtn,
              background: viewMode === v ? tokens.accent : tokens.bgElevated,
              color: viewMode === v ? "#fff" : tokens.textSecondary,
              borderColor: viewMode === v ? tokens.accent : tokens.border,
            }}
            onClick={() => setViewMode(v)}
            title={v === "folder" ? "按你建的文件夹浏览（最多 3 级）" : "按来源站点浏览"}
          >
            {v === "folder" ? "文件夹" : "站点"}
          </button>
        ))}
      </div>

      {/* #274: 文件夹/移动内联编辑行 */}
      {folderEdit && (
        <div style={styles.bulkBar}>
          <span style={{ fontSize: 11, color: tokens.textSecondary }}>
            {folderEdit.mode === "create"
              ? "新建文件夹（用 / 分层，最多 3 级）"
              : folderEdit.mode === "rename"
                ? `重命名 ${folderEdit.path}`
                : folderEdit.mode === "describe"
                  ? `说明：${folderEdit.path}`
                  : `移到…（留空 = 桶根）`}
          </span>
          <input
            style={styles.urlImportInput}
            type="text"
            value={folderEdit.value}
            placeholder={folderEdit.mode === "describe" ? "这个文件夹放什么（≤500 字）" : "如 竞品/2025"}
            onChange={(e) => setFolderEdit({ ...folderEdit, value: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && submitFolderEdit()}
          />
          <button type="button" style={styles.toolbarBtn} onClick={submitFolderEdit}>确认</button>
          <button type="button" style={styles.toolbarBtn} onClick={() => setFolderEdit(null)}>取消</button>
          {folderEdit.mode === "move" && moveTargets.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, width: "100%" }}>
              {moveTargets.slice(0, 12).map((t) => (
                <button
                  key={t}
                  type="button"
                  style={styles.relatedChip}
                  onClick={() => setFolderEdit({ ...folderEdit, value: t })}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* #273 Wave B §6.4: 分布过滤 chips（列表上方；点击 = 过滤，不是第三个视图）。
          诚实句强制在——没有它用户会把 chips 当成自己维护的层级分类。
          身份用稳定 key（标签碰撞过滤不错对象），displayLabel 仅显示。
          #296: chips 行右侧「分布图谱」入口（名词解禁仅此按钮）。 */}
      <div style={{ marginBottom: 8 }}>
        {distChips.length > 0 && (
          <div style={{ fontSize: 10, color: tokens.textMuted, marginBottom: 4 }}>
            {KNOWLEDGE_DISTRIBUTION_HONESTY_COPY}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }} aria-label="分布">
          {distChips.map((g) => {
            const activeChip = distFilter === g.key
            return (
              <button
                key={g.key}
                type="button"
                title={activeChip ? "取消过滤" : "只看这一组"}
                aria-pressed={activeChip}
                onClick={() => setDistFilter(activeChip ? null : g.key)}
                style={{
                  ...styles.relatedChip,
                  background: activeChip ? tokens.accentSoft : tokens.bgElevated,
                  borderColor: activeChip ? tokens.accent : tokens.border,
                }}
              >
                {g.displayLabel} · {g.count}
              </button>
            )
          })}
          <KnowledgeGraphEntryButton
            onClick={() => {
              chrome.runtime.sendMessage({ type: "knowledge_graph.open" }, () => {
                void chrome.runtime.lastError
              })
            }}
          />
        </div>
      </div>
      {/* #273 Wave B: 超 cap 诚实文案（不渲染 chips，不假装有分组） */}
      {distOverCap && (
        <div style={{ fontSize: 10, color: tokens.textMuted, marginBottom: 8 }}>
          {KNOWLEDGE_DISTRIBUTION_OVER_CAP_COPY}
        </div>
      )}

      {/* Grouped knowledge list */}
      {viewMode === "site"
        ? groupedDocs.map(([groupName, docs]) => (
            <div key={groupName}>
              <SectionHeader title={groupName} meta={docs.length} />
              {docs.map(renderDocRow)}
            </div>
          ))
        : (
          <div>
            {folderTree.tree.map((n) => renderFolderNode(n, 0))}
            {folderTree.rootDocs.length > 0 && (
              <div>
                <SectionHeader title="未归入文件夹" meta={folderTree.rootDocs.length} />
                {folderTree.rootDocs.map(renderDocRow)}
              </div>
            )}
            {folderTree.tree.length === 0 && folderTree.rootDocs.length === 0 && state.knowledgeDocs.length > 0 && (
              <div style={styles.emptyText}>无匹配「{query}」的知识</div>
            )}
          </div>
        )}

      {state.knowledgeDocs.length === 0 && (
        <div style={styles.emptyText}>暂无知识文档</div>
      )}
      {state.knowledgeDocs.length > 0 && filteredDocs.length === 0 && (
        <div style={styles.emptyText}>无匹配「{query}」的知识</div>
      )}
      <KnowledgeReaderSheet />
    </div>
  )
}

function KnowledgeReaderSheet() {
  const { state, dispatch } = useAgentStore()
  const doc = state.knowledgeViewer
  const suggest = state.knowledgeSuggest
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [body, setBody] = useState("")
  // #272 user-dirty: 建议说明/标签 fills only fields the user hasn't edited.
  const dirtyRef = useRef<{ description: boolean; tags: boolean }>({ description: false, tags: false })
  // N5/F1: 「AI 建议」 badge lights only for fields the suggestion actually wrote.
  const [aiFilled, setAiFilled] = useState<{ description: boolean; tags: boolean }>({
    description: false,
    tags: false,
  })
  useEffect(() => {
    if (!doc) return
    dirtyRef.current = { description: false, tags: false }
    setAiFilled({ description: false, tags: false })
    setTitle(doc.title || "")
    setDescription(doc.description || "")
    setTags((doc.tags || []).join(", "))
    setBody(doc.body || "")
  }, [doc])
  // #272: apply the suggest draft into the editable sheet (never persisted
  // until the user hits 保存 → existing knowledge.update path).
  const suggested = suggest?.status === "ok" && suggest.docId === (doc?.id || doc?.name) ? suggest.suggested : null
  useEffect(() => {
    if (!suggested) return
    const isLlm = suggested.source === "llm"
    const next = fillKnowledgeDraftFromSuggestion({ description, tags }, dirtyRef.current, suggested)
    const filledDescription = isLlm && !dirtyRef.current.description && !!suggested.description
    const filledTags = isLlm && !dirtyRef.current.tags && Array.isArray(suggested.tags) && suggested.tags.length > 0
    setDescription(next.description)
    setTags(next.tags)
    if (filledDescription || filledTags) {
      setAiFilled((cur) => ({
        description: cur.description || filledDescription,
        tags: cur.tags || filledTags,
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dirtyRef is the guard; re-running on keystrokes would fight the user
  }, [suggested])
  // M4: 15s watchdog aligned with the companion extraction timeout — a suggest
  // reply that never arrives (SW/companion died) must not pin 解读中….
  const suggestPending = suggest?.status === "pending" ? suggest.docId : null
  useEffect(() => {
    if (!suggestPending) return
    const docId = suggestPending
    // M4: watchdog aligned with the companion 15s extraction timeout (+2s RTT
    // margin so a late ok frame isn't preempted) — a suggest reply that never
    // arrives (SW/companion died) must not pin 解读中….
    const timer = setTimeout(() => {
      // The store applies this only while the request is still pending.
      dispatch({ type: "SET_KNOWLEDGE_SUGGEST", docId, status: "error", error: "解读超时，可手动填写" })
    }, 17000)
    return () => clearTimeout(timer)
  }, [suggestPending, dispatch])
  if (!doc) return null
  const tooBigToExport = doc.truncated || doc.char_count > 512 * 1024
  const readOnly = !!doc.builtin
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="查看知识"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 11000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={() => dispatch({ type: "SET_KNOWLEDGE_VIEWER", doc: null })}
    >
      <div
        style={{
          background: tokens.bg,
          width: "100%",
          maxHeight: "85%",
          overflow: "auto",
          padding: 12,
          borderRadius: "12px 12px 0 0",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <strong style={{ fontSize: 13 }}>正文</strong>
        <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>标题</label>
        <input value={title} disabled={readOnly} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%", fontSize: 12, padding: 6 }} />
        <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>
          说明
          {aiFilled.description && <span style={{ marginLeft: 6, fontSize: 10, color: tokens.accent }}>AI 建议</span>}
        </label>
        <input value={description} disabled={readOnly} onChange={(e) => { dirtyRef.current.description = true; setAiFilled((cur) => ({ ...cur, description: false })); setDescription(e.target.value) }} style={{ width: "100%", fontSize: 12, padding: 6 }} />
        <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>
          标签（逗号分隔）
          {aiFilled.tags && <span style={{ marginLeft: 6, fontSize: 10, color: tokens.accent }}>AI 建议</span>}
        </label>
        <input value={tags} disabled={readOnly} onChange={(e) => { dirtyRef.current.tags = true; setAiFilled((cur) => ({ ...cur, tags: false })); setTags(e.target.value) }} style={{ width: "100%", fontSize: 12, padding: 6 }} />
        <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>正文</label>
        {readOnly || doc.truncated ? (
          <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto", background: tokens.bgElevated, padding: 8 }}>
            {body}
          </pre>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            style={{ width: "100%", minHeight: 160, fontSize: 11, fontFamily: tokens.fontMono, padding: 8 }}
          />
        )}
        {tooBigToExport && (
          <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 6 }}>{KNOWLEDGE_TOO_BIG_DOWNLOAD_COPY}</div>
        )}
        {doc.truncated && !readOnly && (
          <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 6 }}>{KNOWLEDGE_TRUNCATED_BODY_SAVE_COPY}</div>
        )}
        {(doc.related || []).length > 0 && (
          <div style={{ fontSize: 11, marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
            相关
            {(doc.related || []).slice(0, 3).map((r) => (
              <button
                key={r.id}
                type="button"
                style={styles.relatedChip}
                onClick={() => chrome.runtime.sendMessage({ type: "knowledge.get", id: r.id })}
              >
                {r.title}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {!readOnly && (
            <>
              <button
                type="button"
                disabled={suggest?.status === "pending"}
                title="用 AI 为这篇文档起草说明与标签（草稿，保存才生效）"
                onClick={() => {
                  const key = doc.id || doc.name
                  dispatch({ type: "SET_KNOWLEDGE_SUGGEST", docId: key, status: "pending" })
                  // M4: surface a background send failure ({ok:false}) instead of
                  // pinning 解读中… forever (#270 knowledgePreviewSendFailureText 先例).
                  chrome.runtime.sendMessage({ type: "knowledge.suggest", id: key, user_gesture: true })
                    .then((resp: unknown) => {
                      const failure = knowledgePreviewSendFailureText(resp)
                      if (failure) {
                        dispatch({ type: "SET_KNOWLEDGE_SUGGEST", docId: key, status: "error", error: failure })
                      }
                    })
                    .catch(() => {
                      dispatch({ type: "SET_KNOWLEDGE_SUGGEST", docId: key, status: "error", error: "扩展后台未响应，请重载扩展后重试" })
                    })
                }}
              >
                {suggest?.status === "pending" ? "解读中…" : "建议说明/标签"}
              </button>
              {suggest?.status === "error" && suggest.docId === (doc.id || doc.name) && (
                <span style={{ fontSize: 11, color: tokens.textMuted, alignSelf: "center" }}>
                  {suggest.error ? `解读不可用（${suggest.error}），可手动填写` : "解读不可用，可手动填写"}
                </span>
              )}
            </>
          )}
          <button type="button" onClick={() => dispatch({ type: "SET_KNOWLEDGE_VIEWER", doc: null })}>关闭</button>
          <button
            type="button"
            disabled={tooBigToExport}
            onClick={() => chrome.runtime.sendMessage({ type: "knowledge.export", id: doc.id, user_gesture: true })}
          >
            下载 .md
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                if (!confirm("确认保存对这篇知识的修改？")) return
                chrome.runtime.sendMessage(buildKnowledgeUpdateMessage({
                  id: doc.id,
                  truncated: !!doc.truncated,
                  title,
                  description,
                  tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
                  body,
                }))
              }}
            >
              保存
            </button>
          )}
        </div>
      </div>
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
  relatedChip: {
    border: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    color: tokens.textSecondary,
    borderRadius: 10,
    fontSize: 10,
    padding: "1px 7px",
    cursor: "pointer",
    fontFamily: tokens.font,
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
