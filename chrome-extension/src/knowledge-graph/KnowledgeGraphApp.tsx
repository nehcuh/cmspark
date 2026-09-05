// Full-page knowledge distribution graph.
// Spec: docs/superpowers/specs/2026-09-04-knowledge-graph-view-design.md
// Layout: reuse thread-graph force-layout; positions/edges are not persisted.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react"
import { forceLayoutTick, seedLayoutNodes, type LayoutNode } from "../thread-graph/force-layout"
import { hexWithAlpha, lightenHex, UNTAGGED_COLOR } from "../thread-graph/tag-colors"
import { tokens } from "../sidepanel/ui/tokens"
import {
  KNOWLEDGE_GRAPH_SNAPSHOT_KEY,
  type KnowledgeGraphSnapshot,
} from "../background/knowledge-graph"
import {
  KnowledgeGraphColorSwitch,
  KnowledgeGraphGroupCard,
  KnowledgeGraphLlmSwitch,
  KnowledgeGraphStatusView,
} from "./chrome"
import { hoverCaption, nodeColor, type ColorMode } from "./coloring"
import {
  KNOWLEDGE_GRAPH_ENTRY_LABEL,
  KNOWLEDGE_GRAPH_UNGROUPED_LABEL,
  shouldRenderGraphCanvas,
} from "./copy"
import { KNOWLEDGE_GRAPH_LLM_LABELS_KEY, parseLlmLabelsPref, writeLlmLabelsPref } from "./llm-pref"
import { parseKnowledgeGraphPayload, type KnowledgeGraphNode } from "./wire"

const G = {
  canvas: "#0d0f14",
  edgeSoft: "rgba(148, 163, 184, 0.22)",
  edgeHot: "rgba(165, 180, 252, 0.75)",
  edgeDim: "rgba(148, 163, 184, 0.06)",
  labelFocus: "rgba(248, 250, 252, 0.95)",
} as const

const HIT_PAD = 8
const REBUILD_POLL_MS = 2500
/** 重建轮询上限（复审 NIT-5）：40 × 2.5s = 100s 后停轮询，诚实提示手动刷新。 */
const REBUILD_POLL_MAX = 40

function radiusForDegree(deg: number): number {
  return Math.min(7.5, Math.max(2.8, 2.8 + Math.sqrt(deg) * 1.35))
}

