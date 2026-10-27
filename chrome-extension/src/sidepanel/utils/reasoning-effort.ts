/** #789: explicit, documented model/endpoint support. Keep the extension mirror in sync. */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh"
export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh"
}
export type ReasoningSupport = "deepseek" | "openai" | "anthropic-46" | "anthropic-47" | "unsupported"
export function reasoningSupport(protocol: unknown, baseUrl: unknown, model: unknown): ReasoningSupport {
  if (typeof baseUrl !== "string" || typeof model !== "string") return "unsupported"
  let url: URL
  try { url = new URL(baseUrl) } catch { return "unsupported" }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return "unsupported"
  if (!["", "/", "/v1", "/v1/"].includes(url.pathname)) return "unsupported"
  if ((protocol === "openai" || protocol === undefined) && url.hostname === "api.deepseek.com" &&
      ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro"].includes(model)) return "deepseek"
  if ((protocol === "openai" || protocol === undefined) && url.hostname === "api.openai.com" &&
      ["gpt-5.2", "gpt-5.2-2025-12-11"].includes(model)) return "openai"
  if (protocol === "anthropic" && url.hostname === "api.anthropic.com") {
    if (["claude-sonnet-4-6", "claude-opus-4-6"].includes(model)) return "anthropic-46"
    if (model === "claude-opus-4-7") return "anthropic-47"
  }
  return "unsupported"
}
export function effectiveReasoningEffort(value: unknown): ReasoningEffort {
  return isReasoningEffort(value) ? value : "medium"
}
export function reasoningWireEffort(support: ReasoningSupport, value: unknown): ReasoningEffort | "max" | undefined {
  const effort = effectiveReasoningEffort(value)
  if (support === "unsupported") return undefined
  if (support === "deepseek") return effort === "low" ? "low" : effort === "xhigh" ? "max" : "high"
  if (support === "anthropic-46" && effort === "xhigh") return "max"
  return effort
}
