import { ComputerError, type ComputerErrorCode } from "./types"

export const COMPANION_UI_CLICK_DENIED = "COMPANION_UI_CLICK_DENIED" as const satisfies ComputerErrorCode

export type CompanionUiSurface = "overlay" | "hud" | "tray" | "pairing"

export type CompanionUiRect = {
  surface: CompanionUiSurface
  x: number
  y: number
  width: number
  height: number
}

const rects = new Map<CompanionUiSurface, CompanionUiRect>()

export function clearCompanionUiRects(): void {
  rects.clear()
}

const SURFACES = new Set<CompanionUiSurface>(["overlay", "hud", "tray", "pairing"])
const MAX_RECT_EDGE = 8192

export function applyCompanionUiRectEvent(
  raw: unknown,
  opts?: { allowSurfaces?: ReadonlySet<string> },
): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false
  const o = raw as Record<string, unknown>
  if (o.type !== "companion.ui.rect") return false
  const surface = o.surface
  if (typeof surface !== "string" || !SURFACES.has(surface as CompanionUiSurface)) return false
  const allow = opts?.allowSurfaces ?? SURFACES
  if (!allow.has(surface)) return false
  const s = surface as CompanionUiSurface
  if (o.hidden === true) {
    setCompanionUiRect({ surface: s, hidden: true })
    return true
  }
  const x = Number(o.x)
  const y = Number(o.y)
  const width = Number(o.width)
  const height = Number(o.height)
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return false
  if (width > MAX_RECT_EDGE || height > MAX_RECT_EDGE) return false
  setCompanionUiRect({ surface: s, x, y, width, height })
  return true
}

export function setCompanionUiRect(
  next: CompanionUiRect | { surface: CompanionUiSurface; hidden: true },
): void {
  if ("hidden" in next && next.hidden) {
    rects.delete(next.surface)
    return
  }
  const r = next as CompanionUiRect
  if (!(r.width > 0 && r.height > 0)) {
    rects.delete(r.surface)
    return
  }
  rects.set(r.surface, r)
}

export function getCompanionUiRects(): CompanionUiRect[] {
  return [...rects.values()]
}

export function screenPointHitsCompanionUi(x: number, y: number): CompanionUiSurface | null {
  for (const r of rects.values()) {
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) {
      return r.surface
    }
  }
  return null
}

export function assertClickClearsCompanionUi(screenX: number, screenY: number): void {
  const hit = screenPointHitsCompanionUi(screenX, screenY)
  if (!hit) return
  throw new ComputerError(
    COMPANION_UI_CLICK_DENIED,
    `computer: click lands on ${hit} — hard-denied (S23)`,
    { surface: hit, x: screenX, y: screenY },
  )
}
