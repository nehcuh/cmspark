// Vision pipeline — local vision model integration for screenshot/image analysis

import OpenAI from "openai"
import * as crypto from "crypto"
import type { VisionConfig } from "../config"
import { logger } from "../logger"
import { sniffRasterImage } from "./image-sniff"
import { shouldBlockVisionRequest } from "./vision-reuse-inherit"

const DEFAULT_VISION_PROMPT =
  "You are a browser screenshot analyzer. Describe what you see in this image in detail. Include: " +
  "1) The overall page layout and purpose, " +
  "2) Visible text content and headings, " +
  "3) Interactive elements like buttons, links, and forms, " +
  "4) Any error messages or alerts, " +
  "5) The current state of any visible data or content. " +
  "Be precise and factual. Respond in the same language as the visible content."

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024 // 20MB
const MAX_CACHE_SIZE = 50

export interface VisionResult {
  description: string
  cached: boolean
  model_used: string
  latency_ms: number
}

interface CacheEntry {
  description: string
  model_used: string
  timestamp: number
}

// LRU cache keyed by SHA-256 hash of base64 data
const cache = new Map<string, CacheEntry>()

// Dedup map for concurrent requests
const inflight = new Map<string, Promise<VisionResult>>()

function hashBase64(base64: string): string {
  return crypto.createHash("sha256").update(base64).digest("hex")
}

function getCached(key: string, ttlSeconds: number): CacheEntry | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > ttlSeconds * 1000) {
    cache.delete(key)
    return null
  }
  // Move to end (LRU refresh)
  cache.delete(key)
  cache.set(key, entry)
  return entry
}

function setCache(key: string, description: string, modelUsed: string): void {
  cache.set(key, { description, model_used: modelUsed, timestamp: Date.now() })
  // Evict oldest entries if over limit
  while (cache.size > MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) cache.delete(firstKey)
  }
}

export interface ImageInput {
  base64: string
  width: number
  height: number
  url: string
  title: string
}

/** Omit `NxNpx` when either edge is missing/zero — never interpolate 0x0. */
export function formatVisionFallbackDims(width?: number, height?: number): string {
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    return `, ${width}x${height}px`
  }
  return ""
}

/** Subject line for vision fallback. Omit empty `(url)` and `0x0px`. */
export function formatVisionFallbackSubject(title: string, url: string, width?: number, height?: number): string {
  const loc = url ? ` (${url})` : ""
  return `Screenshot of "${title}"${loc}${formatVisionFallbackDims(width, height)}`
}

/**
 * Build the vision data URL from sniffed magic bytes only.
 * Returns null when the payload is not PNG/JPEG/GIF/WebP — never wrap
 * SVG/HTML/unknown as jpeg, never trust a declared mime.
 */
export function visionImageDataUrl(image: { base64: string }): string | null {
  let sniffed: ReturnType<typeof sniffRasterImage> = null
  try {
    sniffed = sniffRasterImage(Buffer.from(image.base64, "base64"))
  } catch {
    sniffed = null
  }
  if (!sniffed) return null
  return `data:${sniffed};base64,${image.base64}`
}

export async function analyzeImage(
  image: ImageInput,
  config: VisionConfig,
  customPrompt?: string,
  signal?: AbortSignal,
): Promise<VisionResult> {
  const key = hashBase64(image.base64)

  // Check cache
  const cached = getCached(key, config.cache_ttl_seconds)
  if (cached) {
    return { description: cached.description, cached: true, model_used: cached.model_used, latency_ms: 0 }
  }

  // Check dedup — if same image is already being analyzed, wait for it
  const existing = inflight.get(key)
  if (existing) return existing

  // Check image size
  const decodedSize = Math.ceil(image.base64.length * 0.75)
  if (decodedSize > MAX_IMAGE_SIZE_BYTES) {
    logger.warn("vision.image_too_large", { size_mb: Math.round(decodedSize / 1024 / 1024) })
    return buildFallback(image, config, "Image too large for local model")
  }

  const promise = doAnalyze(image, config, key, customPrompt, signal)
  inflight.set(key, promise)

  try {
    return await promise
  } finally {
    inflight.delete(key)
  }
}

