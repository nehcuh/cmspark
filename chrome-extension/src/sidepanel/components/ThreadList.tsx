// Thread list — Timeline IA: today/yesterday + month→day, multi-select, tags view (P1).

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import type { Thread } from "../types"
import {
  buildTagIndex,
  displayThreadTitle,
  filterThreadsByQuery,
  formatRelativeTime,
  groupThreadsByCalendar,
  isMonthGroupOpen,
  isPinnedGroupOpen,
  LS_THREAD_LIST_EXPAND,
  LS_THREAD_LIST_EXPAND_MONTHS_LEGACY,
  parseThreadListExpand,
  roleBadge,
  selectionState,
  threadIdsInDay,
  threadIdsInMonth,
  toggleGroupSelection,
  type MonthGroup,
  type DayGroup,
  type ThreadListExpandState,
} from "../utils/thread-timeline"

function generateShortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = ""
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function loadExpandState(): ThreadListExpandState {
  try {
    const raw = localStorage.getItem(LS_THREAD_LIST_EXPAND)
    if (raw) return parseThreadListExpand(raw)
    // One-shot migrate legacy months array
    const legacy = localStorage.getItem(LS_THREAD_LIST_EXPAND_MONTHS_LEGACY)
    if (legacy) {
      const migrated = parseThreadListExpand(legacy)
      saveExpandState(migrated)
      try {
        localStorage.removeItem(LS_THREAD_LIST_EXPAND_MONTHS_LEGACY)
      } catch {
        /* ignore */
      }
      return migrated
    }
  } catch {
    /* ignore */
  }
  return parseThreadListExpand(null)
}

function saveExpandState(state: ThreadListExpandState) {
  try {
    localStorage.setItem(LS_THREAD_LIST_EXPAND, JSON.stringify(state))
  } catch {
    /* ignore quota */
  }
}

type ListView = "time" | "tags"

