// Thread list — Timeline IA: today/yesterday + month→day, multi-select, tags view (P1).
// Wave A: untagged batch extract, tldr row, portal menu, tag cloud fold, N/M progress.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { IconChevronDown } from "../ui/icons"
import { popupMenuStyles } from "../ui/popupMenuStyles"
import type { Thread } from "../types"
import {
  batchNeedsForceExtract,
  buildTagIndex,
  collapseTagKeys,
  digestQuotaDayKey,
  acpOutcomeChip,
  countAliases,
  displayThreadEvidence,
  displayThreadTitle,
  EXTRACT_DIGEST_MAX,
  threadAccessibleName,
  filterThreadsByQuery,
  formatThreadIdBadge,
  formatThreadListTime,
  groupThreadsByCalendar,
  isMonthGroupOpen,
  isPinnedGroupOpen,
  LS_DIGEST_QUOTA,
  LS_THREAD_LIST_EXPAND,
  LS_THREAD_LIST_EXPAND_MONTHS_LEGACY,
  parseDigestQuota,
  parseThreadListExpand,
  remainingDigestQuota,
  roleBadge,
  selectLazyDigestCandidates,
  selectUntaggedForExtract,
  selectionState,
  showDigestStaleBadge,
  TAG_CLOUD_MAX_VISIBLE,
  threadIdsInDay,
  threadIdsInMonth,
  toggleGroupSelection,
  type MonthGroup,
  type DayGroup,
  type ThreadListExpandState,
} from "../utils/thread-timeline"
import {
  digestLintStats,
  findRelatedThreads,
} from "../utils/thread-related"
import type { ThreadGraphSlim } from "../../background/thread-graph"

export function createBlankThread(dispatch: (action: { type: "ADD_THREAD"; thread: Thread }) => void) {
  const id = generateShortId()
  const now = new Date().toISOString()
  const thread = {
    id,
    alias: "",
    created_at: now,
    updated_at: now,
    // Inherit live companion config — do not stamp DeepSeek / empty trust.
    config_override: {} as Thread["config_override"],
    tool_whitelist: null as string[] | null,
    pinned_tabs: [] as number[],
    active_skill_ids: [] as string[],
  }
  dispatch({ type: "ADD_THREAD", thread: thread as Thread })
  chrome.runtime.sendMessage({ type: "thread.create", alias: "", id })
  return id
}

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

