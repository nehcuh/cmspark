// NetSec allowlist + per-thread task auth — lives in Settings (not 场景 panel).
// Product: docs/superpowers/specs/2026-07-31-mission-pack-ux-redesign.md scheme T

import { useEffect, useState, type CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"

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

export function NetSecSettingsSection() {
  const { state, dispatch } = useAgentStore()
  const [modules, setModules] = useState<Record<string, ModuleStateView>>({})
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [newTarget, setNewTarget] = useState("")
  const [selectedAuth, setSelectedAuth] = useState<Set<string>>(new Set())
  const [authorizeAlso, setAuthorizeAlso] = useState(true)

  const activeThread = (state.threads || []).find((t: any) => t.id === state.activeThreadId)
  const threadAuth = (activeThread as any)?.netsec_task_auth as
    | { authorized?: boolean; targets?: string[]; at?: string }
    | null
    | undefined

  const netsec = modules.netsec
  const netsecEnabled = netsec?.enabled === true
  const allowlist = Array.isArray(netsec?.target_allowlist) ? netsec!.target_allowlist! : []
  const authTargets = threadAuth?.authorized ? threadAuth.targets || [] : []

  const flash = (msg: string, ms = 3500) => {
    setStatus(msg)
    setTimeout(() => setStatus(""), ms)
  }

  const refresh = () => {
    chrome.runtime.sendMessage({ type: "modules.list" })
  }

  useEffect(() => {
    refresh()
    const handler = (msg: any) => {
      if (msg?.type === "modules.list" || msg?.type === "modules.updated") {
        if (msg.modules) setModules(msg.modules)
        if (msg.type === "modules.updated") {
          setBusy(null)
          if (msg.module?.target_allowlist) flash("允许扫描的目标已更新", 2000)
        }
      }
      if (msg?.type === "netsec.authorized" && msg.thread?.id) {
        dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
        setBusy(null)
        const n = msg.thread?.netsec_task_auth?.targets?.length ?? 0
        flash(`本对话已授权 ${n} 个扫描目标`, 3000)
      }
      if (msg?.type === "error") {
        flash(msg.error || "操作失败", 5000)
        setBusy(null)
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [dispatch])

  useEffect(() => {
    setSelectedAuth((prev) => {
      const next = new Set<string>()
      for (const e of allowlist) {
        if (prev.has(e) || prev.size === 0) next.add(e)
      }
      if (prev.size > 0) {
        for (const e of allowlist) {
          if (!prev.has(e)) next.add(e)
        }
      }
      return next
    })
  }, [allowlist.join("\0")])

  const enableNetsec = () => {
    setBusy("modules")
    chrome.runtime.sendMessage({ type: "modules.set_enabled", module: "netsec", enabled: true })
    setTimeout(refresh, 400)
    flash("已请求开启网络扫描能力（enterprise 配置不足时会失败）", 3500)
  }

  const persistAllowlist = (next: string[], thenAuthorize?: string[]) => {
    setBusy("netsec-allowlist")
    chrome.runtime.sendMessage({
      type: "modules.update",
      module: "netsec",
      patch: { target_allowlist: next },
    })
    if (thenAuthorize && thenAuthorize.length > 0 && state.activeThreadId) {
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
      flash("已在允许列表中")
      setNewTarget("")
      return
    }
    const next = [...allowlist, entry]
    setNewTarget("")
    if (authorizeAlso && state.activeThreadId) {
      const ok = window.confirm(
        `将添加并授权本对话扫描：\n${entry}\n\n确认你拥有该目标的测试授权？`,
      )
      if (!ok) return
      persistAllowlist(
        next,
        [entry, ...(threadAuth?.targets || [])].filter((v, i, a) => a.indexOf(v) === i),
      )
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
      flash("请先选择对话（侧栏线程）")
      return
    }
    const targets = allowlist.filter((e) => selectedAuth.has(e))
    if (targets.length === 0) {
      flash("请先勾选要授权的目标")
      return
    }
    const ok = window.confirm(
      `确认你拥有对这些目标的测试授权？\n${targets.join("\n")}\n\n授权仅作用于当前对话。`,
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
      flash("允许列表为空，请先添加目标")
      return
    }
    setSelectedAuth(new Set(allowlist))
    if (!state.activeThreadId) {
      flash("请先选择对话（侧栏线程）")
      return
    }
    const ok = window.confirm(
      `确认你拥有对全部目标的测试授权？\n${allowlist.join("\n")}\n\n授权仅作用于当前对话。`,
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

  return (
    <div data-testid="netsec-settings">
      <div style={styles.sectionTitle}>网络扫描（NetSec）</div>
      <div style={styles.help}>
        允许扫描的目标为 <strong>安装级</strong> 配置；对本对话的扫描授权绑定当前线程。
        真正调用 <code>netsec_port_scan</code> 时仍可能弹出确认台（L2）。
      </div>
      {status && <div style={styles.status}>{status}</div>}

      {!netsecEnabled ? (
        <div style={styles.banner}>
          <span>本机「网络扫描」能力未开启</span>
          <button type="button" style={styles.primaryBtn} onClick={enableNetsec} disabled={!!busy}>
            开启
          </button>
        </div>
      ) : (
        <div style={styles.card}>
          {allowlist.length === 0 ? (
            <div style={styles.empty}>尚未添加目标 — 添加 IP/主机后才能扫描</div>
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
                      {authed && <span style={styles.badgeOk}>本对话已授权</span>}
                    </label>
                    <button
                      type="button"
                      style={styles.removeBtn}
                      title="从允许列表移除"
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
            <button type="button" style={styles.primaryBtn} onClick={addTarget} disabled={!!busy}>
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
            添加后立即授权本对话扫描该目标
          </label>

          <div style={styles.authRow}>
            <button
              type="button"
              style={styles.primaryBtn}
              onClick={authorizeSelected}
              disabled={!!busy || !allowlist.length}
            >
              授权所选 → 本对话
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
              本对话已授权: <code style={{ fontSize: 10 }}>{authTargets.join(", ")}</code>
              {threadAuth?.at ? (
                <span style={{ color: tokens.textMuted }}> · {new Date(threadAuth.at).toLocaleString()}</span>
              ) : null}
            </div>
          ) : (
            <div style={styles.authHint}>本对话尚未授权扫描 — 勾选目标后点「授权所选」</div>
          )}
          {!state.activeThreadId && (
            <div style={{ ...styles.authHint, color: tokens.warning }}>
              当前无活动对话 — 授权前请先在侧栏选择线程
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  sectionTitle: {
    fontSize: 13,
    fontWeight: 650,
    color: tokens.text,
    marginBottom: 6,
  },
  help: {
    fontSize: 11,
    color: tokens.textMuted,
    lineHeight: 1.45,
    marginBottom: 8,
  },
  status: { fontSize: 11, color: tokens.accent, marginBottom: 6 },
  banner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    background: tokens.warningSoft,
    borderRadius: 8,
    fontSize: 12,
  },
  card: {
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    padding: 10,
    background: tokens.bg,
  },
  empty: { fontSize: 11, color: tokens.textSecondary, marginBottom: 8 },
  chipList: { listStyle: "none", margin: 0, padding: 0, marginBottom: 8 },
  chipRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    padding: "4px 0",
    borderBottom: `1px solid ${tokens.border}`,
  },
  chipLabel: { display: "flex", alignItems: "center", flex: 1, minWidth: 0, fontSize: 12 },
  chipCode: { fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" },
  badgeOk: {
    marginLeft: 6,
    fontSize: 9,
    color: tokens.success,
    fontWeight: 600,
    flexShrink: 0,
  },
  removeBtn: {
    border: "none",
    background: "transparent",
    color: tokens.textMuted,
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
  },
  addRow: { display: "flex", gap: 6, marginBottom: 6 },
  input: {
    flex: 1,
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.border}`,
    fontFamily: tokens.fontMono,
  },
  checkLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 11,
    color: tokens.textSecondary,
    marginBottom: 8,
  },
  authRow: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 },
  authHint: { fontSize: 11, color: tokens.textMuted },
  primaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.borderStrong}`,
    background: tokens.bgActive,
    color: tokens.accent,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  secondaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.borderStrong}`,
    background: tokens.bgElevated,
    color: tokens.text,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
}
