// Mission Packs panel: list installed packs and apply to active thread.
// NetSec: visual allowlist management + per-thread task authorization (no config.json hand-edit).

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

type ModuleStateView = {
  available?: boolean
  enabled?: boolean
  target_allowlist?: string[]
  require_task_auth?: boolean
}

/** Client-side mirror of companion isValidNetsecAllowlistEntry (best-effort UX). */
function looksLikeAllowlistEntry(raw: string): boolean {
  const t = raw.trim()
  if (!t || t.length > 253) return false
  if (t === "*" || t === "*.*" || t === "*.") return false
  if (t.includes(":")) return false
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/.test(t)) return true
  if (t.startsWith("*.")) return t.length > 2 && !t.slice(2).includes("*")
  return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(t)
}

export function PacksPanel() {
  const { state, dispatch } = useAgentStore()
  const [packs, setPacks] = useState<PackListItem[]>([])
  const [modules, setModules] = useState<Record<string, ModuleStateView>>({})
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [newTarget, setNewTarget] = useState("")
  const [selectedAuth, setSelectedAuth] = useState<Set<string>>(new Set())
  const [authorizeAlso, setAuthorizeAlso] = useState(true)
  const activeThreadRef = useRef(state.activeThreadId)
  activeThreadRef.current = state.activeThreadId

  const activeThread = (state.threads || []).find((t: any) => t.id === state.activeThreadId)
  const workspaceRoot = (activeThread as any)?.workspace_root as string | undefined
  const threadAuth = (activeThread as any)?.netsec_task_auth as
    | { authorized?: boolean; targets?: string[]; at?: string }
    | null
    | undefined

  const netsec = modules.netsec
  const netsecEnabled = netsec?.enabled === true
  const allowlist = Array.isArray(netsec?.target_allowlist) ? netsec!.target_allowlist! : []

  const flash = (msg: string, ms = 3500) => {
    setStatus(msg)
    setTimeout(() => setStatus(""), ms)
  }

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
        flash("已应用到当前线程", 2500)
        setBusy(null)
      }
      if (msg?.type === "modules.list" || msg?.type === "modules.updated") {
        if (msg.modules) setModules(msg.modules)
        if (msg.type === "modules.updated") {
          setBusy(null)
          if (msg.module?.target_allowlist) {
            flash("Allowlist 已更新", 2000)
          }
        }
      }
      if (msg?.type === "netsec.authorized" && msg.thread?.id) {
        dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
        setBusy(null)
        const n = msg.thread?.netsec_task_auth?.targets?.length ?? 0
        flash(`本线程已授权 ${n} 个目标`, 3000)
      }
      if (msg?.type === "workspace.pick_result") {
        if (msg.error && !msg.bound) {
          flash(msg.error)
        } else if (msg.path) {
          flash(msg.bound ? `工作区已绑定: ${msg.path}` : `已选择: ${msg.path}（绑定中…）`, 5000)
          if (msg.thread?.id) {
            dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
          } else if (!msg.bound && activeThreadRef.current) {
            chrome.runtime.sendMessage({
              type: "workspace.set",
              thread_id: activeThreadRef.current,
              path: msg.path,
            })
          }
        }
      }
      if (msg?.type === "workspace.set_result" && msg.thread) {
        dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
        flash(`工作区已绑定: ${msg.thread.workspace_root || ""}`, 4000)
      }
      if (msg?.type === "error") {
        flash(msg.error || "操作失败", 5000)
        setBusy(null)
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [dispatch])

  // Keep auth selection in sync with allowlist (drop removed entries; preselect new ones).
  useEffect(() => {
    setSelectedAuth((prev) => {
      const next = new Set<string>()
      for (const e of allowlist) {
        if (prev.has(e) || prev.size === 0) next.add(e)
      }
      // If allowlist grew and prev was empty, select all; if prev had items, keep intersection + new
      if (prev.size > 0) {
        for (const e of allowlist) {
          if (!prev.has(e)) next.add(e) // newly added → selected by default
        }
      }
      return next
    })
  }, [allowlist.join("\0")])

  const enableModule = (mod: string) => {
    setBusy("modules")
    chrome.runtime.sendMessage({ type: "modules.set_enabled", module: mod, enabled: true })
    setTimeout(refresh, 400)
    flash(`已请求启用 ${mod}`, 2500)
  }

  const pickWorkspace = () => {
    if (!state.activeThreadId) {
      flash("请先选择线程")
      return
    }
    chrome.runtime.sendMessage({
      type: "workspace.pick",
      thread_id: state.activeThreadId,
    })
  }

  const persistAllowlist = (next: string[], thenAuthorize?: string[]) => {
    setBusy("netsec-allowlist")
    chrome.runtime.sendMessage({
      type: "modules.update",
      module: "netsec",
      patch: { target_allowlist: next },
    })
    if (thenAuthorize && thenAuthorize.length > 0 && state.activeThreadId) {
      // Slight delay so allowlist lands before authorize validates against it
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "netsec.authorize_task",
          thread_id: state.activeThreadId,
          authorized: true,
          user_gesture: true,
          targets: thenAuthorize,
        })
      }, 200)
    }
  }

  const addTarget = () => {
    const entry = newTarget.trim()
    if (!entry) {
      flash("请输入 IP / CIDR / 主机名")
      return
    }
    if (!looksLikeAllowlistEntry(entry)) {
      flash("格式无效：支持 IPv4、CIDR、hostname、*.suffix")
      return
    }
    if (allowlist.includes(entry)) {
      flash("已在 allowlist 中")
      setNewTarget("")
      return
    }
    const next = [...allowlist, entry]
    setNewTarget("")
    if (authorizeAlso && state.activeThreadId) {
      const ok = window.confirm(
        `将添加并授权本线程扫描：\n${entry}\n\n确认你拥有该目标的测试授权？`,
      )
      if (!ok) return
      persistAllowlist(next, [entry, ...(threadAuth?.targets || [])].filter((v, i, a) => a.indexOf(v) === i))
    } else {
      persistAllowlist(next)
    }
  }

  const removeTarget = (entry: string) => {
    const next = allowlist.filter((x) => x !== entry)
    setSelectedAuth((prev) => {
      const s = new Set(prev)
      s.delete(entry)
      return s
    })
    persistAllowlist(next)
  }

  const toggleAuthSelect = (entry: string) => {
    setSelectedAuth((prev) => {
      const s = new Set(prev)
      if (s.has(entry)) s.delete(entry)
      else s.add(entry)
      return s
    })
  }

  const authorizeSelected = () => {
    if (!state.activeThreadId) {
      flash("请先选择线程")
      return
    }
    const targets = allowlist.filter((e) => selectedAuth.has(e))
    if (targets.length === 0) {
      flash("请先勾选要授权的目标（须在 allowlist 内）")
      return
    }
    const ok = window.confirm(
      `确认你拥有对这些目标的测试授权？\n${targets.join("\n")}\n\n授权仅作用于当前线程。`,
    )
    if (!ok) return
    setBusy("netsec-auth")
    chrome.runtime.sendMessage({
      type: "netsec.authorize_task",
      thread_id: state.activeThreadId,
      authorized: true,
      user_gesture: true,
      targets,
    })
  }

  const authorizeAll = () => {
    if (!allowlist.length) {
      flash("allowlist 为空，请先添加目标")
      return
    }
    setSelectedAuth(new Set(allowlist))
    // defer so selection state is consistent for confirm text
    if (!state.activeThreadId) {
      flash("请先选择线程")
      return
    }
    const ok = window.confirm(
      `确认你拥有对 allowlist 全部目标的测试授权？\n${allowlist.join("\n")}\n\n授权仅作用于当前线程。`,
    )
    if (!ok) return
    setBusy("netsec-auth")
    chrome.runtime.sendMessage({
      type: "netsec.authorize_task",
      thread_id: state.activeThreadId,
      authorized: true,
      user_gesture: true,
      targets: allowlist,
    })
  }

  const applyPack = (packId: string) => {
    if (!state.activeThreadId) {
      flash("请先选择或创建线程")
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

  const authTargets = threadAuth?.authorized ? threadAuth.targets || [] : []

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
      </div>
      <div style={styles.wsHint}>
        {workspaceRoot ? (
          <>
            当前工作区: <code style={{ fontSize: 10 }}>{workspaceRoot}</code>
          </>
        ) : (
          <>
            当前线程未绑定工作区 — 使用 <code>workspace_*</code> 工具前请先点「选择工作区」
          </>
        )}
      </div>

      {/* NetSec visual config — only when module enabled */}
      {netsecEnabled && (
        <div style={styles.netsecCard}>
          <div style={styles.netsecTitle}>NetSec 扫描目标</div>
          <div style={styles.netsecHint}>
            在插件内维护 allowlist（实时写入 Companion，无需手改 config.json）。扫描前还需对本线程授权。
          </div>

          {allowlist.length === 0 ? (
            <div style={styles.emptyList}>allowlist 为空 — 添加 IP/主机后才能扫描</div>
          ) : (
            <ul style={styles.chipList}>
              {allowlist.map((entry) => {
                const authed = authTargets.some((t) => t.toLowerCase() === entry.toLowerCase())
                return (
                  <li key={entry} style={styles.chipRow}>
                    <label style={styles.chipLabel}>
                      <input
                        type="checkbox"
                        checked={selectedAuth.has(entry)}
                        onChange={() => toggleAuthSelect(entry)}
                        style={{ marginRight: 6 }}
                      />
                      <code style={styles.chipCode}>{entry}</code>
                      {authed && <span style={styles.badgeOk}>本线程已授权</span>}
                    </label>
                    <button
                      type="button"
                      style={styles.removeBtn}
                      title="从 allowlist 移除"
                      onClick={() => removeTarget(entry)}
                      disabled={busy === "netsec-allowlist"}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div style={styles.addRow}>
            <input
              type="text"
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addTarget()
                }
              }}
              placeholder="IPv4 / CIDR / hostname / *.suffix"
              style={styles.input}
              disabled={!!busy}
            />
            <button
              type="button"
              style={styles.primaryBtn}
              onClick={addTarget}
              disabled={!!busy}
            >
              添加
            </button>
          </div>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={authorizeAlso}
              onChange={(e) => setAuthorizeAlso(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            添加后立即授权本线程扫描该目标
          </label>

          <div style={styles.authRow}>
            <button
              type="button"
              style={styles.primaryBtn}
              onClick={authorizeSelected}
              disabled={!!busy || !allowlist.length}
            >
              授权所选 → 本线程
            </button>
            <button
              type="button"
              style={styles.secondaryBtn}
              onClick={authorizeAll}
              disabled={!!busy || !allowlist.length}
            >
              授权全部
            </button>
          </div>
          {authTargets.length > 0 ? (
            <div style={styles.authHint}>
              本线程已授权: <code style={{ fontSize: 10 }}>{authTargets.join(", ")}</code>
              {threadAuth?.at ? (
                <span style={{ color: tokens.textMuted }}> · {new Date(threadAuth.at).toLocaleString()}</span>
              ) : null}
            </div>
          ) : (
            <div style={styles.authHint}>本线程尚未授权 — 勾选目标后点「授权所选」</div>
          )}
        </div>
      )}

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
  secondaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    background: tokens.bgElevated || "#fff",
    color: tokens.text,
    cursor: "pointer",
  },
  wsHint: {
    fontSize: 10,
    color: tokens.textMuted,
    marginBottom: 8,
    lineHeight: 1.4,
  },
  netsecCard: {
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    background: "#f8fafc",
  },
  netsecTitle: { fontWeight: 600, fontSize: 12, marginBottom: 4 },
  netsecHint: { fontSize: 10, color: tokens.textMuted, marginBottom: 8, lineHeight: 1.4 },
  emptyList: { fontSize: 11, color: tokens.textMuted, marginBottom: 8 },
  chipList: { listStyle: "none", margin: "0 0 8px", padding: 0, display: "flex", flexDirection: "column", gap: 4 },
  chipRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    padding: "4px 6px",
    background: "#fff",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
  },
  chipLabel: { display: "flex", alignItems: "center", flex: 1, minWidth: 0, fontSize: 11, cursor: "pointer" },
  chipCode: { fontSize: 11, wordBreak: "break-all" },
  badgeOk: {
    marginLeft: 6,
    fontSize: 9,
    color: "#166534",
    background: "#dcfce7",
    borderRadius: 4,
    padding: "1px 4px",
    whiteSpace: "nowrap",
  },
  removeBtn: {
    border: "none",
    background: "transparent",
    color: "#b91c1c",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    padding: "0 4px",
  },
  addRow: { display: "flex", gap: 6, marginBottom: 6 },
  input: {
    flex: 1,
    fontSize: 11,
    padding: "4px 6px",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#d1d5db"}`,
    minWidth: 0,
  },
  checkLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 10,
    color: tokens.textSecondary || tokens.textMuted,
    marginBottom: 8,
    cursor: "pointer",
  },
  authRow: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 },
  authHint: { fontSize: 10, color: tokens.textMuted, lineHeight: 1.4 },
}
