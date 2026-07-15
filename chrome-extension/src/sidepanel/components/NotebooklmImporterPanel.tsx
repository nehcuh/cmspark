// NotebookLM Importer side-panel overlay (v1.2 — full pathway coverage).
//
// Tabs:
//   URLs     — bulk paste (v1.1)
//   Links    — extract from current tab (v1.2 Phase C)
//   RSS      — RSS/Atom/OPML (v1.2 Phase D)
//   YouTube  — playlist expansion (v1.2 Phase E)
//   AI Chat  — Claude/ChatGPT/Gemini (v1.2 Phase A)
//
// Notebook picker includes "+ 新建 notebook" button (v1.2 Phase B).

import { useEffect, useRef, useState } from "react"
import type { BatchState, ImportItem, NotebookInfo } from "../../notebooklm/types"
import type { ExtractedLink } from "../../notebooklm/page-link-extractor"
import type { FeedEntry } from "../../notebooklm/rss-parser"
import type { YouTubeVideo } from "../../notebooklm/youtube-api"

type TabKey = "urls" | "links" | "rss" | "youtube" | "ai-chat"

interface Props {
  onClose: () => void
}

const PANEL_WIDTH = 720
const PANEL_HEIGHT = 720

export function NotebooklmImporterPanel({ onClose }: Props) {
  const [tab, setTab] = useState<TabKey>("urls")
  const [notebooks, setNotebooks] = useState<NotebookInfo[]>([])
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>("")
  const [loadingNotebooks, setLoadingNotebooks] = useState(false)
  const [notebookError, setNotebookError] = useState<string>("")
  const [batch, setBatch] = useState<BatchState | null>(null)
  const [creatingNotebook, setCreatingNotebook] = useState(false)

  // Per-tab state
  const [urlText, setUrlText] = useState("")

  // Links
  const [links, setLinks] = useState<ExtractedLink[]>([])
  const [linkFilter, setLinkFilter] = useState<{ internal: boolean; external: boolean; document: boolean; media: boolean }>({ internal: true, external: true, document: true, media: false })
  const [loadingLinks, setLoadingLinks] = useState(false)

  // RSS
  const [feedUrl, setFeedUrl] = useState("")
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([])
  const [feedTitle, setFeedTitle] = useState("")
  const [loadingFeed, setLoadingFeed] = useState(false)

  // YouTube
  const [ytUrl, setYtUrl] = useState("")
  const [ytVideos, setYtVideos] = useState<YouTubeVideo[]>([])
  const [loadingYt, setLoadingYt] = useState(false)
  const [ytApiKey, setYtApiKey] = useState("")
  const [showYtKeyInput, setShowYtKeyInput] = useState(false)

  // AI Chat
  const [aiPreview, setAiPreview] = useState("")
  const [aiPlatform, setAiPlatform] = useState("")
  const [loadingAi, setLoadingAi] = useState(false)

  // Track selected items per tab (URLs are derived from urlText; others use explicit sets)
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set())
  const [selectedFeedEntries, setSelectedFeedEntries] = useState<Set<string>>(new Set())
  const [selectedYtVideos, setSelectedYtVideos] = useState<Set<string>>(new Set())

  const startingRef = useRef(false)
  const [starting, setStarting] = useState(false)

  // ---- notebook list refresh ----
  const refreshNotebooks = async () => {
    setLoadingNotebooks(true)
    setNotebookError("")
    try {
      const res = (await chrome.runtime.sendMessage({ type: "notebooklm.list_notebooks" })) as
        | { ok?: boolean; authFailed?: boolean; notebooks?: NotebookInfo[]; error?: string }
        | undefined
      if (res?.ok && res.notebooks) {
        setNotebooks(res.notebooks)
        if (res.notebooks.length > 0 && !selectedNotebookId) setSelectedNotebookId(res.notebooks[0].id)
      } else if (res?.authFailed) {
        setNotebookError(res.error || "未登录 NotebookLM")
      } else {
        setNotebookError(res?.error || "未获取到 notebook")
      }
    } catch (e: any) {
      setNotebookError(e?.message || String(e))
    } finally {
      setLoadingNotebooks(false)
    }
  }
  useEffect(() => { refreshNotebooks() }, [])

  // ---- batch progress subscription ----
  useEffect(() => {
    const listener = (msg: any) => {
      if (msg?.type === "notebooklm.batch_progress" && msg.state) setBatch(msg.state as BatchState)
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "notebooklm.get_batch_state" }).then((res: any) => {
      if (res?.ok && res.state) setBatch(res.state as BatchState)
    }).catch(() => {})
  }, [])

  // ---- helpers ----
  const parseUrlItems = (): ImportItem[] =>
    urlText.split(/[\n,]/).map(s => s.trim()).filter(s => s.length > 0)
      .map(s => ({ url: s.startsWith("http") ? s : `https://${s}` }))

  const collectItems = (): ImportItem[] => {
    if (tab === "urls") return parseUrlItems()
    if (tab === "links") return Array.from(selectedLinks).map(url => ({ url }))
    if (tab === "rss") return Array.from(selectedFeedEntries).map(url => ({ url }))
    if (tab === "youtube") return Array.from(selectedYtVideos).map(url => ({ url }))
    if (tab === "ai-chat") return aiPreview ? [{ text: aiPreview }] : []
    return []
  }

  const handleStart = async () => {
    if (startingRef.current) return
    const items = collectItems()
    if (items.length === 0) {
      alert("请先选择至少一个源")
      return
    }
    if (items.length > 50) {
      if (!confirm(`一次最多导入 50 个源（你选了 ${items.length} 个）。将截断到前 50 个，继续？`)) return
    }
    startingRef.current = true
    setStarting(true)
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "notebooklm.start_batch",
        items,
        notebook_id: selectedNotebookId || undefined,
      })) as { ok?: boolean; state?: BatchState; error?: string } | undefined
      if (!res?.ok || !res.state) alert(`启动失败：${res?.error || "未知错误"}`)
      else setBatch(res.state)
    } catch (e: any) {
      alert(`启动异常：${e?.message || String(e)}`)
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm("确认取消当前导入批次？")) return
    try { await chrome.runtime.sendMessage({ type: "notebooklm.cancel_batch" }) }
    catch (e: any) { alert(`取消异常：${e?.message || String(e)}`) }
  }

  const handleCreateNotebook = async () => {
    const name = prompt("新 Notebook 名称：")
    if (!name || !name.trim()) return
    setCreatingNotebook(true)
    try {
      const res = (await chrome.runtime.sendMessage({ type: "notebooklm.create_notebook", name: name.trim() })) as
        | { ok?: boolean; notebookId?: string; error?: string }
        | undefined
      if (res?.ok && res.notebookId) {
        setSelectedNotebookId(res.notebookId)
        setNotebooks(prev => [{ id: res.notebookId!, title: name.trim() }, ...prev])
      } else {
        alert(`创建失败：${res?.error || "未知错误"}`)
      }
    } catch (e: any) {
      alert(`创建异常：${e?.message || String(e)}`)
    } finally {
      setCreatingNotebook(false)
    }
  }

  // ---- per-tab actions ----
  const handleAddCurrentTab = async () => {
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!t?.url?.startsWith("http")) { alert("当前 tab 不是 http(s)"); return }
      setUrlText(prev => (prev.trim() ? prev + "\n" + t.url : t.url!))
    } catch (e: any) { alert(`获取当前 tab 失败：${e?.message || String(e)}`) }
  }
  const handleAddAllTabs = async () => {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const urls = tabs.filter(t => t.url?.startsWith("http")).map(t => t.url!)
      if (!urls.length) { alert("当前窗口没有 http(s) tab"); return }
      setUrlText(prev => {
        const existing = prev.trim() ? prev.split("\n") : []
        return Array.from(new Set([...existing, ...urls])).join("\n")
      })
    } catch (e: any) { alert(`获取 tab 失败：${e?.message || String(e)}`) }
  }

  const handleExtractLinks = async () => {
    setLoadingLinks(true)
    try {
      const res = (await chrome.runtime.sendMessage({ type: "notebooklm.extract_page_links" })) as
        | { ok?: boolean; links?: ExtractedLink[]; error?: string }
        | undefined
      if (res?.ok && res.links) {
        setLinks(res.links)
        // Pre-select internal+external+document by default (media deselected)
        const filtered = res.links.filter(l => l.category !== "media").map(l => l.url)
        setSelectedLinks(new Set(filtered))
      } else {
        alert(`抽取失败：${res?.error || "未知"}`)
      }
    } catch (e: any) { alert(`异常：${e?.message || String(e)}`) }
    finally { setLoadingLinks(false) }
  }

  const handleFetchFeed = async () => {
    if (!feedUrl.trim()) return
    setLoadingFeed(true)
    try {
      const res = (await chrome.runtime.sendMessage({ type: "notebooklm.fetch_feed", url: feedUrl.trim() })) as
        | { ok?: boolean; feed?: { title: string; entries: FeedEntry[] }; discoveredFrom?: string; error?: string }
        | undefined
      if (res?.ok && res.feed) {
        setFeedTitle(res.feed.title)
        setFeedEntries(res.feed.entries)
        setSelectedFeedEntries(new Set(res.feed.entries.map(e => e.url)))
      } else {
        alert(`解析失败：${res?.error || "未知"}${res?.discoveredFrom ? `\n发现候选: ${res.discoveredFrom}` : ""}`)
      }
    } catch (e: any) { alert(`异常：${e?.message || String(e)}`) }
    finally { setLoadingFeed(false) }
  }

  const handleFetchYouTube = async () => {
    if (!ytUrl.trim()) return
    setLoadingYt(true)
    try {
      const res = (await chrome.runtime.sendMessage({ type: "notebooklm.fetch_youtube_playlist", url: ytUrl.trim() })) as
        | { ok?: boolean; videos?: YouTubeVideo[]; error?: string }
        | undefined
      if (res?.ok && res.videos) {
        setYtVideos(res.videos)
        // Filter out shorts (<90s) by default; select the rest
        const filtered = res.videos.filter(v => !v.durationSeconds || v.durationSeconds >= 90).map(v => v.url)
        setSelectedYtVideos(new Set(filtered))
      } else {
        alert(`获取失败：${res?.error || "未知"}`)
      }
    } catch (e: any) { alert(`异常：${e?.message || String(e)}`) }
    finally { setLoadingYt(false) }
  }

  const handleExtractAiChat = async () => {
    setLoadingAi(true)
    setAiPreview("")
    setAiPlatform("")
    try {
      const res = (await chrome.runtime.sendMessage({ type: "notebooklm.extract_ai_chat" })) as
        | { ok?: boolean; text?: string; platform?: string; error?: string }
        | undefined
      if (res?.ok && res.text) {
        setAiPreview(res.text)
        setAiPlatform(res.platform || "unknown")
      } else {
        alert(`抽取失败：${res?.error || "未知"}`)
      }
    } catch (e: any) { alert(`异常：${e?.message || String(e)}`) }
    finally { setLoadingAi(false) }
  }

  const handleSaveYtKey = async () => {
    try {
      await chrome.runtime.sendMessage({ type: "notebooklm.set_youtube_api_key", key: ytApiKey.trim() })
      setShowYtKeyInput(false)
      alert("已保存")
    } catch (e: any) { alert(`保存失败：${e?.message || String(e)}`) }
  }

  // ---- progress display ----
  const isRunning = batch?.status === "running"
  const succeeded = batch?.results?.filter(r => r?.ok).length || 0
  const failed = batch?.results?.filter(r => r && !r.ok).length || 0
  const total = batch?.items?.length || 0
  const progressPct = total > 0 && batch ? Math.floor((batch.results.filter(r => r !== undefined).length / total) * 100) : 0

  const collectedCount = collectItems().length

  return (
    <div style={overlayStyle}>
      <div style={{ ...panelStyle, width: PANEL_WIDTH, height: PANEL_HEIGHT }}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>📓 NotebookLM 导入器</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={refreshNotebooks} disabled={loadingNotebooks} style={btnStyle} title="刷新 notebook 列表">
              {loadingNotebooks ? "⏳" : "🔄"}
            </button>
            <button onClick={onClose} style={btnStyle} title="关闭">✕</button>
          </div>
        </div>

        <div style={bodyStyle}>
          {/* Notebook picker */}
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>目标 Notebook</div>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={selectedNotebookId}
                onChange={e => setSelectedNotebookId(e.target.value)}
                disabled={loadingNotebooks || isRunning}
                style={{ ...selectStyle, flex: 1 }}
              >
                <option value="">（使用当前打开的 Notebook）</option>
                {notebooks.map(nb => <option key={nb.id} value={nb.id}>{nb.title}</option>)}
              </select>
              <button
                onClick={handleCreateNotebook}
                disabled={creatingNotebook || isRunning}
                style={btnStyle}
                title="创建新 notebook"
              >
                {creatingNotebook ? "⏳" : "➕ 新建"}
              </button>
            </div>
            {notebookError && <div style={errorStyle}>{notebookError}</div>}
            <div style={hintStyle}>
              {notebooks.length > 0 ? `找到 ${notebooks.length} 个 notebook` : loadingNotebooks ? "正在获取..." : "未获取到（确认已登录 NotebookLM）"}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginTop: 12, borderBottom: "1px solid #eee" }}>
            {([
              { k: "urls", label: "🔗 URLs" },
              { k: "links", label: "📄 页面链接" },
              { k: "rss", label: "📡 RSS/OPML" },
              { k: "youtube", label: "▶️ YouTube" },
              { k: "ai-chat", label: "🤖 AI 对话" },
            ] as Array<{ k: TabKey; label: string }>).map(t => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                style={{
                  ...tabBtnStyle,
                  ...(tab === t.k ? { background: "#1a73e8", color: "#fff", borderColor: "#1a73e8" } : {}),
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: "auto", marginTop: 12 }}>
            {tab === "urls" && (
              <div>
                <textarea
                  value={urlText}
                  onChange={e => setUrlText(e.target.value)}
                  placeholder={"一行一个 URL（或用逗号分隔）\nhttps://example.com/a\nhttps://example.com/b"}
                  disabled={isRunning}
                  style={textareaStyle}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={handleAddCurrentTab} disabled={isRunning} style={btnStyle}>+ 当前 tab</button>
                  <button onClick={handleAddAllTabs} disabled={isRunning} style={btnStyle}>+ 所有 tab</button>
                  <span style={{ ...hintStyle, marginLeft: "auto" }}>{parseUrlItems().length} 个有效 URL</span>
                </div>
              </div>
            )}

            {tab === "links" && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <button onClick={handleExtractLinks} disabled={loadingLinks || isRunning} style={btnStyle}>
                    {loadingLinks ? "抽取中..." : "抽取当前页面链接"}
                  </button>
                  <span style={{ ...hintStyle, marginLeft: "auto" }}>
                    {selectedLinks.size}/{links.length} 选中
                  </span>
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 11, marginBottom: 6 }}>
                  {(["internal", "external", "document", "media"] as const).map(cat => (
                    <label key={cat} style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={linkFilter[cat]}
                        onChange={e => {
                          const next = { ...linkFilter, [cat]: e.target.checked }
                          setLinkFilter(next)
                          const visible = links.filter(l => next[l.category])
                          setSelectedLinks(new Set(visible.map(l => l.url)))
                        }}
                      />{" "}
                      {cat}
                    </label>
                  ))}
                </div>
                <div style={itemListStyle}>
                  {links.length === 0 && <div style={emptyHintStyle}>点击上方按钮抽取当前页面所有链接</div>}
                  {links.filter(l => linkFilter[l.category]).map(l => (
                    <label key={l.url} style={{ ...itemStyle, cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={selectedLinks.has(l.url)}
                        onChange={e => {
                          const next = new Set(selectedLinks)
                          if (e.target.checked) next.add(l.url); else next.delete(l.url)
                          setSelectedLinks(next)
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{l.text}</div>
                        <div style={{ fontSize: 11, color: "#666", wordBreak: "break-all" }}>{l.url}</div>
                        <span style={{ fontSize: 10, padding: "1px 5px", background: "#eee", borderRadius: 3 }}>{l.category}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {tab === "rss" && (
              <div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="url"
                    value={feedUrl}
                    onChange={e => setFeedUrl(e.target.value)}
                    placeholder="feed URL 或网站 URL（自动发现）"
                    disabled={isRunning}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={handleFetchFeed} disabled={loadingFeed || isRunning} style={btnStyle}>
                    {loadingFeed ? "..." : "Fetch"}
                  </button>
                </div>
                {feedTitle && <div style={hintStyle}>📂 {feedTitle} · {feedEntries.length} 条</div>}
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="file"
                    accept=".opml,application/xml,text/xml"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      const text = await f.text()
                      const res = (await chrome.runtime.sendMessage({ type: "notebooklm.parse_opml", text })) as
                        | { ok?: boolean; feeds?: Array<{ title: string; xmlUrl: string }> }
                        | undefined
                      if (res?.ok && res.feeds) {
                        const fetchRes = (await chrome.runtime.sendMessage({
                          type: "notebooklm.fetch_multiple_feeds",
                          urls: res.feeds.map(f => f.xmlUrl),
                        })) as { ok?: boolean; feeds?: Array<{ title: string; entries: FeedEntry[] }> } | undefined
                        if (fetchRes?.feeds) {
                          const all = fetchRes.feeds.flatMap(f => f.entries)
                          setFeedEntries(all)
                          setSelectedFeedEntries(new Set(all.map(e => e.url)))
                          setFeedTitle(`OPML (${fetchRes.feeds.length} feeds merged)`)
                        }
                      }
                    }}
                  />
                  <span style={hintStyle}>或导入 OPML 文件</span>
                </div>
                <div style={{ ...itemListStyle, marginTop: 8 }}>
                  {feedEntries.length === 0 && <div style={emptyHintStyle}>输入 feed URL 或导入 OPML</div>}
                  {feedEntries.map(e => (
                    <label key={e.url} style={{ ...itemStyle, display: "flex", gap: 6, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedFeedEntries.has(e.url)}
                        onChange={ev => {
                          const next = new Set(selectedFeedEntries)
                          if (ev.target.checked) next.add(e.url); else next.delete(e.url)
                          setSelectedFeedEntries(next)
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{e.title}</div>
                        <div style={{ fontSize: 11, color: "#666" }}>{e.author || ""} {e.publishedAt ? `· ${new Date(e.publishedAt).toLocaleDateString()}` : ""}</div>
                        <div style={{ fontSize: 11, color: "#999", wordBreak: "break-all" }}>{e.url}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {tab === "youtube" && (
              <div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="url"
                    value={ytUrl}
                    onChange={e => setYtUrl(e.target.value)}
                    placeholder="https://www.youtube.com/playlist?list=..."
                    disabled={isRunning}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={handleFetchYouTube} disabled={loadingYt || isRunning} style={btnStyle}>
                    {loadingYt ? "..." : "Fetch"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                  <button onClick={() => setShowYtKeyInput(s => !s)} style={btnStyle}>🔑 API key</button>
                  <span style={hintStyle}>需要 YouTube Data API v3 key</span>
                </div>
                {showYtKeyInput && (
                  <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                    <input
                      type="password"
                      value={ytApiKey}
                      onChange={e => setYtApiKey(e.target.value)}
                      placeholder="YouTube API key"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button onClick={handleSaveYtKey} style={btnStyle}>保存</button>
                  </div>
                )}
                <div style={{ ...itemListStyle, marginTop: 8 }}>
                  {ytVideos.length === 0 && <div style={emptyHintStyle}>输入 playlist URL</div>}
                  {ytVideos.map(v => (
                    <label key={v.url} style={{ ...itemStyle, display: "flex", gap: 6, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedYtVideos.has(v.url)}
                        onChange={e => {
                          const next = new Set(selectedYtVideos)
                          if (e.target.checked) next.add(v.url); else next.delete(v.url)
                          setSelectedYtVideos(next)
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{v.title}</div>
                        <div style={{ fontSize: 11, color: "#666" }}>{v.channelTitle} · {v.durationSeconds ? `${Math.floor(v.durationSeconds / 60)}m${v.durationSeconds % 60}s` : ""}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {tab === "ai-chat" && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <button onClick={handleExtractAiChat} disabled={loadingAi || isRunning} style={btnStyle}>
                    {loadingAi ? "抽取中..." : "从当前 tab 抽取对话"}
                  </button>
                  <span style={hintStyle}>支持 Claude / ChatGPT / Gemini</span>
                </div>
                {aiPlatform && <div style={hintStyle}>检测到平台: {aiPlatform}</div>}
                <textarea
                  value={aiPreview}
                  onChange={e => setAiPreview(e.target.value)}
                  placeholder="抽取后会显示在这里（可编辑后再导入）"
                  disabled={isRunning}
                  style={{ ...textareaStyle, minHeight: 200 }}
                />
                <div style={hintStyle}>{aiPreview.length} 字符</div>
              </div>
            )}
          </div>

          {/* Action */}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={starting || collectedCount === 0}
                style={{ ...primaryBtnStyle, opacity: starting || collectedCount === 0 ? 0.5 : 1 }}
              >
                {starting ? "启动中..." : `导入 ${Math.min(collectedCount, 50)} 个源`}
              </button>
            ) : (
              <button onClick={handleCancel} style={dangerBtnStyle}>取消批次</button>
            )}
          </div>

          {/* Progress */}
          {batch && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>进度</div>
              <div style={progressContainerStyle}>
                <div
                  style={{
                    ...progressBarStyle,
                    width: `${progressPct}%`,
                    background: failed > 0 && batch.status === "done" ? "#FFA726" : "#4CAF50",
                  }}
                />
              </div>
              <div style={hintStyle}>
                {batch.results.filter(r => r !== undefined).length} / {total} · 成功 {succeeded} · 失败 {failed} · 状态 {batch.status}
              </div>
              <div style={{ ...itemListStyle, marginTop: 8, maxHeight: 120 }}>
                {batch.items.map((item, idx) => {
                  const r = batch.results[idx]
                  const status = !r ? "⏳" : r.ok ? "✓" : "✗"
                  const color = !r ? "#999" : r.ok ? "#4CAF50" : "#F44336"
                  return (
                    <div key={idx} style={{ ...itemStyle, borderLeft: `3px solid ${color}` }}>
                      <span style={{ marginRight: 8 }}>{status}</span>
                      <span style={{ wordBreak: "break-all", fontSize: 12 }}>
                        {item.url || "(text)"} {r?.error && <span style={{ color: "#F44336" }}>— {r.error}</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- styles ----------
const overlayStyle: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0,0,0,0.5)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center",
}
const panelStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 8,
  display: "flex", flexDirection: "column", overflow: "hidden",
  boxShadow: "0 12px 48px rgba(0,0,0,0.3)",
}
const headerStyle: React.CSSProperties = {
  padding: "12px 16px", borderBottom: "1px solid #eee",
  display: "flex", justifyContent: "space-between", alignItems: "center",
}
const bodyStyle: React.CSSProperties = { flex: 1, padding: 16, overflowY: "auto", display: "flex", flexDirection: "column" }
const selectStyle: React.CSSProperties = { padding: 8, border: "1px solid #ddd", borderRadius: 4, fontSize: 14 }
const inputStyle: React.CSSProperties = { padding: 8, border: "1px solid #ddd", borderRadius: 4, fontSize: 13 }
const textareaStyle: React.CSSProperties = {
  width: "100%", minHeight: 120, padding: 8, border: "1px solid #ddd", borderRadius: 4,
  fontSize: 13, fontFamily: "monospace", boxSizing: "border-box",
}
const btnStyle: React.CSSProperties = {
  padding: "6px 10px", border: "1px solid #ddd", background: "#f8f8f8",
  borderRadius: 4, cursor: "pointer", fontSize: 13,
}
const tabBtnStyle: React.CSSProperties = {
  padding: "8px 12px", border: "1px solid #ddd", borderBottom: "none",
  background: "#f5f5f5", cursor: "pointer", fontSize: 13, borderRadius: "4px 4px 0 0",
}
const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 16px", border: "none", background: "#1a73e8", color: "#fff",
  borderRadius: 4, cursor: "pointer", fontSize: 14, fontWeight: 500, flex: 1,
}
const dangerBtnStyle: React.CSSProperties = {
  padding: "10px 16px", border: "none", background: "#F44336", color: "#fff",
  borderRadius: 4, cursor: "pointer", fontSize: 14, fontWeight: 500, flex: 1,
}
const hintStyle: React.CSSProperties = { fontSize: 11, color: "#999", marginTop: 4 }
const errorStyle: React.CSSProperties = {
  padding: 8, background: "#FFF3CD", border: "1px solid #FFC107",
  borderRadius: 4, fontSize: 12, marginTop: 4,
}
const progressContainerStyle: React.CSSProperties = { width: "100%", height: 8, background: "#eee", borderRadius: 4, overflow: "hidden" }
const progressBarStyle: React.CSSProperties = { height: "100%", transition: "width 0.3s" }
const itemListStyle: React.CSSProperties = {
  border: "1px solid #eee", borderRadius: 4, overflowY: "auto", maxHeight: 200,
}
const itemStyle: React.CSSProperties = {
  padding: "6px 8px", borderBottom: "1px solid #f5f5f5",
}
const emptyHintStyle: React.CSSProperties = {
  padding: 16, fontSize: 12, color: "#999", textAlign: "center",
}
