// 场景 panel (Mission Packs) — product rename from「任务包」.
// SoT: docs/superpowers/specs/2026-07-31-mission-pack-ux-redesign.md
// Zones: 本对话状态 · 场景模板 · 本机能力 · NetSec · 工作区

import { useEffect, useRef, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { useContextPanelHostOptional } from "./ContextPanelHost"

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

/** P0 hardcopy for AppSec only (§8 / §14.1). */
function sceneCopy(p: PackListItem): { suitable: string; unsuitable: string; tools: string } | null {
  if (p.id !== "appsec-prd-review") return null
  return {
    suitable: "对当前网页/PRD 做威胁建模与安全 checklist；只读浏览与截图。",
    unsuitable: "安装技能、读写本机项目、需要全部浏览器工具或脚本执行。",
    tools: "列出标签、打开页面、读取页面文字/HTML、截图、使用技能",
  }
}

export function PacksPanel() {
  const { state, dispatch } = useAgentStore()
  const host = useContextPanelHostOptional()
  const [packs, setPacks] = useState<PackListItem[]>([])
  const [modules, setModules] = useState<Record<string, ModuleStateView>>({})
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [newTarget, setNewTarget] = useState("")
  const [selectedAuth, setSelectedAuth] = useState<Set<string>>(new Set())
  const [authorizeAlso, setAuthorizeAlso] = useState(true)
  const [confirmPack, setConfirmPack] = useState<PackListItem | null>(null)
  /** NetSec settings collapsed by default (P1 noise reduction). */
  const [netsecOpen, setNetsecOpen] = useState(false)
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
        flash("已用于本对话", 2500)
        setBusy(null)
        setConfirmPack(null)
        if (msg.thread?.id) dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
      }
      if (msg?.type === "pack.unapplied") {
        flash("已退出场景，回到通用助手", 2500)
        setBusy(null)
        if (msg.thread?.id) dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
      }
      if (msg?.type === "modules.list" || msg?.type === "modules.updated") {
        if (msg.modules) setModules(msg.modules)
        if (msg.type === "modules.updated") {
          setBusy(null)
          if (msg.module?.target_allowlist) {
            flash("允许扫描的目标已更新", 2000)
          }
        }
      }
      if (msg?.type === "netsec.authorized" && msg.thread?.id) {
        dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
        setBusy(null)
        const n = msg.thread?.netsec_task_auth?.targets?.length ?? 0
        flash(`本对话已授权 ${n} 个扫描目标`, 3000)
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
      if (msg?.type === "workspace.clear_result" && msg.thread) {
        dispatch({ type: "UPSERT_THREAD", thread: msg.thread })
        flash("已清除工作区绑定", 2500)
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

  const enableModule = (mod: string) => {
    setBusy("modules")
    chrome.runtime.sendMessage({ type: "modules.set_enabled", module: mod, enabled: true })
    setTimeout(refresh, 400)
    flash(`已请求开启本机能力：${mod}`, 2500)
  }

  const pickWorkspace = () => {
    if (!state.activeThreadId) {
      flash("请先选择对话")
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
      flash("请先选择对话")
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
      flash("请先选择对话")
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

  const requestApply = (p: PackListItem) => {
    if (!state.activeThreadId) {
      flash("请先选择或创建对话")
      return
    }
    setConfirmPack(p)
  }

  const confirmApply = () => {
    if (!confirmPack || !state.activeThreadId) return
    setBusy(confirmPack.id)
    chrome.runtime.sendMessage({
      type: "pack.apply",
      pack_id: confirmPack.id,
      thread_id: state.activeThreadId,
      user_gesture: true,
    })
  }

  const unapply = () => {
    if (!state.activeThreadId) {
      flash("请先选择对话")
      return
    }
    setBusy("unapply")
    chrome.runtime.sendMessage({
      type: "pack.unapply",
      thread_id: state.activeThreadId,
      user_gesture: true,
    })
  }

  const clearWorkspace = () => {
    if (!state.activeThreadId) {
      flash("请先选择对话")
      return
    }
    if (!workspaceRoot) {
      flash("当前未绑定工作区")
      return
    }
    setBusy("ws-clear")
    chrome.runtime.sendMessage({
      type: "workspace.clear",
      thread_id: state.activeThreadId,
      user_gesture: true,
    })
  }

  const openSkills = () => {
    host?.openPanelForce("skills")
  }

  const activePackId =
    (state.threads || []).find((t: any) => t.id === state.activeThreadId)?.mission_pack_id || null
  const activePack = packs.find((p) => p.id === activePackId) || null
  const authTargets = threadAuth?.authorized ? threadAuth.targets || [] : []

  const moduleLabel: Record<string, string> = {
    appsec: "应用安全场景",
    "devsec-workspace": "工作区读写",
    shell: "本机命令",
    netsec: "网络扫描",
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>场景</div>
          <div style={styles.subtitle}>为本对话选用模板（可限制可用工具）</div>
        </div>
        <button type="button" style={styles.linkBtn} onClick={refresh}>
          刷新
        </button>
      </div>

      <button type="button" style={styles.divert} onClick={openSkills}>
        要安装技能？→ 打开 Skills 导入
      </button>

      {status && <div style={styles.status}>{status}</div>}

      {/* Zone: 本对话状态 */}
      <section style={styles.zone}>
        <div style={styles.zoneTitle}>本对话状态</div>
        <div style={styles.stateCard}>
          <div>
            当前：
            <strong>{activePack ? `场景 · ${activePack.name}` : "通用助手"}</strong>
          </div>
          <div style={styles.stateMeta}>
            {workspaceRoot ? (
              <>
                工作区：<code style={{ fontSize: 10 }}>{workspaceRoot}</code>
              </>
            ) : (
              "工作区：未选择"
            )}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {activePackId ? (
              <button type="button" style={styles.primaryBtn} onClick={unapply} disabled={!!busy}>
                {busy === "unapply" ? "退出中…" : "退出场景，回到通用助手"}
              </button>
            ) : null}
            <button type="button" style={styles.secondaryBtn} onClick={pickWorkspace} disabled={!!busy}>
              {workspaceRoot ? "更换工作区" : "选择工作区"}
            </button>
            {workspaceRoot ? (
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={clearWorkspace}
                disabled={!!busy}
                title="仅解除绑定，不删除磁盘文件"
              >
                {busy === "ws-clear" ? "清除中…" : "清除工作区"}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Zone: 场景模板 */}
      <section style={styles.zone}>
        <div style={styles.zoneTitle}>开始一个场景</div>
        {packs.length === 0 && <div style={styles.empty}>暂无已安装场景模板</div>}
        <ul style={styles.list}>
          {packs.map((p) => {
            const blocked = p.apply_blocked
            const isActive = activePackId === p.id
            const copy = sceneCopy(p)
            return (
              <li key={p.id} style={styles.item}>
                <div style={styles.row}>
                  <strong style={styles.name}>
                    {p.name}
                    {isActive ? " · 本对话使用中" : ""}
                  </strong>
                  <span style={styles.meta}>
                    {p.channel} · v{p.version}
                  </span>
                </div>
                {p.description && <div style={styles.desc}>{p.description}</div>}
                {copy && (
                  <div style={styles.copyBlock}>
                    <div>
                      <span style={styles.copyLabel}>适合</span> {copy.suitable}
                    </div>
                    <div>
                      <span style={styles.copyLabelBad}>不适合</span> {copy.unsuitable}
                    </div>
                    <div style={styles.toolsLine}>将允许：{copy.tools}</div>
                  </div>
                )}
                {blocked && <div style={styles.blocked}>{blocked}</div>}
                {isActive ? (
                  <button type="button" style={styles.primaryBtn} onClick={unapply} disabled={!!busy}>
                    退出场景
                  </button>
                ) : (
                  <button
                    type="button"
                    style={styles.primaryBtn}
                    disabled={!!busy || !!blocked}
                    title="与开启本机能力不同 — 场景会限制本对话可用的工具"
                    onClick={() => requestApply(p)}
                  >
                    {busy === p.id ? "应用中…" : "用于本对话"}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {/* Zone: 本机能力 modules */}
      <section style={styles.zone}>
        <div style={styles.zoneTitle}>本机能力</div>
        <div style={styles.hint}>电源开关：允许本机使用某类能力，不等于「用于本对话」。</div>
        {(["appsec", "devsec-workspace", "shell", "netsec"] as const).map((mod) =>
          modules[mod] && modules[mod].enabled !== true ? (
            <div key={mod} style={styles.banner}>
              未开启：{moduleLabel[mod] || mod}
              <button type="button" style={styles.primaryBtn} onClick={() => enableModule(mod)}>
                开启
              </button>
            </div>
          ) : modules[mod]?.enabled === true ? (
            <div key={mod} style={styles.modOn}>
              ✓ {moduleLabel[mod] || mod}
            </div>
          ) : null,
        )}
      </section>

      {/* Zone: NetSec — collapsed by default (P1) */}
      {netsecEnabled && (
        <section style={styles.zone}>
          <button
            type="button"
            style={styles.foldBtn}
            onClick={() => setNetsecOpen((v) => !v)}
            aria-expanded={netsecOpen}
          >
            <span style={styles.zoneTitleInline}>网络扫描设置</span>
            <span style={styles.foldChevron}>{netsecOpen ? "收起" : "展开"}</span>
          </button>
          {!netsecOpen && (
            <div style={styles.hint}>
              {allowlist.length
                ? `已配置 ${allowlist.length} 个允许目标 · 本对话${authTargets.length ? `已授权 ${authTargets.length}` : "未授权"}`
                : "未配置允许目标 — 展开后添加"}
            </div>
          )}
          {netsecOpen && (
          <div style={styles.netsecCard}>
            <div style={styles.netsecHint}>
              维护「允许扫描的目标」（写入 Companion）。真正扫描前还需对本对话授权。
            </div>

            {allowlist.length === 0 ? (
              <div style={styles.emptyList}>尚未添加目标 — 添加 IP/主机后才能扫描</div>
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
              </div>
            ) : (
              <div style={styles.authHint}>本对话尚未授权扫描 — 勾选目标后点「授权所选」</div>
            )}
          </div>
          )}
        </section>
      )}

      {/* Apply confirm modal */}
      {confirmPack && (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="确认用于本对话">
          <div style={styles.modal}>
            <div style={styles.modalTitle}>将「{confirmPack.name}」用于本对话？</div>
            {sceneCopy(confirmPack) ? (
              <>
                <p style={styles.modalP}>
                  <strong>适合：</strong>
                  {sceneCopy(confirmPack)!.suitable}
                </p>
                <p style={styles.modalP}>
                  <strong>不适合：</strong>
                  {sceneCopy(confirmPack)!.unsuitable}
                </p>
                <p style={styles.modalP}>
                  <strong>将会：</strong>
                  切换助手角色；工具变为「{sceneCopy(confirmPack)!.tools}」。可随时退出场景。
                </p>
              </>
            ) : (
              <p style={styles.modalP}>
                {confirmPack.description || "将应用该场景模板到当前对话（可能限制可用工具）。"}
              </p>
            )}
            <div style={styles.modalActions}>
              <button type="button" style={styles.secondaryBtn} onClick={() => setConfirmPack(null)}>
                取消
              </button>
              <button type="button" style={styles.primaryBtn} onClick={confirmApply} disabled={!!busy}>
                用于本对话
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, import("react").CSSProperties> = {
  wrap: { padding: "8px 10px", fontSize: 12, color: tokens.text, position: "relative" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  title: { fontWeight: 650, fontSize: 14, letterSpacing: "-0.02em" },
  subtitle: { fontSize: 10, color: tokens.textMuted, marginTop: 2, lineHeight: 1.35 },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: tokens.accent,
    cursor: "pointer",
    fontSize: 11,
  },
  divert: {
    width: "100%",
    textAlign: "left",
    border: `1px solid ${tokens.border}`,
    background: tokens.accentSoft,
    color: tokens.accentText,
    borderRadius: tokens.radiusMd,
    padding: "6px 8px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: 8,
    fontFamily: tokens.font,
  },
  status: { fontSize: 11, color: tokens.accent, marginBottom: 6 },
  zone: { marginBottom: 12 },
  zoneTitle: {
    fontSize: 10,
    fontWeight: 650,
    color: tokens.textMuted,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  zoneTitleInline: {
    fontSize: 10,
    fontWeight: 650,
    color: tokens.textMuted,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  foldBtn: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    border: "none",
    background: "transparent",
    padding: "0 0 4px",
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  foldChevron: { fontSize: 10, color: tokens.accent, fontWeight: 600 },
  stateCard: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    padding: 8,
    background: tokens.bg,
    fontSize: 11,
  },
  stateMeta: { fontSize: 10, color: tokens.textMuted, marginTop: 4 },
  banner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    background: "#fff7ed",
    borderRadius: 6,
    marginBottom: 6,
    fontSize: 11,
  },
  modOn: { fontSize: 11, color: tokens.textSecondary, marginBottom: 4 },
  hint: { fontSize: 10, color: tokens.textMuted, marginBottom: 6, lineHeight: 1.35 },
  empty: { color: tokens.textMuted, fontSize: 11, padding: "4px 0" },
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
  copyBlock: { fontSize: 10, color: tokens.textSecondary, marginBottom: 6, lineHeight: 1.4 },
  copyLabel: { color: tokens.success, fontWeight: 700, marginRight: 4 },
  copyLabelBad: { color: tokens.warning, fontWeight: 700, marginRight: 4 },
  toolsLine: { marginTop: 4, color: tokens.textMuted },
  blocked: { fontSize: 10, color: "#b45309", marginBottom: 6 },
  primaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
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
  netsecCard: {
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    padding: 8,
    background: tokens.bgElevated,
  },
  netsecHint: { fontSize: 10, color: tokens.textMuted, marginBottom: 8, lineHeight: 1.35 },
  emptyList: { fontSize: 11, color: tokens.textMuted, marginBottom: 8 },
  chipList: { listStyle: "none", margin: 0, padding: 0, marginBottom: 8 },
  chipRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    padding: "4px 0",
    borderBottom: `1px solid ${tokens.border}`,
  },
  chipLabel: { display: "flex", alignItems: "center", flex: 1, minWidth: 0, fontSize: 11 },
  chipCode: { fontSize: 10, overflow: "hidden", textOverflow: "ellipsis" },
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
    fontSize: 11,
    padding: "4px 6px",
    borderRadius: 6,
    border: `1px solid ${tokens.border}`,
    fontFamily: tokens.fontMono,
  },
  checkLabel: { display: "flex", alignItems: "center", fontSize: 10, color: tokens.textSecondary, marginBottom: 8 },
  authRow: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 },
  authHint: { fontSize: 10, color: tokens.textMuted },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: tokens.scrim || "rgba(15,23,42,0.28)",
    zIndex: 400,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modal: {
    background: tokens.bgElevated,
    borderRadius: tokens.radiusLg,
    boxShadow: tokens.shadowLg,
    padding: 14,
    maxWidth: 320,
    width: "100%",
    fontFamily: tokens.font,
  },
  modalTitle: { fontWeight: 650, fontSize: 13, marginBottom: 8 },
  modalP: { fontSize: 11, color: tokens.textSecondary, lineHeight: 1.45, margin: "0 0 8px" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
}
