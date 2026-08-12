// Full-page Obsidian-like thread graph.
// Spec: docs/superpowers/specs/2026-08-11-thread-graph-obsidian-view-design.md
// v1.1+: tag colors · hover labels · floating chrome · nit closeout

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react"
import {
  buildRelatedEdges,
  type RelatedEdge,
  type RelatedThreadInput,
} from "../sidepanel/utils/thread-related"
import {
  forceLayoutTick,
  seedLayoutNodes,
  type LayoutNode,
} from "./force-layout"
import {
  isSnapshotFresh,
  THREAD_GRAPH_SNAPSHOT_KEY,
  type ThreadGraphSnapshot,
  type ThreadGraphSlim,
} from "../background/thread-graph"
import { tokens } from "../sidepanel/ui/tokens"
import {
  buildTagColorIndex,
  colorForTag,
  hexWithAlpha,
  lightenHex,
  UNTAGGED_COLOR,
} from "./tag-colors"
import { buildLayoutSignature } from "./layout-signature"

/** Obsidian-adjacent local palette (graph canvas). */
const G = {
  canvas: "#0d0f14",
  edgeHard: "rgba(148, 163, 184, 0.42)",
  edgeSoft: "rgba(148, 163, 184, 0.18)",
  edgeDim: "rgba(148, 163, 184, 0.06)",
  edgeHot: "rgba(165, 180, 252, 0.75)",
  label: "rgba(226, 232, 240, 0.7)",
  labelFocus: "rgba(248, 250, 252, 0.95)",
} as const

/** Labels only when hovering, focused, or zoomed past this scale. */
const LABEL_ZOOM_THRESHOLD = 1.15
const HIT_PAD = 8
const PANEL_KEY = "cmspark_thread_graph_panel_open"
const EXTRACT_MAX = 20

function displayTitle(t: ThreadGraphSlim): string {
  const a = (t.alias || "").trim()
  if (a) return a.length > 22 ? a.slice(0, 21) + "…" : a
  return `未命名 · ${(t.id || "").slice(0, 6)}`
}

function radiusForDegree(deg: number): number {
  return Math.min(7.5, Math.max(2.8, 2.8 + Math.sqrt(deg) * 1.35))
}

function isUntaggedSlim(t: ThreadGraphSlim): boolean {
  const tags = t.digest?.tags
  return !tags || tags.length === 0
}