export function KnowledgeGraphApp() {
  const [snap, setSnap] = useState<KnowledgeGraphSnapshot | null>(null)
  const [colorMode, setColorMode] = useState<ColorMode>("group")
  const [llmEnabled, setLlmEnabled] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [hoverCaptionText, setHoverCaptionText] = useState("")
  const [barHeight, setBarHeight] = useState(48)
  const [panelOpen, setPanelOpen] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const nodesRef = useRef<LayoutNode[]>([])
  const edgesRef = useRef<{ a: string; b: string; score: number }[]>([])
  const dragRef = useRef<{ id: string; ox: number; oy: number; moved: boolean } | null>(null)
  const panRef = useRef({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const rafRef = useRef(0)
  const sizeRef = useRef({ w: 800, h: 600 })
  const simTicksRef = useRef(0)
  const hoverIdRef = useRef<string | null>(null)
  const focusIdRef = useRef<string | null>(null)
  const fittedRef = useRef(false)
  const userCameraRef = useRef(false)
  const colorByIdRef = useRef<Map<string, string>>(new Map())
  const nodesByIdRef = useRef<Map<string, KnowledgeGraphNode>>(new Map())
  const fitViewRef = useRef<() => void>(() => {})
  const captionByIdRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    focusIdRef.current = focusId
  }, [focusId])

  const applySnap = useCallback((raw: unknown) => {
    const parsed = parseKnowledgeGraphPayload(raw)
    if (!parsed) return
    const rec = raw as Record<string, unknown>
    setSnap({
      ...parsed,
      ts: typeof rec.ts === "number" ? rec.ts : Date.now(),
      focus_id: typeof rec.focus_id === "string" ? rec.focus_id : null,
      llm_labels: rec.llm_labels === true,
    })
    if (typeof rec.focus_id === "string" && rec.focus_id) setFocusId(rec.focus_id)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pref = await chrome.storage.local.get(KNOWLEDGE_GRAPH_LLM_LABELS_KEY)
        if (!cancelled) setLlmEnabled(parseLlmLabelsPref(pref[KNOWLEDGE_GRAPH_LLM_LABELS_KEY]))
      } catch {
        /* default off */
      }
      try {
        const res = await chrome.storage.session.get(KNOWLEDGE_GRAPH_SNAPSHOT_KEY)
        if (cancelled) return
        applySnap(res[KNOWLEDGE_GRAPH_SNAPSHOT_KEY])
      } catch {
        /* empty → rebuilding banner via null snap */
      }
    })()
    const onStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "session" && changes[KNOWLEDGE_GRAPH_SNAPSHOT_KEY]) {
        applySnap(changes[KNOWLEDGE_GRAPH_SNAPSHOT_KEY].newValue)
      }
      if (area === "local" && changes[KNOWLEDGE_GRAPH_LLM_LABELS_KEY]) {
        setLlmEnabled(parseLlmLabelsPref(changes[KNOWLEDGE_GRAPH_LLM_LABELS_KEY].newValue))
      }
    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(onStorage)
    }
  }, [applySnap])

  const status = snap?.status ?? "rebuilding"
  const truncated = snap?.truncated === true
  const showCanvas = snap ? shouldRenderGraphCanvas(status) : false
  const [pollExhausted, setPollExhausted] = useState(false)

  useEffect(() => {
    if (status !== "rebuilding") {
      setPollExhausted(false)
      return
    }
    // 复审 NIT-5：轮询加上限（40 × 2.5s = 100s），打满停轮询并诚实提示手动刷新。
    let polls = 0
    const tick = () => {
      polls += 1
      if (polls > REBUILD_POLL_MAX) {
        setPollExhausted(true)
        clearInterval(id)
        return
      }
      chrome.runtime.sendMessage({ type: "knowledge_graph.refresh" }, () => {
        void chrome.runtime.lastError
      })
    }
    tick()
    const id = setInterval(tick, REBUILD_POLL_MS)
    return () => clearInterval(id)
  }, [status, llmEnabled])

  const payloadNodes = snap?.nodes ?? []
  const payloadEdges = snap?.edges ?? []
  const labels = snap?.labels ?? {}

  const groupKeys = useMemo(() => {
    const seen = new Set<string>()
    const keys: string[] = []
    for (const n of payloadNodes) {
      const k = n.group_key || "u:ungrouped"
      if (seen.has(k)) continue
      seen.add(k)
      keys.push(k)
    }
    return keys
  }, [payloadNodes])

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const measure = () => setBarHeight(Math.max(40, Math.ceil(el.getBoundingClientRect().height)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [status])

  useEffect(() => {
    const degree = new Map<string, number>()
    for (const n of payloadNodes) degree.set(n.id, 0)
    for (const e of payloadEdges) {
      degree.set(e.a, (degree.get(e.a) || 0) + 1)
      degree.set(e.b, (degree.get(e.b) || 0) + 1)
    }
    const ids = payloadNodes.map((n) => n.id)
    const radiusById = new Map(ids.map((id) => [id, radiusForDegree(degree.get(id) || 0)]))
    const { w, h } = sizeRef.current
    nodesRef.current = seedLayoutNodes(ids, w, h, radiusById)
    edgesRef.current = payloadEdges.map((e) => ({ a: e.a, b: e.b, score: e.score }))
    simTicksRef.current = 0
    fittedRef.current = false
    userCameraRef.current = false
    const byId = new Map(payloadNodes.map((n) => [n.id, n]))
    nodesByIdRef.current = byId
    const colors = new Map<string, string>()
    const captions = new Map<string, string>()
    for (const n of payloadNodes) {
      colors.set(n.id, nodeColor(n, colorMode))
      captions.set(n.id, hoverCaption(n, colorMode, labels))
    }
    colorByIdRef.current = colors
    captionByIdRef.current = captions
  }, [payloadNodes, payloadEdges, colorMode, labels])

  const openDoc = useCallback((id: string) => {
    setFocusId(id)
    setPanelOpen(true)
    chrome.runtime.sendMessage({ type: "knowledge_graph.open_doc", id }, () => {
      void chrome.runtime.lastError
    })
  }, [])

  const onLlmChange = useCallback((enabled: boolean) => {
    setLlmEnabled(enabled)
    void writeLlmLabelsPref(enabled)
    chrome.runtime.sendMessage(
      { type: "knowledge_graph.refresh", llm_labels: enabled },
      () => {
        void chrome.runtime.lastError
      },
    )
  }, [])

  const onRegenerate = useCallback(() => {
    chrome.runtime.sendMessage(
      { type: "knowledge_graph.refresh", llm_labels: true, regenerate: true },
      () => {
        void chrome.runtime.lastError
      },
    )
  }, [])

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
      if (simTicksRef.current < 320 && nodesRef.current.length > 0) {
        const e = forceLayoutTick(nodesRef.current, edgesRef.current, { width: w, height: h })
        simTicksRef.current++
        if ((e < 0.06 && simTicksRef.current > 50) || simTicksRef.current >= 320) {
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
      for (const e of edgesRef.current) {
        const a = byId.get(e.a)
        const b = byId.get(e.b)
        if (!a || !b) continue
        const isHot = hot ? hot.has(e.a) && hot.has(e.b) : false
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = hot != null && !isHot ? G.edgeDim : isHot ? G.edgeHot : G.edgeSoft
        ctx.lineWidth = Math.min(1.6, 0.4 + e.score * 0.5) / Math.max(0.6, scale)
        ctx.stroke()
      }
      for (const n of nodesRef.current) {
        const isFocus = n.id === focusIdRef.current
        const isHover = n.id === hoverIdRef.current
        const inHot = hot ? hot.has(n.id) : true
        const dimmed = hot != null && !inHot
        const baseColor = colorByIdRef.current.get(n.id) || UNTAGGED_COLOR
        if (isFocus || isHover) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r + 3.5, 0, Math.PI * 2)
          ctx.fillStyle = hexWithAlpha(baseColor, isFocus ? 0.28 : 0.18)
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = isFocus
          ? lightenHex(baseColor, 0.45)
          : isHover
            ? lightenHex(baseColor, 0.28)
            : dimmed
              ? hexWithAlpha(baseColor, 0.28)
              : baseColor
        ctx.globalAlpha = dimmed ? 0.5 : 1
        ctx.fill()
        ctx.globalAlpha = 1
        if (isFocus || isHover) {
          ctx.fillStyle = G.labelFocus
          ctx.font = `${(isFocus ? 10.5 : 9) / Math.max(0.75, Math.min(1.25, scale))}px ${tokens.font}`
          ctx.textAlign = "center"
          ctx.textBaseline = "top"
          const cap = captionByIdRef.current.get(n.id) || n.id
          ctx.fillText(cap, n.x, n.y + n.r + 2.5)
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
    if (drag && drag.id !== "__pan__" && !drag.moved) {
      openDoc(drag.id)
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
      dragRef.current = { id: n.id, ox: ev.clientX, oy: ev.clientY, moved: false }
      setFocusId(n.id)
      setPanelOpen(true)
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
      setHoverCaptionText(n ? captionByIdRef.current.get(n.id) || "" : "")
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
    }
  }

  const onWheel = (ev: ReactWheelEvent) => {
    ev.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = ev.clientX - rect.left
    const my = ev.clientY - rect.top
    const prev = scaleRef.current
    const next = Math.min(3.2, Math.max(0.28, prev * (ev.deltaY > 0 ? 0.92 : 1.08)))
    panRef.current.x = mx - ((mx - panRef.current.x) / prev) * next
    panRef.current.y = my - ((my - panRef.current.y) / prev) * next
    scaleRef.current = next
    userCameraRef.current = true
  }

  const chromeTop = barHeight + 20
  const ungroupedKey = groupKeys.find((k) => k === "u:ungrouped" || k === "" || k === "ungrouped")

  return (
    <div style={styles.page}>
      <div ref={barRef} style={styles.floatBar} role="toolbar" aria-label={`${KNOWLEDGE_GRAPH_ENTRY_LABEL}工具栏`}>
        <strong style={styles.barTitle}>{KNOWLEDGE_GRAPH_ENTRY_LABEL}</strong>
        <KnowledgeGraphColorSwitch mode={colorMode} onChange={setColorMode} />
        <KnowledgeGraphLlmSwitch
          enabled={llmEnabled}
          onChange={onLlmChange}
          onRegenerate={onRegenerate}
        />
        <span style={styles.barMeta}>
          {showCanvas ? `${payloadNodes.length} 点 · ${payloadEdges.length} 边` : ""}
        </span>
        <button type="button" style={styles.barBtnGhost} onClick={() => setPanelOpen((v) => !v)}>
          {panelOpen ? "收起面板" : "分组"}
        </button>
        <button type="button" style={styles.barBtnGhost} onClick={() => window.close()} title="关闭此标签页">
          关闭
        </button>
      </div>

      {status !== "ok" && (
        <div style={{ ...styles.banner, top: chromeTop }}>
          <KnowledgeGraphStatusView status={status} truncated={truncated} pollExhausted={pollExhausted} error={snap?.error} />
        </div>
      )}

      {hoverCaptionText ? (
        <div style={{ ...styles.hoverChip, top: chromeTop }} role="status">
          {hoverCaptionText}
        </div>
      ) : null}

      {panelOpen && (
        <aside style={{ ...styles.floatPanel, top: chromeTop }} aria-label="分组">
          <div style={styles.asideTitle}>分组</div>
          {groupKeys.length === 0 ? (
            <div style={{ fontSize: 11, color: tokens.darkMuted }}>
              {status === "too_few" || status === "rebuilding" ? "" : KNOWLEDGE_GRAPH_UNGROUPED_LABEL}
            </div>
          ) : (
            groupKeys.map((k) => (
              <KnowledgeGraphGroupCard
                key={k}
                groupKey={k}
                label={
                  labels[k] ||
                  (k === ungroupedKey ? { name: KNOWLEDGE_GRAPH_UNGROUPED_LABEL, ai: false } : undefined)
                }
                llmEnabled={llmEnabled}
              />
            ))
          )}
        </aside>
      )}

      <main style={styles.main}>
        {showCanvas && (
          <canvas
            ref={canvasRef}
            style={styles.canvas}
            role="img"
            tabIndex={0}
            aria-label="知识分布图谱。悬停显示标题与分组，点击节点在知识面板打开文档。"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(ev) => endDrag(ev)}
            onPointerLeave={() => {
              hoverIdRef.current = null
              setHoverCaptionText("")
            }}
            onPointerCancel={(ev) => endDrag(ev)}
            onWheel={onWheel}
          />
        )}
      </main>
    </div>
  )
}

const glass: CSSProperties = {
  background: "rgba(20, 24, 32, 0.88)",
  border: `1px solid ${tokens.darkBorder}`,
  boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
  backdropFilter: "blur(12px)",
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
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 12,
  },
  barTitle: { fontSize: 13, fontWeight: 650, letterSpacing: "0.02em" },
  barMeta: { fontSize: 11, color: tokens.darkMuted, marginLeft: "auto" },
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
  banner: {
    position: "absolute",
    zIndex: 8,
    left: 12,
    right: 12,
    ...glass,
    borderRadius: 10,
    color: tokens.darkText,
  },
  hoverChip: {
    position: "absolute",
    zIndex: 8,
    left: 12,
    ...glass,
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 11,
    maxWidth: "60%",
  },
  floatPanel: {
    ...glass,
    position: "absolute",
    zIndex: 9,
    right: 12,
    width: 260,
    maxHeight: "70vh",
    overflow: "auto",
    borderRadius: 12,
    padding: 12,
  },
  asideTitle: { fontSize: 11, color: tokens.darkMuted, marginBottom: 8, fontWeight: 600 },
  main: { position: "absolute", inset: 0 },
  canvas: { width: "100%", height: "100%", display: "block", cursor: "grab", outline: "none" },
}
