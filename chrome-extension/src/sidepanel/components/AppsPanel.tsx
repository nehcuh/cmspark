// App tab (WP4) — mirrors McpPanel layout for consistency.
// Global kill-switch state → segment switcher → preset section → app cards →
// 「+ 添加应用」(enumerate pick / manual paste → policy radio → apps.add).
//
// The extension is a pure view (design §6): all mutations go through apps.*
// WS messages; the companion validates, gates (D2 biometric for auto), and
// broadcasts apps.updated to every client.

import { useEffect, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import type { AppEntry, AppEnumerateCandidate, AppPolicy } from "../types"
import { popupMenuStyles } from "../ui/popupMenuStyles"
import {
  appsPlatformSupported,
  autoEligible,
  appWarnReasons,
  candidateKey,
  ellipsizePath,
  isSameCandidate,
  policyBadge,
} from "../utils/apps-utils"
import { uiaCapableBadge } from "../utils/computer-utils"
import { tokens } from "../ui/tokens"

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
  // WP4 (WI-6): 全局坐标开关只读镜像(null = 尚未查询)。WP4 不做面板内
  // 全局开关切换——开启需 companion 生物识别门,本行只展示状态。
  const computerCoordinateEnabled = state.computerCoordinateEnabled
  useEffect(() => {
    if (computerCoordinateEnabled === null) {
      chrome.runtime.sendMessage({ type: "computer.get_state" })
    }
    // 仅在尚未查询时拉一次;后续由 computer.state 广播驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // WP6a (Finding 2): the companion reports its platform via apps.list.
  // Off win32, enumerate/add can never succeed — render an honest state
  // instead of a dead add button. Unknown platform (older companion) keeps
  // the UI enabled (backward compatible).
  const platformSupported = appsPlatformSupported(state.appsPlatform)

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

  // WP4 (WI-6): 每应用坐标开关。开启走 companion 生物识别门(现有确认对话框,
  // 扩展零新增);关闭免费(fail-closed 方向)。vault/LOLBIN 由服务端
  // COORDINATE_STRUCTURAL_DENY 拒绝 → 经 apps.updated/错误广播落 appsError 展示。
  const handleToggleCoordinate = (entry: AppEntry) => {
    setMenuOpen(null)
    clearFeedback()
    chrome.runtime.sendMessage({
      type: "apps.set_coordinate_allowed",
      token: entry.token,
      allowed: entry.coordinateAllowed !== true,
    })
  }

  const handleDelete = (entry: AppEntry) => {
    setMenuOpen(null)
    if (confirm(`确定删除应用 "${entry.display_name}"？此操作不可撤销。`)) {
      clearFeedback()
      chrome.runtime.sendMessage({ type: "apps.remove", token: entry.token })
    }
  }

  const handleOpenAdd = () => {
    if (!platformSupported) return
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
        ...(picked.bundleId ? { bundleId: picked.bundleId } : {}),
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
      (c.aumid ?? "").toLowerCase().includes(q) ||
      (c.bundleId ?? "").toLowerCase().includes(q)
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

      {/* P1: 全局坐标开关可切换 — computer.set_enabled + companion L2/biometric gate */}
      <div style={styles.globalToggleRow}>
        <label
          style={{ ...styles.globalToggleLabel, cursor: computerCoordinateEnabled === null ? "default" : "pointer" }}
          title="全局坐标操作：关闭后 host_computer 一律拒绝。开启经确认门（生物识别/确认台）。"
        >
          <input
            type="checkbox"
            checked={computerCoordinateEnabled === true}
            disabled={computerCoordinateEnabled === null}
            style={{ marginRight: 6 }}
            onChange={() => {
              if (computerCoordinateEnabled === null) return
              clearFeedback()
              chrome.runtime.sendMessage({
                type: "computer.set_enabled",
                enabled: computerCoordinateEnabled !== true,
              })
            }}
          />
          <span style={{ fontWeight: 500 }}>坐标操作</span>
        </label>
        {computerCoordinateEnabled === null && <span style={styles.globalOffHint}>状态查询中…</span>}
        {computerCoordinateEnabled === false && (
          <span style={styles.globalOffHint}>已关闭 · 点击开启（需确认）</span>
        )}
        {computerCoordinateEnabled === true && (
          <span style={styles.globalOffHint}>已开启 · 仍需逐应用授权</span>
        )}
      </div>

      <div style={{ ...styles.mcpBody, opacity: appsEnabled ? 1 : 0.5, pointerEvents: appsEnabled ? "auto" : "none" }}>
        {/* Segment switcher — Segment B (CLI 工具) is a Phase-2 placeholder (D12). */}
        <div style={styles.modeSwitcher}>
          <button
            style={{
              ...styles.modeBtn,
              background: segment === "apps" ? tokens.accent : tokens.bgElevated,
              color: segment === "apps" ? tokens.bgElevated : tokens.textSecondary,
              borderColor: segment === "apps" ? tokens.accent : tokens.borderStrong,
            }}
            onClick={() => setSegment("apps")}
            title="GUI 应用白名单（L0 无参启动）"
          >
            应用
          </button>
          <button
            style={{
              ...styles.modeBtn,
              background: segment === "cli" ? tokens.accent : tokens.bgElevated,
              color: segment === "cli" ? tokens.bgElevated : tokens.textSecondary,
              borderColor: segment === "cli" ? tokens.accent : tokens.borderStrong,
            }}
            onClick={() => setSegment("cli")}
            title="结构化 CLI 契约（Phase 2）"
          >
            ⌨️ CLI 工具
          </button>
        </div>

        {segment === "cli" && (
          <CliToolsSegment appsEnabled={appsEnabled} />
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
                onToggleCoordinate={() => handleToggleCoordinate(entry)}
                onDelete={() => handleDelete(entry)}
              />
            ))}
          </>
        )}
      </div>

      {/* Add flow — WP6a (Finding 2): off win32 the enumerate/add round-trip
          can never succeed, so the button is replaced by the honest platform
          state instead of failing dead-ended at the server. */}
      {!platformSupported ? (
        <div style={styles.platformNotice}>
          ⛔ 应用启动仅 Windows 可用{state.appsPlatform ? `（当前平台：${state.appsPlatform}）` : ""}。
          已添加的应用不会被启动。
        </div>
      ) : (
        <button style={styles.addBtn} onClick={handleOpenAdd}>
          {addOpen ? "− 收起添加" : "+ 添加应用"}
        </button>
      )}

      {platformSupported && addOpen && (
        <div style={styles.addArea}>
          <div style={styles.addTabs}>
            <button
              style={{ ...styles.addTabBtn, borderBottom: addTab === "enumerate" ? `2px solid ${tokens.accent}` : "2px solid transparent" }}
              onClick={() => { setAddTab("enumerate"); setPicked(null) }}
            >
              从列表选择
            </button>
            <button
              style={{ ...styles.addTabBtn, borderBottom: addTab === "manual" ? `2px solid ${tokens.accent}` : "2px solid transparent" }}
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
              {/*
                Policy + selected chip ABOVE the list (not below).
                BottomBar panel maxHeight is ~200px and the candidate list alone
                is up to 160px — putting policy under a full unfiltered list
                buried the "选中成功" UI off-screen, so direct picks looked dead
                until search shrank the list. Keep selection feedback always in
                the first paint of the add area.
              */}
              {picked && (
                <div style={styles.pickedBanner}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    已选 <strong>{picked.name}</strong>
                  </span>
                  <button
                    type="button"
                    style={styles.pickedClearBtn}
                    onClick={() => setPicked(null)}
                    title="取消选择"
                  >
                    取消
                  </button>
                </div>
              )}
              {picked && (
                <PolicyPicker
                  addPolicy={addPolicy}
                  setAddPolicy={setAddPolicy}
                  autoDisabled={!!picked.aumid}
                  title={`添加「${picked.name}」，选择策略：`}
                  onSubmit={handleSubmitAdd}
                />
              )}
              {state.appCandidates === null && (
                <div style={styles.emptyMini}>正在枚举本机应用（运行中进程 + 开始菜单）…</div>
              )}
              {state.appCandidates !== null && filteredCandidates.length === 0 && (
                <div style={styles.emptyMini}>无匹配候选</div>
              )}
              <div
                style={{
                  ...styles.candidateList,
                  // Shrink list when a pick is active so policy/submit stay visible.
                  maxHeight: picked ? 88 : 160,
                }}
              >
                {filteredCandidates.map((c, i) => (
                  <CandidateRow
                    key={candidateKey(c, i)}
                    candidate={c}
                    selected={isSameCandidate(c, picked)}
                    onPick={() => handlePickCandidate(c)}
                  />
                ))}
              </div>
            </>
          )}

          {addTab === "manual" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <input
                style={styles.searchInput}
                type="text"
                placeholder={navigator.platform?.includes("Mac") ? "com.apple.Notes（macOS Bundle ID）" : "C:\\Path\\To\\app.exe（服务端将校验并解析真实路径）"}
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
              {manualPath.trim() && (
                <PolicyPicker
                  addPolicy={addPolicy}
                  setAddPolicy={setAddPolicy}
                  autoDisabled={false}
                  title="选择策略："
                  onSubmit={handleSubmitAdd}
                />
              )}
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
  onToggleCoordinate: () => void
  onDelete: () => void
}

function AppCard(props: AppCardProps) {
  const { entry, menuOpen } = props
  const badge = policyBadge(entry.policy)
  const warns = appWarnReasons(entry)
  const autoOk = autoEligible(entry)
  const isPreset = entry.source === "preset"
  // WP4 (WI-6): uiaCapable 三态徽标——中性能力措辞,绝不渲染成安全背书。
  const uiaBadge = uiaCapableBadge(entry)

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
            <span
              style={{ ...styles.policyBadgeMini, color: uiaBadge.color, background: uiaBadge.bg }}
              title={uiaBadge.title}
            >
              {uiaBadge.label}
            </span>
            {entry.coordinateAllowed === true && (
              <span style={{ ...styles.policyBadgeMini, color: tokens.success, background: tokens.successSoft }} title="已允许 agent 在此应用窗口内执行坐标操作">
                坐标
              </span>
            )}
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
            {entry.bundleId && (
              <span style={styles.uwpBadge} title={entry.bundleId}>macOS</span>
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
                    color: disabled ? tokens.textMuted : current ? tokens.accent : tokens.text,
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
            <div style={{ ...styles.menuSectionTitle, borderTop: `1px solid ${tokens.border}` }}>坐标操作</div>
            <button
              style={{
                ...styles.menuItem,
                color: entry.coordinateAllowed === true ? tokens.success : tokens.text,
              }}
              title={
                entry.coordinateAllowed === true
                  ? "已允许坐标操作——点击关闭（立即生效，无需验证）"
                  : "允许 agent 在此应用窗口内执行坐标点击/输入（开启需 Windows Hello 验证）"
              }
              onClick={props.onToggleCoordinate}
            >
              {entry.coordinateAllowed === true ? "✓ 允许坐标操作" : "允许坐标操作"}
              {entry.coordinateAllowed !== true && "（需 Hello 验证）"}
            </button>
            <button
              style={{
                ...styles.menuItem,
                color: isPreset ? tokens.textMuted : tokens.danger,
                borderTop: `1px solid ${tokens.border}`,
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

function PolicyPicker({
  addPolicy,
  setAddPolicy,
  autoDisabled,
  title,
  onSubmit,
}: {
  addPolicy: AppPolicy
  setAddPolicy: (p: AppPolicy) => void
  autoDisabled: boolean
  title: string
  onSubmit: () => void
}) {
  return (
    <div style={styles.policyRow}>
      <div style={styles.policyRowTitle}>{title}</div>
      {(["manual", "ai", "auto"] as const).map((p) => {
        const badge = policyBadge(p)
        // AUMID candidates never carry a signer record — always capped at "ai".
        const disabled = p === "auto" && autoDisabled
        return (
          <label
            key={p}
            style={{ ...styles.policyOption, opacity: disabled ? 0.45 : 1 }}
            title={
              disabled
                ? "UWP 应用没有签名记录，最高只能设为「AI 判断」"
                : badge.title
            }
          >
            <input
              type="radio"
              name="apps-add-policy"
              checked={addPolicy === p}
              disabled={disabled}
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
        <div style={styles.autoBioHint}>「全自动(仅启动免确认)」需要 Windows Hello（或确认码）验证一次。</div>
      )}
      <button type="button" style={styles.submitBtn} onClick={onSubmit}>
        添加
      </button>
    </div>
  )
}

function CandidateRow({
  candidate,
  selected,
  onPick,
}: {
  candidate: AppEnumerateCandidate
  selected: boolean
  onPick: () => void
}) {
  const c = candidate
  return (
    <button
      type="button"
      style={{
        ...styles.candidateRow,
        opacity: c.blocked ? 0.5 : 1,
        cursor: c.blocked ? "not-allowed" : "pointer",
        ...(selected
          ? {
              borderColor: tokens.accent,
              background: tokens.bgActive,
              boxShadow: `inset 0 0 0 1px ${tokens.accent}`,
            }
          : {}),
      }}
      disabled={c.blocked}
      onClick={onPick}
      aria-pressed={selected}
      title={
        c.blocked
          ? "系统工具（lolbin），禁止添加"
          : c.path || c.aumid || c.name
      }
    >
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>
          {selected ? "✓ " : ""}
          {c.name}
        </span>
        {c.vault_token && (
          <span style={styles.warnBadge} title={`属于 vault 名单应用（${c.vault_token}）`}>⚠ vault</span>
        )}
        {c.blocked && <span style={styles.blockedBadge}>禁止添加</span>}
        <span style={styles.candidatePath}>
          {c.aumid ? "UWP 应用" : c.bundleId ? c.bundleId : c.path ? ellipsizePath(c.path, 36) : ""}
        </span>
      </span>
      <span style={styles.sourceBadge}>{c.source === "running" ? "运行中" : c.source === "installed" ? "已安装" : "开始菜单"}</span>
    </button>
  )
}

// --- Styles (mirror McpPanel) ---


/** Segment B — CLI tools (Phase-2 structured host_cli). Policy cap: ai/manual only. */
function CliToolsSegment({ appsEnabled }: { appsEnabled: boolean }) {
  const { state, dispatch } = useAgentStore()
  const [path, setPath] = useState("")
  const [name, setName] = useState("")
  const [manifestJson, setManifestJson] = useState(
    '{\n  "schema_version": 1,\n  "subcommands": [\n    {\n      "name": "run",\n      "risk": "read-only",\n      "positionals": [{ "name": "token", "required": true, "value_regex": "^[A-Za-z0-9._-]{1,64}$" }]\n    }\n  ]\n}',
  )
  const [err, setErr] = useState<string | null>(null)
  const cliEntries = state.appEntries.filter((e) => e.kind === "cli")

  const handleAdd = () => {
    setErr(null)
    let manifest: unknown
    try {
      manifest = JSON.parse(manifestJson)
    } catch {
      setErr("cli_manifest JSON 无效")
      return
    }
    if (!path.trim()) {
      setErr("需要绝对路径")
      return
    }
    dispatch({ type: "SET_APPS_ERROR", error: null })
    chrome.runtime.sendMessage({
      type: "apps.add",
      kind: "cli",
      path: path.trim(),
      display_name: name.trim() || undefined,
      origin: "manual-paste",
      policy: "manual",
      cli_manifest: manifest,
    })
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: tokens.textSecondary, marginBottom: 8, lineHeight: 1.45 }}>
        结构化 CLI：仅声明的 subcommand/flag/positional 可执行（host_cli）。策略最高「AI 判断」，无免确认。输出视为不可信。
        参数风格为 GNU 长旗标（--flag）；Windows 原生 /Flag 工具请用包装脚本或改用 shell 企业通道。路径参数支持中文等 Unicode（默认白名单）。
      </div>
      {cliEntries.length === 0 ? (
        <div style={styles.emptyText}>尚未添加 CLI 工具</div>
      ) : (
        cliEntries.map((e) => (
          <div key={e.token} style={styles.appCard}>
            <div style={{ fontWeight: 600, fontSize: 12 }}>{e.display_name}</div>
            <div style={{ fontSize: 10, color: tokens.textMuted }}>{e.token}</div>
            <div style={{ fontSize: 10, color: tokens.textSecondary, marginTop: 2 }}>
              policy: {e.policy} · {e.enabled ? "启用" : "停用"}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                type="button"
                style={styles.dismissBtn}
                onClick={() =>
                  chrome.runtime.sendMessage({
                    type: "apps.set_enabled",
                    token: e.token,
                    enabled: !e.enabled,
                  })
                }
              >
                {e.enabled ? "停用" : "启用"}
              </button>
              <button
                type="button"
                style={styles.dismissBtn}
                onClick={() => {
                  if (confirm(`删除 CLI "${e.display_name}"？`)) {
                    chrome.runtime.sendMessage({ type: "apps.remove", token: e.token })
                  }
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))
      )}
      <div style={{ marginTop: 12, borderTop: `1px solid ${tokens.border}`, paddingTop: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>添加 CLI（粘贴绝对路径 + manifest）</div>
        <input
          style={{ width: "100%", fontSize: 11, marginBottom: 6, boxSizing: "border-box" }}
          placeholder="绝对路径（如 /usr/bin/rg 或 C:\\tools\\rg.exe）"
          value={path}
          onChange={(ev) => setPath(ev.target.value)}
          disabled={!appsEnabled}
        />
        <input
          style={{ width: "100%", fontSize: 11, marginBottom: 6, boxSizing: "border-box" }}
          placeholder="显示名（可选）"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          disabled={!appsEnabled}
        />
        <textarea
          style={{ width: "100%", fontSize: 10, minHeight: 120, fontFamily: "monospace", boxSizing: "border-box" }}
          value={manifestJson}
          onChange={(ev) => setManifestJson(ev.target.value)}
          disabled={!appsEnabled}
        />
        {err && <div style={{ color: tokens.danger, fontSize: 11, marginTop: 4 }}>{err}</div>}
        <button type="button" style={{ ...styles.dismissBtn, marginTop: 6 }} onClick={handleAdd} disabled={!appsEnabled}>
          添加 CLI 工具
        </button>
      </div>
    </div>
  )
}


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
    background: tokens.bgMuted,
    border: `1px solid ${tokens.border}`,
    borderRadius: 4,
  },
  globalToggleLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 12,
    color: tokens.textSecondary,
  },
  globalOffHint: {
    fontSize: 10,
    color: tokens.textMuted,
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
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: 4,
    fontSize: 12,
    cursor: "pointer",
    background: tokens.bgElevated,
    color: tokens.textSecondary,
  },
  emptyText: {
    padding: "16px 8px",
    textAlign: "center",
    fontSize: 12,
    color: tokens.textSecondary,
    lineHeight: 1.5,
  },
  emptyMini: {
    fontSize: 11,
    color: tokens.textSecondary,
    fontStyle: "italic",
    padding: "6px 2px",
  },
  presetSection: {
    border: `1px solid ${tokens.border}`,
    borderRadius: 6,
    padding: 6,
    background: tokens.bgElevated,
  },
  presetHeader: {
    fontSize: 10,
    fontWeight: 600,
    color: tokens.textSecondary,
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
    background: tokens.successSoft,
    color: tokens.success,
  },
  presetUndetectedBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: tokens.bgMuted,
    color: tokens.textMuted,
  },
  serverCard: {
    border: `1px solid ${tokens.border}`,
    borderRadius: 6,
    padding: 8,
    background: tokens.bgMuted,
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
    color: tokens.textSecondary,
    marginTop: 2,
    flexWrap: "wrap",
    alignItems: "center",
  },
  transportBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: tokens.accentSoft,
    color: tokens.accentText,
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
    background: tokens.warningSoft,
    color: tokens.warning,
    marginLeft: 4,
  },
  uwpBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: tokens.accentSoft,
    color: tokens.accentText,
  },
  blockedBadge: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 3,
    background: tokens.dangerSoft,
    color: tokens.danger,
    marginLeft: 4,
  },
  enabledToggle: {
    fontSize: 10,
    color: tokens.textSecondary,
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
    color: tokens.textSecondary,
  },
  menuBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    padding: "2px 4px",
    fontSize: 14,
    color: tokens.textSecondary,
    letterSpacing: -1,
  },
  menuDropdown: {
    ...popupMenuStyles.menu,
    position: "absolute" as const,
    right: 0,
    top: "100%",
    zIndex: 10,
    minWidth: 180,
  },
  menuSectionTitle: {
    fontSize: 10,
    color: tokens.textMuted,
    padding: "6px 12px 2px",
    fontFamily: tokens.font,
  },
  menuItem: popupMenuStyles.menuItem,
  addBtn: {
    marginTop: 6,
    padding: "8px 12px",
    border: `1px dashed ${tokens.accent}`,
    borderRadius: 6,
    background: "transparent",
    color: tokens.accent,
    cursor: "pointer",
    fontSize: 12,
  },
  platformNotice: {
    marginTop: 6,
    padding: "8px 10px",
    border: `1px solid ${tokens.border}`,
    borderRadius: 6,
    background: tokens.bgMuted,
    color: tokens.textSecondary,
    fontSize: 11,
    lineHeight: 1.5,
  },
  addArea: {
    border: `1px solid ${tokens.border}`,
    borderRadius: 6,
    padding: 6,
    background: tokens.bgElevated,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  addTabs: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    borderBottom: `1px solid ${tokens.border}`,
  },
  addTabBtn: {
    border: "none",
    background: "transparent",
    fontSize: 12,
    padding: "4px 6px",
    cursor: "pointer",
    color: tokens.textSecondary,
  },
  searchInput: {
    width: "100%",
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 11,
    outline: "none",
    boxSizing: "border-box",
  },
  manualHint: {
    fontSize: 10,
    color: tokens.warning,
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
    border: `1px solid ${tokens.border}`,
    borderRadius: 4,
    background: tokens.bgMuted,
    padding: "4px 6px",
  },
  pickedBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    borderRadius: 4,
    background: tokens.bgActive,
    border: `1px solid ${tokens.accent}`,
    fontSize: 12,
    color: tokens.accentText,
  },
  pickedClearBtn: {
    border: `1px solid ${tokens.borderStrong}`,
    background: tokens.bgElevated,
    borderRadius: 4,
    fontSize: 11,
    color: tokens.accentText,
    cursor: "pointer",
    padding: "2px 8px",
    flexShrink: 0,
  },
  candidatePath: {
    display: "block",
    fontSize: 10,
    color: tokens.textMuted,
    fontFamily: "ui-monospace, monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sourceBadge: {
    fontSize: 9,
    padding: "1px 4px",
    borderRadius: 3,
    background: tokens.bgActive,
    color: tokens.accent,
    flexShrink: 0,
  },
  policyRow: {
    borderTop: `1px dashed ${tokens.border}`,
    paddingTop: 6,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  policyRowTitle: {
    fontSize: 11,
    fontWeight: 500,
    color: tokens.textSecondary,
  },
  policyOption: {
    display: "flex",
    alignItems: "center",
    fontSize: 11,
    cursor: "pointer",
  },
  autoBioHint: {
    fontSize: 10,
    color: tokens.warning,
  },
  submitBtn: {
    marginTop: 4,
    padding: "6px 10px",
    border: "none",
    borderRadius: 4,
    background: tokens.accent,
    color: tokens.userBubbleText,
    fontSize: 12,
    cursor: "pointer",
  },
  warningsBox: {
    border: `1px solid ${tokens.warning}`,
    background: tokens.warningSoft,
    borderRadius: 6,
    padding: 8,
    fontSize: 11,
    color: tokens.warning,
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
    border: `1px solid ${tokens.danger}`,
    background: tokens.dangerSoft,
    borderRadius: 6,
    padding: 8,
    fontSize: 11,
    color: tokens.danger,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  dismissBtn: {
    alignSelf: "flex-end",
    border: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    borderRadius: 4,
    fontSize: 10,
    padding: "2px 8px",
    cursor: "pointer",
    color: tokens.textSecondary,
  },
}
