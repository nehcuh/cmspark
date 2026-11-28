import { resolveNativeVision, type NativeVisionMode } from "./native-vision-probe-cache"
import type { LlmConfig } from "../config"

export { likelyMultimodal } from "./reasoning-effort"
export { resolveNativeVision, type NativeVisionMode } from "./native-vision-probe-cache"

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
