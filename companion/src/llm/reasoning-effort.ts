/** #789: explicit, documented model/endpoint support. Keep the extension mirror in sync. */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh"
export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh"
}
export type ReasoningSupport = "deepseek" | "kimi" | "openai" | "anthropic-46" | "anthropic-47" | "unsupported"
type Provider = "OpenAI" | "DeepSeek" | "Anthropic" | "智谱" | "Kimi"
type ModelSpec = {
  provider: Provider
  models: readonly string[]
  contextWindow: number
  output: number
  support: ReasoningSupport
  source: string
}

// Limits are for the public API endpoint, not for similarly named gateway profiles.
const anthropicSpecs = "https://platform.claude.com/docs/en/models/overview"
const openaiSpecs = "https://developers.openai.com/api/docs/models/"
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
  { provider: "智谱", models: ["glm-5.1"], contextWindow: 200000, output: 128000, support: "unsupported", source: "https://docs.bigmodel.cn/cn/guide/models/text/glm-5.1" },
  { provider: "Kimi", models: ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"], contextWindow: 1048576, output: 1048576, support: "kimi", source: "https://platform.kimi.com/docs/guide/kimi-k3-1-pro-quickstart" },
]

function directProvider(protocol: unknown, baseUrl: unknown): Provider | undefined {
  if (typeof baseUrl !== "string") return
  let url: URL
  try { url = new URL(baseUrl) } catch { return }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return
  const path = url.pathname.replace(/\/$/, "")
  if (protocol === "anthropic" && url.hostname === "api.anthropic.com" && ["", "/v1"].includes(path)) return "Anthropic"
  if (protocol !== "openai" && protocol !== undefined) return
  if (["open.bigmodel.cn", "api.z.ai"].includes(url.hostname) && path === "/api/paas/v4") return "智谱"
  if (url.hostname === "api.moonshot.cn" && path === "/v1") return "Kimi"
  if (!["", "/v1"].includes(path)) return
  if (url.hostname === "api.deepseek.com") return "DeepSeek"
  if (url.hostname === "api.openai.com") return "OpenAI"
}

export function modelSpec(protocol: unknown, baseUrl: unknown, model: unknown): ModelSpec | undefined {
  const provider = directProvider(protocol, baseUrl)
  return catalog.find(entry => entry.provider === provider && typeof model === "string" && entry.models.includes(model))
}

export function modelSuggestions(protocol: unknown, baseUrl: unknown): string[] {
  const provider = directProvider(protocol, baseUrl)
  return catalog.filter(entry => entry.provider === provider).flatMap(entry => entry.models)
}

export function reasoningSupport(protocol: unknown, baseUrl: unknown, model: unknown): ReasoningSupport {
  return modelSpec(protocol, baseUrl, model)?.support ?? "unsupported"
}
export function effectiveReasoningEffort(value: unknown): ReasoningEffort {
  return isReasoningEffort(value) ? value : "medium"
}
export function reasoningWireEffort(support: ReasoningSupport, value: unknown): ReasoningEffort | "max" | undefined {
  const effort = effectiveReasoningEffort(value)
  if (support === "unsupported") return undefined
  if (support === "deepseek" || support === "kimi") return effort === "low" ? "low" : effort === "xhigh" ? "max" : "high"
  if (support === "anthropic-46" && effort === "xhigh") return "max"
  return effort
}
