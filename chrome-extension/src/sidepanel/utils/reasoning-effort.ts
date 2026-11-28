// Generated from companion/src/llm/reasoning-effort.ts by companion/scripts/generate-client-contracts.mjs.
/** Model capabilities for the protocols actually used by Companion and Settings. */
export const orderedEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export type ReasoningEffort = typeof orderedEfforts[number]
export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return orderedEfforts.some(level => level === value)
}
const three = ["low", "medium", "high"] as const
const four = [...three, "xhigh"] as const
const five = [...four, "max"] as const
export const effortLevels = {
  openai: ["none", ...four], deepseek: ["none", "low", "high", "max"], kimi: ["low", "high", "max"],
  "anthropic-46": [...three, "max"], "anthropic-47": five, "glm-53": ["low", "high", "max"],
  "glm-52": ["none", "high", "max"], three, four, five, six: ["none", ...five],
  "minimal-three": ["minimal", ...three], "off-three": ["none", ...three],
  qwen4: ["none", "low", "high", "xhigh"], switch: ["none", "high"], "adaptive-switch": ["none", "high"], unsupported: [],
} as const satisfies Record<string, readonly ReasoningEffort[]>
export type ReasoningSupport = keyof typeof effortLevels
type Provider = "OpenAI" | "DeepSeek" | "Anthropic" | "智谱" | "Kimi" | "Grok" | "Gemini" | "MiniMax" | "Magpie" | "千问"
type ModelSpec = {
  provider: Provider
  models: readonly string[]
  contextWindow?: number
  output?: number
  support: ReasoningSupport
  source: string
  imageInput?: boolean
  responsesForTools?: boolean
}

