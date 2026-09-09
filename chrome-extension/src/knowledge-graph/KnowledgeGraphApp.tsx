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
import { filterKnowledgeNodes, fitKnowledgeCamera, shortKnowledgeTitle } from "./explorer"
import {
  KNOWLEDGE_GRAPH_SNAPSHOT_KEY,
  type KnowledgeGraphSnapshot,
} from "../background/knowledge-graph"
import {
  KnowledgeGraphColorSwitch,
  KnowledgeGraphGroupCard,
  KnowledgeGraphLlmSwitch,
  KnowledgeGraphLockDissolvedBanner,
  KnowledgeGraphNoRelationsNote,
  KnowledgeGraphOrganizeCta,
  KnowledgeGraphOrganizeErrorBar,
  KnowledgeGraphReorganizeButton,
  KnowledgeGraphStaleBadge,
  KnowledgeGraphStatusView,
  KnowledgeGraphTfSwitchBanner,
} from "./chrome"
import { hoverCaption, nodeColor, type ColorMode } from "./coloring"
import {
  KNOWLEDGE_GRAPH_AI_RELATION,
  KNOWLEDGE_GRAPH_ENTRY_LABEL,
  KNOWLEDGE_GRAPH_REASON_DISMISS,
  KNOWLEDGE_GRAPH_UNGROUPED_LABEL,
  knowledgeGraphBarMeta,
  shouldRenderGraphCanvas,
} from "./copy"
import {
  KNOWLEDGE_GRAPH_LLM_LABELS_KEY,
  parseLlmLabelsPref,
  parseTfSwitchAck,
  writeLlmLabelsPref,
  writeTfSwitchAck,
  KNOWLEDGE_GRAPH_TF_SWITCH_ACK_KEY,
} from "./llm-pref"
import {
  knowledgeGraphPairKey,
  knowledgeGraphViewModel,
  parseKnowledgeGraphPayload,
  type KnowledgeGraphNode,
  type KnowledgeGraphRelation,
} from "./wire"

type GraphDrawEdge = { a: string; b: string; score: number; dashed?: boolean; reason?: string }

const G = {
  canvas: tokens.darkBg,
  edgeSoft: "rgba(148, 163, 184, 0.22)",
  edgeHot: "rgba(165, 180, 252, 0.75)",
  edgeDim: "rgba(148, 163, 184, 0.06)",
  labelFocus: "rgba(248, 250, 252, 0.95)",
} as const

const HIT_PAD = 8
const REBUILD_POLL_MS = 2500
/** 重建轮询上限（复审 NIT-5）：40 × 2.5s = 100s 后停轮询，诚实提示手动刷新。 */
const REBUILD_POLL_MAX = 40
const EMPTY_NODES: KnowledgeGraphNode[] = []
const EMPTY_EDGES: NonNullable<KnowledgeGraphSnapshot["edges"]> = []
const EMPTY_LABELS: KnowledgeGraphSnapshot["labels"] = {}

function radiusForDegree(deg: number): number {
  return Math.min(10, 5 + Math.sqrt(deg) * 1.4)
}

