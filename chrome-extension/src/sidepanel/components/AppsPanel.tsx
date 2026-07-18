// App tab (WP4) — mirrors McpPanel layout for consistency.
// Global kill-switch state → segment switcher → preset section → app cards →
// 「+ 添加应用」(enumerate pick / manual paste → policy radio → apps.add).
//
// The extension is a pure view (design §6): all mutations go through apps.*
// WS messages; the companion validates, gates (D2 biometric for auto), and
// broadcasts apps.updated to every client.

import { useState } from "react"
import { useAgentStore } from "../store/agentStore"
import type { AppEntry, AppEnumerateCandidate, AppPolicy } from "../types"
import {
  autoEligible,
  appWarnReasons,
  ellipsizePath,
  policyBadge,
} from "../utils/apps-utils"

export function AppsPanel() {
  const { state, dispatch } = useAgentStore()
  const [segment, setSegment] = useState<"apps" | "cli">("apps")
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addTab, setAddTab] = useState<"enumerate" | "manual">("enumerate")
  const [search, setSearch] = useState("")
  const [manualPath, setManualPath] = useState("")
  const [manualName, setManualName] = useState("")
  // Picked candidate (enumerate) — shows the policy radio row before submit.
  const [picked, setPicked] = useState<AppEnumerateCandidate | null>(null)
  const [addPolicy, setAddPolicy] = useState<AppPolicy>("ai")

  const appsEnabled = state.appsEnabled

  const clearFeedback = () => {
    dispatch({ type: "SET_APPS_WARNINGS", warnings: [] })
    dispatch({ type: "SET_APPS_ERROR", error: null })
  }

  const handleRefresh = () => {
    chrome.runtime.sendMessage({ type: "apps.list" })
  }

  const handleToggleEntry = (entry: AppEntry) => {
    chrome.runtime.sendMessage({
      type: "apps.set_enabled",
      token: entry.token,
      enabled: !entry.enabled,
    })
  }

  const handleSetPolicy = (entry: AppEntry, policy: AppPolicy) => {
    setMenuOpen(null)
    if (policy === entry.policy) return
    clearFeedback()
    // Downgrades are free; →auto triggers the companion's D2 biometric gate
    // (existing security.confirmation.request dialog, nonce fallback).
    chrome.runtime.sendMessage({ type: "apps.set_policy", token: entry.token, policy })
  }

  const handleDelete = (entry: AppEntry) => {
    setMenuOpen(null)
    if (confirm(`确定删除应用 "${entry.display_name}"？此操作不可撤销。`)) {
      clearFeedback()
      chrome.runtime.sendMessage({ type: "apps.remove", token: entry.token })
    }
  }

  const handleOpenAdd = () => {
    const next = !addOpen
    setAddOpen(next)
    setPicked(null)
    if (next && state.appCandidates === null) {
      chrome.runtime.sendMessage({ type: "apps.enumerate" })
    }
  }

  const handleReEnumerate = () => {
    dispatch({ type: "SET_APPS_CANDIDATES", candidates: null })
    chrome.runtime.sendMessage({ type: "apps.enumerate" })
  }

  const handlePickCandidate = (candidate: AppEnumerateCandidate) => {
    if (candidate.blocked) return
    setPicked(candidate)
    setAddPolicy("ai") // 默认 AI 判断（WP4 要求）
  }

  const handleSubmitAdd = () => {
    clearFeedback()
    if (addTab === "enumerate") {
      if (!picked) return
      chrome.runtime.sendMessage({
        type: "apps.add",
        kind: "gui",
        ...(picked.path ? { path: picked.path } : {}),
        ...(picked.aumid ? { aumid: picked.aumid } : {}),
        display_name: picked.name,
        origin: "enumerate",
        policy: addPolicy,
      })
    } else {
      const p = manualPath.trim()
      if (!p) return
      chrome.runtime.sendMessage({
        type: "apps.add",
        kind: "gui",
        path: p,
        ...(manualName.trim() ? { display_name: manualName.trim() } : {}),
        origin: "manual-paste",
        policy: addPolicy,
      })
    }
    setPicked(null)
    setManualPath("")
    setManualName("")
    setAddPolicy("ai")
  }

  const filteredCandidates = (state.appCandidates ?? []).filter((c) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (
      c.name.toLowerCase().includes(q) ||
      (c.path ?? "").toLowerCase().includes(q) ||
      (c.aumid ?? "").toLowerCase().includes(q)
    )
  })

  const entryForPreset = (token: string) => state.appEntries.find((e) => e.token === token)

  return (
    <div style={styles.panelContent}>
      {/* Global kill-switch state. The backend exposes NO global set message
          (apps.set_enabled is per-entry; config.json is the only write path),
          so this row is an honest read-only indicator, not a fake toggle. */}
      <div style={styles.globalToggleRow}>
        <label
          style={{ ...styles.globalToggleLabel, cursor: "default" }}
          title="全局 App 总开关：关闭后 host_app 一律拒绝启动。当前版本需在 config.json 修改 apps.enabled"
        >
          <input type="checkbox" checked={appsEnabled} disabled style={{ marginRight: 6 }} />
          <span style={{ fontWeight: 500 }}>全局 App</span>
        </label>
        {!appsEnabled && (
          <span style={styles.globalOffHint}>已关闭 · 应用不会被启动（config.json 中开启）</span>
        )}
        <button
          style={{ ...styles.expandBtn, marginLeft: "auto" }}
          onClick={handleRefresh}
          title="刷新应用列表"
        >
          ↻
        </button>
      </div>

      <div style={{ ...styles.mcpBody, opacity: appsEnabled ? 1 : 0.5, pointerEvents: appsEnabled ? "auto" : "none" }}>
        {/* Segment switcher — Segment B (CLI 工具) is a Phase-2 placeholder (D12). */}
        <div style={styles.modeSwitcher}>
          <button
            style={{
              ...styles.modeBtn,
              background: segment === "apps" ? "#4A90D9" : "#fff",
              color: segment === "apps" ? "#fff" : "#666",
              borderColor: segment === "apps" ? "#4A90D9" : "#ddd",
            }}
            onClick={() => setSegment("apps")}
            title="GUI 应用白名单（L0 无参启动）"
          >
            应用
          </button>
          <button
            style={{
              ...styles.modeBtn,
              background: segment === "cli" ? "#4A90D9" : "#fff",
              color: segment === "cli" ? "#fff" : "#666",
              borderColor: segment === "cli" ? "#4A90D9" : "#ddd",
            }}
            onClick={() => setSegment("cli")}
            title="结构化 CLI 契约（Phase 2）"
          >
            ⌨️ CLI 工具
          </button>
        </div>

        {segment === "cli" && (
          <div style={styles.emptyText}>
            CLI 工具将在 Phase 2 提供（结构化 subcommand 契约）。
          </div>
        )}

        {segment === "apps" && (
          <>
            {/* Preset section (top) — detected presets materialize into the
                entries list below; 可禁用不可删。 */}
            {state.appPresets.length > 0 && (
              <div style={styles.presetSection}>
                <div style={styles.presetHeader}>预置应用</div>
                {state.appPresets.map((p) => {
                  const entry = entryForPreset(p.token)
                  return (
                    <div key={p.token} style={{ ...styles.presetRow, opacity: p.detected ? 1 : 0.5 }}>
                      <span style={{ flex: 1, fontSize: 12 }}>{p.display_name}</span>
                      {p.detected ? (
                        <>
                          <span style={styles.presetDetectedBadge}>{p.persisted ? "已检测" : "可启用"}</span>
                          {entry && (
                            <label
                              style={styles.enabledToggle}
                              title={entry.enabled ? "已启用（点击关闭）" : "已停用（点击启用）"}
                            >
                              <input
                                type="checkbox"
                                checked={entry.enabled}
                                onChange={() => handleToggleEntry(entry)}
                                style={{ marginRight: 4 }}
                              />
                              启用
                            </label>
                          )}
                        </>
                      ) : (
                        <span style={styles.presetUndetectedBadge}>未检测到</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* App cards */}
            {state.appEntries.length === 0 && (
              <div style={styles.emptyText}>
                尚未添加应用。点击下方按钮，从运行中的程序或开始菜单选择添加，让 agent 可以帮你启动常用应用。
              </div>
            )}
            {state.appEntries.map((entry) => (
              <AppCard
                key={entry.token}
                entry={entry}
                menuOpen={menuOpen === entry.token}
                onMenuToggle={() => setMenuOpen(menuOpen === entry.token ? null : entry.token)}
                onToggleEnabled={() => handleToggleEntry(entry)}
                onSetPolicy={(p) => handleSetPolicy(entry, p)}
                onDelete={() => handleDelete(entry)}
              />
            ))}
          </>
        )}
      </div>

      {/* Add flow */}
      <button style={styles.addBtn} onClick={handleOpenAdd}>
        {addOpen ? "− 收起添加" : "+ 添加应用"}
      </button>

      {addOpen && (
        <div style={styles.addArea}>
          <div style={styles.addTabs}>
            <button
              style={{ ...styles.addTabBtn, borderBottom: addTab === "enumerate" ? "2px solid #4A90D9" : "2px solid transparent" }}
              onClick={() => { setAddTab("enumerate"); setPicked(null) }}
            >
              从列表选择
            </button>
            <button
              style={{ ...styles.addTabBtn, borderBottom: addTab === "manual" ? "2px solid #4A90D9" : "2px solid transparent" }}
              onClick={() => { setAddTab("manual"); setPicked(null) }}
            >
              手动粘贴路径
            </button>
            <button style={{ ...styles.expandBtn, marginLeft: "auto" }} onClick={handleReEnumerate} title="重新枚举">
              ↻
            </button>
          </div>

          {addTab === "enumerate" && (
            <>
              <input
                style={styles.searchInput}
                type="text"
                placeholder="搜索应用名 / 路径…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {state.appCandidates === null && (
                <div style={styles.emptyMini}>正在枚举本机应用（运行中进程 + 开始菜单）…</div>
              )}
              {state.appCandidates !== null && filteredCandidates.length === 0 && (
                <div style={styles.emptyMini}>无匹配候选</div>
              )}
              <div style={styles.candidateList}>
                {filteredCandidates.map((c, i) => (
                  <CandidateRow key={`${c.name}-${i}`} candidate={c} onPick={() => handlePickCandidate(c)} />
                ))}
              </div>
            </>
          )}

          {addTab === "manual" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <input
                style={styles.searchInput}
                type="text"
                placeholder="C:\\Path\\To\\app.exe（服务端将校验并解析真实路径）"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
              />
              <input
                style={styles.searchInput}
                type="text"
                placeholder="显示名称（可选，默认可执行文件名）"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
              />
              <div style={styles.manualHint}>
                ⚠ 手动粘贴路径属于「manual-paste」来源（可能被他人诱导粘贴），添加时会记录来源并展示警告。
              </div>
            </div>
          )}

          {/* Policy radio — shown once there's something to submit */}
          {((addTab === "enumerate" && picked) || (addTab === "manual" && manualPath.trim())) && (
            <div style={styles.policyRow}>
              <div style={styles.policyRowTitle}>
                {addTab === "enumerate" && picked
                  ? `添加「${picked.name}」，选择策略：`
                  : "选择策略："}
              </div>
              {(["manual", "ai", "auto"] as const).map((p) => {
                const badge = policyBadge(p)
                // AUMID candidates never carry a signer record — always capped
                // at "ai" (maxPolicyForEntry). exe candidates are probed
                // server-side; the backend denies/clamps with POLICY_CAP_EXCEEDED.
                const autoDisabled =
                  p === "auto" && addTab === "enumerate" && !!picked?.aumid
                return (
                  <label
                    key={p}
                    style={{ ...styles.policyOption, opacity: autoDisabled ? 0.45 : 1 }}
                    title={
                      autoDisabled
                        ? "UWP 应用没有签名记录，最高只能设为「AI 判断」"
                        : badge.title
                    }
                  >
                    <input
                      type="radio"
                      name="apps-add-policy"
                      checked={addPolicy === p}
                      disabled={autoDisabled}
                      onChange={() => setAddPolicy(p)}
                      style={{ marginRight: 4 }}
                    />
                    <span style={{ ...styles.policyBadgeMini, color: badge.color, background: badge.bg }}>
                      {badge.label}
                    </span>
                  </label>
                )
              })}
              {addPolicy === "auto" && (
                <div style={styles.autoBioHint}>「全自动」需要 Windows Hello（或确认码）验证一次。</div>
              )}
              <button style={styles.submitBtn} onClick={handleSubmitAdd}>
                添加
              </button>
            </div>
          )}
        </div>
      )}

      {/* D8 follow-up areas — warnings from the last add, then errors */}
      {state.appsWarnings.length > 0 && (
        <div style={styles.warningsBox}>
          <div style={styles.warningsTitle}>⚠ 添加成功，但请注意：</div>
          {state.appsWarnings.map((w, i) => (
            <div key={i} style={styles.warningLine}>• {w.message}</div>
          ))}
          <button style={styles.dismissBtn} onClick={() => dispatch({ type: "SET_APPS_WARNINGS", warnings: [] })}>
            知道了
          </button>
        </div>
      )}
      {state.appsError && (
        <div style={styles.errorBox}>
          <div style={{ flex: 1 }}>⛔ {state.appsError}</div>
          <button style={styles.dismissBtn} onClick={() => dispatch({ type: "SET_APPS_ERROR", error: null })}>
            关闭
          </button>
        </div>
      )}
    </div>
  )
}

// --- App card ---

interface AppCardProps {
  entry: AppEntry
  menuOpen: boolean
  onMenuToggle: () => void
  onToggleEnabled: () => void
  onSetPolicy: (p: AppPolicy) => void
  onDelete: () => void
}

function AppCard(props: AppCardProps) {
  const { entry, menuOpen } = props
  const badge = policyBadge(entry.policy)
  const warns = appWarnReasons(entry)
  const autoOk = autoEligible(entry)
  const isPreset = entry.source === "preset"

  return (
    <div style={{ ...styles.serverCard, opacity: entry.enabled ? 1 : 0.55 }}>
      <div style={styles.cardHeader}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.cardTitle}>
            <span style={{ fontWeight: 500 }}>{entry.display_name}</span>
            {isPreset && <span style={styles.transportBadge}>预置</span>}
            <span
              style={{ ...styles.policyBadgeMini, color: badge.color, background: badge.bg }}
              title={badge.title}
            >
              {badge.label}
            </span>
            {warns.map((w) => (
              <span key={w} style={styles.warnBadge} title={`${w} — 最高只能设为「AI 判断」`}>
                ⚠ {w}
              </span>
            ))}
          </div>
          <div style={styles.cardMeta}>
            {entry.exe?.path && (
              <span title={entry.exe.path} style={{ fontFamily: "ui-monospace, monospace" }}>
                {ellipsizePath(entry.exe.path)}
              </span>
            )}
            {entry.aumid && (
              <span style={styles.uwpBadge} title={entry.aumid}>UWP</span>
            )}
            {entry.exe?.signer && (
              <span title={`签名：${entry.exe.signer}`}>🔏 已签名</span>
            )}
          </div>
        </div>
        <label
          style={styles.enabledToggle}
          title={entry.enabled ? "已启用（点击关闭）" : "已停用（点击启用）"}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={entry.enabled}
            onChange={props.onToggleEnabled}
            style={{ marginRight: 4 }}
          />
          启用
        </label>
        <button style={styles.menuBtn} onClick={props.onMenuToggle} title="更多操作">
          ···
        </button>
        {menuOpen && (
          <div style={styles.menuDropdown}>
            <div style={styles.menuSectionTitle}>策略</div>
            {(["manual", "ai", "auto"] as const).map((p) => {
              const b = policyBadge(p)
              const disabled = p === "auto" && !autoOk
              const current = entry.policy === p
              return (
                <button
                  key={p}
                  style={{
                    ...styles.menuItem,
                    color: disabled ? "#9ca3af" : current ? "#4A90D9" : "#333",
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                  disabled={disabled}
                  title={
                    disabled
                      ? "未签名 / 用户目录 / UWP 应用最高只能设为「AI 判断」"
                      : b.title
                  }
                  onClick={() => props.onSetPolicy(p)}
                >
                  {current ? "✓ " : ""}{b.label}
                  {p === "auto" && !disabled && "（需 Hello 验证）"}
                </button>
              )
            })}
            <button
              style={{
                ...styles.menuItem,
                color: isPreset ? "#9ca3af" : "#F44336",
                borderTop: "1px solid #f3f4f6",
                cursor: isPreset ? "not-allowed" : "pointer",
              }}
              disabled={isPreset}
              title={isPreset ? "预置应用不可删除，可停用" : undefined}
              onClick={props.onDelete}
            >
              🗑️ 删除
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// --- Enumerate candidate row ---

function CandidateRow({ candidate, onPick }: { candidate: AppEnumerateCandidate; onPick: () => void }) {
  const c = candidate
  return (
    <button
      style={{ ...styles.candidateRow, opacity: c.blocked ? 0.5 : 1, cursor: c.blocked ? "not-allowed" : "pointer" }}
      disabled={c.blocked}
      onClick={onPick}
      title={
        c.blocked
          ? "系统工具（lolbin），禁止添加"
          : c.path || c.aumid || c.name
      }
    >
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{c.name}</span>
        {c.vault_token && (
          <span style={styles.warnBadge} title={`属于 vault 名单应用（${c.vault_token}）`}>⚠ vault</span>
        )}
        {c.blocked && <span style={styles.blockedBadge}>禁止添加</span>}
        <span style={styles.candidatePath}>
          {c.aumid ? "UWP 应用" : c.path ? ellipsizePath(c.path, 36) : ""}
        </span>
      </span>
      <span style={styles.sourceBadge}>{c.source === "running" ? "运行中" : "开始菜单"}</span>
    </button>
  )
}

// --- Styles (mirror McpPanel) ---

const styles: Record<string, React.CSSProperties> = {
  panelContent: {
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  globalToggleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 4,
  },
  globalToggleLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 12,
    color: "#374151",
  },
  globalOffHint: {
    fontSize: 10,
    color: "#9ca3af",
  },
  mcpBody: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  modeSwitcher: {
    display: "flex",
    gap: 4,
    marginBottom: 4,
  },
  modeBtn: {
    flex: 1,
    padding: "6px 8px",
    border: "1px solid #ddd",
    borderRadius: 4,
    fontSize: 12,
    cursor: "pointer",
    background: "#fff",
    color: "#666",
  },
  emptyText: {
    padding: "16px 8px",
    textAlign: "center",
    fontSize: 12,
    color: "#888",
    lineHeight: 1.5,
  },
  emptyMini: {
    fontSize: 11,
    color: "#999",
    fontStyle: "italic",
    padding: "6px 2px",
  },
  presetSection: {
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: 6,
    background: "#fff",
  },
  presetHeader: {
    fontSize: 10,
    fontWeight: 600,
    color: "#6b7280",
    marginBottom: 2,
  },
  presetRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 2px",
  },
  presetDetectedBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: "#dcfce7",
    color: "#166534",
  },
  presetUndetectedBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: "#f3f4f6",
    color: "#9ca3af",
  },
  serverCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: 8,
    background: "#fafafa",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    position: "relative",
  },
  cardTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    flexWrap: "wrap",
  },
  cardMeta: {
    display: "flex",
    gap: 8,
    fontSize: 11,
    color: "#666",
    marginTop: 2,
    flexWrap: "wrap",
    alignItems: "center",
  },
  transportBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: "#e0e7ff",
    color: "#3730a3",
  },
  policyBadgeMini: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    fontWeight: 500,
  },
  warnBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: "#fef9c3",
    color: "#854d0e",
    marginLeft: 4,
  },
  uwpBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: "#f3e8ff",
    color: "#6b21a8",
  },
  blockedBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: "#fee2e2",
    color: "#b91c1c",
    marginLeft: 4,
  },
  enabledToggle: {
    fontSize: 10,
    color: "#555",
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  },
  expandBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "2px 6px",
    fontSize: 14,
    color: "#666",
  },
  menuBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "2px 4px",
    fontSize: 14,
    color: "#666",
    letterSpacing: -1,
  },
  menuDropdown: {
    position: "absolute",
    right: 0,
    top: "100%",
    zIndex: 10,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 4,
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    minWidth: 180,
  },
  menuSectionTitle: {
    fontSize: 10,
    color: "#9ca3af",
    padding: "4px 10px 0",
  },
  menuItem: {
    display: "block",
    width: "100%",
    padding: "6px 10px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left",
    color: "#333",
  },
  addBtn: {
    marginTop: 6,
    padding: "8px 12px",
    border: "1px dashed #4A90D9",
    borderRadius: 6,
    background: "transparent",
    color: "#4A90D9",
    cursor: "pointer",
    fontSize: 12,
  },
  addArea: {
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: 6,
    background: "#fff",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  addTabs: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    borderBottom: "1px solid #f3f4f6",
  },
  addTabBtn: {
    border: "none",
    background: "transparent",
    fontSize: 12,
    padding: "4px 6px",
    cursor: "pointer",
    color: "#374151",
  },
  searchInput: {
    width: "100%",
    border: "1px solid #ddd",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 11,
    outline: "none",
    boxSizing: "border-box",
  },
  manualHint: {
    fontSize: 10,
    color: "#854d0e",
    lineHeight: 1.4,
  },
  candidateList: {
    maxHeight: 160,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  candidateRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid #f3f4f6",
    borderRadius: 4,
    background: "#fafafa",
    padding: "4px 6px",
  },
  candidatePath: {
    display: "block",
    fontSize: 10,
    color: "#9ca3af",
    fontFamily: "ui-monospace, monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sourceBadge: {
    fontSize: 9,
    padding: "1px 4px",
    borderRadius: 3,
    background: "#e3f2fd",
    color: "#1976d2",
    flexShrink: 0,
  },
  policyRow: {
    borderTop: "1px dashed #e5e7eb",
    paddingTop: 6,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  policyRowTitle: {
    fontSize: 11,
    fontWeight: 500,
    color: "#374151",
  },
  policyOption: {
    display: "flex",
    alignItems: "center",
    fontSize: 11,
    cursor: "pointer",
  },
  autoBioHint: {
    fontSize: 10,
    color: "#92400e",
  },
  submitBtn: {
    marginTop: 4,
    padding: "6px 10px",
    border: "none",
    borderRadius: 4,
    background: "#4A90D9",
    color: "#fff",
    fontSize: 12,
    cursor: "pointer",
  },
  warningsBox: {
    border: "1px solid #fde68a",
    background: "#fffbeb",
    borderRadius: 6,
    padding: 8,
    fontSize: 11,
    color: "#854d0e",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  warningsTitle: {
    fontWeight: 600,
    marginBottom: 2,
  },
  warningLine: {
    lineHeight: 1.5,
  },
  errorBox: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    borderRadius: 6,
    padding: 8,
    fontSize: 11,
    color: "#b91c1c",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  dismissBtn: {
    alignSelf: "flex-end",
    border: "1px solid #e5e7eb",
    background: "#fff",
    borderRadius: 4,
    fontSize: 10,
    padding: "2px 8px",
    cursor: "pointer",
    color: "#555",
  },
}
