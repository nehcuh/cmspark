// Vision pipeline — local vision model integration for screenshot/image analysis

import OpenAI from "openai"
import * as crypto from "crypto"
import type { VisionConfig } from "../config"
import { logger } from "../logger"

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
    const client = new OpenAI({
      baseURL: config.base_url,
      apiKey: config.api_key || "ollama",
      timeout: config.timeout_ms,
      maxRetries: 0,
    })

    const prompt = customPrompt || config.prompt || DEFAULT_VISION_PROMPT

    const response = await client.chat.completions.create(
      {
        model: config.model_name,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.base64}` } },
            ],
          },
        ],
        max_tokens: config.max_tokens,
        temperature: 0.3,
      },
      { signal },
    )

    const description = response.choices[0]?.message?.content?.trim() || ""
    const latencyMs = Date.now() - startTime

    if (!description) {
      logger.warn("vision.empty_response", { model: config.model_name })
      return buildFallback(image, config, "Vision model returned empty response")
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

function buildFallback(image: ImageInput, config: VisionConfig, error: string): VisionResult {
  if (config.fallback === "error") {
    throw new Error(`Vision analysis failed: ${error}`)
  }

  if (config.fallback === "passthrough") {
    // Return minimal metadata — caller will keep original base64
    return {
      description: `Screenshot of "${image.title}" (${image.url}), ${image.width}x${image.height}px. Vision unavailable: ${error}`,
      cached: false,
      model_used: "none",
      latency_ms: 0,
    }
  }

  // Default: metadata fallback
  return {
    description: `Screenshot of "${image.title}" (${image.url}), ${image.width}x${image.height}px. Vision model unavailable: ${error}`,
    cached: false,
    model_used: "none",
    latency_ms: 0,
  }
}