export function KnowledgeGraphApp() {
  const [snap, setSnap] = useState<KnowledgeGraphSnapshot | null>(null)
  const [colorMode, setColorMode] = useState<ColorMode>("group")
  const [llmEnabled, setLlmEnabled] = useState(false)
  const llmEnabledRef = useRef(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [hoverCaptionText, setHoverCaptionText] = useState("")
  const [panelOpen, setPanelOpen] = useState(true)
  const [query, setQuery] = useState("")
  const [groupFilter, setGroupFilter] = useState("")
  const [requestError, setRequestError] = useState("")

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<LayoutNode[]>([])
  const edgesRef = useRef<GraphDrawEdge[]>([])
  const dragRef = useRef<{ id: string; ox: number; oy: number; moved: boolean } | null>(null)
  const [organizing, setOrganizing] = useState(false)
  const confirmedOrganizingRef = useRef(false)
  const [relationOpen, setRelationOpen] = useState<KnowledgeGraphRelation | null>(null)
  const [tfAcked, setTfAcked] = useState(false)
  const [lockNotice, setLockNotice] = useState(false)
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
  const fitViewRef = useRef<() => void>(() => {})
  const captionByIdRef = useRef<Map<string, string>>(new Map())
  const titleByIdRef = useRef<Map<string, string>>(new Map())

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
    confirmedOrganizingRef.current = parsed.organizing === true
    setOrganizing(confirmedOrganizingRef.current)
    setRequestError("")
  }, [])

  const refresh = useCallback(() => {
    // Preserve the existing user-authorized naming preference. Default reads
    // never enable naming or organization on the user's behalf.
    chrome.runtime.sendMessage({ type: "knowledge_graph.refresh", llm_labels: llmEnabledRef.current }, (res) => {
      if (chrome.runtime.lastError || res?.ok === false || res?.sent === false) {
        setRequestError("无法连接 CMspark，请确认程序运行后刷新图谱。已有快照可继续浏览。")
      } else setRequestError("")
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    let receivedSnapshot = false
    ;(async () => {
      try {
        const pref = await chrome.storage.local.get([
          KNOWLEDGE_GRAPH_LLM_LABELS_KEY,
          KNOWLEDGE_GRAPH_TF_SWITCH_ACK_KEY,
        ])
        if (!cancelled) {
          llmEnabledRef.current = parseLlmLabelsPref(pref[KNOWLEDGE_GRAPH_LLM_LABELS_KEY])
          setLlmEnabled(llmEnabledRef.current)
          setTfAcked(parseTfSwitchAck(pref[KNOWLEDGE_GRAPH_TF_SWITCH_ACK_KEY]))
        }
      } catch {
        /* default off */
      }
      try {
        const res = await chrome.storage.session.get(KNOWLEDGE_GRAPH_SNAPSHOT_KEY)
        if (cancelled) return
        if (!receivedSnapshot) applySnap(res[KNOWLEDGE_GRAPH_SNAPSHOT_KEY])
      } catch {
        /* empty → rebuilding banner via null snap */
      }
      if (!cancelled) refresh()
    })()
    const onStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "session" && changes[KNOWLEDGE_GRAPH_SNAPSHOT_KEY]) {
        receivedSnapshot = true
        applySnap(changes[KNOWLEDGE_GRAPH_SNAPSHOT_KEY].newValue)
      }
      if (area === "local" && changes[KNOWLEDGE_GRAPH_LLM_LABELS_KEY]) {
        llmEnabledRef.current = parseLlmLabelsPref(changes[KNOWLEDGE_GRAPH_LLM_LABELS_KEY].newValue)
        setLlmEnabled(llmEnabledRef.current)
      }

    }
    chrome.storage.onChanged.addListener(onStorage)
    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(onStorage)
    }
  }, [applySnap, refresh])

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
      refresh()
    }
    const id = setInterval(tick, REBUILD_POLL_MS)
    return () => clearInterval(id)
  }, [status, refresh])

  const payloadNodes = snap?.nodes ?? EMPTY_NODES
  const payloadEdges = snap?.edges ?? EMPTY_EDGES
  const labels = snap?.labels ?? EMPTY_LABELS
  const view = useMemo(() => knowledgeGraphViewModel(snap), [snap])
  const { llmLane, showOrganizeCta, showReorganize, showNoRelations, relationsToDraw } = view
  const payloadRelations = relationsToDraw
  const llmReady = snap?.llm_ready !== false
  const showTfBanner =
    (status === "ok" || status === "over_cap") &&
    payloadNodes.length >= 20 &&
    (snap?.tf_switch_notice === true || (snap?.tf_switch_notice !== false && !tfAcked))

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

  const visibleNodes = useMemo(() => filterKnowledgeNodes(payloadNodes, query, groupFilter), [payloadNodes, query, groupFilter])
  const selected = payloadNodes.find((n) => n.id === focusId)
  useEffect(() => {
    if (!showCanvas) return
    if (focusId && !payloadNodes.some((n) => n.id === focusId)) setFocusId(null)
    if (groupFilter && !groupKeys.includes(groupFilter)) setGroupFilter("")
  }, [payloadNodes, groupKeys, focusId, groupFilter, showCanvas])

  useEffect(() => {
    const degree = new Map<string, number>()
    for (const n of payloadNodes) degree.set(n.id, 0)
    for (const e of payloadEdges) {
      degree.set(e.a, (degree.get(e.a) || 0) + 1)
      degree.set(e.b, (degree.get(e.b) || 0) + 1)
    }
    for (const r of payloadRelations) {
      degree.set(r.a, (degree.get(r.a) || 0) + 1)
      degree.set(r.b, (degree.get(r.b) || 0) + 1)
    }
    const ids = payloadNodes.map((n) => n.id)
    const radiusById = new Map(ids.map((id) => [id, radiusForDegree(degree.get(id) || 0)]))
    const { w, h } = sizeRef.current
    const previous = new Map(nodesRef.current.map((n) => [n.id, n]))
    nodesRef.current = seedLayoutNodes(ids, w, h, radiusById).map((n) => {
      const old = previous.get(n.id)
      return old ? { ...old, r: n.r } : n
    })
    const tfKeys = new Set(payloadEdges.map((e) => knowledgeGraphPairKey(e.a, e.b)))
    const reasonByPair = new Map<string, string>()
    for (const r of payloadRelations) {
      reasonByPair.set(knowledgeGraphPairKey(r.a, r.b), r.reason)
    }
    const drawn: GraphDrawEdge[] = payloadEdges.map((e) => ({
      a: e.a,
      b: e.b,
      score: e.score,
      reason: reasonByPair.get(knowledgeGraphPairKey(e.a, e.b)),
    }))
    for (const r of payloadRelations) {
      const k = knowledgeGraphPairKey(r.a, r.b)
      if (tfKeys.has(k)) continue
      drawn.push({ a: r.a, b: r.b, score: Math.max(0.08, r.confidence), dashed: true, reason: r.reason })
    }
    edgesRef.current = drawn
    simTicksRef.current = 0
    fittedRef.current = false
    userCameraRef.current = false
  }, [payloadNodes, payloadEdges, payloadRelations])

  useEffect(() => {
    const colors = new Map<string, string>()
    const captions = new Map<string, string>()
    for (const n of payloadNodes) {
      colors.set(n.id, nodeColor(n, colorMode))
      captions.set(n.id, hoverCaption(n, colorMode, labels))
    }
    colorByIdRef.current = colors
    captionByIdRef.current = captions
    titleByIdRef.current = new Map(payloadNodes.map((n) => [n.id, shortKnowledgeTitle(n.title, n.id, payloadNodes.length <= 20 ? 18 : 12)]))
  }, [payloadNodes, colorMode, labels])

  const openDoc = useCallback((id: string) => {
    setFocusId(id)
    setPanelOpen(true)
    chrome.runtime.sendMessage({ type: "knowledge_graph.open_doc", id }, () => {
      void chrome.runtime.lastError
    })
  }, [])

  const onActionResponse = useCallback((res: { ok?: boolean; sent?: boolean } | undefined) => {
    if (chrome.runtime.lastError || res?.ok === false || res?.sent === false) {
      setRequestError("请求未发送，请确认 CMspark 运行后重试。")
      return false
    }
    return true
  }, [])

  useEffect(() => {
    if (!organizing) return
    const timer = setTimeout(() => {
      setOrganizing(false)
      setRequestError("尚未收到整理结果，请刷新查看当前状态后重试。")
    }, 35_000)
    return () => clearTimeout(timer)
  }, [organizing])

  const onLlmChange = useCallback((enabled: boolean) => {
    llmEnabledRef.current = enabled
    setLlmEnabled(enabled)
    void writeLlmLabelsPref(enabled)
    chrome.runtime.sendMessage(
      { type: "knowledge_graph.refresh", llm_labels: enabled },
      onActionResponse,
    )
  }, [onActionResponse])

  const onRegenerate = useCallback(() => {
    chrome.runtime.sendMessage(
      { type: "knowledge_graph.refresh", llm_labels: true, regenerate: true },
      onActionResponse,
    )
  }, [onActionResponse])

  const sendOrganize = useCallback(() => {
    setOrganizing(true)
    chrome.runtime.sendMessage(
      { type: "knowledge_graph.refresh", organize: true, llm_labels: llmEnabled },
      (res) => { if (!onActionResponse(res)) setOrganizing(confirmedOrganizingRef.current) },
    )
  }, [llmEnabled, onActionResponse])

  const sendLock = useCallback((groupKey: string, unlock: boolean) => {
    chrome.runtime.sendMessage(
      {
        type: "knowledge_graph.refresh",
        llm_labels: llmEnabled,
        ...(unlock ? { unlock_group: groupKey } : { lock_group: groupKey }),
      },
      onActionResponse,
    )
  }, [llmEnabled, onActionResponse])

  useEffect(() => {
    if (snap?.lock_dissolved === true) setLockNotice(true)
  }, [snap?.lock_dissolved])

  useEffect(() => {
    if (!showTfBanner) return
    // 本会话继续展示；落盘 ack 让关 tab 重开不再出现（AC-6）。
    void writeTfSwitchAck()
    chrome.runtime.sendMessage({ type: "knowledge_graph.refresh", ack_tf_switch: true, llm_labels: llmEnabledRef.current }, () => {
      void chrome.runtime.lastError
    })
  }, [showTfBanner])

  const fitView = useCallback(() => {
    const { w, h } = sizeRef.current
    const camera = fitKnowledgeCamera(nodesRef.current, w, h)
    scaleRef.current = camera.scale
    panRef.current = { x: camera.x, y: camera.y }
    fittedRef.current = true
  }, [])
  fitViewRef.current = fitView

  const locateNode = useCallback((id: string) => {
    const n = nodesRef.current.find((node) => node.id === id)
    if (!n) return
    setFocusId(id)
    setPanelOpen(true)
    simTicksRef.current = 999
    userCameraRef.current = true
    scaleRef.current = Math.max(1, scaleRef.current)
    panRef.current = { x: sizeRef.current.w / 2 - n.x * scaleRef.current, y: sizeRef.current.h / 2 - n.y * scaleRef.current }
  }, [])

  const zoom = useCallback((factor: number) => {
    simTicksRef.current = 999
    const prev = scaleRef.current
    const next = Math.min(3.2, Math.max(0.08, prev * factor))
    const { w, h } = sizeRef.current
    panRef.current = { x: w / 2 - ((w / 2 - panRef.current.x) / prev) * next, y: h / 2 - ((h / 2 - panRef.current.y) / prev) * next }
    scaleRef.current = next
    userCameraRef.current = true
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")
    const resize = () => {
      const rect = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const previousSize = sizeRef.current
      sizeRef.current = { w: rect.width, h: rect.height }
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (userCameraRef.current) {
        // Preserve scale and the world point at the center during reflow.
        panRef.current.x += (rect.width - previousSize.w) / 2
        panRef.current.y += (rect.height - previousSize.h) / 2
      } else fitViewRef.current()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(parent)
    const draw = () => {
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const { w, h } = sizeRef.current
      const reduceMotion = motionPreference.matches
      for (let step = 0; step < (reduceMotion ? 320 : 6) && simTicksRef.current < 320 && nodesRef.current.length > 0; step++) {
        const e = forceLayoutTick(nodesRef.current, edgesRef.current, { width: w, height: h })
        simTicksRef.current++
        if ((e < 0.06 && simTicksRef.current > 50) || simTicksRef.current >= 320) {
          simTicksRef.current = 999
          if (!userCameraRef.current) fitViewRef.current()
        }
      }
      if (!userCameraRef.current && (!fittedRef.current || simTicksRef.current < 320)) fitViewRef.current()
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
        if (e.dashed) ctx.setLineDash([5 / Math.max(0.6, scale), 4 / Math.max(0.6, scale)])
        else ctx.setLineDash([])
        ctx.stroke()
        ctx.setLineDash([])
        if (e.dashed && (hot == null || isHot)) {
          const mx = (a.x + b.x) / 2
          const my = (a.y + b.y) / 2
          ctx.fillStyle = G.labelFocus
          ctx.font = `${9 / Math.max(0.75, Math.min(1.25, scale))}px ${tokens.font}`
          ctx.textAlign = "center"
          ctx.textBaseline = "bottom"
          ctx.fillText(KNOWLEDGE_GRAPH_AI_RELATION, mx, my - 2)
        }
      }
      const labelBoxes: { x: number; y: number; w: number; h: number }[] = []
      // Selected titles take priority; collisions only suppress canvas labels,
      // never the complete accessible knowledge list.
      const drawNodes = [...nodesRef.current].sort((a, b) => Number(b.id === active) - Number(a.id === active))
      for (const n of drawNodes) {
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
              ? hexWithAlpha(baseColor, 0.7)
              : baseColor
        ctx.globalAlpha = 1
        ctx.fill()
        ctx.globalAlpha = 1
        {
          ctx.fillStyle = dimmed ? tokens.darkMuted : G.labelFocus
          ctx.font = `${13 / scale}px ${tokens.font}`
          ctx.textAlign = "center"
          ctx.textBaseline = "top"
          const cap = titleByIdRef.current.get(n.id) || n.id
          const textWidth = ctx.measureText(cap).width * scale
          const sx = n.x * scale + panRef.current.x
          const sy = (n.y + n.r) * scale + panRef.current.y + 7
          const box = { x: sx - textWidth / 2, y: sy, w: textWidth, h: 17 }
          const overlaps = labelBoxes.some((b) => box.x < b.x + b.w + 8 && box.x + box.w + 8 > b.x && box.y < b.y + b.h + 4 && box.y + box.h + 4 > b.y)
          if ((isFocus || isHover || !overlaps) && box.x >= 2 && box.x + box.w <= w - 2 && sy + 17 < h) {
            labelBoxes.push(box)
            ctx.fillText(cap, n.x, n.y + n.r + 7 / scale)
          }
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
  }, [showCanvas])

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

  const hitTestEdge = (clientX: number, clientY: number): GraphDrawEdge | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scale = Math.max(0.001, scaleRef.current)
    const x = (clientX - rect.left - panRef.current.x) / scale
    const y = (clientY - rect.top - panRef.current.y) / scale
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]))
    const thresh = 6 / scale
    let best: GraphDrawEdge | null = null
    let bestD = thresh
    for (const e of edgesRef.current) {
      if (!e.reason && !e.dashed) continue
      const a = byId.get(e.a)
      const b = byId.get(e.b)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      if (len2 < 1) continue
      let t = ((x - a.x) * dx + (y - a.y) * dy) / len2
      t = Math.max(0, Math.min(1, t))
      const px = a.x + t * dx
      const py = a.y + t * dy
      const d = Math.hypot(x - px, y - py)
      if (d < bestD) {
        best = e
        bestD = d
      }
    }
    return best
  }

  const endDrag = (ev?: ReactPointerEvent) => {
    const drag = dragRef.current
    if (drag && drag.id !== "__pan__" && !drag.moved) {
      locateNode(drag.id)
    }
    if (drag && drag.id === "__pan__" && !drag.moved && ev) {
      const edge = hitTestEdge(ev.clientX, ev.clientY)
      if (edge?.reason) {
        setPanelOpen(true)
        setRelationOpen({
          a: edge.a,
          b: edge.b,
          reason: edge.reason,
          confidence: edge.score,
          ai: true,
        })
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
    simTicksRef.current = 999
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
      if (n) {
        setHoverCaptionText(captionByIdRef.current.get(n.id) || "")
      } else {
        const edge = hitTestEdge(ev.clientX, ev.clientY)
        setHoverCaptionText(
          edge?.reason
            ? `${edge.dashed ? KNOWLEDGE_GRAPH_AI_RELATION + " · " : ""}${edge.reason}`
            : "",
        )
      }
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
    simTicksRef.current = 999
    ev.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = ev.clientX - rect.left
    const my = ev.clientY - rect.top
    const prev = scaleRef.current
    const next = Math.min(3.2, Math.max(0.08, prev * (ev.deltaY > 0 ? 0.92 : 1.08)))
    panRef.current.x = mx - ((mx - panRef.current.x) / prev) * next
    panRef.current.y = my - ((my - panRef.current.y) / prev) * next
    scaleRef.current = next
    userCameraRef.current = true
  }

  const ungroupedKey = groupKeys.find((k) => k === "u:ungrouped" || k === "" || k === "ungrouped")
  const relatedEdges = useMemo<GraphDrawEdge[]>(() => selected ? [
    ...payloadEdges.map((e) => ({ ...e, reason: payloadRelations.find((r) => knowledgeGraphPairKey(r.a, r.b) === knowledgeGraphPairKey(e.a, e.b))?.reason })),
    ...payloadRelations.filter((r) => !payloadEdges.some((e) => knowledgeGraphPairKey(r.a, r.b) === knowledgeGraphPairKey(e.a, e.b))).map((r) => ({ ...r, score: r.confidence, dashed: true })),
  ].filter((e) => e.a === selected.id || e.b === selected.id) : [], [selected, payloadEdges, payloadRelations])

  return (
    <div className="kg-page" style={styles.page}>
      <style>{graphStyles}</style>
      <header className="kg-toolbar" role="toolbar" aria-label={`${KNOWLEDGE_GRAPH_ENTRY_LABEL}工具栏`}>
        <div className="kg-heading"><strong>{KNOWLEDGE_GRAPH_ENTRY_LABEL}</strong><span>{showCanvas ? knowledgeGraphBarMeta(payloadNodes.length, payloadEdges.length, payloadRelations.length) : "浏览知识与关联"}</span></div>
        <KnowledgeGraphColorSwitch mode={colorMode} onChange={setColorMode} />
        <button type="button" onClick={refresh}>刷新图谱</button>
        <button type="button" aria-expanded={panelOpen} onClick={() => setPanelOpen((v) => !v)}>{panelOpen ? "收起列表" : "浏览知识"}</button>
        <details className="kg-ai-options">
          <summary>AI 与分组</summary>
          <div>
            <KnowledgeGraphLlmSwitch enabled={llmEnabled} onChange={onLlmChange} onRegenerate={onRegenerate} />
            {showReorganize ? <KnowledgeGraphReorganizeButton organizing={organizing} disabled={!llmReady} onClick={sendOrganize} /> : null}
            {snap?.stale === true && llmLane ? <KnowledgeGraphStaleBadge /> : null}
          </div>
        </details>
        <button type="button" onClick={() => window.close()} title="关闭此标签页">关闭</button>
      </header>
      <div className="kg-notices">
        {requestError ? <div className="kg-notice" role="alert">{requestError}</div> : null}
        {status !== "ok" ? <KnowledgeGraphStatusView status={status} truncated={truncated} pollExhausted={pollExhausted} error={snap?.error} /> : null}
        {status === "ok" && showOrganizeCta ? <KnowledgeGraphOrganizeCta n={payloadNodes.length} disabled={!llmReady} organizing={organizing} onOrganize={sendOrganize} /> : null}
        {status === "ok" && snap?.organize_error ? <KnowledgeGraphOrganizeErrorBar error={snap.organize_error} onRetry={sendOrganize} /> : null}
        {showTfBanner ? <KnowledgeGraphTfSwitchBanner /> : null}
        {lockNotice ? <div className="kg-notice"><KnowledgeGraphLockDissolvedBanner /><button type="button" onClick={() => setLockNotice(false)}>知道了</button></div> : null}
      </div>
      <div className={`kg-workspace ${panelOpen ? "" : "kg-workspace-wide"}`}>
        <section className="kg-map" aria-label="知识关系画布">
          <div className="kg-map-tools">
            <span>实线：内容相似 · 虚线：AI 关联</span>
            <div>
              <button type="button" disabled={!showCanvas} onClick={() => { userCameraRef.current = false; fitView() }}>适应画布</button>
              <button type="button" disabled={!showCanvas} aria-label="放大" onClick={() => zoom(1.25)}>＋</button>
              <button type="button" disabled={!showCanvas} aria-label="缩小" onClick={() => zoom(0.8)}>－</button>
            </div>
          </div>
          <main style={styles.main}>
            {showCanvas ? <canvas ref={canvasRef} data-testid="knowledge-graph-canvas" style={styles.canvas} role="img" tabIndex={0}
              aria-label="知识分布图谱。点击节点查看关联；也可在知识列表搜索并定位。方向键平移，加减号缩放，0 适应画布。"
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(ev) => endDrag(ev)}
              onPointerLeave={() => { hoverIdRef.current = null; setHoverCaptionText("") }}
              onPointerCancel={() => { dragRef.current = null }}
              onWheel={onWheel}
              onKeyDown={(ev) => {
                if (ev.key === "0" || ev.key === "Home") { ev.preventDefault(); userCameraRef.current = false; fitView() }
                if (ev.key === "+" || ev.key === "=" || ev.key === "-") { ev.preventDefault(); zoom(ev.key === "-" ? 0.8 : 1.25) }
                const delta: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }
                if (delta[ev.key]) { ev.preventDefault(); simTicksRef.current = 999; userCameraRef.current = true; panRef.current.x += delta[ev.key][0]; panRef.current.y += delta[ev.key][1] }
                if (ev.key === "Escape") { setFocusId(null); setRelationOpen(null) }
              }}
            /> : <div className="kg-placeholder">知识文档和真实关联将在这里显示</div>}
          </main>
          <div className="kg-map-caption" role="status">
            {hoverCaptionText || (showCanvas && !payloadEdges.length && !payloadRelations.length ? "暂无明确关联，仍可浏览全部知识" : "拖动画布 · 滚轮缩放 · 点击知识查看关联")}
          </div>
        </section>
        {panelOpen ? (
          <aside className="kg-explorer" aria-label="知识浏览">
            <div className="kg-search">
              <label htmlFor="kg-search">浏览知识</label>
              <input id="kg-search" aria-label="搜索知识" placeholder="搜索标题、文件夹…" value={query} onChange={(ev) => setQuery(ev.target.value)} />
              <select aria-label="筛选分组" value={groupFilter} onChange={(ev) => setGroupFilter(ev.target.value)}>
                <option value="">全部分组</option>
                {groupKeys.map((k) => <option key={k} value={k}>{labels[k]?.name || (k === ungroupedKey ? KNOWLEDGE_GRAPH_UNGROUPED_LABEL : k)}</option>)}
              </select>
              <span role="status">{visibleNodes.length} / {payloadNodes.length} 篇知识</span>
            </div>
            {selected ? <section className="kg-selection" aria-label="选中知识">
              <div className="kg-selection-heading"><strong>{selected.title || selected.id}</strong><button type="button" aria-label="取消选中知识" onClick={() => setFocusId(null)}>取消</button></div>
              <p>{selected.folder || "未设置文件夹"}</p>
              <button type="button" onClick={() => openDoc(selected.id)}>在知识面板打开</button>
              <h3>相关知识 · {relatedEdges.length}</h3>
              {relatedEdges.length === 0 ? <p>暂无明确关联</p> : relatedEdges.map((edge) => {
                const id = edge.a === selected.id ? edge.b : edge.a
                const other = payloadNodes.find((node) => node.id === id)
                return <div key={id} className="kg-relation">
                  <button type="button" onClick={() => locateNode(id)}>{other?.title || id}</button>
                  <span>{edge.dashed ? "AI 关联" : "内容相似"}</span>
                  {edge.reason ? <p>AI 关联理由：{edge.reason}</p> : null}
                </div>
              })}
            </section> : null}
            {relationOpen ? <section className="kg-selection" aria-label="关联理由" data-testid="kg-relation-reason">
              <strong>{KNOWLEDGE_GRAPH_AI_RELATION}</strong><p>{relationOpen.reason}</p>
              <button type="button" onClick={() => setRelationOpen(null)}>{KNOWLEDGE_GRAPH_REASON_DISMISS}</button>
            </section> : null}
            <div className="kg-document-list" aria-label="知识列表">
              {visibleNodes.map((n) => <button type="button" key={n.id} data-node-id={n.id} aria-pressed={n.id === focusId} onClick={() => locateNode(n.id)}>
                <span className="kg-dot" style={{ background: nodeColor(n, colorMode) }} aria-hidden="true" />
                <span><strong>{n.title || n.id}</strong><small>{n.folder || labels[n.group_key]?.name || KNOWLEDGE_GRAPH_UNGROUPED_LABEL}</small></span>
              </button>)}
              {!visibleNodes.length ? <p>{payloadNodes.length ? "没有匹配的知识。可清空搜索或切换分组。" : "当前没有可浏览的知识。"}</p> : null}
              {(query || groupFilter) ? <button type="button" onClick={() => { setQuery(""); setGroupFilter("") }}>清除筛选</button> : null}
            </div>
            <details className="kg-groups" open={payloadNodes.length <= 19}>
              <summary>分组说明与管理 · {groupKeys.length}</summary>
              {showNoRelations ? <KnowledgeGraphNoRelationsNote /> : null}
              {groupKeys.map((k) => {
                const llmGroup = k.startsWith("l:")
                return <KnowledgeGraphGroupCard key={k} groupKey={k}
                  label={labels[k] || (k === ungroupedKey ? { name: KNOWLEDGE_GRAPH_UNGROUPED_LABEL, ai: false } : undefined)}
                  llmEnabled={llmEnabled} llmLaneGroup={llmGroup}
                  onLock={llmLane && llmGroup ? () => sendLock(k, false) : undefined}
                  onUnlock={llmGroup && labels[k]?.locked === true ? () => sendLock(k, true) : undefined} />
              })}
            </details>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100dvh", height: "100dvh", margin: 0, fontFamily: tokens.font, background: G.canvas, color: tokens.darkText, display: "flex", flexDirection: "column", overflow: "auto" },
  main: { position: "relative", flex: 1, minHeight: 280 },
  canvas: { width: "100%", height: "100%", position: "absolute", inset: 0, display: "block", cursor: "grab", touchAction: "none" },
}

const graphStyles = `
  html, body { margin: 0; background: ${G.canvas}; }
  .kg-page * { box-sizing: border-box; }
  .kg-page button, .kg-page input, .kg-page select, .kg-page summary { font: inherit; font-size: 13px; }
  .kg-page button { min-height: 32px; border: 1px solid ${tokens.darkBorder}; background: transparent; color: ${tokens.darkText}; border-radius: 8px; padding: 5px 10px; cursor: pointer; }
  .kg-page button:disabled { opacity: .45; cursor: not-allowed; }
  .kg-page button:hover:not(:disabled), .kg-page button[aria-pressed=true] { background: ${tokens.darkElevated}; }
  .kg-page :focus-visible { outline: 2px solid ${tokens.darkMuted}; outline-offset: 2px; }
  .kg-page summary { cursor: pointer; padding: 8px 0; }
  .kg-toolbar { padding: 16px 20px; border-bottom: 1px solid ${tokens.darkBorder}; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; flex-shrink: 0; }
  .kg-heading { display: flex; flex-direction: column; gap: 4px; margin-right: auto; }
  .kg-heading strong { font-size: 18px; }
  .kg-heading span, .kg-search>span { color: ${tokens.darkMuted}; font-size: 12px; }
  .kg-ai-options[open] { flex-basis: 100%; order: 2; }
  .kg-ai-options>div { display: flex; flex-wrap: wrap; gap: 12px; padding: 8px 0; }
  .kg-notices { flex-shrink: 0; max-height: 30dvh; overflow: auto; background: ${tokens.darkElevated}; }
  .kg-notice { padding: 12px 16px; font-size: 13px; }
  .kg-workspace { display: grid; grid-template-columns: minmax(0,1fr) 320px; flex: 1; min-height: 400px; }
  .kg-workspace-wide { grid-template-columns: minmax(0,1fr); }
  .kg-map { display: flex; flex-direction: column; min-width: 0; min-height: 360px; }
  .kg-map-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px; }
  .kg-map-tools span, .kg-map-caption { color: ${tokens.darkMuted}; font-size: 12px; line-height: 1.5; }
  .kg-map-tools>div { display: flex; gap: 6px; }
  .kg-map-caption { padding: 8px 16px 12px; min-height: 38px; overflow-wrap: anywhere; }
  .kg-placeholder { height: 100%; display: grid; place-items: center; color: ${tokens.darkMuted}; padding: 24px; text-align: center; }
  .kg-explorer { overflow: auto; border-left: 1px solid ${tokens.darkBorder}; padding: 16px; min-width: 0; }
  .kg-search { display: grid; gap: 10px; margin-bottom: 16px; position: sticky; top: 0; z-index: 1; background: ${G.canvas}; padding-bottom: 8px; }
  .kg-search label { font-size: 14px; font-weight: 600; }
  .kg-search input, .kg-search select { width: 100%; min-width: 0; min-height: 36px; background: ${tokens.darkElevated}; color: ${tokens.darkText}; border: 1px solid ${tokens.darkBorder}; border-radius: 8px; padding: 8px; }
  .kg-document-list>button { width: 100%; display: flex; gap: 10px; align-items: center; text-align: left; border-color: transparent; padding: 10px 8px; }
  .kg-document-list strong { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
  .kg-document-list small { display: block; color: ${tokens.darkMuted}; font-size: 12px; margin-top: 4px; overflow-wrap: anywhere; }
  .kg-document-list p, .kg-selection p { font-size: 13px; line-height: 1.6; color: ${tokens.darkMuted}; overflow-wrap: anywhere; }
  .kg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .kg-selection { padding: 12px; border: 1px solid ${tokens.darkBorder}; border-radius: 10px; margin-bottom: 12px; }
  .kg-selection-heading { display: flex; align-items: start; gap: 8px; }
  .kg-selection-heading strong { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; }
  .kg-selection h3 { font-size: 13px; margin: 16px 0 8px; }
  .kg-relation { margin-top: 10px; }
  .kg-relation>button { display: block; text-align: left; overflow-wrap: anywhere; max-width: 100%; }
  .kg-relation>span { display: block; font-size: 12px; color: ${tokens.darkMuted}; margin-top: 4px; }
  .kg-groups { margin-top: 16px; border-top: 1px solid ${tokens.darkBorder}; }
  @media(max-width: 759px) {
    .kg-toolbar { padding: 12px; gap: 8px; }
    .kg-heading { flex-basis: 100%; }
    .kg-workspace, .kg-workspace-wide { display: flex; flex-direction: column; flex: none; min-height: 0; }
    .kg-map { height: 440px; flex-shrink: 0; }
    .kg-explorer { border-left: none; border-top: 1px solid ${tokens.darkBorder}; overflow: visible; }
  }
`
