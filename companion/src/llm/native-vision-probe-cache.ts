/**
 * In-memory image-probe result from config.test.
 * Bound to {url, model} — never written to config.json.
 */

export type NativeVisionProbeEntry = {
  url: string
  model: string
  detected: boolean
}

let cache: NativeVisionProbeEntry | null = null

export function normalizeProbeUrl(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "").toLowerCase()
}

export function normalizeProbeModel(model: string): string {
  return String(model || "").trim().toLowerCase()
}

export function rememberNativeVisionProbe(url: string, model: string, detected: boolean): void {
  cache = {
    url: normalizeProbeUrl(url),
    model: normalizeProbeModel(model),
    detected: detected === true,
  }
}

/** Exact url+model match only. Mismatch / empty cache → undefined. */
export function lookupNativeVisionProbe(url: string, model: string): boolean | undefined {
  if (!cache) return undefined
  if (cache.url !== normalizeProbeUrl(url)) return undefined
  if (cache.model !== normalizeProbeModel(model)) return undefined
  return cache.detected
}

export function clearNativeVisionProbe(): void {
  cache = null
}
