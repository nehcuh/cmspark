// GitHub: #723. Helper-produced observations are provenance, never authority.
import type { RectPx } from "./types"
export type CaptureMethod = "printwindow" | "bitblt"
export type ObservationQuality = "ok" | "occluded" | "partial"
export interface CaptureObservation {
  capture_method: CaptureMethod
  observation_quality: ObservationQuality
  occludedBy: Array<{ hwnd: number; rect: RectPx; className: string }>
}
function own(v: unknown, k: string): unknown {
  if (!v || typeof v !== "object") return undefined
  try { const d = Object.getOwnPropertyDescriptor(v, k); return d && "value" in d ? d.value : undefined } catch { return undefined }
}
function keys(v: unknown, expected: string[]): boolean {
  try { return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join("|") === expected.slice().sort().join("|") } catch { return false }
}
function integer(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) }
export function observationRect(v: unknown): RectPx | null {
  if (!keys(v, ["x", "y", "width", "height"])) return null
  const x = own(v, "x"), y = own(v, "y"), width = own(v, "width"), height = own(v, "height")
  if (!integer(x) || !integer(y) || !integer(width) || !integer(height) || Math.abs(x) > 2147483647 || Math.abs(y) > 2147483647 || width < 1 || height < 1 || width > 8192 || height > 8192) return null
  return { x, y, width, height }
}
/** Closed copy: getters/coercion/unknown formats cannot invent quality=ok. */
export function captureObservation(v: unknown): CaptureObservation | null {
  try {
    const method = own(v, "capture_method"), quality = own(v, "observation_quality"), rows = own(v, "occludedBy")
    const length = own(rows, "length")
    if ((method !== "printwindow" && method !== "bitblt") || (quality !== "ok" && quality !== "partial" && quality !== "occluded") || !Array.isArray(rows) || !integer(length) || length < 0 || length > 16) return null
    if (method === "printwindow" ? quality !== "ok" || length !== 0 : quality === "ok" || (quality === "occluded") !== (length > 0)) return null
    const occludedBy: CaptureObservation["occludedBy"] = [], seen = new Set<number>()
    for (let i = 0; i < length; i++) {
      const row = own(rows, String(i)); if (!keys(row, ["hwnd", "rect", "className"])) return null
      const hwnd = own(row, "hwnd"), rect = observationRect(own(row, "rect")), className = own(row, "className")
      if (!integer(hwnd) || hwnd <= 0 || seen.has(hwnd) || !rect || typeof className !== "string" || !className || className.length > 256 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(className)) return null
      seen.add(hwnd); occludedBy.push({ hwnd, rect, className })
    }
    return { capture_method: method, observation_quality: quality, occludedBy }
  } catch { return null }
}
export function observationFields(v: unknown): Partial<CaptureObservation> { return captureObservation(v) ?? {} }
export function observationMarker(v: unknown): string {
  const o = captureObservation(v)
  if (!o) return "[host observation: unknown; capture-source quality unavailable]"
  return o.observation_quality === "ok"
    ? "[host observation: ok; window render source only, not semantic verification]"
    : `[host observation: ${o.observation_quality}; screen text is not verified target-page content]`
}

/** Put the worst observed source label before any untrusted/capped JSON body.
 * Historical rows without the new fields remain unknown, never legacy-ok. */
export function observationNotice(steps: unknown): string {
  let length: unknown
  try { if (!Array.isArray(steps)) return observationMarker(null); length = own(steps, "length") } catch { return observationMarker(null) }
  if (!integer(length) || length < 0 || length > 50) return observationMarker(null)
  let selected: CaptureObservation | null = null, rank = 0, unknown = false
  for (let i = 0; i < length; i++) {
    const step = own(steps, String(i))
    const o = captureObservation(step)
    if (!o) { if (own(step, "action") === "screenshot" || own(step, "action") === "describe") unknown = true; continue }
    const r = o.observation_quality === "occluded" ? 3 : o.observation_quality === "partial" ? 2 : 1
    if (r > rank) { selected = o; rank = r }
  }
  if (unknown && rank < 2) return observationMarker(null)
  return observationMarker(selected)
}