export function ThreadGraphApp() {
  const [snap, setSnap] = useState<ThreadGraphSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [minScore, setMinScore] = useState(0.2)
  const [showIsolated, setShowIsolated] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [barHeight, setBarHeight] = useState(48)
  const [showAllGroups, setShowAllGroups] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== "0"
    } catch {
      return true
    }
  })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const nodesRef = useRef<LayoutNode[]>([])
  const edgesRef = useRef<RelatedEdge[]>([])
  const dragRef = useRef<{ id: string; ox: number; oy: number; moved: boolean } | null>(null)
  const panRef = useRef({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const rafRef = useRef(0)
  const sizeRef = useRef({ w: 800, h: 600 })
  const simTicksRef = useRef(0)
  const hoverIdRef = useRef<string | null>(null)
  const focusIdRef = useRef<string | null>(null)
  const fittedRef = useRef(false)
  /** True after user pan/zoom — resize won't steal camera. */
  const userCameraRef = useRef(false)
  const layoutSigRef = useRef("")
  const colorByIdRef = useRef<Map<string, string>>(new Map())
  const threadsByIdRef = useRef<Map<string, ThreadGraphSlim>>(new Map())
  const isolatedIdsRef = useRef<Set<string>>(new Set())
  const fitViewRef = useRef<() => void>(() => {})
  const orderedIdsRef = useRef<string[]>([])

  useEffect(() => {
    focusIdRef.current = focusId
  }, [focusId])

  const persistPanelPref = useCallback((open: boolean) => {
    setPanelOpen(open)
    try {
      localStorage.setItem(PANEL_KEY, open ? "1" : "0")
    } catch {
      /* ignore */
    }
  }, [])

  const focusFromUrl = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("focus")
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await chrome.storage.session.get(THREAD_GRAPH_SNAPSHOT_KEY)
        const s = res[THREAD_GRAPH_SNAPSHOT_KEY] as ThreadGraphSnapshot | undefined
        if (cancelled) return
        if (!s || !Array.isArray(s.threads)) {
          setLoadError("请从 Side Panel ☰ → 关联图谱 打开（需先准备会话数据）。")
          setSnap(null)
          return
        }
        setSnap(s)
        const fid = s.focus_id || focusFromUrl
        setFocusId(fid)
        if (fid) setPanelOpen(true) // deep-link: show focus panel (transient)
        if (!isSnapshotFresh(s)) {
          setStatus("快照可能已过期（>5 分钟）。可在侧栏重新打开图谱以刷新。")
        }
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [focusFromUrl])

  // Measure floating toolbar height → panel/banner top offset
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const measure = () => {
      const h = el.getBoundingClientRect().height
      setBarHeight(Math.max(40, Math.ceil(h)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loadError])

  const threads = snap?.threads || []

  const { nodesInput, edges, isolatedIds } = useMemo(() => {
    const inputs: RelatedThreadInput[] = threads.map((t) => ({
      id: t.id,
      alias: t.alias,
      updated_at: t.updated_at,
      created_at: t.created_at,
      agent_role: t.agent_role,
      trashed_at: t.trashed_at,
      digest: t.digest,
    }))
    const allEdges = buildRelatedEdges(inputs, { minScore, maxEdges: 200 })
    const degree = new Map<string, number>()
    for (const t of inputs) degree.set(t.id, 0)
    for (const e of allEdges) {
      degree.set(e.a, (degree.get(e.a) || 0) + 1)
      degree.set(e.b, (degree.get(e.b) || 0) + 1)
    }
    const isolated = new Set<string>()
    for (const t of inputs) {
      if ((degree.get(t.id) || 0) === 0) isolated.add(t.id)
    }
    let nodeIds = inputs.map((t) => t.id)
    if (!showIsolated) {
      nodeIds = nodeIds.filter((id) => !isolated.has(id) || id === focusId)
      const keep = new Set<string>()
      for (const e of allEdges) {
        keep.add(e.a)
        keep.add(e.b)
      }
      if (focusId) keep.add(focusId)
      nodeIds = nodeIds.filter((id) => keep.has(id))
    }
    const q = query.trim().toLowerCase()
    if (q) {
      nodeIds = nodeIds.filter((id) => {
        const t = threads.find((x) => x.id === id)
        if (!t) return false
        const title = displayTitle(t).toLowerCase()
        const tags = (t.digest?.tags || []).join(" ").toLowerCase()
        return title.includes(q) || tags.includes(q) || id.toLowerCase().includes(q)
      })
    }
    const nodeSet = new Set(nodeIds)
    const edgesF = allEdges.filter((e) => nodeSet.has(e.a) && nodeSet.has(e.b))
    return {
      nodesInput: nodeIds.map((id) => ({
        id,
        degree: degree.get(id) || 0,
        title: displayTitle(threads.find((t) => t.id === id) || { id }),
      })),
      edges: edgesF,
      isolatedIds: isolated,
    }
  }, [threads, minScore, showIsolated, query, focusId])

  const tagColors = useMemo(() => {
    const ids = nodesInput.map((n) => n.id)
    return buildTagColorIndex(threads, ids)
  }, [threads, nodesInput])

  const layoutSignature = useMemo(
    () => buildLayoutSignature(nodesInput, edges),
    [nodesInput, edges],
  )

  orderedIdsRef.current = nodesInput.map((n) => n.id)

  useEffect(() => {
    colorByIdRef.current = tagColors.colorById
    threadsByIdRef.current = new Map(threads.map((t) => [t.id, t]))
    isolatedIdsRef.current = isolatedIds
  }, [tagColors.colorById, threads, isolatedIds])

  useEffect(() => {
    const { w, h } = sizeRef.current
    const rMap = new Map(nodesInput.map((n) => [n.id, radiusForDegree(n.degree)]))
    edgesRef.current = edges

    const sig = layoutSignature
    if (sig === layoutSigRef.current && nodesRef.current.length > 0) {
      for (const n of nodesRef.current) {
        const r = rMap.get(n.id)
        if (r != null) n.r = r
      }
      return
    }
    layoutSigRef.current = sig

    const prev = new Map(nodesRef.current.map((n) => [n.id, n]))
    const ids = nodesInput.map((n) => n.id)
    const seeded = seedLayoutNodes(ids, w, h, rMap)
    for (const n of seeded) {
      const p = prev.get(n.id)
      if (p) {
        n.x = p.x
        n.y = p.y
        n.vx = 0
        n.vy = 0
        n.pinned = p.pinned
      }
    }
    nodesRef.current = seeded
    simTicksRef.current = 0
    fittedRef.current = false
    userCameraRef.current = false
  }, [layoutSignature, nodesInput, edges])

  const focusThread = useMemo(
    () => (focusId ? threads.find((t) => t.id === focusId) || null : null),
    [focusId, threads],
  )

  const liveRegionText = focusThread
    ? `焦点：${displayTitle(focusThread)}`
    : hoverIdRef.current
      ? ""
      : "未选中节点。方向键切换，Enter 打开，Esc 取消。"

  const openThread = useCallback((threadId: string) => {
    setFocusId(threadId)
    setPanelOpen(true)
    chrome.runtime.sendMessage(
      { type: "thread_graph.open_thread", thread_id: threadId },
      () => {
        void chrome.runtime.lastError
      },
    )
    setStatus("已请求打开会话（图谱保持打开）")
  }, [])

  const requestExtractUntagged = useCallback(() => {
    const ids = threads.filter(isUntaggedSlim).map((t) => t.id).slice(0, EXTRACT_MAX)
    if (ids.length === 0) {
      setStatus("没有可提取的未标注会话（或均已有标签）")
      return
    }
    chrome.runtime.sendMessage(
      { type: "thread.extract_digest", thread_ids: ids, force: true },
      (res: any) => {
        void chrome.runtime.lastError
        if (res?.ok === false) {
          setStatus(res?.error || "提取请求失败")
          return
        }
        setStatus(
          `已请求为 ${ids.length} 个未标注会话提取要点。完成后请从侧栏重新打开图谱刷新。`,
        )
      },
    )
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const winId = tabs[0]?.windowId
        if (winId != null && chrome.sidePanel?.open) {
          chrome.sidePanel.open({ windowId: winId }).catch(() => {})
        }
      })
    } catch {
      /* ignore */
    }
  }, [threads])

  const fitView = useCallback(() => {
    const nodes = nodesRef.current
    if (nodes.length === 0) return
    const { w, h } = sizeRef.current
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.r)
      minY = Math.min(minY, n.y - n.r)
      maxX = Math.max(maxX, n.x + n.r)
      maxY = Math.max(maxY, n.y + n.r)
    }
    const gw = Math.max(40, maxX - minX)
    const gh = Math.max(40, maxY - minY)
    const pad = 56
    const s = Math.min((w - pad * 2) / gw, (h - pad * 2) / gh, 1.35)
    scaleRef.current = Math.max(0.45, Math.min(1.8, s * 0.92))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    panRef.current.x = w / 2 - cx * scaleRef.current
    panRef.current.y = h / 2 - cy * scaleRef.current
    fittedRef.current = true
  }, [])

  fitViewRef.current = fitView

  // Resize + draw loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const resize = () => {
      const rect = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const prevW = sizeRef.current.w
      const prevH = sizeRef.current.h
      sizeRef.current = { w: rect.width, h: rect.height }
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Re-fit when window changes if user hasn't manually adjusted camera
      if (
        fittedRef.current &&
        !userCameraRef.current &&
        nodesRef.current.length > 0 &&
        (Math.abs(prevW - rect.width) > 8 || Math.abs(prevH - rect.height) > 8)
      ) {
        fitViewRef.current()
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(parent)

    const draw = () => {
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const { w, h } = sizeRef.current
      if (simTicksRef.current < 320 && nodesRef.current.length > 0) {
        const e = forceLayoutTick(nodesRef.current, edgesRef.current, {
          width: w,
          height: h,
        })
        simTicksRef.current++
        const settled = e < 0.06 && simTicksRef.current > 50
        const exhausted = simTicksRef.current >= 320
        if (settled || exhausted) {
          simTicksRef.current = 999
          if (!fittedRef.current) fitViewRef.current()
        }
      }

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = G.canvas
      ctx.fillRect(0, 0, w, h)

      ctx.save()
      ctx.translate(panRef.current.x, panRef.current.y)
      ctx.scale(scaleRef.current, scaleRef.current)

      const byId = new Map(nodesRef.current.map((n) => [n.id, n]))
      const active = hoverIdRef.current || focusIdRef.current
      let hot: Set<string> | null = null
      if (active) {
        hot = new Set([active])
        for (const e of edgesRef.current) {
          if (e.a === active) hot.add(e.b)
          if (e.b === active) hot.add(e.a)
        }
      }
      const scale = scaleRef.current
      const colors = colorByIdRef.current

      for (const e of edgesRef.current) {
        const a = byId.get(e.a)
        const b = byId.get(e.b)
        if (!a || !b) continue
        const hard = e.kind === "hard"
        const isHot = hot ? hot.has(e.a) && hot.has(e.b) : false
        const isDim = hot != null && !isHot
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        if (isDim) {
          ctx.strokeStyle = G.edgeDim
          ctx.globalAlpha = 1
        } else if (isHot) {
          ctx.strokeStyle = G.edgeHot
          ctx.globalAlpha = hard ? 0.9 : 0.55
        } else {
          ctx.strokeStyle = hard ? G.edgeHard : G.edgeSoft
          ctx.globalAlpha = 1
        }
        if (!hard) ctx.setLineDash([2.5, 3.5])
        else ctx.setLineDash([])
        const base = hard ? 0.55 + e.score * 0.7 : 0.4 + e.score * 0.45
        ctx.lineWidth = Math.min(1.8, base) / Math.max(0.6, scale)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }

      for (const n of nodesRef.current) {
        const t = threadsByIdRef.current.get(n.id)
        const title = t ? displayTitle(t) : n.id.slice(0, 6)
        const isFocus = n.id === focusIdRef.current
        const isHover = n.id === hoverIdRef.current
        const isIso = isolatedIdsRef.current.has(n.id)
        const inHot = hot ? hot.has(n.id) : true
        const dimmed = hot != null && !inHot
        const baseColor = colors.get(n.id) || UNTAGGED_COLOR

        if (isFocus || isHover) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r + 3.5, 0, Math.PI * 2)
          ctx.fillStyle = hexWithAlpha(baseColor, isFocus ? 0.28 : 0.18)
          ctx.fill()
        }

        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        if (isFocus) {
          ctx.fillStyle = lightenHex(baseColor, 0.45)
        } else if (isHover) {
          ctx.fillStyle = lightenHex(baseColor, 0.28)
        } else if (dimmed || (isIso && !isFocus)) {
          ctx.fillStyle = hexWithAlpha(baseColor, 0.28)
        } else {
          ctx.fillStyle = baseColor
        }
        ctx.globalAlpha = dimmed ? 0.5 : 1
        ctx.fill()
        ctx.globalAlpha = 1

        const showLabel =
          isFocus || isHover || (scale >= LABEL_ZOOM_THRESHOLD && !dimmed)
        if (showLabel) {
          ctx.fillStyle = isFocus || isHover ? G.labelFocus : G.label
          const fontPx = (isFocus ? 10.5 : 9) / Math.max(0.75, Math.min(1.25, scale))
          ctx.font = `${fontPx}px ${tokens.font}`
          ctx.textAlign = "center"
          ctx.textBaseline = "top"
          ctx.fillText(title, n.x, n.y + n.r + 2.5)
        }
      }

      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const hitTest = (clientX: number, clientY: number): LayoutNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scale = Math.max(0.001, scaleRef.current)
    const x = (clientX - rect.left - panRef.current.x) / scale
    const y = (clientY - rect.top - panRef.current.y) / scale
    const pad = HIT_PAD / scale
    let best: LayoutNode | null = null
    let bestD = Infinity
    for (const n of nodesRef.current) {
      const d = Math.hypot(n.x - x, n.y - y)
      if (d <= n.r + pad && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }

  const endDrag = (ev?: ReactPointerEvent) => {
    const drag = dragRef.current
    if (drag && drag.id !== "__pan__") {
      const n = nodesRef.current.find((x) => x.id === drag.id)
      if (n) {
        n.vx = 0
        n.vy = 0
        n.pinned = drag.moved
      }
    }
    if (ev?.target && "releasePointerCapture" in (ev.target as Element)) {
      try {
        ;(ev.target as HTMLElement).releasePointerCapture?.(ev.pointerId)
      } catch {
        /* already released */
      }
    }
    dragRef.current = null
  }

  const onPointerDown = (ev: ReactPointerEvent) => {
    const n = hitTest(ev.clientX, ev.clientY)
    if (n) {
      n.pinned = true
      dragRef.current = { id: n.id, ox: ev.clientX, oy: ev.clientY, moved: false }
      setFocusId(n.id)
      setPanelOpen(true)
      if (simTicksRef.current >= 999) simTicksRef.current = 280
      ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
      return
    }
    setFocusId(null)
    dragRef.current = { id: "__pan__", ox: ev.clientX, oy: ev.clientY, moved: false }
    ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  }

  const onPointerMove = (ev: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag) {
      const n = hitTest(ev.clientX, ev.clientY)
      hoverIdRef.current = n?.id ?? null
      return
    }
    const dx = ev.clientX - drag.ox
    const dy = ev.clientY - drag.oy
    if (Math.abs(dx) + Math.abs(dy) > 2) {
      drag.moved = true
      if (drag.id === "__pan__") userCameraRef.current = true
    }
    drag.ox = ev.clientX
    drag.oy = ev.clientY
    if (drag.id === "__pan__") {
      panRef.current.x += dx
      panRef.current.y += dy
      return
    }
    const n = nodesRef.current.find((x) => x.id === drag.id)
    if (n) {
      n.x += dx / scaleRef.current
      n.y += dy / scaleRef.current
      n.vx = 0
      n.vy = 0
    }
  }

  const onPointerUp = (ev: ReactPointerEvent) => endDrag(ev)
  const onPointerLeave = () => {
    hoverIdRef.current = null
  }
  const onPointerCancel = (ev: ReactPointerEvent) => endDrag(ev)

  const onDoubleClick = (ev: ReactMouseEvent) => {
    const n = hitTest(ev.clientX, ev.clientY)
    if (n) openThread(n.id)
  }

  const onWheel = (ev: ReactWheelEvent) => {
    ev.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = ev.clientX - rect.left
    const my = ev.clientY - rect.top
    const prev = scaleRef.current
    const factor = ev.deltaY > 0 ? 0.92 : 1.08
    const next = Math.min(3.2, Math.max(0.28, prev * factor))
    panRef.current.x = mx - ((mx - panRef.current.x) / prev) * next
    panRef.current.y = my - ((my - panRef.current.y) / prev) * next
    scaleRef.current = next
    userCameraRef.current = true
  }

  const onCanvasKeyDown = (ev: ReactKeyboardEvent) => {
    const ids = orderedIdsRef.current
    if (ids.length === 0) return
    if (ev.key === "Escape") {
      setFocusId(null)
      ev.preventDefault()
      return
    }
    if (ev.key === "Enter" || ev.key === " ") {
      if (focusId) {
        openThread(focusId)
        ev.preventDefault()
      }
      return
    }
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown" || ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
      const dir = ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 1
      const cur = focusId ? ids.indexOf(focusId) : -1
      const next = ids[(cur + dir + ids.length) % ids.length]
      setFocusId(next)
      setPanelOpen(true)
      ev.preventDefault()
    }
    if (ev.key === "f" && (ev.metaKey || ev.ctrlKey)) {
      // avoid browser find; use bare '0' for fit
    }
    if (ev.key === "0" && !ev.metaKey && !ev.ctrlKey) {
      userCameraRef.current = false
      fitView()
      ev.preventDefault()
    }
  }

  if (loadError) {
    return (
      <div style={styles.page}>
        <div ref={barRef} style={styles.floatBar}>
          <strong style={styles.barTitle}>关联图谱</strong>
        </div>
        <div style={styles.empty}>{loadError}</div>
      </div>
    )
  }

  const hasNodes = nodesInput.length > 0
  const hasEdges = edges.length > 0
  const groupsList = showAllGroups ? tagColors.groups : tagColors.groups.slice(0, 12)
  const miniGroups = tagColors.groups.slice(0, 6)
  const untaggedCount = threads.filter(isUntaggedSlim).length
  const chromeTop = barHeight + 20
  const needsExtract = (!hasEdges || !hasNodes) && threads.length > 0 && untaggedCount > 0

  return (
    <div style={styles.page}>
      <div ref={barRef} style={styles.floatBar} role="toolbar" aria-label="图谱工具栏">
        <strong style={styles.barTitle}>关联图谱</strong>
        <input
          style={styles.search}
          placeholder="搜索会话 / 标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索会话或标签"
        />
        <label style={styles.check}>
          <input
            type="checkbox"
            checked={showIsolated}
            onChange={(e) => setShowIsolated(e.target.checked)}
          />
          孤立点
        </label>
        <label style={styles.check} title="过滤弱关联边（共标签 / 要点相似）">
          强度
          <input
            type="range"
            min={0.1}
            max={0.5}
            step={0.05}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            style={{ width: 72, accentColor: tokens.darkAccent }}
            aria-label="边强度阈值"
            aria-valuetext={minScore.toFixed(2)}
          />
          <span style={{ width: 28, fontVariantNumeric: "tabular-nums" }}>
            {minScore.toFixed(2)}
          </span>
        </label>
        <span style={styles.barMeta}>
          {nodesInput.length} 点 · {edges.length} 边
        </span>
        <button
          type="button"
          style={styles.barBtn}
          onClick={() => {
            userCameraRef.current = false
            fitView()
          }}
          title="适应画布（快捷键 0）"
        >
          适应
        </button>
        <button
          type="button"
          style={styles.barBtn}
          onClick={() => persistPanelPref(!panelOpen)}
          aria-pressed={panelOpen}
          title={panelOpen ? "收起侧栏" : "展开侧栏"}
        >
          {panelOpen ? "收起面板" : "图例 · 焦点"}
        </button>
        <button
          type="button"
          style={styles.barBtnGhost}
          onClick={() => window.close()}
          title="关闭图谱标签"
        >
          关闭
        </button>
      </div>

      {/* Always-on mini color legend (panel may be closed) */}
      {miniGroups.length > 0 && (
        <div
          style={{ ...styles.miniLegend, bottom: 16, left: 16 }}
          aria-label="颜色组简图（主标签）"
        >
          <span style={styles.miniLegendTitle}>颜色 = 主标签</span>
          {miniGroups.map((g) => (
            <span key={g.tag} style={styles.miniLegendItem} title={`${g.tag} (${g.count})`}>
              <span style={{ ...styles.colorDot, background: g.color }} />
              <span style={styles.miniLegendTag}>{g.tag}</span>
            </span>
          ))}
          {tagColors.groups.length > miniGroups.length && (
            <span style={{ fontSize: 10, color: tokens.darkMuted }}>
              +{tagColors.groups.length - miniGroups.length}
            </span>
          )}
        </div>
      )}

      {panelOpen && (
        <aside
          style={{
            ...styles.floatPanel,
            top: chromeTop,
            maxHeight: `calc(100vh - ${chromeTop + 16}px)`,
          }}
          aria-label="图例与焦点"
        >
          <div style={styles.panelHead}>
            <span style={styles.asideTitle}>面板</span>
            <button
              type="button"
              style={styles.iconBtn}
              onClick={() => persistPanelPref(false)}
              aria-label="关闭面板"
            >
              ✕
            </button>
          </div>

          <div style={styles.asideSection}>
            <div style={styles.asideTitle}>边</div>
            <div style={styles.legendRow}>
              <span style={{ ...styles.legendLine, borderColor: "rgba(165, 180, 252, 0.7)" }} />
              共标签（硬边）
            </div>
            <div style={styles.legendRow}>
              <span
                style={{
                  ...styles.legendLine,
                  borderColor: "rgba(148, 163, 184, 0.45)",
                  borderStyle: "dashed",
                }}
              />
              要点相似（软边）
            </div>
            <div style={{ fontSize: 10, color: tokens.darkMuted, marginTop: 6, lineHeight: 1.4 }}>
              标签默认隐藏 · 悬停 / 焦点 / 放大后显示 · 双击打开
            </div>
          </div>

          <div style={styles.asideSection}>
            <div style={styles.asideTitle}>颜色组（主标签）</div>
            {groupsList.length === 0 ? (
              <div style={{ fontSize: 11, color: tokens.darkMuted }}>暂无标签</div>
            ) : (
              <div style={styles.colorGroups}>
                {groupsList.map((g) => (
                  <div key={g.tag} style={styles.colorRow}>
                    <span style={{ ...styles.colorDot, background: g.color }} />
                    <span style={styles.colorTag} title={g.tag}>
                      {g.tag}
                    </span>
                    <span style={styles.colorCount}>{g.count}</span>
                  </div>
                ))}
                {tagColors.groups.length > 12 && (
                  <button
                    type="button"
                    style={styles.linkBtn}
                    onClick={() => setShowAllGroups((v) => !v)}
                  >
                    {showAllGroups
                      ? "收起"
                      : `展开全部 ${tagColors.groups.length} 组`}
                  </button>
                )}
                <div style={{ fontSize: 10, color: tokens.darkMuted, marginTop: 4 }}>
                  同色可能对应不同标签（哈希 10 色）
                </div>
              </div>
            )}
          </div>

          <div style={styles.asideSection}>
            <div style={styles.asideTitle}>焦点</div>
            {focusThread ? (
              <>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    marginBottom: 6,
                    color: tokens.darkText,
                  }}
                >
                  {displayTitle(focusThread)}
                </div>
                {(focusThread.digest?.tags || []).length > 0 && (
                  <div style={styles.tags}>
                    {(focusThread.digest?.tags || []).map((tg) => {
                      const c = colorForTag(tg)
                      return (
                        <span
                          key={tg}
                          style={{
                            ...styles.tag,
                            background: hexWithAlpha(c, 0.2),
                            color: lightenHex(c, 0.35),
                          }}
                        >
                          {tg}
                        </span>
                      )
                    })}
                  </div>
                )}
                {focusThread.digest?.tldr && (
                  <p style={styles.tldr}>{focusThread.digest.tldr}</p>
                )}
                <button
                  type="button"
                  style={styles.primaryBtn}
                  onClick={() => openThread(focusThread.id)}
                >
                  打开会话
                </button>
                <div style={{ fontSize: 10, color: tokens.darkMuted, marginTop: 6 }}>
                  双击节点 / Enter 打开 · 图谱保持打开
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: tokens.darkMuted }}>
                单击节点查看详情 · 单击空白取消 · ←→ 切换
              </div>
            )}
          </div>

          {status && <div style={styles.status}>{status}</div>}
          {!panelOpen && status && null}
        </aside>
      )}

      {/* Status toast when panel closed */}
      {!panelOpen && status && (
        <div style={{ ...styles.statusFloat, top: chromeTop }}>{status}</div>
      )}

      <main style={styles.main}>
        {threads.length >= 300 && (
          <div
            style={{ ...styles.capChip, top: chromeTop }}
            role="status"
          >
            仅显示最近 300 会话
          </div>
        )}
        {!hasNodes && (
          <div style={{ ...styles.empty, pointerEvents: "auto" }}>
            <div style={{ maxWidth: 360 }}>
              {threads.length === 0
                ? "暂无会话"
                : !hasEdges
                  ? "还没有关联边（或节点均为孤立）。请先为会话生成标签，再重新打开图谱；也可勾选「孤立点」查看全部会话。"
                  : "没有可显示的节点。试试开启「孤立点」，或降低强度阈值 / 清空搜索。"}
              {needsExtract && (
                <div style={{ marginTop: 14 }}>
                  <button type="button" style={styles.primaryBtn} onClick={requestExtractUntagged}>
                    为未标注提取要点（最多 {EXTRACT_MAX}）
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {hasNodes && !hasEdges && (
          <div style={{ ...styles.emptyBanner, top: chromeTop, pointerEvents: "auto" }}>
            <span>还没有关联边。</span>
            {untaggedCount > 0 && (
              <button type="button" style={styles.bannerBtn} onClick={requestExtractUntagged}>
                为未标注提取要点
              </button>
            )}
          </div>
        )}
        <div
          style={styles.srOnly}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {liveRegionText}
        </div>
        <canvas
          ref={canvasRef}
          style={styles.canvas}
          role="img"
          tabIndex={0}
          aria-label="会话关联图谱。方向键切换节点，Enter 打开会话，Esc 取消焦点，0 适应画布。标签默认隐藏，悬停或放大后显示。"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onPointerCancel={onPointerCancel}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          onKeyDown={onCanvasKeyDown}
        />
      </main>
    </div>
  )
}

const glass: CSSProperties = {
  background: "rgba(20, 24, 32, 0.88)",
  border: `1px solid ${tokens.darkBorder}`,
  boxShadow: "0 8px 28px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
}

const styles: Record<string, CSSProperties> = {
  page: {
    position: "relative",
    height: "100vh",
    margin: 0,
    fontFamily: tokens.font,
    background: G.canvas,
    color: tokens.darkText,
    overflow: "hidden",
  },
  floatBar: {
    ...glass,
    position: "absolute",
    zIndex: 10,
    top: 12,
    left: 12,
    right: 12,
    maxWidth: "calc(100% - 24px)",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 12,
    pointerEvents: "auto",
  },
  barTitle: {
    fontSize: 13,
    fontWeight: 650,
    letterSpacing: "0.02em",
    marginRight: 4,
  },
  barMeta: {
    fontSize: 11,
    color: tokens.darkMuted,
    marginLeft: "auto",
  },
  barBtn: {
    border: `1px solid ${tokens.darkBorder}`,
    borderRadius: tokens.radiusMd,
    background: "rgba(129, 140, 248, 0.12)",
    color: tokens.darkAccent,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  barBtnGhost: {
    border: `1px solid ${tokens.darkBorder}`,
    borderRadius: tokens.radiusMd,
    background: "transparent",
    color: tokens.darkMuted,
    padding: "5px 10px",
    fontSize: 11,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  search: {
    border: `1px solid ${tokens.darkBorder}`,
    borderRadius: tokens.radiusMd,
    padding: "4px 9px",
    fontSize: 12,
    minWidth: 140,
    maxWidth: 200,
    fontFamily: tokens.font,
    background: "rgba(11, 13, 18, 0.65)",
    color: tokens.darkText,
    outline: "none",
  },
  check: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: tokens.darkMuted,
    userSelect: "none" as const,
  },
  floatPanel: {
    ...glass,
    position: "absolute",
    zIndex: 10,
    right: 12,
    width: 220,
    overflow: "auto",
    padding: 12,
    borderRadius: 12,
    pointerEvents: "auto",
  },
  miniLegend: {
    ...glass,
    position: "absolute",
    zIndex: 9,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 10,
    maxWidth: "min(420px, calc(100vw - 32px))",
    pointerEvents: "none",
  },
  miniLegendTitle: {
    fontSize: 10,
    color: tokens.darkMuted,
    fontWeight: 600,
    letterSpacing: "0.04em",
  },
  miniLegendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    color: "rgba(226, 232, 240, 0.75)",
  },
  miniLegendTag: {
    maxWidth: 64,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  panelHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  iconBtn: {
    border: "none",
    background: "transparent",
    color: tokens.darkMuted,
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 6px",
    borderRadius: 4,
  },
  asideSection: { marginBottom: 14 },
  asideTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: tokens.darkMuted,
    marginBottom: 8,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  },
  legendRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    marginBottom: 4,
    color: tokens.darkMuted,
  },
  legendLine: {
    display: "inline-block",
    width: 18,
    borderBottomWidth: 1.5,
    borderBottomStyle: "solid",
  },
  colorGroups: { display: "flex", flexDirection: "column", gap: 3 },
  colorRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    color: tokens.darkMuted,
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    flexShrink: 0,
  },
  colorTag: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    color: "rgba(226, 232, 240, 0.78)",
  },
  colorCount: {
    fontVariantNumeric: "tabular-nums",
    color: tokens.darkMuted,
    fontSize: 10,
  },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: tokens.darkAccent,
    fontSize: 11,
    cursor: "pointer",
    padding: "4px 0",
    textAlign: "left" as const,
    fontFamily: tokens.font,
  },
  tags: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  tag: {
    fontSize: 10,
    padding: "2px 6px",
    borderRadius: 999,
  },
  tldr: {
    fontSize: 12,
    color: tokens.darkMuted,
    lineHeight: 1.45,
    margin: "0 0 10px",
  },
  primaryBtn: {
    border: "none",
    borderRadius: tokens.radiusMd,
    background: tokens.darkAccent,
    color: "#0b0d12",
    padding: "6px 11px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: tokens.font,
    width: "100%",
  },
  status: {
    fontSize: 11,
    color: tokens.darkAccent,
    background: "rgba(129, 140, 248, 0.12)",
    padding: 8,
    borderRadius: tokens.radiusMd,
  },
  statusFloat: {
    ...glass,
    position: "absolute",
    zIndex: 11,
    left: 12,
    maxWidth: 360,
    fontSize: 11,
    color: tokens.darkAccent,
    padding: "8px 12px",
    borderRadius: 10,
  },
  main: {
    position: "absolute",
    inset: 0,
    zIndex: 0,
    background: G.canvas,
  },
  canvas: {
    width: "100%",
    height: "100%",
    display: "block",
    touchAction: "none",
    cursor: "grab",
    outline: "none",
  },
  empty: {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    textAlign: "center",
    fontSize: 13,
    color: tokens.darkMuted,
    lineHeight: 1.5,
  },
  emptyBanner: {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 2,
    background: tokens.darkWarningBg,
    color: tokens.darkWarning,
    padding: "7px 12px",
    borderRadius: tokens.radiusMd,
    fontSize: 12,
    maxWidth: "80%",
    border: `1px solid ${tokens.darkBorder}`,
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  bannerBtn: {
    border: `1px solid ${tokens.darkWarning}`,
    borderRadius: tokens.radiusMd,
    background: "transparent",
    color: tokens.darkWarning,
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  capChip: {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 2,
    background: "rgba(251, 191, 36, 0.12)",
    color: tokens.darkWarning,
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    border: `1px solid ${tokens.darkBorder}`,
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap" as const,
    border: 0,
  },
}
