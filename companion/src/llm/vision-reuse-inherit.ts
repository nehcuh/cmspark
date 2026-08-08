// Schema-free vision key inherit when vision endpoint matches main LLM.
// Multi-adversarial lock (2026-08-08): Q2 server inherit — no new config fields.
// Called from saveConfig after deepMerge + key resolve.

export const VISION_PLACEHOLDER_KEYS = new Set(["", "ollama"])

export function normalizeEndpointUrl(url: string | undefined | null): string {
  if (!url) return ""
  return url.trim().replace(/\/+$/, "").toLowerCase()
}

export function isPlaceholderVisionKey(key: string | undefined | null): boolean {
  const k = (key || "").trim()
  if (!k) return true
  if (VISION_PLACEHOLDER_KEYS.has(k.toLowerCase())) return true
  // Defense-in-depth: treat UI/wire masks as non-keys (normal paths strip these earlier)
  if (k === "***" || /^\*+$/.test(k) || k.includes("****")) return true
  return false
}

export function endpointsMatch(
  a: { base_url?: string; model_name?: string },
  b: { base_url?: string; model_name?: string },
): boolean {
  const au = normalizeEndpointUrl(a.base_url)
  const bu = normalizeEndpointUrl(b.base_url)
  if (!au || !bu || au !== bu) return false
  const am = (a.model_name || "").trim().toLowerCase()
  const bm = (b.model_name || "").trim().toLowerCase()
  if (!am || !bm) return false
  return am === bm
}

/**
 * If vision url+model equal llm and vision key is empty/placeholder,
 * copy llm.api_key into vision (when llm key is a real non-masked value).
 * Returns new vision.api_key or undefined if no change.
 *
 * Dual-review nit (Pi): do not inherit when main LLM protocol is Anthropic Messages —
 * vision-pipeline is OpenAI chat.completions only. OpenAI-compatible gateways that
 * use a claude-* *model name* with protocol=openai still inherit (intended).
 */
export function resolveInheritedVisionApiKey(opts: {
  llmBaseUrl?: string
  llmModelName?: string
  llmApiKey?: string
  /** When "anthropic", never inherit (vision rail cannot speak Messages protocol). */
  llmProtocol?: string
  visionBaseUrl?: string
  visionModelName?: string
  visionApiKey?: string
}): string | undefined {
  if ((opts.llmProtocol || "openai") === "anthropic") return undefined

  const llmKey = (opts.llmApiKey || "").trim()
  if (!llmKey || isPlaceholderVisionKey(llmKey)) return undefined

  if (
    !endpointsMatch(
      { base_url: opts.llmBaseUrl, model_name: opts.llmModelName },
      { base_url: opts.visionBaseUrl, model_name: opts.visionModelName },
    )
  ) {
    return undefined
  }

  if (!isPlaceholderVisionKey(opts.visionApiKey)) return undefined
  return llmKey
}

/** True if hostname is loopback / local (Ollama default path). */
export function isLoopbackVisionHost(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return false
  try {
    const u = new URL(baseUrl.includes("://") ? baseUrl : `http://${baseUrl}`)
    const h = u.hostname.toLowerCase()
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0"
  } catch {
    return /localhost|127\.0\.0\.1/i.test(baseUrl)
  }
}

/**
 * Fail closed before HTTP POST: non-loopback + placeholder key must not send image bytes.
 */
export function shouldBlockVisionRequest(opts: {
  baseUrl?: string
  apiKey?: string
}): { block: boolean; reason?: string } {
  const key = opts.apiKey
  if (!isPlaceholderVisionKey(key)) return { block: false }
  if (isLoopbackVisionHost(opts.baseUrl)) return { block: false }
  return {
    block: true,
    reason:
      "Vision API key is empty or placeholder (ollama) but base_url is not loopback. " +
      "Refusing to POST image data. Set a real vision API key or reuse main LLM key.",
  }
}
