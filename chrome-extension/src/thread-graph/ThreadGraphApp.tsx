// Full-page Obsidian-like thread graph (v1).
// Spec: docs/superpowers/specs/2026-08-11-thread-graph-obsidian-view-design.md

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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

function displayTitle(t: ThreadGraphSlim): string {
  const a = (t.alias || "").trim()
  if (a) return a.length > 28 ? a.slice(0, 27) + "…" : a
  return `未命名 · ${(t.id || "").slice(0, 6)}`
}

function radiusForDegree(deg: number): number {
  return Math.min(22, Math.max(8, 8 + Math.sqrt(deg) * 3.2))
}

export function ThreadGraphApp() {
  const [snap, setSnap] = useState<ThreadGraphSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [minScore, setMinScore] = useState(0.2)
  const [showIsolated, setShowIsolated] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<LayoutNode[]>([])
  const edgesRef = useRef<RelatedEdge[]>([])
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null)
  const panRef = useRef({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const rafRef = useRef(0)
  const sizeRef = useRef({ w: 800, h: 600 })
  const simTicksRef = useRef(0)

  const focusFromUrl = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("focus")
    } catch {
      return null
    }
  }, [])

  // Load snapshot (contract: storage.session only — dual-review nit)
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
        setFocusId(s.focus_id || focusFromUrl)
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
      // keep endpoints of edges only
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

  // (Re)seed layout when graph structure changes
  useEffect(() => {
    const { w, h } = sizeRef.current
    const rMap = new Map(nodesInput.map((n) => [n.id, radiusForDegree(n.degree)]))
    nodesRef.current = seedLayoutNodes(
      nodesInput.map((n) => n.id),
      w,
      h,
      rMap,
    )
    edgesRef.current = edges
    simTicksRef.current = 0
  }, [nodesInput, edges])

  const focusThread = useMemo(
    () => (focusId ? threads.find((t) => t.id === focusId) || null : null),
    [focusId, threads],
  )

  const openThread = useCallback((threadId: string) => {
    setFocusId(threadId)
    chrome.runtime.sendMessage(
      { type: "thread_graph.open_thread", thread_id: threadId },
      () => {
        void chrome.runtime.lastError
      },
    )
    setStatus("已请求打开会话（图谱保持打开）")
  }, [])

  // Resize + draw loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const resize = () => {
      const rect = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      sizeRef.current = { w: rect.width, h: rect.height }
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(parent)

    const draw = () => {
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const { w, h } = sizeRef.current
      // Simulate a few ticks while energy high
      if (simTicksRef.current < 320 && nodesRef.current.length > 0) {
        const e = forceLayoutTick(nodesRef.current, edgesRef.current, {
          width: w,
          height: h,
        })
        simTicksRef.current++
        if (e < 0.06 && simTicksRef.current > 50) simTicksRef.current = 999
      }

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = tokens.bgMuted
      ctx.fillRect(0, 0, w, h)

      ctx.save()
      ctx.translate(panRef.current.x, panRef.current.y)
      ctx.scale(scaleRef.current, scaleRef.current)

      const byId = new Map(nodesRef.current.map((n) => [n.id, n]))

      // Edges
      for (const e of edgesRef.current) {
        const a = byId.get(e.a)
        const b = byId.get(e.b)
        if (!a || !b) continue
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        const hard = e.kind === "hard"
        ctx.strokeStyle = hard ? "rgba(79, 70, 229, 0.45)" : "rgba(148, 163, 184, 0.55)"
        if (!hard) ctx.setLineDash([4, 4])
        else ctx.setLineDash([])
        ctx.lineWidth = Math.min(4, 1 + e.score * 2.5)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // Nodes
      const q = query.trim().toLowerCase()
      for (const n of nodesRef.current) {
        const t = threads.find((x) => x.id === n.id)
        const title = t ? displayTitle(t) : n.id.slice(0, 6)
        const isFocus = n.id === focusId
        const isIso = isolatedIds.has(n.id)

        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = isFocus ? tokens.accentSoft : tokens.bgElevated
        ctx.globalAlpha = isIso && !isFocus ? 0.45 : 1
        ctx.fill()
        ctx.strokeStyle = isFocus ? tokens.accent : tokens.borderStrong
        ctx.lineWidth = isFocus ? 2.5 : 1.2
        ctx.stroke()
        ctx.globalAlpha = 1

        ctx.fillStyle = tokens.text
        ctx.font = `${isFocus ? 12 : 11}px ${tokens.font}`
        ctx.textAlign = "center"
        ctx.textBaseline = "top"
        ctx.fillText(title, n.x, n.y + n.r + 3)
      }

      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
    }
  }, [threads, focusId, query, isolatedIds])

  const hitTest = (clientX: number, clientY: number): LayoutNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = (clientX - rect.left - panRef.current.x) / scaleRef.current
    const y = (clientY - rect.top - panRef.current.y) / scaleRef.current
    let best: LayoutNode | null = null
    let bestD = Infinity
    for (const n of nodesRef.current) {
      const d = Math.hypot(n.x - x, n.y - y)
      if (d <= n.r + 4 && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }

  const onPointerDown = (ev: ReactPointerEvent) => {
    const n = hitTest(ev.clientX, ev.clientY)
    if (n) {
      n.pinned = true
      dragRef.current = { id: n.id, ox: ev.clientX, oy: ev.clientY }
      setFocusId(n.id)
      simTicksRef.current = 0
      ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
      return
    }
    dragRef.current = { id: "__pan__", ox: ev.clientX, oy: ev.clientY }
  }

  const onPointerMove = (ev: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = ev.clientX - drag.ox
    const dy = ev.clientY - drag.oy
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

  const onPointerUp = (_ev: ReactPointerEvent) => {
    const drag = dragRef.current
    if (drag && drag.id !== "__pan__") {
      const n = nodesRef.current.find((x) => x.id === drag.id)
      if (n) n.pinned = false
    }
    dragRef.current = null
  }

  const onDoubleClick = (ev: ReactMouseEvent) => {
    const n = hitTest(ev.clientX, ev.clientY)
    if (n) openThread(n.id)
  }

  const onWheel = (ev: ReactWheelEvent) => {
    ev.preventDefault()
    const factor = ev.deltaY > 0 ? 0.92 : 1.08
    scaleRef.current = Math.min(3, Math.max(0.35, scaleRef.current * factor))
  }

  if (loadError) {
    return (
      <div style={styles.page}>
        <header style={styles.header}>
          <strong>关联图谱</strong>
        </header>
        <div style={styles.empty}>{loadError}</div>
      </div>
    )
  }

  const hasNodes = nodesInput.length > 0
  const hasEdges = edges.length > 0

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <strong style={{ fontSize: 15 }}>关联图谱</strong>
          <span style={styles.meta}>
            边 = 共标签（实线）+ 要点相似（虚线）· 本地计算 · 不改默认时间轴
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            style={styles.search}
            placeholder="搜索会话 / 标签"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label style={styles.check}>
            <input
              type="checkbox"
              checked={showIsolated}
              onChange={(e) => setShowIsolated(e.target.checked)}
            />
            显示孤立点
          </label>
          <label style={styles.check}>
            强度
            <input
              type="range"
              min={0.1}
              max={0.5}
              step={0.05}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
            />
            <span style={{ width: 32 }}>{minScore.toFixed(2)}</span>
          </label>
        </div>
      </header>

      <div style={styles.body}>
        <aside style={styles.aside}>
          <div style={styles.asideSection}>
            <div style={styles.asideTitle}>图例</div>
            <div style={styles.legendRow}>
              <span style={{ ...styles.legendLine, borderColor: "rgba(79,70,229,0.6)" }} />
              共标签（硬边）
            </div>
            <div style={styles.legendRow}>
              <span
                style={{
                  ...styles.legendLine,
                  borderColor: "rgba(148,163,184,0.8)",
                  borderStyle: "dashed",
                }}
              />
              要点相似（软边）
            </div>
            <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 8, lineHeight: 1.45 }}>
              节点 {nodesInput.length} · 边 {edges.length}
              {threads.length >= 300 ? " · 仅最近 300 会话" : ""}
            </div>
          </div>

          <div style={styles.asideSection}>
            <div style={styles.asideTitle}>焦点</div>
            {focusThread ? (
              <>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                  {displayTitle(focusThread)}
                </div>
                {(focusThread.digest?.tags || []).length > 0 && (
                  <div style={styles.tags}>
                    {(focusThread.digest?.tags || []).map((tg) => (
                      <span key={tg} style={styles.tag}>
                        {tg}
                      </span>
                    ))}
                  </div>
                )}
                {focusThread.digest?.tldr && (
                  <p style={styles.tldr}>{focusThread.digest.tldr}</p>
                )}
                <button type="button" style={styles.primaryBtn} onClick={() => openThread(focusThread.id)}>
                  打开会话
                </button>
                <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 6 }}>
                  双击节点也可打开 · 图谱保持打开
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: tokens.textSecondary }}>单击节点查看详情</div>
            )}
          </div>

          {status && <div style={styles.status}>{status}</div>}
        </aside>

        <main style={styles.main}>
          {!hasNodes && (
            <div style={styles.empty}>
              {threads.length === 0
                ? "暂无会话"
                : !hasEdges
                  ? "还没有关联边（或节点均为孤立）。请先在 Side Panel ☰ →「为未标注提取要点」生成标签，再重新打开图谱；也可勾选「显示孤立点」查看全部会话。"
                  : "没有可显示的节点。试试开启「显示孤立点」，或降低强度阈值 / 清空搜索。"}
            </div>
          )}
          {hasNodes && !hasEdges && (
            <div style={styles.emptyBanner}>
              还没有关联边。请先在 Side Panel ☰ →「为未标注提取要点」生成标签后再打开图谱。
            </div>
          )}
          <canvas
            ref={canvasRef}
            style={styles.canvas}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
          />
        </main>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    margin: 0,
    fontFamily: tokens.font,
    background: tokens.bg,
    color: tokens.text,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
  },
  meta: { fontSize: 11, color: tokens.textMuted },
  search: {
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    padding: "5px 10px",
    fontSize: 12,
    minWidth: 160,
    fontFamily: tokens.font,
  },
  check: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: tokens.textSecondary,
  },
  body: { display: "flex", flex: 1, minHeight: 0 },
  aside: {
    width: 240,
    flexShrink: 0,
    borderRight: `1px solid ${tokens.border}`,
    padding: 12,
    overflow: "auto",
    background: tokens.bgElevated,
  },
  asideSection: { marginBottom: 16 },
  asideTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: tokens.textMuted,
    marginBottom: 8,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  },
  legendRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    marginBottom: 4,
  },
  legendLine: {
    display: "inline-block",
    width: 22,
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
  },
  tags: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  tag: {
    fontSize: 10,
    padding: "2px 6px",
    borderRadius: 999,
    background: tokens.accentSoft,
    color: tokens.accentText,
  },
  tldr: {
    fontSize: 12,
    color: tokens.textSecondary,
    lineHeight: 1.45,
    margin: "0 0 10px",
  },
  primaryBtn: {
    border: "none",
    borderRadius: tokens.radiusMd,
    background: tokens.accent,
    color: tokens.userBubbleText || "#ffffff",
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  status: {
    fontSize: 11,
    color: tokens.accentText,
    background: tokens.accentSoft,
    padding: 8,
    borderRadius: tokens.radiusMd,
  },
  main: { flex: 1, position: "relative", minWidth: 0, background: tokens.bgMuted },
  canvas: {
    width: "100%",
    height: "100%",
    display: "block",
    touchAction: "none",
    cursor: "grab",
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
    color: tokens.textSecondary,
    lineHeight: 1.5,
    pointerEvents: "none",
  },
  emptyBanner: {
    position: "absolute",
    top: 12,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 2,
    background: tokens.warningSoft,
    color: tokens.warning,
    padding: "8px 14px",
    borderRadius: tokens.radiusMd,
    fontSize: 12,
    maxWidth: "80%",
    boxShadow: tokens.shadowSm,
  },
}
