// Vision settings: multimodal heuristic + "reuse main LLM for vision side-pipeline".
// Pure functions only (model-switch-logic precedent) — node:test, no React.
//
// Architecture note: vision-pipeline is OpenAI-compatible chat.completions + image_url.
// Main chat loop still receives text descriptions only (pre-analyze). Reuse copies
// credentials into config.vision; it does NOT make the agent loop natively multimodal.

export const DEFAULT_VISION_BASE_URL = "http://localhost:11434/v1"
export const DEFAULT_VISION_MODEL = "llava:7b"
/** Companion default placeholder when no real key is set. */
export const VISION_PLACEHOLDER_KEY = "ollama"

export const VISION_COPY = {
  sectionHelp:
    "开启后，截图 / analyze_image 会先经视觉模型转成文字再交给主对话（主对话不会直接收图）。" +
    "可使用本地 VLM（如 Ollama llava），也可使用云端 OpenAI 兼容多模态 API（与主模型相同亦可）。",
  railDifferentiator:
    "本段是「看图描述」轨。桌面点击定位用的实验层 Qwen3-VL（设置 → 实验功能）与此无关，不能代替截图分析。",
  bannerTitle: "主模型可能已支持图片理解",
  bannerBodyPrefix:
    "截图会先发给视觉端点转成文字，再进入主对话。可一键把视觉配置设为与主模型相同：",
  bannerBodySuffix: "。请确认该端点接受 OpenAI 兼容的 image 请求。",
  useMain: "使用主模型",
  keepSeparate: "仍单独配置",
  reusedChip: "已复用主模型",
  expandAdvanced: "展开高级配置",
  collapseAdvanced: "收起高级配置",
  anthropicBlocked:
    "当前主对话为 Anthropic Messages 协议。视觉轨仅支持 OpenAI 兼容 /chat/completions，" +
    "无法一键复用；请为视觉单独配置 OpenAI 兼容多模态端点（或网关）。",
  overwriteConfirm:
    "当前视觉配置与默认不同。使用主模型将覆盖 Base URL / Model；" +
    "Key 仅在视觉 Key 未配置/占位时由 Companion 继承主 Key（已有专用视觉 Key 不会被覆盖）。确定？",
  needsKeyPaste:
    "主模型 API Key 未在界面显示（仅 Companion 已保存或为掩码）。已写入 URL/Model；" +
    "保存时 Companion 会在端点匹配且视觉 Key 占位时继承主 Key。建议保存后点「测试视觉模型连接」。",
  postReuseTestHint: "建议立即测试视觉连接，确认端点可用后再用于截图分析。",
  fallbackPassthrough: "保留截断 base64（主模型通常仍不能真正看图）",
  fallbackMetadata: "仅元数据（推荐）",
  fallbackError: "报错",
} as const

export interface MainLlmFields {
  model_name?: string
  base_url?: string
  api_key?: string
  protocol?: string
}

export interface VisionFlatFields {
  vision_enabled?: boolean
  vision_base_url?: string
  vision_model_name?: string
  vision_api_key?: string
}

/** Normalize URL for equality (trim, strip trailing slash). */
export function normalizeEndpointUrl(url: string | undefined | null): string {
  if (!url) return ""
  return url.trim().replace(/\/+$/, "").toLowerCase()
}

