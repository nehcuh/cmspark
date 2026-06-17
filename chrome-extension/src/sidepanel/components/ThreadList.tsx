// Collapsible thread list panel

import { useState } from "react"
import { useAgentStore } from "../store/agentStore"

function generateShortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = ""
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

export function ThreadList() {
  const { state, dispatch } = useAgentStore()
  const [open, setOpen] = useState(false)
  const { threads, activeThreadId } = state

  const handleNewThread = () => {
    const id = generateShortId()
    const thread = {
      id,
      alias: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      config_override: {
        base_url: "https://api.deepseek.com/v1",
        api_key: "",
        model_name: "deepseek-v4-flash",
        temperature: 0.7,
        context_window: 1000000,
        trusted_domains: [],
        privilege_mode: "standard" as const,
        safety_skills_enabled: [] as string[],
      },
      tool_whitelist: null as string[] | null,
      pinned_tabs: [] as number[],
      active_skill_ids: ["browse"] as string[],
    }
    dispatch({ type: "ADD_THREAD", thread })
    // Also notify companion (will sync when connected)
    chrome.runtime.sendMessage({ type: "thread.create", alias: "", id })
    setOpen(false)
  }

  const handleCleanupEmpty = () => {
    if (!confirm("确定清理所有空白线程？\n没有消息的线程将被永久删除，此操作不可恢复。")) return
    chrome.runtime.sendMessage({ type: "thread.cleanup_empty" })
    setOpen(false)
  }

  const handleGenerateTitle = () => {
    const targetThreadId = activeThreadId || threads[0]?.id
    if (!targetThreadId) {
      alert("暂无线程可生成标题")
      return
    }
    chrome.runtime.sendMessage({ type: "thread.generate_title", thread_id: targetThreadId })
    setOpen(false)
  }

  const handleSelect = (threadId: string) => {
    dispatch({ type: "SET_ACTIVE_THREAD", threadId })
    setOpen(false)
  }

  const handleDelete = (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm(`确定删除线程 "${threadId}"？该线程的所有消息将被清除。`)) {
      dispatch({ type: "REMOVE_THREAD", threadId })
      chrome.runtime.sendMessage({ type: "thread.delete", thread_id: threadId })
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button style={styles.hamburger} onClick={() => setOpen(!open)} title="线程列表">
        ☰
      </button>

      {open && (
        <>
          <div style={styles.backdrop} onClick={() => setOpen(false)} />
          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>线程</span>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button style={styles.generateTitleBtn} onClick={handleGenerateTitle} title="为当前线程生成标题">✨ 生成标题</button>
                <button style={styles.cleanupBtn} onClick={handleCleanupEmpty} title="清理没有消息的空白线程">🧹 清理空白</button>
                <button style={styles.newBtn} onClick={handleNewThread} title="新建线程">+ 新建</button>
              </div>
            </div>
            <div style={styles.list}>
              {threads.map(t => (
                <div
                  key={t.id}
                  style={{
                    ...styles.threadItem,
                    background: t.id === activeThreadId ? "#e8f0fe" : "transparent",
                  }}
                  onClick={() => {
                    handleSelect(t.id)
                    chrome.runtime.sendMessage({ type: "thread.select", threadId: t.id })
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.threadAlias}>{t.alias || t.id}</div>
                    <div style={styles.threadId}>#{t.id}</div>
                  </div>
                  <button
                    style={styles.deleteBtn}
                    onClick={(e) => handleDelete(t.id, e)}
                    title="删除线程"
                  >
                    🗑️
                  </button>
                </div>
              ))}
              {threads.length === 0 && (
                <div style={{ color: "#999", fontSize: 12, padding: 12, textAlign: "center" }}>
                  暂无线程，点击"+ 新建"
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  hamburger: {
    background: "none",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    padding: "2px 4px",
    lineHeight: 1,
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
  },
  panel: {
    position: "absolute",
    top: "100%",
    left: 0,
    width: 300,
    maxHeight: 320,
    background: "#fff",
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
    zIndex: 51,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    borderBottom: "1px solid #eee",
  },
  newBtn: {
    background: "#4A90D9",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "3px 10px",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  cleanupBtn: {
    background: "#fff",
    color: "#666",
    border: "1px solid #ddd",
    borderRadius: 4,
    padding: "3px 10px",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  generateTitleBtn: {
    background: "#fff",
    color: "#666",
    border: "1px solid #ddd",
    borderRadius: 4,
    padding: "3px 10px",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  list: {
    overflowY: "auto",
    flex: 1,
  },
  threadItem: {
    padding: "8px 12px",
    borderBottom: "1px solid #f5f5f5",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  deleteBtn: {
    background: "none",
    border: "none",
    fontSize: 12,
    cursor: "pointer",
    padding: "2px 4px",
    opacity: 0.5,
    flexShrink: 0,
  },
  threadAlias: {
    fontSize: 13,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  threadId: {
    fontSize: 11,
    color: "#999",
    fontFamily: "monospace",
    marginTop: 2,
  },
}
