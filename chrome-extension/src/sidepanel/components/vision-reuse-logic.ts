import { resolveNativeVision, type NativeVisionMode } from "../utils/native-vision-probe-cache"
export { likelyMultimodal } from "../utils/reasoning-effort"
export {
  clearNativeVisionProbe, lookupNativeVisionProbe, normalizeProbeModel, normalizeProbeUrl,
  rememberNativeVisionProbe, resolveNativeVision, type NativeVisionMode,
} from "../utils/native-vision-probe-cache"

// Vision settings: multimodal heuristic + "reuse main LLM for vision side-pipeline".
// Pure functions only (model-switch-logic precedent) — node:test, no React.
//
// Architecture note: vision-pipeline uses the protocol-aware LLM provider.
// Tool screenshots are pre-analyzed into text. Explicit model reuse resolves
// the current main credentials at call time and preserves independent settings.

export const DEFAULT_VISION_BASE_URL = "http://localhost:11434/v1"
export const DEFAULT_VISION_MODEL = "llava:7b"
/** Companion default placeholder when no real key is set. */
export const VISION_PLACEHOLDER_KEY = "ollama"

export const VISION_COPY = {
  sectionHelp:
    "控制工具截图 / analyze_image 的图片识别，识别结果转文字后进入对话。输入框粘贴/选/拖的图片独立判断：主模型支持看图时直接处理，否则使用已开启的截图视觉配置。",
  reuseMain: "复用主模型",
  reuseHelp: "使用当前主模型的协议、地址、模型和鉴权；切换主模型后自动跟随。独立视觉配置会保留。",
  separateHelp: "单独配置视觉模型，截图将发送到下方服务地址。",
  unavailableHelp: "当前主模型未启用或未检测到图片理解能力，请配置独立视觉模型；可在对话模型设置中测试图片输入能力。",
  railDifferentiator:
    "本段用于截图分析；工作中心可复用此配置，也可选择本机 Qwen3-VL 抽取待办。",
  bannerTitle: "主模型可能已支持图片理解",
  bannerBodyPrefix:
    "截图会先发给视觉端点转成文字，再进入主对话。可一键把视觉配置设为与主模型相同：",
  bannerBodySuffix: "。协议与必要鉴权将一同复用，请确认该模型支持图片。",
  useMain: "使用主模型",
  keepSeparate: "仍单独配置",
  reusedChip: "已复用主模型",
  expandAdvanced: "展开高级配置",
  collapseAdvanced: "收起高级配置",
  overwriteConfirm:
    "当前视觉配置与默认不同。使用主模型将覆盖 Base URL / Model；" +
    "Key 仅在视觉 Key 未配置/占位时由 Companion 继承主 Key（已有专用视觉 Key 不会被覆盖）。确定？",
  needsKeyPaste:
    "主模型 API Key 未在界面显示（仅 Companion 已保存或为掩码）。已写入 URL/Model；" +
    "保存时 Companion 会在端点匹配且视觉 Key 占位时继承主 Key。",
  postReuseTestHint: "保存后可通过「测试模型连接」验证图片输入。",
  fallbackPassthrough:
    "视觉轨会把截断 base64 塞进说明；只有主模型走原生看图时才能看见像素",
  fallbackMetadata: "仅元数据（推荐）",
  fallbackError: "报错",
} as const

export interface MainLlmFields {
  model_name?: string
  base_url?: string
  api_key?: string
  protocol?: string
  native_vision?: NativeVisionMode | boolean | null
}

export interface VisionFlatFields {
  vision_protocol?: "openai" | "anthropic"
  vision_use_main_auth?: boolean
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
 * Whether to show the reuse banner / CTA.
 * Supports either protocol when the main model is multimodal.
 */
export function shouldOfferVisionReuse(main: MainLlmFields): boolean {
  return resolveNativeVision({ modelName: main.model_name, baseUrl: main.base_url, mode: main.native_vision })
}

export function isVisionReusingMain(
  main: MainLlmFields,
  vision: VisionFlatFields,
): boolean {
  const mainUrl = normalizeEndpointUrl(main.base_url)
  const visUrl = normalizeEndpointUrl(vision.vision_base_url)
  if (!mainUrl || !visUrl) return false
  if (mainUrl !== visUrl) return false
  if ((main.protocol ?? "openai") !== (vision.vision_protocol ?? "openai")) return false
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
      vision_protocol: main.protocol === "anthropic" ? "anthropic" : "openai",
      vision_use_main_auth: true,
      vision_base_url: main.base_url || "",
      vision_model_name: main.model_name || "",
      // Keep a dedicated visual key; Companion inherits main credentials only when empty.
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
