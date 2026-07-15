// NotebookLM Importer side-panel overlay.
//
// v1.1 UI: select target notebook + bulk-paste URLs or "add current/all tabs" →
// orchestrator runs in BG, persists after every item. Shows live progress +
// retry-failed. Two-way messaging via chrome.runtime.sendMessage.
//
// Per Round 1 advisor consensus: NO silent fallback to offline MD — explicit choice.
// The offline 💾 button lives separately in the header.

import { useEffect, useRef, useState } from "react"
import type { BatchState, ImportItem, NotebookInfo } from "../../notebooklm/types"

interface Props {
  onClose: () => void
}

const PANEL_WIDTH = 560 // wider than 320 side panel — opens as a detached overlay
const PANEL_HEIGHT = 640

export function NotebooklmImporterPanel({ onClose }: Props) {
  const [notebooks, setNotebooks] = useState<NotebookInfo[]>([])
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>("")
  const [urlText, setUrlText] = useState<string>("")
  const [loadingNotebooks, setLoadingNotebooks] = useState(false)
  const [notebookError, setNotebookError] = useState<string>("")
  const [batch, setBatch] = useState<BatchState | null>(null)
  const [starting, setStarting] = useState(false)
  // Phase 5 review: synchronous ref lock — React state is async so two rapid clicks
  // could both pass the `starting` guard before setStarting commits.
  const startingRef = useRef(false)

  // Fetch notebooks on mount
  const refreshNotebooks = async () => {
    setLoadingNotebooks(true)
    setNotebookError("")
    try {
      const res = (await chrome.runtime.sendMessage({ type: "notebooklm.list_notebooks" })) as
        | { ok?: boolean; authFailed?: boolean; notebooks?: NotebookInfo[]; error?: string }
        | undefined
      if (res?.ok && res.notebooks) {
        setNotebooks(res.notebooks)
        if (res.notebooks.length > 0 && !selectedNotebookId) {
          setSelectedNotebookId(res.notebooks[0].id)
        }
        setNotebookError("")
      } else if (res?.authFailed) {
        setNotebookError(res.error || "未登录 NotebookLM — 请先打开 NotebookLM 并登录 Google 账号")
      } else {
        setNotebookError(res?.error || "未获取到 notebook（确认你已登录 NotebookLM）")
      }
    } catch (e: any) {
      setNotebookError(e?.message || String(e))
    } finally {
      setLoadingNotebooks(false)
    }
  }

  useEffect(() => {
    refreshNotebooks()
  }, [])

  // Subscribe to batch progress
  useEffect(() => {
    const listener = (msg: any) => {
      if (msg?.type === "notebooklm.batch_progress" && msg.state) {
        setBatch(msg.state as BatchState)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // Poll current state on mount (in case SW resumed an in-flight batch)
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "notebooklm.get_batch_state" }).then((res: any) => {
      if (res?.ok && res.state) setBatch(res.state as BatchState)
    }).catch(() => {})
  }, [])

  const parseItems = (): ImportItem[] => {
    return urlText
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => ({
        url: s.startsWith("http://") || s.startsWith("https://") ? s : `https://${s}`,
      }))
  }

  const handleStart = async () => {
    // Phase 5 review: synchronous lock to prevent double-click race
    if (startingRef.current) return
    startingRef.current = true
    setStarting(true)
    try {
      const items = parseItems()
      if (items.length === 0) {
        alert("请粘贴至少一个 URL")
        return
      }
      if (items.length > 50) {
        const ok = confirm(`一次最多导入 50 个源（你粘贴了 ${items.length} 个）。将截断到前 50 个，继续？`)
        if (!ok) return
      }
      const res = (await chrome.runtime.sendMessage({
        type: "notebooklm.start_batch",
        items,
        notebook_id: selectedNotebookId || undefined,
      })) as { ok?: boolean; state?: BatchState; error?: string } | undefined
      if (!res?.ok || !res.state) {
        alert(`启动失败：${res?.error || "未知错误"}`)
      } else {
        setBatch(res.state)
      }
    } catch (e: any) {
      alert(`启动异常：${e?.message || String(e)}`)
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm("确认取消当前导入批次？")) return
    try {
      await chrome.runtime.sendMessage({ type: "notebooklm.cancel_batch" })
    } catch (e: any) {
      alert(`取消异常：${e?.message || String(e)}`)
    }
  }

  const handleAddCurrentTab = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.url || !(tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
        alert("当前 tab 不是 http(s) 页面")
        return
      }
      setUrlText(prev => (prev.trim() ? prev + "\n" + tab.url : tab.url!))
    } catch (e: any) {
      alert(`获取当前 tab 失败：${e?.message || String(e)}`)
    }
  }

  const handleAddAllTabs = async () => {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const urls = tabs
        .filter(t => t.url && (t.url.startsWith("http://") || t.url.startsWith("https://")))
        .map(t => t.url!)
      if (urls.length === 0) {
        alert("当前窗口没有 http(s) tab")
        return
      }
      setUrlText(prev => {
        const existing = prev.trim() ? prev.split("\n") : []
        const merged = Array.from(new Set([...existing, ...urls]))
        return merged.join("\n")
      })
    } catch (e: any) {
      alert(`获取所有 tab 失败：${e?.message || String(e)}`)
    }
  }

  const itemsPreview = parseItems()
  const isRunning = batch?.status === "running"
  const succeeded = batch?.results?.filter(r => r?.ok).length || 0
  const failed = batch?.results?.filter(r => r && !r.ok).length || 0
  const total = batch?.items?.length || 0
  const progressPct = total > 0 && batch ? Math.floor((batch.results.filter(r => r !== undefined).length / total) * 100) : 0

  return (
    <div style={overlayStyle}>
      <div style={{ ...panelStyle, width: PANEL_WIDTH, height: PANEL_HEIGHT }}>
        <Header onClose={onClose} onRefresh={refreshNotebooks} loadingNotebooks={loadingNotebooks} />
        <div style={bodyStyle}>
          {/* Notebook picker */}
          <Section title="目标 Notebook">
            {notebookError && <div style={errorStyle}>{notebookError}</div>}
            <select
              value={selectedNotebookId}
              onChange={e => setSelectedNotebookId(e.target.value)}
              disabled={loadingNotebooks || isRunning}
              style={selectStyle}
            >
              <option value="">（使用当前打开的 Notebook）</option>
              {notebooks.map(nb => (
                <option key={nb.id} value={nb.id}>
                  {nb.title}
                </option>
              ))}
            </select>
            <div style={hintStyle}>
              {notebooks.length > 0
                ? `找到 ${notebooks.length} 个 notebook`
                : loadingNotebooks
                ? "正在获取..."
                : "未获取到（确认已登录 NotebookLM）"}
            </div>
          </Section>

          {/* URL input */}
          <Section title="URL 列表">
            <textarea
              value={urlText}
              onChange={e => setUrlText(e.target.value)}
              placeholder={"一行一个 URL（或用逗号分隔）\nhttps://example.com/article1\nhttps://example.com/article2"}
              disabled={isRunning}
              style={textareaStyle}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={handleAddCurrentTab} disabled={isRunning} style={btnStyle}>
                + 当前 tab
              </button>
              <button onClick={handleAddAllTabs} disabled={isRunning} style={btnStyle}>
                + 所有 tab
              </button>
              <span style={{ ...hintStyle, marginLeft: "auto" }}>{itemsPreview.length} 个有效 URL</span>
            </div>
          </Section>

          {/* Action */}
          <div style={{ display: "flex", gap: 8 }}>
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={starting || itemsPreview.length === 0}
                style={{ ...primaryBtnStyle, opacity: starting || itemsPreview.length === 0 ? 0.5 : 1 }}
              >
                {starting ? "启动中..." : `导入 ${Math.min(itemsPreview.length, 50)} 个源`}
              </button>
            ) : (
              <button onClick={handleCancel} style={dangerBtnStyle}>
                取消批次
              </button>
            )}
          </div>

          {/* Progress */}
          {batch && (
            <Section title="进度">
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
                {batch.results.filter(r => r !== undefined).length} / {total} 完成 · 成功 {succeeded} · 失败 {failed} · 状态 {batch.status}
              </div>

              {/* Per-item list */}
              <div style={itemListStyle}>
                {batch.items.map((item, idx) => {
                  const r = batch.results[idx]
                  const status = !r ? "⏳" : r.ok ? "✓" : "✗"
                  const color = !r ? "#999" : r.ok ? "#4CAF50" : "#F44336"
                  return (
                    <div key={idx} style={{ ...itemStyle, borderLeft: `3px solid ${color}` }}>
                      <span style={{ marginRight: 8 }}>{status}</span>
                      <span style={{ wordBreak: "break-all", fontSize: 12 }}>
                        {item.url || "(text)"}{" "}
                        {r?.error && <span style={{ color: "#F44336" }}>— {r.error}</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Header({ onClose, onRefresh, loadingNotebooks }: { onClose: () => void; onRefresh: () => void; loadingNotebooks: boolean }) {
  return (
    <div style={headerStyle}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>📓 NotebookLM 导入器</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onRefresh} disabled={loadingNotebooks} style={btnStyle} title="刷新 notebook 列表">
          {loadingNotebooks ? "⏳" : "🔄"}
        </button>
        <button onClick={onClose} style={btnStyle} title="关闭">
          ✕
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}

// ---------- styles ----------
const overlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.5)",
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
}
const panelStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 12px 48px rgba(0,0,0,0.3)",
}
const headerStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #eee",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
}
const bodyStyle: React.CSSProperties = {
  flex: 1,
  padding: 16,
  overflowY: "auto",
}
const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  border: "1px solid #ddd",
  borderRadius: 4,
  fontSize: 14,
}
const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 120,
  padding: 8,
  border: "1px solid #ddd",
  borderRadius: 4,
  fontSize: 13,
  fontFamily: "monospace",
  boxSizing: "border-box",
}
const btnStyle: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid #ddd",
  background: "#f8f8f8",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
}
const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  border: "none",
  background: "#1a73e8",
  color: "#fff",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
  flex: 1,
}
const dangerBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  border: "none",
  background: "#F44336",
  color: "#fff",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
  flex: 1,
}
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#999",
  marginTop: 4,
}
const errorStyle: React.CSSProperties = {
  padding: 8,
  background: "#FFF3CD",
  border: "1px solid #FFC107",
  borderRadius: 4,
  fontSize: 12,
  marginBottom: 8,
}
const progressContainerStyle: React.CSSProperties = {
  width: "100%",
  height: 8,
  background: "#eee",
  borderRadius: 4,
  overflow: "hidden",
}
const progressBarStyle: React.CSSProperties = {
  height: "100%",
  transition: "width 0.3s",
}
const itemListStyle: React.CSSProperties = {
  marginTop: 8,
  maxHeight: 200,
  overflowY: "auto",
  border: "1px solid #eee",
  borderRadius: 4,
}
const itemStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #f5f5f5",
  display: "flex",
  alignItems: "flex-start",
}
