/**
 * Protocol-aware LLM connection probe (Anthropic P1).
 *
 * Used by WS `config.test` and settings-web `/api/test`.
 * OpenAI path: POST …/chat/completions mini body.
 * Anthropic path: POST …/messages mini body with L7-safe headers.
 */

import type {
  LlmAuthStyle,
  LlmClientHeaderProfile,
  LlmProtocol,
} from "../config"
import { resolveAnthropicMessagesUrl } from "./providers/anthropic-convert"
import {
  buildRequestHeaders,
  HeaderPolicyError,
} from "./providers/headers"

export interface LlmProbeInput {
  base_url: string
  api_key: string
  model_name: string
  protocol?: LlmProtocol | string
  auth_style?: LlmAuthStyle | string
  client_header_profile?: LlmClientHeaderProfile | string
  claude_code_compat_version?: string
  anthropic_version?: string
  extra_headers?: Record<string, string>
  /** Default 10000 */
  timeout_ms?: number
}

export interface LlmProbeResult {
  ok: boolean
  message?: string
  error?: string
  status?: number
}

function normalizeProtocol(raw: unknown): LlmProtocol {
  return raw === "anthropic" ? "anthropic" : "openai"
}

function normalizeProfile(raw: unknown): LlmClientHeaderProfile {
  return raw === "claude_code_compat" ? "claude_code_compat" : "none"
}

function normalizeAuthStyle(raw: unknown): LlmAuthStyle {
  if (raw === "bearer" || raw === "x-api-key") return raw
  return "auto"
}

/** Map HTTP status to a short Chinese/English hybrid hint (design §5). */
export function formatProbeHttpError(status: number, protocol: LlmProtocol): string {
  if (status === 401 || status === 403) {
    return `鉴权失败 (HTTP ${status})：请检查 API Key${protocol === "anthropic" ? " / x-api-key" : ""}`
  }
  if (status === 404) {
    return protocol === "anthropic"
      ? `路径可能错误 (HTTP 404)：Anthropic 协议走 /messages，请确认 Base URL 不是 /chat/completions`
      : `路径可能错误 (HTTP 404)：请确认 Base URL 指向 OpenAI-compatible 端点`
  }
  if (status === 400) {
    return `请求格式被拒绝 (HTTP 400)：请检查协议选择与模型名是否匹配该端点`
  }
  return `上游返回 HTTP ${status}`
}

/**
 * Probe LLM endpoint with the same protocol + header profile as chat.
 * Does not log header values.
 */
export async function probeLlmConnection(input: LlmProbeInput): Promise<LlmProbeResult> {
  const protocol = normalizeProtocol(input.protocol)
  const profile = normalizeProfile(input.client_header_profile)
  const authStyle = normalizeAuthStyle(input.auth_style)
  const timeout = input.timeout_ms && input.timeout_ms > 0 ? input.timeout_ms : 10000
  const model = (input.model_name || "").trim() || (protocol === "anthropic" ? "claude-sonnet-4-6" : "deepseek-chat")
  const key = input.api_key || ""

  if (!key || key === "sk-placeholder") {
    return { ok: false, error: "API Key 未配置" }
  }
  if (!input.base_url || !String(input.base_url).trim()) {
    return { ok: false, error: "Base URL 未配置" }
  }

  const { assertLlmEndpointAllowedAsync } = await import("../security")
  const blocked = await assertLlmEndpointAllowedAsync(String(input.base_url))
  if (blocked) {
    return { ok: false, error: blocked }
  }

  try {
    if (protocol === "anthropic") {
      return await probeAnthropic({
        baseUrl: input.base_url,
        apiKey: key,
        model,
        authStyle,
        profile,
        claudeCodeCompatVersion: input.claude_code_compat_version,
        anthropicVersion: input.anthropic_version,
        extraHeaders: input.extra_headers,
        timeout,
      })
    }
    return await probeOpenAI({
      baseUrl: input.base_url,
      apiKey: key,
      model,
      authStyle,
      profile,
      extraHeaders: input.extra_headers,
      timeout,
    })
  } catch (e: unknown) {
    if (e instanceof HeaderPolicyError) {
      return { ok: false, error: e.message }
    }
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `连接失败: ${msg}` }
  }
}

/** 1×1 PNG — probe only, never logged. */
const PROBE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

/**
 * After a successful text probe: does this OpenAI-compatible endpoint accept an image part?
 * Anthropic is skipped (name heuristic already treats Claude as multimodal).
 */
export async function probeNativeVision(input: LlmProbeInput): Promise<boolean> {
  const protocol = normalizeProtocol(input.protocol)
  if (protocol === "anthropic") return true
  const model = (input.model_name || "").trim()
  const key = input.api_key || ""
  const base = String(input.base_url || "").replace(/\/+$/, "")
  if (!model || !key || !base) return false
  const { assertLlmEndpointAllowedAsync } = await import("../security")
  if (await assertLlmEndpointAllowedAsync(input.base_url)) return false
  const timeout = 8000
  try {
    const headers = buildRequestHeaders({
      baseUrl: input.base_url,
      protocol: "openai",
      apiKey: key,
      auth_style: normalizeAuthStyle(input.auth_style),
      client_header_profile: normalizeProfile(input.client_header_profile),
      extra_headers: input.extra_headers,
    })
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 4,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "ok" },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${PROBE_PNG_B64}` },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(timeout),
    })
    return response.ok
  } catch {
    return false
  }
}

async function probeOpenAI(opts: {
  baseUrl: string
  apiKey: string
  model: string
  authStyle: LlmAuthStyle
  profile: LlmClientHeaderProfile
  extraHeaders?: Record<string, string>
  timeout: number
}): Promise<LlmProbeResult> {
  const base = opts.baseUrl.replace(/\/+$/, "")
  const url = `${base}/chat/completions`
  const headers = buildRequestHeaders({
    baseUrl: opts.baseUrl,
    protocol: "openai",
    apiKey: opts.apiKey,
    auth_style: opts.authStyle,
    client_header_profile: opts.profile,
    extra_headers: opts.extraHeaders,
  })

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "user", content: "Reply OK" }],
      max_tokens: 5,
    }),
    signal: AbortSignal.timeout(opts.timeout),
  })

  if (response.ok) {
    return { ok: true, message: `连接成功 (HTTP ${response.status})`, status: response.status }
  }
  return {
    ok: false,
    error: formatProbeHttpError(response.status, "openai"),
    status: response.status,
  }
}

async function probeAnthropic(opts: {
  baseUrl: string
  apiKey: string
  model: string
  authStyle: LlmAuthStyle
  profile: LlmClientHeaderProfile
  claudeCodeCompatVersion?: string
  anthropicVersion?: string
  extraHeaders?: Record<string, string>
  timeout: number
}): Promise<LlmProbeResult> {
  const url = resolveAnthropicMessagesUrl(opts.baseUrl)
  const headers = buildRequestHeaders({
    baseUrl: opts.baseUrl,
    protocol: "anthropic",
    apiKey: opts.apiKey,
    auth_style: opts.authStyle,
    client_header_profile: opts.profile,
    claude_code_compat_version: opts.claudeCodeCompatVersion,
    anthropic_version: opts.anthropicVersion,
    extra_headers: opts.extraHeaders,
  })

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply OK" }],
    }),
    signal: AbortSignal.timeout(opts.timeout),
  })

  if (response.ok) {
    return { ok: true, message: `连接成功 (HTTP ${response.status})`, status: response.status }
  }
  return {
    ok: false,
    error: formatProbeHttpError(response.status, "anthropic"),
    status: response.status,
  }
}