type ListView = "time" | "tags" | "topics"

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
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [panelBox, setPanelBox] = useState<{ top: number; maxHeight: number } | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [extractingIds, setExtractingIds] = useState<Set<string>>(() => new Set())
  /** A-7 batch progress: done/total while untagged or multi extract runs. */
  const [extractProgress, setExtractProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  /** Fingerprint/extracted_at snapshot at batch start — progress via UPSERT (S5). */
  const extractBatchRef = useRef<{
    /** Monotonic id so a late completed event cannot corrupt a newer batch. */
    batchId: number
    remaining: Set<string>
    total: number
    startMark: Map<string, string>
    /** Charge daily lazy quota only after successful ok[] (Wave B nit). */
    countTowardQuota: boolean
  } | null>(null)
  const extractBatchSeqRef = useRef(0)
  /** Clear N/M bar after complete; cancelled when a new batch starts (Claude N3). */
  const extractProgressClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tagCloudExpanded, setTagCloudExpanded] = useState(false)
  const [trashView, setTrashView] = useState(false)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleanupSuggestions, setCleanupSuggestions] = useState<
    Array<{
      thread_id: string
      reason: string
      detail: string
      confidence: number
      precheck?: boolean
    }>
  >([])
  const [cleanupSelected, setCleanupSelected] = useState<Set<string>>(() => new Set())
  /** 0 = 全部（含近期） */
  const [cleanupDays, setCleanupDays] = useState(0)
  /** Wave C: seed for related list; graph focus */
  const [relatedSeedId, setRelatedSeedId] = useState<string | null>(null)
  /** Companion thread.related override (local mirror first; WS may refine). */
  const [relatedFromServer, setRelatedFromServer] = useState<
    Array<{ thread_id: string; score: number; shared_tags?: string[] }> | null
  >(null)
  /** Brief feedback after click-to-copy thread id badge. */
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyIdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (copyIdTimerRef.current) clearTimeout(copyIdTimerRef.current)
    }
  }, [])

  const { threads, activeThreadId, threadBusyById, config } = state
  /** Graph tab → open session (TG-3): keep graph open, switch active thread here. */
  useEffect(() => {
    const onMsg = (msg: { type?: string; thread_id?: string }) => {
      if (msg?.type !== "thread_graph.thread_selected" || !msg.thread_id) return
      // P1 H-UI-2: same thread → no-op (do not wipe messages)
      if (msg.thread_id === activeThreadId) return
      const thr = threads.find((t) => t.id === msg.thread_id)
      if (thr?.trashed_at) return
      dispatch({ type: "SET_ACTIVE_THREAD", threadId: msg.thread_id })
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [dispatch, threads, activeThreadId])
  /** One-shot lazy extract per panel open when settings enabled (B-2). */
  const lazyDigestRanRef = useRef(false)

  const now = useMemo(() => new Date(), [open, threads.length])

  useEffect(() => {
    const onSug = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const list = Array.isArray(detail?.suggestions) ? detail.suggestions : []
      setCleanupSuggestions(list)
      setCleanupSelected(
        new Set(
          list
            .filter((s: { precheck?: boolean }) => s.precheck === true)
            .map((s: { thread_id: string }) => s.thread_id),
        ),
      )
      setCleanupOpen(true)
    }
    window.addEventListener("cmspark:cleanup_suggestions", onSug as EventListener)
    return () =>
      window.removeEventListener("cmspark:cleanup_suggestions", onSug as EventListener)
  }, [])

  /** Position ⋯ menu for body portal (A-4 / GAP-14); clamp to viewport bottom. */
  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null)
      return
    }
    const MENU_EST_H = 280 // ~7 items
    const update = () => {
      const el = menuBtnRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      let top = r.bottom + 4
      if (top + MENU_EST_H > window.innerHeight - 8) {
        // Flip above the button when near bottom
        top = Math.max(8, r.top - MENU_EST_H - 4)
      }
      setMenuPos({
        top,
        right: Math.max(8, window.innerWidth - r.right),
      })
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [menuOpen])

  const scheduleProgressClear = useCallback(() => {
    if (extractProgressClearTimerRef.current) {
      clearTimeout(extractProgressClearTimerRef.current)
      extractProgressClearTimerRef.current = null
    }
    extractProgressClearTimerRef.current = setTimeout(() => {
      extractProgressClearTimerRef.current = null
      setExtractProgress(null)
    }, 1600)
  }, [])

  /** A-7 / S5: advance progress when thread digests change (digest_updated → UPSERT). */
  useEffect(() => {
    const batch = extractBatchRef.current
    if (!batch || batch.remaining.size === 0) return
    let changed = false
    for (const id of [...batch.remaining]) {
      const t = threads.find((x) => x.id === id) as Thread | undefined
      if (!t) {
        batch.remaining.delete(id)
        changed = true
        continue
      }
      const mark =
        (t.digest?.extracted_at || "") +
        "|" +
        (t.digest?.content_fingerprint || "") +
        "|" +
        (t.digest?.tags || []).join(",")
      const start = batch.startMark.get(id) || ""
      // Only mark done when digest fingerprint actually changed (not mere hasTags).
      if (mark !== start && (t.digest?.extracted_at || t.digest?.tags)) {
        batch.remaining.delete(id)
        changed = true
      }
    }
    if (!changed) return
    setExtractingIds(new Set(batch.remaining))
    const done = batch.total - batch.remaining.size
    setExtractProgress({ done, total: batch.total })
    if (batch.remaining.size === 0) {
      extractBatchRef.current = null
      scheduleProgressClear()
    }
  }, [threads, scheduleProgressClear])

  /** Clear remaining spinners when companion reports batch complete (ok + failed). */
  useEffect(() => {
    const onDone = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        ok?: string[]
        failed?: Array<{ id?: string } | string>
        batch_id?: string
      } | null
      const batch = extractBatchRef.current
      if (!batch) return
      // Ignore completions that belong to a superseded batch (no shared remaining mutation).
      if (
        detail?.batch_id != null &&
        detail.batch_id !== "" &&
        detail.batch_id !== String(batch.batchId)
      ) {
        return
      }
      // If another batch already replaced us, drop this late event.
      if (extractBatchRef.current !== batch) return

      const doneIds = new Set<string>()
      for (const id of detail?.ok || []) if (typeof id === "string") doneIds.add(id)
      for (const f of detail?.failed || []) {
        if (typeof f === "string") doneIds.add(f)
        else if (f && typeof f.id === "string") doneIds.add(f.id)
      }
      // Charge daily quota only for successful ok[] (Wave B nit — not at send time).
      if (batch.countTowardQuota && Array.isArray(detail?.ok) && detail!.ok!.length > 0) {
        const charge = detail!.ok!.filter((id) => typeof id === "string").length
        if (charge > 0) {
          try {
            const day = digestQuotaDayKey(new Date())
            const prev = parseDigestQuota(localStorage.getItem(LS_DIGEST_QUOTA), new Date())
            const count = (prev.day === day ? prev.count : 0) + charge
            localStorage.setItem(LS_DIGEST_QUOTA, JSON.stringify({ day, count }))
          } catch {
            /* ignore quota */
          }
        }
        batch.countTowardQuota = false // once per batch completion
      }
      if (doneIds.size === 0) {
        // Completed without lists — clear whole tracked batch
        batch.remaining.clear()
      } else {
        for (const id of doneIds) batch.remaining.delete(id)
      }
      if (extractBatchRef.current !== batch) return
      setExtractingIds(new Set(batch.remaining))
      setExtractProgress({
        done: batch.total - batch.remaining.size,
        total: batch.total,
      })
      if (batch.remaining.size === 0) {
        if (extractBatchRef.current === batch) extractBatchRef.current = null
        scheduleProgressClear()
      }
    }
    window.addEventListener("cmspark:extract_digest_completed", onDone as EventListener)
    return () =>
      window.removeEventListener(
        "cmspark:extract_digest_completed",
        onDone as EventListener,
      )
  }, [scheduleProgressClear])

  const filtered = useMemo(() => {
    const base = (threads as Thread[]).filter((t) =>
      trashView ? !!t.trashed_at : !t.trashed_at,
    )
    return filterThreadsByQuery(base, query)
  }, [threads, query, trashView])

  const aliasDupCount = useMemo(() => countAliases(filtered as Thread[]), [filtered])

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

  const tagCloudCollapsed = useMemo(
    () => collapseTagKeys(tagKeys, tagCloudExpanded, TAG_CLOUD_MAX_VISIBLE),
    [tagKeys, tagCloudExpanded],
  )

  /** A-1/A-2: untagged batch targets (≤20, skip busy+worker, force empty-tags). Trash: no extract. */
  const untaggedExtract = useMemo(() => {
    if (trashView) return { ids: [] as string[], force: false }
    return selectUntaggedForExtract(filtered as Thread[], {
      max: EXTRACT_DIGEST_MAX,
      busyIds: threadBusyById,
      excludeWorkers: true,
    })
  }, [filtered, threadBusyById, trashView])

  /** Wave C-2: related hits — local instant, optional companion refine. */
  const relatedHitsLocal = useMemo(() => {
    if (!relatedSeedId) return []
    return findRelatedThreads(relatedSeedId, filtered as Thread[], 3)
  }, [relatedSeedId, filtered])

  const relatedHits = useMemo(() => {
    if (!relatedSeedId) return []
    if (relatedFromServer && relatedFromServer.length > 0) {
      return relatedFromServer.slice(0, 3).map((h) => ({
        thread_id: h.thread_id,
        score: h.score,
        signals: { co_tag: 0, tf: 0, time: 0 },
        shared_tags: h.shared_tags || [],
      }))
    }
    return relatedHitsLocal
  }, [relatedSeedId, relatedFromServer, relatedHitsLocal])

  // Request companion related when seed changes (background bridge + local fallback).
  useEffect(() => {
    if (!relatedSeedId) {
      setRelatedFromServer(null)
      return
    }
    setRelatedFromServer(null)
    chrome.runtime.sendMessage({
      type: "thread.related",
      thread_id: relatedSeedId,
      limit: 3,
    })
    const onRel = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        thread_id?: string
        related?: Array<{ thread_id: string; score: number; shared_tags?: string[] }>
      }
      if (d?.thread_id !== relatedSeedId) return
      if (Array.isArray(d.related)) setRelatedFromServer(d.related)
    }
    window.addEventListener("cmspark:thread_related", onRel as EventListener)
    return () => window.removeEventListener("cmspark:thread_related", onRel as EventListener)
  }, [relatedSeedId])

  /** Open Obsidian-style full-page graph (TG-1/TG-4 — replaces side-panel edge list). */
  const openThreadGraph = useCallback(() => {
    const slim: ThreadGraphSlim[] = (threads as Thread[]).map((t) => ({
      id: t.id,
      alias: t.alias,
      updated_at: t.updated_at,
      created_at: t.created_at,
      last_message_at: t.last_message_at ?? null,
      agent_role: t.agent_role,
      trashed_at: t.trashed_at ?? null,
      digest: t.digest
        ? {
            tldr: t.digest.tldr,
            tags: t.digest.tags,
            bullets: t.digest.bullets,
            stale: t.digest.stale,
          }
        : null,
    }))
    chrome.runtime.sendMessage(
      {
        type: "thread_graph.open",
        threads: slim,
        focus_id: relatedSeedId || activeThreadId || null,
      },
      () => {
        void chrome.runtime.lastError
      },
    )
    setMenuOpen(false)
    setOpen(false)
  }, [threads, relatedSeedId, activeThreadId])

  /** Wave C-4: lint stats for cleanup helper. */
  const lintStats = useMemo(
    () => digestLintStats(filtered as Thread[]),
    [filtered],
  )

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

  /** Copy thread id (without #) for search / support; show brief “已复制” only on success. */
  const copyThreadId = useCallback(async (threadId: string) => {
    const text = String(threadId || "").trim()
    if (!text) return
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      try {
        const ta = document.createElement("textarea")
        ta.value = text
        ta.style.position = "fixed"
        ta.style.left = "-9999px"
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand("copy")
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    if (!ok) return
    setCopiedId(threadId)
    if (copyIdTimerRef.current) clearTimeout(copyIdTimerRef.current)
    copyIdTimerRef.current = setTimeout(() => {
      setCopiedId((cur) => (cur === threadId ? null : cur))
      copyIdTimerRef.current = null
    }, 1200)
  }, [])

  const handleNewThread = () => {
    createBlankThread(dispatch)
    setOpen(false)
    exitSelectMode()
  }

  const handleCleanupEmpty = () => {
    const emptyN = threads.filter(
      (t) => t.message_count === 0 && t.id !== activeThreadId && !t.trashed_at,
    ).length
    if (threads.some((t) => typeof t.message_count === "number") && emptyN === 0) {
      alert("没有空白线程")
      setMenuOpen(false)
      return
    }
    const nLabel = emptyN > 0 ? `${emptyN} 个` : "所有"
    if (
      !confirm(
        `将永久删除 ${nLabel}没有任何消息的空白线程。此操作不可恢复，也不经过回收站。`,
      )
    ) {
      return
    }
    chrome.runtime.sendMessage({
      type: "thread.cleanup_empty",
      except_thread_id: activeThreadId,
    })
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

  const beginExtractBatch = useCallback(
    (ids: string[], force: boolean, opts?: { countTowardQuota?: boolean }) => {
      const capped = ids.slice(0, EXTRACT_DIGEST_MAX)
      if (capped.length === 0) return
      // Serialize: refuse starting a second batch while one is in flight (A dual-review nit).
      if (extractBatchRef.current && extractBatchRef.current.remaining.size > 0) {
        // In-flight batch already shows N/M progress bar; ignore overlapping click.
        return
      }
      if (extractProgressClearTimerRef.current) {
        clearTimeout(extractProgressClearTimerRef.current)
        extractProgressClearTimerRef.current = null
      }
      const startMark = new Map<string, string>()
      for (const id of capped) {
        const t = threads.find((x) => x.id === id) as Thread | undefined
        const mark =
          (t?.digest?.extracted_at || "") +
          "|" +
          (t?.digest?.content_fingerprint || "") +
          "|" +
          (t?.digest?.tags || []).join(",")
        startMark.set(id, mark)
      }
      const batchId = ++extractBatchSeqRef.current
      extractBatchRef.current = {
        batchId,
        remaining: new Set(capped),
        total: capped.length,
        startMark,
        // Quota charged on extract_digest.completed ok[] only (not at send).
        countTowardQuota: opts?.countTowardQuota === true,
      }
      setExtractingIds(new Set(capped))
      setExtractProgress({ done: 0, total: capped.length })
      chrome.runtime.sendMessage({
        type: "thread.extract_digest",
        thread_ids: capped,
        force: force === true,
        batch_id: String(batchId),
      })
      // No fixed 60s full clear (S5/GAP-15) — progress from digest UPSERT / completed.
    },
    [threads],
  )

  // Wave B-2: when list opens and settings enable lazy digest, fill coverage once.
  useEffect(() => {
    if (!open) {
      lazyDigestRanRef.current = false
      return
    }
    if (lazyDigestRanRef.current || trashView) return
    if (config?.thread_digest_enabled !== true) return
    if (extractBatchRef.current) return
    const maxPerDay = config.thread_digest_max_per_day ?? 20
    const idleH = config.thread_digest_on_idle_hours ?? 24
    let quota = { day: digestQuotaDayKey(now), count: 0 }
    try {
      quota = parseDigestQuota(localStorage.getItem(LS_DIGEST_QUOTA), now)
    } catch {
      /* ignore */
    }
    const remain = remainingDigestQuota(quota, maxPerDay)
    if (remain <= 0) return
    const live = (threads as Thread[]).filter((t) => !t.trashed_at)
    const sel = selectLazyDigestCandidates(live, {
      now,
      onIdleHours: idleH,
      max: Math.min(EXTRACT_DIGEST_MAX, remain),
      busyIds: threadBusyById,
      excludeWorkers: true,
    })
    if (sel.ids.length === 0) return
    lazyDigestRanRef.current = true
    beginExtractBatch(sel.ids, sel.force, { countTowardQuota: true })
  }, [
    open,
    trashView,
    config?.thread_digest_enabled,
    config?.thread_digest_max_per_day,
    config?.thread_digest_on_idle_hours,
    threads,
    threadBusyById,
    now,
    beginExtractBatch,
  ])

  const handleExtractDigest = (ids: string[]) => {
    if (ids.length === 0) return
    const capped = ids.slice(0, EXTRACT_DIGEST_MAX)
    const force = batchNeedsForceExtract(filtered as Thread[], capped)
    beginExtractBatch(capped, force)
  }

  /** A-1 menu / A-2 CTA: extract untagged (uses selection.force — S1). */
  const handleExtractUntagged = () => {
    if (untaggedExtract.ids.length === 0) return
    beginExtractBatch(untaggedExtract.ids, untaggedExtract.force)
    setMenuOpen(false)
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
    const payload: Record<string, unknown> = {
      type: "thread.suggest_cleanup",
      include_workers: false,
      except_thread_id: activeThreadId || undefined,
    }
    if (cleanupDays > 0) {
      const to = new Date()
      const from = new Date(to.getTime() - cleanupDays * 86400_000)
      payload.to = from.toISOString()
    }
    chrome.runtime.sendMessage(payload)
    setMenuOpen(false)
  }

  const applyCleanupTrash = () => {
    const ids = [...cleanupSelected].slice(0, 50)
    if (ids.length === 0) return
    const picked = cleanupSuggestions.filter((s) => ids.includes(s.thread_id))
    const hasHusk = picked.some((s) => s.reason === "acp_husk")
    const lines = picked.slice(0, 12).map((s) => {
      const thr = threads.find((t) => t.id === s.thread_id)
      const n = thr?.message_count
      return `#${s.thread_id}${typeof n === "number" ? ` · ${n} 条消息` : ""}`
    })
    const more = picked.length > 12 ? `\n…另 ${picked.length - 12} 个` : ""
    const warn = hasHusk ? "\n含编程接力记录，请再核对。" : ""
    if (
      !confirm(
        `将把 ${ids.length} 个会话移入回收站（可在 ⋯ → 回收站 恢复，约 30 天后自动清除）。${warn}\n\n${lines.join("\n")}${more}`,
      )
    ) {
      return
    }
    chrome.runtime.sendMessage({ type: "thread.batch_delete", thread_ids: ids, mode: "trash" })
    dispatch({ type: "REMOVE_THREADS", threadIds: ids })
    setCleanupOpen(false)
    setCleanupSuggestions([])
  }

  /** B-4: extract digests for cleanup-selected threads only (no delete). */
  const applyCleanupExtractOnly = () => {
    const ids = [...cleanupSelected].slice(0, EXTRACT_DIGEST_MAX)
    if (ids.length === 0) return
    const force = batchNeedsForceExtract(filtered as Thread[], ids)
    beginExtractBatch(ids, force)
  }

  const panelMaxHeight = selectMode || view === "tags" || view === "topics" ? 480 : 360

  useEffect(() => {
    if (!open) {
      setPanelBox(null)
      return
    }
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect()
      const top = Math.round((r?.bottom ?? 48) + 6)
      setPanelBox({
        top,
        maxHeight: Math.max(180, window.innerHeight - top - 12),
      })
    }
    place()
    window.addEventListener("resize", place)
    return () => window.removeEventListener("resize", place)
  }, [open, selectMode, view])

  const renderThreadRow = (t: Thread) => {
    const busy = !!threadBusyById[t.id]
    const isActive = t.id === activeThreadId
    const badge = roleBadge(t.agent_role)
    const title = displayThreadTitle(t)
    const accessibleName = threadAccessibleName(t)
    const idBadge = formatThreadIdBadge(t.id)
    const rel = formatThreadListTime(t, now, aliasDupCount)
    const tags = t.digest?.tags || []
    const extracting = extractingIds.has(t.id)
    const evidence = displayThreadEvidence(t)
    const chip = acpOutcomeChip(t)
    const justCopied = copiedId === t.id

    return (
      <div
        key={t.id}
        style={{
          ...styles.threadItem,
          background: isActive ? tokens.accentSoft : "transparent",
          opacity: selectMode && busy ? 0.45 : 1,
        }}
        aria-label={accessibleName}
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
            aria-label={`选择 ${accessibleName}`}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.threadAliasRow}>
            <span style={styles.threadAlias}>{title}</span>
            {chip ? <span style={styles.badge}>{chip}</span> : null}
            {idBadge ? (
              <button
                type="button"
                style={{
                  ...styles.threadIdBadge,
                  color: justCopied ? tokens.accentText : tokens.textMuted,
                }}
                title={`复制编号 ${idBadge}（可在搜索框粘贴定位）`}
                aria-label={`复制会话编号 ${idBadge}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void copyThreadId(t.id)
                }}
              >
                {justCopied ? "已复制" : idBadge}
              </button>
            ) : null}
            {badge && <span style={styles.badge}>{badge}</span>}
            {extracting && <span style={styles.badgeMuted}>抽取中</span>}
            {showDigestStaleBadge(t, view, now) && (
              <span style={styles.badgeMuted} title="要点可能过期">
                过期
              </span>
            )}
          </div>
          {evidence && (
            <div style={styles.tldr} title={evidence}>
              {evidence}
            </div>
          )}
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
          {rel && <div style={styles.relTime}>{rel}</div>}
          {t.topic_folder ? (
            <div style={styles.relTime} title="话题夹">
              夹 · {t.topic_folder}
            </div>
          ) : null}
        </div>
        {!selectMode && (
          <>
            <button
              style={styles.iconBtn}
              onClick={(e) => {
                e.stopPropagation()
                setRelatedSeedId((prev) => (prev === t.id ? null : t.id))
              }}
              title="列表内相关"
            >
              🔗
            </button>
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
                setOpen(false)
                chrome.runtime.sendMessage({ type: "thread.distill_preview", thread_id: t.id })
              }}
              title="提炼为知识（需确认）"
            >
              知识
            </button>
            <button
              style={styles.iconBtn}
              onClick={(e) => {
                e.stopPropagation()
                const name = window.prompt("话题夹名称（空则移出）", t.topic_folder || "")
                if (name === null) return
                const folder = name
                  .normalize("NFC")
                  .replace(/[\x00-\x1F\x7F\\/]/g, "")
                  .trim()
                  .slice(0, 40) || null
                chrome.runtime.sendMessage({
                  type: "thread.update",
                  thread_id: t.id,
                  updates: { topic_folder: folder },
                })
                dispatch({
                  type: "UPSERT_THREAD",
                  thread: { ...t, topic_folder: folder },
                })
              }}
              title="移入话题夹"
            >
              夹
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
                  // Wave D/E: honor Settings exportIncludeReasoning (P0-2)
                  include_reasoning: state.exportIncludeReasoning === true,
                })
              }}
              disabled={state.summarizingThreadId === t.id}
              title="导出此线程摘要为 Markdown"
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
    // Search: force-open days that still have matches (parity with month groups).
    const openDay =
      expandedDays.has(day.dayKey) || (searchActive && day.threads.length > 0)
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
          <div style={{ color: tokens.textSecondary, fontSize: 12, padding: 12, textAlign: "center" }}>
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
    const extractDisabled = untaggedExtract.ids.length === 0
    const extractLabel = `为未标注提取要点（最多${EXTRACT_DIGEST_MAX}）`
    // Primary CTA only when extractable targets exist (no dead disabled empty-library CTA).
    const showPrimaryCta = untaggedExtract.ids.length > 0

    return (
      <div>
        {/* A-5: count-fold only; 更多/收起 OUTSIDE pills so they are never clipped (Pi blocking). */}
        <div style={styles.tagCloudSection}>
          <div style={styles.tagCloud}>
            {tagKeys.length === 0 && untagged.length === 0 && (
              <div style={{ color: tokens.textSecondary, fontSize: 12, padding: 8 }}>
                暂无标签。使用下方按钮为会话提取要点与标签。
              </div>
            )}
            {tagCloudCollapsed.visible.map((tag) => {
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
          {tagCloudCollapsed.hiddenCount > 0 && !tagCloudExpanded && (
            <div style={styles.tagCloudFoldRow}>
              <button
                type="button"
                style={styles.tagPill}
                onClick={() => setTagCloudExpanded(true)}
                title={`还有 ${tagCloudCollapsed.hiddenCount} 个标签`}
              >
                更多 · {tagCloudCollapsed.hiddenCount}
              </button>
            </div>
          )}
          {tagCloudExpanded && tagKeys.length > TAG_CLOUD_MAX_VISIBLE && (
            <div style={styles.tagCloudFoldRow}>
              <button
                type="button"
                style={styles.tagPill}
                onClick={() => setTagCloudExpanded(false)}
              >
                收起
              </button>
            </div>
          )}
        </div>

        {showPrimaryCta && untaggedExtract.ids.length > 0 && (
          <div style={styles.untaggedCtaRow}>
            <button
              type="button"
              style={{
                ...styles.primaryCta,
                opacity: extractDisabled ? 0.45 : 1,
                cursor: extractDisabled ? "not-allowed" : "pointer",
              }}
              disabled={extractDisabled}
              onClick={handleExtractUntagged}
              title={
                extractDisabled
                  ? "没有可提取的未标注会话（已跳过运行中与 worker）"
                  : `将提取最多 ${untaggedExtract.ids.length} 个未标注会话`
              }
            >
              🏷 {extractLabel}
            </button>
            {!extractDisabled && (
              <span style={styles.ctaHint}>
                本批 {untaggedExtract.ids.length} 个
                {untagged.length > untaggedExtract.ids.length
                  ? `（共 ${untagged.length} 未标注）`
                  : ""}
              </span>
            )}
          </div>
        )}

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

  const renderTopicsView = () => {
    const groups = new Map<string, Thread[]>()
    for (const t of filtered as Thread[]) {
      const key = t.topic_folder || "未分组"
      const arr = groups.get(key) || []
      arr.push(t)
      groups.set(key, arr)
    }
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === "未分组") return 1
      if (b === "未分组") return -1
      return a.localeCompare(b, "zh")
    })
    return (
      <>
        {keys.map((key) => (
          <div key={key}>
            <div style={styles.groupHeader}>
              <span style={styles.groupLabel}>
                {key} · {groups.get(key)!.length}
              </span>
            </div>
            {groups.get(key)!.map((t) => renderThreadRow(t))}
          </div>
        ))}
        {keys.length === 1 && keys[0] === "未分组" && filtered.length > 0 && (
          <div style={{ color: tokens.textMuted, fontSize: 11, padding: "8px 12px" }}>
            点行上的「夹」把会话放进话题夹
          </div>
        )}
        {filtered.length === 0 && (
          <div style={{ color: tokens.textSecondary, fontSize: 12, padding: 12, textAlign: "center" }}>
            无匹配线程
          </div>
        )}
      </>
    )
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        style={{
          ...styles.hamburger,
          ...(open ? { color: tokens.text } : null),
        }}
        onClick={() => setOpen(!open)}
        title="历史对话"
        aria-label="历史对话"
        aria-expanded={open}
      >
        <IconChevronDown size={18} />
      </button>

      {open &&
        panelBox &&
        typeof document !== "undefined" &&
        createPortal(
        <>
          <div
            style={styles.backdrop}
            onClick={() => {
              setOpen(false)
              setMenuOpen(false)
              if (selectMode) exitSelectMode()
            }}
          />
          <div
            style={{
              ...styles.panel,
              position: "fixed",
              top: panelBox.top,
              left: 8,
              right: 8,
              width: "auto",
              maxHeight: Math.min(panelMaxHeight, panelBox.maxHeight),
              zIndex: 10050,
            }}
          >
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
                <button
                  type="button"
                  style={view === "topics" ? styles.viewBtnActive : styles.viewBtn}
                  onClick={() => setView("topics")}
                >
                  话题
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
                    ref={menuBtnRef}
                    type="button"
                    style={styles.menuBtn}
                    onClick={() => setMenuOpen((v) => !v)}
                    title="更多"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                  >
                    ⋯
                  </button>
                  {menuOpen &&
                    menuPos &&
                    typeof document !== "undefined" &&
                    createPortal(
                      <div
                        style={{
                          ...styles.menuPortal,
                          top: menuPos.top,
                          right: menuPos.right,
                        }}
                        role="menu"
                      >
                        <button
                          type="button"
                          style={styles.menuItem}
                          onClick={handleGenerateTitle}
                        >
                          ✨ AI 生成标题
                        </button>
                        <button
                          type="button"
                          style={styles.menuItem}
                          onClick={() => handleBatchAutoTitle()}
                        >
                          📝 未命名→首条起名
                        </button>
                        <button
                          type="button"
                          style={styles.menuItem}
                          onClick={handleCleanupEmpty}
                        >
                          🧹 清理空白
                        </button>
                        <button
                          type="button"
                          style={styles.menuItem}
                          onClick={() => {
                            setCleanupOpen(true)
                            setMenuOpen(false)
                            runCleanupScan()
                          }}
                        >
                          🗂 整理助手
                        </button>
                        <button
                          type="button"
                          style={{
                            ...styles.menuItem,
                            opacity: untaggedExtract.ids.length === 0 ? 0.45 : 1,
                            cursor:
                              untaggedExtract.ids.length === 0
                                ? "not-allowed"
                                : "pointer",
                          }}
                          disabled={untaggedExtract.ids.length === 0}
                          onClick={handleExtractUntagged}
                          title={
                            untaggedExtract.ids.length === 0
                              ? "没有可提取的未标注会话"
                              : `为最多 ${untaggedExtract.ids.length} 个未标注会话提取要点`
                          }
                        >
                          🏷 为未标注提取要点
                        </button>
                        <button
                          type="button"
                          style={styles.menuItem}
                          onClick={openThreadGraph}
                          title="在新标签页打开会话关系图"
                        >
                          会话关系图
                        </button>
                        <button
                          type="button"
                          style={styles.menuItem}
                          onClick={() =>
                            trashView ? closeTrashView() : openTrashView()
                          }
                        >
                          {trashView ? "← 返回列表" : "🗑 回收站"}
                        </button>
                      </div>,
                      document.body,
                    )}
                </div>
              </div>
            </div>

            {extractProgress && extractProgress.total > 0 && (
              <div style={styles.progressBar} role="status" aria-live="polite">
                提取要点 {extractProgress.done}/{extractProgress.total}
                {extractProgress.done >= extractProgress.total ? " · 完成" : "…"}
              </div>
            )}

            {relatedSeedId && (
              <div style={styles.relatedPanel}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textSecondary }}>
                    相关 · {displayThreadTitle(
                      (threads.find((x) => x.id === relatedSeedId) as Thread) || {
                        id: relatedSeedId,
                      },
                    )}
                  </span>
                  <button
                    type="button"
                    style={styles.selectBtn}
                    onClick={() => setRelatedSeedId(null)}
                  >
                    关闭
                  </button>
                </div>
                {relatedHits.length === 0 ? (
                  <div style={{ fontSize: 11, color: tokens.textSecondary }}>
                    暂无相关会话（需更多标签/要点）
                  </div>
                ) : (
                  relatedHits.map((h) => {
                    const thr = threads.find((x) => x.id === h.thread_id) as Thread | undefined
                    const title = thr ? displayThreadTitle(thr) : h.thread_id
                    return (
                      <button
                        key={h.thread_id}
                        type="button"
                        style={styles.relatedItem}
                        onClick={() => handleSelect(h.thread_id)}
                        title={
                          h.shared_tags.length
                            ? `共标签: ${h.shared_tags.join(", ")}`
                            : `score ${h.score.toFixed(2)}`
                        }
                      >
                        {title}
                        {h.shared_tags.length > 0 && (
                          <span style={{ color: tokens.textMuted, marginLeft: 4 }}>
                            #{h.shared_tags.slice(0, 2).join(" #")}
                          </span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            )}

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
                placeholder="搜索标题 / 编号 / 消息 / 要点 / 标签…"
                style={styles.searchInput}
                aria-label="搜索线程"
              />
            </div>

            <div style={styles.list}>
              {view === "time" ? renderTimeline() : view === "tags" ? renderTagsView() : renderTopicsView()}
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
                    <option value={0}>全部（含近期）</option>
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
                <div
                  style={{
                    fontSize: 10,
                    color: tokens.textMuted,
                    marginBottom: 6,
                  }}
                >
                  索引健康：未标注 {lintStats.untagged} · 过期 {lintStats.stale} · 孤立{" "}
                  {lintStats.isolated}
                </div>
                {cleanupSuggestions.length === 0 ? (
                  <div style={{ fontSize: 11, color: tokens.textMuted }}>
                    空会话 / 无用户消息 / 极短孤消息 / 过久且少 / 同名薄会话（不含簇主）
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
                              borderBottom: `1px solid ${tokens.border}`,
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
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginTop: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        style={styles.selectBtn}
                        disabled={cleanupSelected.size === 0}
                        onClick={applyCleanupExtractOnly}
                        title="仅提取要点/标签，不删除"
                      >
                        仅提取要点（{Math.min(cleanupSelected.size, EXTRACT_DIGEST_MAX)}）
                      </button>
                      <button
                        type="button"
                        style={styles.selectBtn}
                        onClick={() => setCleanupSelected(new Set())}
                      >
                        全不选
                      </button>
                      <button
                        type="button"
                        style={styles.dangerBtn}
                        disabled={cleanupSelected.size === 0}
                        onClick={applyCleanupTrash}
                      >
                        移入回收站（{cleanupSelected.size}）
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

        </>,
        document.body,
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
    background: "transparent",
    border: "none",
    borderRadius: tokens.radiusMd,
    cursor: "pointer",
    padding: 0,
    color: tokens.text,
    flexShrink: 0,
    fontFamily: tokens.font,
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 10040,
  },
  panel: {
    position: "fixed",
    left: 8,
    right: 8,
    width: "auto",
    maxHeight: 360,
    background: tokens.bgElevated,
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: tokens.radiusMd,
    boxShadow: tokens.shadowMd,
    zIndex: 10050,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    borderBottom: `1px solid ${tokens.border}`,
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
    background: tokens.bgElevated,
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
    borderBottom: `1px solid ${tokens.border}`,
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
    color: tokens.userBubbleText,
    border: "none",
    borderRadius: 4,
    padding: "3px 10px",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  selectBtn: {
    background: tokens.bgElevated,
    color: tokens.textSecondary,
    border: `1px solid ${tokens.borderStrong}`,
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
  // Phase 2b: same density as StatusRail ⋯ (popupMenuStyles)
  menuBtn: popupMenuStyles.menuTrigger,
  /** A-4 portal menu — fixed to body, above panel(51) / backdrop(50). */
  menuPortal: {
    ...popupMenuStyles.menu,
    position: "fixed" as const,
    zIndex: 10060,
  },
  menuItem: popupMenuStyles.menuItem,
  progressBar: {
    padding: "5px 10px",
    fontSize: 11,
    color: tokens.accentText,
    background: tokens.accentSoft,
    borderBottom: `1px solid ${tokens.border}`,
    fontFamily: tokens.font,
  },
  relatedPanel: {
    padding: "6px 10px",
    borderBottom: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
  },
  relatedItem: {
    display: "block",
    width: "100%",
    textAlign: "left" as const,
    background: "none",
    border: "none",
    padding: "4px 0",
    fontSize: 11,
    cursor: "pointer",
    fontFamily: tokens.font,
    color: tokens.accentText,
  },
  tagCloudSection: {
    borderBottom: `1px solid ${tokens.border}`,
  },
  tagCloudFoldRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
    padding: "0 10px 8px",
  },
  untaggedCtaRow: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    padding: "8px 10px",
    borderBottom: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
  },
  primaryCta: {
    background: tokens.accent,
    color: tokens.userBubbleText,
    border: "none",
    borderRadius: tokens.radiusSm,
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: tokens.font,
    textAlign: "center" as const,
  },
  ctaHint: {
    fontSize: 10,
    color: tokens.textMuted,
    fontFamily: tokens.font,
  },
  tldr: {
    fontSize: 11,
    color: tokens.textSecondary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    marginTop: 2,
    lineHeight: 1.35,
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
    background: tokens.bgMuted,
    borderBottom: `1px solid ${tokens.border}`,
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
    borderBottom: `1px solid ${tokens.border}`,
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
  /** Always-visible short id; click copies bare id for search. */
  threadIdBadge: {
    flexShrink: 0,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    padding: "1px 5px",
    margin: 0,
    fontSize: 10,
    fontWeight: 600,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: tokens.textSecondary,
    cursor: "pointer",
    lineHeight: 1.2,
    maxWidth: 88,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    borderRadius: tokens.radiusPill,
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
    // border lives on tagCloudSection so fold row stays outside any clip
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
    borderTop: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    gap: 8,
  },
  dangerBtn: {
    background: tokens.danger,
    color: tokens.userBubbleText,
    border: "none",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 11,
    cursor: "pointer",
  },
  cleanupPanel: {
    borderTop: `1px solid ${tokens.border}`,
    padding: "10px",
    background: tokens.bgMuted,
    maxHeight: 260,
    overflowY: "auto",
  },
}
