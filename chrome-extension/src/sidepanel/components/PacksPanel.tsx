// Mission Packs panel: list installed packs and apply to active thread

import { useEffect, useRef, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"

export type PackListItem = {
  id: string
  name: string
  description?: string
  version: string
  channel: string
  min_capability?: string
  requires_modules?: string[]
  apply_blocked?: string | null
}

export function PacksPanel() {
  const { state, dispatch } = useAgentStore()
  const [packs, setPacks] = useState<PackListItem[]>([])
  const [modules, setModules] = useState<Record<string, { available?: boolean; enabled?: boolean }>>({})
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const activeThreadRef = useRef(state.activeThreadId)
  activeThreadRef.current = state.activeThreadId

  const activeThread = (state.threads || []).find((t: any) => t.id === state.activeThreadId)
  const workspaceRoot = (activeThread as any)?.workspace_root as string | undefined

  const refresh = () => {
    chrome.runtime.sendMessage({ type: "pack.list" })
    chrome.runtime.sendMessage({ type: "modules.list" })
  }

  useEffect(() => {
    refresh()
    const handler = (msg: any) => {
      if (msg?.type === "pack.list" && Array.isArray(msg.packs)) {
        setPacks(msg.packs)
      }
      if (msg?.type === "pack.installed" || msg?.type === "pack.uninstalled") {
        if (Array.isArray(msg.packs)) setPacks(msg.packs)
        else refresh()
      }
      if (msg?.type === "pack.applied") {
        setStatus("已应用到当前线程")
        setBusy(null)
        setTimeout(() => setStatus(""), 2500)
      }
      if (msg?.type === "modules.list" || msg?.type === "modules.updated") {
        if (msg.modules) setModules(msg.modules)
      }
      if (msg?.type === "workspace.pick_result") {
        if (msg.error && !msg.bound) {
          setStatus(msg.error)
        } else if (msg.path) {
          setStatus(msg.bound ? `工作区已绑定: ${msg.path}` : `已选择: ${msg.path}（绑定中…）`)
          // One-shot pick already bound when thread_id was sent; still UPSERT if thread returned
          if (msg.thread?.id) {
            dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          } else if (!msg.bound && activeThreadRef.current) {
            // Fallback: separate set (path must still be consumable from pick token)
            chrome.runtime.sendMessage({
              type: "workspace.set",
              thread_id: activeThreadRef.current,
              path: msg.path,
            })
          }
        }
        setTimeout(() => setStatus(""), 5000)
      }
      if (msg?.type === "workspace.set_result" && msg.thread) {
        dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
        setStatus(`工作区已绑定: ${msg.thread.workspace_root || ""}`)
        setTimeout(() => setStatus(""), 4000)
      }
      if (msg?.type === "error" && busy) {
        setStatus(msg.error || "操作失败")
        setBusy(null)
        setTimeout(() => setStatus(""), 4000)
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [busy, dispatch])

  const enableModule = (mod: string) => {
    setBusy("modules")
    chrome.runtime.sendMessage({ type: "modules.set_enabled", module: mod, enabled: true })
    setTimeout(refresh, 400)
    setBusy(null)
    setStatus(`已请求启用 ${mod}`)
    setTimeout(() => setStatus(""), 2500)
  }

  const pickWorkspace = () => {
    if (!state.activeThreadId) {
      setStatus("请先选择线程")
      return
    }
    // Pass thread_id so companion pick+bind atomically
    chrome.runtime.sendMessage({
      type: "workspace.pick",
      thread_id: state.activeThreadId,
    })
  }

  const authorizeNetsec = () => {
    if (!state.activeThreadId) {
      setStatus("请先选择线程")
      return
    }
    const raw = window.prompt("授权扫描目标（逗号分隔 hostname/IPv4，须在 allowlist 内）")
    if (!raw) return
    const targets = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    const ok = window.confirm(
      `确认你拥有对这些目标的测试授权？\n${targets.join("\n")}\n\n仅允许 netsec.allowlist 内目标。`,
    )
    if (!ok) return
    chrome.runtime.sendMessage({
      type: "netsec.authorize_task",
      thread_id: state.activeThreadId,
      authorized: true,
      user_gesture: true,
      targets,
    })
    setStatus("已提交 NetSec 任务授权")
    setTimeout(() => setStatus(""), 2500)
  }

  const applyPack = (packId: string) => {
    if (!state.activeThreadId) {
      setStatus("请先选择或创建线程")
      setTimeout(() => setStatus(""), 2500)
      return
    }
    setBusy(packId)
    chrome.runtime.sendMessage({
      type: "pack.apply",
      pack_id: packId,
      thread_id: state.activeThreadId,
    })
  }

  const activePackId =
    (state.threads || []).find((t: any) => t.id === state.activeThreadId)?.mission_pack_id || null

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <span style={styles.title}>任务包</span>
        <button type="button" style={styles.linkBtn} onClick={refresh}>
          刷新
        </button>
      </div>
      {status && <div style={styles.status}>{status}</div>}
      {(["appsec", "devsec-workspace", "shell", "netsec"] as const).map((mod) =>
        modules[mod] && modules[mod].enabled !== true ? (
          <div key={mod} style={styles.banner}>
            模块 {mod} 未启用
            <button type="button" style={styles.primaryBtn} onClick={() => enableModule(mod)}>
              启用
            </button>
          </div>
        ) : null,
      )}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={styles.primaryBtn} onClick={pickWorkspace}>
          选择工作区
        </button>
        <button type="button" style={styles.primaryBtn} onClick={authorizeNetsec}>
          NetSec 任务授权
        </button>
      </div>
      <div style={styles.wsHint}>
        {workspaceRoot ? (
          <>当前工作区: <code style={{ fontSize: 10 }}>{workspaceRoot}</code></>
        ) : (
          <>当前线程未绑定工作区 — 使用 <code>workspace_*</code> 工具前请先点「选择工作区」</>
        )}
      </div>
      {packs.length === 0 && <div style={styles.empty}>暂无已安装任务包</div>}
      <ul style={styles.list}>
        {packs.map((p) => {
          const blocked = p.apply_blocked
          const isActive = activePackId === p.id
          return (
            <li key={p.id} style={styles.item}>
              <div style={styles.row}>
                <strong style={styles.name}>
                  {p.name}
                  {isActive ? " · 当前" : ""}
                </strong>
                <span style={styles.meta}>
                  {p.channel} · v{p.version}
                </span>
              </div>
              {p.description && <div style={styles.desc}>{p.description}</div>}
              {blocked && <div style={styles.blocked}>{blocked}</div>}
              <button
                type="button"
                style={styles.primaryBtn}
                disabled={!!busy || !!blocked}
                onClick={() => applyPack(p.id)}
              >
                {busy === p.id ? "应用中…" : "应用到当前线程"}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const styles: Record<string, import("react").CSSProperties> = {
  wrap: { padding: "8px 10px", fontSize: 12, color: tokens.text },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontWeight: 600, fontSize: 12 },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: tokens.accent,
    cursor: "pointer",
    fontSize: 11,
  },
  status: { fontSize: 11, color: tokens.accent, marginBottom: 6 },
  banner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    background: "#fff7ed",
    borderRadius: 6,
    marginBottom: 8,
    fontSize: 11,
  },
  empty: { color: tokens.textMuted, fontSize: 11, padding: "8px 0" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 },
  item: {
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    borderRadius: 8,
    padding: 8,
    background: tokens.bgElevated || "#fff",
  },
  row: { display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 },
  name: { fontSize: 12 },
  meta: { fontSize: 10, color: tokens.textMuted },
  desc: { fontSize: 11, color: tokens.textSecondary, marginBottom: 6 },
  blocked: { fontSize: 10, color: "#b45309", marginBottom: 6 },
  primaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: tokens.accent,
    cursor: "pointer",
  },
  wsHint: {
    fontSize: 10,
    color: tokens.textMuted,
    marginBottom: 8,
    lineHeight: 1.4,
  },
}
