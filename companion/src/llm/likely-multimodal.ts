import { lookupNativeVisionProbe } from "./native-vision-probe-cache"

export type NativeVisionMode = "auto" | "on" | "off"

/** Fail-closed name heuristic. Does NOT read protocol. */
export function likelyMultimodal(modelName: string | undefined | null): boolean {
  const m = (modelName || "").trim().toLowerCase()
  if (!m) return false
  if (/deepseek/.test(m)) return false
  if (/\br1\b/.test(m) && !/vision|vl/.test(m)) return false
  if (/(^|[-_])(coder|reasoner)($|[-_])/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/kimi-k2/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/moonshot-v1/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/gpt-5|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-4-turbo|gpt-4-vision|o[1-9].*vision|chatgpt-4o/.test(m)) return true
  if (/claude|sonnet|opus|haiku/.test(m)) return true
  if (/gemini|gemma.*vision/.test(m)) return true
  if (/kimi|moonshot/.test(m)) return true
  if (/glm-4v|glm-4\.?\d*v|glm-4\.6v/.test(m)) return true
  if (/qwen.*vl|vl.*qwen|qwen2\.5-?vl|qwen2-vl|qwen3-vl/.test(m)) return true
  if (/llava|minicpm-v|minicpm-o|moondream|pixtral|phi-3-vision|phi-4-multimodal/.test(m)) return true
  if (/internvl|intern-vl|cogvlm|yi-vl|step-1v|llama-?3\.2.*vision|llama-?4/.test(m)) return true
  if (/\bvision\b|multimodal|omni|\bvl\b/.test(m)) return true
  return false
}

/**
 * Composer attachments + screenshot rail: honor explicit override, else name
 * heuristic, else last successful image probe (`detected`).
 */
export function resolveNativeVision(opts: {
  modelName?: string | null
  baseUrl?: string | null
  mode?: NativeVisionMode | boolean | null
  /** Explicit probe bit (tests). Production prefers in-memory {url,model} cache. */
  detected?: boolean | null
}): boolean {
  const raw = opts.mode
  const mode: NativeVisionMode =
    raw === true || raw === "on" ? "on" : raw === false || raw === "off" ? "off" : "auto"
  if (mode === "on") return true
  if (mode === "off") return false
  if (likelyMultimodal(opts.modelName)) return true
  if (opts.detected === true) return true
  return lookupNativeVisionProbe(opts.baseUrl || "", opts.modelName || "") === true
}

type VisionLike = {
  enabled?: boolean
  base_url: string
  api_key: string
  model_name: string
  timeout_ms?: number
  max_tokens?: number
  fallback?: "metadata" | "passthrough" | "error"
  prompt?: string
  cache_ttl_seconds?: number
}

type LlmLike = {
  base_url: string
  api_key: string
  model_name: string
  protocol?: string
  native_vision?: NativeVisionMode | boolean | null
}

/**
 * Screenshot / analyze_image rail. Prefer the main LLM when it can see images
 * (override / heuristic / probe). Anthropic Messages stays on the vision rail
 * (that pipeline is OpenAI-compatible only).
 */
export function visionConfigForAnalyze(llm: LlmLike, vision?: VisionLike | null): VisionLike | null {
  const useNative =
    (llm.protocol || "openai") !== "anthropic" &&
    resolveNativeVision({
      modelName: llm.model_name,
      baseUrl: llm.base_url,
      mode: llm.native_vision,
    })
  if (useNative) {
    return {
      enabled: true,
      base_url: llm.base_url,
      api_key: llm.api_key,
      model_name: llm.model_name,
      timeout_ms: vision?.timeout_ms ?? 30000,
      max_tokens: vision?.max_tokens ?? 1024,
      fallback: vision?.fallback ?? "metadata",
      cache_ttl_seconds: vision?.cache_ttl_seconds ?? 300,
      prompt: vision?.prompt,
    }
  }
  if (vision?.enabled) return vision
  return null
}