async function doAnalyze(
  image: ImageInput,
  config: VisionConfig,
  cacheKey: string,
  customPrompt?: string,
  signal?: AbortSignal,
): Promise<VisionResult> {
  const startTime = Date.now()

  try {
    const apiKey = config.api_key || "ollama"
    // Multi-adversarial S-V2/S-V9: never POST image bytes to non-loopback with placeholder key
    const gate = shouldBlockVisionRequest({ baseUrl: config.base_url, apiKey })
    if (gate.block) {
      logger.warn("vision.blocked_placeholder_key", {
        base_url: config.base_url,
        reason: gate.reason,
      })
      return buildFallback(image, config, gate.reason || "Vision key missing for remote endpoint")
    }

    const client = new OpenAI({
      baseURL: normalizeVisionBaseUrl(config.base_url),
      apiKey,
      timeout: config.timeout_ms,
      maxRetries: 0,
    })

    const prompt = customPrompt || config.prompt || DEFAULT_VISION_PROMPT
    const dataUrl = visionImageDataUrl(image)
    if (!dataUrl) {
      return buildFallback(image, config, "Image is not a recognized raster")
    }

    const response = await client.chat.completions.create(
      {
        model: config.model_name,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: config.max_tokens,
        temperature: 0.3,
      },
      { signal },
    )

    // OpenAI-compatible servers can resolve with a non-standard body on engine
    // errors (e.g. LM Studio: no `choices`, `error` as a double-encoded string).
    // Never index `choices` blindly — surface the server's own message instead.
    const raw = response as unknown as {
      choices?: Array<{ message?: { content?: unknown } }>
      error?: unknown
    }
    const content = Array.isArray(raw?.choices) ? raw.choices[0]?.message?.content : undefined
    const description = typeof content === "string" ? content.trim() : ""
    const latencyMs = Date.now() - startTime

    if (!description) {
      const serverError = extractServerErrorMessage(raw?.error)
      logger.warn("vision.empty_response", { model: config.model_name, server_error: serverError })
      return buildFallback(
        image,
        config,
        serverError
          ? `Vision endpoint returned an error: ${serverError}`
          : "Vision model returned empty response",
      )
    }

    setCache(cacheKey, description, config.model_name)
    logger.info("vision.analyzed", { model: config.model_name, latency_ms: latencyMs, cached: false })

    return { description, cached: false, model_used: config.model_name, latency_ms: latencyMs }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime
    logger.warn("vision.analysis_failed", {
      error: err.message,
      model: config.model_name,
      latency_ms: latencyMs,
    })
    return buildFallback(image, config, err.message)
  }
}

/**
 * OpenAI-compatible servers mount the API at /v1, but users routinely paste the
 * server root (LM Studio shows `http://localhost:1234`). Append /v1 when the URL
 * carries no path so a bare host:port still reaches /v1/chat/completions.
 * Scheme-less pastes default to http (vision endpoints are local HTTP servers);
 * URLs that already carry a path (…/v1, Azure /openai/…, gateways) pass through.
 * Rebuilt from URL parts so /v1 never lands after a stray query/fragment.
 * Note: a server that truly mounts the API at the root can no longer be
 * expressed — every mainstream OpenAI-compatible server uses /v1.
 */
export function normalizeVisionBaseUrl(url: string): string {
  const trimmed = String(url || "").trim().replace(/\/+$/, "")
  if (!trimmed) return trimmed
  try {
    const withScheme = trimmed.includes("://") ? trimmed : `http://${trimmed}`
    const u = new URL(withScheme)
    if (u.pathname !== "" && u.pathname !== "/") return withScheme
    const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ""}@` : ""
    return `${u.protocol}//${auth}${u.host}/v1`
  } catch {
    return trimmed
  }
}

/** Cap server-controlled text that lands in the transcript / main-model context. */
const MAX_SERVER_ERROR_CHARS = 300

/**
 * Best-effort human message from a non-standard 2xx error body.
 * LM Studio double-encodes engine errors, e.g.
 * `{"error":"Engine protocol predict request returned 400: {\"error\":{\"message\":\"…\"}}"}`.
 */
export function extractServerErrorMessage(err: unknown): string | undefined {
  const raw = extractRawServerError(err)
  if (!raw) return undefined
  return raw.length > MAX_SERVER_ERROR_CHARS
    ? `${raw.slice(0, MAX_SERVER_ERROR_CHARS)}…`
    : raw
}

function extractRawServerError(err: unknown): string | undefined {
  if (!err) return undefined
  if (typeof err !== "string") {
    const msg = (err as { message?: unknown })?.message
    return typeof msg === "string" && msg ? msg : undefined
  }
  const jsonPart = err.match(/\{[\s\S]*\}/)
  if (jsonPart) {
    try {
      const inner = JSON.parse(jsonPart[0]) as { error?: { message?: unknown } | string }
      // Flat shape: {"error":"plain message"}.
      if (typeof inner?.error === "string" && inner.error) return inner.error
      const msg = (inner?.error as { message?: unknown } | undefined)?.message
      if (typeof msg === "string" && msg) return msg
    } catch {
      /* fall through to the raw string */
    }
  }
  return err
}

function buildFallback(image: ImageInput, config: VisionConfig, error: string): VisionResult {
  if (config.fallback === "error") {
    throw new Error(`Vision analysis failed: ${error}`)
  }

  const subject = formatVisionFallbackSubject(image.title, image.url, image.width, image.height)
  if (config.fallback === "passthrough") {
    // Return minimal metadata — caller will keep original base64
    return {
      description: `${subject}. Vision unavailable: ${error}`,
      cached: false,
      model_used: "none",
      latency_ms: 0,
    }
  }

  // Default: metadata fallback
  return {
    description: `${subject}. Vision model unavailable: ${error}`,
    cached: false,
    model_used: "none",
    latency_ms: 0,
  }
}
