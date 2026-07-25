// v4 Defect 3 (Grok v4 §4.3 / Pi v4.1 RESOLVED) — Coordinate space conversions.
//
// Canonical space: **client-logical points of the target window**.
//   - Origin: top-left of client area (content below title bar), y-down.
//   - Bounds: [0, client.width) × [0, client.height).
//   - Tool schema, bounds check, evidence seals, LLM instructions all speak C.
//
// Other spaces in the pipeline:
//   - S0 Screen global: CGWindowList bounds, AX position. Used by UIA locate
//     hits and by CGEvent mouseCursorPosition in the SkyLight post path.
//   - S1 Image pixels: PNG from ScreenCaptureKit. On Retina, typically 2× S0.
//     Used by OCR word boxes, TinyClick, pixel diff, evidence preview.
//
// All cross-space conversions route through this module. Adding a new
// conversion site without going through `coords.ts` is a violation of the
// v4 contract — it re-opens the (722, 872) class of bugs.
//
// References:
//   - docs/decisions/v1.3/plan-approach-c-minus-v4-grok.md §4
//   - docs/decisions/v1.3/plan-approach-c-minus-v4-1-grok.md (variance classifier)
//   - docs/decisions/v1.3/review-pi-plan-v4-1.txt (Pi RESOLVED verdict)

import type { RectPx } from "./types"

export interface PointClient {
  x: number
  y: number
}

export interface PointImage {
  x: number
  y: number
}

export interface PointScreen {
  x: number
  y: number
}

export interface CoordScales {
  imageWidth: number
  imageHeight: number
  scaleX: number
  scaleY: number
}

/**
 * Image-pixel point → client-logical point.
 *
 * `clientLogical` is the client area rectangle in **client-logical** space
 * (the canonical C space, matching `shot.client` from CaptureMeta). On a
 * typical macOS window with no title-bar-stripping, `client.x` is 0 and
 * `client.y` is the title-bar height; AX reports these in logical points.
 *
 * For a point that came from OCR word boxes or TinyClick output (S1 image
 * px), this converts to the canonical C space used by the bounds check and
 * the tool schema.
 *
 * Math: `p.x / sx - client.x` is equivalent to `(p.x - client.x * sx) / sx`
 * — we keep the parameter in logical space so callers pass `shot.client`
 * directly without pre-multiplying.
 */
export function imageToClient(
  p: PointImage,
  scales: CoordScales,
  clientLogical: RectPx,
): PointClient {
  const sx = scales.scaleX > 0 ? scales.scaleX : 1
  const sy = scales.scaleY > 0 ? scales.scaleY : 1
  return {
    x: p.x / sx - clientLogical.x,
    y: p.y / sy - clientLogical.y,
  }
}

/**
 * Client-logical point → screen-global point (S0).
 *
 * Used before posting a CGEvent via SLEventPostToPid: the SkyLight primitive
 * expects global screen coordinates. `rect` is the window's screen rect;
 * `clientScreenOffset` is the client area's offset within the window in
 * screen-logical points (typically title-bar height for the y component).
 *
 * Single conversion site for the inject path — do not also offset in
 * host.swift (would double-apply). Host documents "expects global screen
 * points" in cuInject.
 */
export function clientToScreen(
  p: PointClient,
  rect: RectPx,
  clientScreenOffset: { x: number; y: number },
): PointScreen {
  return {
    x: rect.x + clientScreenOffset.x + p.x,
    y: rect.y + clientScreenOffset.y + p.y,
  }
}

/**
 * Screen-global point (S0) → client-logical point.
 *
 * Used for UIA locate hits (which report screen coords) so they can be
 * compared against client-logical bounds and stored in C space.
 */
export function screenToClient(
  p: PointScreen,
  rect: RectPx,
  clientScreenOffset: { x: number; y: number },
): PointClient {
  return {
    x: p.x - rect.x - clientScreenOffset.x,
    y: p.y - rect.y - clientScreenOffset.y,
  }
}

/**
 * Detect whether a raw LLM-supplied point is in image-pixel space (S1) rather
 * than client-logical (C). Used by the v4 autoscale compatibility crutch.
 *
 * Heuristic: if the raw point is outside C bounds but `raw / scale` falls
 * inside C bounds, the LLM likely used image pixels. Returns the scaled point
 * when the classification is unique (both orientations cannot be in bounds
 * simultaneously), or null when ambiguous / definitely OOB.
 *
 * Pi v4.1 caveat (R5): autoscale must NOT trigger on swap (x/y reversed)
 * because that would silently misroute clicks. Only trigger on clear
 * retina-scale mismatch.
 */
export function maybeAutoscaleImageToClient(
  raw: PointClient,
  scales: CoordScales,
  clientLogical: RectPx,
): { scaled: PointClient; reason: "retina-scale" } | null {
  const cw = clientLogical.width
  const ch = clientLogical.height
  if (cw <= 0 || ch <= 0) return null

  const inClient = (p: PointClient) =>
    p.x >= 0 && p.y >= 0 && p.x < cw && p.y < ch

  if (inClient(raw)) return null // already in C — no scaling needed

  const sx = scales.scaleX > 0 ? scales.scaleX : 1
  const sy = scales.scaleY > 0 ? scales.scaleY : 1
  if (sx === 1 && sy === 1) return null // no Retina — not a scale mismatch

  const scaled: PointClient = { x: raw.x / sx, y: raw.y / sy }
  if (!inClient(scaled)) return null // even scaled is OOB — true OOB, not autoscale

  // Pi R5: ensure the swap orientation is NOT also in bounds. If both
  // (raw.x/sx, raw.y/sy) and (raw.y/sy, raw.x/sx) land in C, classify as
  // ambiguous and refuse autoscale.
  const swapped: PointClient = { x: raw.y / sy, y: raw.x / sx }
  if (inClient(swapped)) return null

  return { scaled, reason: "retina-scale" }
}

/**
 * D4.2 (Grok v4.1 §4.2 / Pi v4.1 RESOLVED): max-axis drift between two rects.
 * Returns the largest absolute delta across {x, y, width, height}. Used by
 * executor's post-locate M8 drift check and by locate-chain's rect0
 * re-validation guard.
 *
 * Max-axis (not sum / euclidean) so the threshold semantics match
 * WITNESS_TOLERANCE_PX (8) — a single axis crossing 8px is enough to flag,
 * regardless of what the other three did. Avoids the case where x shifts 5
 * and y shifts 5 (sum 10, euclidean 7.07) — both readings would mask a real
 * resize on one axis only.
 */
export function rectDriftPx(a: RectPx, b: RectPx): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  )
}
