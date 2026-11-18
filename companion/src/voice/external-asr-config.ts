import { canonicalExternalUrl, type ExternalAsrStyle, type ExternalLimitNote } from "./external-asr-url"
import { factoryExternalBudget, validateExternalBudget, type ExternalBudget } from "./external-asr-budget"

export interface VoiceExternalConfig extends ExternalBudget {
  style: ExternalAsrStyle
  baseUrl: string
  model: string
  apiKey: string
}

export type StoredSttEngine = "browser" | "local" | "system" | "external"

export interface ExternalConfigState {
  sttEngine: StoredSttEngine
  external: VoiceExternalConfig
}

export type ExternalConfigAction =
  | {
      type: "set"
      style?: ExternalAsrStyle
      baseUrl?: string
      model?: string
      apiKey?: string
      maxDurationMs?: number | null
      maxBytes?: number
      requestTimeoutMs?: number
    }
  | { type: "set-engine"; engine: "external"; privacyAckExternalV1: boolean }

export type ExternalConfigResult =
  | { ok: true; sttEngine: StoredSttEngine; external: VoiceExternalConfig }
  | { ok: false; sttEngine: StoredSttEngine }

export function defaultVoiceExternal(): VoiceExternalConfig {
  return {
    style: "deepseek",
    baseUrl: "",
    model: "whisper-1",
    apiKey: "",
    ...factoryExternalBudget("deepseek", "deepseek-docs"),
  }
}

export function externalStateView(config: ExternalConfigState) {
  const canon = canonicalExternalUrl(config.external.style, config.external.baseUrl)
  return {
    style: config.external.style,
    baseUrl: config.external.baseUrl,
    normalizedUrl: canon.ok ? canon.url : "",
    model: config.external.model,
    keyConfigured: config.external.apiKey !== "",
    maxDurationMs: config.external.maxDurationMs,
    maxBytes: config.external.maxBytes,
    requestTimeoutMs: config.external.requestTimeoutMs,
    limitNote: (canon.ok ? canon.limitNote : "deepseek-docs") as ExternalLimitNote,
  }
}

function fail(current: ExternalConfigState): ExternalConfigResult {
  return { ok: false, sttEngine: current.sttEngine }
}

export function reduceExternalConfig(current: ExternalConfigState, action: ExternalConfigAction): ExternalConfigResult {
  if (action.type === "set-engine") {
    if (action.privacyAckExternalV1 !== true || current.external.apiKey === "") return fail(current)
    const canon = canonicalExternalUrl(current.external.style, current.external.baseUrl)
    if (!canon.ok) return fail(current)
    const budget = validateExternalBudget({
      style: current.external.style,
      limitNote: canon.limitNote,
      maxDurationMs: current.external.maxDurationMs,
      maxBytes: current.external.maxBytes,
      requestTimeoutMs: current.external.requestTimeoutMs,
    })
    if (!budget.ok) return fail(current)
    return { ok: true, sttEngine: "external", external: { ...current.external } }
  }

  const style = action.style ?? current.external.style
  const baseUrl = action.baseUrl !== undefined ? action.baseUrl : current.external.baseUrl
  const canon = canonicalExternalUrl(style, baseUrl)
  if (!canon.ok) return fail(current)
  const factory = factoryExternalBudget(style, canon.limitNote)
  const styleChanged = style !== current.external.style
  const next: VoiceExternalConfig = {
    style,
    baseUrl,
    model: current.external.model,
    apiKey: current.external.apiKey,
    maxDurationMs: styleChanged ? factory.maxDurationMs : current.external.maxDurationMs,
    maxBytes: styleChanged ? factory.maxBytes : current.external.maxBytes,
    requestTimeoutMs: styleChanged ? factory.requestTimeoutMs : current.external.requestTimeoutMs,
  }
  if (action.maxDurationMs !== undefined) next.maxDurationMs = action.maxDurationMs
  if (action.maxBytes !== undefined) next.maxBytes = action.maxBytes
  if (action.requestTimeoutMs !== undefined) next.requestTimeoutMs = action.requestTimeoutMs
  if (action.apiKey === "") next.apiKey = ""
  else if (action.apiKey !== undefined && action.apiKey !== "***") next.apiKey = action.apiKey
  if (style === "openai" && action.model !== undefined) {
    if (action.model.trim() === "") return fail(current)
    next.model = action.model
  }
  const budget = validateExternalBudget({
    style,
    limitNote: canon.limitNote,
    maxDurationMs: next.maxDurationMs,
    maxBytes: next.maxBytes,
    requestTimeoutMs: next.requestTimeoutMs,
  })
  if (!budget.ok) return fail(current)
  return { ok: true, sttEngine: current.sttEngine, external: next }
}
