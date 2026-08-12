// Hand-rolled 2D force layout for thread graph (no d3-force — bundle budget).
// Spec: docs/superpowers/specs/2026-08-11-thread-graph-obsidian-view-design.md §4.3

export type LayoutNode = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Mass / size scale (degree-based). */
  r: number
  pinned?: boolean
}

export type LayoutEdge = {
  a: string
  b: string
  score: number
}

export type ForceLayoutOpts = {
  width: number
  height: number
  /** Coulomb-like repulsion strength. */
  repulsion?: number
  /** Spring rest length base (px). */
  springLength?: number
  /** Spring stiffness. */
  springK?: number
  /** Pull toward canvas center. */
  centerG?: number
  /** Velocity damping 0..1. */
  damping?: number
  /** Max |velocity| per tick. */
  maxV?: number
}

// Tighter defaults → denser clusters closer to Obsidian local graph (not sparse giant cards).
const DEFAULTS = {
  repulsion: 1600,
  springLength: 52,
  springK: 0.028,
  centerG: 0.014,
  damping: 0.84,
  maxV: 10,
}

/** Place nodes on a ring so the first frame is not a single pile. */
export function seedLayoutNodes(
  ids: string[],
  width: number,
  height: number,
  radiusById?: Map<string, number>,
): LayoutNode[] {
  const cx = width / 2
  const cy = height / 2
  const n = Math.max(1, ids.length)
  const ring = Math.min(width, height) * 0.22
  return ids.map((id, i) => {
    const ang = (i / n) * Math.PI * 2 + 0.2
    const jitter = ((i * 17) % 7) - 3
    return {
      id,
      x: cx + Math.cos(ang) * (ring + jitter),
      y: cy + Math.sin(ang) * (ring + jitter),
      vx: 0,
      vy: 0,
      r: radiusById?.get(id) ?? 4.5,
      pinned: false,
    }
  })
}

/**
 * One simulation step. Mutates nodes in place.
 * Returns mean |v| as energy proxy (for stop condition).
 */
export function forceLayoutTick(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: ForceLayoutOpts,
): number {
  const width = opts.width
  const height = opts.height
  const repulsion = opts.repulsion ?? DEFAULTS.repulsion
  const springLength = opts.springLength ?? DEFAULTS.springLength
  const springK = opts.springK ?? DEFAULTS.springK
  const centerG = opts.centerG ?? DEFAULTS.centerG
  const damping = opts.damping ?? DEFAULTS.damping
  const maxV = opts.maxV ?? DEFAULTS.maxV

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const cx = width / 2
  const cy = height / 2

  // Repulsion (all pairs) — O(n²) OK for n≤300
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let dist2 = dx * dx + dy * dy
      if (dist2 < 0.01) {
        dx = (Math.random() - 0.5) * 0.5
        dy = (Math.random() - 0.5) * 0.5
        dist2 = dx * dx + dy * dy
      }
      const dist = Math.sqrt(dist2)
      const minDist = a.r + b.r + 10
      const force = repulsion / dist2
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      if (!a.pinned) {
        a.vx -= fx
        a.vy -= fy
      }
      if (!b.pinned) {
        b.vx += fx
        b.vy += fy
      }
      // Soft collision — keep dots from stacking (visual r is tiny)
      if (dist < minDist) {
        const push = ((minDist - dist) / dist) * 0.45
        if (!a.pinned) {
          a.x -= dx * push
          a.y -= dy * push
        }
        if (!b.pinned) {
          b.x += dx * push
          b.y += dy * push
        }
      }
    }
  }

  // Springs along edges
  for (const e of edges) {
    const a = byId.get(e.a)
    const b = byId.get(e.b)
    if (!a || !b) continue
    let dx = b.x - a.x
    let dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
    const rest = springLength / (0.6 + e.score) // stronger link → shorter
    const disp = dist - rest
    const f = springK * disp
    const fx = (dx / dist) * f
    const fy = (dy / dist) * f
    if (!a.pinned) {
      a.vx += fx
      a.vy += fy
    }
    if (!b.pinned) {
      b.vx -= fx
      b.vy -= fy
    }
  }

  // Center gravity + integrate
  let energy = 0
  for (const n of nodes) {
    if (!n.pinned) {
      n.vx += (cx - n.x) * centerG
      n.vy += (cy - n.y) * centerG
      n.vx *= damping
      n.vy *= damping
      const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
      if (sp > maxV) {
        n.vx = (n.vx / sp) * maxV
        n.vy = (n.vy / sp) * maxV
      }
      n.x += n.vx
      n.y += n.vy
      // Soft wall — clamp pad so tiny viewports don't collapse all nodes to a line
      const padX = Math.min(Math.max(24, n.r + 16), Math.max(4, width / 4))
      const padY = Math.min(Math.max(24, n.r + 16), Math.max(4, height / 4))
      n.x = Math.max(padX, Math.min(width - padX, n.x))
      n.y = Math.max(padY, Math.min(height - padY, n.y))
      energy += Math.sqrt(n.vx * n.vx + n.vy * n.vy)
    }
  }
  return nodes.length ? energy / nodes.length : 0
}

/** Run up to maxTicks or until energy < stopEnergy. Returns final energy. */
export function runForceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: ForceLayoutOpts,
  maxTicks = 280,
  stopEnergy = 0.08,
): number {
  let e = Infinity
  for (let t = 0; t < maxTicks; t++) {
    e = forceLayoutTick(nodes, edges, opts)
    if (e < stopEnergy && t > 40) break
  }
  return e
}