// Limits are for the public API endpoint, not for similarly named gateway profiles.
const anthropicSpecs = "https://platform.claude.com/docs/en/models/overview"
const openaiSpecs = "https://developers.openai.com/api/docs/models/"
const grokSpecs = "https://docs.x.ai/developers/model-capabilities/text/reasoning"
const geminiSpecs = "https://ai.google.dev/gemini-api/docs/openai#thinking"
const glmSpecs = "https://docs.bigmodel.cn/cn/guide/capabilities/thinking"
const minimaxSpecs = "https://platform.minimax.io/docs/api-reference/text-openai-api"
const catalog: readonly ModelSpec[] = [
  { provider: "DeepSeek", models: ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro"],
    contextWindow: 1000000, output: 393216, support: "deepseek", source: "https://api-docs.deepseek.com/quick_start/pricing/" },
  { provider: "OpenAI", models: ["gpt-5.4", "gpt-5.4-2026-03-05"], contextWindow: 1050000, output: 128000, support: "openai", source: openaiSpecs + "gpt-5.4" },
  { provider: "OpenAI", models: ["gpt-5.4-mini", "gpt-5.4-mini-2026-03-17"], contextWindow: 400000, output: 128000, support: "openai", source: openaiSpecs + "gpt-5.4-mini" },
  { provider: "OpenAI", models: ["gpt-5.2", "gpt-5.2-2025-12-11"], contextWindow: 400000, output: 128000, support: "openai", source: openaiSpecs + "gpt-5.2" },
  { provider: "OpenAI", models: ["gpt-4.1", "gpt-4.1-2025-04-14"], contextWindow: 1047576, output: 32768, support: "unsupported", source: openaiSpecs + "gpt-4.1" },
  { provider: "OpenAI", models: ["gpt-4o", "gpt-4o-2024-08-06", "gpt-4o-2024-11-20"], contextWindow: 128000, output: 16384, support: "unsupported", source: openaiSpecs + "gpt-4o" },
  { provider: "Anthropic", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-4-8", "claude-opus-4-7"],
    contextWindow: 1000000, output: 128000, support: "anthropic-47", source: anthropicSpecs },
  { provider: "Anthropic", models: ["claude-sonnet-4-6", "claude-opus-4-6"], contextWindow: 1000000, output: 128000, support: "anthropic-46", source: anthropicSpecs },
  { provider: "Anthropic", models: ["claude-sonnet-4-5", "claude-haiku-4-5"], contextWindow: 200000, output: 64000, support: "unsupported", source: anthropicSpecs },
  { provider: "智谱", models: ["glm-5.1"], contextWindow: 200000, output: 128000, support: "switch", source: "https://docs.bigmodel.cn/cn/guide/models/text/glm-5.1" },
  { provider: "Kimi", models: ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"], contextWindow: 1048576, output: 1048576, support: "kimi", source: "https://platform.kimi.com/docs/guide/kimi-k3-1-pro-quickstart" },
  { provider: "OpenAI", models: ["gpt-5.5"], contextWindow: 1050000, output: 128000, support: "openai", source: openaiSpecs },
  { provider: "OpenAI", models: ["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-sol", "gpt-6-astra"], support: "five", contextWindow: 1050000, output: 128000, responsesForTools: true, imageInput: true, source: openaiSpecs },
  { provider: "OpenAI", models: ["gpt-6-sol", "gpt-6-luna"], support: "six", contextWindow: 1050000, output: 128000, responsesForTools: true, imageInput: true, source: openaiSpecs },
  { provider: "OpenAI", models: ["gpt-6.1-terra"], support: "six", contextWindow: 1050000, output: 128000, responsesForTools: true, imageInput: true, source: openaiSpecs + "gpt-6.1-terra" },
  { provider: "OpenAI", models: ["o3", "o4-mini"], support: "three", source: openaiSpecs },
  { provider: "OpenAI", models: ["gpt-5", "gpt-5-mini", "gpt-5-nano"], support: "minimal-three", source: openaiSpecs },
  { provider: "Anthropic", models: ["claude-opus-5", "claude-sonnet-5", "claude-fable-5-2", "claude-mythos-5-2"], support: "anthropic-47", source: anthropicSpecs },
  { provider: "Anthropic", models: ["claude-opus-4-5", "claude-opus-4-5-20251101"], support: "three", source: anthropicSpecs },
  { provider: "Grok", models: ["grok-4.7", "grok-4.6"], support: "four", source: grokSpecs },
  { provider: "Grok", models: ["grok-4.5"], support: "three", source: grokSpecs },
  { provider: "Grok", models: ["grok-4.3"], support: "off-three", source: grokSpecs },
  { provider: "Gemini", models: ["gemini-4-hydrogen", "gemini-4-neon"], support: "four", source: geminiSpecs },
  { provider: "Gemini", models: ["gemini-4-carbon", "gemini-4-argon", "gemini-3.8-flash", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-pro-preview"], support: "three", source: geminiSpecs },
  { provider: "Gemini", models: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite-preview"], support: "minimal-three", source: geminiSpecs },
  { provider: "智谱", models: ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx"], support: "glm-53", source: glmSpecs },
  { provider: "智谱", models: ["glm-5.2"], support: "glm-52", source: glmSpecs },
  { provider: "智谱", models: ["glm-5", "glm-4.7"], support: "switch", source: glmSpecs },
  { provider: "Kimi", models: ["kimi-k3"], support: "kimi", source: "https://platform.kimi.com/docs/guide/kimi-k3-quickstart" },
  { provider: "Kimi", models: ["kimi-k2.6", "kimi-k2.5"], support: "switch", source: "https://platform.kimi.com/docs/guide/kimi-k2-5-quickstart" },
  { provider: "千问", models: ["qwen4-max"], support: "qwen4", imageInput: true, contextWindow: 1000000, output: 262144, source: "https://help.aliyun.com/zh/model-studio/qwen4-max" },
  { provider: "MiniMax", models: ["MiniMax-M3.1-Flash"], support: "five", source: minimaxSpecs },
  { provider: "MiniMax", models: ["MiniMax-M3"], support: "adaptive-switch", source: minimaxSpecs },
  { provider: "MiniMax", models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"], support: "unsupported", source: minimaxSpecs },
]

// GLM-5.4 is available through Coding Plan before the standard Model API.
const glm54: ModelSpec = { provider: "智谱", models: ["glm-5.4"], contextWindow: 1000000, output: 128000,
  imageInput: true, support: "glm-53", source: "https://docs.bigmodel.cn/cn/coding-plan/latest-model" }

function glmCodingPlan(protocol: unknown, baseUrl: unknown): boolean {
  if (typeof baseUrl !== "string") return false
  let url: URL
  try { url = new URL(baseUrl) } catch { return false }
  if (!["https://open.bigmodel.cn", "https://api.z.ai"].includes(url.origin) || url.username || url.password || url.search || url.hash) return false
  const path = url.pathname.replace(/\/$/, "")
  if (protocol === "anthropic") return path === "/api/anthropic" || path === "/api/anthropic/v1"
  return (protocol === "openai" || protocol === undefined) && path === "/api/coding/paas/v4"
}

function directProvider(protocol: unknown, baseUrl: unknown): Provider | undefined {
  if (typeof baseUrl !== "string") return
  let url: URL
  try { url = new URL(baseUrl) } catch { return }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return
  const path = url.pathname.replace(/\/$/, "")
  if (protocol === "anthropic" && url.hostname === "api.anthropic.com" && ["", "/v1"].includes(path)) return "Anthropic"
  const dashscope = ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com", "cn-hongkong.dashscope.aliyuncs.com"].includes(url.hostname)
  if (dashscope && (protocol === "openai" || protocol === undefined) && path === "/compatible-mode/v1") return "千问"
  if (dashscope && protocol === "anthropic" && ["/apps/anthropic", "/apps/anthropic/v1"].includes(path)) return "千问"
  const miniMax = ["api.minimax.io", "api.minimaxi.com"].includes(url.hostname)
  if (protocol === "anthropic" && url.hostname === "api.deepseek.com" && ["/anthropic", "/anthropic/v1"].includes(path)) return "DeepSeek"
  if (protocol === "anthropic" && miniMax && ["/anthropic", "/anthropic/v1"].includes(path)) return "MiniMax"
  if (protocol !== "openai" && protocol !== undefined) return
  if (["open.bigmodel.cn", "api.z.ai"].includes(url.hostname) && ["/api/paas/v4", "/api/coding/paas/v4"].includes(path)) return "智谱"
  if (["api.moonshot.cn", "api.moonshot.ai"].includes(url.hostname) && path === "/v1") return "Kimi"
  if (url.hostname === "generativelanguage.googleapis.com" && path === "/v1beta/openai") return "Gemini"
  if (!["", "/v1"].includes(path)) return
  if (miniMax) return "MiniMax"
  if (url.hostname === "api.x.ai") return "Grok"
  if (url.hostname === "api.deepseek.com") return "DeepSeek"
  if (url.hostname === "api.openai.com") return "OpenAI"
}

export function isCompatibilityGateway(protocol: unknown, baseUrl: unknown): boolean {
  return directProvider(protocol, baseUrl) === undefined
}

export function modelSpec(protocol: unknown, baseUrl: unknown, model: unknown, effort?: unknown): ModelSpec | undefined {
  if (model === "glm-5.4" && glmCodingPlan(protocol, baseUrl)) return glm54
  // Magpie exposes provider-qualified IDs, optional context suffixes, and
  // translates Messages output_config.effort to its upstream Grok request.
  if (typeof baseUrl === "string" && /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):3425(?:\/v1)?\/?$/.test(baseUrl)
      && (protocol === "anthropic" || protocol === "openai" || protocol === undefined) && typeof model === "string") {
    const match = /^grok\/(grok-4\.[567])(?:-build-fast)?(?:@\d+[km])?$/.exec(model)
    if (match) return { provider: "Magpie", models: [model], support: match[1] === "grok-4.5" ? "three" : "four", source: "https://github.com/yetone/magpie" }
  }
  const provider = directProvider(protocol, baseUrl)
  const spec = catalog.find(entry => entry.provider === provider && typeof model === "string" && entry.models.includes(model))
  return spec?.support === "qwen4" && effort === "none" ? { ...spec, output: 131072 } : spec
}

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

export function modelSuggestions(protocol: unknown, baseUrl: unknown): string[] {
  const provider = directProvider(protocol, baseUrl)
  const models = catalog.filter(entry => entry.provider === provider).flatMap(entry => entry.models)
  return glmCodingPlan(protocol, baseUrl) ? [...glm54.models, ...models] : models
}

export function reasoningSupport(protocol: unknown, baseUrl: unknown, model: unknown): ReasoningSupport {
  return modelSpec(protocol, baseUrl, model)?.support ?? "unsupported"
}
export function effectiveReasoningEffort(value: unknown): ReasoningEffort {
  return isReasoningEffort(value) ? value : "medium"
}
/** Resolve saved preferences (including the four legacy levels) against this model. */
export function reasoningWireEffort(support: ReasoningSupport, value: unknown): ReasoningEffort | undefined {
  const levels: readonly ReasoningEffort[] = effortLevels[support]
  const effort = effectiveReasoningEffort(value)
  if (levels.includes(effort)) return effort
  if (support === "switch" || support === "adaptive-switch") return effort === "none" ? "none" : "high"
  // The former xhigh option meant max on three-tier models. Preserve its wire value.
  if (effort === "xhigh" && levels.includes("max")) return "max"
  if (effort === "medium" && levels.includes("high")) return "high"
  if (support === "glm-52" && effort === "low") return "high"
  return orderedEfforts.slice(orderedEfforts.indexOf(effort)).find(level => levels.includes(level)) ?? levels.at(-1)
}

export function reasoningParams(support: ReasoningSupport, value: unknown, protocol: "openai" | "anthropic") {
  const effort = reasoningWireEffort(support, value)
  if (!effort) return {}
  if (support === "switch" || support === "adaptive-switch") {
    return { thinking: { type: effort === "none" ? "disabled" : support === "adaptive-switch" ? "adaptive" : "enabled" } }
  }
  if (support === "qwen4" && protocol === "openai") return effort === "none" ? { enable_thinking: false } : { enable_thinking: true, reasoning_effort: effort }
  if (support === "anthropic-46" || support === "anthropic-47") return { thinking: { type: "adaptive" }, output_config: { effort } }
  if (protocol === "anthropic" && effort === "none") return { thinking: { type: "disabled" } }
  return protocol === "anthropic" ? { output_config: { effort } } : { reasoning_effort: effort }
}
