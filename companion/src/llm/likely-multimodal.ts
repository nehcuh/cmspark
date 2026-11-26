import { modelSpec } from "./reasoning-effort"
import { lookupNativeVisionProbe } from "./native-vision-probe-cache"
import type { LlmConfig } from "../config"

export type NativeVisionMode = "auto" | "on" | "off"

/** Fail-closed name heuristic. Does NOT read protocol. */
export function likelyMultimodal(modelName: string | undefined | null, baseUrl?: string | null): boolean {
  const m = (modelName || "").trim().toLowerCase()
  if (!m) return false
  if (baseUrl && (modelSpec("openai", baseUrl, m)?.imageInput || modelSpec("anthropic", baseUrl, m)?.imageInput)) return true
  if (/deepseek/.test(m)) {
    // Flash and its legacy aliases accept images on the official API. A gateway
    // with the same model name needs its own probe or explicit override.
    return ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(m) &&
      /^https:\/\/api\.deepseek\.com(?::443)?(?:\/(?:anthropic(?:\/v1)?|v1))?\/?$/i.test((baseUrl || "").trim())
  }
  if (/\br1\b/.test(m) && !/vision|vl/.test(m)) return false
  if (/(^|[-_])(coder|reasoner)($|[-_])/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/kimi-k2/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/moonshot-v1/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/gpt-5|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-4-turbo|gpt-4-vision|o[1-9].*vision|chatgpt-4o/.test(m)) return true
  if (/^(?:grok\/)?grok-4\.7(?:@\d+k)?$/.test(m)) return true
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
 * keyed {url,model} probe, else name heuristic. Unkeyed `detected` is ignored.
 */
export function resolveNativeVision(opts: {
  modelName?: string | null
  baseUrl?: string | null
  mode?: NativeVisionMode | boolean | null
  /** Display/session probe bit — always ignored for routing (C1 lock-step with panel). */
  detected?: boolean | null
}): boolean {
  const raw = opts.mode
  const mode: NativeVisionMode =
    raw === true || raw === "on" ? "on" : raw === false || raw === "off" ? "off" : "auto"
  if (mode === "on") return true
  if (mode === "off") return false
  void opts.detected
  return lookupNativeVisionProbe(opts.baseUrl || "", opts.modelName || "") ?? likelyMultimodal(opts.modelName, opts.baseUrl)
}

type VisionLike = Pick<LlmConfig, "protocol" | "auth_style" | "client_header_profile" | "claude_code_compat_version" | "extra_headers" | "anthropic_version"> & {
  enabled?: boolean
  reuse_main_model?: boolean
  base_url: string
  api_key: string
  model_name: string
  timeout_ms?: number
  max_tokens?: number
  fallback?: "metadata" | "passthrough" | "error"
  prompt?: string
  cache_ttl_seconds?: number
}

type LlmLike = Pick<LlmConfig, "protocol" | "auth_style" | "client_header_profile" | "claude_code_compat_version" | "extra_headers" | "anthropic_version"> & {
  base_url: string
  api_key: string
  model_name: string
  native_vision?: NativeVisionMode | boolean | null
}

/**
 * Screenshot / analyze_image rail. The master switch gates this rail only;
 * composer native-image routing continues to use resolveNativeVision directly.
 */
export function visionConfigForAnalyze(llm: LlmLike, vision?: VisionLike | null): VisionLike | null {
  if (!vision?.enabled) return null
  return selectImageAnalysisConfig(llm, vision, vision.reuse_main_model !== false)
}

/** Document images keep their existing native-main preference and upload gate. */
export function visionConfigForDocumentImages(llm: LlmLike, vision?: VisionLike | null): VisionLike | null {
  return selectImageAnalysisConfig(llm, vision, true)
}

function selectImageAnalysisConfig(llm: LlmLike, vision: VisionLike | null | undefined, reuseMain: boolean): VisionLike | null {
  const useNative = resolveNativeVision({
      modelName: llm.model_name,
      baseUrl: llm.base_url,
      mode: llm.native_vision,
    })
  if (useNative && reuseMain) {
    return {
      enabled: true,
      base_url: llm.base_url,
      api_key: llm.api_key,
      model_name: llm.model_name,
      protocol: llm.protocol,
      auth_style: llm.auth_style,
      client_header_profile: llm.client_header_profile,
      claude_code_compat_version: llm.claude_code_compat_version,
      extra_headers: llm.extra_headers,
      anthropic_version: llm.anthropic_version,
      timeout_ms: vision?.timeout_ms ?? 30000,
      max_tokens: vision?.max_tokens ?? 1024,
      fallback: vision?.fallback ?? "metadata",
      cache_ttl_seconds: vision?.cache_ttl_seconds ?? 300,
      prompt: vision?.prompt,
    }
  }
  return vision?.enabled ? vision : null
}
