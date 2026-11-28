import { getConfig, type LlmConfig, type VisionConfig } from "../config"
import { endpointsMatch } from "./vision-reuse-inherit"

/** Resolve reusable gateway auth in Companion; secrets never need to enter the UI. */
export function resolveVisionLlmConfig(config: VisionConfig, mainConfig?: LlmConfig): LlmConfig {
  const main = config.use_main_auth ? mainConfig ?? getConfig().llm : undefined
  const inherited = main && endpointsMatch(main, config) &&
    (main.protocol ?? "openai") === (config.protocol ?? "openai") ? main : undefined
  return {
    ...inherited, ...config,
    auth_style: inherited?.auth_style ?? config.auth_style,
    client_header_profile: inherited?.client_header_profile ?? config.client_header_profile,
    claude_code_compat_version: inherited?.claude_code_compat_version ?? config.claude_code_compat_version,
    extra_headers: inherited?.extra_headers ?? config.extra_headers,
    anthropic_version: inherited?.anthropic_version ?? config.anthropic_version,
    base_url: config.protocol === "anthropic" ? config.base_url : normalizeVisionBaseUrl(config.base_url),
    temperature: 0.3, context_window: 100_000,
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