export function extractHostname(url: string | undefined | null): string {
  if (!url || !url.trim()) return "(未设置)"
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`)
    return u.hostname || url
  } catch {
    return url.trim()
  }
}

/**
 * Fail-closed multimodal name heuristic. Unknown models → false.
 * Does NOT check protocol (use shouldOfferVisionReuse for offer gate).
 */
export function likelyMultimodal(modelName: string | undefined | null): boolean {
  const m = (modelName || "").trim().toLowerCase()
  if (!m) return false

  // Known text-only / non-vision families first
  if (/deepseek/.test(m)) return false
  if (/\br1\b/.test(m) && !/vision|vl/.test(m)) return false
  // coder/reasoner without explicit vision tag
  if (/(^|[-_])(coder|reasoner)($|[-_])/.test(m) && !/vl|vision|omni/.test(m)) return false

  if (
    /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|o[1-9].*vision|chatgpt-4o/.test(m)
  ) {
    return true
  }
  if (/claude|sonnet|opus|haiku/.test(m)) return true
  if (/gemini|gemma.*vision/.test(m)) return true
  if (/kimi|moonshot/.test(m)) return true
  if (/glm-4v|glm-4\.?\d*v|glm-4\.6v/.test(m)) return true
  if (/qwen.*vl|vl.*qwen|qwen2\.5-?vl|qwen2-vl|qwen3-vl/.test(m)) return true
  if (/llava|minicpm-v|moondream|pixtral|phi-3-vision|phi-4-multimodal/.test(m)) {
    return true
  }
  if (/\bvision\b|multimodal|omni/.test(m)) return true

  return false
}

/**
 * Whether to show the reuse banner / CTA.
 * Hard-blocks Anthropic Messages protocol (vision-pipeline is OpenAI-only).
 */
export function shouldOfferVisionReuse(main: MainLlmFields): boolean {
  if ((main.protocol || "openai") === "anthropic") return false
  return likelyMultimodal(main.model_name)
}

export function isVisionReusingMain(
  main: MainLlmFields,
  vision: VisionFlatFields,
): boolean {
  const mainUrl = normalizeEndpointUrl(main.base_url)
  const visUrl = normalizeEndpointUrl(vision.vision_base_url)
  if (!mainUrl || !visUrl) return false
  if (mainUrl !== visUrl) return false
  const mainModel = (main.model_name || "").trim().toLowerCase()
  const visModel = (vision.vision_model_name || "").trim().toLowerCase()
  if (!mainModel || !visModel) return false
  return mainModel === visModel
}

/** True if vision looks customized away from stock Ollama defaults and main. */
export function isCustomVisionConfig(
  main: MainLlmFields,
  vision: VisionFlatFields,
): boolean {
  if (isVisionReusingMain(main, vision)) return false
  const url = normalizeEndpointUrl(vision.vision_base_url)
  const model = (vision.vision_model_name || "").trim().toLowerCase()
  if (!url && !model) return false
  const isDefaultUrl =
    !url || url === normalizeEndpointUrl(DEFAULT_VISION_BASE_URL)
  const isDefaultModel =
    !model || model === DEFAULT_VISION_MODEL.toLowerCase()
  return !(isDefaultUrl && isDefaultModel)
}

export interface ApplyReuseResult {
  patch: VisionFlatFields
  needsKeyPaste: boolean
  destinationHost: string
}

/**
 * Build vision field patch from main LLM fields.
 * Does not set vision_enabled (caller already enabled).
 */
/** True if key looks like a redacted/mask display value (must not POST or copy as real). */
export function isMaskedDisplayKey(key: string | undefined | null): boolean {
  const k = (key || "").trim()
  if (!k) return false
  if (k === "***" || /^\*+$/.test(k)) return true
  // sk-****xyz / abc****def style (companion isMaskedApiKey)
  if (k.includes("****")) return true
  return false
}

export function applyVisionReuseFromMain(main: MainLlmFields): ApplyReuseResult {
  const raw = (main.api_key || "").trim()
  const apiKey = raw && !isMaskedDisplayKey(raw) ? raw : ""
  // Masked or empty → companion inherit path after save (needsKeyPaste hint)
  const needsKeyPaste = !apiKey
  return {
    patch: {
      vision_enabled: true,
      vision_base_url: main.base_url || "",
      vision_model_name: main.model_name || "",
      // Only copy plaintext key from UI; empty/mask leaves companion inherit path
      ...(apiKey ? { vision_api_key: apiKey } : {}),
    },
    needsKeyPaste,
    destinationHost: extractHostname(main.base_url),
  }
}

export function bannerBodyForHost(hostname: string): string {
  return (
    VISION_COPY.bannerBodyPrefix +
    hostname +
    VISION_COPY.bannerBodySuffix
  )
}

/** Placeholder / empty / mask keys that must not POST to non-loopback hosts. */
export function isVisionKeyPlaceholder(key: string | undefined | null): boolean {
  const k = (key || "").trim()
  if (!k) return true
  if (k.toLowerCase() === VISION_PLACEHOLDER_KEY || k.toLowerCase() === "ollama") return true
  return isMaskedDisplayKey(k)
}
