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

/**
 * Normalize only the case-insensitive parts of the URL: scheme and host are
 * lowercased (via URL parsing) and trailing slashes are stripped. The path
 * keeps its original case — some gateways route on case-sensitive paths.
 * Unparsable input falls back to the trimmed string (still exact-matched).
 */
export function normalizeProbeUrl(url: string): string {
  const trimmed = String(url || "").trim().replace(/\/+$/, "")
  if (!trimmed) return trimmed
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`)
    const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ""}@` : ""
    const path = u.pathname === "/" ? "" : u.pathname
    return `${u.protocol}//${auth}${u.host}${path}${u.search}${u.hash}`
  } catch {
    return trimmed
  }
}

/**
 * Model names keep their original case — case-sensitive serving stacks
 * (e.g. vLLM served-model-name) treat `MyModel` and `mymodel` as different
 * models, so folding case here would let one model's probe poison another's.
 */
export function normalizeProbeModel(model: string): string {
  return String(model || "").trim()
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