export function ThreadList() {
  const { state, dispatch } = useAgentStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<ListView>("time")
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [expandState, setExpandState] = useState<ThreadListExpandState>(loadExpandState)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set())
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [extractingIds, setExtractingIds] = useState<Set<string>>(() => new Set())
  const [trashView, setTrashView] = useState(false)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupSuggestions, setCleanupSuggestions] = useState<
    Array<{ thread_id: string; reason: string; detail: string; confidence: number }>
  >([])
  const [cleanupSelected, setCleanupSelected] = useState<Set<string>>(() => new Set())
  const [cleanupDays, setCleanupDays] = useState(30)
  const { threads, activeThreadId, threadBusyById } = state

  const now = useMemo(() => new Date(), [open, threads.length])

  useEffect(() => {
    const onSug = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const list = Array.isArray(detail?.suggestions) ? detail.suggestions : []
      setCleanupSuggestions(list)
      setCleanupSelected(new Set(list.map((s: { thread_id: string }) => s.thread_id)))
      setCleanupOpen(true)
    }
    window.addEventListener("cmspark:cleanup_suggestions", onSug as EventListener)
    return () =>
      window.removeEventListener("cmspark:cleanup_suggestions", onSug as EventListener)
  }, [])

  const filtered = useMemo(() => {
    const base = (threads as Thread[]).filter((t) =>
      trashView ? !!t.trashed_at : !t.trashed_at,
    )
    return filterThreadsByQuery(base, query)
  }, [threads, query, trashView])

  const timeline = useMemo(
    () => groupThreadsByCalendar(filtered as Thread[], now),
    [filtered, now],
  )

  const tagIndex = useMemo(() => buildTagIndex(filtered as Thread[]), [filtered])

  const tagKeys = useMemo(() => {
    return [...tagIndex.keys()]
      .filter((k) => k !== "__untagged__")
      .sort((a, b) => {
        const ca = tagIndex.get(a)?.length || 0
        const cb = tagIndex.get(b)?.length || 0
        return cb - ca || a.localeCompare(b)
      })
  }, [tagIndex])

  const selectableIds = useMemo(() => {
    const s = new Set<string>()
    for (const t of filtered) {
      if (!threadBusyById[t.id]) s.add(t.id)
    }
    return s
  }, [filtered, threadBusyById])

  const searchActive = query.trim().length > 0

  const toggleMonth = (monthKey: string) => {
    setExpandState((prev) => {
      const months = prev.months.includes(monthKey)
        ? prev.months.filter((k) => k !== monthKey)
        : [...prev.months, monthKey]
      const next = { ...prev, months }
      saveExpandState(next)
      return next
    })
  }

  const togglePinned = (key: "today" | "yesterday") => {
    setExpandState((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      saveExpandState(next)
      return next
    })
  }

  const toggleDay = (dayKey: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev)
      if (next.has(dayKey)) next.delete(dayKey)
      else next.add(dayKey)
      return next
    })
  }

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelected(new Set())
  }, [])

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
        context_window: 128000,
        trusted_domains: [],
        safety_skills_enabled: [] as string[],
      },
      tool_whitelist: null as string[] | null,
      pinned_tabs: [] as number[],
      active_skill_ids: ["browse"] as string[],
    }
    dispatch({ type: "ADD_THREAD", thread })
    chrome.runtime.sendMessage({ type: "thread.create", alias: "", id })
    setOpen(false)
    exitSelectMode()
  }

  const handleCleanupEmpty = () => {
    if (!confirm("确定清理所有空白线程？\n没有消息的线程将被永久删除，此操作不可恢复。")) return
    chrome.runtime.sendMessage({ type: "thread.cleanup_empty" })
    setMenuOpen(false)
    setOpen(false)
  }

  const handleGenerateTitle = () => {
    const targetThreadId = activeThreadId || threads[0]?.id
    if (!targetThreadId) {
      alert("暂无线程可生成标题")
      return
    }
    chrome.runtime.sendMessage({ type: "thread.generate_title", thread_id: targetThreadId })
    setMenuOpen(false)
  }

  const handleBatchAutoTitle = (ids?: string[]) => {
    const payload: Record<string, unknown> = {
      type: "thread.batch_auto_title",
      only_empty: true,
    }
    if (ids && ids.length > 0) payload.thread_ids = ids
    chrome.runtime.sendMessage(payload)
    setMenuOpen(false)
  }

  const handleExtractDigest = (ids: string[]) => {
    if (ids.length === 0) return
    setExtractingIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })
    chrome.runtime.sendMessage({
      type: "thread.extract_digest",
      thread_ids: ids.slice(0, 20),
      force: false,
    })
    // Clear spinners after a while; real updates arrive via digest_updated
    window.setTimeout(() => {
      setExtractingIds((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      })
    }, 60_000)
  }

  const handleSelect = (threadId: string) => {
    if (selectMode) {
      if (threadBusyById[threadId]) return
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(threadId)) next.delete(threadId)
        else next.add(threadId)
        return next
      })
      return
    }
    // Dual-review residual: do not activate soft-deleted threads into main chat
    if (trashView) return
    const thr = threads.find((t) => t.id === threadId)
    if (thr?.trashed_at) return
    dispatch({ type: "SET_ACTIVE_THREAD", threadId })
    chrome.runtime.sendMessage({ type: "thread.select", threadId })
    setOpen(false)
  }

  const handleDeleteOne = (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (threadBusyById[threadId]) {
      alert("该线程正在运行，无法删除")
      return
    }
    if (trashView) {
      if (!confirm(`永久删除线程 "${threadId}"？不可恢复。`)) return
      dispatch({ type: "REMOVE_THREAD", threadId })
      chrome.runtime.sendMessage({ type: "thread.delete", thread_id: threadId, mode: "hard" })
      return
    }
    if (confirm(`将线程移入回收站？\n可在 ⋯ → 回收站 中恢复（约 30 天后自动清理）。`)) {
      dispatch({ type: "REMOVE_THREAD", threadId })
      chrome.runtime.sendMessage({ type: "thread.delete", thread_id: threadId, mode: "trash" })
    }
  }

  const handleBatchDelete = () => {
    const ids = [...selected].filter((id) => selectableIds.has(id))
    if (ids.length === 0) return
    const preview = ids.slice(0, 12).join(", ") + (ids.length > 12 ? " …" : "")
    if (trashView) {
      if (!confirm(`永久删除 ${ids.length} 个会话？不可恢复。\n\n${preview}`)) return
      dispatch({ type: "REMOVE_THREADS", threadIds: ids })
      chrome.runtime.sendMessage({ type: "thread.batch_delete", thread_ids: ids, mode: "hard" })
      exitSelectMode()
      return
    }
    if (
      !confirm(
        `将 ${ids.length} 个会话移入回收站？\n可稍后恢复（约 30 天后自动清理）。\n\n${preview}`,
      )
    ) {
      return
    }
    dispatch({ type: "REMOVE_THREADS", threadIds: ids })
    chrome.runtime.sendMessage({ type: "thread.batch_delete", thread_ids: ids, mode: "trash" })
    exitSelectMode()
  }

  const handleRestore = (ids: string[]) => {
    if (ids.length === 0) return
    chrome.runtime.sendMessage({ type: "thread.restore", thread_ids: ids })
    dispatch({ type: "REMOVE_THREADS", threadIds: ids }) // drop from trash view until list refresh
    chrome.runtime.sendMessage({ type: "thread.list", include_trashed: true })
    exitSelectMode()
  }

  const openTrashView = () => {
    setTrashView(true)
    setView("time")
    setMenuOpen(false)
    chrome.runtime.sendMessage({ type: "thread.list", include_trashed: true })
  }

  const closeTrashView = () => {
    setTrashView(false)
    chrome.runtime.sendMessage({ type: "thread.list" })
  }

  const runCleanupScan = () => {
    const to = new Date()
    const from = new Date(to.getTime() - cleanupDays * 86400_000)
    chrome.runtime.sendMessage({
      type: "thread.suggest_cleanup",
      to: from.toISOString(), // threads updated before (now - days)
      include_workers: false,
    })
    setMenuOpen(false)
  }

  const applyCleanupTrash = () => {
    const ids = [...cleanupSelected]
    if (ids.length === 0) return
    if (!confirm(`将 ${ids.length} 个建议会话移入回收站？`)) return
    chrome.runtime.sendMessage({ type: "thread.batch_delete", thread_ids: ids, mode: "trash" })
    dispatch({ type: "REMOVE_THREADS", threadIds: ids })
    setCleanupOpen(false)
    setCleanupSuggestions([])
  }

  const panelMaxHeight = selectMode || view === "tags" ? 480 : 360

  const renderThreadRow = (t: Thread) => {
    const busy = !!threadBusyById[t.id]
    const isActive = t.id === activeThreadId
    const badge = roleBadge(t.agent_role)
    const preview = (t.first_user_preview || "").trim()
    const title = displayThreadTitle(t)
    const rel = formatRelativeTime(t.updated_at || t.created_at, now)
    const tags = t.digest?.tags || []
    const extracting = extractingIds.has(t.id)

    return (
      <div
        key={t.id}
        style={{
          ...styles.threadItem,
          background: isActive ? tokens.accentSoft : "transparent",
          opacity: selectMode && busy ? 0.45 : 1,
        }}
        onClick={() => {
          const sel = window.getSelection?.()
          if (sel && sel.toString().length > 0) return
          handleSelect(t.id)
        }}
      >
        {selectMode && (
          <input
            type="checkbox"
            checked={selected.has(t.id)}
            disabled={busy}
            onChange={() => handleSelect(t.id)}
            onClick={(e) => e.stopPropagation()}
            title={busy ? "运行中，不可选" : undefined}
            style={styles.checkbox}
            aria-label={`选择 ${title}`}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.threadAliasRow}>
            <span style={styles.threadAlias}>{title}</span>
            {badge && <span style={styles.badge}>{badge}</span>}
            {extracting && <span style={styles.badgeMuted}>抽取中</span>}
            {t.digest?.stale && view === "tags" && (
              <span style={styles.badgeMuted} title="要点可能过期">
                过期
              </span>
            )}
          </div>
          {tags.length > 0 && (
            <div style={styles.tagRow}>
              {tags.slice(0, 4).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  style={styles.tagPill}
                  onClick={(e) => {
                    e.stopPropagation()
                    setView("tags")
                    setActiveTag(tag)
                  }}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
          {preview ? (
            <div style={styles.preview}>{preview}</div>
          ) : (
            <div style={styles.threadId}>#{t.id}</div>
          )}
          {rel && <div style={styles.relTime}>{rel}</div>}
        </div>
        {!selectMode && (
          <>
            <button
              style={styles.iconBtn}
              onClick={(e) => {
                e.stopPropagation()
                handleExtractDigest([t.id])
              }}
              title="提取要点 / 标签"
            >
              🏷
            </button>
            <button
              style={styles.iconBtn}
              onClick={(e) => {
                e.stopPropagation()
                dispatch({ type: "SET_SUMMARIZING_THREAD", threadId: t.id })
                chrome.runtime.sendMessage({
                  type: "thread.export_obsidian",
                  thread_id: t.id,
                  scope: "summary",
                })
              }}
              disabled={state.summarizingThreadId === t.id}
              title="导出此线程摘要到 Obsidian"
            >
              {state.summarizingThreadId === t.id ? "⏳" : "🧠"}
            </button>
            <button
              style={styles.iconBtn}
              onClick={(e) => handleDeleteOne(t.id, e)}
              title="删除线程"
            >
              🗑️
            </button>
          </>
        )}
      </div>
    )
  }

  const renderGroupCheckbox = (ids: string[], label: string) => {
    if (!selectMode) return null
    const eligible = ids.filter((id) => selectableIds.has(id))
    const st = selectionState(eligible, selected)
    return (
      <input
        type="checkbox"
        checked={st === "all" && eligible.length > 0}
        ref={(el) => {
          if (el) el.indeterminate = st === "some"
        }}
        disabled={eligible.length === 0}
        onChange={() => {
          setSelected((prev) => toggleGroupSelection(ids, prev, selectableIds))
        }}
        onClick={(e) => e.stopPropagation()}
        aria-label={`选择 ${label}`}
        style={styles.checkbox}
      />
    )
  }

  const renderMonth = (month: MonthGroup) => {
    const openMonth = isMonthGroupOpen(month.monthKey, expandState, {
      searchActive,
      hasMatches: searchActive && month.count > 0,
    })
    const ids = threadIdsInMonth(month)
    return (
      <div key={month.monthKey}>
        <div style={styles.groupHeader} onClick={() => toggleMonth(month.monthKey)}>
          {renderGroupCheckbox(ids, month.label)}
          <span style={styles.groupChevron}>{openMonth ? "▼" : "▶"}</span>
          <span style={styles.groupLabel}>
            {month.label} · {month.count}
          </span>
        </div>
        {openMonth && month.days.map((day) => renderDay(day))}
      </div>
    )
  }

  const renderDay = (day: DayGroup) => {
    const openDay = expandedDays.has(day.dayKey)
    const ids = threadIdsInDay(day)
    return (
      <div key={day.dayKey}>
        <div
          style={{ ...styles.groupHeader, paddingLeft: 20 }}
          onClick={() => toggleDay(day.dayKey)}
        >
          {renderGroupCheckbox(ids, day.label)}
          <span style={styles.groupChevron}>{openDay ? "▼" : "▶"}</span>
          <span style={styles.groupLabel}>
            {day.label} · {day.threads.length}
          </span>
        </div>
        {openDay && day.threads.map((t) => renderThreadRow(t as Thread))}
      </div>
    )
  }

  const renderTimeline = () => {
    const todayOpen = isPinnedGroupOpen("today", expandState, {
      searchActive,
      hasMatches: searchActive && timeline.today.length > 0,
    })
    const yesterdayOpen = isPinnedGroupOpen("yesterday", expandState, {
      searchActive,
      hasMatches: searchActive && timeline.yesterday.length > 0,
    })
    return (
      <>
        {timeline.today.length > 0 && (
          <div>
            <div style={styles.groupHeader} onClick={() => togglePinned("today")}>
              {renderGroupCheckbox(
                timeline.today.map((t) => t.id),
                "今天",
              )}
              <span style={styles.groupChevron}>{todayOpen ? "▼" : "▶"}</span>
              <span style={styles.groupLabel}>今天 · {timeline.today.length}</span>
            </div>
            {todayOpen && timeline.today.map((t) => renderThreadRow(t as Thread))}
          </div>
        )}

        {timeline.yesterday.length > 0 && (
          <div>
            <div style={styles.groupHeader} onClick={() => togglePinned("yesterday")}>
              {renderGroupCheckbox(
                timeline.yesterday.map((t) => t.id),
                "昨天",
              )}
              <span style={styles.groupChevron}>{yesterdayOpen ? "▼" : "▶"}</span>
              <span style={styles.groupLabel}>昨天 · {timeline.yesterday.length}</span>
            </div>
            {yesterdayOpen && timeline.yesterday.map((t) => renderThreadRow(t as Thread))}
          </div>
        )}

        {timeline.months.map(renderMonth)}

        {filtered.length === 0 && (
          <div style={{ color: tokens.textMuted, fontSize: 12, padding: 12, textAlign: "center" }}>
            {threads.length === 0 ? "暂无线程，点击「+ 新建」" : "无匹配线程"}
          </div>
        )}
      </>
    )
  }

  const renderTagsView = () => {
    const untagged = tagIndex.get("__untagged__") || []
    const listForTag =
      activeTag === null
        ? null
        : activeTag === "__untagged__"
          ? untagged
          : tagIndex.get(activeTag) || []

    return (
      <div>
        <div style={styles.tagCloud}>
          {tagKeys.length === 0 && untagged.length === 0 && (
            <div style={{ color: tokens.textMuted, fontSize: 12, padding: 8 }}>
              暂无标签。点 🏷 或「提取要点」为会话生成标签。
            </div>
          )}
          {tagKeys.map((tag) => {
            const n = tagIndex.get(tag)?.length || 0
            const active = activeTag === tag
            return (
              <button
                key={tag}
                type="button"
                style={active ? styles.tagPillActive : styles.tagPill}
                onClick={() => setActiveTag(active ? null : tag)}
              >
                #{tag} {n}
              </button>
            )
          })}
          {untagged.length > 0 && (
            <button
              type="button"
              style={
                activeTag === "__untagged__" ? styles.tagPillActive : styles.tagPill
              }
              onClick={() =>
                setActiveTag(activeTag === "__untagged__" ? null : "__untagged__")
              }
            >
              #未标注 {untagged.length}
            </button>
          )}
        </div>
        {listForTag && (
          <div>
            <div style={styles.groupHeader}>
              <span style={styles.groupLabel}>
                {activeTag === "__untagged__" ? "未标注" : `#${activeTag}`} ·{" "}
                {listForTag.length}
              </span>
            </div>
            {listForTag.map((t) => renderThreadRow(t as Thread))}
          </div>
        )}
        {!listForTag && tagKeys.length > 0 && (
          <div style={{ color: tokens.textMuted, fontSize: 12, padding: 10 }}>
            选择上方标签查看会话
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        style={styles.hamburger}
        onClick={() => setOpen(!open)}
        title="线程列表"
        aria-label="线程列表"
        aria-expanded={open}
      >
        ☰
      </button>

      {open && (
        <>
          <div
            style={styles.backdrop}
            onClick={() => {
              setOpen(false)
              setMenuOpen(false)
              if (selectMode) exitSelectMode()
            }}
          />
          <div style={{ ...styles.panel, maxHeight: panelMaxHeight }}>
            <div style={styles.panelHeader}>
              <div style={styles.viewToggle}>
                <button
                  type="button"
                  style={view === "time" ? styles.viewBtnActive : styles.viewBtn}
                  onClick={() => setView("time")}
                >
                  时间
                </button>
                <button
                  type="button"
                  style={view === "tags" ? styles.viewBtnActive : styles.viewBtn}
                  onClick={() => setView("tags")}
                >
                  标签
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                <button
                  type="button"
                  style={selectMode ? styles.selectBtnActive : styles.selectBtn}
                  onClick={() => {
                    if (selectMode) exitSelectMode()
                    else {
                      setSelectMode(true)
                      setSelected(new Set())
                    }
                  }}
                  title="多选"
                >
                  {selectMode ? "取消" : "选择"}
                </button>
                <button style={styles.newBtn} onClick={handleNewThread} title="新建线程">
                  + 新建
                </button>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    style={styles.menuBtn}
                    onClick={() => setMenuOpen((v) => !v)}
                    title="更多"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                  >
                    ⋯
                  </button>
                  {menuOpen && (
                    <div style={styles.menu} role="menu">
                      <button type="button" style={styles.menuItem} onClick={handleGenerateTitle}>
                        ✨ AI 生成标题
                      </button>
                      <button
                        type="button"
                        style={styles.menuItem}
                        onClick={() => handleBatchAutoTitle()}
                      >
                        📝 未命名→首条起名
                      </button>
                      <button type="button" style={styles.menuItem} onClick={handleCleanupEmpty}>
                        🧹 清理空白
                      </button>
                      <button
                        type="button"
                        style={styles.menuItem}
                        onClick={() => {
                          setCleanupOpen(true)
                          setMenuOpen(false)
                        }}
                      >
                        🗂 整理助手
                      </button>
                      <button
                        type="button"
                        style={styles.menuItem}
                        onClick={() => (trashView ? closeTrashView() : openTrashView())}
                      >
                        {trashView ? "← 返回列表" : "🗑 回收站"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {trashView && (
              <div
                style={{
                  padding: "6px 10px",
                  background: tokens.warningSoft,
                  color: tokens.warning,
                  fontSize: 11,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>回收站 · {filtered.length}（约 30 天后自动清理）</span>
                <button type="button" style={styles.selectBtn} onClick={closeTrashView}>
                  返回
                </button>
              </div>
            )}

            <div style={styles.searchRow}>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题 / ID / 消息 / 标签…"
                style={styles.searchInput}
                aria-label="搜索线程"
              />
            </div>

            <div style={styles.list}>
              {view === "time" ? renderTimeline() : renderTagsView()}
            </div>

            {selectMode && (
              <div style={styles.bottomBar}>
                <span style={{ fontSize: 12, color: tokens.textSecondary }}>
                  已选 {selected.size}
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {trashView ? (
                    <button
                      type="button"
                      style={styles.selectBtn}
                      disabled={selected.size === 0}
                      onClick={() => handleRestore([...selected])}
                    >
                      恢复
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        style={styles.selectBtn}
                        disabled={selected.size === 0}
                        onClick={() => {
                          handleBatchAutoTitle([...selected])
                          exitSelectMode()
                        }}
                        title="用首条消息为选中未命名会话起名"
                      >
                        起名
                      </button>
                      <button
                        type="button"
                        style={styles.selectBtn}
                        disabled={selected.size === 0}
                        onClick={() => {
                          handleExtractDigest([...selected])
                          exitSelectMode()
                        }}
                      >
                        提取要点
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    style={styles.dangerBtn}
                    disabled={selected.size === 0}
                    onClick={handleBatchDelete}
                  >
                    {trashView ? "永久删除" : "回收站"}
                  </button>
                  <button type="button" style={styles.selectBtn} onClick={exitSelectMode}>
                    取消
                  </button>
                </div>
              </div>
            )}

            {cleanupOpen && (
              <div style={styles.cleanupPanel}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>整理助手（规则）</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: tokens.textSecondary }}>扫描</span>
                  <select
                    value={cleanupDays}
                    onChange={(e) => setCleanupDays(Number(e.target.value))}
                    style={{ fontSize: 11, padding: "2px 4px" }}
                  >
                    <option value={7}>7 天前以前</option>
                    <option value={30}>30 天前以前</option>
                    <option value={90}>90 天前以前</option>
                  </select>
                  <button type="button" style={styles.selectBtn} onClick={runCleanupScan}>
                    扫描
                  </button>
                  <button
                    type="button"
                    style={styles.selectBtn}
                    onClick={() => {
                      setCleanupOpen(false)
                      setCleanupSuggestions([])
                    }}
                  >
                    关闭
                  </button>
                </div>
                {cleanupSuggestions.length === 0 ? (
                  <div style={{ fontSize: 11, color: tokens.textMuted }}>
                    点击扫描：空会话 / 极短孤消息 / 过久且内容少 / 同名
                  </div>
                ) : (
                  <>
                    <div style={{ maxHeight: 160, overflowY: "auto" }}>
                      {cleanupSuggestions.map((s) => {
                        const thr = threads.find((t) => t.id === s.thread_id)
                        const title = thr
                          ? displayThreadTitle(thr as Thread)
                          : s.thread_id
                        return (
                          <label
                            key={`${s.thread_id}-${s.reason}`}
                            style={{
                              display: "flex",
                              gap: 6,
                              alignItems: "flex-start",
                              fontSize: 11,
                              padding: "4px 0",
                              borderBottom: "1px solid #f5f5f5",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={cleanupSelected.has(s.thread_id)}
                              onChange={() => {
                                setCleanupSelected((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(s.thread_id)) next.delete(s.thread_id)
                                  else next.add(s.thread_id)
                                  return next
                                })
                              }}
                            />
                            <span>
                              <strong>{title}</strong>
                              <span style={{ color: tokens.textMuted }}>
                                {" "}
                                · {s.reason} · {s.detail}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      style={{ ...styles.dangerBtn, marginTop: 8 }}
                      disabled={cleanupSelected.size === 0}
                      onClick={applyCleanupTrash}
                    >
                      移入回收站（{cleanupSelected.size}）
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  hamburger: {
    width: 32,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(255,255,255,0.85)",
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    fontSize: 15,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
    color: tokens.textSecondary,
    boxShadow: tokens.shadowSm,
    flexShrink: 0,
    fontFamily: tokens.font,
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
    maxHeight: 360,
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
    padding: "8px 10px",
    borderBottom: "1px solid #eee",
    gap: 6,
  },
  viewToggle: {
    display: "flex",
    gap: 2,
    background: tokens.bgMuted,
    borderRadius: 6,
    padding: 2,
  },
  viewBtn: {
    border: "none",
    background: "transparent",
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 4,
    cursor: "pointer",
    color: tokens.textSecondary,
    fontFamily: tokens.font,
  },
  viewBtnActive: {
    border: "none",
    background: "#fff",
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 4,
    cursor: "pointer",
    color: tokens.accentText,
    fontWeight: 600,
    fontFamily: tokens.font,
    boxShadow: tokens.shadowSm,
  },
  searchRow: {
    padding: "6px 10px",
    borderBottom: "1px solid #f0f0f0",
  },
  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    border: `1px solid ${tokens.border}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 12,
    fontFamily: tokens.font,
    outline: "none",
  },
  newBtn: {
    background: tokens.accent,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "3px 10px",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  selectBtn: {
    background: "#fff",
    color: "#666",
    border: "1px solid #ddd",
    borderRadius: 4,
    padding: "3px 8px",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  selectBtnActive: {
    background: tokens.accentSoft,
    color: tokens.accentText,
    border: `1px solid ${tokens.accent}`,
    borderRadius: 4,
    padding: "3px 8px",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  menuBtn: {
    background: "#fff",
    color: "#666",
    border: "1px solid #ddd",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 14,
    cursor: "pointer",
    lineHeight: 1.2,
  },
  menu: {
    position: "absolute",
    right: 0,
    top: "100%",
    marginTop: 4,
    background: "#fff",
    border: "1px solid #e0e0e0",
    borderRadius: 6,
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    zIndex: 60,
    minWidth: 140,
    overflow: "hidden",
  },
  menuItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "none",
    border: "none",
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  list: {
    overflowY: "auto",
    flex: 1,
  },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    background: "#fafafa",
    borderBottom: "1px solid #f0f0f0",
    cursor: "pointer",
    userSelect: "none",
  },
  groupChevron: {
    fontSize: 9,
    color: tokens.textMuted,
    width: 12,
    flexShrink: 0,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: tokens.textSecondary,
  },
  threadItem: {
    padding: "8px 12px",
    borderBottom: "1px solid #f5f5f5",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    userSelect: "text",
    WebkitUserSelect: "text",
  },
  checkbox: {
    flexShrink: 0,
    width: 14,
    height: 14,
    cursor: "pointer",
  },
  iconBtn: {
    background: "none",
    border: "none",
    fontSize: 12,
    cursor: "pointer",
    padding: "2px 4px",
    opacity: 0.5,
    flexShrink: 0,
  },
  threadAliasRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  threadAlias: {
    fontSize: 13,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badge: {
    fontSize: 9,
    fontWeight: 600,
    color: tokens.accentText,
    background: tokens.accentSoft,
    borderRadius: 3,
    padding: "1px 4px",
    flexShrink: 0,
    textTransform: "uppercase" as const,
  },
  badgeMuted: {
    fontSize: 9,
    fontWeight: 500,
    color: tokens.textMuted,
    background: tokens.bgMuted,
    borderRadius: 3,
    padding: "1px 4px",
    flexShrink: 0,
  },
  tagRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 3,
  },
  tagCloud: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    padding: "8px 10px",
    borderBottom: "1px solid #f0f0f0",
  },
  tagPill: {
    border: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    color: tokens.textSecondary,
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  tagPillActive: {
    border: `1px solid ${tokens.accent}`,
    background: tokens.accentSoft,
    color: tokens.accentText,
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
    fontFamily: tokens.font,
    fontWeight: 600,
  },
  preview: {
    fontSize: 11,
    color: tokens.textMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    marginTop: 2,
  },
  threadId: {
    fontSize: 11,
    color: "#999",
    fontFamily: "monospace",
    marginTop: 2,
  },
  relTime: {
    fontSize: 10,
    color: tokens.textMuted,
    marginTop: 2,
  },
  bottomBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    borderTop: "1px solid #eee",
    background: "#fafafa",
    gap: 8,
  },
  dangerBtn: {
    background: tokens.danger,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 11,
    cursor: "pointer",
  },
  cleanupPanel: {
    borderTop: "1px solid #eee",
    padding: "10px",
    background: "#fafafa",
    maxHeight: 260,
    overflowY: "auto",
  },
}
